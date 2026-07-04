import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';

export class Chunker {
  constructor(strategy = 'fixed') {
    this.strategy = strategy;
    this.fixedCharSize = config.chunking.fixedCharSize;
    this.fixedCharOverlap = config.chunking.fixedCharOverlap;
  }

  chunk(content, metadata) {
    if (!content || content.trim().length === 0) return [];
    return this.strategy === 'semantic'
      ? this._semanticChunk(content, metadata)
      : this._fixedChunk(content, metadata);
  }

  _fixedChunk(content, metadata) {
    const chunks = [];
    const size = this.fixedCharSize;
    const overlap = this.fixedCharOverlap;
    let start = 0;
    let index = 0;

    while (start < content.length) {
      const end = Math.min(start + size, content.length);
      let chunkText = content.slice(start, end);

      if (end < content.length) {
        const lastNewline = chunkText.lastIndexOf('\n');
        if (lastNewline > size / 2) {
          const adjustedEnd = start + lastNewline;
          chunkText = content.slice(start, adjustedEnd);
        }
      }

      if (chunkText.trim().length > 0) {
        chunks.push({
          chunk_id: uuidv4(),
          content: chunkText.trim(),
          metadata: JSON.stringify({ ...metadata, chunk_index: index, strategy: 'fixed' }),
          strategy: 'fixed',
          chunk_index: index,
        });
        index++;
      }

      start += size - overlap;
    }

    for (const chunk of chunks) {
      chunk.total_chunks = chunks.length;
    }

    return chunks;
  }

  _semanticChunk(content, metadata) {
    const ext = metadata.extension || '';

    if (['.md', '.markdown', '.txt'].includes(ext)) {
      return this._chunkByMarkdownHeaders(content, metadata);
    }
    if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
      return this._chunkByCodeStructure(content, metadata);
    }
    if (ext === '.json') {
      return this._chunkByJsonKeys(content, metadata);
    }
    if (['.css', '.html'].includes(ext)) {
      return this._chunkBySections(content, metadata);
    }

    return this._fixedChunk(content, metadata);
  }

  _chunkByMarkdownHeaders(content, metadata) {
    const chunks = [];
    const lines = content.split('\n');
    let currentSection = [];
    let currentTitle = '';

    for (const line of lines) {
      const headerMatch = line.match(/^(#{2,3})\s+(.+)/);
      if (headerMatch) {
        if (currentSection.length > 0) {
          const chunkText = currentSection.join('\n').trim();
          if (chunkText) {
            chunks.push({ text: chunkText, title: currentTitle });
          }
          currentSection = [];
        }
        currentTitle = headerMatch[2].trim();
      }
      currentSection.push(line);
    }

    if (currentSection.length > 0) {
      const chunkText = currentSection.join('\n').trim();
      if (chunkText) {
        chunks.push({ text: chunkText, title: currentTitle });
      }
    }

    const total = chunks.length;
    return chunks.map((c, i) => this._makeChunk(c.text, metadata, i, total, c.title));
  }

  _chunkByCodeStructure(content, metadata) {
    const chunks = [];
    const patterns = [
      { regex: /^(export\s+)?(async\s+)?function\s+(\w+)/gm, section: 'functions' },
      { regex: /^(export\s+)?class\s+(\w+)/gm, section: 'classes' },
      { regex: /^(export\s+)?(default\s+)?(const|let|var)\s+(\w+)\s*=\s*(?:\([^)]*\)\s*|\(\)\s*|[\w]+\s*)=>\s*/gm, section: 'functions' },
      { regex: /^(import\s+)/gm, section: 'imports' },
    ];

    const segments = [];
    const lines = content.split('\n');
    let currentBlock = [];
    let currentSection = 'other';
    let currentTitle = metadata.filename || '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let matched = false;

      for (const pattern of patterns) {
        const match = pattern.regex.exec(line);
        if (match) {
          if (currentBlock.length > 0) {
            const text = currentBlock.join('\n').trim();
            if (text) {
              segments.push({ text, section: currentSection, title: currentTitle });
            }
            currentBlock = [];
          }
          currentSection = pattern.section;
          let name = metadata.filename;
          if (pattern.section === 'imports') {
            name = 'imports';
          } else if (match[4]) {
            name = match[4];
          } else if (match[3]) {
            name = match[3];
          } else if (match[2]) {
            name = match[2];
          }
          currentTitle = name || metadata.filename;
          matched = true;
          break;
        }
      }

      currentBlock.push(line);
    }

    if (currentBlock.length > 0) {
      const text = currentBlock.join('\n').trim();
      if (text) {
        segments.push({ text, section: currentSection, title: currentTitle });
      }
    }

    for (const seg of segments) {
      if (seg.text.length > this.fixedCharSize) {
        const subChunks = this._splitLargeBlock(seg.text, metadata);
        for (const sub of subChunks) {
          chunks.push({ text: sub, title: seg.title, section: seg.section });
        }
      } else {
        chunks.push({ text: seg.text, title: seg.title, section: seg.section });
      }
    }

    const total = chunks.length;
    return chunks.map((c, i) => this._makeChunk(c.text, metadata, i, total, c.title, c.section));
  }

  _chunkByJsonKeys(content, metadata) {
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return this._fixedChunk(content, metadata);
    }

    const entries = typeof parsed === 'object' && parsed !== null ? Object.entries(parsed) : [['root', content]];
    const chunks = entries.map(([key, value], index) => {
      const chunkText = JSON.stringify({ [key]: value }, null, 2);
      return { text: chunkText, title: key, section: 'json-key' };
    }).filter(c => c.text.trim().length > 0);

    const total = chunks.length;
    return chunks.map((c, i) => this._makeChunk(c.text, metadata, i, total, c.title, c.section));
  }

  _chunkBySections(content, metadata) {
    const chunks = [];
    const lines = content.split('\n');
    let currentBlock = [];
    let currentTitle = '';

    for (const line of lines) {
      const commentMatch = line.match(/\/\*\s*(.+?)\s*\*\//) || line.match(/\/\/\s*(.+)/) || line.match(/<!--\s*(.+?)\s*-->/);
      if (commentMatch) {
        if (currentBlock.length > 0) {
          const text = currentBlock.join('\n').trim();
          if (text) {
            chunks.push({ text, title: currentTitle });
          }
          currentBlock = [];
        }
        currentTitle = commentMatch[1].trim();
      }
      currentBlock.push(line);
    }

    if (currentBlock.length > 0) {
      const text = currentBlock.join('\n').trim();
      if (text) {
        chunks.push({ text, title: currentTitle });
      }
    }

    const total = chunks.length;
    return chunks.map((c, i) => this._makeChunk(c.text, metadata, i, total, c.title));
  }

  _splitLargeBlock(text, metadata) {
    const size = this.fixedCharSize;
    const overlap = this.fixedCharOverlap;
    const result = [];
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + size, text.length);
      result.push(text.slice(start, end).trim());
      start += size - overlap;
    }
    return result.filter(Boolean);
  }

  _makeChunk(content, metadata, index, total, title, section) {
    const meta = { ...metadata, chunk_index: index, title: title || metadata.filename, section: section || 'other', strategy: 'semantic' };
    return {
      chunk_id: uuidv4(),
      content,
      metadata: JSON.stringify(meta),
      strategy: 'semantic',
      chunk_index: index,
      total_chunks: total,
    };
  }
}
