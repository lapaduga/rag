// TODO: Day 23 — Implement reranker
// Will use RERANKER_MODEL and RERANKER_THRESHOLD from config
// Expected API: rerank(query, chunks) => sorted chunks with scores
export class Reranker {
  constructor() {
    this.enabled = false;
  }

  async rerank(query, chunks) {
    // TODO: Implement reranking logic
    return chunks;
  }
}
