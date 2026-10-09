// GoNex web chat client. Talks to the GoNex API on the same origin.
(() => {
  'use strict';

  const API_BASE = ''; // same origin
  const STORAGE_KEY = 'gonex.chat.v1';
  const MAX_CHARS = 2000;
  const REQUEST_TIMEOUT_MS = 90_000;
  const SLOW_NOTE_AFTER_MS = 8_000;

  const $ = (id) => document.getElementById(id);
  const chatEl = $('chat');
  const messagesEl = $('messages');
  const welcomeEl = $('welcome');
  const form = $('composer');
  const input = $('input');
  const sendBtn = $('sendBtn');
  const counter = $('counter');
  const newChatBtn = $('newChatBtn');
  const statusDot = $('statusDot');
  const statusText = $('statusText');

  /** @type {{ conversationId?: string, messages: { role: 'user'|'bot', text: string, time: number }[] }} */
  let state = load();
  let pending = false;

  // ---------- persistence (per browser tab) ----------
  function load() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.messages)) return parsed;
      }
    } catch { /* storage unavailable */ }
    return { messages: [] };
  }
  function save() {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }

  // ---------- rendering ----------
  const escapeHtml = (s) =>
    s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function inline(s) {
    return escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1<em>$2</em>');
  }

  /** Minimal, safe Markdown: paragraphs, line breaks, bullet/numbered lists, bold, italics, code. */
  function renderMarkdown(text) {
    const out = [];
    let list = null;
    let para = [];
    const flushPara = () => {
      if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
      para = [];
    };
    const closeList = () => {
      if (list) out.push(`</${list}>`);
      list = null;
    };
    for (const raw of text.replace(/\r/g, '').split('\n')) {
      const line = raw.trimEnd();
      const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
      const ol = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
      if (ul || ol) {
        flushPara();
        const type = ul ? 'ul' : 'ol';
        if (list !== type) {
          closeList();
          out.push(type === 'ol' && ol[1] !== '1' ? `<ol start="${Number(ol[1])}">` : `<${type}>`);
          list = type;
        }
        out.push(`<li>${inline(ul ? ul[1] : ol[2])}</li>`);
      } else if (!line.trim()) {
        flushPara();
        closeList();
      } else {
        closeList();
        para.push(line.replace(/^#{1,6}\s+/, ''));
      }
    }
    flushPara();
    closeList();
    return out.join('');
  }

  const timeLabel = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  function messageNode(role, { html, text, time, extraClass } = {}) {
    const row = document.createElement('div');
    row.className = `msg ${role === 'user' ? 'user' : 'bot'}${extraClass ? ` ${extraClass}` : ''}`;
    if (role !== 'user') {
      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = 'G';
      row.append(avatar);
    }
    const stack = document.createElement('div');
    stack.className = 'stack';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (html !== undefined) bubble.innerHTML = html;
    else bubble.textContent = text ?? '';
    stack.append(bubble);
    if (time) {
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `${role === 'user' ? 'You' : 'GoNex'} · ${timeLabel(time)}`;
      stack.append(meta);
    }
    row.append(stack);
    return { row, bubble };
  }

  function appendMessage(msg) {
    const node =
      msg.role === 'user'
        ? messageNode('user', { text: msg.text, time: msg.time })
        : messageNode('bot', { html: renderMarkdown(msg.text), time: msg.time });
    messagesEl.append(node.row);
    return node;
  }

  function renderAll() {
    messagesEl.replaceChildren();
    state.messages.forEach(appendMessage);
    welcomeEl.hidden = state.messages.length > 0;
    scrollToBottom();
  }

  function scrollToBottom() {
    requestAnimationFrame(() => { chatEl.scrollTop = chatEl.scrollHeight; });
  }

  function showTyping() {
    const { row, bubble } = messageNode('bot', {
      html: '<span class="typing" aria-label="GoNex is typing"><span></span><span></span><span></span></span>',
    });
    messagesEl.append(row);
    scrollToBottom();
    const slowTimer = setTimeout(() => {
      const note = document.createElement('span');
      note.className = 'typing-note';
      note.textContent = 'Still working on it. GoNex is busy, so this may take a little longer…';
      bubble.append(note);
      scrollToBottom();
    }, SLOW_NOTE_AFTER_MS);
    return () => { clearTimeout(slowTimer); row.remove(); };
  }

  function showError(message, { retryAfter, onRetry }) {
    const { row, bubble } = messageNode('bot', { text: message, extraClass: 'error' });
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'retry-btn';
    btn.textContent = 'Try again';
    btn.addEventListener('click', () => { row.remove(); onRetry(); });
    bubble.append(document.createElement('br'), btn);
    messagesEl.append(row);
    scrollToBottom();

    let remaining = Number.parseInt(retryAfter ?? '', 10);
    if (remaining > 0) {
      btn.disabled = true;
      const tick = () => {
        if (remaining <= 0) { btn.disabled = false; btn.textContent = 'Try again'; return; }
        btn.textContent = `Try again in ${remaining}s`;
        remaining -= 1;
        setTimeout(tick, 1000);
      };
      tick();
    }
  }

  // ---------- API ----------
  async function callChat(message) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, conversationId: state.conversationId }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data.error || 'Something went wrong. Please try again.');
        err.status = res.status;
        err.retryAfter = res.headers.get('retry-after');
        throw err;
      }
      return data;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('GoNex took too long to respond. Please try again.');
      if (err instanceof TypeError) throw new Error("Can't reach GoNex. Check your connection and try again.");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function send(text, { isRetry = false } = {}) {
    if (pending) return;
    const message = text.trim();
    if (!message) return;

    pending = true;
    updateComposer();

    if (!isRetry) {
      const userMsg = { role: 'user', text: message, time: Date.now() };
      state.messages.push(userMsg);
      save();
      welcomeEl.hidden = true;
      appendMessage(userMsg);
    }

    const hideTyping = showTyping();
    try {
      const data = await callChat(message);
      hideTyping();
      state.conversationId = data.conversationId;
      const botMsg = { role: 'bot', text: data.reply, time: Date.now() };
      state.messages.push(botMsg);
      save();
      appendMessage(botMsg);
      setStatus(true);
    } catch (err) {
      hideTyping();
      if (err.status === 503 || !err.status) setStatus(false);
      showError(err.message, { retryAfter: err.retryAfter, onRetry: () => send(message, { isRetry: true }) });
    } finally {
      pending = false;
      updateComposer();
      scrollToBottom();
      input.focus();
    }
  }

  // ---------- status ----------
  function setStatus(ok) {
    statusDot.classList.toggle('ok', ok);
    statusDot.classList.toggle('down', !ok);
    statusText.textContent = ok ? 'Online · CryptoNet help assistant' : 'Having trouble connecting';
  }
  async function checkHealth() {
    try {
      const res = await fetch(`${API_BASE}/health`, { cache: 'no-store' });
      setStatus(res.ok);
    } catch {
      setStatus(false);
    }
  }

  // ---------- composer ----------
  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }
  function updateComposer() {
    const len = input.value.length;
    sendBtn.disabled = pending || input.value.trim().length === 0 || len > MAX_CHARS;
    counter.hidden = len < MAX_CHARS * 0.8;
    counter.textContent = `${len}/${MAX_CHARS}`;
    counter.classList.toggle('warn', len >= MAX_CHARS);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (sendBtn.disabled) return;
    const text = input.value;
    input.value = '';
    autoGrow();
    updateComposer();
    send(text);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  input.addEventListener('input', () => { autoGrow(); updateComposer(); });

  $('suggestions').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) send(chip.textContent);
  });

  newChatBtn.addEventListener('click', () => {
    if (pending) return;
    state = { messages: [] };
    save();
    renderAll();
    input.value = '';
    autoGrow();
    updateComposer();
    input.focus();
  });

  renderAll();
  updateComposer();
  checkHealth();
  input.focus();
})();
