# Архитектура проекта

## Обзор

RAG Indexer — это модульная система для семантического поиска по кодовой базе. Проходя через пайплайн, пользовательский запрос обогащается релевантным контекстом из проиндексированных файлов.

## Поток данных

```
Пользователь → QueryRewriter → Retriever → Reranker → Augmenter → LLM → CitationParser → Ответ
                     ↑                ↑           ↑
                  LLM (rewrite)   Embeddings  Cross-encoder
```

### Этапы пайплайна

1. **Translate** — если запрос на русском, переводится в английский для эмбеддингов
2. **Rewrite** (опционально) — LLM реформулирует запрос для лучшего поиска
3. **Retrieval** — семантический поиск по чанкам через cosine similarity + keyword-boost
4. **Rerank** (опционально) — cross-encoder переупорядочивает результаты
5. **Filter** — фильтрация по порогу similarity
6. **Top-K** — отбор лучших чанков
7. **LLM** — генерация ответа с контекстом
8. **Citation Parse** — валидация цитат в ответе

## Модули

### Indexer (`src/indexer/`)
Отвечает за индексацию файлов:
- Сканирует файловую систему с учётом .gitignore
- Чанкирует файлы (fixed или semantic стратегия)
- Генерирует эмбеддинги через all-MiniLM-L6-v2
- Сохраняет в SQLite

### Retriever (`src/retriever/`)
Семантический поиск:
- Загружает все чанки в кэш при первом запросе
- Считает cosine similarity
- Добавляет keyword-boost на основе транслитерации и словаря RU→EN
- Использует IDF-взвешивание для контентных ключевых слов

### Reranker (`src/reranker/`)
Переупорядочивание через cross-encoder (ms-marco-MiniLM-L-6-v2):
- Нормализует скоры
- Комбинирует similarity + rerank score (0.4/0.6)

### Augmenter (`src/augmenter/`)
Сборка промпта для LLM с контекстом, цитатами и форматом ответа.

### Pipeline (`src/pipeline/`)
Оркестрация всех этапов с таймингами по каждому.stage.

### MCP Server (`src/mcp/`)
Инструменты разработчика через Model Context Protocol:
- `get_git_branch` — текущая git-ветка
- `list_project_files` — список файлов проекта
- `get_git_diff` — diff последних изменений
