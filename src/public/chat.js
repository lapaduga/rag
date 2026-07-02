const API = '/api';
let currentMode = 'auto';

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

function addMessage(role, text, mode, sources) {
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
          </div>
        `).join('')}
      </div>
    `;
  }

  div.innerHTML = `
    <div class="message-content">
      ${badgeHtml}
      <div class="message-text">${escapeHtml(text)}</div>
      ${sourcesHtml}
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
    const res = await apiFetch('/query', {
      method: 'POST',
      body: JSON.stringify({ question, mode: currentMode }),
    });
    removeTyping();
    addMessage('assistant', res.data.answer, res.data.mode, res.data.sources);
  } catch (err) {
    removeTyping();
    addMessage('assistant', `Ошибка: ${err.message}`);
  }
}

async function compareModes() {
  const input = document.getElementById('compare-question');
  const question = input.value.trim();
  if (!question) return;

  const resultsDiv = document.getElementById('compare-results');
  resultsDiv.innerHTML = '<div class="empty-state">Сравнение...</div>';

  try {
    const res = await apiFetch('/query/compare', {
      method: 'POST',
      body: JSON.stringify({ questions: [question] }),
    });
    const data = res.data[0];
    resultsDiv.innerHTML = `
      <div class="compare-boxes">
        <div class="compare-box">
          <h4 class="mode-rag">RAG</h4>
          <p>${escapeHtml(data.rag.answer)}</p>
          <div class="compare-meta">${formatTiming(data.rag.timing.total)}</div>
          ${data.rag.sources.length > 0 ? `
            <div class="sources-toggle" onclick="this.nextElementSibling.classList.toggle('open')">
              Источники (${data.rag.sources.length})
            </div>
            <div class="sources-list">
              ${data.rag.sources.map(s => `
                <div class="source-item">
                  <span class="source-file">${escapeHtml(s.filename)}</span>
                  <span class="source-score">${(s.similarity * 100).toFixed(1)}%</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
        <div class="compare-box">
          <h4 class="mode-no-rag">No RAG</h4>
          <p>${escapeHtml(data.noRag.answer)}</p>
          <div class="compare-meta">${formatTiming(data.noRag.timing.total)}</div>
        </div>
      </div>
    `;
  } catch (err) {
    resultsDiv.innerHTML = `<div class="empty-state">Ошибка: ${err.message}</div>`;
  }
}

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = btn.dataset.mode;
  });
});

document.getElementById('btn-send').addEventListener('click', sendMessage);
document.getElementById('question-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
document.getElementById('btn-compare-modes').addEventListener('click', compareModes);
