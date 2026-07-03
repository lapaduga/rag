export class Augmenter {
  buildPrompt(question, chunks, mode) {
    if (mode === 'rag' && chunks && chunks.length > 0) {
      const contextWithIds = chunks.map((c, idx) => {
        const meta = typeof c.metadata === 'string' ? JSON.parse(c.metadata) : c.metadata;
        return `[SOURCE_${idx}] [Файл: ${c.filename}] [Chunk: ${c.chunk_id}] [Section: ${meta?.section || 'other'}] [Title: ${meta?.title || 'untitled'}]\n${c.content}`;
      }).join('\n\n---\n\n');

      return [
        {
          role: 'system',
          content: `Ты — ассистент по кодовой базе. Отвечай СТРОГО на основе предоставленного контекста.

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
- Если ответ найден в контексте — используй ТОЛЬКО его.
- Если контекста недостаточно — ответь ТОЛЬКО: "В проиндексированном коде эта информация не найдена. Попробуйте уточнить вопрос или переформулировать его."
- Цитаты можно обрезать, но нельзя переписывать. Минимум 15 символов.
- Каждая цитата должна содержать [SOURCE_N] ссылку.
- Минимум 1 цитата, максимум 3.

ПРИМЕР ПРАВИЛЬНОГО ОТВЕТА:
Вопрос: Какой компонент отвечает за модальное окно?
Ответ:
Компонент ModalDialog отвечает за модальное окно.

> [SOURCE_0] [Файл: ModalDialog.tsx] [Chunk: abc-123]
> export function ModalDialog({ isOpen, onClose, children }) {
>   return isOpen ? <div className="modal">{children}</div> : null;
> }

ИСТОЧНИКИ:
- Файл: ModalDialog.tsx | Chunk: abc-123 | Релевантность: 95%

ПРИМЕР ОТВЕТА "НЕ ЗНАЮ":
В проиндексированном коде эта информация не найдена. Попробуйте уточнить вопрос или переформулировать его.`
        },
        { role: 'user', content: `Вопрос: ${question}` }
      ];
    }

    return [
      {
        role: 'system',
        content: 'Ты — ассистент. Ответь на вопрос на русском языке.'
      },
      {
        role: 'user',
        content: `Вопрос: ${question}`
      }
    ];
  }
}
