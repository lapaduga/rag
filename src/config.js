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
    maxFileSizeBytes: 10 * 1024 * 1024,
    maxFiles: process.env.MAX_FILES ? parseInt(process.env.MAX_FILES, 10) : 0,
  },

  embeddings: {
    model: process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2',
    dimension: parseInt(process.env.EMBEDDING_DIMENSION, 10) || 384,
    batchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE, 10) || 20,
  },

  chunking: {
    chunkSize: parseInt(process.env.CHUNK_SIZE, 10) || 250,
    overlap: parseInt(process.env.CHUNK_OVERLAP, 10) || 30,
    fixedCharSize: parseInt(process.env.CHUNK_SIZE, 10) || 1000,
    fixedCharOverlap: parseInt(process.env.CHUNK_OVERLAP, 10) || 100,
  },

  provider: process.env.LLM_PROVIDER || 'deepseek',

  chat: {
    apiKey: process.env.CHAT_API_KEY || process.env.EMBEDDING_API_KEY || '',
    model: process.env.CHAT_MODEL || 'deepseek-chat',
    baseUrl: process.env.CHAT_BASE_URL || 'https://api.deepseek.com',
  },

  localLlm: {
    model: process.env.LOCAL_MODEL || 'qwen2.5:3b',
    baseUrl: process.env.LOCAL_BASE_URL || 'http://localhost:11434/v1',
    numThreads: parseInt(process.env.LOCAL_NUM_THREADS, 10) || 4,
    numGpu: parseInt(process.env.LOCAL_NUM_GPU, 10) || 0,
  },

  reranker: {
    enabled: process.env.RERANKER_ENABLED === 'true',
    model: process.env.RERANKER_MODEL || 'Xenova/ms-marco-MiniLM-L-6-v2',
    threshold: parseFloat(process.env.RERANKER_THRESHOLD) || 0.5,
  },

  pipeline: {
    queryRewrite: process.env.PIPELINE_QUERY_REWRITE === 'true',
    reranker: process.env.PIPELINE_RERANKER === 'true',
    threshold: process.env.PIPELINE_THRESHOLD ? parseFloat(process.env.PIPELINE_THRESHOLD) : undefined,
    topKBefore: parseInt(process.env.PIPELINE_TOP_K_BEFORE, 10) || 20,
    topKAfter: parseInt(process.env.PIPELINE_TOP_K_AFTER, 10) || 5,
    minConfidence: parseFloat(process.env.PIPELINE_MIN_CONFIDENCE) || 0.25,
    maxHistoryMessages: parseInt(process.env.PIPELINE_MAX_HISTORY, 10) || 0,
    memoryExtractionEnabled: process.env.PIPELINE_MEMORY_EXTRACTION === 'true',
  },

  rag: {
    topK: parseInt(process.env.RAG_TOP_K, 10) || 15,
    similarityThreshold: parseFloat(process.env.RAG_SIMILARITY_THRESHOLD) || 0.3,
    maxTokens: parseInt(process.env.RAG_MAX_TOKENS, 10) || 2000,
    temperature: parseFloat(process.env.RAG_TEMPERATURE) || 0.3,
    autoEnabled: process.env.RAG_AUTO_ENABLED !== 'false',
  },
};
