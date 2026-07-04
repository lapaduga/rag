export class Reranker {
  constructor(options = {}) {
    this.model = null;
    this.tokenizer = null;
    this.modelName = options.model || 'Xenova/ms-marco-MiniLM-L-6-v2';
  }

  async rerank(query, chunks, batchSize = 20) {
    if (chunks.length === 0) return chunks;

    const { AutoTokenizer, AutoModelForSequenceClassification } = await import('@xenova/transformers');

    if (!this.tokenizer) {
      this.tokenizer = await AutoTokenizer.from_pretrained(this.modelName);
    }
    if (!this.model) {
      this.model = await AutoModelForSequenceClassification.from_pretrained(this.modelName);
    }

    const q = String(query);
    const scores = [];

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const docs = batch.map(c => String(c.content || ''));
      const queries = Array(docs.length).fill(q);

      const inputs = await this.tokenizer(queries, { text_pair: docs, padding: true, truncation: true });
      const outputs = await this.model(inputs);

      for (const logits of outputs.logits) {
        const data = Array.from(logits.data);
        const score = 1 / (1 + Math.exp(-data[0]));
        scores.push(score);
      }
    }

    const maxScore = scores.length > 0 ? Math.max(...scores) : 1;
    const minScore = scores.length > 0 ? Math.min(...scores) : 0;
    const range = maxScore - minScore || 1;

    return chunks.map((chunk, i) => {
      const normalized = (scores[i] - minScore) / range;
      return {
        ...chunk,
        rerankScore: normalized,
        combinedScore: 0.4 * (chunk.similarity || 0) + 0.6 * normalized
      };
    }).sort((a, b) => b.combinedScore - a.combinedScore);
  }
}
