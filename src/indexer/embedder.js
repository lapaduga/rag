import { config } from '../config.js';

export class Embedder {
  constructor() {
    this.pipeline = null;
    this.modelName = 'Xenova/all-MiniLM-L6-v2';
  }

  async generateEmbedding(text) {
    const pipe = await this._getPipeline();
    const result = await pipe(text, { pooling: 'mean', normalize: true });
    return Array.from(result.data);
  }

  async generateEmbeddings(texts) {
    const pipe = await this._getPipeline();
    const results = [];
    for (let i = 0; i < texts.length; i += config.embeddings.batchSize) {
      const batch = texts.slice(i, i + config.embeddings.batchSize);
      const result = await pipe(batch, { pooling: 'mean', normalize: true });
      for (let j = 0; j < batch.length; j++) {
        const start = j * result.dims[1];
        const end = start + result.dims[1];
        results.push(Array.from(result.data.slice(start, end)));
      }
    }
    return results;
  }

  async _getPipeline() {
    if (!this.pipeline) {
      const { pipeline } = await import('@xenova/transformers');
      this.pipeline = await pipeline('feature-extraction', this.modelName);
    }
    return this.pipeline;
  }
}
