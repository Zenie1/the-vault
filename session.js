// session.js — Real-time listening session for The Vault
// ─────────────────────────────────────────────────────────────────────────────
// Uses Firebase Realtime Database + Anonymous Auth.
// Does NOT modify vault.js — hooks into the DOM audio element and vault.js
// globals (tracks, currentTrackIdx, getPlaylist, playAtIndex, showToast).
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
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ── Module state ────────────────────────────────────────────────────────────
  let db            = null;
  let fbAuth        = null;
  let sessionRef    = null;
  let stateRef      = null;
  let heartbeatTimer= null;
  let titleObserver = null;
  let audioListeners= null;
  let guestStateOff = null;   // unsubscribe handle for state listener

  let sessionRole   = null;   // 'host' | 'guest' | null
  let roomCode      = null;
  let myUid         = null;
  let isActive      = false;
  let panelOpen     = false;

  let lastApplied   = null;   // last trackId applied as guest
  let syncCooldown  = false;  // prevents rapid re-syncs

  const SESSION_VERSION = 1;
  const SESSION_TTL_MS  = 86400000; // 24 hours

  // ── Bootstrap: wait for vault.js to settle ──────────────────────────────────
  window.addEventListener('DOMContentLoaded', () => setTimeout(boot, 650));

  function boot() {
    if (typeof firebase === 'undefined') {
      console.warn('[Session] Firebase SDK not loaded.');
      return;
    }
    if (
      typeof FIREBASE_CONFIG === 'undefined' ||
      !FIREBASE_CONFIG.databaseURL ||
      FIREBASE_CONFIG.databaseURL.includes('YOUR_PROJECT')
    ) {
      console.warn('[Session] firebase-config.js contains placeholder values — session disabled.');
      setSessionBtnDisabled('Edit firebase-config.js to enable live sessions');
      return;
    }

    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      db     = firebase.database();
      fbAuth = firebase.auth();
    } catch (e) {
      console.error('[Session] Firebase init error:', e);
      return;
    }

    // Sign in anonymously — gives us a stable UID for security rule checks.
    fbAuth.signInAnonymously()
      .then(result => { myUid = result.user.uid; wireUI(); })
      .catch(err => {
        console.warn('[Session] Anonymous auth failed:', err.message, '— using local ID.');
        myUid = 'local-' + Math.random().toString(36).slice(2, 11);
        wireUI();
      });
  }

  // ── Wire up UI event listeners ───────────────────────────────────────────────
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
        // Auto-uppercase after keypress
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

  // ── Panel helpers ────────────────────────────────────────────────────────────
  function togglePanel() {
    panelOpen ? closePanel() : openPanel();
  }
  function openPanel() {
    const el = document.getElementById('session-panel');
    if (el) { el.classList.add('visible'); panelOpen = true; }
  }
  function closePanel() {
    const el = document.getElementById('session-panel');
    if (el) { el.classList.remove('visible'); panelOpen = false; }
  }

  // Show one of the three sub-views inside the panel
  function showView(id) {
    ['sv-inactive', 'sv-host', 'sv-guest'].forEach(v => {
      const el = document.getElementById(v);
      if (el) el.style.display = (v === id) ? '' : 'none';
    });
  }

  function setBtnActive(on) {
    const btn   = document.getElementById('session-btn');
    const badge = document.getElementById('session-live-badge');
    if (!btn) return;
    btn.classList.toggle('session-active', on);
    if (badge) badge.classList.toggle('visible', on);
  }

  function setSessionBtnDisabled(tooltip) {
    const btn = document.getElementById('session-btn');
    if (!btn) return;
    btn.disabled = true;
    btn.title    = tooltip;
    btn.style.opacity = '0.35';
  }

  // ── Room code ────────────────────────────────────────────────────────────────
  function genCode() {
    return 'VAULT-' + (Math.floor(Math.random() * 9000) + 1000);
  }

  function copyCode() {
    if (!roomCode) return;
    navigator.clipboard.writeText(roomCode)
      .then(()  => toast('CODE COPIED ✓', 'success'))
      .catch(()  => toast(roomCode, ''));
  }

  // ── Host: start session ──────────────────────────────────────────────────────
  async function startSession() {
    if (!db || !myUid) { toast('FIREBASE NOT READY', 'error'); return; }

    roomCode   = genCode();
    sessionRef = db.ref('sessions/' + roomCode);
    stateRef   = sessionRef.child('state');

    try {
      // Step 1 — write metadata first (hostId must exist before state validate runs)
      await sessionRef.set({
        hostId   : myUid,
        guestId  : null,
        version  : SESSION_VERSION,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
      });

      // Step 2 — write initial playback state
      await stateRef.set(snapshot());

      // Auto-remove when host disconnects
      sessionRef.onDisconnect().remove();

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

    // Watch for guest joining
    sessionRef.child('guestId').on('value', snap => {
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

  // ── Host: snapshot + push ────────────────────────────────────────────────────
  function snapshot() {
    const audio = getAudio();
    return {
      trackId    : currentTrackId(),
      isPlaying  : !!(audio && !audio.paused),
      currentTime: (audio?.currentTime) || 0,
      timestamp  : Date.now(),
    };
  }

  function pushState() {
    if (!db || sessionRole !== 'host' || !stateRef || !isActive) return;
    stateRef.set(snapshot()).catch(e =>
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

    // Watch track title changes (vault.js sets this when track changes)
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
    if (!db || !myUid) { toast('FIREBASE NOT READY', 'error'); return; }

    if (!/^VAULT-\d{4}$/.test(code)) {
      toast('INVALID CODE — FORMAT: VAULT-0000', 'error'); return;
    }

    let data;
    try {
      const snap = await db.ref('sessions/' + code).once('value');
      if (!snap.exists()) { toast('SESSION NOT FOUND', 'error'); return; }
      data = snap.val();
    } catch (e) {
      toast('COULD NOT REACH SERVER', 'error'); return;
    }

    if (data.guestId && data.guestId !== myUid) {
      toast('SESSION IS FULL', 'error'); return;
    }
    if (data.createdAt && Date.now() - data.createdAt > SESSION_TTL_MS) {
      toast('SESSION EXPIRED', 'error'); return;
    }

    roomCode   = code;
    sessionRef = db.ref('sessions/' + roomCode);
    stateRef   = sessionRef.child('state');
    sessionRole = 'guest';

    try {
      await sessionRef.child('guestId').set(myUid);
      sessionRef.child('guestId').onDisconnect().set(null);
    } catch (e) {
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
    guestStateOff = stateRef.on('value', onGuestState);

    // Detect session end (host removed)
    sessionRef.child('hostId').on('value', snap => {
      if (snap.val() === null && isActive) {
        handleEndedByHost();
      }
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
      applyTrackChange(parseInt(s.trackId, 10), targetTime, s.isPlaying);
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
    const idx      = playlist.findIndex(x => x.id === trackId);
    if (idx === -1) return; // track not in local vault

    const audio = getAudio();

    // Already on this track — just seek
    if (typeof currentTrackIdx !== 'undefined' && currentTrackIdx === idx && audio.src) {
      audio.currentTime = Math.max(0, targetTime);
      syncPlayPause(audio, shouldPlay);
      return;
    }

    // Load via vault.js global (does not break guest control lock — we call
    // playAtIndex directly rather than simulating a button click)
    if (typeof playAtIndex === 'function') {
      playAtIndex(idx);
    }

    // Seek after the audio element has enough data
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
        // Autoplay blocked — nudge the user
        if (err.name === 'NotAllowedError') toast('TAP ▶ TO SYNC AUDIO', '');
      });
    } else if (!shouldPlay && !audio.paused) {
      audio.pause();
    }
  }

  // ── Guest: lock / unlock controls ────────────────────────────────────────────
  function lockControls() {
    document.body.classList.add('session-guest');
  }
  function unlockControls() {
    document.body.classList.remove('session-guest');
  }

  // ── End / leave session ───────────────────────────────────────────────────────
  async function endSession() {
    if (!isActive) return;

    try {
      if (sessionRole === 'host') {
        // Removing the node fires all onDisconnect listeners — guests get the signal
        if (sessionRef) await sessionRef.remove();
      } else {
        if (stateRef && guestStateOff) { stateRef.off('value', guestStateOff); }
        if (sessionRef) {
          sessionRef.off();
          await sessionRef.child('guestId').set(null);
        }
        unlockControls();
      }
    } catch (e) { /* ignore cleanup errors */ }

    reset();
    showView('sv-inactive');
    setBtnActive(false);
    closePanel();
    toast('SESSION ENDED', '');
    window.removeEventListener('beforeunload', onUnload);
  }

  function handleEndedByHost() {
    if (stateRef && guestStateOff) stateRef.off('value', guestStateOff);
    if (sessionRef) sessionRef.off();
    unlockControls();
    reset();
    showView('sv-inactive');
    setBtnActive(false);
    toast('HOST ENDED THE SESSION', '');
    window.removeEventListener('beforeunload', onUnload);
  }

  function onUnload() {
    if (!sessionRef) return;
    if (sessionRole === 'host')  sessionRef.remove();
    if (sessionRole === 'guest') sessionRef.child('guestId').set(null);
  }

  function reset() {
    isActive    = false;
    sessionRole = null;
    roomCode    = null;
    lastApplied = null;
    syncCooldown = false;
    guestStateOff = null;
    stopHeartbeat();
    detachHostListeners();
    if (sessionRef) { sessionRef.off(); sessionRef = null; }
    stateRef = null;
  }

  // ── Vault.js interop helpers ─────────────────────────────────────────────────
  function getAudio() {
    return document.getElementById('audio-player');
  }

  function getPlaylist_() {
    try {
      if (typeof getPlaylist === 'function') return getPlaylist();
      if (typeof tracks !== 'undefined')     return tracks;
    } catch { /* ignore */ }
    return [];
  }

  function currentTrackId() {
    try {
      const pl  = getPlaylist_();
      const idx = (typeof currentTrackIdx !== 'undefined') ? currentTrackIdx : -1;
      const t   = pl[idx];
      return t ? String(t.id) : '';
    } catch { return ''; }
  }

  // ── DOM shortcuts ────────────────────────────────────────────────────────────
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

})(); // end IIFE — no globals polluted
