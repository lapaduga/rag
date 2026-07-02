import { config } from '../config.js';

export class Embedder {
  constructor() {
    this.apiKey = config.embeddings.apiKey;
    this.apiUrl = config.embeddings.apiUrl;
    this.model = config.embeddings.model;
    this.batchSize = config.embeddings.batchSize;
    this.retryAttempts = config.embeddings.retryAttempts;
    this.retryBackoffMs = config.embeddings.retryBackoffMs;
  }

  async generateEmbedding(text) {
    return this._embedWithRetry(text, 0);
  }

  async generateEmbeddings(texts) {
    const results = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const batchResults = await Promise.all(batch.map(t => this.generateEmbedding(t)));
      results.push(...batchResults);
    }
    return results;
  }

  async _embedWithRetry(text, attempt) {
    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          input: text,
          model: this.model,
        }),
      });

      if (!response.ok) {
        throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.data[0].embedding;
    } catch (err) {
      if (attempt < this.retryAttempts - 1) {
        const delay = this.retryBackoffMs * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this._embedWithRetry(text, attempt + 1);
      }
      throw err;
    }
  }
}
