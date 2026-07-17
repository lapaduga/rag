import { execSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { resolve, relative } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..', '..');

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'data', '.nyc_output']);
const IGNORE_FILES = new Set(['.env', '.env.local', 'package-lock.json']);

export class McpServer {
  constructor() {
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
    };
  }

  getToolDefinitions() {
    return Object.entries(this.tools).map(([name, tool]) => ({
      name,
      description: tool.description,
    }));
  }

  async callTool(toolName) {
    const tool = this.tools[toolName];
    if (!tool) {
      return { error: `Инструмент "${toolName}" не найден. Доступные: ${Object.keys(this.tools).join(', ')}` };
    }
    try {
      return tool.execute();
    } catch (err) {
      return { error: err.message };
    }
  }

  getGitBranch() {
    try {
      const branch = execSync('git branch --show-current', {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      const status = execSync('git status --porcelain', {
        cwd: PROJECT_ROOT,
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
        if (IGNORE_DIRS.has(entry.name)) continue;
        if (IGNORE_FILES.has(entry.name)) continue;
        const fullPath = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath, depth + 1);
        } else {
          const stat = statSync(fullPath);
          if (stat.size < 500_000) {
            files.push({
              path: relative(PROJECT_ROOT, fullPath).replace(/\\/g, '/'),
              size: stat.size,
            });
          }
        }
      }
    };
    scan(PROJECT_ROOT);
    return { files, total: files.length };
  }

  getGitDiff() {
    try {
      const diff = execSync('git diff HEAD --stat', {
        cwd: PROJECT_ROOT,
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
        cwd: PROJECT_ROOT,
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
}
