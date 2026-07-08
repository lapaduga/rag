const API = '/api';
let currentMode = 'rag';
let currentProvider = 'deepseek';
let pipelineConfigOpen = false;
let currentThreadId = null;
let threads = [];

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

function playNotification() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.linearRampToValueAtTime(1320, t + 0.12);
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.35);
  } catch {}
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

function addMessage(role, text, mode, sources, pipeline, confidenceScore, hasEnoughContext, citations, isDontKnow, provider, timing) {
  const container = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = `message ${role}`;

  let badgeHtml = '';
  if (mode) {
    const modeLabel = { auto: 'Auto', rag: 'RAG', 'no-rag': 'No RAG' }[mode] || mode;
    badgeHtml = `<div class="message-badge mode-${mode}">${modeLabel}</div>`;
  }
  if (provider && role === 'assistant') {
    const provLabel = provider === 'local' ? 'Local' : 'DeepSeek';
    const provClass = provider === 'local' ? 'provider-local' : 'provider-deepseek';
    badgeHtml += `<div class="message-badge ${provClass}">${provLabel}</div>`;
  }
  if (timing && role === 'assistant') {
    const llmStage = pipeline?.stages?.find(s => s.stage === 'llm');
    const llmMs = llmStage?.time_ms || timing.llm || timing.total || 0;
    const label = llmMs < 1000 ? `${llmMs}ms` : `${(llmMs / 1000).toFixed(1)}s`;
    badgeHtml += `<div class="message-badge badge-timing">${label}</div>`;
  }

  let translateHtml = '';
  if (pipeline && pipeline.stages) {
    const translateStage = pipeline.stages.find(s => s.stage === 'translate');
    if (translateStage && translateStage.query && pipeline.originalQuery) {
      translateHtml = `<div class="translate-banner"><span class="translate-label">RU:</span> ${escapeHtml(pipeline.originalQuery)} <span class="translate-arrow">→</span> <span class="translate-label">EN:</span> ${escapeHtml(translateStage.query)}</div>`;
    }
  }

  let dontKnowHtml = '';
  if (isDontKnow) {
    dontKnowHtml = `<div class="dont-know-badge">Не знаю</div>`;
  }

  let warningHtml = '';
  if (hasEnoughContext === false && !isDontKnow) {
    warningHtml = `<div class="context-warning">⚠️ Контекст недостаточно релевантен (confidence: ${(confidenceScore * 100).toFixed(1)}%). Ответ может содержать галлюцинации.</div>`;
  }

  let sourcesHtml = '';
  if (!isDontKnow && sources && sources.length > 0) {
    sourcesHtml = `
      <div class="sources-toggle" onclick="this.nextElementSibling.classList.toggle('open')">
        Источники (${sources.length})
      </div>
      <div class="sources-list">
        ${sources.map(s => `
          <div class="source-item">
            <span class="source-file" title="${escapeHtml(s.filename)}">${escapeHtml(s.path || s.filename)}</span>
            <span class="source-section">${escapeHtml(s.section || '')}</span>
            <span class="source-score">${(s.similarity * 100).toFixed(1)}%</span>
            ${s.rerankScore != null ? `<span class="source-rerank">R:${(s.rerankScore * 100).toFixed(1)}%</span>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  let citationsHtml = '';
  if (!isDontKnow && citations && citations.length > 0) {
    const validCount = citations.filter(c => c.isValid).length;
    citationsHtml = `
      <div class="citations-section">
        <div class="citations-header" onclick="this.nextElementSibling.classList.toggle('open')">
          Цитаты (${validCount}/${citations.length} валидны) ▾
        </div>
        <div class="citations-list">
          ${citations.map((c, i) => `
            <div class="citation-item ${c.isValid ? '' : 'invalid'}">
              <div class="citation-meta">
                <span class="citation-num">#${c.sourceIdx != null ? c.sourceIdx : i}</span>
                <span class="citation-file">${escapeHtml(c.filename)}</span>
                <span class="citation-chunk">${c.chunkId?.slice(0, 8) || ''}</span>
                <span class="citation-${c.isValid ? 'valid' : 'invalid'}">${c.isValid ? '✓ валидна' : '✗ невалидна'}</span>
              </div>
              <pre class="citation-quote"><code>${escapeHtml(c.quote)}</code></pre>
            </div>
          `).join('')}
        </div>
        <div class="validation-status ${validCount === citations.length ? 'valid' : 'invalid'}">
          ${validCount === citations.length ? '✓ Все цитаты валидны' : `⚠️ ${citations.length - validCount} цитат не прошли валидацию`}
        </div>
      </div>
    `;
  }

  let pipelineHtml = '';
  if (pipeline && pipeline.stages && pipeline.stages.length > 0) {
    const stageLabels = {
      translate: { label: 'Translate', color: 'stage-translate' },
      rewrite: { label: 'Rewrite', color: 'stage-rewrite' },
      retrieval: { label: 'Retrieval', color: 'stage-retrieval' },
      rerank: { label: 'Rerank', color: 'stage-rerank' },
      filter: { label: 'Filter', color: 'stage-filter' },
      topK: { label: 'Top-K', color: 'stage-topk' },
      llm: { label: 'LLM', color: 'stage-llm' },
      'citation-parse': { label: 'Citation Parse', color: 'stage-citation' },
      'low-confidence-guard': { label: 'Low Confidence', color: 'stage-lowconf' },
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
            else if (st.stage === 'citation-parse') detail = ` ${st.citationCount} cit. (${st.validCount} valid)`;
            else if (st.stage === 'low-confidence-guard') detail = ` ${((st.confidenceScore || 0) * 100).toFixed(1)}% < ${((st.minConfidence || 0) * 100).toFixed(0)}%`;
            return `<div class="pipeline-stage ${info.color}"><span class="stage-name">${info.label}</span><span class="stage-detail">${detail}</span><span class="stage-time">${formatTiming(st.time_ms)}</span></div>`;
          }).join('')}
          <div class="pipeline-total">Total: ${formatTiming(total)}</div>
          <div class="pipeline-confidence ${(confidenceScore || 0) < 0.3 ? 'low' : ''}">Confidence: ${((confidenceScore || 0) * 100).toFixed(1)}% | Citations: ${citations?.length || 0} | Valid: ${citations?.filter(c => c.isValid).length || 0}</div>
        </div>
      </div>
    `;
  }

  div.innerHTML = `
    <div class="message-content">
      ${badgeHtml}${translateHtml}${dontKnowHtml}${warningHtml}
      <div class="message-text ${isDontKnow ? 'dont-know-message' : ''}">${escapeHtml(text)}</div>
      ${sourcesHtml}${citationsHtml}${pipelineHtml}
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

// === Threads ===

async function loadThreads() {
  try {
    const res = await apiFetch('/threads');
    threads = res.data;
    renderThreadsList();
  } catch (err) {
    console.error('Ошибка загрузки диалогов:', err);
  }
}

function renderThreadsList() {
  const list = document.getElementById('threads-list');
  if (!threads || threads.length === 0) {
    list.innerHTML = '<div class="empty-state">Нет диалогов</div>';
    return;
  }
  list.innerHTML = threads.map(t => {
    const date = new Date(t.updated_at || t.created_at);
    const dateStr = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const msgCount = t.message_count || 0;
    const isActive = t.id === currentThreadId;
    return `
      <div class="thread-item ${isActive ? 'active' : ''}" data-thread-id="${t.id}">
        <div class="thread-item-main">
          <div class="thread-title">${escapeHtml(t.title || 'Без названия')}</div>
          <div class="thread-meta">${msgCount} сообщ. · ${dateStr}</div>
        </div>
        <button class="thread-delete-btn" data-thread-id="${t.id}" title="Удалить диалог">×</button>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.thread-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.thread-delete-btn')) return;
      const id = parseInt(el.dataset.threadId, 10);
      switchThread(id);
    });
  });

  list.querySelectorAll('.thread-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.threadId, 10);
      const thread = threads.find(t => t.id === id);
      const title = thread ? thread.title || 'без названия' : 'диалог';
      if (!confirm(`Удалить диалог «${title}»?`)) return;
      try {
        await apiFetch(`/threads/${id}`, { method: 'DELETE' });
        threads = threads.filter(t => t.id !== id);
        if (id === currentThreadId) {
          const next = threads[0] || null;
          if (next) {
            currentThreadId = next.id;
            renderThreadsList();
            await loadThreadMessages(currentThreadId);
          } else {
            currentThreadId = null;
            renderThreadsList();
            document.getElementById('messages').innerHTML = '';
            addWelcomeMessage();
          }
        } else {
          renderThreadsList();
        }
      } catch (err) {
        showError('Ошибка удаления диалога: ' + err.message);
      }
    });
  });
}

async function createThread() {
  try {
    const res = await apiFetch('/threads', {
      method: 'POST',
      body: JSON.stringify({ title: 'Новый диалог' }),
    });
    currentThreadId = res.data.id;
    await loadThreads();
    document.getElementById('messages').innerHTML = '';
    addWelcomeMessage();
  } catch (err) {
    showError('Ошибка создания диалога: ' + err.message);
  }
}

async function switchThread(threadId) {
  if (threadId === currentThreadId) return;
  currentThreadId = threadId;

  document.querySelectorAll('.thread-item').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.threadId, 10) === threadId);
  });

  await loadThreadMessages(threadId);
}

async function loadThreadMessages(threadId) {
  try {
    const res = await apiFetch(`/threads/${threadId}/messages`);
    const messages = res.data;
    const container = document.getElementById('messages');
    container.innerHTML = '';
    if (!messages || messages.length === 0) {
      addWelcomeMessage();
    } else {
      for (const msg of messages) {
        const mode = msg.role === 'assistant' ? (msg.mode || 'rag') : null;
        addMessage(msg.role, msg.content, mode,
          msg.sources, msg.pipeline, msg.confidence_score, msg.has_enough_context,
          msg.citations, msg.is_dont_know, msg.provider || currentProvider);
      }
    }
    container.scrollTop = container.scrollHeight;
    await loadThreadMemory(threadId);
  } catch (err) {
    showError('Ошибка загрузки сообщений: ' + err.message);
  }
}

function addWelcomeMessage() {
  const container = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.innerHTML = `<div class="message-content"><p>Привет! Я — ассистент по кодовой базе. Задай вопрос о проекте.</p></div>`;
  container.appendChild(div);
}

// === Memory ===

async function loadThreadMemory(threadId) {
  try {
    const res = await apiFetch(`/threads/${threadId}/memory`);
    const memory = res.data;
    renderMemory(memory);
  } catch (err) {
    console.error('Ошибка загрузки памяти:', err);
  }
}

function renderMemory(memory) {
  const content = document.getElementById('memory-content');
  if (!memory || memory.length === 0) {
    content.innerHTML = '<span class="memory-empty">Нет сохраненной памяти</span>';
    return;
  }
  const byType = {};
  for (const item of memory) {
    if (!byType[item.type]) byType[item.type] = [];
    byType[item.type].push(item);
  }
  let html = '';
  if (byType.goal) html += `<div class="memory-item"><span class="memory-label">Цель:</span> ${escapeHtml(byType.goal[0].value)}</div>`;
  if (byType.constraint) html += byType.constraint.map(c => `<div class="memory-item"><span class="memory-label">Ограничение:</span> ${escapeHtml(c.value)}</div>`).join('');
  if (byType.term) html += `<div class="memory-item"><span class="memory-label">Термины:</span> ${byType.term.map(t => escapeHtml(t.value)).join(', ')}</div>`;
  if (byType.clarification) html += byType.clarification.map(c => `<div class="memory-item"><span class="memory-label">Уточнение:</span> ${escapeHtml(c.value)}</div>`).join('');
  content.innerHTML = html;
  const body = document.getElementById('memory-section-body');
  const arrow = document.getElementById('memory-section-arrow');
  if (html) {
    body.classList.add('open');
    arrow.classList.add('open');
  } else {
    body.classList.remove('open');
    arrow.classList.remove('open');
  }
}

async function saveMemory() {
  if (!currentThreadId) return;
  const goal = document.getElementById('memory-goal').value.trim();
  const constraints = document.getElementById('memory-constraints').value.trim();
  try {
    if (goal) {
      await apiFetch(`/threads/${currentThreadId}/memory`, {
        method: 'POST',
        body: JSON.stringify({ key: 'goal', value: goal, type: 'goal' }),
      });
    }
    if (constraints) {
      await apiFetch(`/threads/${currentThreadId}/memory`, {
        method: 'POST',
        body: JSON.stringify({ key: 'constraint_' + Date.now(), value: constraints, type: 'constraint' }),
      });
    }
    document.getElementById('memory-edit').style.display = 'none';
    await loadThreadMemory(currentThreadId);
  } catch (err) {
    showError('Ошибка сохранения памяти: ' + err.message);
  }
}

async function clearMemory() {
  if (!currentThreadId) return;
  try {
    await apiFetch(`/threads/${currentThreadId}/memory/clear`, { method: 'POST' });
    await loadThreadMemory(currentThreadId);
  } catch (err) {
    showError('Ошибка очистки памяти: ' + err.message);
  }
}

async function clearChat() {
  if (!currentThreadId) return;
  if (!confirm('Очистить все сообщения в этом диалоге?')) return;
  try {
    await apiFetch(`/threads/${currentThreadId}/clear-messages`, { method: 'POST' });
    document.getElementById('messages').innerHTML = '';
    addWelcomeMessage();
  } catch (err) {
    showError('Ошибка очистки чата: ' + err.message);
  }
}

async function deleteCurrentThread() {
  if (!currentThreadId) return;
  const thread = threads.find(t => t.id === currentThreadId);
  const title = thread ? thread.title || 'без названия' : 'диалог';
  if (!confirm(`Удалить диалог «${title}»? Сообщения и память будут удалены безвозвратно.`)) return;
  try {
    const deletedId = currentThreadId;
    await apiFetch(`/threads/${deletedId}`, { method: 'DELETE' });
    threads = threads.filter(t => t.id !== deletedId);
    const next = threads[0] || null;
    if (next) {
      currentThreadId = next.id;
      renderThreadsList();
      await loadThreadMessages(currentThreadId);
    } else {
      currentThreadId = null;
      renderThreadsList();
      document.getElementById('messages').innerHTML = '';
      addWelcomeMessage();
    }
  } catch (err) {
    showError('Ошибка удаления диалога: ' + err.message);
  }
}

function toggleMemoryEdit() {
  const edit = document.getElementById('memory-edit');
  edit.style.display = edit.style.display === 'none' ? 'flex' : 'none';
  if (edit.style.display === 'flex') {
    const goalItem = document.querySelector('.memory-item .memory-label');
    document.getElementById('memory-goal').value = '';
    document.getElementById('memory-constraints').value = '';
  }
}

function showError(msg) {
  console.error(msg);
  const toast = document.getElementById('error-toast') || (() => {
    const el = document.createElement('div');
    el.id = 'error-toast';
    el.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#e74c3c;color:#fff;padding:12px 20px;border-radius:8px;z-index:9999;max-width:400px;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);cursor:pointer';
    el.onclick = () => el.remove();
    document.body.appendChild(el);
    return el;
  })();
  toast.textContent = msg;
  toast.style.display = 'block';
  clearTimeout(toast._hide);
  toast._hide = setTimeout(() => toast.remove(), 5000);
}

// === Send ===

async function sendMessage() {
  const input = document.getElementById('question-input');
  const question = input.value.trim();
  if (!question) return;
  input.value = '';

  if (!currentThreadId) {
    await createThread();
  }

  addMessage('user', question);

  const sendBtn = document.getElementById('btn-send');
  sendBtn.disabled = true;
  sendBtn.textContent = '⏳';
  addTyping();

  try {
    const pipeline = getPipelineConfig();
    const hasPipeline = pipeline.queryRewrite || pipeline.reranker || pipeline.threshold != null ||
      pipeline.topKBefore !== 20 || pipeline.topKAfter !== 15;

    const body = {
      question,
      mode: currentMode,
      provider: currentProvider,
      pipeline: hasPipeline ? pipeline : undefined,
      thread_id: currentThreadId,
    };

    const res = await apiFetch('/query', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    removeTyping();
    addMessage('assistant', res.data.answer, res.data.mode, res.data.sources, res.data.pipeline,
      res.data.confidenceScore, res.data.hasEnoughContext, res.data.citations, res.data.isDontKnow,
      res.data.provider, res.data.timing);
    playNotification();

    await loadThreads();
    await loadThreadMemory(currentThreadId);
  } catch (err) {
    removeTyping();
    addMessage('assistant', `Ошибка: ${err.message}`);
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Отправить';
  }
}

function togglePipelineConfig() {
  const panel = document.getElementById('pipeline-config');
  const btn = document.getElementById('btn-pipeline-toggle');
  pipelineConfigOpen = !pipelineConfigOpen;
  panel.classList.toggle('open', pipelineConfigOpen);
  btn.textContent = pipelineConfigOpen ? 'Pipeline ▴' : 'Pipeline ▾';
}

function toggleMemorySection() {
  const body = document.getElementById('memory-section-body');
  const arrow = document.getElementById('memory-section-arrow');
  const isOpen = body.classList.toggle('open');
  arrow.classList.toggle('open', isOpen);
}

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = btn.dataset.mode;
  });
});

document.querySelectorAll('.provider-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.provider-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentProvider = btn.dataset.provider;
  });
});

async function checkOllamaStatus() {
  const statusEl = document.getElementById('ollama-status');
  try {
    const res = await fetch(`${API}/ollama/status`);
    const data = await res.json();
    if (data.success && data.data.available) {
      statusEl.textContent = '●';
      statusEl.className = 'provider-status online';
    } else {
      statusEl.textContent = '●';
      statusEl.className = 'provider-status offline';
    }
  } catch {
    statusEl.textContent = '●';
    statusEl.className = 'provider-status offline';
  }
}

checkOllamaStatus();

async function pollSystemStats() {
  try {
    const res = await fetch(`${API}/system-stats`);
    const json = await res.json();
    if (!json.success) return;
    const d = json.data;
    const ramEl = document.getElementById('stat-ram');
    const cpuEl = document.getElementById('stat-cpu');
    if (ramEl) ramEl.textContent = `RAM: ${d.ram.percent}% (${(d.ram.used / 1073741824).toFixed(1)}/${(d.ram.total / 1073741824).toFixed(1)} GB)`;
    if (cpuEl) cpuEl.textContent = `CPU: ${d.cpu.usagePercent}%`;
  } catch {}
}

pollSystemStats();
setInterval(pollSystemStats, 2000);

document.getElementById('btn-send').addEventListener('click', sendMessage);
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

document.getElementById('memory-section-toggle').addEventListener('click', toggleMemorySection);

document.getElementById('btn-new-thread').addEventListener('click', async () => {
  await createThread();
});

document.getElementById('btn-toggle-memory-edit').addEventListener('click', toggleMemoryEdit);
document.getElementById('btn-save-memory').addEventListener('click', saveMemory);
document.getElementById('btn-clear-memory').addEventListener('click', clearMemory);
document.getElementById('btn-clear-chat').addEventListener('click', clearChat);

async function loadConfig() {
  try {
    const res = await apiFetch('/config');
    if (res.success && res.data.provider) {
      currentProvider = res.data.provider;
      document.querySelectorAll('.provider-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.provider === currentProvider);
      });
    }
  } catch (e) {
    console.warn('Failed to load config:', e);
  }
}

(async () => {
  await loadConfig();
  loadThreads();
})();
