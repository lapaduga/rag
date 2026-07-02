import BetterSqlite3 from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
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
    const migrationPath = resolve(__dirname, 'migrations', '001_init.sql');
    const sql = readFileSync(migrationPath, 'utf-8');
    this.db.exec(sql);
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
      embedding: typeof c.embedding === 'string' ? JSON.parse(c.embedding) : c.embedding,
    }));
  }

  saveQuery({ question, mode, answer, sources, latency_ms }) {
    this.db.prepare(`
      INSERT INTO queries (question, mode, answer, sources, latency_ms)
      VALUES (?, ?, ?, ?, ?)
    `).run(question, mode, answer, JSON.stringify(sources), latency_ms);
  }

  getQueries(limit = 50) {
    return this.db.prepare('SELECT * FROM queries ORDER BY created_at DESC LIMIT ?').all(limit);
  }

  getQueriesByMode(mode) {
    return this.db.prepare('SELECT * FROM queries WHERE mode = ? ORDER BY created_at DESC').all(mode);
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
}

export const db = new Database();
