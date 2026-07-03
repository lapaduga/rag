export class Reranker {
  constructor(options = {}) {
    this.model = null;
    this.tokenizer = null;
    this.modelName = options.model || 'Xenova/ms-marco-MiniLM-L-6-v2';
  }

  async rerank(query, chunks) {
    if (chunks.length === 0) return chunks;

    const { AutoTokenizer, AutoModelForSequenceClassification } = await import('@xenova/transformers');

    if (!this.tokenizer) {
      this.tokenizer = await AutoTokenizer.from_pretrained(this.modelName);
    }
    if (!this.model) {
      this.model = await AutoModelForSequenceClassification.from_pretrained(this.modelName);
    }

    const q = String(query);
    const docs = chunks.map(c => String(c.content || ''));
    const queries = Array(docs.length).fill(q);

    const inputs = await this.tokenizer(queries, { text_pair: docs, padding: true, truncation: true });
    const outputs = await this.model(inputs);

    const scores = [];
    for (const logits of outputs.logits) {
      const data = Array.from(logits.data);
      const exp0 = Math.exp(data[0]);
      const exp1 = Math.exp(data[1]);
      scores.push(exp1 / (exp0 + exp1));
    }

    return chunks.map((chunk, i) => ({
      ...chunk,
      rerankScore: scores[i] ?? 0,
      combinedScore: 0.4 * (chunk.similarity || 0) + 0.6 * (scores[i] ?? 0)
    })).sort((a, b) => b.combinedScore - a.combinedScore);
  }
}
