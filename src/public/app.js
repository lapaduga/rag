const API = '/api';

let documents = [];

async function apiFetch(url, options = {}) {
  const res = await fetch(`${API}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (data.error) throw new Error(data.message);
  return data;
}

async function loadDocuments() {
  try {
    const res = await apiFetch('/documents');
    documents = res.data;
    renderDocList();
    document.getElementById('doc-count').textContent = documents.length;
  } catch (err) {
    showError('Ошибка загрузки документов: ' + err.message);
  }
}

async function loadStats() {
  try {
    const res = await apiFetch('/stats');
    const stats = res.data;
    document.getElementById('doc-count').textContent = stats.documents;
  } catch {}
}

async function startIndexing() {
  const strategy = document.getElementById('strategy').value;
  const btn = document.getElementById('btn-index');
  const progressBar = document.getElementById('progress-bar');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');

  btn.disabled = true;
  progressBar.style.display = 'flex';

  try {
    const res = await apiFetch('/index', {
      method: 'POST',
      body: JSON.stringify({ path: 'C:\\defined\\front', strategy }),
    });
    const data = res.data;

    progressFill.style.width = '100%';
    progressText.textContent = `${data.totalFiles} / ${data.totalFiles}`;

    if (data.errors.length > 0) {
      console.warn('Errors during indexing:', data.errors);
    }

    await loadDocuments();
    await loadStats();
  } catch (err) {
    showError('Ошибка индексации: ' + err.message);
  } finally {
    btn.disabled = false;
    setTimeout(() => { progressBar.style.display = 'none'; }, 2000);
  }
}

async function compareStrategies() {
  const btn = document.getElementById('btn-compare');
  const panel = document.getElementById('comparison-panel');

  btn.disabled = true;

  try {
    const res = await apiFetch('/index/compare', {
      method: 'POST',
      body: JSON.stringify({ path: 'C:\\defined\\front' }),
    });
    renderComparison(res.data);
  } catch (err) {
    panel.innerHTML = `<div class="empty-state">Ошибка: ${err.message}</div>`;
  } finally {
    btn.disabled = false;
  }
}

async function clearIndex() {
  if (!confirm('Очистить весь индекс?')) return;

  try {
    await apiFetch('/index', { method: 'DELETE' });
    documents = [];
    renderDocList();
    document.getElementById('doc-count').textContent = '0';
    document.getElementById('doc-detail').innerHTML = '<div class="empty-state">Выберите документ из списка</div>';
    document.getElementById('comparison-panel').innerHTML = '<div class="empty-state">Запустите сравнение стратегий</div>';
  } catch (err) {
    showError('Ошибка очистки: ' + err.message);
  }
}

async function showDocDetail(doc) {
  const detail = document.getElementById('doc-detail');

  let chunksHtml = '<div class="detail-section"><h3>Чанки</h3>';
  try {
    const res = await apiFetch(`/chunks?document_id=${doc.id}`);
    const chunks = res.data;
    if (chunks.length === 0) {
      chunksHtml += '<div class="empty-state">Нет чанков</div>';
    } else {
      for (const chunk of chunks) {
        const meta = chunk.metadata || {};
        chunksHtml += `
          <div class="chunk-card">
            <div class="chunk-card-header" onclick="this.nextElementSibling.classList.toggle('open')">
              <span class="chunk-label">#${chunk.chunk_index} — ${meta.title || 'untitled'}</span>
              <span class="chunk-meta">${chunk.strategy} | ${chunk.content.length} симв.</span>
            </div>
            <div class="chunk-card-body">
              <pre>${escapeHtml(chunk.content)}</pre>
            </div>
          </div>
        `;
      }
    }
  } catch {
    chunksHtml += '<div class="empty-state">Ошибка загрузки чанков</div>';
  }
  chunksHtml += '</div>';

  detail.innerHTML = `
    <div class="detail-section">
      <h3>Метаданные</h3>
      <dl class="detail-meta">
        <dt>Имя</dt><dd>${escapeHtml(doc.filename)}</dd>
        <dt>Расширение</dt><dd class="doc-ext">${doc.extension}</dd>
        <dt>Размер</dt><dd>${formatBytes(doc.size_bytes)}</dd>
        <dt>Путь</dt><dd>${escapeHtml(doc.path)}</dd>
        <dt>Индексирован</dt><dd>${doc.indexed_at || '-'}</dd>
      </dl>
    </div>
    ${chunksHtml}
  `;
}

function renderDocList() {
  const list = document.getElementById('doc-list');
  if (documents.length === 0) {
    list.innerHTML = '<div class="empty-state">Нет проиндексированных документов</div>';
    return;
  }
  list.innerHTML = documents.map(doc => `
    <div class="doc-item" onclick="showDocDetail(documents.find(d => d.id === ${doc.id}))">
      <div class="doc-name">${escapeHtml(doc.filename)}</div>
      <div class="doc-meta">
        <span class="doc-ext">${doc.extension}</span>
        <span>${formatBytes(doc.size_bytes)}</span>
      </div>
    </div>
  `).join('');
}

function renderComparison(data) {
  const panel = document.getElementById('comparison-panel');
  const fixed = data.fixed || {};
  const semantic = data.semantic || {};
  const maxChunks = Math.max(fixed.total_chunks || 0, semantic.total_chunks || 0);
  const maxSize = Math.max(fixed.avg_chunk_size || 0, semantic.avg_chunk_size || 0);

  panel.innerHTML = `
    <div class="strategy-compare">
      <div class="compared-boxes">
        <div class="compared-box fixed">
          <h4>Fixed</h4>
          <div class="stat-row">
            <span class="stat-label">Чанков</span>
            <span class="stat-value">${fixed.total_chunks || 0}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Средний размер</span>
            <span class="stat-value">${formatBytes(fixed.avg_chunk_size || 0)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Всего токенов</span>
            <span class="stat-value">${(fixed.total_tokens || 0).toLocaleString()}</span>
          </div>
        </div>
        <div class="compared-box semantic">
          <h4>Semantic</h4>
          <div class="stat-row">
            <span class="stat-label">Чанков</span>
            <span class="stat-value">${semantic.total_chunks || 0}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Средний размер</span>
            <span class="stat-value">${formatBytes(semantic.avg_chunk_size || 0)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Всего токенов</span>
            <span class="stat-value">${(semantic.total_tokens || 0).toLocaleString()}</span>
          </div>
        </div>
      </div>
      <div class="compare-chart">
        <div class="chart-bar-wrapper">
          <div class="chart-label">Всего чанков</div>
          <div class="chart-bar-bg">
            <div class="chart-bar-fill fixed" style="width: ${maxChunks > 0 ? (fixed.total_chunks / maxChunks * 100) : 0}%"></div>
            <span class="chart-value">${fixed.total_chunks || 0}</span>
          </div>
          <div class="chart-bar-bg" style="margin-top:4px;">
            <div class="chart-bar-fill semantic" style="width: ${maxChunks > 0 ? (semantic.total_chunks / maxChunks * 100) : 0}%"></div>
            <span class="chart-value">${semantic.total_chunks || 0}</span>
          </div>
        </div>
        <div class="chart-bar-wrapper">
          <div class="chart-label">Средний размер чанка</div>
          <div class="chart-bar-bg">
            <div class="chart-bar-fill fixed" style="width: ${maxSize > 0 ? (fixed.avg_chunk_size / maxSize * 100) : 0}%"></div>
            <span class="chart-value">${formatBytes(fixed.avg_chunk_size || 0)}</span>
          </div>
          <div class="chart-bar-bg" style="margin-top:4px;">
            <div class="chart-bar-fill semantic" style="width: ${maxSize > 0 ? (semantic.avg_chunk_size / maxSize * 100) : 0}%"></div>
            <span class="chart-value">${formatBytes(semantic.avg_chunk_size || 0)}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function showError(msg) {
  console.error(msg);
}

document.getElementById('btn-index').addEventListener('click', startIndexing);
document.getElementById('btn-compare').addEventListener('click', compareStrategies);
document.getElementById('btn-clear').addEventListener('click', clearIndex);

loadDocuments();
