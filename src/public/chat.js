const API = '/api';
let currentMode = 'auto';
let pipelineConfigOpen = false;

const $ = id => document.getElementById(id);

async function apiFetch(url, options = {}) {
  const res = await fetch(`${API}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (data.error) throw new Error(data.message);
  return data;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTiming(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function getPipelineConfig() {
  return {
    queryRewrite: $('cfg-rewrite').checked,
    reranker: $('cfg-reranker').checked,
    threshold: $('cfg-threshold-enable').checked ? parseFloat($('cfg-threshold').value) : null,
    topKBefore: parseInt($('cfg-topk-before').value, 10) || 20,
    topKAfter: parseInt($('cfg-topk-after').value, 10) || 5,
  };
}

function addMessage(role, text, mode, sources, pipeline) {
  const container = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = `message ${role}`;

  let badgeHtml = '';
  if (mode) {
    const modeLabel = { auto: 'Auto', rag: 'RAG', 'no-rag': 'No RAG' }[mode] || mode;
    badgeHtml = `<div class="message-badge mode-${mode}">${modeLabel}</div>`;
  }

  let sourcesHtml = '';
  if (sources && sources.length > 0) {
    sourcesHtml = `
      <div class="sources-toggle" onclick="this.nextElementSibling.classList.toggle('open')">
        Источники (${sources.length})
      </div>
      <div class="sources-list">
        ${sources.map(s => `
          <div class="source-item">
            <span class="source-file">${escapeHtml(s.filename)}</span>
            <span class="source-score">${(s.similarity * 100).toFixed(1)}%</span>
            ${s.rerankScore != null ? `<span class="source-rerank">R:${(s.rerankScore * 100).toFixed(1)}%</span>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  let pipelineHtml = '';
  if (pipeline && pipeline.stages && pipeline.stages.length > 0) {
    const stageLabels = {
      rewrite: { label: 'Rewrite', color: 'stage-rewrite' },
      retrieval: { label: 'Retrieval', color: 'stage-retrieval' },
      rerank: { label: 'Rerank', color: 'stage-rerank' },
      filter: { label: 'Filter', color: 'stage-filter' },
      topK: { label: 'Top-K', color: 'stage-topk' },
      llm: { label: 'LLM', color: 'stage-llm' },
    };
    const total = pipeline.stages.reduce((s, st) => s + (st.time_ms || 0), 0);

    pipelineHtml = `
      <div class="pipeline-debug">
        <div class="pipeline-debug-header" onclick="this.nextElementSibling.classList.toggle('open')">
          Pipeline ▸
        </div>
        <div class="pipeline-debug-body">
          ${pipeline.stages.map(st => {
            const info = stageLabels[st.stage] || { label: st.stage, color: '' };
            let detail = '';
            if (st.stage === 'retrieval') detail = ` ${st.count} chunks`;
            else if (st.stage === 'rerank') detail = ` ${st.count} items`;
            else if (st.stage === 'filter' && st.before != null) detail = ` ${st.before}→${st.count} (threshold ${$('cfg-threshold')?.value || '?'})`;
            else if (st.stage === 'topK') detail = ` ${st.count} items`;
            return `<div class="pipeline-stage ${info.color}"><span class="stage-name">${info.label}</span><span class="stage-detail">${detail}</span><span class="stage-time">${formatTiming(st.time_ms)}</span></div>`;
          }).join('')}
          <div class="pipeline-total">Total: ${formatTiming(total)}</div>
        </div>
      </div>
    `;
  }

  div.innerHTML = `
    <div class="message-content">
      ${badgeHtml}
      <div class="message-text">${escapeHtml(text)}</div>
      ${sourcesHtml}
      ${pipelineHtml}
    </div>
  `;

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function addTyping() {
  const container = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'message assistant typing';
  div.id = 'typing-indicator';
  div.innerHTML = '<div class="message-content"><div class="typing-dots"><span>.</span><span>.</span><span>.</span></div></div>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function removeTyping() {
  const el = document.getElementById('typing-indicator');
  if (el) el.remove();
}

async function sendMessage() {
  const input = document.getElementById('question-input');
  const question = input.value.trim();
  if (!question) return;

  addMessage('user', question);
  input.value = '';
  addTyping();

  try {
    const pipeline = getPipelineConfig();
    const hasPipeline = pipeline.queryRewrite || pipeline.reranker || pipeline.threshold != null ||
      pipeline.topKBefore !== 20 || pipeline.topKAfter !== 5;

    const body = {
      question,
      mode: currentMode,
      pipeline: hasPipeline ? pipeline : undefined,
    };

    const res = await apiFetch('/query', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    removeTyping();
    addMessage('assistant', res.data.answer, res.data.mode, res.data.sources, res.data.pipeline);
  } catch (err) {
    removeTyping();
    addMessage('assistant', `Ошибка: ${err.message}`);
  }
}

function togglePipelineConfig() {
  const panel = document.getElementById('pipeline-config');
  const btn = document.getElementById('btn-pipeline-toggle');
  pipelineConfigOpen = !pipelineConfigOpen;
  panel.classList.toggle('open', pipelineConfigOpen);
  btn.textContent = pipelineConfigOpen ? 'Pipeline Config ▴' : 'Pipeline Config ▾';
}

async function openCompareModal() {
  const input = document.getElementById('question-input');
  const question = input.value.trim();
  if (!question) return;

  const modal = document.getElementById('compare-modal');
  const body = document.getElementById('compare-modal-body');
  body.innerHTML = '<div class="empty-state">Загрузка...</div>';
  modal.classList.remove('hidden');

  const pipelines = [
    { name: 'baseline', queryRewrite: false, reranker: false, threshold: null, topKBefore: 20, topKAfter: 5 },
    { name: 'filter', queryRewrite: false, reranker: false, threshold: 0.5, topKBefore: 20, topKAfter: 5 },
    { name: 'rerank', queryRewrite: false, reranker: true, threshold: null, topKBefore: 20, topKAfter: 5 },
    { name: 'full', queryRewrite: true, reranker: true, threshold: 0.5, topKBefore: 20, topKAfter: 5 },
  ];

  try {
    const res = await apiFetch('/query/compare', {
      method: 'POST',
      body: JSON.stringify({ question, pipelines }),
    });

    const data = res.data;
    body.innerHTML = `
      <div class="compare-grid">
        ${data.map((r, idx) => {
          const totalTime = r.timing?.total || 0;
          const bestTime = Math.min(...data.map(d => d.timing?.total || Infinity));
          const bestSources = Math.max(...data.map(d => d.sources?.length || 0));
          const isBestTime = totalTime <= bestTime + 50;
          const isBestSources = (r.sources?.length || 0) >= bestSources;

          return `
            <div class="compare-col ${isBestTime && isBestSources ? 'compare-best' : ''}">
              <div class="compare-col-header ${r.name}">${r.name.toUpperCase()}</div>
              <div class="compare-col-body">
                <div class="compare-answer">${escapeHtml(r.answer)}</div>
                <div class="compare-meta-row">
                  <span class="compare-label">Источники:</span>
                  <span class="compare-value">${r.sources?.length || 0}</span>
                  ${isBestSources ? '<span class="compare-badge">best</span>' : ''}
                </div>
                <div class="compare-meta-row">
                  <span class="compare-label">Время:</span>
                  <span class="compare-value">${formatTiming(totalTime)}</span>
                  ${isBestTime ? '<span class="compare-badge">best</span>' : ''}
                </div>
                <div class="compare-stages">
                  ${(r.pipeline?.stages || []).map(st =>
                    `<div class="compare-stage"><span>${st.stage}</span><span>${formatTiming(st.time_ms)}</span></div>`
                  ).join('')}
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } catch (err) {
    body.innerHTML = `<div class="empty-state">Ошибка: ${err.message}</div>`;
  }
}

function closeCompareModal() {
  document.getElementById('compare-modal').classList.add('hidden');
}

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = btn.dataset.mode;
  });
});

document.getElementById('btn-send').addEventListener('click', sendMessage);
document.getElementById('btn-compare').addEventListener('click', openCompareModal);
document.getElementById('question-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

document.getElementById('cfg-threshold-enable').addEventListener('change', function() {
  document.getElementById('cfg-threshold').disabled = !this.checked;
});

document.getElementById('cfg-threshold').addEventListener('input', function() {
  document.getElementById('cfg-threshold-value').textContent = this.value;
});

document.getElementById('compare-modal').addEventListener('click', function(e) {
  if (e.target === this) closeCompareModal();
});
