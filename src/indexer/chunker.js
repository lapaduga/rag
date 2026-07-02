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
    let index = 0;

    for (const line of lines) {
      const headerMatch = line.match(/^(#{2,3})\s+(.+)/);
      if (headerMatch) {
        if (currentSection.length > 0) {
          const chunkText = currentSection.join('\n').trim();
          if (chunkText) {
            chunks.push(this._makeChunk(chunkText, metadata, index, chunks.length + 1, currentTitle));
            index++;
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
        chunks.push(this._makeChunk(chunkText, metadata, index, chunks.length + 1, currentTitle));
      }
    }

    for (const chunk of chunks) {
      chunk.total_chunks = chunks.length;
    }

    return chunks;
  }

  _chunkByCodeStructure(content, metadata) {
    const chunks = [];
    const patterns = [
      { regex: /^(export\s+)?(async\s+)?function\s+(\w+)/gm, section: 'functions' },
      { regex: /^(export\s+)?class\s+(\w+)/gm, section: 'classes' },
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
          const name = pattern.section === 'imports' ? 'imports' : (match[3] || match[2] || '');
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

    let index = 0;
    for (const seg of segments) {
      if (seg.text.length > this.fixedCharSize) {
        const subChunks = this._splitLargeBlock(seg.text, metadata);
        for (const sub of subChunks) {
          chunks.push(this._makeChunk(sub, metadata, index, segments.length, seg.title, seg.section));
          index++;
        }
      } else {
        chunks.push(this._makeChunk(seg.text, metadata, index, segments.length, seg.title, seg.section));
        index++;
      }
    }

    for (const chunk of chunks) {
      chunk.total_chunks = chunks.length;
    }

    return chunks;
  }

  _chunkByJsonKeys(content, metadata) {
    const chunks = [];
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return this._fixedChunk(content, metadata);
    }

    const entries = typeof parsed === 'object' && parsed !== null ? Object.entries(parsed) : [['root', content]];
    let index = 0;

    for (const [key, value] of entries) {
      const chunkText = JSON.stringify({ [key]: value }, null, 2);
      if (chunkText.trim().length > 0) {
        chunks.push(this._makeChunk(chunkText, metadata, index, entries.length, key, 'json-key'));
        index++;
      }
    }

    for (const chunk of chunks) {
      chunk.total_chunks = chunks.length;
    }

    return chunks;
  }

  _chunkBySections(content, metadata) {
    const chunks = [];
    const lines = content.split('\n');
    let currentBlock = [];
    let index = 0;
    let currentTitle = '';

    for (const line of lines) {
      const commentMatch = line.match(/\/\*\s*(.+?)\s*\*\//) || line.match(/\/\/\s*(.+)/) || line.match(/<!--\s*(.+?)\s*-->/);
      if (commentMatch) {
        if (currentBlock.length > 0) {
          const text = currentBlock.join('\n').trim();
          if (text) {
            chunks.push(this._makeChunk(text, metadata, index, chunks.length + 1, currentTitle));
            index++;
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
        chunks.push(this._makeChunk(text, metadata, index, chunks.length + 1, currentTitle));
      }
    }

    for (const chunk of chunks) {
      chunk.total_chunks = chunks.length;
    }

    return chunks;
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
