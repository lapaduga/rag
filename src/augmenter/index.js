export class Augmenter {
  buildPrompt(question, chunks, mode, options = {}) {
    if (mode === 'rag' && chunks && chunks.length > 0) {
      const contextWithIds = chunks.map((c, idx) => {
        const meta = typeof c.metadata === 'string' ? JSON.parse(c.metadata) : c.metadata;
        return `[SOURCE_${idx}] [Файл: ${c.filename}] [Chunk: ${c.chunk_id}] [Section: ${meta?.section || 'other'}] [Title: ${meta?.title || 'untitled'}]\n${c.content}`;
      }).join('\n\n---\n\n');

      let systemContent = `Ты — ассистент-разработчик для проекта RAG Indexer. Отвечай на основе контекста и данных о проекте.`;

      if (options.mcpTools) {
        systemContent += `

ДОСТУПНЫЕ ИНСТРУМЕНТЫ (вызывай через TOOL_CALL):
${options.mcpTools}

ФОРМАТ ВЫЗОВА:
TOOL_CALL: {"tool": "имя_инструмента", "arguments": {}}

ПРАВИЛА:
- Вызывай инструменты ТОЛЬКО когда данные нужны для ответа и их нет в контексте.
- Один TOOL_CALL в одном ответе.
- После получения результата — ответь пользователю по-русски.
- Не придумывай имена инструментов — используй ТОЛЬКО из списка выше.`;
      }

      if (options.mcpContext) {
        systemContent += `\n\nДАННЫЕ ПРОЕКТА (актуальные):\n${options.mcpContext}`;
      }

      if (options.memoryContext) {
        systemContent += options.memoryContext;
      }

      if (options.historyContext) {
        systemContent += `\n\nИСТОРИЯ ДИАЛОГА:\n${options.historyContext}`;
      }

      systemContent += `

КОНТЕКСТ:
${contextWithIds}

ФОРМАТ ОТВЕТА (строго соблюдай):
1. Сначала дай краткий ответ на вопрос.
2. Затем укажи ЦИТАТЫ из контекста в формате:
   > [SOURCE_N] [Файл: имя_файла] [Chunk: chunk_id]
   > Текст цитаты (можно обрезать, но сохранить смысл)
3. Затем укажи ИСТОЧНИКИ:
   - Файл: имя_файла | Chunk: chunk_id | Релевантность: X%

ПРАВИЛА:
- Отвечай на основе контекста. Если в контексте есть релевантный код — используй его для ответа, даже если нет текстового описания.
- Анализируй паттерны в коде (классы, наследование, импорты, регистрацию элементов) и делай выводы.
- Отвечай "Не знаю" ТОЛЬКО если в контексте нет НИ релевантного кода, НИ текста по теме.
- Цитаты можно обрезать, но нельзя переписывать. Минимум 15 символов.
- Каждая цитата должна содержать [SOURCE_N] ссылку.
- Минимум 1 цитата, максимум 3.

ПРИМЕР ПРАВИЛЬНОГО ОТВЕТА (когда в контексте есть код):
Вопрос: Как создать веб-компонент?
Ответ:
В кодовой базе веб-компоненты создаются через наследование от HTMLElement и регистрацию через customElements.define. Например:

> [SOURCE_0] [Файл: custom.info-about-reactions.js] [Chunk: abc-123]
> class InfoAboutReactionsEl extends HTMLElement {
>   constructor() { super(); }
>   connectedCallback() { this.setHtml(); }
> }

> [SOURCE_1] [Файл: webrtc-user-renderer.js] [Chunk: def-456]
> customElements.define('webrtc-user-renderer2', WebrtcUserRenderer2);

ИСТОЧНИКИ:
- Файл: custom.info-about-reactions.js | Chunk: abc-123 | Релевантность: 85%
- Файл: webrtc-user-renderer.js | Chunk: def-456 | Релевантность: 80%`;

      return [
        { role: 'system', content: systemContent },
        { role: 'user', content: `Вопрос: ${question}` }
      ];
    }

    let systemContent = 'Ты — ассистент. Ответь на вопрос на русском языке.';

    if (options.mcpTools) {
      systemContent += `

ДОСТУПНЫЕ ИНСТРУМЕНТЫ (вызывай через TOOL_CALL):
${options.mcpTools}

ФОРМАТ ВЫЗОВА:
TOOL_CALL: {"tool": "имя_инструмента", "arguments": {}}

ПРАВИЛА:
- Вызывай инструменты когда данные нужны для ответа.
- Один TOOL_CALL в одном ответе.
- После получения результата — ответь пользователю по-русски.
- Не придумывай имена инструментов — используй ТОЛЬКО из списка выше.`;
    }

    if (options.mcpContext) {
      systemContent += `\n\nДАННЫЕ ПРОЕКТА (актуальные):\n${options.mcpContext}`;
    }

    return [
      { role: 'system', content: systemContent },
      { role: 'user', content: `Вопрос: ${question}` }
    ];
  }
}
