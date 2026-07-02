import { Router } from 'express';
import { db } from '../storage/db.js';
import { Indexer } from '../indexer/index.js';
import { Embedder } from '../indexer/embedder.js';
import { Retriever } from '../retriever/index.js';
import { Augmenter } from '../augmenter/index.js';
import { LlmClient } from '../llm/index.js';
import { validateIndexRequest } from './middleware.js';

const router = Router();
const indexer = new Indexer();
const embedder = new Embedder();
const retriever = new Retriever(embedder);
const augmenter = new Augmenter();
const llmClient = new LlmClient();

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
    const { question, mode = 'auto', topK, threshold } = req.body;
    if (!question) {
      return res.status(400).json({ error: true, message: 'Поле "question" обязательно' });
    }

    const result = await llmClient.chatWithRag(question, retriever, augmenter, mode, { topK, threshold });

    db.saveQuery({
      question,
      mode: result.mode,
      answer: result.answer,
      sources: result.sources,
      latency_ms: result.timing.total,
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
      }
    });
  } catch (err) {
    next(err);
  }
});

router.post('/query/compare', async (req, res, next) => {
  try {
    const { questions, topK, threshold } = req.body;
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: true, message: 'Поле "questions" обязательно и должно быть массивом' });
    }

    const results = [];
    for (const question of questions) {
      const ragResult = await llmClient.chatWithRag(question, retriever, augmenter, 'rag', { topK, threshold });
      const noRagResult = await llmClient.chatWithRag(question, retriever, augmenter, 'no-rag', { topK, threshold });
      results.push({
        question,
        rag: { answer: ragResult.answer, sources: ragResult.sources, timing: ragResult.timing },
        noRag: { answer: noRagResult.answer, sources: noRagResult.sources, timing: noRagResult.timing },
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

router.get('/compare/results', (req, res) => {
  const comparison = db.getStrategyComparison();
  res.json({ success: true, data: comparison });
});

export default router;
