# API Reference

Базовый URL: `http://localhost:3000/api`

## Системные

### GET /api/status
Статус сервера.

**Ответ:**
```json
{ "status": "ok", "uptime": 123.456 }
```

### GET /api/config
Текущая конфигурация.

**Ответ:**
```json
{
  "success": true,
  "data": {
    "provider": "deepseek",
    "providers": ["deepseek", "local"],
    "localModel": "qwen2.5:3b",
    "deepseekModel": "deepseek-chat"
  }
}
```

### GET /api/system-stats
Статистика системы (RAM, CPU).

### GET /api/ollama/status
Статус подключения к Ollama.

---

## Индексация

### POST /api/index
Запуск индексации.

**Тело:**
```json
{
  "path": "C:\\path\\to\\project",
  "strategy": "semantic",
  "maxFiles": 100
}
```

- `path` (обязательный) — путь к директории
- `strategy` — "fixed" или "semantic" (по умолчанию "fixed")
- `maxFiles` — лимит файлов (0 = без лимита)

### GET /api/index/status
Текущий статус индексации.

**Ответ:**
```json
{
  "success": true,
  "data": {
    "running": true,
    "phase": "indexing",
    "totalFiles": 42,
    "processedFiles": 15,
    "message": "Обработка: app.js"
  }
}
```

### POST /api/index/cancel
Отмена индексации.

### DELETE /api/index
Очистка всего индекса (удаление всех документов и чанков).

### POST /api/index/compare
Сравнение стратегий чанкинга.

---

## Документы и чанки

### GET /api/documents
Список проиндексированных документов.

### GET /api/chunks?document_id=1
Чанки конкретного документа.

---

## Запросы (Query)

### POST /api/query
Основной эндпоинт для вопросов.

**Тело:**
```json
{
  "question": "Как работает ретривер?",
  "mode": "auto",
  "provider": "deepseek",
  "thread_id": 1,
  "pipeline": {
    "queryRewrite": true,
    "reranker": true,
    "threshold": 0.5,
    "topKBefore": 20,
    "topKAfter": 5
  }
}
```

- `question` (обязательный) — вопрос пользователя
- `mode` — "auto", "rag", "no-rag"
- `provider` — "deepseek" или "local"
- `thread_id` — ID диалога (для истории)
- `pipeline` — настройки пайплайна

**Специальные команды:**
- `/help` — справка о проекте
- `/help api` — справка по API
- `/help architecture` — справка по архитектуре

---

## Диалоги (Threads)

### POST /api/threads
Создание диалога.

### GET /api/threads
Список диалогов.

### GET /api/threads/:id
Получение диалога.

### DELETE /api/threads/:id
Удаление диалога.

### POST /api/threads/:id/clear-messages
Очистка сообщений в диалоге.

### GET /api/threads/:id/messages
Сообщения диалога.

---

## Память задачи

### GET /api/threads/:id/memory
Получение памяти диалога.

### POST /api/threads/:id/memory
Добавление записи памяти.

**Тело:** `{ "key": "goal", "value": "...", "type": "goal" }`

### DELETE /api/threads/:id/memory/:key
Удаление записи памяти.

### POST /api/threads/:id/memory/clear
Очистка всей памяти диалога.

---

## История запросов

### GET /api/queries?limit=50
История запросов.

### GET /api/queries/pipeline
Запросы с информацией о пайплайне.

### GET /api/queries/citations
Запросы с цитатами.

### GET /api/compare/results
Сравнение стратегий чанкинга.

---

## MCP (Model Context Protocol)

### POST /api/mcp/call
Вызов инструмента MCP.

**Тело:**
```json
{
  "tool": "get_git_branch"
}
```

**Доступные инструменты:**
- `get_git_branch` — текущая git-ветка
- `list_project_files` — список файлов проекта
- `get_git_diff` — diff последних изменений
