export class ContextWindow {
  constructor(options = {}) {
    this.maxTokens = options.maxTokens || 6000;
    this.maxMessages = options.maxMessages || 20;
  }

  buildMessages({ systemPrompt, memoryContext, history, currentQuestion }) {
    const messages = [];

    let systemContent = systemPrompt;
    if (memoryContext) {
      systemContent += memoryContext;
    }
    messages.push({ role: 'system', content: systemContent });

    const recentHistory = history.slice(-this.maxMessages);
    for (const msg of recentHistory) {
      messages.push({ role: msg.role, content: msg.content });
    }

    messages.push({ role: 'user', content: `Вопрос: ${currentQuestion}` });

    return messages;
  }

  estimateTokens(messages) {
    return messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
  }
}
