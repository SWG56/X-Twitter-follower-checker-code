(async function XUnfollowers() {
'use strict';
const SCROLL_DELAY_MS = 900;
const IDLE_ROUNDS = 4;
const MAX_SCROLL_ROUNDS = 600;
const NAV_TIMEOUT_MS = 10000;
const LS_WHITELIST_KEY = 'xuf_whitelist';
const PAGE_SIZE = 40;
const UNFOLLOW_MIN_DELAY_MS = 700;
const UNFOLLOW_MAX_DELAY_MS = 2200;
const UNFOLLOW_BATCH_SIZE = 5;
const UNFOLLOW_BATCH_PAUSE_MS = 25000;
const NAME_BLACKLIST = new Set(['follow', 'following', 'pending', 'unblock', 'blocked', 'follows you', 'verified account']);
let whitelist = JSON.parse(localStorage.getItem(LS_WHITELIST_KEY) || '[]');
let results = [];
let selected = new Set();
let unfollowLog = [];
let unfollowLogFilter = { showSucceeded: true, showFailed: true };
let filter = { notFollowingBack: true, followingBack: false, verified: true };
let currentTab = 'nonWhitelisted';
let searchTerm = '';
let page = 1;
let viewState = 'idle';
let isRunning = false;
let isUnfollowing = false;
let stopUnfollowRequested = false;
let unfollowDone = 0;
let unfollowTotal = 0;
let unfollowStatusMsg = '';
function sleep(ms) {
return new Promise(r => setTimeout(r, ms));
}
function randomDelay(min, max) {
return min + Math.random() * (max - min);
}
async function waitForSelector(selector, timeoutMs, scope) {
const start = Date.now();
const root = scope || document;
while (Date.now() - start < timeoutMs) {
if (root.querySelector(selector)) return true;
await sleep(250);
}
return false;
}
async function waitForPath(path, timeoutMs) {
const start = Date.now();
while (Date.now() - start < timeoutMs) {
if (location.pathname === path) return true;
await sleep(150);
}
return false;
}
function clickHref(href) {
const el = document.querySelector(`a[href="${href}"]`);
if (!el) return false;
el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
return true;
}
async function navigateTo(path, timeoutMs = NAV_TIMEOUT_MS) {
if (location.pathname === path) return true;
if (!clickHref(path)) {
history.pushState({}, '', path);
window.dispatchEvent(new PopStateEvent('popstate'));
}
return waitForPath(path, timeoutMs);
}
async function openFollowList(handle, kind) {
const path = `/${handle}/${kind}`;
if (!document.querySelector(`a[href="${path}"]`)) {
await navigateTo(`/${handle}`);
await waitForSelector(`a[href="${path}"]`, NAV_TIMEOUT_MS);
}
return navigateTo(path);
}
function getMyHandle() {
const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
if (!link) return null;
const href = link.getAttribute('href') || '';
const m = href.match(/^\/([^\/?]+)/);
return m ? m[1] : null;
}
function getTimelineContainer(kind) {
const els = document.querySelectorAll('[aria-label]');
for (const el of els) {
const label = (el.getAttribute('aria-label') || '').toLowerCase();
if (label.startsWith('timeline') && label.includes(kind)) return el;
}
return null;
}
function extractUsersFromDom(scope) {
const root = scope || document;
const cells = root.querySelectorAll('[data-testid="UserCell"]');
const users = [];
cells.forEach(cell => {
let screenName = null;
const avatarContainer = cell.querySelector('[data-testid^="UserAvatar-Container-"]');
if (avatarContainer) {
screenName = avatarContainer.getAttribute('data-testid').slice('UserAvatar-Container-'.length);
}
if (!screenName) {
const profileLink = cell.querySelector('a[href^="/"]');
if (profileLink) {
const m = profileLink.getAttribute('href').match(/^\/([^\/?]+)\/?$/);
if (m) screenName = m[1];
}
}
if (!screenName) return;
const img = cell.querySelector('img');
const avatar = img ? img.src : '';
const verified = !!cell.querySelector('svg[aria-label="Verified account"]');
let name = screenName;
for (const span of cell.querySelectorAll('span')) {
const t = span.textContent.trim();
if (t && !t.startsWith('@') && !NAME_BLACKLIST.has(t.toLowerCase())) { name = t; break; }
}
users.push({ screen_name: screenName, name, avatar, verified });
});
return users;
}
async function collectAllUsers(kind, onProgress) {
const container = getTimelineContainer(kind) || document;
const seen = new Map();
let idle = 0, lastHeight = -1, rounds = 0;
while (idle < IDLE_ROUNDS && rounds < MAX_SCROLL_ROUNDS) {
extractUsersFromDom(container).forEach(u => seen.set(u.screen_name, u));
onProgress(seen.size);
window.scrollTo(0, document.body.scrollHeight);
await sleep(SCROLL_DELAY_MS);
const h = document.body.scrollHeight;
if (h === lastHeight) idle++; else idle = 0;
lastHeight = h;
rounds++;
}
return [...seen.values()];
}
function getFilteredResults() {
let list = currentTab === 'whitelisted'
? results.filter(u => whitelist.includes(u.screen_name))
: results.filter(u => !whitelist.includes(u.screen_name));
list = list.filter(u => {
if (u.followsBack && !filter.followingBack) return false;
if (!u.followsBack && !filter.notFollowingBack) return false;
if (u.verified && !filter.verified) return false;
return true;
});
if (searchTerm) {
const q = searchTerm.toLowerCase();
list = list.filter(u => u.name.toLowerCase().includes(q) || u.screen_name.toLowerCase().includes(q));
}
return [...list].sort((a, b) => a.screen_name.localeCompare(b.screen_name));
}
function getMaxPage(list) {
return Math.max(1, Math.ceil(list.length / PAGE_SIZE));
}
function getCurrentPageItems(list) {
const p = Math.min(page, getMaxPage(list));
return list.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
}
function toggleWhitelist(screenName) {
if (whitelist.includes(screenName)) {
whitelist = whitelist.filter(x => x !== screenName);
} else {
whitelist.push(screenName);
}
localStorage.setItem(LS_WHITELIST_KEY, JSON.stringify(whitelist));
UI.refreshSidebar();
UI.refreshMain();
}
async function runScan() {
if (isRunning) return;
isRunning = true;
results = [];
selected = new Set();
searchTerm = '';
page = 1;
UI.setScanBtn(false);
try {
UI.setStatus('Detecting your profile…', 'info');
const handle = getMyHandle();
if (!handle) throw new Error('Could not detect your username. Make sure you are logged in to x.com and reload the page.');
UI.setStatus(`Opening @${handle}'s Following list…`, 'info');
UI.setLabel('Following');
if (!(await openFollowList(handle, 'following'))) {
throw new Error(`Could not open /${handle}/following. Open it manually, then click SCAN again.`);
}
await sleep(500);
const followingOk = await waitForSelector('[data-testid="UserCell"]', NAV_TIMEOUT_MS);
if (!followingOk) throw new Error('Your Following list did not load. Try scrolling down manually, then click SCAN again.');
UI.setStatus('Scanning who you follow…', 'info');
const followingList = await collectAllUsers('following', n => UI.setProgress(n));
UI.setStatus(`Opening @${handle}'s Followers list…`, 'info');
UI.setLabel('Followers');
if (!(await openFollowList(handle, 'followers'))) {
throw new Error(`Could not open /${handle}/followers. Open it manually, then click SCAN again.`);
}
await sleep(500);
const followersOk = await waitForSelector('[data-testid="UserCell"]', NAV_TIMEOUT_MS);
if (!followersOk) throw new Error('Your Followers list did not load. Try scrolling down manually, then click SCAN again.');
UI.setStatus('Scanning your followers…', 'info');
const followers = await collectAllUsers('followers', n => UI.setProgress(n));
const followerSet = new Set(followers.map(u => u.screen_name));
results = followingList.map(u => ({ ...u, followsBack: followerSet.has(u.screen_name) }));
const notBackCount = results.filter(u => !u.followsBack).length;
UI.setStatus(`Done! ${notBackCount} people don't follow you back.`, 'success');
viewState = 'results';
UI.renderBody();
} catch (e) {
UI.setStatus('Error: ' + e.message, 'error');
} finally {
isRunning = false;
UI.setScanBtn(true);
}
}
async function unfollowUser(user) {
const ok = await navigateTo(`/${user.screen_name}`);
if (!ok) throw new Error('Could not open profile.');
const avatarSelector = `[data-testid="UserAvatar-Container-${user.screen_name}"]`;
const profileReady = await waitForSelector(avatarSelector, NAV_TIMEOUT_MS);
if (!profileReady) throw new Error('Profile page did not load.');
await sleep(400);
const scope = document.querySelector('[data-testid="primaryColumn"]') || document;
const found = await waitForSelector('button[data-testid$="-unfollow"]', NAV_TIMEOUT_MS, scope);
if (!found) throw new Error('Following button not found (already unfollowed or page changed).');
scope.querySelector('button[data-testid$="-unfollow"]')
.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
const confirmFound = await waitForSelector('[data-testid="confirmationSheetConfirm"]', 6000);
if (!confirmFound) throw new Error('Confirmation dialog did not appear.');
document.querySelector('[data-testid="confirmationSheetConfirm"]')
.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
await sleep(1000);
}
async function runUnfollowQueue() {
const targets = results.filter(u => selected.has(u.screen_name));
if (!targets.length || isUnfollowing) return;
const plural = targets.length > 1 ? 's' : '';
if (!confirm(`Unfollow ${targets.length} account${plural}? This opens each profile and clicks Unfollow. It can't be batch-undone.`)) return;
isUnfollowing = true;
stopUnfollowRequested = false;
unfollowLog = [];
unfollowDone = 0;
unfollowTotal = targets.length;
unfollowStatusMsg = '';
viewState = 'unfollowing';
UI.renderBody();
for (let i = 0; i < targets.length; i++) {
if (stopUnfollowRequested) break;
const user = targets[i];
unfollowStatusMsg = `Unfollowing @${user.screen_name}…`;
UI.refreshSidebar();
try {
await unfollowUser(user);
unfollowLog.push({ screen_name: user.screen_name, name: user.name, success: true });
results = results.filter(u => u.screen_name !== user.screen_name);
selected.delete(user.screen_name);
} catch (e) {
unfollowLog.push({ screen_name: user.screen_name, name: user.name, success: false, error: e.message });
}
unfollowDone = i + 1;
UI.refreshSidebar();
UI.refreshMain();
if (!stopUnfollowRequested && i < targets.length - 1) {
await sleep(randomDelay(UNFOLLOW_MIN_DELAY_MS, UNFOLLOW_MAX_DELAY_MS));
if ((i + 1) % UNFOLLOW_BATCH_SIZE === 0) {
unfollowStatusMsg = 'Pausing briefly to avoid rate limits…';
UI.refreshSidebar();
await sleep(UNFOLLOW_BATCH_PAUSE_MS + (Math.random() * 8000 - 4000));
}
}
}
isUnfollowing = false;
unfollowStatusMsg = '';
UI.refreshSidebar();
}
function escapeHtml(s) {
return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
const UI = (() => {
const ID = 'xuf-root';
function inject() {
if (document.getElementById(ID)) return;
const style = document.createElement('style');
style.textContent = `
#xuf-root *{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
#xuf-root{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(1040px,94vw);min-width:780px;max-width:1400px;height:min(720px,90vh);min-height:480px;max-height:95vh;background:#fff;border:1px solid #e1e8ed;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.4);z-index:9999999;overflow:hidden;display:flex;flex-direction:column;font-size:14px;color:#0f1419;resize:both}
#xuf-header{background:#000;color:#fff;padding:14px 18px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;cursor:move;user-select:none}
#xuf-header h2{font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px}
#xuf-close{background:none;border:none;color:#fff;cursor:pointer;font-size:20px;line-height:1;padding:2px 6px;border-radius:6px;opacity:.7;transition:opacity .15s}
#xuf-close:hover{opacity:1}
#xuf-body{flex:1;overflow:hidden;display:flex;flex-direction:column;min-height:0}
#xuf-idle{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:40px}
#xuf-idle #xuf-scan-btn{width:240px;padding:14px;font-size:16px}
#xuf-status{font-size:13px;padding:8px 14px;border-radius:8px;display:none;max-width:520px;text-align:center}
#xuf-status.info{background:#e8f5fd;color:#1d9bf0;border:1px solid #b3d9f5}
#xuf-status.warn{background:#fff3cd;color:#856404;border:1px solid #ffecb5}
#xuf-status.success{background:#e6f4ea;color:#188038;border:1px solid #b8dfc4}
#xuf-status.error{background:#fce8e6;color:#c5221f;border:1px solid #f5c6c5}
#xuf-scan-btn{padding:10px;background:#000;color:#fff;border:none;border-radius:999px;font-size:15px;font-weight:700;cursor:pointer;transition:background .15s}
#xuf-scan-btn:hover:not(:disabled){background:#333}
#xuf-scan-btn:disabled{opacity:.5;cursor:not-allowed}
#xuf-progress-wrap{width:240px;height:4px;background:#e1e8ed;border-radius:2px;overflow:hidden;display:none}
#xuf-progress-fill{height:100%;background:#1d9bf0;border-radius:2px;transition:width .3s;width:100%}
#xuf-progress-label{font-size:12px;color:#536471;display:none}
#xuf-workspace{flex:1;display:flex;overflow:hidden;min-height:0}
#xuf-sidebar{width:230px;flex-shrink:0;border-right:1px solid #e1e8ed;padding:16px;overflow-y:auto;display:flex;flex-direction:column;gap:14px}
#xuf-main{flex:1;display:flex;flex-direction:column;overflow:hidden;padding:16px;min-width:0}
.xuf-panel-heading{display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:14px}
.xuf-group-label{font-size:11px;text-transform:uppercase;color:#536471;font-weight:700;margin-bottom:4px}
.xuf-badge{display:flex;align-items:center;gap:6px;font-size:13px;padding:4px 0;cursor:pointer}
.xuf-btn-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}
.xuf-btn-secondary{font-size:11px;padding:6px 4px;border-radius:8px;border:1px solid #cfd9de;background:#fff;cursor:pointer;color:#0f1419}
.xuf-btn-secondary:hover{border-color:#000}
.xuf-btn-secondary.danger{color:#e0245e;border-color:#e0245e}
.xuf-stats p{display:flex;justify-content:space-between;font-size:12px;padding:3px 0;color:#536471}
.xuf-stats strong{color:#0f1419}
.xuf-summary h4{font-size:11px;text-transform:uppercase;color:#536471;margin-bottom:6px;font-weight:700}
.xuf-summary-grid{display:flex;flex-direction:column;gap:4px}
.xuf-summary-grid div{display:flex;justify-content:space-between;font-size:12px}
.xuf-pagination{display:flex;align-items:center;justify-content:center;gap:10px;font-size:13px}
.xuf-pagination button{background:none;border:none;cursor:pointer;font-size:14px;color:#1d9bf0;padding:4px 8px}
#xuf-unfollow-btn{margin-top:auto;padding:12px;background:#e0245e;color:#fff;border:none;border-radius:999px;font-weight:700;cursor:pointer;font-size:14px}
#xuf-unfollow-btn:disabled{opacity:.4;cursor:not-allowed}
.xuf-tabs{display:flex;gap:4px;border-bottom:1px solid #e1e8ed;margin-bottom:10px;flex-shrink:0}
.xuf-tab{flex:1;padding:8px;background:none;border:none;border-bottom:2px solid transparent;font-weight:700;font-size:13px;color:#536471;cursor:pointer}
.xuf-tab.active{color:#1d9bf0;border-color:#1d9bf0}
#xuf-search{width:100%;padding:7px 10px;border:1px solid #cfd9de;border-radius:999px;font-size:13px;margin-bottom:10px;outline:none;color:#0f1419;flex-shrink:0}
#xuf-search:focus{border-color:#1d9bf0}
#xuf-list{flex:1;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;gap:8px}
.xuf-user{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #e1e8ed;border-radius:12px;background:#fff;transition:background .1s;cursor:default}
.xuf-user:hover{background:#f7f9f9}
.xuf-avatar{width:40px;height:40px;border-radius:50%;flex-shrink:0;border:1px solid #e1e8ed;cursor:pointer;position:relative;overflow:hidden;background:#e1e8ed}
.xuf-avatar img{width:100%;height:100%;object-fit:cover}
.xuf-avatar.wl{outline:3px solid #1d9bf0;outline-offset:1px}
.xuf-avatar.wl::after{content:'✓';position:absolute;bottom:0;right:0;background:#1d9bf0;color:#fff;font-size:9px;width:14px;height:14px;display:flex;align-items:center;justify-content:center;border-radius:50%}
.xuf-info{flex:1;min-width:0}
.xuf-name{font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#0f1419}
.xuf-verified{color:#1d9bf0;font-size:11px}
.xuf-handle{font-size:12px;color:#536471}
.xuf-followsback{font-size:11px;color:#22c55e;margin-left:6px}
.xuf-profile-btn{font-size:11px;padding:4px 10px;border-radius:999px;border:1px solid #cfd9de;background:#fff;cursor:pointer;color:#0f1419;text-decoration:none;white-space:nowrap;flex-shrink:0}
.xuf-profile-btn:hover{border-color:#000}
.xuf-select{width:18px;height:18px;flex-shrink:0;cursor:pointer}
.xuf-empty{text-align:center;padding:2rem;color:#536471;font-size:13px}
.xuf-queue-status{font-size:12px;color:#1d9bf0;background:#e8f5fd;border:1px solid #b3d9f5;padding:6px 8px;border-radius:8px}
.xuf-log-entry{padding:8px 10px;font-size:13px;border-bottom:1px solid #f0f0f0}
.xuf-log-entry.success a{color:#1d9bf0;text-decoration:none}
.xuf-log-entry.failed{color:#e0245e}
.xuf-log-index{color:#536471;font-size:11px}
.xuf-all-done{text-align:center;padding:16px;font-size:16px;font-weight:700;color:#22c55e}
#xuf-footer{padding:10px 16px;border-top:1px solid #e1e8ed;font-size:11px;color:#536471;display:flex;justify-content:space-between;align-items:center;flex-shrink:0}
#xuf-footer a{color:#1d9bf0;text-decoration:none}
@media(prefers-color-scheme:dark){
#xuf-root{background:#15202b;border-color:#38444d;color:#f7f9f9}
#xuf-header{background:#1d9bf0}
#xuf-sidebar{border-color:#38444d}
.xuf-btn-secondary{background:#15202b;border-color:#38444d;color:#f7f9f9}
.xuf-tabs{border-color:#38444d}
.xuf-tab{color:#8899a6}
#xuf-search{background:#1e2732;border-color:#38444d;color:#f7f9f9}
.xuf-user{border-color:#38444d;background:#15202b}
.xuf-user:hover{background:#1e2732}
.xuf-name{color:#f7f9f9}
.xuf-profile-btn{background:#15202b;border-color:#38444d;color:#f7f9f9}
.xuf-log-entry{border-color:#2f3b44}
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
<button id="xuf-close" data-action="close" title="Close">✕</button>
</div>
<div id="xuf-body"></div>
<div id="xuf-footer">
<span>💙 <a href="https://github.com/SWG56/X-Twitter-follower-checker-code" target="_blank">x-unfollowers</a></span>
<span>Click avatar to whitelist · Check a box to select for unfollow</span>
</div>
`;
document.body.appendChild(root);
root.addEventListener('click', onRootClick);
root.addEventListener('change', onRootChange);
root.addEventListener('input', onRootInput);
makeDraggable(root, document.getElementById('xuf-header'));
renderBody();
}
function makeDraggable(panel, handle) {
let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
handle.addEventListener('mousedown', (e) => {
if (e.target.closest('#xuf-close')) return;
const rect = panel.getBoundingClientRect();
panel.style.left = rect.left + 'px';
panel.style.top = rect.top + 'px';
panel.style.transform = 'none';
dragging = true;
startX = e.clientX;
startY = e.clientY;
startLeft = rect.left;
startTop = rect.top;
e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
if (!dragging) return;
const rect = panel.getBoundingClientRect();
let newLeft = startLeft + (e.clientX - startX);
let newTop = startTop + (e.clientY - startY);
newLeft = Math.max(0, Math.min(window.innerWidth - rect.width, newLeft));
newTop = Math.max(0, Math.min(window.innerHeight - rect.height, newTop));
panel.style.left = newLeft + 'px';
panel.style.top = newTop + 'px';
});
window.addEventListener('mouseup', () => { dragging = false; });
}
function onRootClick(e) {
const el = e.target.closest('[data-action]');
if (!el) return;
const action = el.dataset.action;
if (action === 'scan') {
runScan();
} else if (action === 'close') {
document.getElementById(ID)?.remove();
} else if (action === 'tab') {
currentTab = el.dataset.tab;
page = 1;
document.querySelectorAll('.xuf-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === currentTab));
refreshSidebar();
refreshMain();
} else if (action === 'select-all') {
getFilteredResults().forEach(u => selected.add(u.screen_name));
refreshSidebar();
refreshMain();
} else if (action === 'select-verified') {
getFilteredResults().filter(u => u.verified).forEach(u => selected.add(u.screen_name));
refreshSidebar();
refreshMain();
} else if (action === 'clear-selection') {
selected.clear();
refreshSidebar();
refreshMain();
} else if (action === 'prev-page') {
if (page > 1) { page--; refreshSidebar(); refreshMain(); }
} else if (action === 'next-page') {
const max = getMaxPage(getFilteredResults());
if (page < max) { page++; refreshSidebar(); refreshMain(); }
} else if (action === 'unfollow-selected') {
runUnfollowQueue();
} else if (action === 'toggle-whitelist') {
toggleWhitelist(el.dataset.user);
} else if (action === 'stop-unfollow') {
stopUnfollowRequested = true;
} else if (action === 'back-to-results') {
viewState = 'results';
renderBody();
}
}
function onRootChange(e) {
const el = e.target.closest('[data-action]');
if (!el) return;
const action = el.dataset.action;
if (action === 'toggle-filter') {
filter[el.dataset.filter] = el.checked;
page = 1;
refreshSidebar();
refreshMain();
} else if (action === 'toggle-select') {
if (el.checked) selected.add(el.dataset.user); else selected.delete(el.dataset.user);
refreshSidebar();
} else if (action === 'toggle-log-filter') {
unfollowLogFilter[el.dataset.logfilter] = el.checked;
refreshMain();
}
}
function onRootInput(e) {
const el = e.target.closest('[data-action="search"]');
if (!el) return;
searchTerm = el.value;
page = 1;
refreshSidebar();
refreshMain();
}
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
const wrap = document.getElementById('xuf-progress-wrap');
if (wrap) wrap.style.display = 'block';
}
function setProgress(count) {
const label = document.getElementById('xuf-progress-label');
if (label) label.textContent = `${label.textContent.replace(/ — .*/, '')} — loaded ${count} users…`;
}
function setScanBtn(enabled) {
const btn = document.getElementById('xuf-scan-btn');
if (btn) {
btn.disabled = !enabled;
btn.textContent = enabled ? '▶ SCAN' : '⏳ Scanning…';
}
if (enabled) {
const wrap = document.getElementById('xuf-progress-wrap');
if (wrap) wrap.style.display = 'none';
const label = document.getElementById('xuf-progress-label');
if (label) label.style.display = 'none';
}
}
function renderIdleView() {
return `
<div id="xuf-idle">
<div id="xuf-status"></div>
<button id="xuf-scan-btn" data-action="scan">▶ SCAN</button>
<div id="xuf-progress-wrap"><div id="xuf-progress-fill"></div></div>
<div id="xuf-progress-label"></div>
</div>
`;
}
function renderSidebar() {
const filtered = getFilteredResults();
const notBack = results.filter(u => !u.followsBack);
const verifiedCount = results.filter(u => u.verified).length;
const whitelistedCount = results.filter(u => whitelist.includes(u.screen_name)).length;
return `
<div class="xuf-panel-heading"><span>Results</span><button class="xuf-btn-secondary" data-action="scan">↻ Re-scan</button></div>
<div class="xuf-filter-group">
<p class="xuf-group-label">Filter</p>
<label class="xuf-badge"><input type="checkbox" data-action="toggle-filter" data-filter="notFollowingBack" ${filter.notFollowingBack ? 'checked' : ''}/>Not following back</label>
<label class="xuf-badge"><input type="checkbox" data-action="toggle-filter" data-filter="followingBack" ${filter.followingBack ? 'checked' : ''}/>Following back</label>
<label class="xuf-badge"><input type="checkbox" data-action="toggle-filter" data-filter="verified" ${filter.verified ? 'checked' : ''}/>Verified</label>
</div>
<div class="xuf-btn-grid">
<button class="xuf-btn-secondary" data-action="select-all">All</button>
<button class="xuf-btn-secondary" data-action="select-verified">Verified</button>
<button class="xuf-btn-secondary danger" data-action="clear-selection">Clear</button>
</div>
<div class="xuf-stats">
<p><span>Displayed</span><strong id="xuf-stat-displayed">${filtered.length}</strong></p>
<p><span>Total scanned</span><strong>${results.length}</strong></p>
<p><span>Whitelisted</span><strong>★ ${whitelistedCount}</strong></p>
</div>
<div class="xuf-summary">
<h4>Scan Summary</h4>
<div class="xuf-summary-grid">
<div><span>Not following back</span><strong>${notBack.length}</strong></div>
<div><span>Verified</span><strong>${verifiedCount}</strong></div>
<div><span>Selected</span><strong>${selected.size}</strong></div>
</div>
</div>
<div class="xuf-pagination">
<button data-action="prev-page">❮</button>
<span>${Math.min(page, getMaxPage(filtered))}/${getMaxPage(filtered)}</span>
<button data-action="next-page">❯</button>
</div>
<button id="xuf-unfollow-btn" data-action="unfollow-selected" ${selected.size === 0 ? 'disabled' : ''}>Unfollow (${selected.size})</button>
`;
}
function renderUserRow(u) {
const wl = whitelist.includes(u.screen_name);
const sel = selected.has(u.screen_name);
return `
<div class="xuf-user">
<div class="xuf-avatar${wl ? ' wl' : ''}" data-action="toggle-whitelist" data-user="${u.screen_name}" title="${wl ? 'Remove from whitelist' : 'Add to whitelist'}">
<img src="${(u.avatar || '').replace('_normal', '_bigger')}" alt="${escapeHtml(u.name)}" loading="lazy" />
</div>
<div class="xuf-info">
<div class="xuf-name">${escapeHtml(u.name)} ${u.verified ? '<span class="xuf-verified" title="Verified">✔</span>' : ''}</div>
<div class="xuf-handle">@${u.screen_name}${u.followsBack ? '<span class="xuf-followsback">Follows you</span>' : ''}</div>
</div>
<a class="xuf-profile-btn" href="https://x.com/${u.screen_name}" target="_blank" rel="noreferrer">Profile ↗</a>
<input type="checkbox" class="xuf-select" data-action="toggle-select" data-user="${u.screen_name}" ${sel ? 'checked' : ''} />
</div>
`;
}
function renderListItems() {
const items = getCurrentPageItems(getFilteredResults());
return items.length ? items.map(renderUserRow).join('') : '<div class="xuf-empty">No users found.</div>';
}
function renderMain() {
return `
<nav class="xuf-tabs">
<button class="xuf-tab ${currentTab === 'nonWhitelisted' ? 'active' : ''}" data-action="tab" data-tab="nonWhitelisted">Non-Whitelisted</button>
<button class="xuf-tab ${currentTab === 'whitelisted' ? 'active' : ''}" data-action="tab" data-tab="whitelisted">Whitelisted</button>
</nav>
<input id="xuf-search" type="text" placeholder="Search by name or @handle…" value="${escapeHtml(searchTerm)}" data-action="search" />
<div id="xuf-list">${renderListItems()}</div>
`;
}
function renderQueueSidebar() {
const pct = unfollowTotal ? Math.round((unfollowDone / unfollowTotal) * 100) : 0;
return `
<div class="xuf-panel-heading"><span>Unfollow Queue</span><strong>${pct}%</strong></div>
${unfollowStatusMsg ? `<div class="xuf-queue-status">${escapeHtml(unfollowStatusMsg)}</div>` : ''}
<div class="xuf-filter-group">
<p class="xuf-group-label">Filter</p>
<label class="xuf-badge"><input type="checkbox" data-action="toggle-log-filter" data-logfilter="showSucceeded" ${unfollowLogFilter.showSucceeded ? 'checked' : ''}/>Succeeded</label>
<label class="xuf-badge"><input type="checkbox" data-action="toggle-log-filter" data-logfilter="showFailed" ${unfollowLogFilter.showFailed ? 'checked' : ''}/>Failed</label>
</div>
${isUnfollowing
? `<button class="xuf-btn-secondary danger" data-action="stop-unfollow">Stop</button>`
: `<button class="xuf-btn-secondary" data-action="back-to-results">Back to results</button>`}
`;
}
function renderQueueLog() {
const entries = unfollowLog.filter(e => (e.success && unfollowLogFilter.showSucceeded) || (!e.success && unfollowLogFilter.showFailed));
const allDone = !isUnfollowing && unfollowLog.length > 0;
return `
${allDone ? '<div class="xuf-all-done">All DONE!</div>' : ''}
${entries.map((entry, i) => entry.success
? `<div class="xuf-log-entry success">Unfollowed <a href="https://x.com/${entry.screen_name}" target="_blank" rel="noreferrer">@${entry.screen_name}</a><span class="xuf-log-index"> [${i + 1}/${entries.length}]</span></div>`
: `<div class="xuf-log-entry failed">Failed to unfollow @${entry.screen_name} — ${escapeHtml(entry.error || '')}</div>`
).join('')}
`;
}
function renderBody() {
const body = document.getElementById('xuf-body');
if (!body) return;
if (viewState === 'idle') {
body.innerHTML = renderIdleView();
} else {
body.innerHTML = `
<div id="xuf-workspace">
<aside id="xuf-sidebar"></aside>
<main id="xuf-main"></main>
</div>`;
refreshSidebar();
refreshMain();
}
}
function refreshSidebar() {
const el = document.getElementById('xuf-sidebar');
if (!el) return;
el.innerHTML = viewState === 'unfollowing' ? renderQueueSidebar() : renderSidebar();
}
function refreshMain() {
const main = document.getElementById('xuf-main');
if (!main) return;
if (viewState === 'unfollowing') {
main.innerHTML = renderQueueLog();
return;
}
const list = document.getElementById('xuf-list');
if (list) {
list.innerHTML = renderListItems();
} else {
main.innerHTML = renderMain();
}
}
return { inject, setStatus, setLabel, setProgress, setScanBtn, renderBody, refreshSidebar, refreshMain };
})();
UI.inject();
console.log('%c X Unfollowers loaded! Click SCAN in the panel. ', 'background:#000;color:#fff;font-size:14px;padding:4px 8px;border-radius:4px;');
})();