import express from 'express';
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
app.use(express.static(resolve(__dirname, 'public')));

app.use('/api', routes);

app.get('/', (req, res) => {
  res.sendFile(resolve(__dirname, 'public', 'index.html'));
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

  app.listen(config.port, config.host, () => {
    console.log(`[SERVER] RAG Indexer running at http://${config.host}:${config.port}`);
    console.log(`[CONFIG] Documents path: ${config.documents.path}`);
    console.log(`[CONFIG] Embedding model: ${config.embeddings.model}`);
  });
} catch (err) {
  console.error('[FATAL] Failed to start:', err);
  process.exit(1);
}
