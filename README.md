# RAG Indexer

Система RAG (Retrieval-Augmented Generation) для индексации и семантического поиска по кодовой базе проекта. Поддерживает локальные модели (Ollama) и облачные LLM (DeepSeek).

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
- **MCP Server** — инструменты разработчика (git, файлы)

Подробная архитектура: [docs/architecture.md](docs/architecture.md)

## Модули

| Модуль | Файл | Описание |
|--------|------|----------|
| Config | `src/config.js` | Конфигурация из .env |
| Indexer | `src/indexer/index.js` | Оркестрация индексации |
| Chunker | `src/indexer/chunker.js` | Fixed и semantic чанкинг |
| Embedder | `src/indexer/embedder.js` | Генерация эмбеддингов (all-MiniLM-L6-v2) |
| Retriever | `src/retriever/index.js` | Семантический поиск |
| Reranker | `src/reranker/index.js` | Cross-encoder переупорядочивание |
| Augmenter | `src/augmenter/index.js` | Сборка промпта |
| Pipeline | `src/pipeline/index.js` | Оркестрация RAG |
| LLM Client | `src/llm/index.js` | Клиент для DeepSeek/Ollama |
| CitationParser | `src/citation-parser/index.js` | Валидация цитат |
| MemoryManager | `src/memory/index.js` | Память задач |
| MCP Server | `src/mcp/index.js` | Инструменты разработчика |

## Конфигурация

Все настройки — через переменные окружения в `.env`. См. [docs/configuration.md](docs/configuration.md).

## Технологии

- **Runtime:** Node.js + Express
- **БД:** SQLite (better-sqlite3)
- **Эмбеддинги:** Xenova/all-MiniLM-L6-v2 (384-dim)
- **Reranker:** Xenova/ms-marco-MiniLM-L-6-v2
- **LLM:** DeepSeek API / Ollama (qwen2.5:3b)
