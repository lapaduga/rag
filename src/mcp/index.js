import { execSync } from 'child_process';
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync, mkdirSync } from 'fs';
import { resolve, relative, join, dirname, extname, sep } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..', '..');

const TEXT_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
  '.json', '.md', '.html', '.css', '.scss', '.sass',
  '.sql', '.yml', '.yaml', '.sh', '.env', '.txt',
  '.py', '.flow', '.eslintrc', '.cjs',
]);

export class McpServer {
  constructor() {
    const t = config.target || {};
    this.targetPath = resolve(t.path || PROJECT_ROOT);
    this.readOnly = t.readOnly ?? true;
    this.sensitiveFiles = new Set(t.sensitiveFiles || []);
    this.sensitiveDirs = new Set(t.sensitiveDirs || []);
    this.ignoreDirs = new Set(t.ignoreDirs || []);
    this.maxReadLines = t.maxReadLines || 500;
    this.maxSearchResults = t.maxSearchResults || 100;

    this.tools = {
      get_git_branch: {
        description: 'Получить текущую git-ветку проекта',
        execute: () => this.getGitBranch(),
      },
      list_project_files: {
        description: 'Список файлов проекта (исключая node_modules, .git)',
        execute: () => this.listProjectFiles(),
      },
      get_git_diff: {
        description: 'Diff последних изменений (git diff HEAD)',
        execute: () => this.getGitDiff(),
      },
      get_git_log: {
        description: 'Последние коммиты (git log --oneline -10)',
        execute: () => this.getGitLog(),
      },
      read_file: {
        description: 'Прочитать файл по пути (относительно целевого проекта). Опции: startLine, endLine',
        execute: (args) => this.readFile(args),
      },
      search_in_files: {
        description: 'Поиск regex-паттерна по файлам проекта. Опции: fileGlob, maxResults',
        execute: (args) => this.searchInFiles(args),
      },
      write_file: {
        description: 'Создать/перезаписать файл. Требует confirm: true. Работает только в read-only=false режиме',
        execute: (args) => this.writeFile(args),
      },
      edit_file: {
        description: 'Точечное редактирование: find oldContent, replace newContent. Требует confirm: true',
        execute: (args) => this.editFile(args),
      },
      generate_diff: {
        description: 'Показать diff файла (git diff) или сравнение с переданным содержимым',
        execute: (args) => this.generateDiff(args),
      },
    };
  }

  getToolDefinitions() {
    return Object.entries(this.tools).map(([name, tool]) => ({
      name,
      description: tool.description,
    }));
  }

  async callTool(toolName, args) {
    const tool = this.tools[toolName];
    if (!tool) {
      return { error: `Инструмент "${toolName}" не найден. Доступные: ${Object.keys(this.tools).join(', ')}` };
    }
    try {
      return tool.execute(args || {});
    } catch (err) {
      return { error: err.message };
    }
  }

  _validatePath(rawPath) {
    const resolved = resolve(this.targetPath, rawPath);
    const normalizedTarget = this.targetPath.endsWith(sep)
      ? this.targetPath
      : this.targetPath + sep;
    if (!resolved.startsWith(normalizedTarget) && resolved !== this.targetPath) {
      return { ok: false, error: `Path traversal запрещён: ${rawPath}` };
    }
    const basename = resolved.split(/[/\\]/).pop();
    if (this.sensitiveFiles.has(basename)) {
      return { ok: false, error: `Файл в чёрном списке: ${basename}` };
    }
    const parts = relative(this.targetPath, resolved).split(/[/\\]/);
    for (const part of parts) {
      if (this.sensitiveDirs.has(part)) {
        return { ok: false, error: `Директория в чёрном списке: ${part}` };
      }
    }
    return { ok: true, resolved };
  }

  _scanDir(dir, depth = 0, maxDepth = 8) {
    if (depth > maxDepth) return [];
    const results = [];
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.eslintrc') continue;
      if (this.ignoreDirs.has(entry.name)) continue;
      if (this.sensitiveDirs.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this._scanDir(fullPath, depth + 1, maxDepth));
      } else {
        const basename = entry.name;
        if (this.sensitiveFiles.has(basename)) continue;
        try {
          const st = statSync(fullPath);
          if (st.size < 1_000_000) {
            results.push(fullPath);
          }
        } catch {}
      }
    }
    return results;
  }

  getGitBranch() {
    try {
      const branch = execSync('git branch --show-current', {
        cwd: this.targetPath,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      const status = execSync('git status --porcelain', {
        cwd: this.targetPath,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      const modifiedCount = status ? status.split('\n').length : 0;
      return {
        branch,
        modifiedFiles: modifiedCount,
        isDirty: modifiedCount > 0,
      };
    } catch (err) {
      return { error: `Git не доступен: ${err.message}` };
    }
  }

  listProjectFiles() {
    const files = [];
    const scan = (dir, depth = 0) => {
      if (depth > 5) return;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (this.ignoreDirs.has(entry.name)) continue;
        if (this.sensitiveDirs.has(entry.name)) continue;
        if (this.sensitiveFiles.has(entry.name)) continue;
        const fullPath = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath, depth + 1);
        } else {
          try {
            const stat = statSync(fullPath);
            if (stat.size < 500_000) {
              files.push({
                path: relative(this.targetPath, fullPath).replace(/\\/g, '/'),
                size: stat.size,
              });
            }
          } catch {}
        }
      }
    };
    scan(this.targetPath);
    return { files, total: files.length };
  }

  getGitDiff() {
    try {
      const diff = execSync('git diff HEAD --stat', {
        cwd: this.targetPath,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      if (!diff) return { diff: 'Нет изменений', files: 0 };
      const lines = diff.split('\n');
      const lastLine = lines[lines.length - 1];
      const fileMatch = lastLine.match(/(\d+) files? changed/);
      return {
        diff,
        files: fileMatch ? parseInt(fileMatch[1], 10) : lines.length,
      };
    } catch (err) {
      return { error: `Git diff недоступен: ${err.message}` };
    }
  }

  getGitLog() {
    try {
      const log = execSync('git log --oneline -10', {
        cwd: this.targetPath,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      const commits = log.split('\n').filter(Boolean).map(line => {
        const [hash, ...rest] = line.split(' ');
        return { hash, message: rest.join(' ') };
      });
      return { commits };
    } catch (err) {
      return { error: `Git log недоступен: ${err.message}` };
    }
  }

  readFile(args = {}) {
    const { path: rawPath, startLine, endLine } = args;
    if (!rawPath) return { error: 'Параметр "path" обязателен' };

    const validation = this._validatePath(rawPath);
    if (!validation.ok) return { error: validation.error };

    const filePath = validation.resolved;
    if (!existsSync(filePath)) {
      return { error: `Файл не найден: ${rawPath}` };
    }

    try {
      const stat = statSync(filePath);
      if (stat.size > 2_000_000) {
        return { error: `Файл слишком большой: ${(stat.size / 1024 / 1024).toFixed(1)} MB (макс 2 MB)` };
      }

      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const totalLines = lines.length;

      const start = Math.max(0, (startLine || 1) - 1);
      const end = Math.min(lines.length, endLine || this.maxReadLines);
      const sliced = lines.slice(start, end);

      const truncated = end < lines.length;
      const relativePath = relative(this.targetPath, filePath).replace(/\\/g, '/');

      return {
        path: relativePath,
        content: sliced.join('\n'),
        totalLines,
        returnedLines: sliced.length,
        startLine: start + 1,
        endLine: end,
        truncated,
        size: stat.size,
      };
    } catch (err) {
      return { error: `Ошибка чтения: ${err.message}` };
    }
  }

  searchInFiles(args = {}) {
    const { pattern, fileGlob, maxResults } = args;
    if (!pattern) return { error: 'Параметр "pattern" обязателен' };

    let regex;
    try {
      regex = new RegExp(pattern, 'i');
    } catch {
      return { error: `Невалидный regex: ${pattern}` };
    }

    const limit = Math.min(maxResults || this.maxSearchResults, this.maxSearchResults);
    const allFiles = this._scanDir(this.targetPath);
    const results = [];

    for (const filePath of allFiles) {
      if (results.length >= limit) break;

      if (fileGlob) {
        const rel = relative(this.targetPath, filePath).replace(/\\/g, '/');
        const globRegex = new RegExp(
          '^' + fileGlob.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
        );
        const filename = rel.split('/').pop();
        if (!globRegex.test(rel) && !globRegex.test(filename)) continue;
      }

      const ext = extname(filePath).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext)) continue;

      try {
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length && results.length < limit; i++) {
          if (regex.test(lines[i])) {
            results.push({
              file: relative(this.targetPath, filePath).replace(/\\/g, '/'),
              line: i + 1,
              content: lines[i].trim().slice(0, 200),
            });
          }
        }
      } catch {}
    }

    return {
      pattern,
      results,
      total: results.length,
      limit,
      truncated: results.length >= limit,
    };
  }

  writeFile(args = {}) {
    if (this.readOnly) {
      return { error: 'Запись запрещена (TARGET_READ_ONLY=true). Установите TARGET_READ_ONLY=false для записи.' };
    }

    const { path: rawPath, content, confirm } = args;
    if (!rawPath || content == null) {
      return { error: 'Параметры "path" и "content" обязательны' };
    }
    if (!confirm) {
      return { error: 'Запись требует подтверждения: передайте confirm: true' };
    }

    const validation = this._validatePath(rawPath);
    if (!validation.ok) return { error: validation.error };

    const filePath = validation.resolved;

    const ext = extname(filePath).toLowerCase();
    if (['.key', '.pem', '.crt', '.cert'].includes(ext)) {
      return { error: 'Запись в файлы сертификатов/ключей запрещена' };
    }

    try {
      const dir = dirname(filePath);
      mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, content, 'utf-8');
      const stat = statSync(filePath);
      const relativePath = relative(this.targetPath, filePath).replace(/\\/g, '/');
      return {
        success: true,
        path: relativePath,
        size: stat.size,
        lines: content.split('\n').length,
      };
    } catch (err) {
      return { error: `Ошибка записи: ${err.message}` };
    }
  }

  editFile(args = {}) {
    if (this.readOnly) {
      return { error: 'Редактирование запрещено (TARGET_READ_ONLY=true). Установите TARGET_READ_ONLY=false.' };
    }

    const { path: rawPath, oldContent, newContent, confirm } = args;
    if (!rawPath || oldContent == null || newContent == null) {
      return { error: 'Параметры "path", "oldContent", "newContent" обязательны' };
    }
    if (!confirm) {
      return { error: 'Редактирование требует подтверждения: передайте confirm: true' };
    }

    const validation = this._validatePath(rawPath);
    if (!validation.ok) return { error: validation.error };

    const filePath = validation.resolved;
    if (!existsSync(filePath)) {
      return { error: `Файл не найден: ${rawPath}` };
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const count = content.split(oldContent).length - 1;
      if (count === 0) {
        return { error: 'oldContent не найдена в файле', occurrences: 0 };
      }
      if (count > 1) {
        return { error: `oldContent найдена ${count} раз. Уточните контекст для уникального совпадения.`, occurrences: count };
      }

      const updated = content.replace(oldContent, newContent);
      writeFileSync(filePath, updated, 'utf-8');

      const relativePath = relative(this.targetPath, filePath).replace(/\\/g, '/');
      return {
        success: true,
        path: relativePath,
        replacements: 1,
        newLines: updated.split('\n').length,
      };
    } catch (err) {
      return { error: `Ошибка редактирования: ${err.message}` };
    }
  }

  generateDiff(args = {}) {
    const { path: rawPath, newContent } = args;
    if (!rawPath) return { error: 'Параметр "path" обязателен' };

    const validation = this._validatePath(rawPath);
    if (!validation.ok) return { error: validation.error };

    const filePath = validation.resolved;
    if (!existsSync(filePath)) {
      return { error: `Файл не найден: ${rawPath}` };
    }

    const relativePath = relative(this.targetPath, filePath).replace(/\\/g, '/');

    if (newContent) {
      try {
        const current = readFileSync(filePath, 'utf-8');
        const currentLines = current.split('\n');
        const newLines = newContent.split('\n');
        const diff = [];
        const maxLen = Math.max(currentLines.length, newLines.length);
        let changes = 0;

        for (let i = 0; i < maxLen; i++) {
          const old = currentLines[i];
          const upd = newLines[i];
          if (old !== upd) {
            if (old !== undefined) diff.push(`- ${i + 1}: ${old}`);
            if (upd !== undefined) diff.push(`+ ${i + 1}: ${upd}`);
            changes++;
          }
        }

        return {
          path: relativePath,
          type: 'proposed',
          changes,
          diff: diff.join('\n'),
          currentLines: currentLines.length,
          proposedLines: newLines.length,
        };
      } catch (err) {
        return { error: `Ошибка генерации diff: ${err.message}` };
      }
    }

    try {
      const diff = execSync(`git diff -- "${relativePath}"`, {
        cwd: this.targetPath,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();

      if (!diff) {
        const staged = execSync(`git diff --cached -- "${relativePath}"`, {
          cwd: this.targetPath,
          encoding: 'utf-8',
          timeout: 5000,
        }).trim();
        if (!staged) {
          return { path: relativePath, type: 'git', diff: 'Нет изменений', changes: 0 };
        }
        return { path: relativePath, type: 'git-staged', diff: staged, changes: (staged.match(/^[\+\-]/gm) || []).length };
      }

      return { path: relativePath, type: 'git', diff, changes: (diff.match(/^[\+\-]/gm) || []).length };
    } catch (err) {
      return { error: `Git diff недоступен: ${err.message}` };
    }
  }
}
