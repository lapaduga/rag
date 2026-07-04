import BetterSqlite3 from 'better-sqlite3';
import { readFileSync, mkdirSync, readdirSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class Database {
  constructor() {
    this.db = null;
  }

  open() {
    const dbPath = config.db.path;
    const dbDir = dirname(dbPath);
    mkdirSync(dbDir, { recursive: true });
    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    return this;
  }

  migrate() {
    const migrationsDir = resolve(__dirname, 'migrations');

    this.db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    const applied = new Set(
      this.db.prepare('SELECT name FROM _migrations ORDER BY id').all().map(r => r.name)
    );

    let files;
    try {
      files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    } catch {
      return this;
    }

    for (const file of files) {
      if (applied.has(file)) continue;
      const migrationPath = resolve(migrationsDir, file);
      try {
        const sql = readFileSync(migrationPath, 'utf-8');
        this.db.exec(sql);
        this.db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
        console.log(`[DB] Migration ${file} applied`);
      } catch (e) {
        const ignore = e.message
          && (e.message.includes('duplicate column name')
            || e.message.includes('already exists')
            || e.message.includes('UNIQUE constraint failed'));
        if (ignore) {
          this.db.prepare('INSERT OR IGNORE INTO _migrations (name) VALUES (?)').run(file);
          console.log(`[DB] Migration ${file} skipped (already applied)`);
        } else {
          console.error(`[DB] Migration ${file} failed:`, e.message);
          throw e;
        }
      }
    }
    return this;
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  insertDocument(doc) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO documents (path, filename, extension, content, size_bytes)
      VALUES (@path, @filename, @extension, @content, @size_bytes)
    `);
    const result = stmt.run(doc);
    return result.lastInsertRowid;
  }

  getDocumentByPath(path) {
    return this.db.prepare('SELECT * FROM documents WHERE path = ?').get(path);
  }

  getAllDocuments() {
    return this.db.prepare('SELECT id, path, filename, extension, size_bytes, indexed_at FROM documents ORDER BY indexed_at DESC').all();
  }

  deleteAllDocuments() {
    this.db.exec('DELETE FROM chunks');
    this.db.exec('DELETE FROM documents');
  }

  insertChunk(chunk) {
    const stmt = this.db.prepare(`
      INSERT INTO chunks (document_id, chunk_id, content, embedding, metadata, strategy, chunk_index, total_chunks)
      VALUES (@document_id, @chunk_id, @content, @embedding, @metadata, @strategy, @chunk_index, @total_chunks)
    `);
    return stmt.run(chunk);
  }

  insertChunks(chunks) {
    const insert = this.db.transaction((items) => {
      const stmt = this.db.prepare(`
        INSERT INTO chunks (document_id, chunk_id, content, embedding, metadata, strategy, chunk_index, total_chunks)
        VALUES (@document_id, @chunk_id, @content, @embedding, @metadata, @strategy, @chunk_index, @total_chunks)
      `);
      for (const item of items) {
        stmt.run(item);
      }
    });
    insert(chunks);
  }

  getChunksByDocument(documentId, strategy) {
    let query = 'SELECT * FROM chunks WHERE document_id = ?';
    const params = [documentId];
    if (strategy) {
      query += ' AND strategy = ?';
      params.push(strategy);
    }
    query += ' ORDER BY chunk_index ASC';
    return this.db.prepare(query).all(...params);
  }

  getStats() {
    const docCount = this.db.prepare('SELECT COUNT(*) as count FROM documents').get();
    const chunkCount = this.db.prepare('SELECT COUNT(*) as count FROM chunks').get();
    const strategyStats = this.db.prepare(`
      SELECT strategy, COUNT(*) as count, AVG(LENGTH(content)) as avg_size
      FROM chunks GROUP BY strategy
    `).all();
    return { documents: docCount.count, chunks: chunkCount.count, strategies: strategyStats };
  }

  getLastIndexingStatus() {
    const doc = this.db.prepare('SELECT indexed_at FROM documents ORDER BY indexed_at DESC LIMIT 1').get();
    return doc ? { lastIndexedAt: doc.indexed_at, hasData: true } : { lastIndexedAt: null, hasData: false };
  }

  deleteChunksByDocument(documentId) {
    this.db.prepare('DELETE FROM chunks WHERE document_id = ?').run(documentId);
  }

  getAllChunksWithEmbeddings() {
    const rows = this.db.prepare(`
      SELECT c.*, d.filename, d.extension, d.path AS document_path
      FROM chunks c
      JOIN documents d ON c.document_id = d.id
      WHERE c.embedding IS NOT NULL
    `).all();
    return rows.map(c => ({
      ...c,
      metadata: typeof c.metadata === 'string' ? JSON.parse(c.metadata) : c.metadata,
      embedding: c.embedding instanceof Buffer
        ? new Float32Array(c.embedding.buffer, c.embedding.byteOffset, c.embedding.byteLength / 4)
        : (typeof c.embedding === 'string' ? JSON.parse(c.embedding) : c.embedding),
    }));
  }

  saveQuery({ question, mode, answer, sources, latency_ms, pipeline, citations, confidence_score, has_enough_context, is_dont_know }) {
    this.db.prepare(`
      INSERT INTO queries (question, mode, answer, sources, latency_ms, pipeline_json, citations, confidence_score, has_enough_context, is_dont_know)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      question, mode, answer, JSON.stringify(sources), latency_ms,
      pipeline || null,
      citations ? JSON.stringify(citations) : null,
      confidence_score != null ? confidence_score : null,
      has_enough_context ? 1 : 0,
      is_dont_know ? 1 : 0
    );
  }

  getQueries(limit = 50) {
    return this.db.prepare('SELECT * FROM queries ORDER BY created_at DESC LIMIT ?').all(limit);
  }

  getQueriesByMode(mode) {
    return this.db.prepare('SELECT * FROM queries WHERE mode = ? ORDER BY created_at DESC').all(mode);
  }

  getQueriesWithPipeline() {
    const rows = this.db.prepare("SELECT * FROM queries WHERE pipeline_json IS NOT NULL ORDER BY created_at DESC LIMIT 50").all();
    return rows.map(q => ({
      ...q,
      pipeline: q.pipeline_json ? JSON.parse(q.pipeline_json) : null,
    }));
  }

  getQueriesWithCitations(limit = 50) {
    const rows = this.db.prepare("SELECT * FROM queries WHERE citations IS NOT NULL ORDER BY created_at DESC LIMIT ?").all(limit);
    return rows.map(q => ({
      ...q,
      sources: q.sources ? JSON.parse(q.sources) : [],
      citations: q.citations ? JSON.parse(q.citations) : [],
      pipeline: q.pipeline_json ? JSON.parse(q.pipeline_json) : null,
    }));
  }

  getQueriesForValidation(limit = 10) {
    const rows = this.db.prepare(
      "SELECT * FROM queries WHERE mode = 'rag' AND answer IS NOT NULL ORDER BY created_at DESC LIMIT ?"
    ).all(limit);
    return rows.map(q => ({
      ...q,
      sources: q.sources ? JSON.parse(q.sources) : [],
      citations: q.citations ? JSON.parse(q.citations) : [],
      pipeline: q.pipeline_json ? JSON.parse(q.pipeline_json) : null,
    }));
  }

  getStrategyComparison() {
    const strategies = ['fixed', 'semantic'];
    const result = {};
    for (const strategy of strategies) {
      const stats = this.db.prepare(`
        SELECT 
          COUNT(*) as total_chunks,
          AVG(LENGTH(content)) as avg_chunk_size,
          SUM(LENGTH(content)) as total_tokens
        FROM chunks WHERE strategy = ?
      `).get(strategy);
      result[strategy] = stats || { total_chunks: 0, avg_chunk_size: 0, total_tokens: 0 };
    }
    return result;
  }

  // === Threads ===

  createThread({ title, task_goal, constraints }) {
    const stmt = this.db.prepare(`
      INSERT INTO threads (title, task_goal, constraints)
      VALUES (?, ?, ?)
    `);
    const result = stmt.run(title || 'Новый диалог', task_goal || null, constraints || null);
    return Number(result.lastInsertRowid);
  }

  getThread(id) {
    return this.db.prepare('SELECT * FROM threads WHERE id = ?').get(id);
  }

  getAllThreads(limit = 50) {
    return this.db.prepare(`
      SELECT t.*, (SELECT COUNT(*) FROM messages WHERE thread_id = t.id) as message_count
      FROM threads t
      ORDER BY t.updated_at DESC
      LIMIT ?
    `).all(limit);
  }

  updateThread(id, { title, task_goal, constraints }) {
    const fields = [];
    const params = [];
    if (title !== undefined) { fields.push('title = ?'); params.push(title); }
    if (task_goal !== undefined) { fields.push('task_goal = ?'); params.push(task_goal); }
    if (constraints !== undefined) { fields.push('constraints = ?'); params.push(constraints); }
    if (fields.length === 0) return;
    fields.push("updated_at = CURRENT_TIMESTAMP");
    params.push(id);
    this.db.prepare(`UPDATE threads SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  }

  deleteThread(id) {
    this.db.prepare('DELETE FROM messages WHERE thread_id = ?').run(id);
    this.db.prepare('DELETE FROM task_memory WHERE thread_id = ?').run(id);
    this.db.prepare('DELETE FROM threads WHERE id = ?').run(id);
  }

  clearThreadMessages(id) {
    this.db.prepare('DELETE FROM messages WHERE thread_id = ?').run(id);
    this.db.prepare('UPDATE threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  }

  // === Messages ===

  saveMessage({ thread_id, role, content, sources, citations, confidence_score, has_enough_context, is_dont_know, pipeline }) {
    this.db.prepare(`
      INSERT INTO messages (thread_id, role, content, sources, citations, confidence_score, has_enough_context, is_dont_know, pipeline_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      thread_id,
      role,
      content,
      sources ? JSON.stringify(sources) : null,
      citations ? JSON.stringify(citations) : null,
      confidence_score != null ? confidence_score : null,
      has_enough_context != null ? (has_enough_context ? 1 : 0) : 1,
      is_dont_know ? 1 : 0,
      pipeline || null
    );
    this.db.prepare('UPDATE threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(thread_id);
  }

  getMessagesByThread(thread_id, limit = 100) {
    const rows = this.db.prepare(`
      SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT ?
    `).all(thread_id, limit);
    return rows.map(m => ({
      ...m,
      sources: m.sources ? JSON.parse(m.sources) : null,
      citations: m.citations ? JSON.parse(m.citations) : null,
      pipeline: m.pipeline_json ? JSON.parse(m.pipeline_json) : null,
    }));
  }

  getRecentMessages(thread_id, limit) {
    const rows = limit
      ? this.db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?').all(thread_id, limit)
      : this.db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at DESC').all(thread_id);
    return rows.map(m => ({
      ...m,
      sources: m.sources ? JSON.parse(m.sources) : null,
      citations: m.citations ? JSON.parse(m.citations) : null,
      pipeline: m.pipeline_json ? JSON.parse(m.pipeline_json) : null,
    })).reverse();
  }

  // === Task Memory ===

  setTaskMemory({ thread_id, key, value, type }) {
    this.db.prepare(`
      INSERT OR REPLACE INTO task_memory (thread_id, key, value, type)
      VALUES (?, ?, ?, ?)
    `).run(thread_id, key, value, type);
  }

  getTaskMemory(thread_id) {
    return this.db.prepare('SELECT * FROM task_memory WHERE thread_id = ? ORDER BY created_at ASC').all(thread_id);
  }

  getTaskMemoryByType(thread_id, type) {
    return this.db.prepare('SELECT * FROM task_memory WHERE thread_id = ? AND type = ? ORDER BY created_at ASC').all(thread_id, type);
  }

  deleteTaskMemory(id) {
    this.db.prepare('DELETE FROM task_memory WHERE id = ?').run(id);
  }

  deleteTaskMemoryByKey(thread_id, key) {
    this.db.prepare('DELETE FROM task_memory WHERE thread_id = ? AND key = ?').run(thread_id, key);
  }

  clearTaskMemory(thread_id) {
    this.db.prepare('DELETE FROM task_memory WHERE thread_id = ?').run(thread_id);
  }
}

export const db = new Database();
