import { readFileSync, statSync } from 'fs';
import { readdir } from 'fs/promises';
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

    this.status = { running: true, phase: 'scanning', message: 'Сканирование файлов...', lastRun: null, totalFiles: 0, processedFiles: 0, errors: [], strategy };
    this.chunker = new Chunker(strategy);

    try {
      const files = await this._scanFiles(rootPath);
      this.status.totalFiles = files.length;
      this.status.phase = 'indexing';
      this.status.message = `Индексация ${files.length} файлов...`;

      for (const file of files) {
        try {
          this.status.message = `Обработка: ${file.split(/[/\\]/).pop()}`;
          await this._indexFile(file);
        } catch (err) {
          this.status.errors.push({ file, error: err.message });
        }
        this.status.processedFiles++;
      }

      this.status.running = false;
      this.status.phase = 'done';
      this.status.message = `Индексация завершена: ${files.length} файлов`;
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
      const files = await this._scanFiles(rootPath);
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

  async _scanFiles(rootPath) {
    const files = [];
    const allowedExt = config.documents.allowedExtensions;
    const maxFiles = config.documents.maxFiles;
    const gitignoreRules = this._loadGitignoreRules(rootPath);
    let dirCount = 0;

    const scan = async (dir) => {
      if (files.length >= maxFiles) return;
      dirCount++;
      if (dirCount % 25 === 0) {
        this.status.message = `Сканирование: ${dir.replace(/\\/g, '/').split('/').slice(-2).join('/')}`;
        await new Promise(r => setImmediate(r));
      }
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (files.length >= maxFiles) break;
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          if (!this._isIgnored(entry.name, fullPath, true, gitignoreRules)) {
            await scan(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (!allowedExt.includes(ext)) continue;
          if (this._isIgnored(entry.name, fullPath, false, gitignoreRules)) continue;
          try {
            const stat = statSync(fullPath);
            if (stat.size <= config.documents.maxFileSizeBytes) {
              files.push(fullPath);
            }
          } catch {
          }
        }
      }
    };

    await scan(rootPath);
    return files;
  }

  _loadGitignoreRules(rootPath) {
    try {
      const gitignorePath = join(rootPath, '.gitignore');
      const content = readFileSync(gitignorePath, 'utf-8');
      const rules = [];
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const negate = trimmed.startsWith('!');
        const pattern = negate ? trimmed.slice(1).trim() : trimmed;
        const dirOnly = pattern.endsWith('/');
        const cleanPattern = dirOnly ? pattern.slice(0, -1) : pattern;
        const anchored = cleanPattern.startsWith('/');
        const matchPattern = anchored ? cleanPattern.slice(1) : cleanPattern;
        rules.push({ pattern: matchPattern, negate, dirOnly, anchored });
      }
      return rules;
    } catch {
      return [];
    }
  }

  _isIgnored(name, fullPath, isDir, rules) {
    const ignoreDirs = config.documents.ignoreDirs;
    if (isDir && ignoreDirs.includes(name)) return true;

    let ignored = false;
    for (const rule of rules) {
      if (rule.dirOnly && !isDir) continue;
      if (rule.negate) {
        if (this._matchGitignorePattern(name, fullPath, rule)) ignored = false;
      } else {
        if (this._matchGitignorePattern(name, fullPath, rule)) ignored = true;
      }
    }
    return ignored;
  }

  _matchGitignorePattern(name, fullPath, rule) {
    const { pattern, anchored } = rule;

    if (pattern === name) return true;

    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      if (regex.test(name)) return true;
      if (!anchored && regex.test(name)) return true;
    }

    if (!anchored && fullPath.replace(/\\/g, '/').includes('/' + pattern)) return true;

    return false;
  }

  async _indexFile(filePath) {
    const shortName = filePath.split(/[/\\]/).pop();
    console.log(`[INDEX] ${shortName}...`);
    let content;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch (err) {
      console.warn(`[SKIP] ${shortName}: ${err.message}`);
      return;
    }
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

    db.deleteChunksByDocument(docId);

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
