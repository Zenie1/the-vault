// swipe.js — Touch gesture support for The Vault
// Touch-only guard: exits immediately on non-coarse-pointer devices.

(function () {
  'use strict';

  if (!window.matchMedia('(pointer: coarse)').matches) return;

  // ── Constants ────────────────────────────────────────────────────────────────
  const SWIPE_MIN      = 50;   // px — minimum distance to register a swipe
  const SWIPE_MAX_MS   = 400;  // ms — maximum duration for an intentional swipe
  const CARD_THRESHOLD = 80;   // px — card must travel this far to trigger action
  const CARD_CLAMP     = 130;  // px — maximum card translation during drag
  const TITLE_CLAMP    = 60;   // px — maximum player-info translation during drag
  const ANIM_MS        = 220;  // ms — slide animation duration
  const LONG_PRESS_MS  = 500;  // ms — long-press delay for track options

  // ── Shared utilities ─────────────────────────────────────────────────────────

  function isModalOpen() {
    return !!(
      document.querySelector('.modal-overlay.open') ||
      document.getElementById('eq-panel')?.classList.contains('open')
    );
  }

  function rmo() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // Remove a set of CSS properties (kebab-case) from an element's inline style
  function clearCSS(el) {
    for (var i = 1; i < arguments.length; i++) {
      el.style.removeProperty(arguments[i]);
    }
  }

  // ── Zone 1 — Player bar ──────────────────────────────────────────────────────
  //
  // Swipe left  → next track
  // Swipe right → previous track
  // Swipe up    → open queue panel
  //
  // Visual feedback:
  //   • title + artist text follow the finger (max ±TITLE_CLAMP px)
  //   • a directional hint ("⟩⟩", "⟨⟨", "≡ QUEUE") fades in
  //   • on confirm: title slides out, vault.js updates text, title slides in

  function initPlayerBar() {
    const bar      = document.getElementById('player-bar');
    const titleEl  = document.getElementById('player-title');
    const artistEl = document.getElementById('player-artist');
    if (!bar || !titleEl || !artistEl) return;

    // ── Hint overlay ──────────────────────────────────────────────────────────
    // Appended directly to player-info so it's clipped by its overflow:hidden.
    const info = titleEl.parentElement;
    info.style.position = 'relative';

    const hint = document.createElement('div');
    hint.setAttribute('aria-hidden', 'true');
    Object.assign(hint.style, {
      position:      'absolute',
      inset:         '0',
      display:       'flex',
      alignItems:    'center',
      pointerEvents: 'none',
      opacity:       '0',
      fontFamily:    "var(--font-mono, 'IBM Plex Mono', monospace)",
      fontSize:      '11px',
      letterSpacing: '0.12em',
      fontWeight:    '700',
      color:         'var(--artist-primary, #ff3c3c)',
      transition:    'opacity 0.12s ease',
      userSelect:    'none',
    });
    info.appendChild(hint);

    // ── State ─────────────────────────────────────────────────────────────────
    var sx, sy, st, active = false, locked = false;

    function resetInfo(instant) {
      if (rmo() || instant) {
        clearCSS(titleEl,  'transition', 'transform', 'opacity');
        clearCSS(artistEl, 'transition', 'transform', 'opacity');
      } else {
        var ease = 'transform ' + ANIM_MS + 'ms cubic-bezier(0.34,1.56,0.64,1)';
        titleEl.style.transition  = ease;
        artistEl.style.transition = ease;
        titleEl.style.transform   = '';
        artistEl.style.transform  = '';
        titleEl.style.opacity     = '';
        artistEl.style.opacity    = '';
        setTimeout(function () {
          clearCSS(titleEl,  'transition', 'transform', 'opacity');
          clearCSS(artistEl, 'transition', 'transform', 'opacity');
        }, ANIM_MS);
      }
      hint.style.opacity  = '0';
      hint.textContent    = '';
    }

    // ── Listeners ─────────────────────────────────────────────────────────────
    bar.addEventListener('pointerdown', function (e) {
      if (isModalOpen()) return;
      if (e.target.closest(
        'button, input, canvas, #waveform-canvas, #session-panel, .player-progress'
      )) return;
      sx = e.clientX; sy = e.clientY;
      st = Date.now();
      active = true; locked = false;
    }, { passive: true });

    bar.addEventListener('pointermove', function (e) {
      if (!active || locked) return;

      var dx  = e.clientX - sx;
      var dy  = e.clientY - sy;
      var adx = Math.abs(dx);
      var ady = Math.abs(dy);
      if (adx < 5 && ady < 5) return;

      if (rmo()) return;

      // Translate title + artist
      if (adx >= ady) {
        var tx = Math.sign(dx) * Math.min(adx, TITLE_CLAMP);
        titleEl.style.transition  = 'none';
        artistEl.style.transition = 'none';
        titleEl.style.transform   = 'translateX(' + tx + 'px)';
        artistEl.style.transform  = 'translateX(' + tx + 'px)';

        var prog = Math.min(1, adx / SWIPE_MIN);
        hint.style.opacity = (prog * 0.80).toFixed(2);
        if (dx < 0) {
          hint.textContent          = '⟩⟩';
          hint.style.justifyContent = 'flex-end';
          hint.style.paddingRight   = '6px';
          hint.style.paddingLeft    = '';
        } else {
          hint.textContent          = '⟨⟨';
          hint.style.justifyContent = 'flex-start';
          hint.style.paddingLeft    = '6px';
          hint.style.paddingRight   = '';
        }
      } else if (dy < 0) {
        // Up swipe
        var upProg = Math.min(1, ady / SWIPE_MIN);
        hint.style.opacity        = (upProg * 0.80).toFixed(2);
        hint.textContent          = '≡ QUEUE';
        hint.style.justifyContent = 'center';
        hint.style.paddingLeft    = '';
        hint.style.paddingRight   = '';
      } else {
        hint.style.opacity = '0';
      }
    }, { passive: true });

    bar.addEventListener('pointerup', function (e) {
      if (!active) return;
      active = false;

      var dx   = e.clientX - sx;
      var dy   = e.clientY - sy;
      var dt   = Date.now() - st;
      var adx  = Math.abs(dx);
      var ady  = Math.abs(dy);
      var dist = Math.sqrt(dx * dx + dy * dy);

      hint.style.opacity = '0';

      if (dt > SWIPE_MAX_MS || dist < SWIPE_MIN) {
        resetInfo();
        return;
      }

      if (adx >= ady) {
        // Horizontal — next / prev
        if (adx >= SWIPE_MIN) {
          locked = true;
          slideBarAction(dx < 0 ? 'left' : 'right');
        } else {
          resetInfo();
        }
      } else {
        // Vertical
        if (dy < -SWIPE_MIN) {
          if (typeof openQueuePanel === 'function') openQueuePanel();
        }
        resetInfo();
      }
    }, { passive: true });

    bar.addEventListener('pointercancel', function () {
      active = false;
      resetInfo();
    }, { passive: true });

    // ── Title slide-out → action → slide-in ──────────────────────────────────
    function slideBarAction(dir) {
      if (rmo()) {
        // No animation — just fire
        if (dir === 'left') {
          document.getElementById('next-btn')?.click();
        } else {
          document.getElementById('prev-btn')?.click();
        }
        clearCSS(titleEl,  'transition', 'transform', 'opacity');
        clearCSS(artistEl, 'transition', 'transform', 'opacity');
        locked = false;
        return;
      }

      var outX = dir === 'left' ? -90 : 90;
      var easeOut = 'transform ' + ANIM_MS + 'ms ease-out, opacity ' + ANIM_MS + 'ms ease-out';

      // Slide out
      titleEl.style.transition  = easeOut;
      artistEl.style.transition = easeOut;
      titleEl.style.transform   = 'translateX(' + outX + 'px)';
      artistEl.style.transform  = 'translateX(' + outX + 'px)';
      titleEl.style.opacity     = '0';
      artistEl.style.opacity    = '0';

      setTimeout(function () {
        // Fire action — vault.js updates title synchronously in the same tick
        if (dir === 'left') {
          document.getElementById('next-btn')?.click();
        } else {
          document.getElementById('prev-btn')?.click();
        }

        // Position for slide-in from opposite side
        var inX = -outX;
        titleEl.style.transition  = 'none';
        artistEl.style.transition = 'none';
        titleEl.style.transform   = 'translateX(' + inX + 'px)';
        artistEl.style.transform  = 'translateX(' + inX + 'px)';
        // Force reflow before re-enabling transition
        void titleEl.offsetHeight;

        titleEl.style.transition  = easeOut;
        artistEl.style.transition = easeOut;
        titleEl.style.transform   = '';
        artistEl.style.transform  = '';
        titleEl.style.opacity     = '';
        artistEl.style.opacity    = '';

        setTimeout(function () {
          clearCSS(titleEl,  'transition', 'transform', 'opacity');
          clearCSS(artistEl, 'transition', 'transform', 'opacity');
          locked = false;
        }, ANIM_MS);
      }, ANIM_MS);
    }
  }

  // ── Zone 2 — Track cards ─────────────────────────────────────────────────────
  //
  // Swipe left  → add to queue (reveals "＋ QUEUE" panel behind card)
  // Swipe right → like/unlike  (reveals "♥" panel behind card)
  // Long press  → open admin edit if available
  //
  // The card is wrapped in an overflow:hidden container on first drag move.
  // A reveal panel sits behind the card inside the wrapper.
  // On action: card flies off screen, callback fires, wrapper removed.
  // On cancel: card springs back, wrapper removed.

  function initCardGestures() {
    if (!document.getElementById('tracks-grid')) return;

    var state = null; // single active gesture

    // ── Pointer delegation from document ────────────────────────────────────
    document.addEventListener('pointerdown', function (e) {
      if (isModalOpen()) return;
      var card = e.target.closest('#tracks-grid .track-card');
      if (!card) return;
      if (e.target.closest('button, a, input')) return;

      state = {
        card:      card,
        sx:        e.clientX,
        sy:        e.clientY,
        st:        Date.now(),
        phase:     'pending',  // pending | swiping | done
        wrap:      null,
        reveal:    null,
        longTimer: setTimeout(function () {
          if (state && state.phase === 'pending') {
            var btn = card.querySelector('[onclick*="openEditModal"]');
            if (btn) btn.click();
            cancelGesture();
          }
        }, LONG_PRESS_MS),
      };
    }, { passive: true });

    document.addEventListener('pointermove', function (e) {
      if (!state || state.phase === 'done') return;

      var dx  = e.clientX - state.sx;
      var dy  = e.clientY - state.sy;
      var adx = Math.abs(dx);
      var ady = Math.abs(dy);

      if (state.phase === 'pending') {
        if (adx < 6 && ady < 6) return;
        // Cancel if clearly vertical
        if (ady > adx * 1.4) {
          cancelGesture();
          return;
        }
        // Confirmed horizontal swipe
        clearTimeout(state.longTimer);
        state.phase = 'swiping';
        wrapCard(state);
      }

      // Move card
      var tx = Math.sign(dx) * Math.min(adx, CARD_CLAMP);
      if (!rmo()) {
        state.card.style.transition = 'none';
        state.card.style.transform  = 'translateX(' + tx + 'px)';
      }
      updateReveal(state, dx);
    }, { passive: true });

    document.addEventListener('pointerup', function (e) {
      if (!state || state.phase === 'done') return;

      if (state.phase === 'pending') {
        cancelGesture();
        return;
      }

      var s   = state;
      state   = null;
      clearTimeout(s.longTimer);

      var dx  = e.clientX - s.sx;
      var dt  = Date.now() - s.st;
      var adx = Math.abs(dx);

      if (dt <= SWIPE_MAX_MS && adx >= CARD_THRESHOLD) {
        s.phase = 'done';
        var id  = parseInt(s.card.dataset.id);
        if (dx > 0) {
          flyCard(s, 'right', function () {
            if (typeof toggleTrackLike === 'function') toggleTrackLike(id);
          });
        } else {
          flyCard(s, 'left', function () {
            if (typeof addToQueue === 'function') addToQueue(id);
          });
        }
      } else {
        snapBack(s);
      }
    }, { passive: true });

    document.addEventListener('pointercancel', function () {
      if (state) cancelGesture();
    }, { passive: true });

    // ── Gesture lifecycle helpers ────────────────────────────────────────────

    function cancelGesture() {
      if (!state) return;
      var s = state;
      state = null;
      clearTimeout(s.longTimer);
      if (s.phase === 'swiping') snapBack(s);
      else unwrapCard(s);  // no-op if wrap is null
    }

    function snapBack(s) {
      if (rmo()) {
        unwrapCard(s);
        return;
      }
      s.card.style.transition = 'transform ' + ANIM_MS + 'ms cubic-bezier(0.34,1.56,0.64,1)';
      s.card.style.transform  = '';
      setTimeout(function () {
        clearCSS(s.card, 'transition');
        unwrapCard(s);
      }, ANIM_MS);
    }

    function flyCard(s, dir, callback) {
      if (rmo()) {
        callback();
        unwrapCard(s);
        return;
      }
      // Card needs to fly past the wrap's edge — open overflow first
      if (s.wrap) s.wrap.style.overflow = 'visible';
      var dist = dir === 'right' ? window.innerWidth : -window.innerWidth;
      s.card.style.transition = 'transform 280ms ease-out, opacity 280ms ease-out';
      s.card.style.transform  = 'translateX(' + dist + 'px)';
      s.card.style.opacity    = '0';
      setTimeout(function () {
        callback();
        unwrapCard(s);
      }, 280);
    }

    // ── DOM wrapping ─────────────────────────────────────────────────────────

    function wrapCard(s) {
      var card = s.card;
      var cs   = window.getComputedStyle(card);
      var wrap = document.createElement('div');

      // The wrap takes the card's grid slot; card moves inside it
      wrap.style.cssText =
        'position:relative;' +
        'overflow:hidden;' +
        'border-radius:' + cs.borderRadius + ';' +
        'width:100%;';

      card.parentNode.insertBefore(wrap, card);
      wrap.appendChild(card);

      // Reveal panel — sits behind the card
      var reveal = document.createElement('div');
      reveal.style.cssText =
        'position:absolute;' +
        'inset:0;' +
        'display:flex;' +
        'align-items:center;' +
        'font-family:var(--font-mono,"IBM Plex Mono",monospace);' +
        'font-size:13px;' +
        'letter-spacing:0.1em;' +
        'font-weight:700;' +
        'color:#fff;' +
        'opacity:0;' +
        'z-index:0;' +
        'pointer-events:none;';
      wrap.insertBefore(reveal, card);

      // Ensure card renders above reveal
      card.style.position = 'relative';
      card.style.zIndex   = '1';

      s.wrap   = wrap;
      s.reveal = reveal;
    }

    function unwrapCard(s) {
      if (!s.wrap) return;
      clearCSS(s.card, 'transition', 'transform', 'opacity', 'z-index', 'position');
      s.wrap.parentNode.insertBefore(s.card, s.wrap);
      s.wrap.remove();
      s.wrap = s.reveal = null;
    }

    function updateReveal(s, dx) {
      if (!s.reveal) return;
      var progress = Math.min(1, Math.abs(dx) / CARD_THRESHOLD);
      s.reveal.style.opacity = progress > 0.03 ? (0.2 + progress * 0.8).toFixed(2) : '0';

      if (dx > 0) {
        // Right swipe → like (♥ revealed on left)
        s.reveal.style.background    = '#c62828';
        s.reveal.style.justifyContent = 'flex-start';
        s.reveal.style.paddingLeft   = '22px';
        s.reveal.style.paddingRight  = '';
        s.reveal.textContent = '♥';
      } else {
        // Left swipe → queue (＋ QUEUE revealed on right)
        var col = getComputedStyle(document.documentElement)
          .getPropertyValue('--artist-primary').trim() || '#ff3c3c';
        s.reveal.style.background    = col;
        s.reveal.style.justifyContent = 'flex-end';
        s.reveal.style.paddingRight  = '22px';
        s.reveal.style.paddingLeft   = '';
        s.reveal.textContent = '＋ QUEUE';
      }
    }
  }

  // ── Zone 3 — Lyrics panel: swipe down to close ───────────────────────────────

  function initLyricsPanel() {
    var panel = document.getElementById('lyrics-panel');
    if (!panel) return;
    var header = panel.querySelector('.lyrics-header') || panel;
    attachDownSwipe(header, function () {
      if (typeof closeLyricsPanel === 'function') closeLyricsPanel();
    });
  }

  // ── Zone 4 — Queue panel: swipe down to close ────────────────────────────────

  function initQueuePanel() {
    var panel = document.getElementById('queue-panel');
    if (!panel) return;
    var header = panel.querySelector('.queue-header') || panel;
    attachDownSwipe(header, function () {
      if (typeof closeQueuePanel === 'function') closeQueuePanel();
    }, function (e) {
      return !!e.target.closest('.queue-item, button');
    });
  }

  // Generic "swipe down to dismiss" helper
  function attachDownSwipe(el, callback, ignoreIf) {
    var sy, st, active = false;
    el.addEventListener('pointerdown', function (e) {
      if (ignoreIf && ignoreIf(e)) return;
      sy = e.clientY; st = Date.now(); active = true;
    }, { passive: true });
    el.addEventListener('pointerup', function (e) {
      if (!active) return;
      active = false;
      var dy = e.clientY - sy;
      var dt = Date.now() - st;
      if (dy > SWIPE_MIN && dt <= SWIPE_MAX_MS) callback();
    }, { passive: true });
    el.addEventListener('pointercancel', function () {
      active = false;
    }, { passive: true });
  }

  // ── Boot ─────────────────────────────────────────────────────────────────────

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
