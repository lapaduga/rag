# Конфигурация

Все настройки — через переменные окружения в файле `.env`.

## Сервер

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| PORT | 3000 | Порт сервера |
| HOST | 0.0.0.0 | Хост сервера |

## База данных

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| DB_PATH | ./data/rag-indexer.db | Путь к SQLite базе |

## Документы

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| DOCUMENTS_PATH | - | Путь к папке с документами для индексации |
| MAX_FILES | 0 | Лимит файлов (0 = без лимита) |

## Эмбеддинги

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| EMBEDDING_MODEL | Xenova/all-MiniLM-L6-v2 | Модель эмбеддингов |
| EMBEDDING_DIMENSION | 384 | Размерность вектора |
| EMBEDDING_BATCH_SIZE | 20 | Размер батча |

## LLM провайдеры

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| LLM_PROVIDER | deepseek | Провайдер: "deepseek" или "local" |
| CHAT_API_KEY | - | API-ключ DeepSeek |
| CHAT_MODEL | deepseek-chat | Модель DeepSeek |
| CHAT_BASE_URL | https://api.deepseek.com | URL API DeepSeek |
| LOCAL_MODEL | qwen2.5:3b | Модель Ollama |
| LOCAL_BASE_URL | http://localhost:11434/v1 | URL Ollama API |
| LOCAL_NUM_THREADS | 4 | Потоки для Ollama |
| LOCAL_NUM_GPU | 0 | GPU слои для Ollama |

## Чанкинг

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| CHUNK_SIZE | 500 | Размер чанка (символы) |
| CHUNK_OVERLAP | 50 | Перекрытие чанков |

## RAG

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| RAG_TOP_K | 5 | Количество результатов поиска |
| RAG_SIMILARITY_THRESHOLD | 0.5 | Порог similarity |
| RAG_MAX_TOKENS | 2000 | Максимум токенов ответа |
| RAG_TEMPERATURE | 0.3 | Temperature LLM |

## Пайплайн

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| PIPELINE_QUERY_REWRITE | false | Включить rewrite запросов |
| PIPELINE_RERANKER | false | Включить reranker |
| PIPELINE_THRESHOLD | - | Порог фильтрации |
| PIPELINE_TOP_K_BEFORE | 50 | Top-K до rerank |
| PIPELINE_TOP_K_AFTER | 30 | Top-K после rerank |
| PIPELINE_MIN_CONFIDENCE | 0.25 | Минимальный confidence |
| PIPELINE_MAX_HISTORY | 0 | Макс. сообщений в истории |
| PIPELINE_MEMORY_EXTRACTION | false | Извлечение памяти задачи |

## Реранкер

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| RERANKER_ENABLED | false | Включить реранкер |
| RERANKER_MODEL | Xenova/ms-marco-MiniLM-L-6-v2 | Cross-encoder модель |
| RERANKER_THRESHOLD | 0.5 | Порог реранкера |
