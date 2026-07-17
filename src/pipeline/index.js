import { CitationParser } from '../citation-parser/index.js';
import { MemoryManager } from '../memory/index.js';
import { McpServer } from '../mcp/index.js';
import { config as appConfig } from '../config.js';

const MAX_AGENT_STEPS = 5;

function parseToolCalls(reply) {
  const results = [];
  const parts = reply.split('TOOL_CALL:');
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].trim();
    let depth = 0;
    let start = -1;
    for (let j = 0; j < part.length; j++) {
      const ch = part[j];
      if (ch === '{') {
        if (depth === 0) start = j;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          try {
            const jsonStr = part.slice(start, j + 1);
            const data = JSON.parse(jsonStr);
            if (data.tool) results.push(data);
          } catch {}
          break;
        }
      }
    }
  }
  return results;
}

export class RagPipeline {
  constructor({ retriever, reranker, rewriter, augmenter, llm, config }) {
    this.retriever = retriever;
    this.reranker = reranker;
    this.rewriter = rewriter;
    this.augmenter = augmenter;
    this.llm = llm;
    this.config = config || {};
    this.citationParser = new CitationParser();
    this.memoryManager = new MemoryManager(llm);
    this.mcpServer = new McpServer();
  }

  _buildMcpToolDefinitions() {
    const defs = this.mcpServer.getToolDefinitions();
    return defs.map(t => `- ${t.name}: ${t.description}`).join('\n');
  }

  async _executeTool(toolName, args) {
    const result = await this.mcpServer.callTool(toolName);
    if (result.error) return `Ошибка: ${result.error}`;
    return JSON.stringify(result, null, 2);
  }

  async execute(question, options = {}) {
    const start = Date.now();
    const stages = [];

    const topKBefore = options.topKBefore ?? this.config.topKBefore ?? 20;
    const topKAfter = options.topKAfter ?? this.config.topKAfter ?? 5;
    const threshold = options.threshold;
    const doRerank = options.reranker === true;
    const doRewrite = options.queryRewrite === true;

    let query = question;
    let rewrittenQuery = null;

    const isCyrillic = /[а-яё]/i.test(query);
    if (isCyrillic) {
      const t0 = Date.now();
      query = await this.llm.translateQuery(question);
      stages.push({ stage: 'translate', query, time_ms: Date.now() - t0 });
    }

    if (doRewrite && this.rewriter) {
      const t0 = Date.now();
      query = await this.rewriter.rewrite(query);
      rewrittenQuery = query;
      stages.push({ stage: 'rewrite', query, time_ms: Date.now() - t0 });
    }

    const t1 = Date.now();
    let chunks = await this.retriever.search(query, {
      topK: Math.max(topKBefore, topKAfter, 200),
      threshold: appConfig.rag.similarityThreshold,
    });
    stages.push({ stage: 'retrieval', count: chunks.length, time_ms: Date.now() - t1 });

    if (doRerank && this.reranker && chunks.length > 0) {
      const t2 = Date.now();
      chunks = await this.reranker.rerank(query, chunks);
      stages.push({ stage: 'rerank', count: chunks.length, time_ms: Date.now() - t2 });
    }

    if (threshold != null) {
      const t3 = Date.now();
      const before = chunks.length;
      const scoreKey = doRerank ? 'combinedScore' : 'similarity';
      chunks = chunks.filter(c => (c[scoreKey] ?? c.similarity ?? 0) >= threshold);
      stages.push({ stage: 'filter', count: chunks.length, time_ms: Date.now() - t3, before });
    }

    const t4 = Date.now();
    const topKChunks = chunks.slice(0, topKAfter);
    const contentMatchChunks = chunks
      .filter(c => (c._contentKwMatches || 0) > 0 && !topKChunks.find(t => t.chunk_id === c.chunk_id))
      .sort((a, b) => (b._contentKwMatches || 0) - (a._contentKwMatches || 0))
      .slice(0, topKAfter);
    chunks = [...topKChunks, ...contentMatchChunks];
    stages.push({ stage: 'topK', count: chunks.length, time_ms: Date.now() - t4 });

    const top5 = topKChunks.slice(0, 5);
    const confidenceScore = top5.length > 0
      ? top5.reduce((sum, c) => {
          const kwBoost = 0.2 * ((c._keywordScore?.matched || 0));
          const raw = c.combinedScore ?? ((c.similarity || 0) + kwBoost);
          return sum + Math.min(1.0, Math.max(0, raw));
        }, 0) / top5.length
      : 0;

    const minConfidence = options.minConfidence ?? this.config.minConfidence ?? 0.25;
    const skipGuard = confidenceScore < minConfidence;

    if (skipGuard) {
      stages.push({ stage: 'low-confidence-guard', confidenceScore, minConfidence, skipped: true, time_ms: 0 });
    }

    const memoryContext = this.memoryManager?.buildMemoryContext(options.taskMemory || []) || '';

    const historyContext = (options.history || []).length > 0
      ? (options.history || []).map(m => `${m.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${m.content}`).join('\n')
      : '';

    let mcpContext = '';
    try {
      const [branch, files, log] = await Promise.all([
        this.mcpServer.callTool('get_git_branch'),
        this.mcpServer.callTool('list_project_files'),
        this.mcpServer.callTool('get_git_log'),
      ]);
      const parts = [];
      if (!branch.error) parts.push(`Ветка: ${branch.branch}, изменений: ${branch.modifiedFiles}`);
      if (!files.error) parts.push(`Файлов: ${files.total}`);
      if (!log.error && log.commits?.length) {
        parts.push(`Последние коммиты: ${log.commits.slice(0, 3).map(c => `${c.hash} ${c.message}`).join('; ')}`);
      }
      if (parts.length) mcpContext = parts.join('\n');
    } catch {}

    const mcpTools = this._buildMcpToolDefinitions();
    const messages = this.augmenter.buildPrompt(question, chunks, 'rag', { memoryContext, historyContext, mcpContext, mcpTools });

    const allToolCalls = [];
    const conversationHistory = [...messages];

    for (let step = 0; step < MAX_AGENT_STEPS; step++) {
      const t5 = Date.now();
      const result = await this.llm.chat(conversationHistory);
      stages.push({ stage: `llm-step-${step + 1}`, time_ms: Date.now() - t5 });

      const callRequests = parseToolCalls(result.answer);
      if (callRequests.length === 0) {
        const t6 = Date.now();
        const parsed = this.citationParser.parse(result.answer, chunks);
        stages.push({ stage: 'citation-parse', citationCount: parsed.citations.length, validCount: parsed.citations.filter(c => c.isValid).length, time_ms: Date.now() - t6 });

        const isDontKnow = this.citationParser.isDontKnow(result.answer);
        const total = Date.now() - start;

        return {
          answer: parsed.cleanAnswer || result.answer,
          sources: chunks.map(c => {
            const meta = typeof c.metadata === 'string' ? JSON.parse(c.metadata) : c.metadata;
            const fullPath = meta?.source || '';
            const root = appConfig.documents.path.replace(/\\/g, '/').replace(/\/$/, '');
            const baseDir = root.split('/').pop();
            const relPath = fullPath.startsWith(root) ? baseDir + fullPath.slice(root.length) : fullPath;
            return {
              chunk_id: c.chunk_id,
              filename: c.filename,
              path: relPath,
              section: meta?.section || 'other',
              content: c.content ? c.content.slice(0, 300) : '',
              similarity: c.similarity,
              rerankScore: c.rerankScore,
              combinedScore: c.combinedScore,
            };
          }),
          citations: parsed.citations,
          confidenceScore,
          hasEnoughContext: parsed.hasEnoughContext && !isDontKnow,
          isDontKnow,
          pipeline: { stages, originalQuery: question, rewrittenQuery },
          timing: { total },
          usage: result.usage,
          toolCalls: allToolCalls,
        };
      }

      conversationHistory.push({ role: 'assistant', content: result.answer });

      for (const callData of callRequests) {
        const { tool: toolName, arguments: args } = callData;
        stages.push({ stage: `tool-call`, tool: toolName, time_ms: 0 });

        let toolResult;
        try {
          toolResult = await this._executeTool(toolName, args);
        } catch (err) {
          toolResult = `Ошибка: ${err.message}`;
        }

        allToolCalls.push({ tool: toolName, arguments: args || {}, result: toolResult.slice(0, 500) });

        conversationHistory.push({
          role: 'system',
          content: `Результат вызова "${toolName}":\n${toolResult}\n\nЕсли задача решена — ответь пользователю по-русски. Если нужен ещё один инструмент — вызови его через TOOL_CALL.`,
        });
      }
    }

    const finalMessages = [
      ...conversationHistory,
      { role: 'system', content: 'Достигнут лимит шагов (5). Подведи итог пользователю по-русски.' },
    ];
    const tFinal = Date.now();
    const finalResult = await this.llm.chat(finalMessages);
    stages.push({ stage: 'llm-final', time_ms: Date.now() - tFinal });

    const total = Date.now() - start;
    return {
      answer: finalResult.answer,
      sources: [],
      citations: [],
      confidenceScore,
      hasEnoughContext: true,
      isDontKnow: false,
      pipeline: { stages, originalQuery: question, rewrittenQuery },
      timing: { total },
      usage: finalResult.usage,
      toolCalls: allToolCalls,
    };
  }
}
