// artist-page.js — Enhanced Artist Page with Last.fm + MusicBrainz integration
// Loaded by index.html AFTER vault.js; overrides window.renderArtistPage + window.apSetDiscView

(function () {
  'use strict';

  const LASTFM_KEY         = '311be84da488e0f3eae8987d051e2cc3';
  const LASTFM_PLACEHOLDER = '2a96cbd8b46e442fc41c2b86b821562f';

  const MAINSTREAM = new Set([
    'playboi carti', 'lil uzi vert', 'lil yachty', 'ken carson',
    'destroy lonely', 'nettspend', 'osamason', 'lucki',
  ]);

  function isMainstream(artist) {
    return MAINSTREAM.has((artist || '').toLowerCase().trim());
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  function fmtNum(n) {
    n = parseInt(n, 10) || 0;
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    return n.toString();
  }

  function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function stripHtml(html) {
    return (html || '')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ').trim();
  }

  function isPlaceholder(url) {
    return !url || url.includes(LASTFM_PLACEHOLDER) || url.includes('_nophoto_');
  }

  function bestImg(images) {
    if (!images || !images.length) return null;
    for (const size of ['extralarge', 'large', 'medium']) {
      const img = images.find(function (i) { return i.size === size; });
      if (img && img['#text'] && !isPlaceholder(img['#text'])) return img['#text'];
    }
    return null;
  }

  function rgba(hex, a) {
    return window.hexToRgba ? window.hexToRgba(hex, a) : 'rgba(255,255,255,' + a + ')';
  }

  // ── API calls ─────────────────────────────────────────────────────────────

  async function lfmFetch(method, artist, limit) {
    try {
      const url = 'https://ws.audioscrobbler.com/2.0/?method=' + method +
        '&artist=' + encodeURIComponent(artist) +
        '&api_key=' + LASTFM_KEY +
        '&format=json&limit=' + (limit || 10);
      const r = await fetch(url);
      return r.ok ? r.json() : null;
    } catch (e) {
      console.warn('[ArtistPage] Last.fm', method, e.message);
      return null;
    }
  }

  async function mbFetch(artist) {
    try {
      const url = 'https://musicbrainz.org/ws/2/artist/?query=' + encodeURIComponent(artist) + '&fmt=json&limit=1';
      const r = await fetch(url, { headers: { 'User-Agent': 'TheVault/1.0 (zenie1.github.io/the-vault)' } });
      if (!r.ok) return null;
      const d = await r.json();
      return (d.artists && d.artists[0]) || null;
    } catch (e) {
      console.warn('[ArtistPage] MusicBrainz', e.message);
      return null;
    }
  }

  async function fetchApiData(artist) {
    const cacheKey = 'ap2_' + artist.toLowerCase().replace(/\s+/g, '_');
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (e) {}

    if (!isMainstream(artist)) {
      const data = { mainstream: false };
      try { sessionStorage.setItem(cacheKey, JSON.stringify(data)); } catch (e) {}
      return data;
    }

    const [info, toptracks, topalbums, similar, mb] = await Promise.all([
      lfmFetch('artist.getinfo',      artist, 1),
      lfmFetch('artist.gettoptracks', artist, 10),
      lfmFetch('artist.gettopalbums', artist, 8),
      lfmFetch('artist.getsimilar',   artist, 5),
      mbFetch(artist),
    ]);

    const data = {
      mainstream: true,
      info:      (info && info.artist)                          || null,
      topTracks: (toptracks && toptracks.toptracks && toptracks.toptracks.track)       || [],
      topAlbums: (topalbums && topalbums.topalbums && topalbums.topalbums.album)       || [],
      similar:   (similar && similar.similarartists && similar.similarartists.artist)  || [],
      mb,
    };
    try { sessionStorage.setItem(cacheKey, JSON.stringify(data)); } catch (e) {}
    return data;
  }

  // ── Vault data helpers ────────────────────────────────────────────────────

  function vaultTracks(artist) {
    return (window.tracks || []).filter(function (t) {
      return t.artist.toLowerCase() === artist.toLowerCase();
    });
  }

  function playCounts() {
    return window.getPlayCounts ? window.getPlayCounts() : {};
  }

  function vaultHistory() {
    return window._getHistory ? window._getHistory() : { plays: [] };
  }

  function sortTracks(artist, mode) {
    const t = vaultTracks(artist);
    const c = playCounts();
    if (mode === 'title') return t.slice().sort(function (a, b) { return a.title.localeCompare(b.title); });
    if (mode === 'added') return t.slice().sort(function (a, b) { return new Date(b.added) - new Date(a.added); });
    return t.slice().sort(function (a, b) { return (c[b.id] || 0) - (c[a.id] || 0); });
  }

  // ── Track list renderers ──────────────────────────────────────────────────

  function renderGrid(tracks, counts) {
    if (!tracks.length) return '<div class="ap-empty">No tracks in vault</div>';
    return tracks.map(function (t) {
      const plays = counts[t.id] || 0;
      return '<div class="ap-disc-item" onclick="closeArtistPage();setTimeout(function(){' +
        'var idx=(window.getPlaylist?window.getPlaylist():[]).findIndex(function(x){return x.id===' + t.id + '});' +
        'if(idx!==-1&&window.playAtIndex)playAtIndex(idx);},150)">' +
        (t.coverArt
          ? '<img class="ap-disc-cover" src="' + esc(t.coverArt) + '" alt="" loading="lazy">'
          : '<div class="ap-disc-cover-placeholder">♪</div>') +
        (plays > 0 ? '<div class="ap-disc-plays-badge">' + plays + '</div>' : '') +
        '<div class="ap-disc-info">' +
          '<div class="ap-disc-title">' + esc(t.title) + '</div>' +
          '<div class="ap-disc-plays">' + (plays > 0 ? plays + ' play' + (plays !== 1 ? 's' : '') : 'unplayed') + '</div>' +
        '</div></div>';
    }).join('');
  }

  function renderList(tracks, counts) {
    if (!tracks.length) return '<div class="ap-empty">No tracks in vault</div>';
    return tracks.map(function (t, i) {
      const plays = counts[t.id] || 0;
      return '<div class="ap-disc-row" onclick="closeArtistPage();setTimeout(function(){' +
        'var idx=(window.getPlaylist?window.getPlaylist():[]).findIndex(function(x){return x.id===' + t.id + '});' +
        'if(idx!==-1&&window.playAtIndex)playAtIndex(idx);},150)">' +
        '<div class="ap-disc-row-num">' + (i + 1) + '</div>' +
        (t.coverArt
          ? '<img class="ap-disc-row-cover" src="' + esc(t.coverArt) + '" alt="" loading="lazy">'
          : '<div class="ap-disc-row-cover" style="display:flex;align-items:center;justify-content:center;font-size:16px;color:rgba(255,255,255,0.2);border-radius:4px;background:rgba(255,255,255,0.06)">♪</div>') +
        '<div class="ap-disc-row-info">' +
          '<div class="ap-disc-row-title">' + esc(t.title) + '</div>' +
          '<div class="ap-disc-row-plays">' + (plays > 0 ? plays + ' play' + (plays !== 1 ? 's' : '') : 'unplayed') + '</div>' +
        '</div></div>';
    }).join('');
  }

  // ── Skeleton HTML (renders immediately, API sections filled in later) ──────

  function buildSkeleton(artist, pal, tracks, counts) {
    const hist        = vaultHistory();
    const artistPlays = hist.plays.filter(function (p) {
      return p.artist && p.artist.toLowerCase() === artist.toLowerCase();
    });
    const totalSec = artistPlays.reduce(function (s, p) { return s + (p.duration || 0); }, 0);
    const hh = Math.floor(totalSec / 3600);
    const mm = Math.floor((totalSec % 3600) / 60);
    const listenStr = hh > 0 ? hh + 'h ' + mm + 'm' : mm > 0 ? mm + 'm' : '0m';
    const byPlays = tracks.slice().sort(function (a, b) { return (counts[b.id] || 0) - (counts[a.id] || 0); });
    const topName = (byPlays[0] && byPlays[0].title) || '—';
    const words   = artist.trim().split(/\s+/);
    const initials = words.length >= 2
      ? (words[0][0] + words[words.length - 1][0]).toUpperCase()
      : artist.slice(0, 2).toUpperCase();

    const adminRow = window.isAdmin ? (
      '<div class="ap-admin-row">' +
        '<button class="btn" onclick="window._apPlayAll()">▶ Play All</button>' +
        '<button class="btn" onclick="window._apShuffleAll()">⇌ Shuffle All</button>' +
        '<button class="btn" onclick="closeArtistPage();setTimeout(function(){var pb=document.getElementById(\'palette-btn\');if(pb)pb.click();},150)">🎨 Palette</button>' +
        '<button class="btn" onclick="closeArtistPage();setTimeout(function(){openArtistViz(\'' + artist.replace(/'/g, "\\'") + '\');},200)">⊞ Visualizer</button>' +
      '</div>'
    ) : '';

    return (
      '<div class="ap-container" style="--ap-primary:' + pal.primary + ';--ap-secondary:' + pal.secondary + ';--ap-text:' + pal.text + ';--ap-glow:' + pal.glow + '">' +

      '<div class="ap-header ap-header-anim" style="background:linear-gradient(135deg,' + pal.gradient[0] + 'cc 0%,' + pal.gradient[1] + '88 55%,#080808 100%)">' +
        '<button class="ap-close-btn" onclick="closeArtistPage()">✕</button>' +
        '<div class="ap-header-left">' +
          '<h1 class="ap-name">' + esc(artist.toUpperCase()) + '</h1>' +
          '<div id="ap-tags-row" class="ap-tags-row"></div>' +
          '<div id="ap-origin-row" class="ap-origin-row"></div>' +
          '<div id="ap-listeners-row" class="ap-listeners-row"></div>' +
        '</div>' +
        '<div id="ap-avatar" class="ap-avatar ap-avatar-lg ap-avatar-anim"' +
          ' style="background:' + pal.primary + ';box-shadow:0 0 0 3px ' + pal.glow + ',0 8px 32px ' + rgba(pal.glow, 0.4) + '">' +
          initials +
        '</div>' +
      '</div>' +

      '<div class="ap-stats">' +
        '<div class="ap-stat ap-stat-anim" style="--stagger:0ms"><div class="ap-stat-val">' + tracks.length + '</div><div class="ap-stat-label">In Vault</div></div>' +
        '<div class="ap-stat ap-stat-anim" style="--stagger:60ms"><div class="ap-stat-val">' + artistPlays.length + '</div><div class="ap-stat-label">Vault Plays</div></div>' +
        '<div class="ap-stat ap-stat-anim" style="--stagger:120ms"><div class="ap-stat-val">' + listenStr + '</div><div class="ap-stat-label">Listen Time</div></div>' +
        '<div class="ap-stat ap-stat-anim" style="--stagger:180ms" title="' + esc(topName) + '">' +
          '<div class="ap-stat-val" style="font-size:' + (topName.length > 12 ? '10px' : '16px') + ';line-height:1.2">' +
            esc(topName.length > 16 ? topName.slice(0, 15) + '…' : topName) +
          '</div><div class="ap-stat-label">Top Track</div>' +
        '</div>' +
      '</div>' +

      '<div id="ap-bio-slot" class="ap-bio-skel ap-skel-pulse"></div>' +

      '<div class="ap-section">' +
        '<div class="ap-section-header">' +
          '<span class="ap-section-title" style="margin-bottom:0">IN THE VAULT</span>' +
          '<div class="ap-disc-controls">' +
            '<select class="ap-sort-sel" id="ap-sort-sel" onchange="window._apSortChanged(this.value)">' +
              '<option value="plays">Play Count</option>' +
              '<option value="title">Title</option>' +
              '<option value="added">Date Added</option>' +
            '</select>' +
            '<div class="ap-view-toggle">' +
              '<button class="ap-view-btn active" id="ap-grid-btn" onclick="apSetDiscView(\'grid\')">⊞</button>' +
              '<button class="ap-view-btn" id="ap-list-btn" onclick="apSetDiscView(\'list\')">≡</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div id="ap-discography" class="ap-disc-grid">' + renderGrid(byPlays, counts) + '</div>' +
      '</div>' +

      '<div id="ap-api-sections">' +
        '<div class="ap-section"><div class="ap-section-title">POPULAR · LAST.FM</div>' +
          '<div class="ap-skel-list">' + [1,2,3,4,5].map(function(){return '<div class="ap-skel-row ap-skel-pulse"></div>';}).join('') + '</div></div>' +
        '<div class="ap-section"><div class="ap-section-title">DISCOGRAPHY</div>' +
          '<div class="ap-skel-grid">' + [1,2,3,4].map(function(){return '<div class="ap-skel-album ap-skel-pulse"></div>';}).join('') + '</div></div>' +
        '<div class="ap-section"><div class="ap-section-title">SIMILAR ARTISTS</div>' +
          '<div class="ap-skel-list ap-skel-row-wrap">' + [1,2,3].map(function(){return '<div class="ap-skel-pill ap-skel-pulse"></div>';}).join('') + '</div></div>' +
      '</div>' +

      adminRow +
      '</div>'
    );
  }

  // ── API-populated sections ────────────────────────────────────────────────

  function buildApiSections(data, pal) {
    const vaultArtistNames = new Set((window.tracks || []).map(function (t) { return t.artist.toLowerCase(); }));
    let html = '';

    const topTracks = data.topTracks || [];
    if (topTracks.length) {
      html += '<div class="ap-section"><div class="ap-section-title">POPULAR · LAST.FM</div>' +
        '<div class="ap-lfm-list">' +
        topTracks.map(function (t, i) {
          return '<div class="ap-lfm-row">' +
            '<div class="ap-lfm-rank">' + (i + 1) + '</div>' +
            '<div class="ap-lfm-info">' +
              '<div class="ap-lfm-name">' + esc(t.name) + '</div>' +
              '<div class="ap-lfm-plays">' + fmtNum(t.playcount) + ' plays</div>' +
            '</div>' +
            '<button class="ap-vault-btn" data-trackname="' + esc(t.name) + '"' +
              ' onclick="closeArtistPage();setTimeout(function(){' +
                'var n=this.dataset.trackname;' +
                'var inp=document.getElementById(\'search-input\');' +
                'if(inp){inp.value=n;inp.dispatchEvent(new Event(\'input\'));}' +
              '}.bind(this),150)">▶ Vault</button>' +
          '</div>';
        }).join('') +
        '</div></div>';
    }

    const albums = (data.topAlbums || [])
      .filter(function (a) { return a.name && a.name !== '(null)' && a.name !== '[unknown]'; })
      .slice(0, 8);
    if (albums.length) {
      html += '<div class="ap-section"><div class="ap-section-title">DISCOGRAPHY</div>' +
        '<div class="ap-albums-grid">' +
        albums.map(function (a) {
          const img = bestImg(a.image);
          return '<div class="ap-album" onclick="window.open(\'' + esc(a.url || '') + '\',\'_blank\')" title="' + esc(a.name) + '">' +
            (img
              ? '<img class="ap-album-img" src="' + esc(img) + '" alt="' + esc(a.name) + '" loading="lazy">'
              : '<div class="ap-album-img ap-album-ph" style="background:' + pal.secondary + '">♪</div>') +
            '<div class="ap-album-name">' + esc(a.name) + '</div>' +
          '</div>';
        }).join('') +
        '</div></div>';
    }

    const similar = data.similar || [];
    if (similar.length) {
      html += '<div class="ap-section"><div class="ap-section-title">SIMILAR ARTISTS</div>' +
        '<div class="ap-similar-row">' +
        similar.map(function (s) {
          const inVault  = vaultArtistNames.has(s.name.toLowerCase());
          const sInitials = s.name.split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
          const sImg     = bestImg(s.image);
          const handler  = inVault
            ? 'onclick="openArtistPage(\'' + s.name.replace(/'/g, "\\'") + '\')"'
            : 'onclick="window.open(\'' + esc(s.url || '') + '\',\'_blank\')"';
          return '<div class="ap-similar-pill" ' + handler + '>' +
            '<div class="ap-similar-av" style="background:' + pal.primary + '">' +
              (sImg ? '<img src="' + esc(sImg) + '" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:50%">' : sInitials) +
            '</div>' +
            '<span class="ap-similar-name">' + esc(s.name) + '</span>' +
            (inVault ? '<span class="ap-similar-dot" style="color:' + pal.primary + '">♦</span>' : '') +
          '</div>';
        }).join('') +
        '</div></div>';
    }

    return html;
  }

  // ── Page enhancement (runs after API data arrives) ────────────────────────

  function enhancePage(artist, pal, data) {
    if (window.activeArtistName !== artist) return;

    const info = data && data.info;

    // Artist photo
    if (info) {
      const imgUrl = bestImg(info.image);
      if (imgUrl) {
        const av = document.getElementById('ap-avatar');
        if (av) {
          const tmp = new Image();
          tmp.onload = function () {
            av.textContent = '';
            av.style.background = 'none';
            av.style.overflow   = 'hidden';
            av.style.padding    = '0';
            const pic = document.createElement('img');
            pic.src = imgUrl;
            pic.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;border-radius:50%';
            av.appendChild(pic);
          };
          tmp.src = imgUrl;
        }
      }

      // Genre tags
      const tags    = ((info.tags && info.tags.tag) || []).slice(0, 4);
      const tagsRow = document.getElementById('ap-tags-row');
      if (tagsRow && tags.length) {
        tagsRow.innerHTML = tags.map(function (t) {
          return '<span class="ap-genre-pill" style="background:' + rgba(pal.primary, 0.18) + ';color:' + pal.text + '">' + esc(t.name) + '</span>';
        }).join('');
      }

      // Listeners
      const listeners = parseInt((info.stats && info.stats.listeners) || '0', 10);
      const lr = document.getElementById('ap-listeners-row');
      if (lr && listeners > 0) lr.textContent = fmtNum(listeners) + ' listeners on Last.fm';
    }

    // MusicBrainz origin + formed year
    const mb = data && data.mb;
    if (mb) {
      const parts  = [];
      const area   = (mb.area && mb.area.name) || (mb['begin-area'] && mb['begin-area'].name);
      if (area)           parts.push(area);
      else if (mb.country) parts.push(mb.country);
      const formed = mb['life-span'] && mb['life-span'].begin;
      if (formed) parts.push(formed.slice(0, 4));
      const or = document.getElementById('ap-origin-row');
      if (or && parts.length) or.textContent = parts.join(' · ');
    }

    // Bio
    const bioSlot = document.getElementById('ap-bio-slot');
    if (bioSlot) {
      const rawBio  = (info && info.bio && info.bio.summary) || '';
      const bioText = stripHtml(rawBio).replace(/read more on last\.fm\s*\.?\s*$/i, '').trim();
      if (bioText.length > 10) {
        const SHORT    = 300;
        const isLong   = bioText.length > SHORT;
        const shortBio = isLong ? bioText.slice(0, SHORT) + '…' : bioText;
        // Store bio in window vars to avoid encoding issues in onclick attr
        window._apBioFull  = bioText;
        window._apBioShort = shortBio;
        bioSlot.className  = 'ap-section';
        bioSlot.innerHTML  =
          '<div class="ap-section-title">ABOUT</div>' +
          '<p class="ap-bio-text" id="ap-bio-text">' + esc(shortBio) + '</p>' +
          (isLong
            ? '<button class="ap-bio-more" id="ap-bio-more"' +
              ' onclick="var b=document.getElementById(\'ap-bio-text\'),m=this;' +
              'if(b.dataset.x){b.textContent=window._apBioShort;delete b.dataset.x;m.textContent=\'Read more\';}' +
              'else{b.textContent=window._apBioFull;b.dataset.x=1;m.textContent=\'Read less\';}">Read more</button>'
            : '');
      } else {
        bioSlot.remove();
      }
    }

    // Last.fm sections (top tracks, discography, similar)
    const apiSec = document.getElementById('ap-api-sections');
    if (apiSec) {
      const html = buildApiSections(data, pal);
      apiSec.innerHTML = html || '';
      if (!html) apiSec.remove();
    }
  }

  // ── Main override: renderArtistPage ──────────────────────────────────────

  window.renderArtistPage = function (artist) {
    const ov = document.getElementById('artist-overlay');
    if (!ov || !artist) return;

    const pal = window.getArtistPalette
      ? window.getArtistPalette(artist)
      : { primary: '#ff3c3c', secondary: '#1a0505', text: '#ff9999', glow: '#ff1111', gradient: ['#ff3c3c', '#8b0000'] };

    const at = vaultTracks(artist);
    const c  = playCounts();
    window._apCurrentSort = 'plays';

    ov.innerHTML = buildSkeleton(artist, pal, at, c);

    if (!isMainstream(artist)) {
      var bioSlot = document.getElementById('ap-bio-slot');
      var apiSec  = document.getElementById('ap-api-sections');
      if (bioSlot) bioSlot.remove();
      if (apiSec)  apiSec.remove();
      return;
    }

    fetchApiData(artist).then(function (data) {
      enhancePage(artist, pal, data);
    });
  };

  // ── apSetDiscView override ────────────────────────────────────────────────

  window.apSetDiscView = function (mode) {
    const disc    = document.getElementById('ap-discography');
    const gridBtn = document.getElementById('ap-grid-btn');
    const listBtn = document.getElementById('ap-list-btn');
    if (!disc || !window.activeArtistName) return;
    const st = sortTracks(window.activeArtistName, window._apCurrentSort || 'plays');
    const c  = playCounts();
    if (mode === 'grid') {
      disc.className = 'ap-disc-grid';
      disc.innerHTML = renderGrid(st, c);
      if (gridBtn) gridBtn.classList.add('active');
      if (listBtn) listBtn.classList.remove('active');
    } else {
      disc.className = 'ap-disc-list';
      disc.innerHTML = renderList(st, c);
      if (listBtn) listBtn.classList.add('active');
      if (gridBtn) gridBtn.classList.remove('active');
    }
  };

  // ── Sort changed ──────────────────────────────────────────────────────────

  window._apSortChanged = function (val) {
    window._apCurrentSort = val;
    const disc = document.getElementById('ap-discography');
    if (!disc || !window.activeArtistName) return;
    const st    = sortTracks(window.activeArtistName, val);
    const c     = playCounts();
    const isGrid = disc.classList.contains('ap-disc-grid');
    disc.innerHTML = isGrid ? renderGrid(st, c) : renderList(st, c);
  };

  // ── Play All / Shuffle All ────────────────────────────────────────────────

  window._apPlayAll = function () {
    const artist = window.activeArtistName;
    if (!artist) return;
    closeArtistPage();
    setTimeout(function () {
      if (window.activeFilter !== undefined) {
        window.activeFilter = artist;
        if (window.renderFilters) window.renderFilters();
        if (window.setView) window.setView('tracks');
        setTimeout(function () {
          const pl = window.getPlaylist ? window.getPlaylist() : [];
          if (pl.length && window.playAtIndex) window.playAtIndex(0);
        }, 100);
      }
    }, 200);
  };

  window._apShuffleAll = function () {
    const artist = window.activeArtistName;
    if (!artist) return;
    closeArtistPage();
    setTimeout(function () {
      if (window.activeFilter !== undefined) {
        window.activeFilter = artist;
        const sb = document.getElementById('shuffle-btn');
        if (sb && !sb.classList.contains('active')) sb.click();
        if (window.renderFilters) window.renderFilters();
        if (window.setView) window.setView('tracks');
        setTimeout(function () {
          const pl = window.getPlaylist ? window.getPlaylist() : [];
          if (pl.length && window.playAtIndex)
            window.playAtIndex(Math.floor(Math.random() * pl.length));
        }, 100);
      }
    }, 200);
  };

  // ── Delegated click listener (backup for artist-link elements) ────────────
  // Filter buttons are handled by vault.js; player + card links use stopPropagation.
  // This catches any other .artist-link[data-artist] elements.

  document.addEventListener('click', function (e) {
    const link = e.target.closest('.artist-link');
    if (!link || !link.dataset.artist) return;
    if (link.classList.contains('filter-btn')) return;
    openArtistPage(link.dataset.artist);
  });

  console.log('[ArtistPage] v2 loaded — Last.fm + MusicBrainz');
}());
