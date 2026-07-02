import { basename, extname } from 'path';

export class MetadataExtractor {
  extract(filePath, content) {
    const ext = extname(filePath).toLowerCase();
    const filename = basename(filePath);
    const meta = {
      source: filePath,
      filename,
      extension: ext,
      title: filename,
      section: 'other',
    };

    if (ext === '.md' || ext === '.markdown') {
      const h1Match = content.match(/^#\s+(.+)/m);
      if (h1Match) {
        meta.title = h1Match[1].trim();
      }
    }

    if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
      const funcMatch = content.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/m);
      const classMatch = content.match(/^(?:export\s+)?class\s+(\w+)/m);
      if (funcMatch) meta.title = funcMatch[1];
      else if (classMatch) meta.title = classMatch[1];
    }

    return meta;
  }
}
