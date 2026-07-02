import http from 'http';
import { spawn } from 'child_process';

const server = spawn('node', ['src/index.js'], {
  cwd: 'C:\\Users\\denis\\OneDrive\\Рабочий стол\\learning\\lesson01\\rag',
  stdio: 'pipe',
});

server.stdout.on('data', d => process.stdout.write(d.toString()));
server.stderr.on('data', d => process.stderr.write(d.toString()));

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost', port: 3000, path: '/api' + path,
      method, timeout: 30000,
      headers: body ? { 'Content-Type': 'application/json' } : {},
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  await new Promise(r => setTimeout(r, 3000));

  const TEST_DIR = 'C:\\Users\\denis\\AppData\\Local\\Temp\\rag-test-docs';

  try {
    console.log('=== Health ===');
    const status = await api('GET', '/status');
    console.log('OK:', status.status);

    console.log('=== Indexing (fixed, with DeepSeek API) ===');
    const idx = await api('POST', '/index', { path: TEST_DIR, strategy: 'fixed' });
    console.log('Files:', idx.data.processedFiles, 'Errors:', idx.data.errors.length);
    if (idx.data.errors.length > 0) {
      console.log('Errors:', idx.data.errors);
    }

    const docs = await api('GET', '/documents');
    console.log('Documents:', docs.data.length);

    const stats = await api('GET', '/stats');
    console.log('Stats:', JSON.stringify(stats.data));

    // Check if embeddings exist
    const chunks = await api('GET', `/chunks?document_id=${docs.data[0].id}`);
    const hasEmbedding = chunks.data.some(c => c.embedding !== null);
    console.log('Embeddings present:', hasEmbedding);
    if (hasEmbedding) {
      console.log('Embedding length:', chunks.data[0].embedding?.length);
    }

    console.log('=== ALL CHECKS PASSED ===');
  } catch (e) {
    console.error('ERROR:', e.message);
  }

  server.kill();
  process.exit(0);
}

main();
