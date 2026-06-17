// session.js — Real-time listening session + live chat for The Vault
// ─────────────────────────────────────────────────────────────────────────────
// ES module — loaded via <script type="module" src="session.js">.
// Uses Firebase v12.13.0 modular SDK; imports db + app from firebase-config.js.
//
// Firebase data layout:
//   sessions/{VAULT-XXXX}/
//     hostId        : string
//     guestId       : string | null
//     createdAt     : number
//     version       : number
//     state/
//       trackId     : string
//       isPlaying   : boolean
//       currentTime : number
//       timestamp   : number
//     messages/{pushId}/
//       uid         : 'host' | 'guest'
//       text        : string
//       timestamp   : number
//     typing/
//       host        : boolean
//       guest       : boolean
//
// Vault.js interop:
//   • getPlaylist(), playAtIndex(), showToast() — window globals (function decls)
//   • Current track detected via document.querySelector('.track-card.playing')
// ─────────────────────────────────────────────────────────────────────────────

import { db, app } from './firebase-config.js';
import {
  ref, set, get, remove, onValue, push, onChildAdded,
  onDisconnect as rtdbOnDisconnect,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-database.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js';

// ── Session state ─────────────────────────────────────────────────────────────
let sessionRef    = null;
let stateRef      = null;
let heartbeatTimer= null;
let titleObserver = null;
let audioListeners= null;
let _onStemsChanged = null; // FIX: Stems + session sync — listener ref for cleanup — The Vault conflict resolution
let guestStateOff = null;   // unsubscribe — guest watching host state
let guestIdOff    = null;   // unsubscribe — host watching for guest join
let hostIdOff     = null;   // unsubscribe — guest watching for host removal

let sessionRole   = null;   // 'host' | 'guest' | null
let roomCode      = null;
let myUid         = null;
let isActive      = false;
let panelOpen     = false;
let lastApplied   = null;
let syncCooldown  = false;
let authOk        = false;

// Feature 4: collab queue
let collabQueueOff = null;

// Feature 5: session play log
let sessionPlayLog   = [];
let sessionStartTime = null;

// Expose session state to vault.js
window._vaultSession = { isActive: false, role: null, roomCode: null };

const SESSION_VERSION = 1;
const SESSION_TTL_MS  = 86400000; // 24 h

// ── Chat state ────────────────────────────────────────────────────────────────
let chatOpen       = false;
let unreadCount    = 0;
let messagesOff    = null;  // onChildAdded unsubscribe
let typingOff      = null;  // onValue unsubscribe for other party typing
let typingTimer    = null;  // debounce handle for own typing state
const MAX_MSG_LEN  = 280;

// ── Reactions state ───────────────────────────────────────────────────────────
let reactionsOff      = null;
let reactionTimestamps = [];
const REACTION_EMOJIS  = ['🔥','💀','🎯','💯','😭','👑','🤯','💸'];

// ── Inject reaction CSS (keyframes only — structure CSS is in index.html) ─────
(function injectReactionStyles() {
  const s = document.createElement('style');
  s.textContent = `
    @keyframes reactionFloat {
      0%   { transform:translateY(0) translateX(var(--rxn-dx,0px)) rotate(var(--rxn-r,0deg)); opacity:1; }
      70%  { opacity:1; }
      100% { transform:translateY(-220px) translateX(calc(var(--rxn-dx,0px)*2)) rotate(calc(var(--rxn-r,0deg)+15deg)); opacity:0; }
    }
    .reaction-float {
      position:fixed;
      font-size:30px;
      pointer-events:none;
      z-index:9999;
      animation:reactionFloat 2.5s ease-out forwards;
    }
    @keyframes rxnTap {
      0%   { transform:scale(1); }
      35%  { transform:scale(0.8); }
      70%  { transform:scale(1.2); }
      100% { transform:scale(1); }
    }
    .rxn-btn.tap-anim { animation:rxnTap 0.25s ease; }
    #reaction-bar {
      display:none;
      flex-wrap:wrap;
      gap:4px;
      padding:8px 12px 4px;
      border-top:1px solid rgba(255,255,255,0.06);
    }
    .rxn-btn {
      min-width:44px;
      min-height:44px;
      background:none;
      border:none;
      font-size:22px;
      cursor:pointer;
      border-radius:8px;
      flex:1;
      display:flex;
      align-items:center;
      justify-content:center;
      transition:background 0.1s;
    }
    .rxn-btn:hover { background:rgba(255,255,255,0.08); }
    .rxn-btn.on-cooldown { opacity:0.35; pointer-events:none; }
  `;
  document.head.appendChild(s);
})();

// ── Inject reaction bar HTML above chat input ────────────────────────────────
(function injectReactionBar() {
  // Wait for DOM to be ready
  function inject() {
    const inputArea = document.querySelector('.chat-input-area');
    if (!inputArea || document.getElementById('reaction-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'reaction-bar';
    bar.innerHTML = REACTION_EMOJIS.map(e =>
      `<button class="rxn-btn" data-emoji="${e}" title="${e}">${e}</button>`
    ).join('');
    inputArea.parentNode.insertBefore(bar, inputArea);
    bar.querySelectorAll('.rxn-btn').forEach(btn => {
      btn.addEventListener('click', () => sendReaction(btn.dataset.emoji, btn));
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();

// ── Bootstrap ─────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => setTimeout(boot, 650));

async function boot() {
  try {
    const auth   = getAuth(app);
    const result = await signInAnonymously(auth);
    myUid  = result.user.uid;
    authOk = true;
    window._vaultUid = myUid; // expose for vault.js comment writes
    console.log('[Session] Signed in anonymously — uid:', myUid);
  } catch (err) {
    console.error('[Session] Anonymous auth failed — code:', err.code, '|', err.message);
    if (err.code === 'auth/configuration-not-found' ||
        err.code === 'auth/admin-restricted-operation' ||
        err.code === 'auth/operation-not-allowed') {
      console.error('[Session] → Firebase Console → Authentication → Sign-in method → enable Anonymous.');
    }
    myUid = 'local-' + Math.random().toString(36).slice(2, 11);
  }
  wireUI();
}

// ── Wire up UI ────────────────────────────────────────────────────────────────
function wireUI() {
  // Session panel
  on('session-btn',          'click', togglePanel);
  on('session-start-btn',    'click', startSession);
  on('session-join-btn',     'click', handleJoinClick);
  on('session-end-btn',      'click', () => endSession());
  on('session-leave-btn',    'click', () => endSession());
  on('session-code-copy-btn','click', copyCode);

  const joinInp = document.getElementById('session-join-input');
  if (joinInp) {
    joinInp.addEventListener('keydown', e => {
      if (e.key === 'Enter') handleJoinClick();
      requestAnimationFrame(() => { joinInp.value = joinInp.value.toUpperCase(); });
    });
  }

  // Close session panel on outside click
  document.addEventListener('click', e => {
    const panel = document.getElementById('session-panel');
    const btn   = document.getElementById('session-btn');
    if (panel && panelOpen && !panel.contains(e.target) && e.target !== btn) closePanel();
  }, true);

  // Chat UI
  on('chat-tab',         'click', toggleChat);
  on('chat-collapse-btn','click', closeChat);
  on('chat-send-btn',    'click', sendMessage);

  const ci = document.getElementById('chat-input');
  if (ci) {
    ci.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    ci.addEventListener('input', onChatInput);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SESSION — PANEL HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function togglePanel() { panelOpen ? closePanel() : openPanel(); }

function openPanel() {
  const el = document.getElementById('session-panel');
  if (el) { el.classList.add('visible'); panelOpen = true; }
}

function closePanel() {
  const el = document.getElementById('session-panel');
  if (el) { el.classList.remove('visible'); panelOpen = false; }
}

function showView(id) {
  ['sv-inactive', 'sv-host', 'sv-guest'].forEach(v => {
    const el = document.getElementById(v);
    if (el) el.style.display = (v === id) ? '' : 'none';
  });
}

function setBtnActive(active) {
  const btn   = document.getElementById('session-btn');
  const badge = document.getElementById('session-live-badge');
  if (!btn) return;
  btn.classList.toggle('session-active', active);
  if (badge) badge.classList.toggle('visible', active);
}

// ── Room code ──────────────────────────────────────────────────────────────────
function genCode() { return 'VAULT-' + (Math.floor(Math.random() * 9000) + 1000); }

function copyCode() {
  if (!roomCode) return;
  navigator.clipboard.writeText(roomCode)
    .then(()  => toast('CODE COPIED ✓', 'success'))
    .catch(()  => toast(roomCode, ''));
}

// ══════════════════════════════════════════════════════════════════════════════
// SESSION — HOST
// ══════════════════════════════════════════════════════════════════════════════

async function startSession() {
  if (!authOk) {
    if (!myUid) { toast('FIREBASE NOT READY', 'error'); return; }
    toast('ENABLE ANONYMOUS AUTH IN FIREBASE CONSOLE', 'error');
    console.error('[Session] Anonymous auth not ready — enable it in Firebase Console → Authentication → Sign-in method → Anonymous.');
    return;
  }

  roomCode   = genCode();
  sessionRef = ref(db, 'sessions/' + roomCode);
  stateRef   = ref(db, 'sessions/' + roomCode + '/state');

  try {
    await set(sessionRef, {
      hostId   : myUid,
      guestId  : null,
      version  : SESSION_VERSION,
      createdAt: serverTimestamp(),
    });
    await set(stateRef, snapshot());
    rtdbOnDisconnect(sessionRef).remove();
  } catch (e) {
    console.error('[Session] startSession error — code:', e.code, '|', e.message);
    toast('SESSION ERROR: ' + fmtErr(e), 'error');
    reset(); return;
  }

  isActive    = true;
  sessionRole = 'host';
  sessionStartTime = Date.now();
  sessionPlayLog   = [];
  window._vaultSession = { isActive: true, role: 'host', roomCode };
  setBtnActive(true);
  setEl('session-room-code', roomCode);
  setEl('session-guest-status', 'WAITING FOR GUEST…');
  document.getElementById('session-guest-status')?.classList.remove('connected');
  openPanel();
  showView('sv-host');
  navigator.clipboard.writeText(roomCode).catch(() => {});
  toast('SESSION STARTED — CODE: ' + roomCode, 'success');

  const guestIdRef = ref(db, 'sessions/' + roomCode + '/guestId');
  guestIdOff = onValue(guestIdRef, snap => {
    const guestId  = snap.val();
    const statusEl = document.getElementById('session-guest-status');
    if (!statusEl) return;
    if (guestId) {
      statusEl.textContent = '● GUEST CONNECTED';
      statusEl.classList.add('connected');
    } else {
      statusEl.textContent = 'WAITING FOR GUEST…';
      statusEl.classList.remove('connected');
    }
  });

  attachHostListeners();
  startHeartbeat();
  startChat('host');
  attachCollabQueue();
  window.addEventListener('beforeunload', onUnload);
}

function snapshot() {
  const audio = getAudio();
  // FIX: Stems + session sync — include stem state in snapshot — The Vault conflict resolution
  const stems = typeof window.getVaultStemState === 'function' ? window.getVaultStemState() : undefined;
  return {
    trackId    : currentTrackId(),
    isPlaying  : !!(audio && !audio.paused),
    currentTime: audio?.currentTime ?? 0,
    timestamp  : Date.now(),
    ...(stems ? { stems } : {}),
  };
}

function pushState() {
  if (!myUid || sessionRole !== 'host' || !stateRef || !isActive) return;
  set(stateRef, snapshot()).catch(e => console.warn('[Session] pushState failed:', e.message));
}

function attachHostListeners() {
  const audio = getAudio();
  if (!audio) return;
  const onPlay      = () => pushState();
  const onPause     = () => pushState();
  const onSeeked    = () => pushState();
  const onLoadStart = () => requestAnimationFrame(pushState);
  audio.addEventListener('play',      onPlay);
  audio.addEventListener('pause',     onPause);
  audio.addEventListener('seeked',    onSeeked);
  audio.addEventListener('loadstart', onLoadStart);
  audioListeners = { audio, onPlay, onPause, onSeeked, onLoadStart };
  const titleEl = document.getElementById('player-title');
  if (titleEl) {
    titleObserver = new MutationObserver(() => setTimeout(pushState, 160));
    titleObserver.observe(titleEl, { childList: true, subtree: true, characterData: true });
  }
  // FIX: Stems + session sync — listen for stem changes from vault.js — The Vault conflict resolution
  _onStemsChanged = () => pushState();
  document.addEventListener('vault:stems-changed', _onStemsChanged);
}

function detachHostListeners() {
  if (audioListeners) {
    const { audio, onPlay, onPause, onSeeked, onLoadStart } = audioListeners;
    audio.removeEventListener('play',      onPlay);
    audio.removeEventListener('pause',     onPause);
    audio.removeEventListener('seeked',    onSeeked);
    audio.removeEventListener('loadstart', onLoadStart);
    audioListeners = null;
  }
  if (titleObserver) { titleObserver.disconnect(); titleObserver = null; }
  // FIX: Stems + session sync — remove stem listener on detach — The Vault conflict resolution
  if (_onStemsChanged) { document.removeEventListener('vault:stems-changed', _onStemsChanged); _onStemsChanged = null; }
}

function startHeartbeat() { heartbeatTimer = setInterval(pushState, 5000); }
function stopHeartbeat()  { if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; } }

// ══════════════════════════════════════════════════════════════════════════════
// SESSION — GUEST
// ══════════════════════════════════════════════════════════════════════════════

async function handleJoinClick() {
  const inp  = document.getElementById('session-join-input');
  const code = (inp?.value || '').trim().toUpperCase();
  if (!code) { toast('ENTER A ROOM CODE', 'error'); return; }
  await joinSession(code);
}

async function joinSession(code) {
  if (!authOk) {
    if (!myUid) { toast('FIREBASE NOT READY', 'error'); return; }
    toast('ENABLE ANONYMOUS AUTH IN FIREBASE CONSOLE', 'error'); return;
  }
  if (!/^VAULT-\d{4}$/.test(code)) {
    toast('INVALID CODE — FORMAT: VAULT-0000', 'error'); return;
  }

  let data;
  try {
    const snap = await get(ref(db, 'sessions/' + code));
    if (!snap.exists()) { toast('SESSION NOT FOUND', 'error'); return; }
    data = snap.val();
  } catch (e) {
    console.error('[Session] joinSession lookup error:', e.code, e.message);
    toast('COULD NOT REACH SERVER: ' + fmtErr(e), 'error'); return;
  }

  if (data.guestId && data.guestId !== myUid) { toast('SESSION IS FULL', 'error'); return; }
  if (data.createdAt && Date.now() - data.createdAt > SESSION_TTL_MS) { toast('SESSION EXPIRED', 'error'); return; }

  roomCode    = code;
  sessionRef  = ref(db, 'sessions/' + roomCode);
  stateRef    = ref(db, 'sessions/' + roomCode + '/state');
  sessionRole = 'guest';

  try {
    const guestIdRef = ref(db, 'sessions/' + roomCode + '/guestId');
    await set(guestIdRef, myUid);
    rtdbOnDisconnect(guestIdRef).set(null);
  } catch {
    toast('COULD NOT JOIN SESSION', 'error');
    reset(); return;
  }

  isActive = true;
  sessionStartTime = Date.now();
  sessionPlayLog   = [];
  window._vaultSession = { isActive: true, role: 'guest', roomCode };
  setBtnActive(true);
  lockControls();
  openPanel();
  showView('sv-guest');
  toast('JOINED — LISTENING LIVE 🎵', 'success');

  guestStateOff = onValue(stateRef, onGuestState);
  const hostIdRef = ref(db, 'sessions/' + roomCode + '/hostId');
  hostIdOff = onValue(hostIdRef, snap => {
    if (snap.val() === null && isActive) handleEndedByHost();
  });

  startChat('guest');
  attachCollabQueue();
  window.addEventListener('beforeunload', onUnload);
}

function onGuestState(snap) {
  if (!snap.exists() || sessionRole !== 'guest') return;
  const s = snap.val();
  if (!s) return;
  const audio      = getAudio();
  if (!audio) return;
  const latency    = Math.max(0, (Date.now() - s.timestamp) / 1000);
  const targetTime = s.currentTime + (s.isPlaying ? latency : 0);
  // FIX: Stems + session sync — apply stem state received from host — The Vault conflict resolution
  if (s.stems && typeof window.applyGuestStemState === 'function') {
    window.applyGuestStemState(s.stems);
  }

  if (s.trackId && String(s.trackId) !== String(lastApplied)) {
    lastApplied = String(s.trackId);
    applyTrackChange(s.trackId, targetTime, s.isPlaying);
    return;
  }
  if (!syncCooldown && Math.abs(audio.currentTime - targetTime) > 2) {
    syncCooldown = true;
    audio.currentTime = Math.max(0, targetTime);
    setTimeout(() => { syncCooldown = false; }, 2500);
  }
  syncPlayPause(audio, s.isPlaying);
}

function applyTrackChange(trackId, targetTime, shouldPlay) {
  const playlist = getPlaylist_();
  const idx      = playlist.findIndex(x => String(x.id) === String(trackId));
  if (idx === -1) return;
  const audio       = getAudio();
  const playingCard = document.querySelector('.track-card.playing');
  const currentId   = playingCard?.dataset?.id;
  if (String(currentId) === String(trackId) && audio?.src) {
    audio.currentTime = Math.max(0, targetTime);
    syncPlayPause(audio, shouldPlay);
    return;
  }
  if (typeof playAtIndex === 'function') playAtIndex(idx);
  logTrackPlay(playlist[idx]);
  const seekAfterLoad = () => {
    audio.currentTime = Math.max(0, targetTime);
    syncPlayPause(audio, shouldPlay);
  };
  if (audio.readyState >= 3) seekAfterLoad();
  else audio.addEventListener('canplay', seekAfterLoad, { once: true });
}

function syncPlayPause(audio, shouldPlay) {
  if (shouldPlay && audio.paused) {
    audio.play().catch(err => {
      if (err.name === 'NotAllowedError') toast('TAP ▶ TO SYNC AUDIO', '');
    });
  } else if (!shouldPlay && !audio.paused) {
    audio.pause();
  }
}

function lockControls() {
  document.body.classList.add('session-guest');
  // FIX: Stems + session sync — disable stem controls for guest — The Vault conflict resolution
  if (typeof setStemChannelDisabled === 'function') {
    ['vocals','drums','bass','other','keys'].forEach(k => setStemChannelDisabled(k, true));
  }
}
function unlockControls() {
  document.body.classList.remove('session-guest');
  // FIX: Stems + session sync — restore stem controls for host — The Vault conflict resolution
  if (typeof setStemChannelDisabled === 'function') {
    ['vocals','drums','bass','other','keys'].forEach(k => setStemChannelDisabled(k, false));
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SESSION — END / RESET
// ══════════════════════════════════════════════════════════════════════════════

async function endSession() {
  if (!isActive) return;
  const logCopy   = sessionPlayLog.slice();
  const startCopy = sessionStartTime;
  try {
    if (sessionRole === 'host') {
      if (sessionRef) await remove(sessionRef); // wipes messages + typing too
    } else {
      if (guestStateOff) { guestStateOff(); guestStateOff = null; }
      if (hostIdOff)     { hostIdOff();     hostIdOff     = null; }
      const guestIdRef   = ref(db, 'sessions/' + roomCode + '/guestId');
      await set(guestIdRef, null);
      unlockControls();
    }
  } catch { /* ignore cleanup errors */ }

  stopChat();
  reset();
  showView('sv-inactive');
  setBtnActive(false);
  closePanel();
  toast('SESSION ENDED', '');
  window.removeEventListener('beforeunload', onUnload);
  if (logCopy.length >= 2) showSessionEndModal(logCopy, startCopy);
}

function handleEndedByHost() {
  const logCopy   = sessionPlayLog.slice();
  const startCopy = sessionStartTime;
  if (guestStateOff) { guestStateOff(); guestStateOff = null; }
  if (hostIdOff)     { hostIdOff();     hostIdOff     = null; }
  unlockControls();
  stopChat();
  reset();
  showView('sv-inactive');
  setBtnActive(false);
  toast('HOST ENDED THE SESSION', '');
  window.removeEventListener('beforeunload', onUnload);
  if (logCopy.length >= 2) showSessionEndModal(logCopy, startCopy);
}

function onUnload() {
  if (sessionRole === 'host' && sessionRef) {
    remove(sessionRef);
  }
  if (sessionRole === 'guest' && roomCode) {
    set(ref(db, 'sessions/' + roomCode + '/guestId'), null);
    set(ref(db, 'sessions/' + roomCode + '/typing/guest'), false);
  }
}

function reset() {
  isActive     = false;
  sessionRole  = null;
  roomCode     = null;
  lastApplied  = null;
  syncCooldown = false;
  sessionPlayLog   = [];
  sessionStartTime = null;
  window._vaultSession = { isActive: false, role: null, roomCode: null };
  if (collabQueueOff) { collabQueueOff(); collabQueueOff = null; }
  stopHeartbeat();
  detachHostListeners();
  if (guestIdOff)    { guestIdOff();    guestIdOff    = null; }
  if (guestStateOff) { guestStateOff(); guestStateOff = null; }
  if (hostIdOff)     { hostIdOff();     hostIdOff     = null; }
  sessionRef = null;
  stateRef   = null;
}

// ══════════════════════════════════════════════════════════════════════════════
// CHAT
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Called right after a session becomes active.
 * Wires Firebase listeners and shows the chat tab.
 */
function startChat(role) {
  const wrap = document.getElementById('chat-wrap');
  if (wrap) wrap.style.display = 'flex';

  setEl('chat-room-label', roomCode || '');
  clearChatDOM();

  // Stream incoming messages
  const msgsRef = ref(db, 'sessions/' + roomCode + '/messages');
  messagesOff = onChildAdded(msgsRef, snap => {
    const msg = snap.val();
    if (msg) renderMessage(msg);
  });

  // Watch the OTHER party's typing indicator
  const otherRole    = role === 'host' ? 'guest' : 'host';
  const otherTypingR = ref(db, 'sessions/' + roomCode + '/typing/' + otherRole);
  typingOff = onValue(otherTypingR, snap => onTypingChange(snap.val(), otherRole));

  // Start reactions
  startReactions();
  const bar = document.getElementById('reaction-bar');
  if (bar) bar.style.display = 'flex';
}

/**
 * Called when a session ends (either party).
 * Cleans up Firebase listeners and hides the chat UI.
 */
function stopChat() {
  if (messagesOff) { messagesOff(); messagesOff = null; }
  if (typingOff)   { typingOff();   typingOff   = null; }
  if (typingTimer) { clearTimeout(typingTimer); typingTimer = null; }

  // Clear own typing flag from Firebase
  if (roomCode && sessionRole) {
    set(ref(db, 'sessions/' + roomCode + '/typing/' + sessionRole), false).catch(() => {});
  }

  // Stop reactions
  stopReactions();
  const bar = document.getElementById('reaction-bar');
  if (bar) bar.style.display = 'none';

  // Hide UI
  closeChat();
  const wrap = document.getElementById('chat-wrap');
  if (wrap) wrap.style.display = 'none';
  clearChatDOM();
  setUnread(0);
}

// ── Panel toggle ──────────────────────────────────────────────────────────────
function toggleChat() { chatOpen ? closeChat() : openChat(); }

function openChat() {
  const panel = document.getElementById('chat-panel');
  if (panel) panel.classList.add('open');
  chatOpen = true;
  setUnread(0);
  requestAnimationFrame(scrollMessages);
}

function closeChat() {
  const panel = document.getElementById('chat-panel');
  if (panel) panel.classList.remove('open');
  chatOpen = false;
}

// ── Send ──────────────────────────────────────────────────────────────────────
function sendMessage() {
  if (!isActive || !roomCode || !sessionRole) return;
  const inp  = document.getElementById('chat-input');
  const text = (inp?.value || '').trim().slice(0, MAX_MSG_LEN);
  if (!text) return;

  push(ref(db, 'sessions/' + roomCode + '/messages'), {
    uid      : sessionRole,
    text,
    timestamp: Date.now(),
  }).catch(e => console.warn('[Chat] send failed:', e.message));

  inp.value = '';
  clearTyping(); // stop own typing indicator immediately
}

// ── Render a single message bubble ────────────────────────────────────────────
function renderMessage(msg) {
  const wrap = document.getElementById('chat-messages');
  if (!wrap) return;

  const isMine = msg.uid === sessionRole;

  const msgEl  = document.createElement('div');
  msgEl.className = 'chat-msg ' + (isMine ? 'mine' : 'theirs');

  const bubble = document.createElement('div');
  bubble.className  = 'chat-bubble';
  bubble.textContent = msg.text;

  const time = document.createElement('span');
  time.className  = 'chat-time';
  time.textContent = fmtTime(msg.timestamp);

  msgEl.append(bubble, time);
  wrap.appendChild(msgEl);

  if (chatOpen) {
    scrollMessages();
  } else {
    setUnread(unreadCount + 1);
  }
}

function clearChatDOM() {
  const wrap   = document.getElementById('chat-messages');
  const typing = document.getElementById('chat-typing');
  if (wrap)   wrap.innerHTML = '';
  if (typing) typing.textContent = '';
}

function scrollMessages() {
  const wrap = document.getElementById('chat-messages');
  if (wrap) wrap.scrollTop = wrap.scrollHeight;
}

// ── Unread badge ──────────────────────────────────────────────────────────────
function setUnread(n) {
  unreadCount = n;
  const badge = document.getElementById('chat-badge');
  if (!badge) return;
  badge.textContent = n > 9 ? '9+' : String(n);
  badge.classList.toggle('visible', n > 0);
}

// ── Typing indicator ──────────────────────────────────────────────────────────
function onChatInput() {
  if (!isActive || !roomCode || !sessionRole) return;
  set(ref(db, 'sessions/' + roomCode + '/typing/' + sessionRole), true).catch(() => {});
  if (typingTimer) clearTimeout(typingTimer);
  typingTimer = setTimeout(clearTyping, 2000);
}

function clearTyping() {
  if (typingTimer) { clearTimeout(typingTimer); typingTimer = null; }
  if (!roomCode || !sessionRole) return;
  set(ref(db, 'sessions/' + roomCode + '/typing/' + sessionRole), false).catch(() => {});
}

function onTypingChange(isTyping, role) {
  const el = document.getElementById('chat-typing');
  if (!el) return;
  el.textContent = isTyping ? (role.toUpperCase() + ' IS TYPING…') : '';
}

// ══════════════════════════════════════════════════════════════════════════════
// VAULT.JS INTEROP
// ══════════════════════════════════════════════════════════════════════════════

function getAudio() { return document.getElementById('audio-player'); }

function getPlaylist_() {
  try { if (typeof getPlaylist === 'function') return getPlaylist(); } catch { /* ignore */ }
  return [];
}

function currentTrackId() {
  const playingCard = document.querySelector('.track-card.playing');
  if (playingCard?.dataset?.id) return String(playingCard.dataset.id);
  try {
    const pl = getPlaylist_();
    if (pl.length && typeof currentTrackIdx !== 'undefined') {
      const t = pl[currentTrackIdx];
      return t ? String(t.id) : '';
    }
  } catch { /* ignore */ }
  return '';
}

// ── DOM helpers ───────────────────────────────────────────────────────────────
function on(id, event, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, fn);
}

function setEl(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function toast(msg, type) {
  if (typeof showToast === 'function') showToast(msg, type);
  else console.log('[Session]', msg);
}

function fmtErr(e) {
  if (!e) return 'UNKNOWN';
  const raw = (e.code || e.message || String(e)).toUpperCase();
  if (raw.includes('PERMISSION_DENIED'))     return 'PERMISSION DENIED — CHECK DB RULES';
  if (raw.includes('NETWORK'))               return 'NETWORK ERROR';
  if (raw.includes('UNAUTHENTICATED'))       return 'NOT AUTHENTICATED';
  if (raw.includes('NOT_ALLOWED') ||
      raw.includes('OPERATION-NOT-ALLOWED')) return 'ENABLE ANONYMOUS AUTH';
  if (raw.includes('CONFIGURATION-NOT-FOUND')) return 'AUTH NOT CONFIGURED';
  return raw.replace(/^(DATABASE\/|AUTH\/)/, '').slice(0, 40);
}

function fmtTime(ts) {
  if (!ts) return '';
  const d    = new Date(ts);
  let   h    = d.getHours();
  const m    = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return h + ':' + String(m).padStart(2, '0') + ' ' + ampm;
}

// ══════════════════════════════════════════════════════════════════════════════
// REACTIONS
// ══════════════════════════════════════════════════════════════════════════════

function startReactions() {
  if (!roomCode) return;
  const reactRef = ref(db, 'sessions/' + roomCode + '/reactions');
  reactionsOff = onChildAdded(reactRef, snap => {
    const r = snap.val();
    if (!r) return;
    animateReaction(r.emoji, r.x);
    // Delete from Firebase after 5s so it stays ephemeral
    setTimeout(() => { remove(snap.ref).catch(() => {}); }, 5000);
  });
}

function stopReactions() {
  if (reactionsOff) { reactionsOff(); reactionsOff = null; }
  reactionTimestamps = [];
}

function sendReaction(emoji, btnEl) {
  if (!isActive || !roomCode || !sessionRole) return;
  const now = Date.now();
  reactionTimestamps = reactionTimestamps.filter(t => now - t < 5000);
  if (reactionTimestamps.length >= 3) {
    // Cooldown — briefly dim the button
    if (btnEl) {
      btnEl.classList.add('on-cooldown');
      setTimeout(() => btnEl.classList.remove('on-cooldown'), 1200);
    }
    return;
  }
  reactionTimestamps.push(now);

  // Tap animation
  if (btnEl) {
    btnEl.classList.remove('tap-anim');
    void btnEl.offsetWidth; // reflow to restart animation
    btnEl.classList.add('tap-anim');
    setTimeout(() => btnEl.classList.remove('tap-anim'), 260);
  }

  push(ref(db, 'sessions/' + roomCode + '/reactions'), {
    uid      : sessionRole,
    emoji,
    timestamp: now,
    x        : Math.random(),
  }).catch(() => {});
}

function animateReaction(emoji, x) {
  const el = document.createElement('div');
  el.className = 'reaction-float';
  el.textContent = emoji;
  const pct  = ((x ?? Math.random()) * 70 + 10);   // 10–80% of viewport width
  const dx   = (Math.random() - 0.5) * 40;          // ±20px horizontal drift
  const rot  = (Math.random() - 0.5) * 30;          // ±15deg rotation
  el.style.cssText = `left:${pct}%;bottom:168px;--rxn-dx:${dx}px;--rxn-r:${rot}deg`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 4 — COLLAB QUEUE
// ══════════════════════════════════════════════════════════════════════════════

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function attachCollabQueue() {
  if (!roomCode) return;
  // Clear any existing items in both lists
  ['sv-collab-queue-list', 'sv-collab-queue-list-guest'].forEach(lid => {
    const el = document.getElementById(lid);
    if (el) el.innerHTML = '<div class="sv-queue-empty">No tracks queued yet</div>';
  });

  const qRef = ref(db, 'sessions/' + roomCode + '/collabQueue');
  collabQueueOff = onChildAdded(qRef, snap => {
    const item = snap.val();
    if (!item) return;
    const listIds = ['sv-collab-queue-list', 'sv-collab-queue-list-guest'];
    listIds.forEach(lid => {
      const list2 = document.getElementById(lid);
      if (!list2) return;
      const empty = list2.querySelector('.sv-queue-empty');
      if (empty) empty.remove();
      const div = document.createElement('div');
      div.className = 'sv-queue-item';
      div.innerHTML =
        '<span class="sv-queue-by">' + (item.addedBy === 'guest' ? '◎' : '◉') + '</span>' +
        '<span class="sv-queue-info">' +
          '<span class="sv-queue-title">' + escHtml(item.title) + '</span>' +
          '<span class="sv-queue-artist">' + escHtml(item.artist) + '</span>' +
        '</span>';
      list2.appendChild(div);
    });
  });
}

window._addToCollabQueue = function(track) {
  if (!isActive || !roomCode) return;
  push(ref(db, 'sessions/' + roomCode + '/collabQueue'), {
    trackId : String(track.trackId || ''),
    title   : String(track.title   || ''),
    artist  : String(track.artist  || ''),
    addedBy : sessionRole || 'host',
    addedAt : Date.now(),
  }).catch(e => console.warn('[Session] collabQueue push failed:', e.message));
};

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 5 — SESSION PLAY LOGGING + HISTORY MODAL
// ══════════════════════════════════════════════════════════════════════════════

function logTrackPlay(track) {
  if (!isActive || !track) return;
  sessionPlayLog.push({
    title : track.title  || 'Unknown',
    artist: track.artist || '',
    at    : Date.now(),
  });
}

// Called from vault.js playAtIndex when session is active (host side)
window.logSessionTrack = function(title, artist) {
  logTrackPlay({ title, artist });
};

function showSessionEndModal(playLog, startTime) {
  const modal = document.getElementById('session-end-modal');
  if (!modal) return;

  const durationMs  = startTime ? Math.max(0, Date.now() - startTime) : 0;
  const totalMin    = Math.floor(durationMs / 60000);
  const dEl = modal.querySelector('#sem-duration');
  const tEl = modal.querySelector('#sem-tracklist');
  if (dEl) dEl.textContent = totalMin + ' min';
  if (tEl) {
    tEl.innerHTML = playLog.map(p =>
      '<li>' + escHtml(p.artist ? p.artist + ' – ' + p.title : p.title) + '</li>'
    ).join('');
  }
  modal.classList.add('open');

  const saveBtn  = modal.querySelector('#sem-save-btn');
  if (saveBtn) {
    saveBtn.onclick = function() {
      let sessions = [];
      try { sessions = JSON.parse(localStorage.getItem('vault_sessions') || '[]'); } catch(e) {}
      sessions.unshift({
        date    : new Date().toISOString(),
        duration: totalMin,
        tracks  : playLog.map(p => ({ title: p.title, artist: p.artist })),
      });
      if (sessions.length > 20) sessions.splice(20);
      try { localStorage.setItem('vault_sessions', JSON.stringify(sessions)); } catch(e) {}
      toast('SESSION SAVED ✓', 'success');
      modal.classList.remove('open');
    };
  }
  const closeBtn = modal.querySelector('#sem-close-btn');
  if (closeBtn) closeBtn.onclick = () => modal.classList.remove('open');
}
