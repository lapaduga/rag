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
  constructor(provider) {
    this.provider = provider || config.provider || 'deepseek';

    if (this.provider === 'local') {
      this.apiKey = '';
      this.model = config.localLlm.model;
      this.baseUrl = config.localLlm.baseUrl;
      this.numThreads = config.localLlm.numThreads;
      this.numGpu = config.localLlm.numGpu;
    } else {
      this.apiKey = config.chat.apiKey;
      this.model = config.chat.model;
      this.baseUrl = config.chat.baseUrl;
    }
  }

  async chat(messages, options = {}) {
    const temperature = options.temperature != null ? options.temperature : 0.3;
    const maxTokens = options.maxTokens || 2000;
    const start = Date.now();

    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const body = {
      model: this.model,
      messages,
      temperature,
      max_tokens: maxTokens,
    };

    if (this.provider === 'local') {
      body.options = {
        num_thread: this.numThreads,
        num_gpu: this.numGpu,
      };
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
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

  async checkHealth() {
    if (this.provider === 'local') {
      try {
        const res = await fetch('http://localhost:11434/api/tags');
        return { available: res.ok };
      } catch {
        return { available: false, error: 'Ollama не запущен. Запустите: ollama serve' };
      }
    }
    return { available: true };
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
