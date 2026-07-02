import { readFileSync, statSync } from 'fs';
import { readdirSync } from 'fs';
import { extname, join, relative, resolve } from 'path';
import { config } from '../config.js';
import { db } from '../storage/db.js';
import { Chunker } from './chunker.js';
import { Embedder } from './embedder.js';
import { MetadataExtractor } from './metadata.js';

export class Indexer {
  constructor() {
    this.chunker = null;
    this.embedder = new Embedder();
    this.metadata = new MetadataExtractor();
    this.status = { running: false, lastRun: null, totalFiles: 0, processedFiles: 0, errors: [] };
  }

  getStatus() {
    return this.status;
  }

  async runIndexing(rootPath, strategy = 'fixed') {
    if (this.status.running) {
      throw new Error('Индексация уже выполняется');
    }

    this.status = { running: true, lastRun: null, totalFiles: 0, processedFiles: 0, errors: [], strategy };
    this.chunker = new Chunker(strategy);

    try {
      const files = this._scanFiles(rootPath);
      this.status.totalFiles = files.length;

      for (const file of files) {
        try {
          await this._indexFile(file);
        } catch (err) {
          this.status.errors.push({ file, error: err.message });
        }
        this.status.processedFiles++;
      }

      this.status.running = false;
      this.status.lastRun = new Date().toISOString();
      return this.status;
    } catch (err) {
      this.status.running = false;
      this.status.lastRun = new Date().toISOString();
      throw err;
    }
  }

  async runComparison(rootPath) {
    const strategies = ['fixed', 'semantic'];
    const results = {};

    for (const strategy of strategies) {
      this.chunker = new Chunker(strategy);
      const files = this._scanFiles(rootPath);
      let totalChunks = 0;
      let totalSize = 0;

      for (const file of files) {
        try {
          const content = readFileSync(file, 'utf-8');
          const meta = this.metadata.extract(file, content);
          const chunks = this.chunker.chunk(content, meta);

          for (const chunk of chunks) {
            totalChunks++;
            totalSize += chunk.content.length;
          }
        } catch {
        }
      }

      results[strategy] = {
        total_chunks: totalChunks,
        avg_chunk_size: totalChunks > 0 ? Math.round(totalSize / totalChunks) : 0,
        total_tokens: totalSize,
      };
    }

    return results;
  }

  _scanFiles(rootPath) {
    const files = [];
    const allowedExt = config.documents.allowedExtensions;
    const ignoreDirs = config.documents.ignoreDirs;

    const maxFiles = config.documents.maxFiles;

    const scan = (dir) => {
      if (files.length >= maxFiles) return;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (files.length >= maxFiles) break;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!ignoreDirs.includes(entry.name)) {
            scan(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (allowedExt.includes(ext)) {
            try {
              const stat = statSync(fullPath);
              if (stat.size <= config.documents.maxFileSizeBytes) {
                files.push(fullPath);
              }
            } catch {
            }
          }
        }
      }
    };

    scan(rootPath);
    return files;
  }

  async _indexFile(filePath) {
    const content = readFileSync(filePath, 'utf-8');
    const meta = this.metadata.extract(filePath, content);
    const chunks = this.chunker.chunk(content, meta);

    if (chunks.length === 0) return;

    const docId = db.insertDocument({
      path: filePath,
      filename: meta.filename,
      extension: meta.extension,
      content,
      size_bytes: Buffer.byteLength(content, 'utf-8'),
    });

    for (const chunk of chunks) {
      chunk.document_id = docId;
    }

    try {
      const texts = chunks.map(c => c.content);
      const embeddings = await this.embedder.generateEmbeddings(texts);
      for (let i = 0; i < chunks.length; i++) {
        chunks[i].embedding = JSON.stringify(embeddings[i]);
      }
    } catch (err) {
      console.warn(`[WARN] Embedding failed for ${filePath}: ${err.message}`);
    }

    db.insertChunks(chunks);
  }
}
