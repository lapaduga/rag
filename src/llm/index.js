import { config } from '../config.js';

const RAG_KEYWORDS = [
  'код', 'функция', 'файл', 'класс', 'компонент', 'баг', 'ошибка',
  'как работает', 'где находится', 'что делает', 'import', 'export',
  'const', 'function', 'return', 'async', 'await', 'useState', 'useEffect',
  'props', 'state', 'render', 'jsx', 'tsx', 'css', 'style', 'html',
  'api', 'endpoint', 'route', 'middleware', 'database', 'sql', 'query',
  'schema', 'migration', 'index', 'chunk', 'embedding', 'vector',
  'similarity', 'rag', 'retriever', 'prompt', 'llm', 'model', 'token',
  'context', 'window', 'temperature', 'completion', 'chat', 'message',
  'system', 'user', 'assistant', 'role', 'content'
];

const NO_RAG_KEYWORDS = [
  'привет', 'как дела', 'спасибо', 'пока', 'до свидания',
  'хорошего дня', 'как тебя зовут', 'кто ты', 'что ты умеешь',
  'помоги', 'помощь', 'help', 'general', 'общий вопрос',
  'не знаю', 'не понимаю', 'объясни', 'расскажи', 'пример',
  'tutorial', 'гайд', 'руководство', 'документация', 'введение',
  'overview', 'summary', 'итог', 'вывод', 'заключение'
];

export class LlmClient {
  constructor() {
    this.apiKey = config.chat.apiKey;
    this.model = config.chat.model;
    this.baseUrl = config.chat.baseUrl;
  }

  async chat(messages, options = {}) {
    const temperature = options.temperature != null ? options.temperature : 0.3;
    const maxTokens = options.maxTokens || 2000;
    const start = Date.now();

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature,
        max_tokens: maxTokens,
      })
    });

    const data = await res.json();
    const timing = Date.now() - start;

    if (!res.ok) {
      throw new Error(`LLM API error (${res.status}): ${data.error?.message || JSON.stringify(data)}`);
    }

    return {
      answer: data.choices?.[0]?.message?.content || '',
      usage: data.usage || {},
      timing_ms: timing,
    };
  }

  _hasCyrillic(text) {
    return /[а-яё]/i.test(text);
  }

  async translateQuery(text) {
    const res = await this.chat([
      { role: 'system', content: 'Translate the user\'s question to English. Reply ONLY with the translation, no explanations.' },
      { role: 'user', content: text },
    ], { temperature: 0, maxTokens: 100 });
    return res.answer.trim();
  }

  async chatWithRag(question, retriever, augmenter, mode, options = {}) {
    const start = Date.now();
    const llmOpts = {
      temperature: options.temperature || 0.3,
      maxTokens: options.maxTokens || 2000,
    };
    const topK = options.topK || config.rag.topK;
    const threshold = options.threshold != null ? options.threshold : config.rag.similarityThreshold;

    let actualMode = mode;
    let chunks = [];
    const needsTranslation = this._hasCyrillic(question);
    const searchQuery = needsTranslation ? await this.translateQuery(question) : question;
    const searchOpts = { topK, threshold };
    if (needsTranslation) {
      searchOpts.additionalQueries = [question];
    }

    if (mode === 'auto') {
      actualMode = this._detectMode(question);
      if (actualMode === 'rag') {
        chunks = await retriever.search(searchQuery, searchOpts);
        if (chunks.length === 0) actualMode = 'no-rag';
      }
    } else if (mode === 'rag') {
      chunks = await retriever.search(searchQuery, searchOpts);
    }

    const messages = augmenter.buildPrompt(question, chunks, actualMode);
    const result = await this.chat(messages, llmOpts);

    return {
      answer: result.answer,
      mode: actualMode,
      searchQuery,
      needsTranslation,
      sources: chunks.map(c => ({
        chunk_id: c.chunk_id,
        filename: c.filename,
        content: c.content.slice(0, 300),
        similarity: c.similarity,
        keywords_matched: (c._keywordScore?.matched || 0) + (c._contentKwMatches || 0),
      })),
      timing: {
        total: Date.now() - start,
        llm: result.timing_ms,
      },
      usage: result.usage,
    };
  }

  _detectMode(question) {
    const q = question.toLowerCase();

    for (const kw of NO_RAG_KEYWORDS) {
      if (q.includes(kw)) return 'no-rag';
    }

    for (const kw of RAG_KEYWORDS) {
      if (q.includes(kw)) return 'rag';
    }

    return 'no-rag';
  }
}
