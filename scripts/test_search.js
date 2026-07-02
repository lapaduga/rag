import { db } from '../src/storage/db.js';
import { Retriever } from '../src/retriever/index.js';
import { Embedder } from '../src/indexer/embedder.js';

db.open();
db.migrate();

const embedder = new Embedder();
await embedder._getPipeline();

const retriever = new Retriever(embedder);
const results = await retriever.search(
  'Какой компонент отвечает за модальное окно истории реакций?',
  { topK: 10, threshold: 0.5 }
);

console.log('Results:', results.length);
for (const r of results) {
  console.log(`  ${r.filename} | sim=${r.similarity.toFixed(3)} | kw=${r._keywordScore.coverage.toFixed(2)} matched=${r._keywordScore.matched}`);
}
db.close();
process.exit(0);
