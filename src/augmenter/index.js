export class Augmenter {
  buildPrompt(question, chunks, mode) {
    if (mode === 'rag' && chunks && chunks.length > 0) {
      const context = chunks.map(c =>
        `[Файл: ${c.filename} (релевантность: ${(c.similarity * 100).toFixed(1)}%)]\n${c.content}`
      ).join('\n\n');

      return [
        {
          role: 'system',
          content: `Ты — ассистент по кодовой базе.

Контекст:
${context}

Если контекст содержит ответ — используй его. Если контекста недостаточно — используй свои знания, но укажи, что в проиндексированном коде эта информация не найдена.
Ответь кратко и по существу на русском языке.`
        },
        {
          role: 'user',
          content: `Вопрос: ${question}`
        }
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
