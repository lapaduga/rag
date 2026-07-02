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
    for (let i = 0; i < texts.length; i++) {
      const result = await pipe(texts[i], { pooling: 'mean', normalize: true });
      results.push(Array.from(result.data));
      if (i % 3 === 0) {
        await new Promise(r => setImmediate(r));
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
