# RAG Indexer

Система RAG (Retrieval-Augmented Generation) для индексации и семантического поиска по кодовой базе проекта. Поддерживает локальные модели (Ollama) и облачные LLM (DeepSeek). Включает **File Assistant** — ассистента для работы с файлами целевого проекта.

## Быстрый старт

```bash
# Установка зависимостей
npm install

# Копирование конфигурации
cp .env.example .env

# Запуск сервера
npm run dev
```

Сервер запускается на `http://localhost:3000`.

## Архитектура

Проект состоит из модульной системы с чётким разделением ответственности:

- **Indexer** — сканирование файловой системы, чанкинг, генерация эмбеддингов
- **Retriever** — семантический поиск по чанкам с keyword-boost
- **Reranker** — переупорядочивание результатов через cross-encoder
- **QueryRewriter** — реформулировка запроса для лучшего поиска
- **Augmenter** — сборка промпта с контекстом для LLM
- **Pipeline** — оркестрация всего пайплайна: translate → rewrite → retrieve → rerank → filter → LLM → citation-parse
- **CitationParser** — валидация цитат в ответах LLM
- **MemoryManager** — извлечение и хранение контекста задачи
- **MCP Server** — инструменты разработчика (git, файлы, поиск, чтение, запись)

## File Assistant

Ассистент работает с файлами целевого проекта (настраивается через `TARGET_PROJECT_PATH`).

### Инструменты

| Инструмент | Описание | Безопасность |
|---|---|---|
| `read_file` | Чтение файла по пути (startLine/endLine) | Блокировка чёрного списка, обрезка >500 строк |
| `search_in_files` | Regex-поиск по файлам проекта | Исключение опасных директорий, max 100 результатов |
| `write_file` | Создание/перезапись файла | Только с `confirm: true`, только при `TARGET_READ_ONLY=false` |
| `edit_file` | Точечное редактирование (find-replace) | Только с `confirm: true`, только при `TARGET_READ_ONLY=false` |
| `generate_diff` | Просмотр diff (git diff или proposed) | Read-only, безопасен |
| `get_git_branch` | Текущая ветка и статус git | — |
| `list_project_files` | Список файлов проекта | — |
| `get_git_diff` | Diff последних изменений | — |
| `get_git_log` | Последние 10 коммитов | — |

### Безопасность

- **Чёрные списки**: `server.key`, `.sentryclirc`, `tt-site-settings.js` и др.
- **Path traversal**: блокировка попыток выйти за пределы целевого проекта
- **ReadOnly по умолчанию**: запись/редактирование требуют `TARGET_READ_ONLY=false`
- **Подтверждение**: write_file/edit_file требуют `confirm: true`

### Сценарии использования

1. **Поиск API**: `search_in_files({ pattern: "EscManager" })` → `read_file` → отчёт
2. **Анализ модуля**: `search_in_files({ fileGlob: "xcall/*.js" })` → `read_file` → summary
3. **Проверка код-стайла**: `search_in_files({ pattern: "class.*extends" })` → `read_file` → violations

### CLI-команды

- `/read <путь> [строки]` — чтение файла (например: `/read static/es6/init.js 1-50`)
- `/search <паттерн>` — поиск по кодовой базе

## Модули

| Модуль | Файл | Описание |
|--------|------|----------|
| Config | `src/config.js` | Конфигурация из .env (включая target project) |
| Indexer | `src/indexer/index.js` | Оркестрация индексации |
| Chunker | `src/indexer/chunker.js` | Fixed и semantic чанкинг |
| Embedder | `src/indexer/embedder.js` | Генерация эмбеддингов (all-MiniLM-L6-v2) |
| Retriever | `src/retriever/index.js` | Семантический поиск |
| Reranker | `src/reranker/index.js` | Cross-encoder переупорядочивание |
| Augmenter | `src/augmenter/index.js` | Сборка промпта (RAG + file-assistant) |
| Pipeline | `src/pipeline/index.js` | Оркестрация RAG (10 шагов agentic loop) |
| LLM Client | `src/llm/index.js` | Клиент для DeepSeek/Ollama |
| CitationParser | `src/citation-parser/index.js` | Валидация цитат |
| MemoryManager | `src/memory/index.js` | Память задач |
| MCP Server | `src/mcp/index.js` | 9 инструментов: git, файлы, поиск, запись |

## Конфигурация

Все настройки — через переменные окружения в `.env`. См. [docs/configuration.md](docs/configuration.md).

## Технологии

- **Runtime:** Node.js + Express
- **БД:** SQLite (better-sqlite3)
- **Эмбеддинги:** Xenova/all-MiniLM-L6-v2 (384-dim)
- **Reranker:** Xenova/ms-marco-MiniLM-L-6-v2
- **LLM:** DeepSeek API / Ollama (qwen2.5:3b)
