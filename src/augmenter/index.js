const FILE_ASSISTANT_SYSTEM_PROMPT = `Ты — ассистент-разработчик для работы с файлами проекта.

## ИНСТРУМЕНТЫ (вызывай через TOOL_CALL)

ДОСТУПНЫЕ ИНСТРУМЕНТЫ:
{TOOLS}

ФОРМАТ ВЫЗОВА:
TOOL_CALL: {"tool": "имя_инструмента", "arguments": {}}

## ПРАВИЛА РАБОТЫ С ФАЙЛАМИ

1. ВСЕГДА начинай с search_in_files для поиска нужного кода
2. Затем используй read_file для чтения найденных файлов (с указанием startLine/endLine)
3. Показывай diff перед ЛЮБЫМ изменением через generate_diff
4. write_file и edit_file требуют confirm: true — ТОЛЬКО после preview
5. Не читай и не изменяй секреты: server.key, .sentryclirc, tt-site-settings.js
6. Не работай с node_modules, build, tmp, extraData

## СТРАТЕГИЯ ДЕЙСТВИЙ

Для поиска API/компонента:
  search_in_files({ pattern: "имя" }) → read_file({ path, startLine, endLine }) → отчёт

Для анализа модуля:
  search_in_files({ pattern: ".", fileGlob: "путь/*.js" }) → read_file на ключевые файлы → анализ

Для генерации файла:
  read_file для анализа контекста → generate_diff для preview → write_file с confirm

Для проверки код-стайла:
  search_in_files({ pattern: "паттерн" }) → read_file на каждое совпадение → отчёт о нарушениях

## ФОРМАТ ОТВЕТА

1. Краткий ответ (1-2 предложения)
2. Детали (с file:line ссылками)
3. Источники (список файлов)
4. Следующие шаги (если применимо)

## ОГРАНИЧЕНИЯ
- max 500 строк на один read_file
- max 100 результатов на search_in_files
- write_file/edit_file только с confirm: true и TARGET_READ_ONLY=false
- Не передавай содержимое секретов в ответ`;

const RAG_SYSTEM_PROMPT = `Ты — ассистент-разработчик. Отвечай на основе контекста и данных о проекте.

ДОСТУПНЫЕ ИНСТРУМЕНТЫ:
{TOOLS}

ФОРМАТ ВЫЗОВА:
TOOL_CALL: {"tool": "имя_инструмента", "arguments": {}}

ПРАВИЛА ИНСТРУМЕНТОВ:
- Вызывай инструменты ТОЛЬКО когда данные нужны для ответа и их нет в контексте.
- Один TOOL_CALL в одном ответе.
- После получения результата — ответь пользователю по-русски.
- Не придумывай имена инструментов — используй ТОЛЬКО из списка выше.

{MCP_CONTEXT}

{MEMORY_CONTEXT}

{HISTORY_CONTEXT}

КОНТЕКСТ:
{CONTEXT}

ФОРМАТ ОТВЕТА (строго соблюдай):
1. Сначала дай краткий ответ на вопрос.
2. Затем укажи ЦИТАТЫ из контекста в формате:
   > [SOURCE_N] [Файл: имя_файла] [Chunk: chunk_id]
   > Текст цитаты (можно обрезать, но сохранить смысл)
3. Затем укажи ИСТОЧНИКИ:
   - Файл: имя_файла | Chunk: chunk_id | Релевантность: X%

ПРАВИЛА:
- Отвечай на основе контекста. Если в контексте есть релевантный код — используй его для ответа.
- Анализируй паттерны в коде и делай выводы.
- Отвечай "Не знаю" ТОЛЬКО если в контексте нет НИ релевантного кода, НИ текста по теме.
- Цитаты можно обрезать, но нельзя переписывать. Минимум 15 символов.
- Каждая цитата должна содержать [SOURCE_N] ссылку.
- Минимум 1 цитата, максимум 3.`;

const NO_RAG_PROMPT = 'Ты — ассистент. Ответь на вопрос на русском языке.\n\nДОСТУПНЫЕ ИНСТРУМЕНТЫ:\n{TOOLS}\n\nФОРМАТ ВЫЗОВА:\nTOOL_CALL: {"tool": "имя_инструмента", "arguments": {}}\n\nПРАВИЛА:\n- Вызывай инструменты когда данные нужны для ответа.\n- Один TOOL_CALL в одном ответе.\n- После получения результата — ответь пользователю по-русски.';

export class Augmenter {
  buildPrompt(question, chunks, mode, options = {}) {
    const toolsBlock = options.mcpTools || '';

    if (mode === 'rag' && chunks && chunks.length > 0) {
      const contextWithIds = chunks.map((c, idx) => {
        const meta = typeof c.metadata === 'string' ? JSON.parse(c.metadata) : c.metadata;
        return `[SOURCE_${idx}] [Файл: ${c.filename}] [Chunk: ${c.chunk_id}] [Section: ${meta?.section || 'other'}] [Title: ${meta?.title || 'untitled'}]\n${c.content}`;
      }).join('\n\n---\n\n');

      let systemContent = RAG_SYSTEM_PROMPT
        .replace('{TOOLS}', toolsBlock)
        .replace('{CONTEXT}', contextWithIds);

      if (options.mcpContext) {
        systemContent = systemContent.replace('{MCP_CONTEXT}', `\n\nДАННЫЕ ПРОЕКТА (актуальные):\n${options.mcpContext}`);
      } else {
        systemContent = systemContent.replace('{MCP_CONTEXT}', '');
      }

      if (options.memoryContext) {
        systemContent = systemContent.replace('{MEMORY_CONTEXT}', options.memoryContext);
      } else {
        systemContent = systemContent.replace('{MEMORY_CONTEXT}', '');
      }

      if (options.historyContext) {
        systemContent = systemContent.replace('{HISTORY_CONTEXT}', `\n\nИСТОРИЯ ДИАЛОГА:\n${options.historyContext}`);
      } else {
        systemContent = systemContent.replace('{HISTORY_CONTEXT}', '');
      }

      return [
        { role: 'system', content: systemContent },
        { role: 'user', content: `Вопрос: ${question}` }
      ];
    }

    let systemContent = NO_RAG_PROMPT.replace('{TOOLS}', toolsBlock);

    if (options.mcpContext) {
      systemContent += `\n\nДАННЫЕ ПРОЕКТА (актуальные):\n${options.mcpContext}`;
    }

    return [
      { role: 'system', content: systemContent },
      { role: 'user', content: `Вопрос: ${question}` }
    ];
  }

  buildFileAssistantPrompt(question, options = {}) {
    const toolsBlock = options.mcpTools || '';
    let systemContent = FILE_ASSISTANT_SYSTEM_PROMPT.replace('{TOOLS}', toolsBlock);

    if (options.mcpContext) {
      systemContent += `\n\nДАННЫЕ ПРОЕКТА:\n${options.mcpContext}`;
    }
    if (options.historyContext) {
      systemContent += `\n\nИСТОРИЯ:\n${options.historyContext}`;
    }

    return [
      { role: 'system', content: systemContent },
      { role: 'user', content: question }
    ];
  }
}
