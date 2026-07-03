export class QueryRewriter {
  constructor(llmClient) {
    this.llmClient = llmClient;
  }

  async rewrite(question) {
    const result = await this.llmClient.chat([
      {
        role: 'system',
        content: 'Ты — ассистент по улучшению поисковых запросов для кодовой базы. Перефразируй вопрос так, чтобы найти релевантные фрагменты кода. Добавь технические термины (функция, класс, модуль, сервис, API, endpoint, компонент, шаблон, интерфейс). Уточни контекст. Не привязывайся к конкретному фреймворку, если его нет в вопросе. Ответь ТОЛЬКО переформулированным запросом, без пояснений.'
      },
      {
        role: 'user',
        content: `Исходный вопрос: ${question}`
      }
    ], { temperature: 0.3, maxTokens: 100 });

    const rewritten = result.answer.trim();
    return rewritten || question;
  }
}
