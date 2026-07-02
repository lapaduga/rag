import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  host: process.env.HOST || '0.0.0.0',

  db: {
    path: process.env.DB_PATH || resolve(__dirname, '..', 'data', 'rag-indexer.db'),
  },

  documents: {
    path: process.env.DOCUMENTS_PATH || 'C:\\defined\\front',
    allowedExtensions: ['.md', '.txt', '.js', '.ts', '.jsx', '.tsx', '.css', '.html', '.json'],
    ignoreDirs: ['node_modules', '.git', 'dist', 'build', 'coverage', '.nyc_output', '__pycache__'],
    maxFileSizeBytes: 1 * 1024 * 1024,
    maxFiles: parseInt(process.env.MAX_FILES, 10) || 100,
  },

  embeddings: {
    apiKey: process.env.EMBEDDING_API_KEY || '',
    apiUrl: process.env.EMBEDDING_API_URL || 'https://api.openai.com/v1/embeddings',
    model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    dimension: parseInt(process.env.EMBEDDING_DIMENSION, 10) || 1536,
    batchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE, 10) || 20,
    retryAttempts: 3,
    retryBackoffMs: 1000,
  },

  chunking: {
    chunkSize: parseInt(process.env.CHUNK_SIZE, 10) || 500,
    overlap: parseInt(process.env.CHUNK_OVERLAP, 10) || 50,
    fixedCharSize: 2000,
    fixedCharOverlap: 200,
  },

  chat: {
    apiKey: process.env.CHAT_API_KEY || process.env.EMBEDDING_API_KEY || '',
    model: process.env.CHAT_MODEL || 'deepseek-chat',
    baseUrl: process.env.CHAT_BASE_URL || 'https://api.deepseek.com',
  },

  reranker: {
    enabled: process.env.RERANKER_ENABLED === 'true',
    model: process.env.RERANKER_MODEL || 'rerank-model',
    threshold: parseFloat(process.env.RERANKER_THRESHOLD) || 0.5,
  },
};
