// Reranker module — placeholder for future implementation
// Will be activated when RERANKER_ENABLED=true in config

export class Reranker {
  constructor() {
    this.enabled = false;
  }

  async rerank(query, chunks) {
    // Placeholder: returns chunks as-is
    return chunks;
  }
}
