import { CitationParser } from '../citation-parser/index.js';
import { config } from '../config.js';

export class RagPipeline {
  constructor({ retriever, reranker, rewriter, augmenter, llm, config }) {
    this.retriever = retriever;
    this.reranker = reranker;
    this.rewriter = rewriter;
    this.augmenter = augmenter;
    this.llm = llm;
    this.config = config || {};
    this.citationParser = new CitationParser();
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
      threshold: this.config.similarityThreshold ?? 0.0,
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
    chunks = chunks.slice(0, topKAfter);
    stages.push({ stage: 'topK', count: chunks.length, time_ms: Date.now() - t4 });

    const confidenceScore = chunks.length > 0
      ? chunks.reduce((sum, c) => {
          const kwBoost = 0.2 * ((c._keywordScore?.matched || 0) + (c._contentKwMatches || 0));
          const raw = c.combinedScore ?? ((c.similarity || 0) + kwBoost);
          return sum + Math.min(1.0, Math.max(0, raw));
        }, 0) / chunks.length
      : 0;

    const minConfidence = options.minConfidence ?? this.config.minConfidence ?? 0.25;

    if (confidenceScore < minConfidence) {
      stages.push({ stage: 'low-confidence-guard', confidenceScore, minConfidence, time_ms: 0 });
      const total = Date.now() - start;
      return {
        answer: 'В проиндексированном коде эта информация не найдена. Попробуйте уточнить вопрос или переформулировать его.',
        sources: [],
        citations: [],
        confidenceScore,
        hasEnoughContext: false,
        isDontKnow: true,
        pipeline: { stages, originalQuery: question, rewrittenQuery },
        timing: { total },
        usage: {},
      };
    }

    const messages = this.augmenter.buildPrompt(question, chunks, 'rag');
    const t5 = Date.now();
    const result = await this.llm.chat(messages);
    stages.push({ stage: 'llm', time_ms: Date.now() - t5 });

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
        const root = config.documents.path.replace(/\\/g, '/').replace(/\/$/, '');
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
    };
  }
}
