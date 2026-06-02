// swipe.js — Touch gesture support for The Vault
// Only runs on touch/coarse-pointer devices (skips desktop mouse users).

(function () {
  'use strict';

  // ── Guard: touch devices only ──────────────────────────────────────────────
  if (!window.matchMedia('(pointer: coarse)').matches) return;

  const SWIPE_MIN      = 50;   // px — minimum travel before a swipe triggers
  const SWIPE_MAX_MS   = 400;  // ms — maximum duration for an intentional swipe
  const CARD_THRESHOLD = 80;   // px — card swipe distance before action fires
  const CARD_CLAMP     = 130;  // px — max translate on card during drag

  // ── Helpers ────────────────────────────────────────────────────────────────

  function isModalOpen() {
    return !!(
      document.querySelector('.modal-overlay.open') ||
      document.getElementById('eq-panel')?.classList.contains('open')
    );
  }

  function reducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function springBack(el, duration) {
    duration = duration || 280;
    el.style.transition = `transform ${duration}ms cubic-bezier(0.34,1.56,0.64,1)`;
    el.style.transform  = '';
    setTimeout(() => { el.style.transition = ''; }, duration);
  }

  // ── Player Bar ─────────────────────────────────────────────────────────────

  function initPlayerBar() {
    const bar = document.getElementById('player-bar');
    if (!bar) return;

    let sx, sy, st, active = false;

    bar.addEventListener('pointerdown', e => {
      // Ignore touches originating on interactive controls
      if (e.target.closest('button, input, canvas, #progress-bar, #waveform-canvas, #session-panel')) return;
      sx = e.clientX; sy = e.clientY; st = Date.now(); active = true;
    }, { passive: true });

    bar.addEventListener('pointermove', e => {
      if (!active) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8 && !reducedMotion()) {
        bar.style.transform = `translateX(${Math.sign(dx) * Math.min(Math.abs(dx), 40)}px)`;
      }
    }, { passive: true });

    bar.addEventListener('pointerup', e => {
      if (!active) return;
      active = false;

      // Spring back
      bar.style.transition = 'transform 280ms cubic-bezier(0.34,1.56,0.64,1)';
      bar.style.transform  = '';
      setTimeout(() => { bar.style.transition = ''; }, 280);

      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      const dt = Date.now() - st;
      if (dt > SWIPE_MAX_MS) return;
      if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) return;

      if (Math.abs(dx) > Math.abs(dy)) {
        if (dx < -SWIPE_MIN) {
          _animateTitle('left');
          document.getElementById('next-btn')?.click();
        } else if (dx > SWIPE_MIN) {
          _animateTitle('right');
          document.getElementById('prev-btn')?.click();
        }
      } else {
        if (dy < -SWIPE_MIN) {
          if (typeof openQueuePanel === 'function') openQueuePanel();
        } else if (dy > SWIPE_MIN) {
          if (typeof closeLyricsPanel === 'function') closeLyricsPanel();
        }
      }
    }, { passive: true });

    bar.addEventListener('pointercancel', () => {
      active = false;
      springBack(bar);
    }, { passive: true });
  }

  function _animateTitle(dir) {
    if (reducedMotion()) return;
    const el = document.getElementById('player-title');
    if (!el) return;
    const out = dir === 'left' ? -55 : 55;
    el.style.transition = 'transform 180ms ease-out, opacity 180ms ease-out';
    el.style.transform  = `translateX(${out}px)`;
    el.style.opacity    = '0';
    setTimeout(() => {
      el.style.transition = 'none';
      el.style.transform  = `translateX(${-out}px)`;
      el.style.opacity    = '0';
      void el.offsetHeight; // force reflow
      el.style.transition = 'transform 180ms ease-out, opacity 180ms ease-out';
      el.style.transform  = '';
      el.style.opacity    = '';
    }, 180);
  }

  // ── Track Card Gestures ────────────────────────────────────────────────────

  function initCardGestures() {
    if (!document.getElementById('tracks-grid')) return;

    let state = null; // { card, sx, sy, st, swiping, indicator, longTimer }

    document.addEventListener('pointerdown', e => {
      if (isModalOpen()) return;
      const card = e.target.closest('#tracks-grid .track-card');
      if (!card) return;
      if (e.target.closest('button, a, input')) return;

      state = {
        card,
        sx: e.clientX,
        sy: e.clientY,
        st: Date.now(),
        swiping: false,
        indicator: null,
        longTimer: setTimeout(() => {
          if (state && !state.swiping) {
            // Long press → open track options (admin edit button if present)
            const editBtn = card.querySelector('[onclick*="openEditModal"]');
            if (editBtn) editBtn.click();
            state = null;
          }
        }, 600),
      };
    }, { passive: true });

    document.addEventListener('pointermove', e => {
      if (!state) return;
      const dx = e.clientX - state.sx;
      const dy = e.clientY - state.sy;

      if (!state.swiping) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dy) >= Math.abs(dx)) {
          // Vertical scroll intent — cancel card gesture
          clearTimeout(state.longTimer);
          state = null;
          return;
        }
        state.swiping = true;
        clearTimeout(state.longTimer);
      }

      const clamped = Math.sign(dx) * Math.min(Math.abs(dx), CARD_CLAMP);
      if (!reducedMotion()) state.card.style.transform = `translateX(${clamped}px)`;

      _updateCardIndicator(state, dx);
    }, { passive: true });

    document.addEventListener('pointerup', e => {
      if (!state) return;
      const s  = state;
      state    = null;
      clearTimeout(s.longTimer);
      _removeCardIndicator(s);

      if (!s.swiping) return;

      const dx = e.clientX - s.sx;
      const dt = Date.now() - s.st;
      const id = parseInt(s.card.dataset.id);

      if (dt <= SWIPE_MAX_MS && Math.abs(dx) >= CARD_THRESHOLD) {
        if (dx > 0) {
          _flyCard(s.card, 'right', () => {
            if (typeof toggleTrackLike === 'function') toggleTrackLike(id);
          });
        } else {
          _flyCard(s.card, 'left', () => {
            if (typeof addToQueue === 'function') addToQueue(id);
          });
        }
      } else {
        springBack(s.card);
      }
    }, { passive: true });

    document.addEventListener('pointercancel', () => {
      if (!state) return;
      clearTimeout(state.longTimer);
      _removeCardIndicator(state);
      springBack(state.card);
      state = null;
    }, { passive: true });
  }

  function _updateCardIndicator(state, dx) {
    if (!state.indicator) {
      const ind = document.createElement('div');
      ind.className = 'swipe-card-indicator';
      state.card.parentNode.insertBefore(ind, state.card);
      state.indicator = ind;
    }
    const ind = state.indicator;
    const progress = Math.min(1, Math.abs(dx) / CARD_THRESHOLD);
    ind.style.opacity = progress.toFixed(2);

    if (dx > 0) {
      ind.textContent  = '♥';
      ind.style.background = '#e51c23';
      ind.style.left  = '0';
      ind.style.right = 'auto';
      ind.style.justifyContent = 'flex-start';
      ind.style.paddingLeft    = '24px';
    } else {
      ind.textContent  = '+';
      ind.style.background = 'var(--artist-primary, #ff3c3c)';
      ind.style.right = '0';
      ind.style.left  = 'auto';
      ind.style.justifyContent = 'flex-end';
      ind.style.paddingRight   = '24px';
    }
  }

  function _removeCardIndicator(state) {
    if (state.indicator) { state.indicator.remove(); state.indicator = null; }
    state.card.style.transform  = '';
    state.card.style.transition = '';
  }

  function _flyCard(card, dir, callback) {
    if (reducedMotion()) { callback(); return; }
    const dist = dir === 'right' ? window.innerWidth : -window.innerWidth;
    card.style.transition = 'transform 280ms ease-out, opacity 280ms ease-out';
    card.style.transform  = `translateX(${dist}px)`;
    card.style.opacity    = '0';
    setTimeout(() => {
      callback();
      // Card will be re-rendered by vault.js on state change — reset style in case it isn't
      card.style.transition = 'none';
      card.style.transform  = '';
      card.style.opacity    = '';
    }, 280);
  }

  // ── Lyrics Panel — swipe down to close ────────────────────────────────────

  function initLyricsPanel() {
    const panel = document.getElementById('lyrics-panel');
    if (!panel) return;

    // Only detect swipe on the header, not inside the scrollable lyrics body
    const header = panel.querySelector('.lyrics-header, .panel-header') || panel;
    let sy, st, active = false;

    header.addEventListener('pointerdown', e => {
      sy = e.clientY; st = Date.now(); active = true;
    }, { passive: true });
    header.addEventListener('pointerup', e => {
      if (!active) return;
      active = false;
      const dy = e.clientY - sy;
      const dt = Date.now() - st;
      if (dy > SWIPE_MIN && dt <= SWIPE_MAX_MS && typeof closeLyricsPanel === 'function') {
        closeLyricsPanel();
      }
    }, { passive: true });
    header.addEventListener('pointercancel', () => { active = false; }, { passive: true });
  }

  // ── Queue Panel — swipe down to close ─────────────────────────────────────

  function initQueuePanel() {
    const panel = document.getElementById('queue-panel');
    if (!panel) return;

    const header = panel.querySelector('.panel-header, .queue-header') || panel;
    let sy, st, active = false;

    header.addEventListener('pointerdown', e => {
      if (e.target.closest('.queue-item, button')) return;
      sy = e.clientY; st = Date.now(); active = true;
    }, { passive: true });
    header.addEventListener('pointerup', e => {
      if (!active) return;
      active = false;
      const dy = e.clientY - sy;
      const dt = Date.now() - st;
      if (dy > SWIPE_MIN && dt <= SWIPE_MAX_MS && typeof closeQueuePanel === 'function') {
        closeQueuePanel();
      }
    }, { passive: true });
    header.addEventListener('pointercancel', () => { active = false; }, { passive: true });
  }

  // ── Boot ───────────────────────────────────────────────────────────────────

  function init() {
    initPlayerBar();
    initCardGestures();
    initLyricsPanel();
    initQueuePanel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
