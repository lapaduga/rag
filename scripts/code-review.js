#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve, join, extname } from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

const require = createRequire(import.meta.url);
try { require('dotenv').config(); } catch {}

const MAX_DIFF_CHARS = 150_000;
const MAX_FILE_CONTENT_CHARS = 30_000;
const MAX_FILES_FOR_CONTENT = 30;
const LLM_TEMPERATURE = 0.2;
const LLM_MAX_TOKENS = parseInt(process.env.REVIEW_MAX_TOKENS, 10) || 4096;
const TEXT_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.json', '.md', '.html', '.css',
  '.sql', '.yml', '.yaml', '.sh', '.env', '.txt', '.mjs', '.cjs',
]);

function git(args) {
  return execFileSync('git', args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
  }).trim();
}

function getDiff(base) {
  try {
    return git(['diff', `${base}...HEAD`]);
  } catch {
    return git(['diff', `${base}..HEAD`]);
  }
}

function getChangedFiles(base) {
  try {
    return git(['diff', '--name-status', `${base}...HEAD`]);
  } catch {
    return git(['diff', '--name-status', `${base}..HEAD`]);
  }
}

function getDiffStat(base) {
  try {
    return git(['diff', '--stat', `${base}...HEAD`]);
  } catch {
    return git(['diff', '--stat', `${base}..HEAD`]);
  }
}

function readFileSafe(filePath, maxChars = MAX_FILE_CONTENT_CHARS) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return content.length > maxChars
      ? content.slice(0, maxChars) + '\n... [обрезано]'
      : content;
  } catch {
    return null;
  }
}

function readDocs() {
  const docsDir = join(PROJECT_ROOT, 'docs');
  if (!existsSync(docsDir)) return '';

  return readdirSync(docsDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const content = readFileSync(join(docsDir, f), 'utf-8');
      return `### ${f}\n${content}`;
    })
    .join('\n\n---\n\n');
}

function readPackageJson() {
  try {
    const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8'));
    return JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        scripts: pkg.scripts,
        dependencies: Object.keys(pkg.dependencies || {}),
      },
      null,
      2,
    );
  } catch {
    return null;
  }
}

function getPRContext() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;
  try {
    const event = JSON.parse(readFileSync(eventPath, 'utf-8'));
    return event.pull_request || null;
  } catch {
    return null;
  }
}

function getLLMConfig() {
  const provider = process.env.LLM_PROVIDER || 'deepseek';

  if (provider === 'local') {
    return {
      baseUrl: process.env.LOCAL_BASE_URL || 'http://localhost:11434/v1',
      model: process.env.LOCAL_MODEL || 'qwen2.5:3b',
      apiKey: '',
    };
  }

  return {
    baseUrl: process.env.CHAT_BASE_URL || 'https://api.deepseek.com',
    model: process.env.CHAT_MODEL || 'deepseek-v4-pro',
    apiKey: process.env.CHAT_API_KEY || '',
  };
}

async function callLLM(messages) {
  const { baseUrl, model, apiKey } = getLLMConfig();

  if (!apiKey && getLLMConfig().baseUrl.includes('deepseek')) {
    throw new Error('CHAT_API_KEY не задан. Установите переменную окружения или добавьте её в .env');
  }

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        temperature: LLM_TEMPERATURE,
        max_tokens: LLM_MAX_TOKENS,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(`LLM API error (${res.status}): ${data.error?.message || JSON.stringify(data)}`);
    }

    const answer = data.choices?.[0]?.message?.content || '';
    if (!answer) {
      throw new Error('LLM вернул пустой ответ');
    }

    return answer;
  } finally {
    clearTimeout(timeout);
  }
}

async function postPRComment(prNumber, body) {
  const token = process.env.GITHUB_TOKEN;
  const repoSlug = process.env.GITHUB_REPOSITORY;

  if (!token || !repoSlug) {
    return false;
  }

  const [owner, repo] = repoSlug.split('/');
  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
    body: JSON.stringify({ body }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub API error (${res.status}): ${err}`);
  }

  return true;
}

function buildReviewPrompt(diff, diffStat, changedFilesText, fileContents, docs, packageInfo, prContext) {
  const projectContext = [
    docs ? `## Документация проекта\n${docs}` : '',
    packageInfo ? `## Package.json\n\`\`\`json\n${packageInfo}\n\`\`\`` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const systemPrompt = `Ты — Senior-разработчик с 20+ летним опытом работы в крупнейших tech-компаниях (Google, Meta, Amazon). Твоя задача — провести автоматическое ревью Pull Request в проекте RAG Indexer.

## О проекте
RAG Indexer — модульная система для семантического поиска по кодовой базе.
Стек: Node.js (ES modules), Express, SQLite (better-sqlite3), @xenova/transformers (эмбеддинги all-MiniLM-L6-v2), DeepSeek/Ollama (LLM).
Модули: Indexer, Retriever, Reranker (cross-encoder), Augmenter, Pipeline, LLM client, MCP Server (git/file tools), Citation Parser, Memory Manager, Query Rewriter, Context Window.
Фронтенд: Dashboard (indexing management) + Chat UI (threads, task memory, pipeline config).

${projectContext}

## Формат ревью

Предоставь ревью СТРОГО в следующем формате (на русском языке):

### Резюме
Общая оценка изменений (2-3 предложения). Что делает PR, насколько изменения качественные.

### Проблемы

**Баги и ошибки**
(список найденных багов, если нет — напиши "Не найдено")

**Архитектура**
(архитектурные проблемы, если нет — "Не найдено")

**Безопасность**
(проблемы безопасности, если нет — "Не найдено")

**Производительность**
(проблемы производительности, если нет — "Не найдено")

Для каждой проблемы используй формат:
- 🔴 [критично] или 🟡 [важно] Краткое описание
  - 📁 \`путь/к/файлу:строка\`
  - Проблема: что не так
  - Исправление: как исправить (с кодом если возможно)

### Рекомендации
Нумерованный список рекомендаций по улучшению.

### Хорошие практики
Что сделано хорошо в этом PR (2-3 пункта).

## Правила анализа
1. Фокусируйся на изменённых файлах, но учитывай влияние на всю систему
2. Ищи реальные баги: null-обработка, edge cases, race conditions, неправильная обработка ошибок
3. Проверяй: валидацию данных, корректность async/await, обработку ошибок в try/catch
4. Оценивай: производительность (N+1, утечки памяти), безопасность (инъекции, XSS), читаемость
5. Предлагай конкретные исправления с примерами кода
6. Не льсти — честно указывай на проблемы
7. Если проблем нет — не придумывай их
8. Будь конкретен: указывай файлы и строки`;

  const sanitize = (text) => (text || '').replace(/[`$\\]/g, '\\$&').slice(0, 2000);

  const prInfo = prContext
    ? `**Заголовок:** ${sanitize(prContext.title)}\n**Описание:** ${sanitize(prContext.body)}`
    : '(контекст PR недоступен — локальный запуск)';

  const userContent = `## PR\n${prInfo}

## Изменённые файлы
${changedFilesText}

## Статистика
\`\`\`
${diffStat}
\`\`\`

## Содержимое изменённых файлов
${fileContents}

## Diff
\`\`\`diff
${diff}
\`\`\`

Проведи ревью этого PR.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];
}

async function main() {
  console.log('🔍 AI Code Review — запуск...\n');

  const prContext = getPRContext();
  let baseBranch;
  let prNumber;

  if (prContext) {
    baseBranch = prContext.base.ref;
    prNumber = prContext.number;

    try {
      git(['rev-parse', '--verify', baseBranch]);
    } catch {
      baseBranch = `origin/${baseBranch}`;
    }
    console.log(`PR #${prNumber}: ${prContext.title}`);
    console.log(`Base: ${baseBranch} ← Head: ${prContext.head.ref}\n`);
  } else {
    const args = process.argv.slice(2);
    const baseIdx = args.indexOf('--base');
    baseBranch = baseIdx >= 0 ? args[baseIdx + 1] : 'main';
    prNumber = null;

    try {
      git(['rev-parse', '--verify', baseBranch]);
    } catch {
      console.error(`Ветка '${baseBranch}' не найдена. Попробуйте --base master`);
      process.exit(1);
    }

    console.log(`Локальный режим: сравнение с ${baseBranch}\n`);
  }

  console.log('📋 Получение diff...');
  const diff = getDiff(baseBranch);
  if (!diff) {
    console.log('✅ Нет изменений для ревью.');
    return;
  }

  const changedFilesRaw = getChangedFiles(baseBranch).split('\n').filter(Boolean);
  const changedFiles = changedFilesRaw.map((line) => {
    const parts = line.split('\t');
    return { status: parts[0], path: parts.slice(1).join('\t') };
  });

  const diffStat = getDiffStat(baseBranch);
  console.log(`   Изменено файлов: ${changedFiles.length}`);

  console.log('📖 Чтение содержимого файлов...');
  const fileContents = [];
  let totalContentLength = 0;
  const filesToRead = Math.min(changedFiles.length, MAX_FILES_FOR_CONTENT);

  for (let i = 0; i < filesToRead; i++) {
    const { status, path: filePath } = changedFiles[i];

    if (status === 'D') {
      fileContents.push(`### ${filePath} [УДАЛЁН]`);
      continue;
    }

    const ext = extname(filePath);
    if (!TEXT_EXTENSIONS.has(ext)) {
      fileContents.push(`### ${filePath} [бинарный файл]`);
      continue;
    }

    const content = readFileSafe(join(PROJECT_ROOT, filePath));
    if (content) {
      totalContentLength += content.length;
      const lang = ext.slice(1);
      fileContents.push(`### ${filePath}\n\`\`\`${lang}\n${content}\n\`\`\``);
    } else {
      fileContents.push(`### ${filePath} [не удалось прочитать]`);
    }
  }

  if (changedFiles.length > MAX_FILES_FOR_CONTENT) {
    fileContents.push(`\n... и ещё ${changedFiles.length - MAX_FILES_FOR_CONTENT} файлов (пропущено)`);
  }

  console.log(`   Символов контента: ${totalContentLength.toLocaleString()}`);

  console.log('📚 Загрузка документации проекта (RAG-контекст)...');
  const docs = readDocs();
  const packageInfo = readPackageJson();

  let finalDiff = diff;
  if (diff.length > MAX_DIFF_CHARS) {
    finalDiff = diff.slice(0, MAX_DIFF_CHARS) + `\n\n... [diff обрезан — ${diff.length - MAX_DIFF_CHARS} символов]`;
    console.log(`   ⚠️ Diff обрезан до ${MAX_DIFF_CHARS.toLocaleString()} символов`);
  }

  console.log('🤖 Отправка запроса LLM (до 2 минут)...\n');
  const messages = buildReviewPrompt(
    finalDiff,
    diffStat,
    changedFiles.map((f) => `${f.status}\t${f.path}`).join('\n'),
    fileContents.join('\n\n'),
    docs,
    packageInfo,
    prContext,
  );

  const review = await callLLM(messages);

  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const header = `## 🤖 AI Code Review\n\n*Автоматическое ревью — ${timestamp}*\n\n---\n\n`;
  const footer = `\n\n---\n*Сгенерировано AI-ревьюером. Рекомендуется проверить найденные проблемы вручную.*`;
  const finalComment = header + review + footer;

  if (prNumber) {
    const posted = await postPRComment(prNumber, finalComment);
    if (posted) {
      console.log(`✅ Review опубликован как комментарий к PR #${prNumber}`);
    }
  } else {
    console.log('=== РЕЗУЛЬТАТ РЕВЬЮ ===\n');
    console.log(finalComment);

    const outputPath = join(PROJECT_ROOT, 'review-result.md');
    writeFileSync(outputPath, finalComment, 'utf-8');
    console.log(`\n💾 Результат сохранён в review-result.md`);
  }
}

main().catch((err) => {
  console.error('❌ Ошибка:', err.message);
  process.exit(1);
});
