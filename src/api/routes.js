import { Router } from 'express';
import { db } from '../storage/db.js';
import { Indexer } from '../indexer/index.js';
import { validateIndexRequest } from './middleware.js';

const router = Router();
const indexer = new Indexer();

router.get('/status', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

router.post('/index', validateIndexRequest, async (req, res, next) => {
  try {
    const { path: docPath, strategy, maxFiles } = req.body;
    const result = await indexer.runIndexing(docPath, strategy || 'fixed', maxFiles);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.get('/index/status', (req, res) => {
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
    const { question, mode } = req.body;
    if (!question) {
      return res.status(400).json({ error: true, message: 'Поле "question" обязательно' });
    }
    res.json({
      success: true,
      data: {
        question,
        mode: mode || 'rag',
        answer: 'RAG query endpoint — implementation pending',
        sources: [],
      }
    });
  } catch (err) {
    next(err);
  }
});

router.get('/compare/results', (req, res) => {
  const comparison = db.getStrategyComparison();
  res.json({ success: true, data: comparison });
});

export default router;
