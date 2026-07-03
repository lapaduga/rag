export class Reranker {
  constructor(options = {}) {
    this.model = null;
    this.modelName = options.model || 'Xenova/ms-marco-MiniLM-L-6-v2';
    this.cache = new Map();
  }

  async rerank(query, chunks) {
    if (chunks.length === 0) return chunks;

    const pipe = await this._getPipeline();
    const pairs = chunks.map(c => [query, c.content]);
    const scores = await pipe(pairs);

    return chunks.map((chunk, i) => ({
      ...chunk,
      rerankScore: scores[i]?.score ?? 0,
      combinedScore: 0.4 * (chunk.similarity || 0) + 0.6 * (scores[i]?.score ?? 0)
    })).sort((a, b) => b.combinedScore - a.combinedScore);
  }

  async _getPipeline() {
    if (!this.model) {
      const { pipeline } = await import('@xenova/transformers');
      this.model = await pipeline('text-classification', this.modelName);
    }
    return this.model;
  }
}
