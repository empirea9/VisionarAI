// ── DOM Elements ───────────────────────────────────────────
const chatContainer = document.getElementById('chatContainer');
const taskInput = document.getElementById('taskInput');
const runBtn = document.getElementById('runBtn');
const clearBtn = document.getElementById('clearBtn');
const settingsBtn = document.getElementById('settingsBtn');
const modelStatus = document.getElementById('modelStatus');
const modelLabel = document.getElementById('modelLabel');

// Utilitarian Theme Greeting Template
const greetingUtilitarian = `
  <div id="greetingScreen" class="greeting-screen">
    <h2 id="greetingMsg">REDACT. ANALYZE. EXECUTE.</h2>
    <p class="greeting-copy">Crisp local automation for modern web apps.</p>
    <div class="feature-grid">
      <article class="feature-card">
        <span class="feature-tag">[F01]</span>
        <h3>DOM + VISION</h3>
        <p>Combines structural parsing with screenshot context for robust intent understanding.</p>
      </article>
      <article class="feature-card">
        <span class="feature-tag">[F02]</span>
        <h3>LOCAL PII SCRUB</h3>
        <p>Emails, phones, and IDs are redacted before any model interaction.</p>
      </article>
      <article class="feature-card">
        <span class="feature-tag">[F03]</span>
        <h3>AGENTIC CONTROL</h3>
        <p>Action planning and retries handle dynamic interfaces and hidden states.</p>
      </article>
    </div>
    <div class="redaction-demo" aria-label="Redaction demo">
      <div class="window-bar">
        <span></span><span></span><span></span>
        <strong>session://capture.html</strong>
      </div>
      <div class="window-body">
        <div class="pii-row"><span>NAME:</span><span class="pii-target">Alex Rivera</span></div>
        <div class="pii-row"><span>EMAIL:</span><span class="pii-target">alex.rivera@example.com</span></div>
        <div class="pii-row"><span>PHONE:</span><span class="pii-target">+1 (555) 123-9876</span></div>
        <div class="scan-line"></div>
      </div>
    </div>
  </div>`;

// Minimalistic Theme Greeting Template
const greetingMinimalistic = `
  <div id="greetingScreen" class="greeting-screen" style="margin: auto; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 6px; opacity: 0.6;">
    <h2 id="greetingMsg" style="font-size: 20px; font-weight: 600;">Hello!</h2>
    <p style="font-size: 13px; color: var(--muted);">How can I help you today?</p>
  </div>`;

let isRunning = false;
let taskStartTime = 0;
let currentTurnIdx = -1;
let chatHistory = [];
let timerInterval = null;
let currentThemeStyle = 'utilitarian';

// ── Icons ──────────────────────────────────────────────────
const ICON_RUN = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
const ICON_STOP = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect></svg>`;

document.addEventListener('DOMContentLoaded', init);

// ── Init ───────────────────────────────────────────────────
function init() {
  loadPreferences();
  renderRedactionDemo();
  window.addEventListener('resize', renderRedactionDemo);

  const apiKeyWarning = document.getElementById('apiKeyWarning');
  const apiKeyWarningLink = document.getElementById('apiKeyWarningLink');

  if (apiKeyWarningLink) {
    apiKeyWarningLink.addEventListener('click', (e) => {
      e.preventDefault();
      if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    });
  }

  chrome.storage.local.get(['fullChatHistory', 'geminiApiKey'], (data) => {
    if (!data.geminiApiKey) {
      if (apiKeyWarning) apiKeyWarning.style.display = 'block';
      runBtn.disabled = true;
    } else {
      if (apiKeyWarning) apiKeyWarning.style.display = 'none';
    }

    if (data.fullChatHistory && Array.isArray(data.fullChatHistory)) {
      chatHistory = data.fullChatHistory;
      renderHistory();
    }
  });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      if (changes.mode) {
        applyMode(changes.mode.newValue);
      }
      if (changes.theme) {
        currentThemeStyle = changes.theme.newValue || 'utilitarian';
        applyTheme(currentThemeStyle);
        renderHistory();
      }
      if (changes.geminiApiKey) {
        if (changes.geminiApiKey.newValue) {
          if (apiKeyWarning) apiKeyWarning.style.display = 'none';
          if (!isRunning) runBtn.disabled = !taskInput.value.trim();
        } else {
          if (apiKeyWarning) apiKeyWarning.style.display = 'block';
          runBtn.disabled = true;
        }
      }
      if (changes.fullChatHistory) {
        chatHistory = changes.fullChatHistory.newValue || [];
        renderHistory();
      }
    }
  });

  checkServerStatus();

  taskInput.addEventListener('input', () => {
    if (!isRunning) {
      chrome.storage.local.get(['geminiApiKey'], (d) => {
        if (!d.geminiApiKey) {
          runBtn.disabled = true;
        } else {
          runBtn.disabled = !taskInput.value.trim();
        }
      });
    }
  });

  taskInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && taskInput.value.trim() && !isRunning) {
      runTask();
    }
  });

  runBtn.addEventListener('click', () => {
    if (isRunning) {
      cancelTask();
    } else {
      runTask();
    }
  });

  clearBtn.addEventListener('click', clearChat);

  settingsBtn.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options/options.html'));
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'STATUS_UPDATE' && msg.steps) {
      const latest = msg.steps[msg.steps.length - 1];
      if (latest) addLiveStep(latest);
    }
  });

  taskInput.focus();
}

// ── Render Logic ───────────────────────────────────────────
function renderHistory() {
  chatContainer.innerHTML = '';

  if (chatHistory.length === 0) {
    chatContainer.innerHTML = (currentThemeStyle === 'minimalistic') ? greetingMinimalistic : greetingUtilitarian;
    renderRedactionDemo();
    return;
  }

  chatHistory.forEach((turn, idx) => {
    appendChatTurn(turn, idx);
  });
  scrollToBottom();
}

function appendChatTurn(turn, idx) {
  const turnDiv = document.createElement('div');
  turnDiv.className = 'chat-turn';
  turnDiv.dataset.idx = idx;

  const promptDiv = document.createElement('div');
  promptDiv.className = 'user-prompt';
  promptDiv.textContent = turn.prompt;
  turnDiv.appendChild(promptDiv);

  const stepsPanel = document.createElement('div');
  stepsPanel.className = 'glass-panel';
  stepsPanel.id = 'stepsPanel-' + idx;

  const header = document.createElement('div');
  header.className = 'panel-header';
  header.style.cursor = 'pointer';

  const headerLeft = document.createElement('div');
  headerLeft.style.display = 'flex';
  headerLeft.style.alignItems = 'center';
  headerLeft.style.gap = '8px';

  const spinner = document.createElement('div');
  spinner.className = 'spinner';
  spinner.id = 'spinner-' + idx;
  if (turn.answer || turn.cancelled) spinner.classList.add('hidden');

  const statusText = document.createElement('span');
  statusText.id = 'status-' + idx;

  if (turn.cancelled) {
    statusText.textContent = 'Task cancelled';
  } else if (turn.thoughtTime) {
    statusText.textContent = `Thought for ${turn.thoughtTime}s`;
  } else {
    statusText.textContent = 'Agent is thinking... 0.0s';
  }

  headerLeft.appendChild(spinner);
  headerLeft.appendChild(statusText);

  const chevron = document.createElement('span');
  chevron.textContent = '▼';
  chevron.style.fontSize = '10px';
  chevron.style.transition = 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
  chevron.style.transform = (turn.answer || turn.cancelled) ? 'rotate(-90deg)' : 'rotate(0deg)';

  header.appendChild(headerLeft);
  header.appendChild(chevron);

  const ul = document.createElement('ul');
  ul.className = 'steps-list';
  ul.id = 'stepsList-' + idx;
  if (turn.answer || turn.cancelled) ul.classList.add('hidden');

  if (turn.steps) {
    turn.steps.forEach(step => {
      const li = document.createElement('li');
      if (step.startsWith('ERROR_MSG:')) {
        li.textContent = step.substring(10);
        li.style.color = '#ffcaca';
      } else {
        li.textContent = step;
      }
      ul.appendChild(li);
    });
  }

  header.addEventListener('click', () => {
    ul.classList.toggle('hidden');
    chevron.style.transform = ul.classList.contains('hidden') ? 'rotate(-90deg)' : 'rotate(0deg)';
  });

  stepsPanel.appendChild(header);
  stepsPanel.appendChild(ul);
  turnDiv.appendChild(stepsPanel);

  if (turn.answer && !turn.cancelled) {
    const ansPanel = document.createElement('div');
    ansPanel.className = 'glass-panel answer-panel';
    const ansText = document.createElement('div');
    ansText.className = 'answer-text';
    ansText.innerHTML = formatMarkdown(turn.rawAnswer);
    ansPanel.appendChild(ansText);
    turnDiv.appendChild(ansPanel);
  }

  chatContainer.appendChild(turnDiv);
}

// ── Run Task ───────────────────────────────────────────────
function runTask() {
  const task = taskInput.value.trim();
  if (!task || isRunning) return;

  const greeting = document.getElementById('greetingScreen');
  if (greeting) greeting.remove();

  const newTurn = {
    prompt: task,
    steps: [],
    answer: '',
    rawAnswer: '',
    thoughtTime: null,
    cancelled: false
  };

  chatHistory.push(newTurn);
  currentTurnIdx = chatHistory.length - 1;
  saveState();

  appendChatTurn(newTurn, currentTurnIdx);
  scrollToBottom();
  addLiveStep(`Starting: "${task.substring(0, 60)}${task.length > 60 ? '...' : ''}"`);

  taskInput.value = '';
  runBtn.innerHTML = ICON_STOP;
  runBtn.classList.add('stop-mode');
  isRunning = true;
  taskStartTime = Date.now();

  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!isRunning) {
      clearInterval(timerInterval);
      return;
    }
    const currentElapsed = ((Date.now() - taskStartTime) / 1000).toFixed(1);
    const statusObj = document.getElementById(`status-${currentTurnIdx}`);
    if (statusObj) {
      statusObj.textContent = `Agent is thinking... ${currentElapsed}s`;
    }
  }, 100);

  chrome.runtime.sendMessage({ type: 'RUN_TASK', task: task }, (response) => {
    handleResponse(response);
  });
}

function cancelTask() {
  if (!isRunning) return;
  chrome.runtime.sendMessage({ type: 'CANCEL_TASK' });

  runBtn.innerHTML = ICON_RUN;
  runBtn.classList.remove('stop-mode');
  isRunning = false;

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  if (currentTurnIdx >= 0 && chatHistory[currentTurnIdx]) {
    chatHistory[currentTurnIdx].cancelled = true;
    const statusObj = document.getElementById(`status-${currentTurnIdx}`);
    if (statusObj) statusObj.textContent = 'Task cancelled';

    const spinner = document.getElementById(`spinner-${currentTurnIdx}`);
    if (spinner) spinner.classList.add('hidden');
  }
  saveState();
}

function handleResponse(response) {
  isRunning = false;
  runBtn.innerHTML = ICON_RUN;
  runBtn.classList.remove('stop-mode');
  runBtn.disabled = !taskInput.value.trim();

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  const turn = chatHistory[currentTurnIdx];
  if (!turn) return;

  const elapsed = ((Date.now() - taskStartTime) / 1000).toFixed(1);
  turn.thoughtTime = elapsed;

  const spinner = document.getElementById(`spinner-${currentTurnIdx}`);
  const status = document.getElementById(`status-${currentTurnIdx}`);
  const ul = document.getElementById(`stepsList-${currentTurnIdx}`);
  const stepsPanel = document.getElementById(`stepsPanel-${currentTurnIdx}`);
  const chev = stepsPanel ? stepsPanel.querySelector('span:last-child') : null;
  const turnDiv = chatContainer.querySelector(`[data-idx="${currentTurnIdx}"]`);

  if (spinner) spinner.classList.add('hidden');
  if (ul) ul.classList.add('hidden');
  if (chev) chev.style.transform = 'rotate(-90deg)';

  if (chrome.runtime.lastError) {
    addLiveStep(`Error: ${chrome.runtime.lastError.message}`);
    if (status) status.textContent = 'Task failed';
  } else if (!response) {
    addLiveStep('Error: No response from agent');
    if (status) status.textContent = 'Task failed';
  } else if (response.success) {
    if (status) status.textContent = `Thought for ${elapsed}s`;

    let rawAns = response.answer || (response.actions && response.actions.length > 0 ? "Action executed successfully." : "Task completed.");
    turn.rawAnswer = rawAns;
    turn.answer = rawAns;

    const ansPanel = document.createElement('div');
    ansPanel.className = 'glass-panel answer-panel';
    const ansText = document.createElement('div');
    ansText.className = 'answer-text';
    ansText.innerHTML = formatMarkdown(rawAns);

    if (response.privacy && response.privacy.redactedCount > 0) {
      const priv = document.createElement('p');
      priv.style.cssText = 'font-size:11px; color:var(--muted); margin-top:8px; font-family:"JetBrains Mono", monospace;';
      priv.textContent = `(Privacy: ${response.privacy.redactedCount} items redacted)`;
      ansText.appendChild(priv);
    }
    ansPanel.appendChild(ansText);
    turnDiv.appendChild(ansPanel);

  } else {
    addLiveStep(`Error: ${response.error || 'Unknown error'}`);
    if (status) status.textContent = turn.cancelled ? 'Task cancelled' : 'Task failed';
  }

  saveState();
  scrollToBottom();
}

function addLiveStep(text) {
  if (currentTurnIdx < 0) return;
  const turn = chatHistory[currentTurnIdx];
  turn.steps.push(text);

  const ul = document.getElementById(`stepsList-${currentTurnIdx}`);
  if (ul) {
    const li = document.createElement('li');
    if (text.startsWith('ERROR_MSG:')) {
      li.textContent = text.substring(10);
      li.style.color = '#ffcaca';
    } else {
      li.textContent = text;
    }
    ul.appendChild(li);
    scrollToBottom();
  }
}

function clearChat() {
  chatHistory = [];
  saveState();
  renderHistory();
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  });
}

function saveState() {
  chrome.storage.local.set({ fullChatHistory: chatHistory });
}

// ── Preferences & Theme Handling ───────────────────────────
function loadPreferences() {
  chrome.storage.local.get(['mode', 'theme'], (data) => {
    applyMode(data.mode || 'dark');
    currentThemeStyle = data.theme || 'utilitarian';
    applyTheme(currentThemeStyle);
    renderHistory();
  });
}

function applyMode(modeVal) {
  if (modeVal === 'light') {
    document.body.classList.add('light-theme');
    document.body.classList.remove('dark-theme');
  } else {
    document.body.classList.add('dark-theme');
    document.body.classList.remove('light-theme');
  }
}

function applyTheme(themeVal) {
  const stylesheet = document.getElementById('themeStylesheet');
  if (themeVal === 'minimalistic') {
    stylesheet.href = 'minimalistic.css';
    document.body.classList.add('minimalistic-theme');
  } else {
    stylesheet.href = 'utilitarian.css';
    document.body.classList.remove('minimalistic-theme');
  }
}

// ── Markdown ───────────────────────────────────────────────
function formatMarkdown(text) {
  if (!text) return '';
  let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  html = html
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([\s\S]*?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([\s\S]*?)__/g, '<strong>$1</strong>')
    .replace(/\*([^\*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/^[\s-]*[\*\-]\s+(.*)/gm, '• $1');
  return html;
}

// ── Server Check ───────────────────────────────────────────
function checkServerStatus() {
  modelLabel.textContent = "Gemini 3.5 Flash Lite";
  modelStatus.querySelector('.dot').className = 'dot green';
  modelStatus.title = "Running locally in browser";
}

function renderRedactionDemo() {
  const body = document.querySelector('.window-body');
  if (!body) return;

  body.querySelectorAll('.redaction-box').forEach(el => el.remove());
  const bodyRect = body.getBoundingClientRect();

  body.querySelectorAll('.pii-target').forEach((target) => {
    const rect = target.getBoundingClientRect();
    const box = document.createElement('div');
    box.className = 'redaction-box';
    box.textContent = '[REDACTED]';
    box.style.left = `${rect.left - bodyRect.left}px`;
    box.style.top = `${rect.top - bodyRect.top - 1}px`;
    box.style.width = `${Math.max(88, rect.width)}px`;
    box.style.height = `${Math.max(16, rect.height + 2)}px`;
    body.appendChild(box);
  });
}