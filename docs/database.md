# Схема базы данных

База данных: SQLite, путь: `./data/rag-indexer.db`

## Таблицы

### documents
Проиндексированные файлы.

```sql
CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT UNIQUE NOT NULL,         -- полный путь к файлу
  filename TEXT NOT NULL,             -- имя файла
  extension TEXT NOT NULL,            -- расширение (.js, .ts, .md)
  content TEXT NOT NULL,              -- полное содержимое файла
  size_bytes INTEGER,                 -- размер в байтах
  indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### chunks
Чанки документов — основа для поиска.

```sql
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  chunk_id TEXT UNIQUE NOT NULL,      -- UUID чанка
  content TEXT NOT NULL,              -- текст чанка
  embedding TEXT,                     -- Float32Array эмбеддинга (BLOB)
  metadata TEXT NOT NULL,             -- JSON: filename, source, section, title
  strategy TEXT NOT NULL,             -- 'fixed' или 'semantic'
  chunk_index INTEGER,                -- индекс чанка в документе
  total_chunks INTEGER,               -- всего чанков в документе
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_chunks_document ON chunks(document_id);
CREATE INDEX idx_chunks_strategy ON chunks(strategy);
```

### queries
История запросов к системе.

```sql
CREATE TABLE queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  mode TEXT NOT NULL,                 -- 'rag', 'no-rag', 'auto'
  answer TEXT,
  sources TEXT,                       -- JSON массив источников
  latency_ms INTEGER,
  pipeline_json TEXT,                 -- JSON с этапами пайплайна
  citations TEXT,                     -- JSON цитат
  confidence_score REAL,              -- confidence ответа
  has_enough_context INTEGER DEFAULT 1,
  is_dont_know INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### threads
Диалоги (чат-сессии).

```sql
CREATE TABLE threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  task_goal TEXT,
  constraints TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### messages
Сообщения в диалогах.

```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  sources TEXT,                       -- JSON источников
  citations TEXT,                     -- JSON цитат
  confidence_score REAL,
  has_enough_context INTEGER DEFAULT 1,
  is_dont_know INTEGER DEFAULT 0,
  pipeline_json TEXT,
  provider TEXT,                      -- 'deepseek' или 'local'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_messages_thread ON messages(thread_id);
CREATE INDEX idx_messages_created ON messages(thread_id, created_at);
```

### task_memory
Память задачи — контекст диалога.

```sql
CREATE TABLE task_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('goal', 'constraint', 'term', 'clarification', 'preference')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(thread_id, key)
);

CREATE INDEX idx_task_memory_thread ON task_memory(thread_id);
```

### _migrations
Таблица миграций (управление через `src/storage/db.js`).

```sql
CREATE TABLE _migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Миграции

| Файл | Описание |
|------|----------|
| 001_init.sql | documents, chunks, queries |
| 002_pipeline.sql | Добавление pipeline_json в queries |
| 003_citations.sql | citations, confidence_score, has_enough_context, is_dont_know |
| 004_threads.sql | threads, messages, task_memory |
| 005_provider.sql | Добавление provider в messages |
