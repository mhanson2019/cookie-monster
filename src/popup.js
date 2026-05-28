let currentData = null;
let activeTab = 'flagged';

function $(id) { return document.getElementById(id); }

function renderCookieItem(cookie, showDelete = false) {
  const item = document.createElement('div');
  item.className = 'cookie-item';

  const left = document.createElement('div');
  left.className = 'cookie-left';

  const name = document.createElement('div');
  name.className = 'cookie-name';
  name.textContent = cookie.name;
  name.title = cookie.name;

  const domain = document.createElement('div');
  domain.className = 'cookie-domain';
  domain.textContent = cookie.domain;

  left.appendChild(name);
  left.appendChild(domain);

  if (cookie.flag && cookie.severity) {
    const reasonRow = document.createElement('div');
    reasonRow.className = `cookie-reason severity-${cookie.severity}`;

    const dot = document.createElement('div');
    dot.className = 'severity-dot';

    const reasonText = document.createElement('div');
    reasonText.className = 'reason-text';
    reasonText.textContent = cookie.reason;

    reasonRow.appendChild(dot);
    reasonRow.appendChild(reasonText);
    left.appendChild(reasonRow);
  }

  if (!cookie.flag && cookie.known) {
    const owner = document.createElement('div');
    owner.className = 'cookie-owner';
    owner.textContent = `✓ ${cookie.known.owner}`;
    left.appendChild(owner);

    const cat = document.createElement('div');
    cat.className = 'cookie-category';
    cat.textContent = cookie.known.category;
    left.appendChild(cat);
  }

  if (!cookie.flag && !cookie.known) {
    const fp = document.createElement('div');
    fp.className = 'cookie-owner';
    fp.textContent = `✓ First-party`;
    left.appendChild(fp);
  }

  item.appendChild(left);

  if (showDelete && cookie.flag) {
    const btn = document.createElement('button');
    btn.className = 'delete-btn';
    btn.textContent = 'Delete';
    btn.dataset.name = cookie.name;
    btn.dataset.domain = cookie.domain;
    btn.addEventListener('click', async () => {
      btn.textContent = '...';
      btn.disabled = true;
      const response = await chrome.runtime.sendMessage({
        type: 'DELETE_COOKIE',
        cookie: { name: cookie.name, domain: cookie.domain, secure: false }
      });
      if (response?.success) {
        btn.textContent = 'Deleted';
        btn.className = 'delete-btn deleted';
        item.style.opacity = '0.4';
      }
    });
    item.appendChild(btn);
  }

  return item;
}

function renderList(cookies, showDelete = false, emptyTitle = 'Nothing here', emptySub = '') {
  const content = $('content');
  content.innerHTML = '';

  if (!cookies || cookies.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = `
      <div class="empty-icon">${showDelete ? '🎉' : '✨'}</div>
      <div class="empty-title">${emptyTitle}</div>
      <div class="empty-sub">${emptySub}</div>
    `;
    content.appendChild(empty);
    return;
  }

  cookies.forEach(cookie => {
    content.appendChild(renderCookieItem(cookie, showDelete));
  });
}

function renderCurrentTab() {
  if (!currentData) return;

  const { flagged, safe, total } = currentData;
  const all = [...(flagged || []), ...(safe || [])];

  $('stat-flagged').textContent = flagged?.length ?? 0;
  $('stat-safe').textContent = safe?.length ?? 0;
  $('stat-total').textContent = total ?? 0;

  const deleteAllBtn = $('delete-all-btn');
  const footer = $('footer');

  if (activeTab === 'flagged') {
    renderList(
      flagged,
      true,
      'No flagged cookies',
      'This site\'s cookies all look legitimate.'
    );
    footer.style.display = flagged?.length > 0 ? 'block' : 'none';
    if (deleteAllBtn) deleteAllBtn.disabled = flagged?.length === 0;
  } else if (activeTab === 'safe') {
    renderList(safe, false, 'No safe cookies', 'No recognized cookies on this site.');
    footer.style.display = 'none';
  } else {
    renderList(all, true, 'No cookies found', 'This site hasn\'t set any cookies.');
    footer.style.display = flagged?.length > 0 ? 'block' : 'none';
    if (deleteAllBtn) deleteAllBtn.disabled = flagged?.length === 0;
  }
}

async function loadData() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_TAB_DATA' });
    if (response?.data) {
      currentData = response.data;

      const url = response.tabUrl || '';
      try {
        const domain = new URL(url).hostname.replace(/^www\./, '');
        $('site-domain').textContent = domain;
      } catch {
        $('site-domain').textContent = 'unknown site';
      }

      renderCurrentTab();
    } else {
      $('content').innerHTML = `
        <div class="empty">
          <div class="empty-icon">🌐</div>
          <div class="empty-title">Nothing to scan</div>
          <div class="empty-sub">Navigate to a website to start monitoring cookies.</div>
        </div>
      `;
      $('site-domain').textContent = 'no site';
    }
  } catch (err) {
    $('content').innerHTML = `
      <div class="empty">
        <div class="empty-icon">⚠️</div>
        <div class="empty-title">Error loading data</div>
        <div class="empty-sub">${err.message}</div>
      </div>
    `;
  }
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeTab = tab.dataset.tab;
    renderCurrentTab();
  });
});

$('delete-all-btn')?.addEventListener('click', async () => {
  const btn = $('delete-all-btn');
  btn.textContent = 'DELETING...';
  btn.disabled = true;

  await chrome.runtime.sendMessage({ type: 'DELETE_ALL_FLAGGED' });
  await loadData();

  btn.textContent = 'DELETE ALL FLAGGED';
});

loadData();
