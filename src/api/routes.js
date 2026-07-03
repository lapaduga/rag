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
import { validateIndexRequest } from './middleware.js';
import { config } from '../config.js';

const router = Router();
const indexer = new Indexer();
const embedder = new Embedder();
const retriever = new Retriever(embedder);
const augmenter = new Augmenter();
const llmClient = new LlmClient();
const reranker = new Reranker({ model: config.reranker.model });
const rewriter = new QueryRewriter(llmClient);
const ragPipeline = new RagPipeline({
  retriever,
  reranker,
  rewriter,
  augmenter,
  llm: llmClient,
  config: config.pipeline || {},
});

router.get('/status', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
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
    embedding: c.embedding ? JSON.parse(c.embedding) : null,
  }));
  res.json({ success: true, data: parsed });
});

router.get('/stats', (req, res) => {
  const stats = db.getStats();
  res.json({ success: true, data: stats });
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
    const { question, mode = 'auto', pipeline: pipelineOpts } = req.body;
    if (!question) {
      return res.status(400).json({ error: true, message: 'Поле "question" обязательно' });
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

      const pipelineResult = await ragPipeline.execute(question, pipelineConfig);

      result = {
        answer: pipelineResult.answer,
        mode: 'rag',
        searchQuery: question,
        needsTranslation: false,
        sources: pipelineResult.sources,
        timing: pipelineResult.timing,
        usage: pipelineResult.usage,
        pipeline: pipelineResult.pipeline,
      };
    }

    db.saveQuery({
      question,
      mode: result.mode,
      answer: result.answer,
      sources: result.sources,
      latency_ms: result.timing.total,
      pipeline: result.pipeline ? JSON.stringify(result.pipeline) : null,
    });

    res.json({
      success: true,
      data: {
        answer: result.answer,
        mode: result.mode,
        searchQuery: result.searchQuery,
        needsTranslation: result.needsTranslation,
        sources: result.sources,
        timing: result.timing,
        usage: result.usage,
        pipeline: result.pipeline,
      }
    });
  } catch (err) {
    next(err);
  }
});

router.post('/query/compare', async (req, res, next) => {
  try {
    const { question, pipelines } = req.body;
    if (!question) {
      return res.status(400).json({ error: true, message: 'Поле "question" обязательно' });
    }
    if (!pipelines || !Array.isArray(pipelines) || pipelines.length === 0) {
      return res.status(400).json({ error: true, message: 'Поле "pipelines" обязательно и должно быть массивом' });
    }

    const results = [];
    for (const pipeCfg of pipelines) {
      const cfg = {
        queryRewrite: pipeCfg.queryRewrite ?? false,
        reranker: pipeCfg.reranker ?? false,
        threshold: pipeCfg.threshold,
        topKBefore: pipeCfg.topKBefore ?? config.pipeline?.topKBefore ?? 20,
        topKAfter: pipeCfg.topKAfter ?? config.pipeline?.topKAfter ?? 5,
      };

      const pipelineResult = await ragPipeline.execute(question, cfg);

      results.push({
        name: pipeCfg.name || 'unnamed',
        config: cfg,
        answer: pipelineResult.answer,
        sources: pipelineResult.sources,
        pipeline: pipelineResult.pipeline,
        timing: pipelineResult.timing,
      });
    }

    res.json({ success: true, data: results });
  } catch (err) {
    next(err);
  }
});

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

router.get('/compare/results', (req, res) => {
  const comparison = db.getStrategyComparison();
  res.json({ success: true, data: comparison });
});

export default router;
