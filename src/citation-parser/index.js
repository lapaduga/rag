export class CitationParser {
  parse(answer, chunks) {
    const citations = [];
    const sources = [];

    const citationRegex = />\s*\[SOURCE_(\d+)\]\s*\[Файл:\s*([^\]]+)\]\s*\[Chunk:\s*([^\]]+)\](?:\s*\[Section:\s*([^\]]+)\])?\s*\n>\s*(.+?)(?=\n\s*\n|\n[^>\s]|$)/gs;

    let match;
    while ((match = citationRegex.exec(answer)) !== null) {
      const sourceIdx = parseInt(match[1], 10);
      const filename = match[2].trim();
      const chunkId = match[3].trim();
      const quote = match[5].trim().replace(/[ \t]+/g, ' ');

      const chunk = chunks[sourceIdx];
      const isValid = chunk &&
        chunk.chunk_id === chunkId &&
        chunk.filename === filename &&
        this._validateQuote(quote, chunk.content);

      citations.push({ sourceIdx, filename, chunkId, quote, isValid, similarity: chunk?.similarity || 0 });
    }

    const sourceRegex = /-\s*Файл:\s*([^|]+)\|\s*Chunk:\s*([^|]+)\|\s*Релевантность:\s*(\d+(?:\.\d+)?)%/g;
    while ((match = sourceRegex.exec(answer)) !== null) {
      sources.push({ filename: match[1].trim(), chunkId: match[2].trim(), relevance: parseFloat(match[3]) / 100 });
    }

    let cleanAnswer = answer
      .replace(/>\s*\[SOURCE_\d+\][\s\S]*?(?=\n\s*\n|\n[^>\s]|$)/g, '')
      .replace(/ИСТОЧНИКИ:[\s\S]*$/i, '')
      .replace(/ЦИТАТЫ:[\s\S]*$/i, '')
      .replace(/\*\*Цитаты из контекста:\*\*[\s\S]*?(?=\n\*\*|\n---|$)/i, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const hasEnoughContext = citations.length > 0
      ? citations.every(c => c.isValid)
      : sources.length > 0;

    return { cleanAnswer, citations, sources, hasEnoughContext };
  }

  _validateQuote(quote, chunkContent) {
    if (!quote || !chunkContent) return false;
    if (quote.length < 15) return false;

    const normalizedQuote = quote.toLowerCase().replace(/[\t\n\r\s]+/g, ' ').trim();
    const normalizedChunk = chunkContent.toLowerCase().replace(/[\t\n\r\s]+/g, ' ').trim();

    if (normalizedChunk.includes(normalizedQuote)) return true;

    const quoteWords = normalizedQuote.split(/\s+/).filter(w => w.length > 2);
    const chunkWords = new Set(normalizedChunk.split(/\s+/).filter(w => w.length > 2));
    const matchedWords = quoteWords.filter(w => chunkWords.has(w));
    return quoteWords.length > 0 && matchedWords.length / quoteWords.length >= 0.75;
  }

  isDontKnow(answer) {
    return [/не знаю/i, /не найдена/i, /не содержит/i, /недостаточно контекста/i, /уточните вопрос/i, /переформулируйте/i, /не найдено/i]
      .some(p => p.test(answer));
  }
}
