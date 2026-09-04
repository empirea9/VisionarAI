document.addEventListener('DOMContentLoaded', function () {
  var apiKeyInput     = document.getElementById('geminiApiKey');
  var toggleApiKeyBtn = document.getElementById('toggleApiKeyBtn');
  var saveBtn         = document.getElementById('saveBtn');
  var savedMsg        = document.getElementById('savedMsg');
  var historyList     = document.getElementById('historyList');
  var clearHistoryBtn = document.getElementById('clearHistoryBtn');
  var themeDark       = document.getElementById('themeDark');
  var themeLight      = document.getElementById('themeLight');

  var selectedTheme = 'dark';

  // ── Load ───────────────────────────────────────────────────
  chrome.storage.local.get(['geminiApiKey', 'theme', 'fullChatHistory'], function (d) {
    apiKeyInput.value = d.geminiApiKey || '';
    selectedTheme = d.theme || 'dark';
    setTheme(selectedTheme);
    renderHistory(d.fullChatHistory || []);
  });

  // ── Eye Toggle ─────────────────────────────────────────────
  toggleApiKeyBtn.addEventListener('click', function () {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleApiKeyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-eye-off"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
    } else {
      apiKeyInput.type = 'password';
      toggleApiKeyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-eye"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
    }
  });

  // ── Theme toggle ───────────────────────────────────────────
  function setTheme(t) {
    selectedTheme = t;
    themeDark.classList.toggle('active', t === 'dark');
    themeLight.classList.toggle('active', t === 'light');
    document.body.classList.toggle('light-mode', t === 'light');
  }

  themeDark.addEventListener('click',  function () { setTheme('dark');  });
  themeLight.addEventListener('click', function () { setTheme('light'); });

  // ── Save ───────────────────────────────────────────────────
  saveBtn.addEventListener('click', function () {
    var key = apiKeyInput.value.trim();

    chrome.storage.local.set({ geminiApiKey: key, theme: selectedTheme }, function () {
      savedMsg.style.display = 'block';
      setTimeout(function () { savedMsg.style.display = 'none'; }, 2500);
    });
  });

  // ── Render history ─────────────────────────────────────────
  function renderHistory(turns) {
    historyList.innerHTML = '';

    if (!turns || turns.length === 0) {
      var li = document.createElement('li');
      li.className = 'hist-empty';
      li.textContent = 'No history yet. Ask VisionarAI something!';
      historyList.appendChild(li);
      return;
    }

    [...turns].reverse().forEach(function (turn, i) {
      var li   = document.createElement('li');
      li.className = 'hist-item';

      var num  = document.createElement('span');
      num.className = 'hist-num';
      num.textContent = '[' + String(turns.length - i).padStart(3, '0') + ']';

      var txt  = document.createElement('span');
      txt.className = 'hist-text';
      txt.textContent = turn.prompt || '—';

      li.appendChild(num);
      li.appendChild(txt);
      historyList.appendChild(li);
    });
  }

  // ── Clear history ──────────────────────────────────────────
  clearHistoryBtn.addEventListener('click', function () {
    if (!confirm('Clear all prompt history? This cannot be undone.')) return;
    chrome.storage.local.set({ fullChatHistory: [] }, function () {
      renderHistory([]);
    });
  });

  // ── Live sync from popup ───────────────────────────────────
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && changes.fullChatHistory) {
      renderHistory(changes.fullChatHistory.newValue || []);
    }
  });
});
