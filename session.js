// session.js — Real-time listening session for The Vault
// ─────────────────────────────────────────────────────────────────────────────
// ES module — loaded via <script type="module" src="session.js">.
// Uses Firebase v12.13.0 modular SDK; imports db + app from firebase-config.js.
//
// Firebase data layout:
//   sessions/{VAULT-XXXX}/
//     hostId      : string  — anonymous UID of the host
//     guestId     : string | null
//     createdAt   : number  — server timestamp (ms)
//     version     : number
//     state/
//       trackId   : string
//       isPlaying : boolean
//       currentTime : number
//       timestamp : number  — Date.now() when host wrote this
//
// Vault.js interop:
//   • getPlaylist(), playAtIndex(), showToast() — window globals (function decls)
//   • Current track detected via document.querySelector('.track-card.playing')
// ─────────────────────────────────────────────────────────────────────────────

import { db, app } from './firebase-config.js';
import {
  ref, set, get, remove, onValue,
  onDisconnect as rtdbOnDisconnect,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-database.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js';

// ── Module state ──────────────────────────────────────────────────────────────
let sessionRef    = null;   // ref(db, 'sessions/' + roomCode)
let stateRef      = null;   // ref(db, 'sessions/' + roomCode + '/state')
let heartbeatTimer= null;
let titleObserver = null;
let audioListeners= null;
let guestStateOff = null;   // unsubscribe fn — guest listening to host state
let guestIdOff    = null;   // unsubscribe fn — host watching for guest join
let hostIdOff     = null;   // unsubscribe fn — guest watching for host removal

let sessionRole   = null;   // 'host' | 'guest' | null
let roomCode      = null;
let myUid         = null;
let isActive      = false;
let panelOpen     = false;

let lastApplied   = null;   // last trackId applied as guest
let syncCooldown  = false;  // prevents rapid re-syncs

const SESSION_VERSION = 1;
const SESSION_TTL_MS  = 86400000; // 24 hours

// ── Bootstrap: sign in then wire UI ──────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => setTimeout(boot, 650));

async function boot() {
  try {
    const auth   = getAuth(app);
    const result = await signInAnonymously(auth);
    myUid = result.user.uid;
  } catch (err) {
    console.warn('[Session] Anonymous auth failed:', err.message, '— using local ID.');
    myUid = 'local-' + Math.random().toString(36).slice(2, 11);
  }
  wireUI();
}

// ── Wire up UI event listeners ────────────────────────────────────────────────
function wireUI() {
  on('session-btn',          'click', togglePanel);
  on('session-start-btn',    'click', startSession);
  on('session-join-btn',     'click', handleJoinClick);
  on('session-end-btn',      'click', () => endSession());
  on('session-leave-btn',    'click', () => endSession());
  on('session-code-copy-btn','click', copyCode);

  const inp = document.getElementById('session-join-input');
  if (inp) {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') handleJoinClick();
      requestAnimationFrame(() => { inp.value = inp.value.toUpperCase(); });
    });
  }

  // Close panel when clicking outside
  document.addEventListener('click', e => {
    const panel = document.getElementById('session-panel');
    const btn   = document.getElementById('session-btn');
    if (panel && panelOpen && !panel.contains(e.target) && e.target !== btn) {
      closePanel();
    }
  }, true);
}

// ── Panel helpers ─────────────────────────────────────────────────────────────
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

// ── Room code ─────────────────────────────────────────────────────────────────
function genCode() {
  return 'VAULT-' + (Math.floor(Math.random() * 9000) + 1000);
}

function copyCode() {
  if (!roomCode) return;
  navigator.clipboard.writeText(roomCode)
    .then(()  => toast('CODE COPIED ✓', 'success'))
    .catch(()  => toast(roomCode, ''));
}

// ── Host: start session ───────────────────────────────────────────────────────
async function startSession() {
  if (!myUid) { toast('FIREBASE NOT READY', 'error'); return; }

  roomCode   = genCode();
  sessionRef = ref(db, 'sessions/' + roomCode);
  stateRef   = ref(db, 'sessions/' + roomCode + '/state');

  try {
    // Step 1 — write metadata first (hostId must exist before state validate runs)
    await set(sessionRef, {
      hostId   : myUid,
      guestId  : null,
      version  : SESSION_VERSION,
      createdAt: serverTimestamp(),
    });

    // Step 2 — write initial playback state
    await set(stateRef, snapshot());

    // Auto-remove the whole session when the host tab closes
    rtdbOnDisconnect(sessionRef).remove();

  } catch (e) {
    console.error('[Session] startSession:', e);
    toast('COULD NOT START SESSION', 'error');
    reset(); return;
  }

  isActive    = true;
  sessionRole = 'host';
  setBtnActive(true);
  setEl('session-room-code', roomCode);
  setEl('session-guest-status', 'WAITING FOR GUEST…');
  document.getElementById('session-guest-status')?.classList.remove('connected');
  openPanel();
  showView('sv-host');

  navigator.clipboard.writeText(roomCode).catch(() => {});
  toast('SESSION STARTED — CODE: ' + roomCode, 'success');

  // Watch for a guest joining
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
  window.addEventListener('beforeunload', onUnload);
}

// ── Host: snapshot + push state ───────────────────────────────────────────────
function snapshot() {
  const audio = getAudio();
  return {
    trackId    : currentTrackId(),
    isPlaying  : !!(audio && !audio.paused),
    currentTime: audio?.currentTime ?? 0,
    timestamp  : Date.now(),
  };
}

function pushState() {
  if (!myUid || sessionRole !== 'host' || !stateRef || !isActive) return;
  set(stateRef, snapshot()).catch(e =>
    console.warn('[Session] pushState failed:', e.message)
  );
}

function attachHostListeners() {
  const audio = getAudio();
  if (!audio) return;

  const onPlay      = () => pushState();
  const onPause     = () => pushState();
  const onSeeked    = () => pushState();
  const onLoadStart = () => requestAnimationFrame(pushState); // new track src

  audio.addEventListener('play',      onPlay);
  audio.addEventListener('pause',     onPause);
  audio.addEventListener('seeked',    onSeeked);
  audio.addEventListener('loadstart', onLoadStart);
  audioListeners = { audio, onPlay, onPause, onSeeked, onLoadStart };

  // Watch for track title changes (vault.js sets #player-title on track change)
  const titleEl = document.getElementById('player-title');
  if (titleEl) {
    titleObserver = new MutationObserver(() => setTimeout(pushState, 160));
    titleObserver.observe(titleEl, { childList: true, subtree: true, characterData: true });
  }
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
}

function startHeartbeat() {
  heartbeatTimer = setInterval(pushState, 5000);
}
function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

// ── Guest: join session ───────────────────────────────────────────────────────
async function handleJoinClick() {
  const inp  = document.getElementById('session-join-input');
  const code = (inp?.value || '').trim().toUpperCase();
  if (!code) { toast('ENTER A ROOM CODE', 'error'); return; }
  await joinSession(code);
}

async function joinSession(code) {
  if (!myUid) { toast('FIREBASE NOT READY', 'error'); return; }

  if (!/^VAULT-\d{4}$/.test(code)) {
    toast('INVALID CODE — FORMAT: VAULT-0000', 'error'); return;
  }

  let data;
  try {
    const snap = await get(ref(db, 'sessions/' + code));
    if (!snap.exists()) { toast('SESSION NOT FOUND', 'error'); return; }
    data = snap.val();
  } catch {
    toast('COULD NOT REACH SERVER', 'error'); return;
  }

  if (data.guestId && data.guestId !== myUid) {
    toast('SESSION IS FULL', 'error'); return;
  }
  if (data.createdAt && Date.now() - data.createdAt > SESSION_TTL_MS) {
    toast('SESSION EXPIRED', 'error'); return;
  }

  roomCode    = code;
  sessionRef  = ref(db, 'sessions/' + roomCode);
  stateRef    = ref(db, 'sessions/' + roomCode + '/state');
  sessionRole = 'guest';

  try {
    const guestIdRef = ref(db, 'sessions/' + roomCode + '/guestId');
    await set(guestIdRef, myUid);
    rtdbOnDisconnect(guestIdRef).set(null); // clear guestId when tab closes
  } catch {
    toast('COULD NOT JOIN SESSION', 'error');
    reset(); return;
  }

  isActive = true;
  setBtnActive(true);
  lockControls();
  openPanel();
  showView('sv-guest');
  toast('JOINED — LISTENING LIVE 🎵', 'success');

  // React to host state changes
  guestStateOff = onValue(stateRef, onGuestState);

  // Detect session end (host removed the document)
  const hostIdRef = ref(db, 'sessions/' + roomCode + '/hostId');
  hostIdOff = onValue(hostIdRef, snap => {
    if (snap.val() === null && isActive) handleEndedByHost();
  });

  window.addEventListener('beforeunload', onUnload);
}

// ── Guest: apply host state ───────────────────────────────────────────────────
function onGuestState(snap) {
  if (!snap.exists() || sessionRole !== 'guest') return;
  const s = snap.val();
  if (!s) return;

  const audio = getAudio();
  if (!audio) return;

  // Latency-compensated playback position
  const latency    = Math.max(0, (Date.now() - s.timestamp) / 1000);
  const targetTime = s.currentTime + (s.isPlaying ? latency : 0);

  // ── Track change ──
  if (s.trackId && String(s.trackId) !== String(lastApplied)) {
    lastApplied = String(s.trackId);
    applyTrackChange(s.trackId, targetTime, s.isPlaying);
    return;
  }

  // ── Silent drift correction (±2 second tolerance) ──
  if (!syncCooldown && Math.abs(audio.currentTime - targetTime) > 2) {
    syncCooldown = true;
    audio.currentTime = Math.max(0, targetTime);
    setTimeout(() => { syncCooldown = false; }, 2500);
  }

  // ── Play / pause sync ──
  syncPlayPause(audio, s.isPlaying);
}

function applyTrackChange(trackId, targetTime, shouldPlay) {
  const playlist = getPlaylist_();
  const idx      = playlist.findIndex(x => String(x.id) === String(trackId));
  if (idx === -1) return; // track not in local vault

  const audio = getAudio();

  // Already on this track — just seek
  const playingCard = document.querySelector('.track-card.playing');
  const currentId   = playingCard?.dataset?.id;
  if (String(currentId) === String(trackId) && audio?.src) {
    audio.currentTime = Math.max(0, targetTime);
    syncPlayPause(audio, shouldPlay);
    return;
  }

  // Load via vault.js global (function declarations are window-accessible)
  if (typeof playAtIndex === 'function') playAtIndex(idx);

  // Seek after the audio element has buffered enough
  const seekAfterLoad = () => {
    audio.currentTime = Math.max(0, targetTime);
    syncPlayPause(audio, shouldPlay);
  };
  if (audio.readyState >= 3) {
    seekAfterLoad();
  } else {
    audio.addEventListener('canplay', seekAfterLoad, { once: true });
  }
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

// ── Guest: lock / unlock controls ────────────────────────────────────────────
function lockControls()   { document.body.classList.add('session-guest'); }
function unlockControls() { document.body.classList.remove('session-guest'); }

// ── End / leave session ───────────────────────────────────────────────────────
async function endSession() {
  if (!isActive) return;

  try {
    if (sessionRole === 'host') {
      // Deleting the node signals all guests via hostId → null
      if (sessionRef) await remove(sessionRef);
    } else {
      if (guestStateOff) { guestStateOff(); guestStateOff = null; }
      if (hostIdOff)     { hostIdOff();     hostIdOff     = null; }
      const guestIdRef = ref(db, 'sessions/' + roomCode + '/guestId');
      await set(guestIdRef, null);
      unlockControls();
    }
  } catch { /* ignore cleanup errors */ }

  reset();
  showView('sv-inactive');
  setBtnActive(false);
  closePanel();
  toast('SESSION ENDED', '');
  window.removeEventListener('beforeunload', onUnload);
}

function handleEndedByHost() {
  if (guestStateOff) { guestStateOff(); guestStateOff = null; }
  if (hostIdOff)     { hostIdOff();     hostIdOff     = null; }
  unlockControls();
  reset();
  showView('sv-inactive');
  setBtnActive(false);
  toast('HOST ENDED THE SESSION', '');
  window.removeEventListener('beforeunload', onUnload);
}

function onUnload() {
  if (sessionRole === 'host' && sessionRef) {
    remove(sessionRef);
  }
  if (sessionRole === 'guest' && roomCode) {
    const guestIdRef = ref(db, 'sessions/' + roomCode + '/guestId');
    set(guestIdRef, null);
  }
}

function reset() {
  isActive     = false;
  sessionRole  = null;
  roomCode     = null;
  lastApplied  = null;
  syncCooldown = false;
  stopHeartbeat();
  detachHostListeners();
  if (guestIdOff)    { guestIdOff();    guestIdOff    = null; }
  if (guestStateOff) { guestStateOff(); guestStateOff = null; }
  if (hostIdOff)     { hostIdOff();     hostIdOff     = null; }
  sessionRef = null;
  stateRef   = null;
}

// ── Vault.js interop helpers ──────────────────────────────────────────────────
function getAudio() {
  return document.getElementById('audio-player');
}

function getPlaylist_() {
  try {
    if (typeof getPlaylist === 'function') return getPlaylist();
  } catch { /* ignore */ }
  return [];
}

function currentTrackId() {
  // Primary: read from the playing card in the DOM (reliable from ES modules)
  const playingCard = document.querySelector('.track-card.playing');
  if (playingCard?.dataset?.id) return String(playingCard.dataset.id);
  // Fallback: try vault.js globals (works only if they're declared as `var`/function)
  try {
    const pl = getPlaylist_();
    if (pl.length && typeof currentTrackIdx !== 'undefined') {
      const t = pl[currentTrackIdx];
      return t ? String(t.id) : '';
    }
  } catch { /* ignore */ }
  return '';
}

// ── DOM shortcuts ─────────────────────────────────────────────────────────────
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
