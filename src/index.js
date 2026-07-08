import express from 'express';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { db } from './storage/db.js';
import routes from './api/routes.js';
import { errorHandler, notFoundHandler } from './api/middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

app.use(express.json({ limit: '50mb' }));

const publicDir = resolve(__dirname, 'public');
app.use(express.static(publicDir, {
  index: false,
  maxAge: 0,
  etag: false,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

app.use('/api', routes);

let cachedHtml = '';
try {
  const html = readFileSync(resolve(publicDir, 'index.html'), 'utf-8');
  const js = readFileSync(resolve(publicDir, 'app.js'), 'utf-8');
  const css = readFileSync(resolve(publicDir, 'styles.css'), 'utf-8');
  const hash = createHash('md5').update(js + css).digest('hex').slice(0, 8);
  cachedHtml = html.replace(/\?__v__/g, `?v=${hash}`);
} catch (e) {
  console.error('[FATAL] Failed to read static files:', e.message);
  process.exit(1);
}

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(cachedHtml);
});

app.use(notFoundHandler);
app.use(errorHandler);

function gracefulShutdown() {
  console.log('\n[SHUTDOWN] Closing database...');
  db.close();
  process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('uncaughtException', (err) => {
  console.error('[FATAL]', err);
  gracefulShutdown();
});

try {
  db.open();
  db.migrate();
  console.log(`[DB] SQLite ready at ${config.db.path}`);

  app.listen(config.port, config.host, async () => {
    console.log(`[SERVER] RAG Indexer running at http://${config.host}:${config.port}`);
    console.log(`[CONFIG] Documents path: ${config.documents.path}`);
    console.log(`[CONFIG] Embedding model: ${config.embeddings.model}`);
    console.log(`[CONFIG] LLM provider: ${config.provider} (local model: ${config.localLlm.model}, cloud model: ${config.chat.model})`);

    if (config.provider === 'local') {
      try {
        const res = await fetch('http://localhost:11434/api/tags');
        const ok = await res.json();
        console.log(`[OLLAMA] ${ok ? 'Connected' : 'Not available'} — ${config.localLlm.model}`);
      } catch {
        console.log('[OLLAMA] Not running. Start with: ollama serve');
        console.log('[OLLAMA] Then pull model: ollama pull ' + config.localLlm.model);
      }
    }
  });
} catch (err) {
  console.error('[FATAL] Failed to start:', err);
  process.exit(1);
}
