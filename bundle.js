(async function XUnfollowers() {
'use strict';
const DELAY_MS = 800;
const MAX_RETRIES = 3;
const LS_WHITELIST_KEY = 'xuf_whitelist';
let whitelist = JSON.parse(localStorage.getItem(LS_WHITELIST_KEY) || '[]');
let followingList = [];
let followerSet = new Set();
let notFollowingBack = [];
let isRunning = false;
function getCookie(name) {
const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
return m ? decodeURIComponent(m[1]) : null;
}
function getAuthHeaders() {
const ct0 = getCookie('ct0');
if (!ct0) throw new Error('Not logged in to X. Please log in first.');
const bearer = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
return {
'Authorization': `Bearer ${bearer}`,
'x-csrf-token': ct0,
'x-twitter-auth-type': 'OAuth2Session',
'x-twitter-client-language': 'en',
'x-twitter-active-user': 'yes',
'content-type': 'application/json',
};
}
function sleep(ms) {
return new Promise(r => setTimeout(r, ms));
}
async function apiFetch(url, retries = 0) {
try {
const res = await fetch(url, { headers: getAuthHeaders(), credentials: 'include' });
if (res.status === 429) {
UI.setStatus('Rate limited — waiting 60s…', 'warn');
await sleep(60000);
return apiFetch(url, retries);
}
if (!res.ok) throw new Error(`HTTP ${res.status}`);
return res.json();
} catch (e) {
if (retries < MAX_RETRIES) {
await sleep(2000 * (retries + 1));
return apiFetch(url, retries + 1);
}
throw e;
}
}
async function getMyUserId() {
const data = await apiFetch('https://x.com/i/api/1.1/account/verify_credentials.json?skip_status=true&include_entities=false');
return { id: data.id_str, screenName: data.screen_name, name: data.name };
}
async function fetchPagedList(endpoint, userId, cursor = '-1', collected = []) {
const url = `https://x.com/i/api/1.1/${endpoint}.json?user_id=${userId}&count=200&cursor=${cursor}&skip_status=true&include_user_entities=false`;
const data = await apiFetch(url);
const users = data.users || [];
collected.push(...users);
UI.setProgress(collected.length);
const next = data.next_cursor_str;
if (next && next !== '0') {
await sleep(DELAY_MS);
return fetchPagedList(endpoint, userId, next, collected);
}
return collected;
}
function toggleWhitelist(id) {
if (whitelist.includes(id)) {
whitelist = whitelist.filter(x => x !== id);
} else {
whitelist.push(id);
}
localStorage.setItem(LS_WHITELIST_KEY, JSON.stringify(whitelist));
UI.renderResults();
}
async function runScan() {
if (isRunning) return;
isRunning = true;
followingList = [];
followerSet = new Set();
notFollowingBack = [];
UI.setScanBtn(false);
try {
UI.setStatus('Getting your profile…', 'info');
const me = await getMyUserId();
UI.setStatus(`Scanning @${me.screenName}…`, 'info');
UI.setStatus('Fetching people you follow…', 'info');
UI.setLabel('Following');
followingList = await fetchPagedList('friends/list', me.id);
UI.setStatus('Fetching your followers…', 'info');
UI.setLabel('Followers');
const followers = await fetchPagedList('followers/list', me.id);
followers.forEach(u => followerSet.add(u.id_str));
notFollowingBack = followingList.filter(u => !followerSet.has(u.id_str));
UI.setStatus(`Done! ${notFollowingBack.length} people don't follow you back.`, 'success');
UI.showResults(notFollowingBack, followingList.length, followers.length);
} catch (e) {
UI.setStatus('Error: ' + e.message, 'error');
} finally {
isRunning = false;
UI.setScanBtn(true);
}
}
const UI = (() => {
const ID = 'xuf-root';
function inject() {
if (document.getElementById(ID)) return;
const style = document.createElement('style');
style.textContent = `
#xuf-root *{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
#xuf-root{position:fixed;top:20px;right:20px;width:380px;max-height:80vh;background:#fff;border:1px solid #e1e8ed;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.15);z-index:9999999;overflow:hidden;display:flex;flex-direction:column;font-size:14px;color:#0f1419}
#xuf-header{background:#000;color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
#xuf-header h2{font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px}
#xuf-close{background:none;border:none;color:#fff;cursor:pointer;font-size:20px;line-height:1;padding:2px 6px;border-radius:6px;opacity:.7;transition:opacity .15s}
#xuf-close:hover{opacity:1}
#xuf-body{padding:14px 16px;overflow-y:auto;flex:1}
#xuf-status{font-size:13px;padding:8px 12px;border-radius:8px;margin-bottom:12px;display:none}
#xuf-status.info{background:#e8f5fd;color:#1d9bf0;border:1px solid #b3d9f5}
#xuf-status.warn{background:#fff3cd;color:#856404;border:1px solid #ffecb5}
#xuf-status.success{background:#e6f4ea;color:#188038;border:1px solid #b8dfc4}
#xuf-status.error{background:#fce8e6;color:#c5221f;border:1px solid #f5c6c5}
#xuf-scan-btn{width:100%;padding:10px;background:#000;color:#fff;border:none;border-radius:999px;font-size:15px;font-weight:700;cursor:pointer;transition:background .15s;margin-bottom:12px}
#xuf-scan-btn:hover:not(:disabled){background:#333}
#xuf-scan-btn:disabled{opacity:.5;cursor:not-allowed}
#xuf-progress-wrap{height:4px;background:#e1e8ed;border-radius:2px;margin-bottom:12px;overflow:hidden;display:none}
#xuf-progress-fill{height:100%;background:#1d9bf0;border-radius:2px;transition:width .3s;width:0%}
#xuf-progress-label{font-size:12px;color:#536471;margin-bottom:12px;display:none}
#xuf-stats{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px;display:none}
.xuf-stat{background:#f7f9f9;border-radius:10px;padding:8px 10px;text-align:center}
.xuf-stat-n{font-size:18px;font-weight:700;color:#0f1419}
.xuf-stat-l{font-size:11px;color:#536471;margin-top:2px}
#xuf-filter-row{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;display:none}
.xuf-filter{font-size:12px;padding:4px 12px;border-radius:999px;border:1px solid #cfd9de;background:#fff;cursor:pointer;transition:all .12s;color:#0f1419}
.xuf-filter.active{background:#000;color:#fff;border-color:#000}
#xuf-search{width:100%;padding:7px 10px;border:1px solid #cfd9de;border-radius:999px;font-size:13px;margin-bottom:10px;outline:none;display:none;color:#0f1419}
#xuf-search:focus{border-color:#1d9bf0}
#xuf-list{display:flex;flex-direction:column;gap:8px}
.xuf-user{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #e1e8ed;border-radius:12px;background:#fff;transition:background .1s}
.xuf-user:hover{background:#f7f9f9}
.xuf-avatar{width:40px;height:40px;border-radius:50%;flex-shrink:0;border:1px solid #e1e8ed;cursor:pointer;position:relative;overflow:hidden;background:#e1e8ed}
.xuf-avatar img{width:100%;height:100%;object-fit:cover}
.xuf-avatar.wl{outline:3px solid #1d9bf0;outline-offset:1px}
.xuf-avatar.wl::after{content:'✓';position:absolute;bottom:0;right:0;background:#1d9bf0;color:#fff;font-size:9px;width:14px;height:14px;display:flex;align-items:center;justify-content:center;border-radius:50%}
.xuf-info{flex:1;min-width:0}
.xuf-name{font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#0f1419}
.xuf-handle{font-size:12px;color:#536471}
.xuf-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}
.xuf-profile-btn{font-size:11px;padding:4px 10px;border-radius:999px;border:1px solid #cfd9de;background:#fff;cursor:pointer;color:#0f1419;text-decoration:none;white-space:nowrap}
.xuf-profile-btn:hover{border-color:#000}
.xuf-wl-btn{font-size:11px;padding:4px 10px;border-radius:999px;border:1px solid #1d9bf0;background:#fff;cursor:pointer;color:#1d9bf0;white-space:nowrap}
.xuf-wl-btn:hover{background:#e8f5fd}
.xuf-wl-btn.wl{background:#1d9bf0;color:#fff}
.xuf-empty{text-align:center;padding:2rem;color:#536471;font-size:13px}
#xuf-footer{padding:10px 16px;border-top:1px solid #e1e8ed;font-size:11px;color:#536471;display:flex;justify-content:space-between;align-items:center;flex-shrink:0}
#xuf-footer a{color:#1d9bf0;text-decoration:none}
@media(prefers-color-scheme:dark){
#xuf-root{background:#15202b;border-color:#38444d;color:#f7f9f9}
#xuf-header{background:#1d9bf0}
.xuf-stat{background:#1e2732}
.xuf-stat-n{color:#f7f9f9}
.xuf-user{border-color:#38444d;background:#15202b}
.xuf-user:hover{background:#1e2732}
.xuf-name{color:#f7f9f9}
#xuf-search{background:#1e2732;border-color:#38444d;color:#f7f9f9}
.xuf-filter{border-color:#38444d;background:#15202b;color:#f7f9f9}
.xuf-filter.active{background:#1d9bf0;border-color:#1d9bf0}
.xuf-profile-btn{background:#15202b;border-color:#38444d;color:#f7f9f9}
#xuf-footer{border-color:#38444d;background:#15202b}
}
`;
document.head.appendChild(style);
const root = document.createElement('div');
root.id = ID;
root.innerHTML = `
<div id="xuf-header">
<h2>
<svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
Unfollowers
</h2>
<button id="xuf-close" title="Close">✕</button>
</div>
<div id="xuf-body">
<div id="xuf-status"></div>
<button id="xuf-scan-btn">▶ SCAN</button>
<div id="xuf-progress-wrap"><div id="xuf-progress-fill"></div></div>
<div id="xuf-progress-label"></div>
<div id="xuf-stats">
<div class="xuf-stat"><div class="xuf-stat-n" id="xuf-s-following">0</div><div class="xuf-stat-l">Following</div></div>
<div class="xuf-stat"><div class="xuf-stat-n" id="xuf-s-followers">0</div><div class="xuf-stat-l">Followers</div></div>
<div class="xuf-stat"><div class="xuf-stat-n" id="xuf-s-notback" style="color:#e0245e">0</div><div class="xuf-stat-l">Not back</div></div>
</div>
<div id="xuf-filter-row">
<button class="xuf-filter active" data-f="all">All</button>
<button class="xuf-filter" data-f="notback">Not following back</button>
<button class="xuf-filter" data-f="whitelisted">Whitelisted</button>
</div>
<input id="xuf-search" type="text" placeholder="Search by name or @handle…" />
<div id="xuf-list"><div class="xuf-empty">Click SCAN to start.</div></div>
</div>
<div id="xuf-footer">
<span>💙 <a href="https://github.com/SWG56/X-Twitter-follower-checker-code" target="_blank">x-unfollowers</a></span>
<span>Click avatar to whitelist</span>
</div>
`;
document.body.appendChild(root);
document.getElementById('xuf-close').onclick = () => root.remove();
document.getElementById('xuf-scan-btn').onclick = runScan;
document.querySelectorAll('.xuf-filter').forEach(btn => {
btn.onclick = () => {
document.querySelectorAll('.xuf-filter').forEach(b => b.classList.remove('active'));
btn.classList.add('active');
currentFilter = btn.dataset.f;
renderResults();
};
});
document.getElementById('xuf-search').oninput = () => renderResults();
}
let _following = 0, _followers = 0, currentFilter = 'all';
function setStatus(msg, type) {
const el = document.getElementById('xuf-status');
if (!el) return;
el.textContent = msg;
el.className = type;
el.style.display = msg ? 'block' : 'none';
}
function setLabel(label) {
const el = document.getElementById('xuf-progress-label');
if (!el) return;
el.textContent = label;
el.style.display = 'block';
}
function setProgress(count) {
const wrap = document.getElementById('xuf-progress-wrap');
const fill = document.getElementById('xuf-progress-fill');
const label = document.getElementById('xuf-progress-label');
if (!wrap) return;
wrap.style.display = 'block';
fill.style.width = '100%';
if (label) label.textContent = `Loaded ${count} users…`;
}
function setScanBtn(enabled) {
const btn = document.getElementById('xuf-scan-btn');
if (btn) {
btn.disabled = !enabled;
btn.textContent = enabled ? '▶ SCAN' : '⏳ Scanning…';
}
const wrap = document.getElementById('xuf-progress-wrap');
if (wrap && enabled) wrap.style.display = 'none';
const label = document.getElementById('xuf-progress-label');
if (label && enabled) label.style.display = 'none';
}
function showResults(nfb, following, followers) {
_following = following;
_followers = followers;
document.getElementById('xuf-s-following').textContent = following;
document.getElementById('xuf-s-followers').textContent = followers;
document.getElementById('xuf-s-notback').textContent = nfb.length;
document.getElementById('xuf-stats').style.display = 'grid';
document.getElementById('xuf-filter-row').style.display = 'flex';
document.getElementById('xuf-search').style.display = 'block';
renderResults();
}
function renderResults() {
const list = document.getElementById('xuf-list');
if (!list) return;
const query = (document.getElementById('xuf-search')?.value || '').toLowerCase();
let users = notFollowingBack;
if (currentFilter === 'whitelisted') {
users = followingList.filter(u => whitelist.includes(u.id_str));
} else if (currentFilter === 'notback') {
users = notFollowingBack.filter(u => !whitelist.includes(u.id_str));
}
if (query) {
users = users.filter(u =>
u.name.toLowerCase().includes(query) ||
u.screen_name.toLowerCase().includes(query)
);
}
if (!users.length) {
list.innerHTML = '<div class="xuf-empty">No users found.</div>';
return;
}
list.innerHTML = users.map(u => {
const wl = whitelist.includes(u.id_str);
return `
<div class="xuf-user" id="xuf-u-${u.id_str}">
<div class="xuf-avatar${wl ? ' wl' : ''}" onclick="window.__xuf_toggleWL('${u.id_str}')" title="${wl ? 'Remove from whitelist' : 'Add to whitelist'}">
<img src="${u.profile_image_url_https?.replace('_normal', '_bigger') || ''}" alt="${u.name}" loading="lazy" />
</div>
<div class="xuf-info">
<div class="xuf-name">${escapeHtml(u.name)}</div>
<div class="xuf-handle">@${u.screen_name}</div>
</div>
<div class="xuf-actions">
<a class="xuf-profile-btn" href="https://x.com/${u.screen_name}" target="_blank">Profile ↗</a>
<button class="xuf-wl-btn${wl ? ' wl' : ''}" onclick="window.__xuf_toggleWL('${u.id_str}')">${wl ? '★ WL' : '☆ WL'}</button>
</div>
</div>`;
}).join('');
}
return { inject, setStatus, setLabel, setProgress, setScanBtn, showResults, renderResults };
})();
function escapeHtml(s) {
return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
window.__xuf_toggleWL = (id) => {
toggleWhitelist(id);
};
UI.inject();
console.log('%c X Unfollowers loaded! Click SCAN in the panel. ', 'background:#000;color:#fff;font-size:14px;padding:4px 8px;border-radius:4px;');
})();