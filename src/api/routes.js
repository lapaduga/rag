import { Router } from 'express';
import { db } from '../storage/db.js';
import { Indexer } from '../indexer/index.js';
import { Embedder } from '../indexer/embedder.js';
import { Retriever } from '../retriever/index.js';
import { Augmenter } from '../augmenter/index.js';
import { LlmClient } from '../llm/index.js';
import { Reranker } from '../reranker/index.js';
import { QueryRewriter } from '../query-rewrite/index.js';
import { RagPipeline } from '../pipeline/index.js';
import { MemoryManager } from '../memory/index.js';
import { ContextWindow } from '../context-window/index.js';
import { validateIndexRequest } from './middleware.js';
import { config } from '../config.js';
import os from 'os';

const router = Router();
const indexer = new Indexer();
const embedder = new Embedder();
const retriever = new Retriever(embedder);
const augmenter = new Augmenter();

function createLlmClient(provider) {
  return new LlmClient(provider);
}

let llmClient = createLlmClient(config.provider);

const reranker = new Reranker({ model: config.reranker.model });
const rewriter = new QueryRewriter(llmClient);
let ragPipeline = new RagPipeline({
  retriever,
  reranker,
  rewriter,
  augmenter,
  llm: llmClient,
  config: config.pipeline || {},
});

let memoryManager = new MemoryManager(llmClient);
const contextWindow = new ContextWindow({ maxTokens: 6000, maxMessages: 20 });

function rebuildPipeline(provider) {
  llmClient = createLlmClient(provider);
  rewriter.llmClient = llmClient;
  ragPipeline = new RagPipeline({
    retriever,
    reranker,
    rewriter,
    augmenter,
    llm: llmClient,
    config: config.pipeline || {},
  });
  memoryManager = new MemoryManager(llmClient);
}

router.get('/status', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

router.get('/config', (req, res) => {
  res.json({
    success: true,
    data: {
      provider: config.provider,
      providers: ['deepseek', 'local'],
      localModel: config.localLlm.model,
      deepseekModel: config.chat.model,
    },
  });
});

router.get('/ollama/status', async (req, res) => {
  const client = createLlmClient('local');
  const status = await client.checkHealth();
  res.json({ success: true, data: status });
});

router.post('/index', validateIndexRequest, async (req, res, next) => {
  try {
    const { path: docPath, strategy, maxFiles } = req.body;
    const result = await indexer.runIndexing(docPath, strategy || 'fixed', maxFiles);
    retriever.invalidateCache();
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.get('/index/status', (req, res) => {
  res.json({ success: true, data: indexer.getStatus() });
});

router.post('/index/cancel', (req, res) => {
  indexer.cancelIndexing();
  res.json({ success: true, data: indexer.getStatus() });
});

router.get('/documents', (req, res) => {
  const docs = db.getAllDocuments();
  res.json({ success: true, data: docs });
});

router.get('/chunks', (req, res) => {
  const documentId = parseInt(req.query.document_id, 10);
  if (!documentId) {
    return res.status(400).json({ error: true, message: 'Параметр document_id обязателен' });
  }
  const strategy = req.query.strategy || null;
  const chunks = db.getChunksByDocument(documentId, strategy);
  const parsed = chunks.map(c => ({
    ...c,
    metadata: JSON.parse(c.metadata),
    embedding: c.embedding instanceof Buffer
      ? Array.from(new Float32Array(c.embedding.buffer, c.embedding.byteOffset, c.embedding.byteLength / 4))
      : (c.embedding ? JSON.parse(c.embedding) : null),
  }));
  res.json({ success: true, data: parsed });
});

let prevCpuTimes = null;

function getCpuUsage() {
  const cpus = os.cpus();
  const totalCores = cpus.length;
  let totalIdle = 0;
  let totalTick = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }
  const snapshot = { idle: totalIdle, tick: totalTick };
  if (!prevCpuTimes) {
    prevCpuTimes = snapshot;
    return { usagePercent: 0, cores: totalCores };
  }
  const idleDiff = snapshot.idle - prevCpuTimes.idle;
  const tickDiff = snapshot.tick - prevCpuTimes.tick;
  prevCpuTimes = snapshot;
  const usage = tickDiff > 0 ? 100 - (idleDiff / tickDiff) * 100 : 0;
  return { usagePercent: Math.round(usage * 10) / 10, cores: totalCores };
}

router.get('/system-stats', (req, res) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const procMem = process.memoryUsage();
  const cpu = getCpuUsage();
  res.json({
    success: true,
    data: {
      ram: {
        total: totalMem,
        used: usedMem,
        free: freeMem,
        percent: totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0,
      },
      cpu,
      process: {
        memory: procMem.rss,
        heapUsed: procMem.heapUsed,
        heapTotal: procMem.heapTotal,
      },
    },
  });
});

router.delete('/index', (req, res) => {
  db.deleteAllDocuments();
  retriever.invalidateCache();
  res.json({ success: true, message: 'Индекс очищен' });
});

router.post('/index/compare', async (req, res, next) => {
  try {
    const { path: docPath } = req.body;
    if (!docPath) {
      return res.status(400).json({ error: true, message: 'Поле "path" обязательно' });
    }
    const result = await indexer.runComparison(docPath);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/query', async (req, res, next) => {
  try {
    const { question, mode = 'auto', pipeline: pipelineOpts, thread_id, provider } = req.body;
    if (!question) {
      return res.status(400).json({ error: true, message: 'Поле "question" обязательно' });
    }

    const activeProvider = provider || config.provider || 'deepseek';
    if (activeProvider !== llmClient.provider) {
      rebuildPipeline(activeProvider);
    }

    let history = [];
    let taskMemory = [];
    if (thread_id) {
      const maxHist = config.pipeline.maxHistoryMessages;
      history = db.getRecentMessages(thread_id, maxHist > 0 ? maxHist : undefined);
      taskMemory = db.getTaskMemory(thread_id);
    }

    let actualMode = mode;
    if (mode === 'auto') {
      actualMode = llmClient._detectMode(question);
    }

    let result;
    if (actualMode === 'no-rag') {
      const messages = augmenter.buildPrompt(question, [], 'no-rag');
      const llmResult = await llmClient.chat(messages);
      result = {
        answer: llmResult.answer,
        mode: 'no-rag',
        searchQuery: question,
        needsTranslation: false,
        sources: [],
        citations: [],
        confidenceScore: 0,
        hasEnoughContext: true,
        isDontKnow: false,
        timing: { total: llmResult.timing_ms },
        usage: llmResult.usage,
        pipeline: null,
      };
    } else {
      const pipelineConfig = {
        queryRewrite: pipelineOpts?.queryRewrite ?? config.pipeline?.queryRewrite ?? false,
        reranker: pipelineOpts?.reranker ?? config.pipeline?.reranker ?? false,
        threshold: pipelineOpts?.threshold ?? (pipelineOpts?.threshold === null ? undefined : config.pipeline?.threshold),
        topKBefore: pipelineOpts?.topKBefore ?? config.pipeline?.topKBefore ?? 20,
        topKAfter: pipelineOpts?.topKAfter ?? config.pipeline?.topKAfter ?? 5,
      };

      const pipelineResult = await ragPipeline.execute(question, {
        ...pipelineConfig,
        threadId: thread_id,
        history,
        taskMemory,
      });

      result = {
        answer: pipelineResult.answer,
        mode: 'rag',
        searchQuery: question,
        needsTranslation: false,
        sources: pipelineResult.sources,
        citations: pipelineResult.citations || [],
        confidenceScore: pipelineResult.confidenceScore,
        hasEnoughContext: pipelineResult.hasEnoughContext,
        isDontKnow: pipelineResult.isDontKnow || false,
        timing: pipelineResult.timing,
        usage: pipelineResult.usage,
        pipeline: pipelineResult.pipeline,
      };
    }

    if (thread_id) {
      db.saveMessage({
        thread_id,
        role: 'user',
        content: question,
      });
      db.saveMessage({
        thread_id,
        role: 'assistant',
        content: result.answer,
        sources: result.sources || [],
        citations: result.citations || [],
        confidence_score: result.confidenceScore,
        has_enough_context: result.hasEnoughContext,
        is_dont_know: result.isDontKnow || false,
        pipeline: result.pipeline ? JSON.stringify(result.pipeline) : null,
      });

      if (config.pipeline?.memoryExtractionEnabled && memoryManager) {
        const messages = db.getMessagesByThread(thread_id, 20);
        const extracted = await memoryManager.extractTaskState(messages);
        if (extracted?.goal) {
          db.setTaskMemory({ thread_id, key: 'goal', value: extracted.goal, type: 'goal' });
        }
        if (extracted?.constraints) {
          for (const c of extracted.constraints) {
            db.setTaskMemory({ thread_id, key: `constraint_${Date.now()}`, value: c, type: 'constraint' });
          }
        }
        if (extracted?.terms) {
          db.setTaskMemory({ thread_id, key: 'terms', value: extracted.terms.join(', '), type: 'term' });
        }
        if (extracted?.clarifications) {
          for (const c of extracted.clarifications) {
            db.setTaskMemory({ thread_id, key: `clarification_${Date.now()}`, value: c, type: 'clarification' });
          }
        }
      }
    }

    db.saveQuery({
      question,
      mode: result.mode,
      answer: result.answer,
      sources: result.sources,
      latency_ms: result.timing.total,
      pipeline: result.pipeline ? JSON.stringify(result.pipeline) : null,
      citations: result.citations ? JSON.stringify(result.citations) : null,
      confidence_score: result.confidenceScore,
      has_enough_context: result.hasEnoughContext,
      is_dont_know: result.isDontKnow || false,
    });

    res.json({
      success: true,
      data: {
        answer: result.answer,
        mode: result.mode,
        provider: activeProvider,
        searchQuery: result.searchQuery,
        needsTranslation: result.needsTranslation,
        sources: result.sources,
        citations: result.citations || [],
        confidenceScore: result.confidenceScore,
        hasEnoughContext: result.hasEnoughContext,
        isDontKnow: result.isDontKnow || false,
        timing: result.timing,
        usage: result.usage,
        pipeline: result.pipeline,
        thread_id,
      }
    });
  } catch (err) {
    next(err);
  }
});

// === Threads ===

router.post('/threads', async (req, res, next) => {
  try {
    const { title, task_goal, constraints } = req.body;
    const id = db.createThread({ title: title || 'Новый диалог', task_goal, constraints });
    res.json({ success: true, data: { id } });
  } catch (err) { next(err); }
});

router.get('/threads', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const threads = db.getAllThreads(limit);
    res.json({ success: true, data: threads });
  } catch (err) { next(err); }
});

router.get('/threads/:id', async (req, res, next) => {
  try {
    const thread = db.getThread(parseInt(req.params.id, 10));
    if (!thread) return res.status(404).json({ error: true, message: 'Диалог не найден' });
    res.json({ success: true, data: thread });
  } catch (err) { next(err); }
});

router.delete('/threads/:id', async (req, res, next) => {
  try {
    db.deleteThread(parseInt(req.params.id, 10));
    res.json({ success: true, message: 'Диалог удален' });
  } catch (err) { next(err); }
});

router.post('/threads/:id/clear-messages', async (req, res, next) => {
  try {
    db.clearThreadMessages(parseInt(req.params.id, 10));
    res.json({ success: true, message: 'Сообщения удалены' });
  } catch (err) { next(err); }
});

// === Messages ===

router.get('/threads/:id/messages', async (req, res, next) => {
  try {
    const messages = db.getMessagesByThread(parseInt(req.params.id, 10));
    res.json({ success: true, data: messages });
  } catch (err) { next(err); }
});

// === Task Memory ===

router.get('/threads/:id/memory', async (req, res, next) => {
  try {
    const memory = db.getTaskMemory(parseInt(req.params.id, 10));
    res.json({ success: true, data: memory });
  } catch (err) { next(err); }
});

router.post('/threads/:id/memory', async (req, res, next) => {
  try {
    const { key, value, type } = req.body;
    db.setTaskMemory({ thread_id: parseInt(req.params.id, 10), key, value, type });
    res.json({ success: true, message: 'Память обновлена' });
  } catch (err) { next(err); }
});

router.delete('/threads/:id/memory/:key', async (req, res, next) => {
  try {
    db.deleteTaskMemoryByKey(parseInt(req.params.id, 10), req.params.key);
    res.json({ success: true, message: 'Запись удалена' });
  } catch (err) { next(err); }
});

router.post('/threads/:id/memory/clear', async (req, res, next) => {
  try {
    db.clearTaskMemory(parseInt(req.params.id, 10));
    res.json({ success: true, message: 'Память очищена' });
  } catch (err) { next(err); }
});

// === Queries ===

router.get('/queries', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const mode = req.query.mode || null;
  const queries = mode ? db.getQueriesByMode(mode) : db.getQueries(limit);
  res.json({ success: true, data: queries });
});

router.get('/queries/pipeline', (req, res) => {
  const queries = db.getQueriesWithPipeline();
  res.json({ success: true, data: queries });
});

router.get('/queries/citations', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const queries = db.getQueriesWithCitations(limit);
  res.json({ success: true, data: queries });
});

router.get('/compare/results', (req, res) => {
  const comparison = db.getStrategyComparison();
  res.json({ success: true, data: comparison });
});

export default router;
