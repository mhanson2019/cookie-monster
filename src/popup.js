let currentData = null;
let globalData = null;
let activeTab = 'flagged';
let notificationShown = false;

function $(id) { return document.getElementById(id); }

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'just now';
}

// ─── Banner ───────────────────────────────────────────────────────────────────

function showFlaggedBanner(flaggedCount, autoDeletedCount) {
  if (notificationShown) return;
  if (flaggedCount === 0 && autoDeletedCount === 0) return;
  notificationShown = true;

  $('flag-banner')?.remove();
  const banner = document.createElement('div');
  banner.id = 'flag-banner';

  const parts = [];
  if (autoDeletedCount > 0) parts.push(`🛡 ${autoDeletedCount} tracker${autoDeletedCount > 1 ? 's' : ''} auto-deleted`);
  if (flaggedCount > 0) parts.push(`⚑ ${flaggedCount} suspicious across all sites`);

  banner.innerHTML = `
    <div class="flag-banner-inner">
      <div class="flag-banner-left">
        <div class="flag-banner-icon">${autoDeletedCount > 0 ? '🛡' : '⚑'}</div>
        <div>
          <div class="flag-banner-title">${parts[0]}</div>
          ${parts[1] ? `<div class="flag-banner-sub">${parts[1]}</div>` : ''}
        </div>
      </div>
      <button class="flag-banner-close" id="banner-close">✕</button>
    </div>`;

  document.querySelector('.tabs').before(banner);
  $('banner-close').addEventListener('click', () => {
    banner.style.opacity = '0';
    setTimeout(() => banner.remove(), 200);
  });
}

// ─── Cookie item ──────────────────────────────────────────────────────────────

function renderCookieItem(cookie, showDelete = false, isDeleted = false) {
  const item = document.createElement('div');
  item.className = `cookie-item${isDeleted ? ' is-deleted' : ''}`;

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

  if (isDeleted) {
    const tag = document.createElement('div');
    tag.className = 'cookie-deleted-tag';
    tag.textContent = `✓ auto-deleted · ${cookie.reason || 'known tracker'}`;
    left.appendChild(tag);
  } else if (cookie.flag && cookie.severity) {
    const row = document.createElement('div');
    row.className = `cookie-reason severity-${cookie.severity}`;
    row.innerHTML = `<div class="severity-dot"></div><div class="reason-text">${cookie.reason}</div>`;
    left.appendChild(row);
  } else if (!cookie.flag && cookie.known) {
    left.innerHTML += `<div class="cookie-owner">✓ ${cookie.known.owner}</div><div class="cookie-category">${cookie.known.category}</div>`;
  } else if (!cookie.flag) {
    left.innerHTML += `<div class="cookie-owner">✓ First-party</div>`;
  }

  item.appendChild(left);

  if (showDelete && !isDeleted) {
    const btn = document.createElement('button');
    btn.className = 'delete-btn';
    btn.textContent = 'Delete';
    btn.addEventListener('click', async () => {
      btn.textContent = '...';
      btn.disabled = true;
      await chrome.runtime.sendMessage({
        type: 'DELETE_COOKIE',
        cookie: { name: cookie.name, domain: cookie.domain }
      });
      btn.textContent = 'Deleted';
      btn.className = 'delete-btn deleted';
      item.style.opacity = '0.4';
      await refreshGlobalData();
      updateStats();
    });
    item.appendChild(btn);
  }

  return item;
}

// ─── Site group ───────────────────────────────────────────────────────────────

function renderSiteGroup(siteGroup, cookies, showDelete, isDeleted) {
  if (cookies.length === 0) return null;

  const wrap = document.createElement('div');
  wrap.className = 'site-group';

  const header = document.createElement('div');
  header.className = 'site-group-header';
  header.innerHTML = `
    <div class="site-group-left">
      <div class="site-group-name">${siteGroup.site}</div>
      <div class="site-group-count">${cookies.length} cookie${cookies.length !== 1 ? 's' : ''}</div>
    </div>
    ${showDelete ? `<button class="site-delete-btn" data-site="${siteGroup.site}">Delete all</button>` : ''}
  `;
  wrap.appendChild(header);

  cookies.forEach(c => wrap.appendChild(renderCookieItem(c, showDelete, isDeleted)));

  const divider = document.createElement('div');
  divider.className = 'site-divider';
  wrap.appendChild(divider);

  // Wire per-site delete
  header.querySelector('.site-delete-btn')?.addEventListener('click', async (e) => {
    const site = e.target.dataset.site;
    e.target.textContent = '...';
    e.target.disabled = true;
    await chrome.runtime.sendMessage({ type: 'DELETE_SITE_FLAGGED', site });
    await refreshGlobalData();
    renderCurrentTab();
  });

  return wrap;
}

// ─── Render helpers ───────────────────────────────────────────────────────────

function renderGlobalList(type) {
  const content = $('content');
  content.innerHTML = '';

  if (!globalData?.bySite?.length) {
    const msgs = {
      flagged: ['🎉', 'All clear', 'No suspicious cookies detected across any site.'],
      deleted: ['🛡', 'Nothing deleted yet', 'Auto-deleted trackers will appear here.'],
      safe:    ['✨', 'No safe cookies', 'Visit some sites first.']
    };
    const [icon, title, sub] = msgs[type] || msgs.flagged;
    content.innerHTML = `<div class="empty"><div class="empty-icon">${icon}</div><div class="empty-title">${title}</div><div class="empty-sub">${sub}</div></div>`;
    return;
  }

  let hasContent = false;
  globalData.bySite.forEach(siteGroup => {
    let cookies, showDelete, isDeleted;
    if (type === 'flagged') {
      cookies = siteGroup.cookies.filter(c => !c.wasAutoDeleted && !c.isSafe);
      showDelete = true;
      isDeleted = false;
    } else if (type === 'deleted') {
      cookies = siteGroup.cookies.filter(c => c.wasAutoDeleted);
      showDelete = false;
      isDeleted = true;
    } else {
      cookies = siteGroup.cookies.filter(c => c.isSafe);
      showDelete = false;
      isDeleted = false;
    }

    const group = renderSiteGroup(siteGroup, cookies, showDelete, isDeleted);
    if (group) { content.appendChild(group); hasContent = true; }
  });

  if (!hasContent) {
    const msgs = {
      flagged: ['🎉', 'All clear', 'No suspicious cookies across any visited site.'],
      deleted: ['🛡', 'Nothing auto-deleted', 'No known trackers found yet.'],
      safe:    ['✨', 'No data', '']
    };
    const [icon, title, sub] = msgs[type] || msgs.flagged;
    content.innerHTML = `<div class="empty"><div class="empty-icon">${icon}</div><div class="empty-title">${title}</div><div class="empty-sub">${sub}</div></div>`;
  }
}

function renderSafeTab() {
  const content = $('content');
  content.innerHTML = '';

  if (!globalData?.bySite?.length) {
    content.innerHTML = `<div class="empty"><div class="empty-icon">✨</div><div class="empty-title">No safe cookies</div><div class="empty-sub">Visit some sites to see recognized cookies.</div></div>`;
    return;
  }

  let hasContent = false;
  globalData.bySite.forEach(siteGroup => {
    const safe = siteGroup.cookies.filter(c => c.isSafe);
    const group = renderSiteGroup(siteGroup, safe, false, false);
    if (group) { content.appendChild(group); hasContent = true; }
  });

  if (!hasContent) {
    content.innerHTML = `<div class="empty"><div class="empty-icon">✨</div><div class="empty-title">No safe cookies</div><div class="empty-sub">No recognized cookies found across visited sites.</div></div>`;
  }
}

async function renderLog() {
  const content = $('content');
  content.innerHTML = '<div class="loading"><div class="spinner"></div><div>loading history...</div></div>';
  const response = await chrome.runtime.sendMessage({ type: 'GET_DELETION_LOG' });
  const log = response?.log || [];
  content.innerHTML = '';

  if (log.length === 0) {
    content.innerHTML = `<div class="empty"><div class="empty-icon">📋</div><div class="empty-title">No history yet</div><div class="empty-sub">Deleted trackers will appear here.</div></div>`;
    return;
  }

  const clearRow = document.createElement('div');
  clearRow.style.cssText = 'padding:8px 14px;display:flex;justify-content:flex-end;border-bottom:1px solid var(--egg3);';
  clearRow.innerHTML = `<button id="clear-log-btn" style="background:none;border:1px solid var(--egg4);border-radius:5px;color:var(--muted);font-family:var(--mono);font-size:9px;letter-spacing:0.05em;text-transform:uppercase;padding:3px 10px;cursor:pointer;">Clear History</button>`;
  content.appendChild(clearRow);
  clearRow.querySelector('#clear-log-btn').addEventListener('click', async () => {
    await chrome.storage.local.remove('deletion_log');
    renderLog();
  });

  log.forEach(entry => {
    const group = document.createElement('div');
    group.className = 'log-group';
    const header = document.createElement('div');
    header.className = 'log-group-header';
    header.innerHTML = `
      <div class="log-group-site">${entry.site}</div>
      <div class="log-group-meta">
        <div class="log-group-count">${entry.cookies.length} deleted</div>
        <div class="log-group-time">${timeAgo(entry.timestamp)}</div>
        <div class="log-group-chevron">›</div>
      </div>`;
    const items = document.createElement('div');
    items.className = 'log-group-items';
    entry.cookies.forEach(c => items.appendChild(renderCookieItem({ ...c, flag: true }, false, true)));
    header.addEventListener('click', () => group.classList.toggle('open'));
    group.appendChild(header);
    group.appendChild(items);
    content.appendChild(group);
  });
}

// ─── Stats + main render ──────────────────────────────────────────────────────

function updateStats() {
  const totalFlagged = globalData?.totalFlagged ?? 0;
  const totalDeleted = globalData?.totalDeleted ?? 0;
  const totalSafe    = globalData?.totalSafe ?? 0;
  const total = totalFlagged + totalDeleted + totalSafe;

  $('stat-flagged').textContent = totalFlagged;
  $('stat-deleted').textContent = totalDeleted;
  $('stat-safe').textContent    = totalSafe;
  $('stat-total').textContent   = total || '–';
}

function renderCurrentTab() {
  updateStats();
  const footer = $('footer');
  const deleteAllBtn = $('delete-all-btn');
  const visitNote = $('visit-note');

  if (activeTab === 'flagged') {
    renderGlobalList('flagged');
    const count = globalData?.totalFlagged || 0;
    footer.style.display = count > 0 ? 'block' : 'none';
    if (deleteAllBtn) {
      deleteAllBtn.disabled = count === 0;
      deleteAllBtn.textContent = `Delete All Flagged — ${count} cookies`;
    }
    if (visitNote) visitNote.textContent = 'across all visited sites';
  } else if (activeTab === 'deleted') {
    renderGlobalList('deleted');
    footer.style.display = 'none';
  } else if (activeTab === 'log') {
    renderLog();
    footer.style.display = 'none';
  } else if (activeTab === 'safe') {
    renderSafeTab();
    footer.style.display = 'none';
  }
}

// ─── Data loading ─────────────────────────────────────────────────────────────

async function refreshGlobalData() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_GLOBAL_DATA' });
  globalData = res;
}

async function loadData() {
  try {
    const [tabRes, globalRes] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_TAB_DATA' }),
      chrome.runtime.sendMessage({ type: 'GET_GLOBAL_DATA' })
    ]);

    globalData = globalRes;

    if (tabRes?.data) {
      currentData = tabRes.data;
      try {
        const domain = new URL(tabRes.tabUrl || '').hostname.replace(/^www\./, '');
        $('site-domain').textContent = domain;
      } catch { $('site-domain').textContent = 'unknown'; }
    } else {
      $('site-domain').textContent = 'no site';
    }

    const totalFlagged = globalData?.totalFlagged || 0;
    const totalDeleted = globalData?.totalDeleted || 0;
    if (totalFlagged > 0 || totalDeleted > 0) {
      showFlaggedBanner(totalFlagged, totalDeleted);
    }

    renderCurrentTab();
  } catch (err) {
    $('content').innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Error</div><div class="empty-sub">${err.message}</div></div>`;
  }
}

// ─── Event wiring ─────────────────────────────────────────────────────────────

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
  btn.textContent = 'Deleting...';
  btn.disabled = true;
  await chrome.runtime.sendMessage({ type: 'DELETE_ALL_GLOBAL' });
  notificationShown = false;
  $('flag-banner')?.remove();
  await loadData();
  btn.textContent = 'Delete All Flagged';
});

$('settings-btn')?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/settings.html') });
});

loadData();
