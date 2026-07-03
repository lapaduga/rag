export class MemoryManager {
  constructor(llmClient) {
    this.llm = llmClient;
  }

  async extractTaskState(messages) {
    if (messages.length < 2) return null;

    const dialog = messages.map(m => `${m.role}: ${m.content}`).join('\n');

    const result = await this.llm.chat([
      {
        role: 'system',
        content: `Проанализируй диалог и извлеки структурированную информацию. Ответь ТОЛЬКО JSON без markdown:
{
  "goal": "цель диалога (что пользователь хочет найти/сделать)",
  "constraints": ["ограничения, которые пользователь указал"],
  "terms": ["ключевые термины, которые были уточнены"],
  "clarifications": ["уточнения, которые дал пользователь"]
}
Если информации недостаточно — верни пустой объект {}.`
      },
      { role: 'user', content: dialog }
    ], { temperature: 0, maxTokens: 500 });

    try {
      const parsed = JSON.parse(result.answer.replace(/```json\s*|\s*```/g, '').trim());
      return parsed;
    } catch {
      return null;
    }
  }

  buildMemoryContext(taskMemory) {
    if (!taskMemory || taskMemory.length === 0) return '';

    const byType = {};
    for (const item of taskMemory) {
      if (!byType[item.type]) byType[item.type] = [];
      byType[item.type].push(`${item.key}: ${item.value}`);
    }

    const parts = [];
    if (byType.goal?.length) parts.push(`ЦЕЛЬ: ${byType.goal.join('; ')}`);
    if (byType.constraint?.length) parts.push(`ОГРАНИЧЕНИЯ: ${byType.constraint.join('; ')}`);
    if (byType.term?.length) parts.push(`ТЕРМИНЫ: ${byType.term.join('; ')}`);
    if (byType.clarification?.length) parts.push(`УТОЧНЕНИЯ: ${byType.clarification.join('; ')}`);

    return parts.length > 0 ? `\n\nПАМЯТЬ ЗАДАЧИ:\n${parts.join('\n')}` : '';
  }
}
