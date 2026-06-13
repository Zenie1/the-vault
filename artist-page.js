// artist-page.js — Enhanced Artist Page with Last.fm + MusicBrainz + SoundCloud Widget
// Loaded by index.html AFTER vault.js; overrides window.renderArtistPage + window.apSetDiscView
//
// KEY: vault.js uses `let` for tracks, activeArtistName, isAdmin, activeFilter.
// `let` top-level variables are NOT properties of window in browsers.
// Access them as bare identifiers (global lexical scope) — NOT window.*.

(function () {
  'use strict';

  const LASTFM_KEY         = '311be84da488e0f3eae8987d051e2cc3';
  const LASTFM_PLACEHOLDER = '2a96cbd8b46e442fc41c2b86b821562f';
  const CORSPROXY          = 'https://corsproxy.io/?';
  const API_TIMEOUT_MS     = 5000;

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
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000)    return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return n.toString();
  }

  function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function stripHtml(html) {
    return (html || '')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'")
      .replace(/\s+/g,' ').trim();
  }

  function isPlaceholder(url) {
    return !url || url.includes(LASTFM_PLACEHOLDER) || url.includes('_nophoto_');
  }

  function bestImg(images) {
    if (!images || !images.length) return null;
    for (var i = 0; i < ['extralarge','large','medium'].length; i++) {
      var size = ['extralarge','large','medium'][i];
      var img  = images.filter(function(x){ return x.size === size; })[0];
      if (img && img['#text'] && !isPlaceholder(img['#text'])) return img['#text'];
    }
    return null;
  }

  function rgba(hex, a) {
    return window.hexToRgba ? window.hexToRgba(hex, a) : 'rgba(255,255,255,' + a + ')';
  }

  // ── API helpers ───────────────────────────────────────────────────────────

  function fetchWithTimeout(url, opts) {
    var controller = new AbortController();
    var timer = setTimeout(function(){ controller.abort(); }, API_TIMEOUT_MS);
    var merged = Object.assign({}, opts || {}, { signal: controller.signal });
    return fetch(url, merged).finally(function(){ clearTimeout(timer); });
  }

  async function lfmFetch(method, artist, limit) {
    var url = 'https://ws.audioscrobbler.com/2.0/?method=' + method +
      '&artist=' + encodeURIComponent(artist) +
      '&api_key=' + LASTFM_KEY +
      '&format=json&limit=' + (limit || 10);

    console.log('[ArtistPage] Last.fm →', method, '|', artist);

    try {
      var r = await fetchWithTimeout(url, {});
      if (r.ok) {
        var d = await r.json();
        console.log('[ArtistPage] Last.fm ✓', method);
        return d;
      }
      throw new Error('HTTP ' + r.status);
    } catch (e1) {
      var reason = e1.name === 'AbortError' ? 'timeout' : e1.message;
      console.warn('[ArtistPage] Last.fm direct failed (' + reason + '), trying proxy:', method);
    }

    try {
      var proxyUrl = CORSPROXY + encodeURIComponent(url);
      var r2 = await fetchWithTimeout(proxyUrl, {});
      if (r2.ok) {
        var d2 = await r2.json();
        console.log('[ArtistPage] Last.fm ✓ (proxy)', method);
        return d2;
      }
    } catch (e2) {
      console.warn('[ArtistPage] Last.fm proxy also failed:', method, e2.message);
    }
    return null;
  }

  async function mbFetch(artist) {
    var url = 'https://musicbrainz.org/ws/2/artist/?query=' + encodeURIComponent(artist) + '&fmt=json&limit=1';
    console.log('[ArtistPage] MusicBrainz →', artist);
    try {
      var r = await fetchWithTimeout(url, {
        headers: { 'User-Agent': 'TheVault/1.0 (zenie1.github.io/the-vault)' }
      });
      if (!r.ok) { console.warn('[ArtistPage] MusicBrainz HTTP', r.status); return null; }
      var d = await r.json();
      console.log('[ArtistPage] MusicBrainz ✓');
      return (d.artists && d.artists[0]) || null;
    } catch (e) {
      console.warn('[ArtistPage] MusicBrainz failed:', e.message);
      return null;
    }
  }

  async function fetchApiData(artist) {
    var cacheKey = 'ap2_' + artist.toLowerCase().replace(/\s+/g, '_');
    try {
      var cached = sessionStorage.getItem(cacheKey);
      if (cached) { console.log('[ArtistPage] cache hit:', artist); return JSON.parse(cached); }
    } catch (e) {}

    if (!isMainstream(artist)) {
      var noData = { mainstream: false };
      try { sessionStorage.setItem(cacheKey, JSON.stringify(noData)); } catch (e) {}
      return noData;
    }

    console.log('[ArtistPage] Fetching all API data for:', artist);
    var results = await Promise.all([
      lfmFetch('artist.getinfo',      artist, 1),
      lfmFetch('artist.gettoptracks', artist, 10),
      lfmFetch('artist.gettopalbums', artist, 8),
      lfmFetch('artist.getsimilar',   artist, 5),
      mbFetch(artist),
    ]);

    var info      = results[0];
    var toptracks = results[1];
    var topalbums = results[2];
    var similar   = results[3];
    var mb        = results[4];

    var allFailed = !info && !toptracks && !topalbums && !similar;
    if (allFailed) console.warn('[ArtistPage] All Last.fm calls returned null');

    var data = {
      mainstream: true,
      allFailed:  allFailed,
      info:      (info && info.artist)                                                   || null,
      topTracks: (toptracks && toptracks.toptracks && toptracks.toptracks.track)        || [],
      topAlbums: (topalbums && topalbums.topalbums && topalbums.topalbums.album)        || [],
      similar:   (similar && similar.similarartists && similar.similarartists.artist)   || [],
      mb:        mb || null,
    };
    try { sessionStorage.setItem(cacheKey, JSON.stringify(data)); } catch (e) {}
    return data;
  }

  // ── Vault data helpers ────────────────────────────────────────────────────

  function vaultTracks(artist) {
    var needle = artist.toLowerCase().trim();
    return (typeof tracks !== 'undefined' ? tracks : []).filter(function (t) {
      return t.artist.toLowerCase().trim() === needle;
    });
  }

  function playCounts() {
    return window.getPlayCounts ? window.getPlayCounts() : {};
  }

  function vaultHistory() {
    return window._getHistory ? window._getHistory() : { plays: [] };
  }

  function sortTracks(artist, mode) {
    var t = vaultTracks(artist);
    var c = playCounts();
    if (mode === 'title') return t.slice().sort(function(a,b){ return a.title.localeCompare(b.title); });
    if (mode === 'added') return t.slice().sort(function(a,b){ return new Date(b.added) - new Date(a.added); });
    return t.slice().sort(function(a,b){ return (c[b.id]||0) - (c[a.id]||0); });
  }

  function isTrackInVault(artist, trackName) {
    var aLow = artist.toLowerCase().trim();
    var tLow = trackName.toLowerCase().trim();
    return (typeof tracks !== 'undefined' ? tracks : []).some(function(t) {
      return t.artist.toLowerCase().trim() === aLow && t.title.toLowerCase().trim() === tLow;
    });
  }

  // ── Track list renderers ──────────────────────────────────────────────────

  function playClick(id) {
    return 'closeArtistPage();setTimeout(function(){' +
      'var idx=(window.getPlaylist?window.getPlaylist():[]).findIndex(function(x){return x.id===' + id + '});' +
      'if(idx!==-1&&window.playAtIndex)playAtIndex(idx);},150)';
  }

  function renderGrid(tracks, counts) {
    if (!tracks.length) return '<div class="ap-empty">No tracks in vault</div>';
    return tracks.map(function (t) {
      var plays = counts[t.id] || 0;
      return '<div class="ap-disc-item" onclick="' + playClick(t.id) + '">' +
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
      var plays = counts[t.id] || 0;
      return '<div class="ap-disc-row" onclick="' + playClick(t.id) + '">' +
        '<div class="ap-disc-row-num">' + (i+1) + '</div>' +
        (t.coverArt
          ? '<img class="ap-disc-row-cover" src="' + esc(t.coverArt) + '" alt="" loading="lazy">'
          : '<div class="ap-disc-row-cover" style="display:flex;align-items:center;justify-content:center;font-size:16px;color:rgba(255,255,255,0.2);border-radius:4px;background:rgba(255,255,255,0.06)">♪</div>') +
        '<div class="ap-disc-row-info">' +
          '<div class="ap-disc-row-title">' + esc(t.title) + '</div>' +
          '<div class="ap-disc-row-plays">' + (plays > 0 ? plays + ' play' + (plays !== 1 ? 's' : '') : 'unplayed') + '</div>' +
        '</div></div>';
    }).join('');
  }

  // ── Skeleton HTML ─────────────────────────────────────────────────────────

  function buildSkeleton(artist, pal, tracks, counts) {
    var hist        = vaultHistory();
    var artistPlays = hist.plays.filter(function(p){
      return p.artist && p.artist.toLowerCase().trim() === artist.toLowerCase().trim();
    });
    var totalSec = artistPlays.reduce(function(s,p){ return s + (p.duration||0); }, 0);
    var hh = Math.floor(totalSec / 3600);
    var mm = Math.floor((totalSec % 3600) / 60);
    var listenStr = hh > 0 ? hh+'h '+mm+'m' : mm > 0 ? mm+'m' : '0m';
    var byPlays = tracks.slice().sort(function(a,b){ return (counts[b.id]||0) - (counts[a.id]||0); });
    var topName = (byPlays[0] && byPlays[0].title) || '—';
    var words   = artist.trim().split(/\s+/);
    var initials = words.length >= 2
      ? (words[0][0] + words[words.length-1][0]).toUpperCase()
      : artist.slice(0,2).toUpperCase();

    var admin = (typeof isAdmin !== 'undefined' && isAdmin);
    var adminRow = admin ? (
      '<div class="ap-admin-row">' +
        '<button class="btn" onclick="window._apPlayAll()">▶ Play All</button>' +
        '<button class="btn" onclick="window._apShuffleAll()">⇌ Shuffle All</button>' +
        '<button class="btn" onclick="closeArtistPage();setTimeout(function(){var pb=document.getElementById(\'palette-btn\');if(pb)pb.click();},150)">🎨 Palette</button>' +
        '<button class="btn" onclick="closeArtistPage();setTimeout(function(){openArtistViz(\'' + artist.replace(/'/g,"\\'") + '\');},200)">⊞ Visualizer</button>' +
      '</div>'
    ) : '';

    return (
      '<div class="ap-container" style="--ap-primary:'+pal.primary+';--ap-secondary:'+pal.secondary+';--ap-text:'+pal.text+';--ap-glow:'+pal.glow+'">' +

      '<div class="ap-header ap-header-anim" style="background:linear-gradient(135deg,'+pal.gradient[0]+'cc 0%,'+pal.gradient[1]+'88 55%,#080808 100%)">' +
        '<button class="ap-close-btn" onclick="closeArtistPage()">✕</button>' +
        '<div class="ap-header-left">' +
          '<h1 class="ap-name">'+esc(artist.toUpperCase())+'</h1>' +
          '<div id="ap-tags-row" class="ap-tags-row"></div>' +
          '<div id="ap-origin-row" class="ap-origin-row"></div>' +
          '<div id="ap-listeners-row" class="ap-listeners-row"></div>' +
        '</div>' +
        '<div id="ap-avatar" class="ap-avatar ap-avatar-lg ap-avatar-anim"' +
          ' style="background:'+pal.primary+';box-shadow:0 0 0 3px '+pal.glow+',0 8px 32px '+rgba(pal.glow,0.4)+'">' +
          initials +
        '</div>' +
      '</div>' +

      '<div class="ap-stats">' +
        '<div class="ap-stat ap-stat-anim" style="--stagger:0ms"><div class="ap-stat-val">'+tracks.length+'</div><div class="ap-stat-label">In Vault</div></div>' +
        '<div class="ap-stat ap-stat-anim" style="--stagger:60ms"><div class="ap-stat-val">'+artistPlays.length+'</div><div class="ap-stat-label">Vault Plays</div></div>' +
        '<div class="ap-stat ap-stat-anim" style="--stagger:120ms"><div class="ap-stat-val">'+listenStr+'</div><div class="ap-stat-label">Listen Time</div></div>' +
        '<div class="ap-stat ap-stat-anim" style="--stagger:180ms" title="'+esc(topName)+'">' +
          '<div class="ap-stat-val" style="font-size:'+(topName.length>12?'10px':'16px')+';line-height:1.2">'+
            esc(topName.length>16?topName.slice(0,15)+'…':topName)+
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
        '<div id="ap-discography" class="ap-disc-grid">'+renderGrid(byPlays,counts)+'</div>' +
      '</div>' +

      '<div id="ap-api-sections">' +
        '<div class="ap-section"><div class="ap-section-title">POPULAR · LAST.FM</div>' +
          '<div class="ap-skel-list">'+ [1,2,3,4,5].map(function(){return '<div class="ap-skel-row ap-skel-pulse"></div>';}).join('') +'</div></div>' +
        '<div class="ap-section"><div class="ap-section-title">DISCOGRAPHY</div>' +
          '<div class="ap-skel-grid">'+ [1,2,3,4].map(function(){return '<div class="ap-skel-album ap-skel-pulse"></div>';}).join('') +'</div></div>' +
        '<div class="ap-section"><div class="ap-section-title">SIMILAR ARTISTS</div>' +
          '<div class="ap-skel-list ap-skel-row-wrap">'+ [1,2,3].map(function(){return '<div class="ap-skel-pill ap-skel-pulse"></div>';}).join('') +'</div></div>' +
      '</div>' +

      adminRow +
      '</div>'
    );
  }

  // ── API sections HTML ─────────────────────────────────────────────────────
  // artist param needed to determine in-vault vs stream buttons on top tracks

  function buildApiSections(data, pal, artist) {
    var allTracks = (typeof tracks !== 'undefined' ? tracks : []);
    var vaultArtistNames = {};
    allTracks.forEach(function(t){ vaultArtistNames[t.artist.toLowerCase().trim()] = true; });
    var html = '';

    var topTracks = data.topTracks || [];
    if (topTracks.length) {
      html += '<div class="ap-section"><div class="ap-section-title">POPULAR · LAST.FM</div>' +
        '<div class="ap-lfm-list">' +
        topTracks.map(function(t, i) {
          var btnId   = 'ap-yt-btn-' + i;
          var inVault = isTrackInVault(artist, t.name);
          var btn;
          if (inVault) {
            // Track is in vault — search & play from vault
            btn = '<button class="ap-vault-btn" data-trackname="' + esc(t.name) + '"' +
              ' onclick="closeArtistPage();setTimeout(function(){' +
                'var n=this.dataset.trackname,' +
                'inp=document.getElementById(\'search-input\');' +
                'if(inp){inp.value=n;inp.dispatchEvent(new Event(\'input\'));}' +
              '}.bind(this),150)">▶ Play</button>';
          } else {
            // Not in vault — stream via YouTube
            btn = '<button class="ap-vault-btn ap-yt-btn" id="' + btnId + '"' +
              ' data-artist="' + esc(artist) + '" data-track="' + esc(t.name) + '"' +
              ' onclick="window._apYtPlay(this)">♫ Stream</button>';
          }
          return '<div class="ap-lfm-row">' +
            '<div class="ap-lfm-rank">'+(i+1)+'</div>' +
            '<div class="ap-lfm-info">' +
              '<div class="ap-lfm-name">'+esc(t.name)+'</div>' +
              '<div class="ap-lfm-plays">'+fmtNum(t.playcount)+' plays</div>' +
            '</div>' +
            btn +
          '</div>';
        }).join('') +
        '</div></div>';
    }

    var albums = (data.topAlbums || [])
      .filter(function(a){ return a.name && a.name !== '(null)' && a.name !== '[unknown]'; })
      .slice(0,8);
    if (albums.length) {
      html += '<div class="ap-section"><div class="ap-section-title">DISCOGRAPHY</div>' +
        '<div class="ap-albums-grid">' +
        albums.map(function(a){
          var img = bestImg(a.image);
          return '<div class="ap-album" onclick="window.open(\''+esc(a.url||'')+'\',\'_blank\')" title="'+esc(a.name)+'">' +
            (img
              ? '<img class="ap-album-img" src="'+esc(img)+'" alt="'+esc(a.name)+'" loading="lazy">'
              : '<div class="ap-album-img ap-album-ph" style="background:'+pal.secondary+'">♪</div>') +
            '<div class="ap-album-name">'+esc(a.name)+'</div>' +
          '</div>';
        }).join('') +
        '</div></div>';
    }

    var similar = data.similar || [];
    if (similar.length) {
      html += '<div class="ap-section"><div class="ap-section-title">SIMILAR ARTISTS</div>' +
        '<div class="ap-similar-row">' +
        similar.map(function(s){
          var inVault  = !!vaultArtistNames[s.name.toLowerCase().trim()];
          var sInitials = s.name.split(/\s+/).slice(0,2).map(function(w){return w[0];}).join('').toUpperCase();
          var sImg     = bestImg(s.image);
          var handler  = inVault
            ? 'onclick="openArtistPage(\'' + s.name.replace(/'/g,"\\'") + '\')"'
            : 'onclick="window.open(\'' + esc(s.url||'') + '\',\'_blank\')"';
          return '<div class="ap-similar-pill" '+handler+'>' +
            '<div class="ap-similar-av" style="background:'+pal.primary+'">' +
              (sImg ? '<img src="'+esc(sImg)+'" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:50%">' : sInitials) +
            '</div>' +
            '<span class="ap-similar-name">'+esc(s.name)+'</span>' +
            (inVault ? '<span class="ap-similar-dot" style="color:'+pal.primary+'">♦</span>' : '') +
          '</div>';
        }).join('') +
        '</div></div>';
    }

    return html;
  }

  // ── Page enhancement ──────────────────────────────────────────────────────

  function enhancePage(artist, pal, data) {
    if (typeof activeArtistName === 'undefined' || activeArtistName !== artist) return;

    var info = data && data.info;

    if (data.allFailed) {
      var bioSlotF = document.getElementById('ap-bio-slot');
      var apiSecF  = document.getElementById('ap-api-sections');
      if (bioSlotF) bioSlotF.remove();
      if (apiSecF)  apiSecF.innerHTML =
        '<div class="ap-section"><div class="ap-unavailable">External data unavailable</div></div>';
      return;
    }

    if (info) {
      var imgUrl = bestImg(info.image);
      console.log('[ArtistPage] artist image URL:', imgUrl);
      if (imgUrl) {
        var av = document.getElementById('ap-avatar');
        if (av) {
          var tmp = new Image();
          tmp.onload = function() {
            av.textContent = '';
            av.style.background = 'none';
            av.style.overflow   = 'hidden';
            av.style.padding    = '0';
            var pic = document.createElement('img');
            pic.src = imgUrl;
            pic.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;border-radius:50%';
            av.appendChild(pic);
          };
          tmp.src = imgUrl;
        }
      }

      var tags    = ((info.tags && info.tags.tag) || []).slice(0,4);
      var tagsRow = document.getElementById('ap-tags-row');
      if (tagsRow && tags.length) {
        tagsRow.innerHTML = tags.map(function(t){
          return '<span class="ap-genre-pill" style="background:'+rgba(pal.primary,0.18)+';color:'+pal.text+'">'+esc(t.name)+'</span>';
        }).join('');
      }

      var listeners = parseInt((info.stats && info.stats.listeners) || '0', 10);
      var lr = document.getElementById('ap-listeners-row');
      if (lr && listeners > 0) lr.textContent = fmtNum(listeners) + ' listeners on Last.fm';
    }

    var mb = data && data.mb;
    if (mb) {
      var parts  = [];
      var area   = (mb.area && mb.area.name) || (mb['begin-area'] && mb['begin-area'].name);
      if (area)            parts.push(area);
      else if (mb.country) parts.push(mb.country);
      var formed = mb['life-span'] && mb['life-span'].begin;
      if (formed) parts.push(formed.slice(0,4));
      var or = document.getElementById('ap-origin-row');
      if (or && parts.length) or.textContent = parts.join(' · ');
    }

    var bioSlot = document.getElementById('ap-bio-slot');
    if (bioSlot) {
      var rawBio  = (info && info.bio && info.bio.summary) || '';
      var bioText = stripHtml(rawBio).replace(/read more on last\.fm\s*\.?\s*$/i,'').trim();
      if (bioText.length > 10) {
        var SHORT    = 300;
        var isLong   = bioText.length > SHORT;
        var shortBio = isLong ? bioText.slice(0,SHORT) + '…' : bioText;
        window._apBioFull  = bioText;
        window._apBioShort = shortBio;
        bioSlot.className  = 'ap-section';
        bioSlot.innerHTML  =
          '<div class="ap-section-title">ABOUT</div>' +
          '<p class="ap-bio-text" id="ap-bio-text">'+esc(shortBio)+'</p>' +
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

    var apiSec = document.getElementById('ap-api-sections');
    if (apiSec) {
      var html = buildApiSections(data, pal, artist);
      apiSec.innerHTML = html || '';
      if (!html) apiSec.remove();
    }
  }

  // ── YouTube Visualizer ───────────────────────────────────────────────────

  var ytViz = {
    canvas:      null,
    ctx:         null,
    frame:       null,
    isRunning:   false,
    artistColor: '#ff3c3c',

    start: function (color) {
      this.canvas = document.getElementById('yt-viz-canvas');
      if (!this.canvas) return;
      this.ctx         = this.canvas.getContext('2d');
      this.artistColor = color || '#ff3c3c';
      this.isRunning   = true;
      var bar = document.getElementById('yt-player-bar');
      if (bar) bar.style.setProperty('--artist-primary', this.artistColor);
      this._draw();
    },

    stop: function () {
      this.isRunning = false;
      if (this.frame) { cancelAnimationFrame(this.frame); this.frame = null; }
      if (this.ctx && this.canvas) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    },

    _draw: function () {
      if (!this.isRunning) return;
      var self  = this;
      var W     = this.canvas.width;
      var H     = this.canvas.height;
      var ctx   = this.ctx;
      var t     = performance.now() * 0.001;
      var color = this.artistColor;
      var BAR_COUNT = 48;
      var barW  = (W / BAR_COUNT) - 1;

      ctx.clearRect(0, 0, W, H);

      for (var i = 0; i < BAR_COUNT; i++) {
        var freq = i / BAR_COUNT;
        var bass = Math.sin(t * 2.1 + i * 0.3) * 0.5 + 0.5;
        var mid  = Math.sin(t * 3.7 + i * 0.5) * 0.4 + 0.4;
        var high = Math.sin(t * 5.3 + i * 0.8) * 0.3 + 0.3;

        var val = freq < 0.3
          ? bass * 0.8 + mid * 0.2
          : freq < 0.7
            ? mid * 0.6 + high * 0.4
            : high;

        var barH = Math.max(2, val * H * 0.85);
        var x    = i * (barW + 1);
        var y    = H - barH;

        var grad = ctx.createLinearGradient(x, y, x, H);
        grad.addColorStop(0, color + 'cc');
        grad.addColorStop(1, color + '44');
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barW, barH);
      }

      this.frame = requestAnimationFrame(function () { self._draw(); });
    },
  };

  // ── YouTube Player ────────────────────────────────────────────────────────

  var ytPlayer = {
    player:        null,
    isReady:       false,
    currentArtist: null,
    currentTrack:  null,
    _activeBtnId:  null,

    init: function () {
      var self = this;

      window.onYouTubeIframeAPIReady = function () {
        self.player = new YT.Player('yt-player', {
          height: '90',
          width:  '160',
          playerVars: {
            autoplay:       0,
            controls:       1,
            modestbranding: 1,
            rel:            0,
            fs:             0,
          },
          events: {
            onReady: function () {
              self.isReady = true;
              console.log('[YT] Player ready');
            },
            onStateChange: function (e) {
              if (e.data === YT.PlayerState.PLAYING) {
                console.log('[YT] Playing');
                var btn = self._activeBtnId ? document.getElementById(self._activeBtnId) : null;
                if (btn) { btn.textContent = '■ Stop'; btn.disabled = false; btn.classList.add('yt-streaming'); }
                // Pause vault audio
                try {
                  if (typeof audio !== 'undefined' && !audio.paused) {
                    audio.pause();
                    var ppBtn = document.getElementById('play-pause-btn');
                    if (ppBtn) { ppBtn.innerHTML = '▶'; ppBtn.classList.remove('is-playing'); }
                    try { isPlaying = false; } catch(e2) {}
                  }
                } catch(e) {}
              } else if (e.data === YT.PlayerState.ENDED) {
                console.log('[YT] Ended');
                self._onStop();
              }
            },
            onError: function (e) {
              console.warn('[YT] Player error:', e.data);
              if (typeof showToast === 'function') showToast('TRACK UNAVAILABLE ON YOUTUBE', 'error');
              self._onStop();
            },
          },
        });
      };

      // If API script was already cached and executed before this ran
      if (window.YT && window.YT.Player) {
        window.onYouTubeIframeAPIReady();
      }

      var closeBtn = document.getElementById('yt-close-btn');
      if (closeBtn) closeBtn.addEventListener('click', function () { self.stop(); });
    },

    play: function (artist, trackName, btnId) {
      var self = this;

      if (!this.isReady) {
        if (typeof showToast === 'function') showToast('YOUTUBE PLAYER NOT READY — TRY AGAIN', 'info');
        return;
      }

      if (this._activeBtnId && this._activeBtnId !== btnId) {
        this._resetBtn(this._activeBtnId);
      }

      this.currentArtist = artist;
      this.currentTrack  = trackName;
      this._activeBtnId  = btnId;

      var btn = btnId ? document.getElementById(btnId) : null;
      if (btn) { btn.textContent = '⏳ Loading…'; btn.disabled = true; }

      this.searchYouTube(artist, trackName).then(function (videoId) {
        if (!videoId) {
          if (typeof showToast === 'function')
            showToast('"' + trackName + '" NOT FOUND ON YOUTUBE', 'error');
          self._onStop();
          return;
        }
        console.log('[YT] Loading video:', videoId);
        self.player.loadVideoById(videoId);
        self.show(artist, trackName);
      });
    },

    searchYouTube: async function (artist, trackName) {
      // YouTube API key — get a free key at:
      // https://console.cloud.google.com
      // Enable "YouTube Data API v3"
      // Create credentials → API key
      // Restrict to your domain: zenie1.github.io
      var YOUTUBE_API_KEY = 'AIzaSyAmKmAZZyOzTEWmvat1xdKG0oCK08URcSU';
      var query = encodeURIComponent(artist + ' ' + trackName + ' official audio');

      try {
        var url = 'https://www.googleapis.com/youtube/v3/search' +
          '?part=snippet&type=video&maxResults=1' +
          '&q=' + query +
          '&key=' + YOUTUBE_API_KEY;

        var r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (r.ok) {
          var d = await r.json();
          if (d.items && d.items.length > 0) {
            var videoId = d.items[0].id.videoId;
            console.log('[YT] Found via YouTube API:', videoId);
            return videoId;
          }
        }
      } catch(e) {
        console.warn('[YT] YouTube API failed:', e.message);
      }

      // Last resort — open YouTube search in new tab
      window.open('https://www.youtube.com/results?search_query=' + query, '_blank');
      if (typeof showToast === 'function') showToast('OPENING YOUTUBE — SEARCH UNAVAILABLE', 'info');
      return null;
    },

    show: function (artist, trackName) {
      var bar    = document.getElementById('yt-player-bar');
      var nameEl = document.getElementById('yt-track-name');
      if (nameEl) nameEl.textContent = artist + ' · ' + trackName;
      if (bar)    bar.classList.add('active');
      console.log('[YT] show() — bar:', bar, 'bottom:', bar ? getComputedStyle(bar).bottom : 'no bar');
      var pal   = window.getArtistPalette ? window.getArtistPalette(artist) : null;
      var color = (pal && pal.primary) || '#ff3c3c';
      ytViz.start(color);
    },

    hide: function () {
      var bar = document.getElementById('yt-player-bar');
      if (bar) bar.classList.remove('active');
      ytViz.stop();
    },

    stop: function () {
      if (this.player && this.isReady) {
        try { this.player.stopVideo(); } catch(e) {}
      }
      this._onStop();
    },

    _onStop: function () {
      this._resetBtn(this._activeBtnId);
      this._activeBtnId  = null;
      this.currentArtist = null;
      this.currentTrack  = null;
      ytViz.stop();
      this.hide();
    },

    _resetBtn: function (btnId) {
      var btn = btnId ? document.getElementById(btnId) : null;
      if (btn) { btn.textContent = '♫ Stream'; btn.disabled = false; btn.classList.remove('yt-streaming'); }
    },
  };

  // Expose ytPlayer globally (vault.js calls window.ytPlayer.stop() on play)
  window.ytPlayer = ytPlayer;

  // Helper called by YT stream buttons' onclick
  window._apYtPlay = function (btn) {
    var artist    = btn.dataset.artist;
    var trackName = btn.dataset.track;
    var btnId     = btn.id;
    if (btn.classList.contains('yt-streaming')) {
      ytPlayer.stop();
    } else {
      ytPlayer.play(artist, trackName, btnId);
    }
  };

  // ── Main override: renderArtistPage ──────────────────────────────────────

  window.renderArtistPage = function (artist) {
    var ov = document.getElementById('artist-overlay');
    if (!ov || !artist) return;

    var pal = window.getArtistPalette
      ? window.getArtistPalette(artist)
      : { primary:'#ff3c3c', secondary:'#1a0505', text:'#ff9999', glow:'#ff1111', gradient:['#ff3c3c','#8b0000'] };

    var at = vaultTracks(artist);
    var c  = playCounts();
    window._apCurrentSort = 'plays';

    ov.innerHTML = buildSkeleton(artist, pal, at, c);

    if (!isMainstream(artist)) {
      var bioSlot = document.getElementById('ap-bio-slot');
      var apiSec  = document.getElementById('ap-api-sections');
      if (bioSlot) bioSlot.remove();
      if (apiSec)  apiSec.remove();
      return;
    }

    fetchApiData(artist).then(function(data){
      enhancePage(artist, pal, data);
    });
  };

  // ── apSetDiscView override ────────────────────────────────────────────────

  window.apSetDiscView = function (mode) {
    var disc    = document.getElementById('ap-discography');
    var gridBtn = document.getElementById('ap-grid-btn');
    var listBtn = document.getElementById('ap-list-btn');
    var curArtist = (typeof activeArtistName !== 'undefined') ? activeArtistName : null;
    if (!disc || !curArtist) return;
    var st = sortTracks(curArtist, window._apCurrentSort || 'plays');
    var c  = playCounts();
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

  window._apSortChanged = function (val) {
    window._apCurrentSort = val;
    var disc = document.getElementById('ap-discography');
    var curArtist = (typeof activeArtistName !== 'undefined') ? activeArtistName : null;
    if (!disc || !curArtist) return;
    var st    = sortTracks(curArtist, val);
    var c     = playCounts();
    var isGrid = disc.classList.contains('ap-disc-grid');
    disc.innerHTML = isGrid ? renderGrid(st, c) : renderList(st, c);
  };

  window._apPlayAll = function () {
    var artist = (typeof activeArtistName !== 'undefined') ? activeArtistName : null;
    if (!artist) return;
    closeArtistPage();
    setTimeout(function() {
      try { activeFilter = artist; } catch(e) {}
      if (window.renderFilters) window.renderFilters();
      if (window.setView)       window.setView('tracks');
      setTimeout(function() {
        var pl = window.getPlaylist ? window.getPlaylist() : [];
        if (pl.length && window.playAtIndex) window.playAtIndex(0);
      }, 100);
    }, 200);
  };

  window._apShuffleAll = function () {
    var artist = (typeof activeArtistName !== 'undefined') ? activeArtistName : null;
    if (!artist) return;
    closeArtistPage();
    setTimeout(function() {
      try { activeFilter = artist; } catch(e) {}
      var sb = document.getElementById('shuffle-btn');
      if (sb && !sb.classList.contains('active')) sb.click();
      if (window.renderFilters) window.renderFilters();
      if (window.setView)       window.setView('tracks');
      setTimeout(function() {
        var pl = window.getPlaylist ? window.getPlaylist() : [];
        if (pl.length && window.playAtIndex)
          window.playAtIndex(Math.floor(Math.random() * pl.length));
      }, 100);
    }, 200);
  };

  // ── Delegated click listener ──────────────────────────────────────────────

  document.addEventListener('click', function(e) {
    var link = e.target.closest('.artist-link');
    if (!link || !link.dataset.artist) return;
    if (link.classList.contains('filter-btn')) return;
    openArtistPage(link.dataset.artist);
  });

  // ── Initialise on load ────────────────────────────────────────────────────

  function initAll() {
    ytPlayer.init();
  }

  if (document.readyState === 'complete') {
    initAll();
  } else {
    window.addEventListener('load', initAll);
  }

  console.log('[ArtistPage] v3.0 loaded — YouTube IFrame API integration');
}());
