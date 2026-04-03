// =============================================================
// vault.js — The Vault · all application logic
// Loaded by index.html via <script src="vault.js" defer>
// =============================================================
// ===== CONFIG =====
const ADMIN_PASSWORD = 'vault2024';

// ===== GITHUB CONFIG =====
// These are loaded from localStorage so you set them once in the GitHub Settings modal
// GUEST_REPO: set this once so guests can load tracks without a token
// Format: 'owner/repo' e.g. 'zenie1/the-vault'  — leave blank if not using GitHub
const GUEST_REPO = 'Zenie1/the-vault';
const GUEST_BRANCH = 'main';

function getGHConfig() {
  return {
    token: localStorage.getItem('vault-gh-token') || '',
    owner: localStorage.getItem('vault-gh-owner') || '',
    repo:  localStorage.getItem('vault-gh-repo')  || '',
    branch: localStorage.getItem('vault-gh-branch') || 'main',
  };
}
function ghConfigured() {
  const c = getGHConfig();
  return c.token && c.owner && c.repo;
}

// Derive public repo from admin config or GUEST_REPO constant
function getPublicRepo() {
  const c = getGHConfig();
  if (c.owner && c.repo) return { owner: c.owner, repo: c.repo, branch: c.branch || 'main' };
  if (GUEST_REPO) {
    const [owner, repo] = GUEST_REPO.split('/');
    return { owner, repo, branch: GUEST_BRANCH };
  }
  return null;
}

const ARTIST_COLORS = {
  'playboi carti': '#ff3c3c',
  'lil yachty': '#00e5ff',
  'young thug': '#9f3cff',
  'lucki': '#00ff9f',
  'nine vicious': '#ff9f00',
  'prettifun': '#ff3c9f',
  'slayr': '#c8ff00',
  'protect': '#3c9fff',
  'che': '#ff6b3c',
  'osamaon': '#c8ff3c',
};

function getArtistColor(artist) {
  const key = (artist || '').toLowerCase();
  for (const [k, v] of Object.entries(ARTIST_COLORS)) {
    if (key.includes(k)) return v;
  }
  const hash = [...(artist||'')].reduce((a, c) => a + c.charCodeAt(0), 0);
  const colors = Object.values(ARTIST_COLORS);
  return colors[hash % colors.length];
}

// ===== STORAGE — GitHub API + localStorage fallback =====
let ghFileSha = null; // tracks the SHA of tracks.json for updates

async function loadTracks() {
  // Always try GitHub first if configured
  if (ghConfigured()) {
    try {
      const c = getGHConfig();
      const res = await fetch(
        `https://api.github.com/repos/${c.owner}/${c.repo}/contents/tracks.json?ref=${c.branch}&t=${Date.now()}`,
        { headers: { 'Authorization': `token ${c.token}`, 'Accept': 'application/vnd.github.v3+json' } }
      );
      if (res.ok) {
        const data = await res.json();
        ghFileSha = data.sha;
        const decoded = JSON.parse(atob(data.content.replace(/\n/g,'')));
        localStorage.setItem('vault-tracks-v2', JSON.stringify(decoded));
        return decoded;
      }
      if (res.status === 404) { ghFileSha = null; return getLocalTracks(); }
    } catch(e) { console.warn('GitHub load failed, using localStorage', e); }
  } else {
    // Guest with no token — try public raw GitHub URL
    const pub = getPublicRepo();
    if (pub) {
      try {
        const res = await fetch(`https://raw.githubusercontent.com/${pub.owner}/${pub.repo}/${pub.branch}/tracks.json?t=${Date.now()}`);
        if (res.ok) {
          const decoded = await res.json();
          localStorage.setItem('vault-tracks-v2', JSON.stringify(decoded));
          return decoded;
        }
      } catch(e) { console.warn('Raw GitHub load failed', e); }
    }
  }
  return getLocalTracks();
}

const DEFAULT_TRACKS = [
  {"id":1775137273737,"added":"2026-04-02","artist":"Nine Vicious","title":"Are Yall Ready?","url":"https://res.cloudinary.com/dmpwlevyh/video/upload/v1775136335/Are_Yall_Ready.mp3_yy0dgv.mp3","tags":["unreleased"],"type":"url","coverArt":"https://t2.genius.com/unsafe/555x0/https%3A%2F%2Fimages.genius.com%2Fa5f070869e27e0a66883d40573f97ed9.1000x1000x1.png","canvas":"https://media1.tenor.com/m/fF6wOoVFpSUAAAAC/nine-vicious-nine.gif"},
  {"id":1775076734250,"added":"2026-04-01","artist":"Lil Uzi Vert","title":"Could've Died","url":"https://res.cloudinary.com/dmpwlevyh/video/upload/v1775076626/Could_ve_Died_a94c6g.m4a","tags":["leak"],"type":"cloudinary","coverArt":"https://t2.genius.com/unsafe/258x258/https%3A%2F%2Fimages.genius.com%2F879ad4ceab3005b6b4ee05016eb9e599.750x750x1.jpg","canvas":"https://media.giphy.com/media/v1.Y2lkPWVjZjA1ZTQ3NjdqejEwYjU4ZzQxaXF0cHlyOGlrMXl1dW5xY2t5dzRiaHlvcG83MCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/XA5RzQBQrOyvhjc4c5/giphy.gif","lyricsUrl":"https://genius.com/Lil-uzi-vert-couldve-died-lyrics"},
  {"id":1775076388042,"added":"2026-04-01","artist":"Ken Carson","title":"Peppermint","url":"https://res.cloudinary.com/dmpwlevyh/video/upload/v1775076230/ken_carson_-_peppermint_v1.0_mtrhlg.mp3","tags":["leak"],"type":"cloudinary","coverArt":"https://images.genius.com/75d88762f0f1310559fd62e835361502.1000x1000x1.jpg","canvas":"https://media.giphy.com/media/v1.Y2lkPWVjZjA1ZTQ3Mmc1b250cTZnY3UxY2Z6NGt4Z3gxbGx4Y2F6dmo3djZwcW9yMmdvNSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/wzuPeX8dnhvvp7KKxM/giphy.gif","lyricsUrl":"https://genius.com/Ken-carson-peppermint-lyrics"},
  {"id":1775076082107,"added":"2026-04-01","artist":"Destroy Lonely","title":"Over Dimes","url":"https://res.cloudinary.com/dmpwlevyh/video/upload/v1775075771/OVER_DIMES_rpz4nd.m4a","tags":["leak"],"type":"cloudinary","coverArt":"https://images.genius.com/b80f34d87cfcac2313bf4e0dc6aadc0b.1000x1000x1.jpg","canvas":"https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExOGo2aWJ4ZnIzbXdwcjg2NGR6MHBueXduZTJtdHEzZHB0dmt3ZWQwdiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/H4fV6T0bQJVnT8C5xW/giphy.gif","lyricsUrl":"https://genius.com/Destroy-lonely-over-dimes-lyrics"},
  {"id":1775075915243,"added":"2026-04-01","artist":"OsamaSon","title":"Smash","url":"https://res.cloudinary.com/dmpwlevyh/video/upload/v1775075771/smash_sclz57.m4a","tags":["leak"],"type":"cloudinary","coverArt":"https://t2.genius.com/unsafe/258x258/https%3A%2F%2Fimages.genius.com%2F94cf1b51ee3d32f120e5faaabca79228.960x960x1.jpg","canvas":"https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExZzNmZzkxYmx3djZ2YjdmNjd4ZjBkeWZieHBzdXNkdnQ0eWpjc25kbSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/Xm5pOQucNsDncerjUc/giphy.gif","lyricsUrl":"https://genius.com/Osamason-smash-lyrics"},
  {"id":1775074985455,"added":"2026-04-01","artist":"1oneam","title":"Twin Flame","url":"https://res.cloudinary.com/dmpwlevyh/video/upload/v1775073823/1oneam_-_Twin_Flame_prod._tdf_wkdhro.mp3","tags":["leak"],"type":"cloudinary","coverArt":"https://t2.genius.com/unsafe/258x258/https%3A%2F%2Fimages.genius.com%2F4cebd096ef9527a7dc79498de485df92.500x500x1.jpg","canvas":"https://media1.tenor.com/m/Qy9vAdfd7FwAAAAd/1oneam.gif"},
  {"id":1775074343162,"added":"2026-04-01","artist":"Playboi Carti","title":"I Promise You","url":"https://res.cloudinary.com/dmpwlevyh/video/upload/v1775073821/13._i_promise_you_enxouv.mp3","tags":["leak"],"type":"cloudinary","coverArt":"https://t2.genius.com/unsafe/258x258/https%3A%2F%2Fimages.genius.com%2Fd7631f044b81be6b0884cec8e0a3e53b.500x500x1.jpg","canvas":"https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExanllOGN3bnBlcm8zb3MzaTQxM2k2NHJlcWx5c3VqNXlyMzUyeTh1eCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/iKWCtb7guLOX4srjFC/giphy.gif","lyricsUrl":"https://genius.com/Playboi-carti-i-promise-u-lyrics"},
  {"id":1775065451871,"added":"2026-04-01","artist":"Che","title":"White Folks","url":"https://res.cloudinary.com/dmpwlevyh/video/upload/v1775065294/White_Folk_b390op.mp3","tags":["unreleased"],"type":"cloudinary","coverArt":"https://images.genius.com/4896064b9d3b479cae8a43306918c880.1000x1000x1.png","canvas":"https://media1.tenor.com/m/YriWNnhwbJQAAAAC/che-sayso-says.gif","lyricsUrl":"https://genius.com/Che-white-folk-lyrics"},
  {"id":1775054388929,"added":"2026-04-01","artist":"Nine Vicious","title":"Friday","url":"https://res.cloudinary.com/dmpwlevyh/video/upload/v1775050943/Friday_benjicold_patrick_bella.mp3_ms96b4.mp3","tags":["unreleased"],"type":"cloudinary","coverArt":"https://images.genius.com/516736724907f222aa0ec369d76e0410.1000x1000x1.jpg","canvas":"https://media1.tenor.com/m/pg72pNFkKDMAAAAd/nine-vicious-for-nothing.gif","lyricsUrl":"https://genius.com/Nine-vicious-friday-lyrics"},
  {"id":1774999043975,"added":"2026-03-31","artist":"Prettifun","title":"Dead","url":"https://res.cloudinary.com/dmpwlevyh/video/upload/v1774978649/Dead_prod_Ginseng_qy0b7r.mp3","tags":["leak"],"type":"cloudinary","coverArt":"https://t2.genius.com/unsafe/258x258/https%3A%2F%2Fimages.genius.com%2Fc1fdcb43f47e4fd6a3fae201d03701fa.999x1000x1.png","canvas":"https://media1.tenor.com/m/33g97YilvJ8AAAAC/light-pretti.gif","lyricsUrl":"https://genius.com/Prettifun-dead-lyrics"}
];

function getLocalTracks() {
  try {
    const s = localStorage.getItem('vault-tracks-v2');
    return s ? JSON.parse(s) : DEFAULT_TRACKS;
  } catch { return DEFAULT_TRACKS; }
}

async function saveTracks(t) {
  // Strip base64 file data URLs before saving — they're too large for GitHub
  // and file tracks only work locally anyway
  const forGithub = t.map(track => {
    if (track.type === 'file' && track.url && track.url.startsWith('data:')) {
      return { ...track, url: '', _localOnly: true };
    }
    return track;
  });

  // Always save full version (with data URLs) to localStorage
  try { localStorage.setItem('vault-tracks-v2', JSON.stringify(t)); } catch(e) {}

  if (!ghConfigured()) {
    showToast('SAVED LOCALLY — SET UP GITHUB TO PERSIST', 'error');
    return;
  }

  const c = getGHConfig();
  let content;
  try {
    // Use TextEncoder for safe base64 encoding (handles all Unicode)
    const json = JSON.stringify(forGithub, null, 2);
    const bytes = new TextEncoder().encode(json);
    const binStr = Array.from(bytes).map(b => String.fromCharCode(b)).join('');
    content = btoa(binStr);
  } catch(e) {
    console.error('Encoding error', e);
    showToast('ENCODING ERROR — SAVED LOCALLY ONLY', 'error');
    return;
  }

  const body = {
    message: `vault: update tracks.json [${new Date().toISOString().split('T')[0]}]`,
    content,
    branch: c.branch,
  };
  if (ghFileSha) body.sha = ghFileSha;

  try {
    showToast('SAVING TO GITHUB…', '');
    const res = await fetch(
      `https://api.github.com/repos/${c.owner}/${c.repo}/contents/tracks.json`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `token ${c.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (res.ok) {
      const data = await res.json();
      ghFileSha = data.content.sha;
      showToast('SAVED TO GITHUB ✓', 'success');
    } else {
      const err = await res.json();
      console.error('GitHub save error', err);
      const reason = err.message || 'unknown error';
      showToast(`GITHUB SAVE FAILED: ${reason.slice(0,40).toUpperCase()}`, 'error');
    }
  } catch(e) {
    console.error(e);
    showToast('NETWORK ERROR — SAVED LOCALLY ONLY', 'error');
  }
}

// ===== ADMIN =====
let isAdmin = false;
function setAdmin(val) {
  isAdmin = val;
  const badge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const addBtn = document.getElementById('add-btn');
  const gdriveBtn = document.getElementById('gdrive-btn');
  const loginBtn = document.getElementById('login-btn');
  if (val) {
    badge.className = 'status-badge admin';
    statusText.textContent = 'ADMIN';
    addBtn.style.display = 'flex';
    gdriveBtn.style.display = 'flex';
    document.getElementById('gh-settings-btn').style.display = 'flex';
    loginBtn.textContent = '⚿ Logout';
    document.body.classList.add('admin-mode');
  } else {
    badge.className = 'status-badge guest';
    statusText.textContent = 'GUEST';
    addBtn.style.display = 'none';
    gdriveBtn.style.display = 'none';
    document.getElementById('gh-settings-btn').style.display = 'none';
    loginBtn.textContent = '⚿ Admin';
    document.body.classList.remove('admin-mode');
  }
  renderTracks();
}

// ===== STATE =====
let tracks = [], activeFilter = 'all', searchQuery = '';
let currentTrackIdx = -1, isPlaying = false;
let uploadedFile = null, uploadedDataUrl = null, activeTab = 'link';

function getPlaylist() { return getFiltered(); }
function getFilteredAll() { return getFiltered(); }

function getFiltered() {
  return tracks.filter(t => {
    const matchFilter = activeFilter === 'all' || t.artist === activeFilter;
    const q = searchQuery.toLowerCase();
    const matchSearch = !q ||
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      (t.tags||[]).some(tag => tag.toLowerCase().includes(q));
    return matchFilter && matchSearch;
  });
}

function getArtists() {
  const seen = new Set();
  return tracks.filter(t => { if(seen.has(t.artist)) return false; seen.add(t.artist); return true; }).map(t=>t.artist);
}

// ===== RENDER =====
function renderFilters() {
  const fb = document.getElementById('filter-btns');
  fb.innerHTML = `<button class="filter-btn ${activeFilter==='all'?'active':''}" data-filter="all">ALL</button>`;
  getArtists().forEach(a => {
    const b = document.createElement('button');
    b.className = 'filter-btn' + (activeFilter===a?' active':'');
    b.dataset.filter = a;
    b.textContent = a.toUpperCase().slice(0,14);
    b.style.color = getArtistColor(a);
    fb.appendChild(b);
  });
  fb.querySelectorAll('.filter-btn').forEach(b => {
    b.addEventListener('click', () => {
      activeFilter = b.dataset.filter;
      fb.querySelectorAll('.filter-btn').forEach(x => x.classList.toggle('active', x.dataset.filter===activeFilter));
      if (activeFilter !== 'all') { setArtistBG(activeFilter); showArtistHeader(activeFilter); }
      else { setDefaultBG(); hideArtistHeader(); }
      renderTracks();
    });
  });
}

function renderTracks() {
  const grid = document.getElementById('tracks-grid');
  const list = getFiltered();
  const label = document.getElementById('section-label');
  label.textContent = activeFilter === 'all' ? `ALL TRACKS — ${list.length}` : `${activeFilter.toUpperCase()} — ${list.length} TRACKS`;

  if (!list.length) {
    grid.innerHTML = '<div class="empty-state"><span class="big">VOID</span>NO TRACKS FOUND</div>';
    return;
  }

  const playlist = getPlaylist();
  grid.innerHTML = list.map((t, idx) => {
    const color = getArtistColor(t.artist);
    const tags = (t.tags||[]).map(tag=>`<span class="tag">${tag}</span>`).join('');
    const hasAudio = !!t.url;
    const pIdx = playlist.findIndex(x=>x.id===t.id);
    const isCurrentlyPlaying = currentTrackIdx === pIdx && isPlaying;
    const sourceBadge = t.type === 'cloudinary' ? `<span class="source-badge cloudinary">☁ CDN</span>` : t.type === 'file' ? `<span class="source-badge file">📁 LOCAL</span>` : '';
    const coverSrc = t.coverArt || '';
    return `
      <div class="track-card${isCurrentlyPlaying?' playing':''}" style="--artist-color:${color}" data-id="${t.id}">
        <div class="track-card-top">
          ${coverSrc ? `<img class="track-cover loaded" src="${coverSrc}" alt="cover" loading="lazy">` : `<img class="track-cover" src="" data-fetch-cover="${t.id}" alt="cover">`}
          <div class="track-card-meta">
            <div class="track-artist">${t.artist}${sourceBadge}</div>
            <div class="track-title">${t.title}</div>
          </div>
        </div>
        <div class="track-bottom">
          <div class="track-tags">${tags}</div>
          <div class="track-actions">
            ${hasAudio ? `<button class="icon-btn play-btn${isCurrentlyPlaying?' active':''}" onclick="handlePlay(${t.id})" title="${isCurrentlyPlaying?'Pause':'Play'}">${isCurrentlyPlaying?'⏸':'▶'}</button>` : ''}
            ${t.url && t.type!=='file' ? `<button class="icon-btn" title="Download" style="color:var(--muted)" onclick="downloadTrack(${t.id})">↓</button>` : ''}
            <button class="icon-btn" onclick="copyLink(${t.id})" title="Copy">⟁</button>
            <button class="icon-btn edit-btn" onclick="openEditModal(${t.id})" title="Edit">✎</button>
            <button class="icon-btn delete-btn" onclick="deleteTrack(${t.id})" title="Delete">✕</button>
          </div>
        </div>
        ${t.added ? `<div class="track-date">${formatDate(t.added)}</div>` : ''}
      </div>`;
  }).join('');

  // Lazy-fetch cover art for cards that don't have it cached yet
  grid.querySelectorAll('[data-fetch-cover]').forEach(img => {
    const id = parseInt(img.dataset.fetchCover);
    const t = tracks.find(x => x.id === id);
    if (!t) return;
    fetchCoverArt(t.artist, t.title).then(url => {
      if (url) {
        img.src = url;
        img.onload = () => img.classList.add('loaded');
        t.coverArt = url; // cache in-memory for session
      }
    });
  });
}

function showArtistHeader(artist) {
  const color = getArtistColor(artist);
  document.getElementById('artist-header').classList.add('visible');
  document.getElementById('artist-header').style.setProperty('--artist-glow', hexToRgba(color, 0.08));
  const avatar = document.getElementById('artist-avatar');
  avatar.style.color = color;
  avatar.style.borderColor = color;
  avatar.textContent = artist.slice(0,2).toUpperCase();
  const nameEl = document.getElementById('artist-name-display');
  nameEl.textContent = artist.toUpperCase();
  nameEl.style.color = color;
  const count = tracks.filter(t=>t.artist===artist).length;
  document.getElementById('artist-track-count').textContent = `${count} TRACK${count!==1?'S':''} IN VAULT`;
}
function hideArtistHeader() { document.getElementById('artist-header').classList.remove('visible'); }

function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}

// ===== PLAYER =====
const audio = document.getElementById('audio-player');
const playerBar = document.getElementById('player-bar');

// CORS FIX: must be set ONCE before any src is ever assigned.
// This makes the browser send CORS headers on every audio request,
// which Cloudinary supports. Without this, the Web Audio API (AudioContext)
// will refuse to process the stream even if playback itself works.
audio.crossOrigin = 'anonymous';

function handlePlay(id) {
  const playlist = getPlaylist();
  const idx = playlist.findIndex(t=>t.id===id);
  if (idx === -1) return;
  if (currentTrackIdx === idx && isPlaying) {
    audio.pause(); isPlaying = false;
    const ppBtn = document.getElementById('play-pause-btn');
    ppBtn.innerHTML = '▶';
    ppBtn.classList.remove('is-playing');
    document.getElementById('player-vinyl').classList.remove('spinning');
    stopWaveform();
  } else {
    playAtIndex(idx);
  }
  renderTracks();
}

function playAtIndex(idx) {
  const playlist = getPlaylist();
  if (idx < 0 || idx >= playlist.length) return;
  const t = playlist[idx];
  if (!t.url) { showToast('NO AUDIO SOURCE — ADD A URL OR FILE', 'error'); return; }
  currentTrackIdx = idx;

  // crossOrigin is already set to 'anonymous' at init time (above).
  // We just assign src and play — no retry needed.
  audio.src = t.url;
  audio.load();
  audio.volume = parseFloat(document.getElementById('volume-slider').value);

  const playPromise = audio.play();
  if (playPromise !== undefined) {
    playPromise.catch(err => {
      showToast('CANNOT PLAY — CHECK AUDIO SOURCE', 'error');
      isPlaying = false;
      document.getElementById('play-pause-btn').innerHTML = '▶';
      document.getElementById('play-pause-btn').classList.remove('is-playing');
      document.getElementById('player-vinyl').classList.remove('spinning');
    });
  }
  isPlaying = true;

  const color = getArtistColor(t.artist);
  document.getElementById('player-bar').style.setProperty('--current-color', color);
  document.getElementById('player-title').textContent = t.title;
  document.getElementById('player-artist').textContent = t.artist.toUpperCase();
  const ppBtn = document.getElementById('play-pause-btn');
  ppBtn.innerHTML = '⏸';
  ppBtn.classList.add('is-playing');
  ppBtn.style.background = color;
  document.getElementById('player-vinyl').classList.add('spinning');
  playerBar.classList.add('visible');
  setArtistBG(t.artist);
  showCanvas(t); // ◈ Vault Canvas
  maybeFetchLyrics(t); // ♩ Lyrics

  // Load cover art into vinyl
  const vinylImg = document.getElementById('player-cover-img');
  vinylImg.classList.remove('loaded');
  if (t.coverArt) {
    vinylImg.src = t.coverArt;
    vinylImg.onload = () => vinylImg.classList.add('loaded');
    updateVinylCard(t, t.coverArt);
  } else {
    updateVinylCard(t, null);
    fetchCoverArt(t.artist, t.title).then(url => {
      if (url) {
        t.coverArt = url;
        vinylImg.src = url;
        vinylImg.onload = () => vinylImg.classList.add('loaded');
        updateVinylCard(t, url);
      }
    });
  }

  renderTracks();
  updateLikeBtn();
}

document.getElementById('play-pause-btn').addEventListener('click', () => {
  if (!audio.src) return;
  const ppBtn = document.getElementById('play-pause-btn');
  if (isPlaying) {
    audio.pause(); isPlaying = false;
    ppBtn.innerHTML = '▶'; ppBtn.classList.remove('is-playing');
    document.getElementById('player-vinyl').classList.remove('spinning');
    stopWaveform();
    hideCanvas();
  } else {
    audio.play(); isPlaying = true;
    ppBtn.innerHTML = '⏸'; ppBtn.classList.add('is-playing');
    document.getElementById('player-vinyl').classList.add('spinning');
    // startWaveform fires via 'playing' event
  }
  renderTracks();
});

document.getElementById('prev-btn').addEventListener('click', () => {
  const playlist = getPlaylist();
  if (playlist.length === 0) return;
  const newIdx = isShuffled
    ? Math.floor(Math.random() * playlist.length)
    : (currentTrackIdx <= 0 ? playlist.length - 1 : currentTrackIdx - 1);
  playAtIndex(newIdx);
});
document.getElementById('next-btn').addEventListener('click', () => {
  const playlist = getPlaylist();
  if (playlist.length === 0) return;
  const newIdx = isShuffled
    ? Math.floor(Math.random() * playlist.length)
    : (currentTrackIdx >= playlist.length - 1 ? 0 : currentTrackIdx + 1);
  playAtIndex(newIdx);
});

audio.addEventListener('ended', () => {
  if (isLooping) return; // audio.loop handles it
  const playlist = getPlaylist();
  const newIdx = isShuffled
    ? Math.floor(Math.random() * playlist.length)
    : (currentTrackIdx >= playlist.length - 1 ? 0 : currentTrackIdx + 1);
  playAtIndex(newIdx);
});

// ===== WAVEFORM VISUALIZER (live frequency-reactive) =====
const waveCanvas = document.getElementById('waveform-canvas');
const waveCtx = waveCanvas.getContext('2d');
let analyser, sourceNode, audioCtx, freqData, waveAnimFrame;
let smoothedBars = [];

function setupAudioContext() {
  if (audioCtx && sourceNode) return; // already wired up — do nothing
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.7;
    freqData = new Uint8Array(analyser.frequencyBinCount);
    // Only create the source node once — recreating it after audio plays taints the element
    if (!sourceNode) {
      sourceNode = audioCtx.createMediaElementSource(audio);
    }
    sourceNode.connect(analyser);
    analyser.connect(audioCtx.destination);
  } catch(e) {
    // If Web Audio setup fails entirely, waveform won't animate but audio still plays
    console.warn('Web Audio setup failed:', e);
    audioCtx = null; sourceNode = null; analyser = null;
  }
}

function resizeWaveCanvas() {
  const dpr = window.devicePixelRatio || 1;
  waveCanvas.width  = waveCanvas.offsetWidth  * dpr;
  waveCanvas.height = waveCanvas.offsetHeight * dpr;
  waveCtx.scale(dpr, dpr);
}

function drawWaveform() {
  const W = waveCanvas.offsetWidth;
  const H = waveCanvas.offsetHeight;
  waveCtx.clearRect(0, 0, W, H);

  const rawColor = getComputedStyle(document.getElementById('player-bar'))
    .getPropertyValue('--current-color').trim() || '#c8ff00';
  // Use scrub position while dragging, else actual playback position
  const progress = isScrubbing ? scrubProgress : (audio.duration ? audio.currentTime / audio.duration : 0);

  // Pull live freq data
  const BAR_COUNT = 60;
  if (analyser && isPlaying) {
    analyser.getByteFrequencyData(freqData);
    if (smoothedBars.length !== BAR_COUNT)
      smoothedBars = new Array(BAR_COUNT).fill(0);

    // Non-linear freq mapping: expand bass end, squash highs
    // So bars 0–20 cover sub/bass (808s, kicks) instead of being 2 tiny bins
    const binCount = freqData.length; // 128 bins
    for (let i = 0; i < BAR_COUNT; i++) {
      const t = i / BAR_COUNT;
      const binIdx = Math.floor(Math.pow(t, 1.8) * binCount);
      const binStart = Math.max(0, binIdx - 1);
      const binEnd   = Math.min(binCount - 1, binIdx + 1);
      let sum = 0;
      for (let b = binStart; b <= binEnd; b++) sum += freqData[b] || 0;
      let target = sum / (binEnd - binStart + 1);

      // Boost sub-bass (bars 0–7 = 808/kick range) — really punch through
      if (i < 8)       target = Math.min(255, target * 2.4);
      // Boost bass/low-mid (bars 8–20)
      else if (i < 20) target = Math.min(255, target * 1.5);

      smoothedBars[i] = smoothedBars[i] < target
        ? smoothedBars[i] * 0.3 + target * 0.7   // fast attack
        : smoothedBars[i] * 0.78 + target * 0.22; // decay
    }
  } else if (!smoothedBars.length) {
    smoothedBars = new Array(BAR_COUNT).fill(8);
  }

  if (waveformStyle === 'line') {
    // ── WhatsApp-style smooth line waveform ──
    const midY = H / 2;
    const playheadX = progress * W;

    // Draw played portion (full color) and unplayed (dim) as two separate paths
    for (let pass = 0; pass < 2; pass++) {
      const isPastPass = pass === 0;
      waveCtx.save();
      // Clip to played or unplayed region
      waveCtx.beginPath();
      if (isPastPass) {
        waveCtx.rect(0, 0, playheadX, H);
      } else {
        waveCtx.rect(playheadX, 0, W - playheadX, H);
      }
      waveCtx.clip();

      // Upper line
      waveCtx.beginPath();
      for (let i = 0; i < BAR_COUNT; i++) {
        const x = (i / (BAR_COUNT - 1)) * W;
        const amp = (smoothedBars[i] / 255) * (H * 0.44);
        const y = midY - Math.max(2, amp);
        if (i === 0) waveCtx.moveTo(x, y);
        else waveCtx.lineTo(x, y);
      }
      // Lower line (mirror, drawn back)
      for (let i = BAR_COUNT - 1; i >= 0; i--) {
        const x = (i / (BAR_COUNT - 1)) * W;
        const amp = (smoothedBars[i] / 255) * (H * 0.44);
        const y = midY + Math.max(2, amp);
        waveCtx.lineTo(x, y);
      }
      waveCtx.closePath();

      if (isPastPass) {
        const grad = waveCtx.createLinearGradient(0, 0, playheadX, 0);
        grad.addColorStop(0, rawColor + 'cc');
        grad.addColorStop(1, rawColor);
        waveCtx.fillStyle = grad;
        waveCtx.globalAlpha = 0.9;
      } else {
        waveCtx.fillStyle = rawColor;
        waveCtx.globalAlpha = 0.18;
      }
      waveCtx.fill();

      // Stroke the outline for crispness
      waveCtx.beginPath();
      for (let i = 0; i < BAR_COUNT; i++) {
        const x = (i / (BAR_COUNT - 1)) * W;
        const amp = (smoothedBars[i] / 255) * (H * 0.44);
        const y = midY - Math.max(2, amp);
        if (i === 0) waveCtx.moveTo(x, y);
        else waveCtx.lineTo(x, y);
      }
      waveCtx.strokeStyle = isPastPass ? rawColor : rawColor + '44';
      waveCtx.lineWidth = 1.5;
      waveCtx.globalAlpha = isPastPass ? 1 : 0.4;
      waveCtx.stroke();

      waveCtx.beginPath();
      for (let i = 0; i < BAR_COUNT; i++) {
        const x = (i / (BAR_COUNT - 1)) * W;
        const amp = (smoothedBars[i] / 255) * (H * 0.44);
        const y = midY + Math.max(2, amp);
        if (i === 0) waveCtx.moveTo(x, y);
        else waveCtx.lineTo(x, y);
      }
      waveCtx.stroke();

      waveCtx.restore();
    }

    // Playhead line
    waveCtx.globalAlpha = 0.9;
    waveCtx.beginPath();
    waveCtx.moveTo(playheadX, 4);
    waveCtx.lineTo(playheadX, H - 4);
    waveCtx.strokeStyle = rawColor;
    waveCtx.lineWidth = 2;
    waveCtx.stroke();

    // Playhead dot
    waveCtx.beginPath();
    waveCtx.arc(playheadX, midY, 4, 0, Math.PI * 2);
    waveCtx.fillStyle = rawColor;
    waveCtx.globalAlpha = 1;
    waveCtx.fill();

  } else {
    // ── Original bar waveform ──
    const gap = 2.5;
    const barW = (W - gap * (BAR_COUNT - 1)) / BAR_COUNT;

    for (let i = 0; i < BAR_COUNT; i++) {
      const barProgress = i / BAR_COUNT;
      const rawH = (smoothedBars[i] / 255) * H;
      const barH = Math.max(3, rawH);
      const x = i * (barW + gap);
      const y = (H - barH) / 2;

      const isPast = barProgress <= progress;
      waveCtx.globalAlpha = isPast ? 0.92 : 0.18;

      if (isPast) {
        const grad = waveCtx.createLinearGradient(x, y + barH, x, y);
        grad.addColorStop(0, rawColor + '99');
        grad.addColorStop(1, rawColor);
        waveCtx.fillStyle = grad;
      } else {
        waveCtx.fillStyle = rawColor;
      }

      const r = Math.min(barW / 2, 2);
      waveCtx.beginPath();
      waveCtx.roundRect
        ? waveCtx.roundRect(x, y, Math.max(1, barW), barH, r)
        : waveCtx.rect(x, y, Math.max(1, barW), barH);
      waveCtx.fill();
    }
    waveCtx.globalAlpha = 1;

    // Playhead dot
    const px = progress * W;
    waveCtx.beginPath();
    waveCtx.arc(px, H / 2, 3.5, 0, Math.PI * 2);
    waveCtx.fillStyle = rawColor;
    waveCtx.globalAlpha = 0.95;
    waveCtx.fill();
    waveCtx.globalAlpha = 1;
  }

  waveAnimFrame = requestAnimationFrame(drawWaveform);
}

function startWaveform() {
  try {
    setupAudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch(e) {}
  if (waveAnimFrame) cancelAnimationFrame(waveAnimFrame);
  resizeWaveCanvas();
  waveCanvas.classList.remove('paused');
  if (!smoothedBars.length) smoothedBars = new Array(60).fill(0).map(() => Math.random() * 20 + 5);
  drawWaveform();
  startSubwoofer();
}

function stopWaveform() {
  // Don't kill the animation frame — keep drawing so bars animate down to flat
  waveCanvas.classList.add('paused');
  // Drive bars to a low flat resting state
  const flatTarget = 6;
  smoothedBars = smoothedBars.map(() => flatTarget);
}

// ===== SUBWOOFER BASS ANIMATION =====
let bassAnimFrame = null;
let smoothBass = 0;

const subSurround = document.getElementById('sub-surround');
const subCone     = document.getElementById('sub-cone');
const subDustcap  = document.getElementById('sub-dustcap');
const subGlow     = document.getElementById('sub-glow');

function getBassPower() {
  if (!analyser || !freqData) return 0;
  analyser.getByteFrequencyData(freqData);
  // bins 0-6 cover ~20-250hz depending on fftSize 512 & 44.1kHz sample rate
  let sum = 0;
  const bins = Math.min(12, freqData.length); // more bins with fftSize 512
  for (let i = 0; i < bins; i++) sum += freqData[i];
  return sum / bins / 255; // 0..1
}

function animateSub() {
  bassAnimFrame = requestAnimationFrame(animateSub);

  const color = getComputedStyle(document.getElementById('player-bar'))
    .getPropertyValue('--current-color').trim() || '#c8ff00';

  // get raw bass 0..1
  const raw = isPlaying ? getBassPower() : 0;

  // smooth: fast attack, slow decay
  smoothBass = raw > smoothBass
    ? smoothBass * 0.25 + raw * 0.75
    : smoothBass * 0.88 + raw * 0.12;

  const b = smoothBass; // 0..1

  // --- Surround ring ---
  // radius breathes between 21 and 24 (resting = 22)
  const surroundR = 22 - b * 3.5;
  // stroke width pulses 3 -> 5
  const surroundSW = 3 + b * 2.5;
  // opacity
  const surroundOpacity = 0.25 + b * 0.65;

  subSurround.setAttribute('r', surroundR.toFixed(2));
  subSurround.setAttribute('stroke-width', surroundSW.toFixed(2));
  subSurround.setAttribute('stroke', color);
  subSurround.setAttribute('opacity', surroundOpacity.toFixed(3));

  // --- Cone ring ---
  const coneR = 16 - b * 2.5;
  subCone.setAttribute('r', coneR.toFixed(2));
  subCone.setAttribute('stroke', color);
  subCone.setAttribute('opacity', (0.15 + b * 0.45).toFixed(3));

  // --- Dust cap ---
  // pushes inward (radius shrinks as cone moves forward)
  const capR = 8 - b * 2.8;
  const capFill = b > 0.08 ? color : 'rgba(255,255,255,0.06)';
  const capOpacity = 0.18 + b * 0.72;
  subDustcap.setAttribute('r', Math.max(3, capR).toFixed(2));
  subDustcap.setAttribute('fill', capFill);
  subDustcap.setAttribute('stroke', color);
  subDustcap.setAttribute('opacity', capOpacity.toFixed(3));

  // --- Glow bloom ---
  const glowR = 22 + b * 10;
  const glowOpacity = b * 0.18;
  subGlow.setAttribute('r', glowR.toFixed(2));
  subGlow.setAttribute('fill', color);
  subGlow.setAttribute('opacity', glowOpacity.toFixed(3));
}

function startSubwoofer() {
  if (bassAnimFrame) cancelAnimationFrame(bassAnimFrame);
  animateSub();
}

function stopSubwoofer() {
  // let it decay naturally via smoothBass draining to 0
}


// ===== WAVEFORM SCRUB — drag to seek with tooltip =====
let isScrubbing = false;
let scrubProgress = 0;

const scrubTooltip = document.getElementById('scrub-tooltip');

function getScrubPos(e) {
  const rect = waveCanvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}

function showScrubTooltip(pos, e) {
  if (!audio.duration) return;
  const time = pos * audio.duration;
  scrubTooltip.textContent = fmt(time);
  const rect = waveCanvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  scrubTooltip.style.left = (clientX - rect.left) + 'px';
  scrubTooltip.classList.add('visible');
}

waveCanvas.addEventListener('mousedown', (e) => {
  if (!audio.duration) return;
  isScrubbing = true;
  scrubProgress = getScrubPos(e);
  showScrubTooltip(scrubProgress, e);
  waveCanvas.style.cursor = 'grabbing';
});

// Touch support for mobile scrubbing
waveCanvas.addEventListener('touchstart', (e) => {
  if (!audio.duration) return;
  e.preventDefault();
  isScrubbing = true;
  scrubProgress = getScrubPos(e);
  showScrubTooltip(scrubProgress, e);
}, { passive: false });

waveCanvas.addEventListener('touchmove', (e) => {
  if (!isScrubbing) return;
  e.preventDefault();
  scrubProgress = getScrubPos(e);
  showScrubTooltip(scrubProgress, e);
}, { passive: false });

waveCanvas.addEventListener('touchend', (e) => {
  if (!isScrubbing) return;
  isScrubbing = false;
  scrubTooltip.classList.remove('visible');
  if (audio.duration) audio.currentTime = scrubProgress * audio.duration;
});

window.addEventListener('mousemove', (e) => {
  if (!isScrubbing) {
    // Just hover — show tooltip
    if (audio.duration && waveCanvas.matches(':hover')) {
      showScrubTooltip(getScrubPos(e), e);
    }
    return;
  }
  scrubProgress = getScrubPos(e);
  showScrubTooltip(scrubProgress, e);
});

window.addEventListener('mouseup', (e) => {
  if (!isScrubbing) return;
  isScrubbing = false;
  waveCanvas.style.cursor = 'pointer';
  scrubTooltip.classList.remove('visible');
  if (audio.duration) audio.currentTime = getScrubPos(e) * audio.duration;
});

waveCanvas.addEventListener('mouseleave', () => {
  if (!isScrubbing) scrubTooltip.classList.remove('visible');
});

waveCanvas.addEventListener('click', (e) => {
  if (!audio.duration) return;
  audio.currentTime = getScrubPos(e) * audio.duration;
});

window.addEventListener('resize', resizeWaveCanvas);

// Start waveform only once audio is actually playing (avoids CORS race)
audio.addEventListener('playing', () => {
  startWaveform();
});

// If audio errors out, show a helpful toast
audio.addEventListener('error', (e) => {
  const codes = { 1:'ABORTED', 2:'NETWORK ERROR', 3:'DECODE ERROR', 4:'FORMAT NOT SUPPORTED' };
  const msg = codes[audio.error && audio.error.code] || 'UNKNOWN ERROR';
  showToast(`AUDIO ERROR: ${msg}`, 'error');
  isPlaying = false;
  document.getElementById('play-pause-btn').innerHTML = '▶';
  document.getElementById('play-pause-btn').classList.remove('is-playing');
  document.getElementById('player-vinyl').classList.remove('spinning');
  stopWaveform();
});

audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  document.getElementById('time-current').textContent = fmt(audio.currentTime);
  document.getElementById('time-total').textContent = fmt(audio.duration);
});

document.getElementById('volume-slider').addEventListener('input', (e) => {
  audio.volume = parseFloat(e.target.value);
  const icon = document.getElementById('vol-icon');
  icon.textContent = e.target.value == 0 ? '🔇' : e.target.value < 0.5 ? '🔉' : '🔊';
});

document.getElementById('vol-icon').addEventListener('click', () => {
  const slider = document.getElementById('volume-slider');
  if (audio.volume > 0) { audio.volume = 0; slider.value = 0; document.getElementById('vol-icon').textContent = '🔇'; }
  else { audio.volume = 0.8; slider.value = 0.8; document.getElementById('vol-icon').textContent = '🔊'; }
});

function fmt(s) {
  const m = Math.floor(s/60), sec = Math.floor(s%60);
  return `${m}:${sec.toString().padStart(2,'0')}`;
}

// ===== COVER ART (iTunes Search API — free, no key, CORS-open) =====
const coverArtCache = {};
async function fetchCoverArt(artist, title) {
  const key = `${artist}||${title}`.toLowerCase();
  if (coverArtCache[key] !== undefined) return coverArtCache[key];
  coverArtCache[key] = null; // mark as in-flight to avoid duplicate requests
  try {
    // Try artist + title first, fall back to artist-only
    const queries = [
      `${artist} ${title}`,
      artist,
    ];
    for (const q of queries) {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&limit=5&entity=song`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const result = data.results && data.results[0];
      if (result && result.artworkUrl100) {
        // Bump resolution from 100x100 to 600x600
        const art = result.artworkUrl100.replace('100x100bb', '600x600bb');
        coverArtCache[key] = art;
        return art;
      }
    }
  } catch(e) {}
  coverArtCache[key] = null;
  return null;
}

// ===== DOWNLOAD TRACK =====
async function downloadTrack(id) {
  const t = tracks.find(x => x.id === id);
  if (!t || !t.url) return;
  showToast('DOWNLOADING…', '');
  try {
    const res = await fetch(t.url);
    if (!res.ok) throw new Error('fetch failed');
    const blob = await res.blob();
    const ext = (t.url.split('?')[0].split('.').pop() || 'mp3').slice(0, 5);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${t.artist} - ${t.title}.${ext}`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    showToast('DOWNLOAD STARTED ✓', 'success');
  } catch(e) {
    // Fallback: direct link
    const a = document.createElement('a');
    a.href = t.url; a.download = `${t.artist} - ${t.title}`; a.target = '_self';
    document.body.appendChild(a); a.click(); a.remove();
  }
}

// ===== DELETE =====
function deleteTrack(id) {
  if (!isAdmin) return;
  if (!confirm('Remove this track from the vault?')) return;
  tracks = tracks.filter(t => t.id !== id);
  saveTracks(tracks); // async
  renderFilters();
  renderTracks();
  showToast('TRACK REMOVED', 'success');
}

// ===== EDIT TRACK =====
let editingTrackId = null;

function openEditModal(id) {
  if (!isAdmin) return;
  const t = tracks.find(x => x.id === id);
  if (!t) return;
  editingTrackId = id;

  document.getElementById('edit-artist').value  = t.artist  || '';
  document.getElementById('edit-title').value   = t.title   || '';
  document.getElementById('edit-url').value     = t.url     || '';
  document.getElementById('edit-tags').value    = (t.tags   || []).join(', ');
  document.getElementById('edit-cover').value   = t.coverArt || '';
  document.getElementById('edit-canvas').value  = t.canvas  || '';
  document.getElementById('edit-lyrics').value  = t.lyricsUrl || '';
  document.getElementById('edit-lrc').value     = t.lrcFile  || '';

  // Show cover preview if URL exists
  const preview = document.getElementById('edit-cover-preview');
  const previewImg = document.getElementById('edit-cover-preview-img');
  if (t.coverArt) {
    previewImg.src = t.coverArt;
    preview.classList.add('visible');
  } else {
    preview.classList.remove('visible');
  }

  // Clear old cover search results
  document.getElementById('edit-cover-results').innerHTML = '';
  document.getElementById('edit-cover-results').classList.remove('visible');

  openModal('edit-modal');
}

document.getElementById('edit-save-btn').addEventListener('click', async () => {
  if (!editingTrackId) return;
  const idx = tracks.findIndex(x => x.id === editingTrackId);
  if (idx === -1) return;

  const artist  = document.getElementById('edit-artist').value.trim();
  const title   = document.getElementById('edit-title').value.trim();
  const url     = document.getElementById('edit-url').value.trim();
  const tagsRaw = document.getElementById('edit-tags').value.trim();
  const cover   = document.getElementById('edit-cover').value.trim();
  const canvas  = document.getElementById('edit-canvas').value.trim();
  const lyricsUrl = document.getElementById('edit-lyrics').value.trim();
  const lrcFile   = document.getElementById('edit-lrc').value.trim();

  if (!artist || !title) { showToast('ARTIST AND TITLE REQUIRED', 'error'); return; }

  tracks[idx] = {
    ...tracks[idx],
    artist,
    title,
    url,
    tags: tagsRaw ? tagsRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
    coverArt: cover || null,
    canvas:   canvas || undefined,
    lyricsUrl: lyricsUrl || undefined,
    lrcFile:   lrcFile   || undefined,
    // re-detect type if URL changed
    type: url.includes('cloudinary.com') ? 'cloudinary' : (url.startsWith('data:') ? 'file' : 'url'),
  };
  // Clean up undefined keys
  if (!canvas)     delete tracks[idx].canvas;
  if (!lyricsUrl)  delete tracks[idx].lyricsUrl;
  if (!lrcFile)    delete tracks[idx].lrcFile;

  await saveTracks(tracks);
  // Bust the lyrics cache for this track so new lrcFile/lyricsUrl takes effect
  const cache = getLyricsCache();
  delete cache[editingTrackId];
  saveLyricsCache(cache);
  // If this track is currently loaded in the lyrics panel, reload it
  if (lyricsTrackId === editingTrackId) { lyricsTrackId = null; lyricsLines = []; }
  renderFilters();
  renderTracks();
  closeModal('edit-modal');
  showToast('TRACK UPDATED', 'success');
});

// Cover art search for edit modal
document.getElementById('edit-cover').addEventListener('change', () => {
  const v = document.getElementById('edit-cover').value.trim();
  if (v && /^https?:\/\//.test(v)) {
    const img = document.getElementById('edit-cover-preview-img');
    img.src = v;
    document.getElementById('edit-cover-preview').classList.add('visible');
  }
});
document.getElementById('edit-cover-clear-btn').addEventListener('click', () => {
  document.getElementById('edit-cover').value = '';
  document.getElementById('edit-cover-preview').classList.remove('visible');
  document.getElementById('edit-cover-results').querySelectorAll('.cover-option').forEach(o => o.classList.remove('selected'));
});
document.getElementById('edit-find-cover-btn').addEventListener('click', async () => {
  const artist = document.getElementById('edit-artist').value.trim();
  const title  = document.getElementById('edit-title').value.trim();
  if (!artist && !title) { showToast('ENTER ARTIST/TITLE FIRST', 'error'); return; }
  const btn = document.getElementById('edit-find-cover-btn');
  btn.disabled = true; btn.textContent = '…';
  const results = await searchCoverArt(`${artist} ${title}`);
  btn.disabled = false; btn.textContent = '🔍 Find Art';
  if (!results.length) { showToast('NO COVER ART FOUND', 'error'); return; }
  const resultsEl = document.getElementById('edit-cover-results');
  resultsEl.innerHTML = results.slice(0, 6).map(r =>
    `<img class="cover-option" src="${r.url}" data-url="${r.url}" title="${r.label}" loading="lazy">`
  ).join('');
  resultsEl.classList.add('visible');
  resultsEl.querySelectorAll('.cover-option').forEach(img => {
    img.addEventListener('click', () => {
      document.getElementById('edit-cover').value = img.dataset.url;
      document.getElementById('edit-cover-preview-img').src = img.dataset.url;
      document.getElementById('edit-cover-preview').classList.add('visible');
      resultsEl.querySelectorAll('.cover-option').forEach(o => o.classList.toggle('selected', o === img));
    });
  });
  // Auto-select first
  const first = results[0];
  document.getElementById('edit-cover').value = first.url;
  document.getElementById('edit-cover-preview-img').src = first.url;
  document.getElementById('edit-cover-preview').classList.add('visible');
});

// ===== COPY =====
function copyLink(id) {
  const t = tracks.find(x=>x.id===id);
  if (!t) return;
  navigator.clipboard.writeText(t.url || `${t.artist} - ${t.title}`)
    .then(()=>showToast('COPIED TO CLIPBOARD','success'))
    .catch(()=>showToast('COPY FAILED','error'));
}

// ===== SHARE =====
document.getElementById('share-btn').addEventListener('click', () => {
  navigator.clipboard.writeText(window.location.href)
    .then(()=>showToast('VAULT URL COPIED','success'))
    .catch(()=>showToast('COPY URL FROM BROWSER','error'));
});

// ===== LOGIN =====
document.getElementById('login-btn').addEventListener('click', () => {
  if (isAdmin) { setAdmin(false); showToast('LOGGED OUT', 'success'); return; }
  openModal('login-modal');
  setTimeout(()=>document.getElementById('admin-password').focus(), 100);
});
document.getElementById('login-submit-btn').addEventListener('click', doLogin);
document.getElementById('admin-password').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });

function doLogin() {
  const pw = document.getElementById('admin-password').value;
  const err = document.getElementById('login-error');
  if (pw === ADMIN_PASSWORD) {
    setAdmin(true);
    closeModal('login-modal');
    document.getElementById('admin-password').value = '';
    err.style.display = 'none';
    showToast('VAULT UNLOCKED — WELCOME BACK', 'success');
  } else {
    err.style.display = 'block';
    document.getElementById('admin-password').value = '';
    document.getElementById('admin-password').focus();
  }
}

document.getElementById('login-cancel-btn').addEventListener('click', () => { closeModal('login-modal'); document.getElementById('login-error').style.display='none'; });
document.getElementById('login-close').addEventListener('click', () => { closeModal('login-modal'); document.getElementById('login-error').style.display='none'; });

// ===== ADD TRACK MODAL =====
document.getElementById('add-btn').addEventListener('click', () => { if(isAdmin) openModal('modal'); });
document.getElementById('cancel-btn').addEventListener('click', () => closeModal('modal'));
document.getElementById('cancel-btn2').addEventListener('click', () => closeModal('modal'));

// Tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activeTab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab===activeTab));
    document.getElementById('tab-link').style.display = activeTab==='link' ? 'block' : 'none';
    document.getElementById('tab-cloudinary').style.display = activeTab==='cloudinary' ? 'block' : 'none';
    document.getElementById('tab-file').style.display = activeTab==='file' ? 'block' : 'none';
  });
});

// File upload
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f) handleFileSelect(f);
});
fileInput.addEventListener('change', e => { if(e.target.files[0]) handleFileSelect(e.target.files[0]); });

function handleFileSelect(file) {
  if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|m4a|flac)$/i.test(file.name)) {
    showToast('NOT AN AUDIO FILE', 'error'); return;
  }
  if (file.size > 50 * 1024 * 1024) {
    showToast('FILE TOO LARGE (MAX 50MB)', 'error'); return;
  }
  uploadedFile = file;
  const preview = document.getElementById('upload-preview');
  document.getElementById('upload-filename').textContent = file.name;
  document.getElementById('upload-size').textContent = (file.size / (1024*1024)).toFixed(2) + ' MB';
  preview.classList.add('visible');

  // Auto-fill title from filename
  const base = file.name.replace(/\.[^.]+$/,'');
  const titleField = document.getElementById('inp-title-f');
  if (!titleField.value) titleField.value = base;

  // Read as data URL
  const reader = new FileReader();
  reader.onload = e => { uploadedDataUrl = e.target.result; };
  reader.readAsDataURL(file);
}

document.getElementById('save-track-btn').addEventListener('click', () => {
  if (!isAdmin) return;
  if (activeTab === 'link') saveFromLink();
  else if (activeTab === 'cloudinary') saveFromCloudinary();
  else saveFromFile();
});

function saveFromCloudinary() {
  const artist = document.getElementById('inp-artist-c').value.trim();
  const title  = document.getElementById('inp-title-c').value.trim();
  const url    = document.getElementById('inp-url-c').value.trim();
  const tags   = document.getElementById('inp-tags-c').value.split(',').map(t=>t.trim()).filter(Boolean);
  const coverArt = getCoverCloudinary();
  const canvas = document.getElementById('inp-canvas-c').value.trim() || undefined;
  const lyricsUrl = document.getElementById('inp-lyrics-c').value.trim() || undefined;
  const lrcFile   = document.getElementById('inp-lrc-c').value.trim()   || undefined;
  if (!artist || !title) { showToast('ARTIST + TITLE REQUIRED', 'error'); return; }
  if (!url) { showToast('CLOUDINARY URL REQUIRED', 'error'); return; }
  if (!/cloudinary\.com/i.test(url) && !confirm('URL doesn\'t look like a Cloudinary link — add anyway?')) return;
  addTrack({ artist, title, url, tags, type:'cloudinary', coverArt: coverArt || undefined, canvas, lyricsUrl, lrcFile });
  // Clear cloudinary fields
  ['inp-artist-c','inp-title-c','inp-url-c','inp-tags-c','inp-cover-c','inp-canvas-c','inp-lyrics-c','inp-lrc-c'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('cover-preview-c').classList.remove('visible');
  document.getElementById('cover-results-c').classList.remove('visible');
}

function saveFromLink() {
  const artist = document.getElementById('inp-artist').value.trim();
  const title = document.getElementById('inp-title').value.trim();
  const url = document.getElementById('inp-url').value.trim();
  const tags = document.getElementById('inp-tags').value.split(',').map(t=>t.trim()).filter(Boolean);
  const coverArt = getCoverLink();
  const canvas = document.getElementById('inp-canvas').value.trim() || undefined;
  const lyricsUrl = document.getElementById('inp-lyrics').value.trim() || undefined;
  const lrcFile   = document.getElementById('inp-lrc').value.trim()   || undefined;
  if (!artist || !title) { showToast('ARTIST + TITLE REQUIRED', 'error'); return; }
  addTrack({ artist, title, url, tags, type:'url', coverArt: coverArt || undefined, canvas, lyricsUrl, lrcFile });
}

function saveFromFile() {
  const artist = document.getElementById('inp-artist-f').value.trim();
  const title = document.getElementById('inp-title-f').value.trim();
  const tags = document.getElementById('inp-tags-f').value.split(',').map(t=>t.trim()).filter(Boolean);
  const coverArt = getCoverFile();
  const canvas = document.getElementById('inp-canvas-f').value.trim() || undefined;
  const lyricsUrl = document.getElementById('inp-lyrics-f').value.trim() || undefined;
  const lrcFile   = document.getElementById('inp-lrc-f').value.trim()   || undefined;
  if (!artist || !title) { showToast('ARTIST + TITLE REQUIRED', 'error'); return; }
  if (!uploadedDataUrl) { showToast('NO FILE SELECTED', 'error'); return; }
  addTrack({ artist, title, url: uploadedDataUrl, tags, type:'file', coverArt: coverArt || undefined, canvas, lyricsUrl, lrcFile });
}

function addTrack(data) {
  const newTrack = { id:Date.now(), added: new Date().toISOString().split('T')[0], ...data };
  tracks.unshift(newTrack);
  saveTracks(tracks); // async — fires and continues
  renderFilters();
  renderTracks();
  // Reset
  ['inp-artist','inp-title','inp-url','inp-tags','inp-cover','inp-canvas','inp-lyrics','inp-lrc','inp-artist-f','inp-title-f','inp-tags-f','inp-cover-f','inp-canvas-f','inp-lyrics-f','inp-lrc-f','inp-artist-c','inp-title-c','inp-url-c','inp-tags-c','inp-cover-c','inp-canvas-c','inp-lyrics-c','inp-lrc-c'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  ['cover-preview','cover-preview-c','cover-preview-f','cover-results','cover-results-c','cover-results-f'].forEach(id => { const el=document.getElementById(id); if(el) el.classList.remove('visible'); });
  document.getElementById('upload-preview').classList.remove('visible');
  uploadedFile = null; uploadedDataUrl = null;
  closeModal('modal');
  showToast('TRACK ADDED TO THE VAULT', 'success');
}

// ===== GOOGLE DRIVE IMPORT =====
document.getElementById('gdrive-btn').addEventListener('click', () => { if(isAdmin) openModal('gdrive-modal'); });
document.getElementById('gdrive-close').addEventListener('click', () => closeModal('gdrive-modal'));
document.getElementById('gdrive-cancel').addEventListener('click', () => closeModal('gdrive-modal'));

document.getElementById('ai-sort-btn').addEventListener('click', async () => {
  if (!isAdmin) return;
  const filenames = document.getElementById('gdrive-filenames').value.trim();
  if (!filenames) { showToast('PASTE FILENAMES FIRST', 'error'); return; }

  const progress = document.getElementById('ai-progress');
  const output = document.getElementById('ai-sort-output');
  const resultsList = document.getElementById('ai-results-list');
  progress.classList.add('visible');
  output.classList.remove('visible');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: `You are a music archivist. Parse these audio filenames and extract metadata.
For each filename, determine: artist name, track title, and suggest 2-3 tags from this list: [unreleased, leak, snippet, demo, alternate, vault, live, remix, acapella, instrumental, underground, rare].

Return ONLY a JSON array, no other text:
[{"artist":"...", "title":"...", "tags":["...","..."]}]

Filenames:
${filenames}`
        }]
      })
    });
    const data = await response.json();
    let text = (data.content||[]).map(i=>i.text||'').join('');
    text = text.replace(/```json|```/g,'').trim();
    let parsed;
    try { parsed = JSON.parse(text); } catch { showToast('AI PARSE ERROR — TRY AGAIN','error'); progress.classList.remove('visible'); return; }

    progress.classList.remove('visible');
    resultsList.innerHTML = parsed.map((t,i) => `
      <div class="ai-track-row">
        <input type="checkbox" class="ai-check" data-idx="${i}" checked>
        <div class="atitle">${t.title}</div>
        <div class="aartist">${t.artist}</div>
        <div class="atags">${(t.tags||[]).map(tag=>`<span class="tag">${tag}</span>`).join('')}</div>
      </div>
    `).join('');
    output.classList.add('visible');
    output._parsed = parsed;
  } catch (err) {
    progress.classList.remove('visible');
    showToast('API ERROR — CHECK CONSOLE','error');
    console.error(err);
  }
});

document.getElementById('select-all-btn').addEventListener('click', () => {
  document.querySelectorAll('.ai-check').forEach(c => c.checked = true);
});

document.getElementById('import-selected-btn').addEventListener('click', () => {
  const output = document.getElementById('ai-sort-output');
  const parsed = output._parsed || [];
  const gdUrl = document.getElementById('gdrive-url').value.trim();
  let count = 0;
  document.querySelectorAll('.ai-check').forEach(c => {
    if (!c.checked) return;
    const t = parsed[parseInt(c.dataset.idx)];
    if (!t) return;
    tracks.unshift({ id: Date.now() + count, artist: t.artist, title: t.title, url: gdUrl, tags: t.tags||[], added: new Date().toISOString().split('T')[0], type:'url' });
    count++;
  });
  saveTracks(tracks);
  renderFilters();
  renderTracks();
  closeModal('gdrive-modal');
  showToast(`${count} TRACKS IMPORTED TO VAULT`, 'success');
  document.getElementById('ai-sort-output').classList.remove('visible');
  document.getElementById('gdrive-filenames').value = '';
});

// ===== BACK BUTTON =====
document.getElementById('back-btn').addEventListener('click', () => {
  activeFilter = 'all';
  renderFilters();
  hideArtistHeader();
  setDefaultBG();
  renderTracks();
});

// ===== SEARCH =====
document.getElementById('search-input').addEventListener('input', e => {
  searchQuery = e.target.value;
  renderTracks();
});

// ===== MODAL HELPERS =====
function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.getElementById(id).addEventListener('click', closeOnBg);
}
function closeModal(id) {
  const el = document.getElementById(id);
  el.classList.remove('open');
  el.removeEventListener('click', closeOnBg);
}
function closeOnBg(e) { if (e.target === e.currentTarget) closeModal(e.currentTarget.id); }

// ===== TOAST =====
function showToast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type?' '+type:'');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ===== ANIMATED BG =====
const canvas = document.getElementById('bg');
const ctx = canvas.getContext('2d');
let animFrame, particles = [];

function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }

function initParticles(color) {
  particles = [];
  for (let i = 0; i < 50; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      size: Math.random() * 1.5 + 0.5,
      alpha: Math.random() * 0.4 + 0.05,
      color
    });
  }
}

function drawBG(color) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Grid
  ctx.strokeStyle = `${color}10`;
  ctx.lineWidth = 0.5;
  const gs = 90;
  for (let x = 0; x < canvas.width; x += gs) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke(); }
  for (let y = 0; y < canvas.height; y += gs) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke(); }
  // Glow orbs
  const orbs = [{x:canvas.width*.15,y:canvas.height*.2,r:canvas.height*.3},{x:canvas.width*.85,y:canvas.height*.8,r:canvas.height*.25}];
  orbs.forEach(o => {
    const g = ctx.createRadialGradient(o.x,o.y,0,o.x,o.y,o.r);
    g.addColorStop(0, color+'0d');
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(o.x,o.y,o.r,0,Math.PI*2); ctx.fill();
  });
  // Particles
  particles.forEach(p => {
    p.x += p.vx; p.y += p.vy;
    if (p.x < 0) p.x = canvas.width; if (p.x > canvas.width) p.x = 0;
    if (p.y < 0) p.y = canvas.height; if (p.y > canvas.height) p.y = 0;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI*2);
    ctx.fillStyle = `${p.color}${Math.floor(p.alpha*255).toString(16).padStart(2,'0')}`;
    ctx.fill();
  });
  particles.forEach((p1,i) => {
    particles.slice(i+1).forEach(p2 => {
      const d = Math.hypot(p2.x-p1.x, p2.y-p1.y);
      if (d < 110) {
        ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y);
        ctx.strokeStyle = `${color}${Math.floor((1-d/110)*0.08*255).toString(16).padStart(2,'0')}`;
        ctx.lineWidth = 0.5; ctx.stroke();
      }
    });
  });
  animFrame = requestAnimationFrame(() => drawBG(color));
}

function setArtistBG(artist) {
  if (animFrame) cancelAnimationFrame(animFrame);
  const color = getArtistColor(artist);
  initParticles(color);
  drawBG(color);
}
function setDefaultBG() {
  if (animFrame) cancelAnimationFrame(animFrame);
  initParticles('#c8ff00');
  drawBG('#c8ff00');
}

// ===== GITHUB SETTINGS MODAL =====
document.getElementById('gh-settings-btn').addEventListener('click', () => {
  if (!isAdmin) return;
  const c = getGHConfig();
  document.getElementById('gh-token').value  = c.token;
  document.getElementById('gh-owner').value  = c.owner;
  document.getElementById('gh-repo').value   = c.repo;
  document.getElementById('gh-branch').value = c.branch || 'main';
  document.getElementById('gh-status').style.display = 'none';
  openModal('gh-modal');
});
document.getElementById('gh-modal-close').addEventListener('click', () => closeModal('gh-modal'));
document.getElementById('gh-cancel-btn').addEventListener('click',  () => closeModal('gh-modal'));

document.getElementById('gh-save-btn').addEventListener('click', async () => {
  const token  = document.getElementById('gh-token').value.trim();
  const owner  = document.getElementById('gh-owner').value.trim();
  const repo   = document.getElementById('gh-repo').value.trim();
  const branch = document.getElementById('gh-branch').value.trim() || 'main';
  const status = document.getElementById('gh-status');

  if (!token || !owner || !repo) {
    status.style.display = 'block';
    status.style.color = 'var(--accent3)';
    status.textContent = '✕ All fields required';
    return;
  }

  status.style.display = 'block';
  status.style.color = 'var(--muted2)';
  status.textContent = 'Testing connection…';

  // Test by fetching repo info
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!res.ok) throw new Error(`${res.status}`);

    // Save to localStorage
    localStorage.setItem('vault-gh-token',  token);
    localStorage.setItem('vault-gh-owner',  owner);
    localStorage.setItem('vault-gh-repo',   repo);
    localStorage.setItem('vault-gh-branch', branch);

    status.style.color = 'var(--accent)';
    status.textContent = `✓ Connected to ${owner}/${repo}`;

    // Push current tracks immediately
    await saveTracks(tracks);
    setTimeout(() => closeModal('gh-modal'), 1200);
  } catch(e) {
    status.style.color = 'var(--accent3)';
    status.textContent = `✕ Connection failed: ${e.message} — check token/repo name`;
  }
});

// Export
document.getElementById('gh-export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(tracks, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tracks.json';
  a.click();
  showToast('TRACKS EXPORTED', 'success');
});

// Import
document.getElementById('gh-import-btn').addEventListener('click', () => {
  document.getElementById('gh-import-input').click();
});
document.getElementById('gh-import-input').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const imported = JSON.parse(ev.target.result);
      if (!Array.isArray(imported)) throw new Error('Not an array');
      tracks = imported;
      await saveTracks(tracks);
      renderFilters();
      renderTracks();
      showToast(`${tracks.length} TRACKS IMPORTED`, 'success');
      closeModal('gh-modal');
    } catch(err) {
      showToast('INVALID tracks.json FILE', 'error');
    }
  };
  reader.readAsText(f);
  e.target.value = '';
});

// ===== SHUFFLE, LOOP, LIKE =====
let isShuffled = false;
let isLooping = false;
let likedTracks = new Set(JSON.parse(localStorage.getItem('vault-liked') || '[]'));

function saveLiked() {
  localStorage.setItem('vault-liked', JSON.stringify([...likedTracks]));
}

document.getElementById('shuffle-btn').addEventListener('click', () => {
  isShuffled = !isShuffled;
  document.getElementById('shuffle-btn').classList.toggle('active', isShuffled);
  showToast(isShuffled ? 'SHUFFLE ON' : 'SHUFFLE OFF', '');
});

document.getElementById('loop-btn').addEventListener('click', () => {
  isLooping = !isLooping;
  audio.loop = isLooping;
  document.getElementById('loop-btn').classList.toggle('active', isLooping);
  showToast(isLooping ? 'LOOP ON' : 'LOOP OFF', '');
});

document.getElementById('player-like-btn').addEventListener('click', () => {
  const playlist = getPlaylist();
  const t = playlist[currentTrackIdx];
  if (!t) return;
  const btn = document.getElementById('player-like-btn');
  if (likedTracks.has(t.id)) {
    likedTracks.delete(t.id);
    btn.textContent = '♡';
    btn.classList.remove('liked');
    showToast('REMOVED FROM LIKED', '');
  } else {
    likedTracks.add(t.id);
    btn.textContent = '♥';
    btn.classList.add('liked');
    showToast('ADDED TO LIKED ♥', 'success');
  }
  saveLiked();
});

function updateLikeBtn() {
  const playlist = getPlaylist();
  const t = playlist[currentTrackIdx];
  const btn = document.getElementById('player-like-btn');
  if (!t || !btn) return;
  const liked = likedTracks.has(t.id);
  btn.textContent = liked ? '♥' : '♡';
  btn.classList.toggle('liked', liked);
}

// ===== KEYBOARD SHORTCUTS =====
document.addEventListener('keydown', (e) => {
  // Don't fire when typing in an input/textarea
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement.isContentEditable) return;

  switch(e.key) {
    case ' ':
    case 'Spacebar':
      e.preventDefault();
      document.getElementById('play-pause-btn').click();
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (e.shiftKey) {
        // Shift+→ skip forward 10s
        if (audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
      } else {
        document.getElementById('next-btn').click();
      }
      break;
    case 'ArrowLeft':
      e.preventDefault();
      if (e.shiftKey) {
        // Shift+← skip back 10s
        if (audio.duration) audio.currentTime = Math.max(0, audio.currentTime - 10);
      } else {
        document.getElementById('prev-btn').click();
      }
      break;
    case 'ArrowUp':
      e.preventDefault();
      { const s = document.getElementById('volume-slider');
        const newVol = Math.min(1, parseFloat(s.value) + 0.1);
        s.value = newVol; audio.volume = newVol;
        document.getElementById('vol-icon').textContent = newVol === 0 ? '🔇' : newVol < 0.5 ? '🔉' : '🔊'; }
      break;
    case 'ArrowDown':
      e.preventDefault();
      { const s = document.getElementById('volume-slider');
        const newVol = Math.max(0, parseFloat(s.value) - 0.1);
        s.value = newVol; audio.volume = newVol;
        document.getElementById('vol-icon').textContent = newVol === 0 ? '🔇' : newVol < 0.5 ? '🔉' : '🔊'; }
      break;
    case 'm':
    case 'M':
      document.getElementById('vol-icon').click();
      break;
    case 's':
    case 'S':
      document.getElementById('shuffle-btn').click();
      break;
    case 'l':
    case 'L':
      document.getElementById('loop-btn').click();
      break;
    case 'k':
    case 'K':
      { const lb = document.getElementById('lyrics-toggle-btn'); if (lb) lb.click(); }
      break;
  }
});

// ===== WAVEFORM STYLE TOGGLE =====
let waveformStyle = 'bars'; // 'bars' | 'line'
document.getElementById('wave-bars-btn').addEventListener('click', () => {
  waveformStyle = 'bars';
  document.getElementById('wave-bars-btn').classList.add('active');
  document.getElementById('wave-line-btn').classList.remove('active');
});
document.getElementById('wave-line-btn').addEventListener('click', () => {
  waveformStyle = 'line';
  document.getElementById('wave-line-btn').classList.add('active');
  document.getElementById('wave-bars-btn').classList.remove('active');
});

// ===== VINYL ART CARD CLICK =====
let vacOpen = false;
document.getElementById('player-vinyl').addEventListener('click', () => {
  const card = document.getElementById('vinyl-art-card');
  vacOpen = !vacOpen;
  card.classList.toggle('open', vacOpen);
});
// Close when clicking outside
document.addEventListener('click', (e) => {
  if (vacOpen && !e.target.closest('#player-vinyl') && !e.target.closest('#vinyl-art-card')) {
    vacOpen = false;
    document.getElementById('vinyl-art-card').classList.remove('open');
  }
});

function updateVinylCard(track, coverUrl) {
  document.getElementById('vac-title').textContent = track.title;
  document.getElementById('vac-artist').textContent = track.artist.toUpperCase();
  const img = document.getElementById('vac-img');
  const noArt = document.getElementById('vac-no-art');
  if (coverUrl) {
    img.src = coverUrl;
    img.style.display = 'block';
    noArt.style.display = 'none';
  } else {
    img.style.display = 'none';
    noArt.style.display = 'flex';
  }
}

// ===== COVER ART SEARCH — ADMIN ADD TRACK MODAL =====
// Returns iTunes results for a search query
async function searchCoverArt(query) {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&limit=8&entity=song`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || [])
      .filter(r => r.artworkUrl100)
      .map(r => ({
        url: r.artworkUrl100.replace('100x100bb', '600x600bb'),
        label: `${r.artistName} — ${r.collectionName || r.trackName}`
      }));
  } catch(e) { return []; }
}

// Generic cover art picker setup for a tab
function setupCoverPicker({ btnId, artistId, titleId, coverInputId, resultsId, previewId, previewImgId, clearId }) {
  let selectedCover = null;

  const btn = document.getElementById(btnId);
  const resultsEl = document.getElementById(resultsId);
  const previewEl = document.getElementById(previewId);
  const previewImg = document.getElementById(previewImgId);
  const coverInput = document.getElementById(coverInputId);
  const clearBtn = document.getElementById(clearId);

  function selectCover(url) {
    selectedCover = url;
    coverInput.value = url;
    previewImg.src = url;
    previewEl.classList.add('visible');
    resultsEl.querySelectorAll('.cover-option').forEach(o => o.classList.toggle('selected', o.dataset.url === url));
  }

  clearBtn.addEventListener('click', () => {
    selectedCover = null;
    coverInput.value = '';
    previewEl.classList.remove('visible');
    resultsEl.querySelectorAll('.cover-option').forEach(o => o.classList.remove('selected'));
  });

  // If user manually pastes a URL, show preview
  coverInput.addEventListener('change', () => {
    const v = coverInput.value.trim();
    if (v && /^https?:\/\//.test(v)) {
      previewImg.src = v;
      previewEl.classList.add('visible');
      selectedCover = v;
    }
  });

  btn.addEventListener('click', async () => {
    const artist = document.getElementById(artistId)?.value.trim() || '';
    const title = document.getElementById(titleId)?.value.trim() || '';
    if (!artist && !title) { showToast('ENTER ARTIST/TITLE FIRST', 'error'); return; }
    btn.disabled = true;
    btn.textContent = '…';
    const results = await searchCoverArt(`${artist} ${title}`);
    btn.disabled = false;
    btn.textContent = '🔍 Find Art';
    if (!results.length) { showToast('NO COVER ART FOUND', 'error'); return; }
    resultsEl.innerHTML = results.slice(0, 6).map(r => `<img class="cover-option" src="${r.url}" data-url="${r.url}" title="${r.label}" loading="lazy">`).join('');
    resultsEl.classList.add('visible');
    resultsEl.querySelectorAll('.cover-option').forEach(img => {
      img.addEventListener('click', () => selectCover(img.dataset.url));
    });
    // Auto-select first
    selectCover(results[0].url);
  });

  // Return getter for selected cover
  return () => coverInput.value.trim() || selectedCover;
}

// =====================================================================
// LYRICS SYSTEM — 4-tier sync engine
//
//   Tier 1 — LRCLIB        : free API, real timestamps, mainstream tracks
//   Tier 2 — LRC file      : manual .lrc in repo /lrc/ folder (unreleased)
//   Tier 3 — Whisper       : your Cloudflare Worker → Hugging Face Whisper
//                            transcribes the actual audio, returns timestamps
//                            result cached in localStorage forever
//   Tier 4 — Genius plain  : unsynced text, approximate scroll, last resort
// =====================================================================

const WHISPER_WORKER_URL = 'https://vault-whisper.ngninji9.workers.dev';
const LYRICS_CACHE_KEY   = 'vault-lyrics-cache-v1'; // localStorage key

const lyricsPanel       = document.getElementById('lyrics-panel');
const lyricsScroll      = document.getElementById('lyrics-scroll');
const lyricsBody        = document.getElementById('lyrics-body');
const lyricsLoading     = document.getElementById('lyrics-loading');
const lyricsError       = document.getElementById('lyrics-error');
const lyricsTrackName   = document.getElementById('lyrics-track-name');
const lyricsSourceBadge = document.getElementById('lyrics-source-badge');
const lyricsToggleBtn   = document.getElementById('lyrics-toggle-btn');
const lyricsCloseBtn    = document.getElementById('lyrics-close-btn');

let lyricsOpen      = false;
let lyricsLines     = [];     // [{time?: number, text: string}]
let lyricsIsSynced  = false;  // true when we have real timestamps
let lyricsTrackId   = null;
let lyricsScrollTimer = null;

// ── Load persisted cache ───────────────────────────────────────────
function getLyricsCache() {
  try { return JSON.parse(localStorage.getItem(LYRICS_CACHE_KEY) || '{}'); }
  catch { return {}; }
}
function saveLyricsCache(cache) {
  try { localStorage.setItem(LYRICS_CACHE_KEY, JSON.stringify(cache)); } catch {}
}
function getCachedLyrics(trackId) {
  return getLyricsCache()[trackId] || null;
}
function setCachedLyrics(trackId, data) {
  const cache = getLyricsCache();
  cache[trackId] = data;
  saveLyricsCache(cache);
}

// ── Toggle open/close ─────────────────────────────────────────────
function openLyricsPanel() {
  lyricsOpen = true;
  lyricsPanel.classList.add('open');
  lyricsToggleBtn.classList.add('active');
  playerBar.classList.add('lyrics-open');
  document.querySelector('.app').style.paddingBottom = 'calc(120px + 52vh)';
  const playlist = getPlaylist();
  const t = playlist[currentTrackIdx];
  if (t) loadLyricsForTrack(t);
}

function closeLyricsPanel() {
  lyricsOpen = false;
  lyricsPanel.classList.remove('open');
  lyricsToggleBtn.classList.remove('active');
  playerBar.classList.remove('lyrics-open');
  document.querySelector('.app').style.paddingBottom = '';
}

lyricsToggleBtn.addEventListener('click', () => {
  if (lyricsOpen) closeLyricsPanel();
  else openLyricsPanel();
});
lyricsCloseBtn.addEventListener('click', closeLyricsPanel);

function maybeFetchLyrics(track) {
  if (!lyricsOpen) return;
  loadLyricsForTrack(track);
}

// ── Main entry — works through all 4 tiers ────────────────────────
async function loadLyricsForTrack(track) {
  if (!track) return;
  lyricsTrackName.textContent = `— ${track.artist} · ${track.title}`;

  // Already loaded for this track — just re-sync
  if (lyricsTrackId === track.id && lyricsLines.length) {
    syncLyricsScroll();
    return;
  }

  lyricsTrackId   = track.id;
  lyricsLines     = [];
  lyricsIsSynced  = false;
  lyricsBody.innerHTML    = '';
  lyricsError.style.display   = 'none';
  lyricsLoading.style.display = 'flex';
  setLoadingMessage('SEARCHING FOR LYRICS…');

  // ── TIER 1: Check localStorage cache first (instant) ─────────────
  const cached = getCachedLyrics(track.id);
  if (cached && cached.lines && cached.lines.length) {
    lyricsLoading.style.display = 'none';
    lyricsLines    = cached.lines;
    lyricsIsSynced = cached.synced;
    if (cached.synced) {
      renderSyncedLyrics();
      lyricsSourceBadge.textContent = cached.source || 'SYNCED ✓';
    } else {
      renderPlainLyrics(cached.lines.map(l => l.text).join('\n'), cached.sourceUrl);
      lyricsSourceBadge.textContent = 'GENIUS';
    }
    return;
  }

  // ── TIER 2: LRCLIB (mainstream tracks, free, no account) ─────────
  setLoadingMessage('CHECKING LRCLIB…');
  const lrclibResult = await fetchLRCLIB(track.artist, track.title);
  if (lrclibResult) {
    const parsed = parseLRC(lrclibResult);
    if (parsed.length) {
      lyricsLoading.style.display = 'none';
      lyricsLines    = parsed;
      lyricsIsSynced = true;
      renderSyncedLyrics();
      lyricsSourceBadge.textContent = 'LRCLIB ✓';
      setCachedLyrics(track.id, { lines: parsed, synced: true, source: 'LRCLIB ✓' });
      return;
    }
  }

  // ── TIER 3: Manual LRC file from /lrc/ folder in GitHub repo ─────
  if (track.lrcFile) {
    setLoadingMessage('LOADING LRC FILE…');
    const lrcResult = await fetchLRCFile(track.lrcFile);
    if (lrcResult) {
      const parsed = parseLRC(lrcResult);
      if (parsed.length) {
        lyricsLoading.style.display = 'none';
        lyricsLines    = parsed;
        lyricsIsSynced = true;
        renderSyncedLyrics();
        lyricsSourceBadge.textContent = 'LRC SYNC ✓';
        setCachedLyrics(track.id, { lines: parsed, synced: true, source: 'LRC SYNC ✓' });
        return;
      }
    }
  }

  // ── TIER 4: Whisper via Cloudflare Worker ─────────────────────────
  // Transcribes the actual audio file — works on any track, any language
  if (track.url) {
    setLoadingMessage('TRANSCRIBING AUDIO — THIS MAY TAKE 20–40s…');
    const whisperResult = await fetchWhisperTranscription(track.url);
    if (whisperResult && whisperResult.length) {
      lyricsLoading.style.display = 'none';
      lyricsLines    = whisperResult;
      lyricsIsSynced = true;
      renderSyncedLyrics();
      lyricsSourceBadge.textContent = 'WHISPER ✓';
      setCachedLyrics(track.id, { lines: whisperResult, synced: true, source: 'WHISPER ✓' });
      return;
    }
  }

  // ── TIER 5: Genius plain text (last resort, approximate scroll) ───
  if (track.lyricsUrl && /genius\.com/i.test(track.lyricsUrl)) {
    setLoadingMessage('FETCHING GENIUS LYRICS…');
    const geniusText = await fetchGeniusPlain(track.lyricsUrl);
    if (geniusText) {
      lyricsLoading.style.display = 'none';
      lyricsLines    = geniusText.split('\n').map(text => ({ text }));
      lyricsIsSynced = false;
      renderPlainLyrics(geniusText, track.lyricsUrl);
      lyricsSourceBadge.textContent = 'GENIUS';
      setCachedLyrics(track.id, {
        lines: lyricsLines, synced: false, sourceUrl: track.lyricsUrl
      });
      return;
    }
  }

  // ── All tiers failed ──────────────────────────────────────────────
  lyricsLoading.style.display = 'none';
  showLyricsError(track);
}

// ── Loading message helper ────────────────────────────────────────
function setLoadingMessage(msg) {
  const span = lyricsLoading.querySelector('span');
  if (span) span.textContent = msg;
}

// ── TIER 2: LRCLIB ───────────────────────────────────────────────
async function fetchLRCLIB(artist, title) {
  try {
    const params = new URLSearchParams({ artist_name: artist, track_name: title });
    const res = await fetch(`https://lrclib.net/api/get?${params}`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.syncedLyrics || null;
  } catch { return null; }
}

// ── TIER 3: LRC file from repo /lrc/ folder ───────────────────────
async function fetchLRCFile(filename) {
  try {
    const pub = getPublicRepo();
    if (!pub) return null;
    const url = `https://raw.githubusercontent.com/${pub.owner}/${pub.repo}/${pub.branch}/lrc/${filename}?t=${Date.now()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

// ── TIER 4: Whisper via your Cloudflare Worker ────────────────────
async function fetchWhisperTranscription(audioUrl) {
  try {
    const res = await fetch(WHISPER_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioUrl }),
      signal: AbortSignal.timeout(90000), // Whisper can take up to 90s on long tracks
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('Whisper Worker error:', err.error || res.status);
      return null;
    }
    const data = await res.json();
    if (!data.lines || !data.lines.length) return null;
    return data.lines; // [{time: number, text: string}]
  } catch (e) {
    console.warn('Whisper fetch failed:', e.message);
    return null;
  }
}

// ── TIER 5: Genius plain text via CORS proxy ──────────────────────
async function fetchGeniusPlain(geniusUrl) {
  const proxies = [
    url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  ];
  for (const makeUrl of proxies) {
    try {
      const res = await fetch(makeUrl(geniusUrl), { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') || '';
      let html;
      if (ct.includes('application/json')) {
        const data = await res.json();
        html = data.contents || data.body || null;
      } else {
        html = await res.text();
      }
      if (html && html.length > 500) {
        const lyrics = parseGeniusHtml(html);
        if (lyrics && lyrics.trim().length > 20) return lyrics;
      }
    } catch { continue; }
  }
  return null;
}

// ── Parse Genius HTML → plain text ───────────────────────────────
function parseGeniusHtml(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const containers = doc.querySelectorAll('[data-lyrics-container="true"]');
  if (containers.length) {
    let text = '';
    containers.forEach(c => {
      c.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
      c.querySelectorAll('a').forEach(a => a.replaceWith(a.textContent));
      text += c.textContent + '\n\n';
    });
    return text.trim();
  }
  const lyricsEl = doc.querySelector('.lyrics');
  if (lyricsEl) {
    lyricsEl.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    return lyricsEl.textContent.trim();
  }
  return null;
}

// ── Parse LRC format → [{time, text}] ────────────────────────────
function parseLRC(lrcText) {
  const timeRegex = /^\[(\d{1,2}):(\d{2})\.(\d{2,3})\](.*)/;
  const result = [];
  for (const line of lrcText.split('\n')) {
    const m = line.match(timeRegex);
    if (m) {
      const time = parseInt(m[1]) * 60 + parseInt(m[2]) + parseInt(m[3].padEnd(3,'0')) / 1000;
      const text = m[4].trim();
      result.push({ time, text });
    }
  }
  return result.sort((a, b) => a.time - b.time);
}

// ── Render synced lyrics (has real timestamps) ────────────────────
function renderSyncedLyrics() {
  lyricsBody.innerHTML = lyricsLines.map((line, i) => {
    if (!line.text) return `<span class="lyrics-line" data-idx="${i}" style="display:block;height:14px"></span>`;
    if (/^\[.*\]$/.test(line.text)) return `<span class="lyrics-line lyrics-section" data-idx="${i}">${escHtml(line.text)}</span>`;
    return `<span class="lyrics-line" data-idx="${i}">${escHtml(line.text)}</span>`;
  }).join('');

  // Click a line to seek to its exact timestamp
  lyricsBody.querySelectorAll('.lyrics-line[data-idx]').forEach(el => {
    el.addEventListener('click', () => {
      const line = lyricsLines[parseInt(el.dataset.idx)];
      if (line && line.time !== undefined && audio.duration) {
        audio.currentTime = line.time;
      }
    });
  });
  syncLyricsScroll();
}

// ── Render plain lyrics (no timestamps — Genius fallback) ─────────
function renderPlainLyrics(rawText, sourceUrl) {
  const rawLines = rawText.split('\n');
  lyricsLines = rawLines.map(text => ({ text }));

  lyricsBody.innerHTML = rawLines.map((line, i) => {
    if (!line.trim()) return `<span class="lyrics-line" data-idx="${i}" style="display:block;height:14px"></span>`;
    if (/^\[.*\]$/.test(line.trim())) return `<span class="lyrics-line lyrics-section" data-idx="${i}">${escHtml(line)}</span>`;
    return `<span class="lyrics-line" data-idx="${i}">${escHtml(line)}</span>`;
  }).join('') + (sourceUrl
    ? `<div class="genius-attr">Lyrics via <a href="${sourceUrl}" target="_blank" rel="noopener">Genius</a> · <span style="color:var(--muted)">scroll approximate</span></div>`
    : '');

  lyricsBody.querySelectorAll('.lyrics-line[data-idx]').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.idx);
      if (!audio.duration) return;
      audio.currentTime = (idx / Math.max(lyricsLines.length - 1, 1)) * audio.duration;
    });
  });
  syncLyricsScroll();
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Error state ───────────────────────────────────────────────────
function showLyricsError(track) {
  lyricsBody.innerHTML = '';
  lyricsError.style.display = 'block';
  const geniusSearch = `https://genius.com/search?q=${encodeURIComponent(track.artist+' '+track.title)}`;
  lyricsError.innerHTML =
    `⚠ COULD NOT LOAD LYRICS<br><br>` +
    `Tried LRCLIB, Whisper transcription, and Genius — all failed.<br><br>` +
    `You can still add a Genius URL or an LRC file via <strong>✎ Edit</strong> on the track card.<br><br>` +
    `<a href="${geniusSearch}" target="_blank" rel="noopener">🔍 Search Genius →</a>`;
}

// ── Sync scroll — real timestamps when available ──────────────────
function syncLyricsScroll() {
  if (!lyricsOpen || !lyricsLines.length || !audio.duration) return;

  let activeIdx = 0;

  if (lyricsIsSynced) {
    // Walk backwards to find the last line whose timestamp <= now
    const now = audio.currentTime;
    for (let i = lyricsLines.length - 1; i >= 0; i--) {
      if (lyricsLines[i].time !== undefined && lyricsLines[i].time <= now) {
        activeIdx = i;
        break;
      }
    }
  } else {
    // Plain text — linear distribution
    activeIdx = Math.floor((audio.currentTime / audio.duration) * (lyricsLines.length - 1));
  }

  lyricsBody.querySelectorAll('.lyrics-line[data-idx]').forEach(el => {
    const idx = parseInt(el.dataset.idx);
    el.classList.toggle('active', idx === activeIdx);
    el.classList.toggle('passed', idx < activeIdx);
  });

  const activeEl = lyricsBody.querySelector('.lyrics-line.active');
  if (activeEl) {
    lyricsScroll.scrollTo({
      top: Math.max(0, activeEl.offsetTop - lyricsScroll.clientHeight * 0.38),
      behavior: 'smooth'
    });
  }
}

// ── timeupdate hook — tighter interval for synced lyrics ──────────
audio.addEventListener('timeupdate', () => {
  if (!lyricsOpen || !lyricsLines.length) return;
  if (lyricsScrollTimer) return;
  lyricsScrollTimer = setTimeout(() => {
    lyricsScrollTimer = null;
    syncLyricsScroll();
  }, lyricsIsSynced ? 250 : 500);
});

// =====================================================================

// ── Per-artist default canvas GIFs / videos ───────────────────────
// Add your artists here. Use a direct GIF URL (Giphy CDN, Tenor CDN,
// or your own Cloudinary-hosted GIF/MP4). MP4/WebM from Cloudinary
// are best: smaller file, loops perfectly, no green flicker.
//
// HOW TO ADD:
//   'artist name lowercase': 'https://direct-url-to-gif-or-mp4'
//
// HOW TO GET GIPHY DIRECT LINKS:
//   giphy.com → find GIF → Share → Copy Link
//   Replace "giphy.com/gifs/..." with "media.giphy.com/media/.../giphy.gif"
//
// HOW TO HOST ON CLOUDINARY (recommended):
//   Upload as image (GIF stays animated) or video (.mp4/.webm)
//   Use the delivery URL: https://res.cloudinary.com/<cloud>/image/upload/<id>.gif
// ─────────────────────────────────────────────────────────────────
const ARTIST_CANVAS = {
  'nine vicious':  '',   // paste GIF/MP4 URL here e.g. 'https://media.giphy.com/media/xyz/giphy.gif'
  'prettifun':     '',
  'che':           '',
  'slayr':         '',
  'protect':       '',
  'osamaon':       '',
  'playboi carti': '',
  'lil yachty':    '',
  'young thug':    '',
  'lucki':         '',
};

// ── Fallback gradient palette per artist (used when no GIF is set) ─
// These map to the CSS --canvas-a/b/c variables on the fallback div
const ARTIST_CANVAS_FALLBACK = {
  'nine vicious':  ['#1a0800', '#050507', '#2a0a00'],
  'prettifun':     ['#1a0020', '#050507', '#0a001a'],
  'che':           ['#001a10', '#050507', '#001510'],
  'slayr':         ['#1a1a00', '#050507', '#141400'],
  'protect':       ['#001020', '#050507', '#000a1a'],
  'osamaon':       ['#141a00', '#050507', '#0e1400'],
  'playboi carti': ['#1a0000', '#050507', '#0f0000'],
  'lil yachty':    ['#001a1a', '#050507', '#001010'],
  'young thug':    ['#0f001a', '#050507', '#0a0014'],
  'lucki':         ['#001a0a', '#050507', '#001408'],
};

// ── Canvas state ──────────────────────────────────────────────────
let canvasEnabled = true;           // user toggle
let currentCanvasUrl = null;        // currently loaded URL
let canvasLabelTimer = null;

const canvasWrap     = document.getElementById('vault-canvas-wrap');
const canvasImg      = document.getElementById('vault-canvas-img');
const canvasVideo    = document.getElementById('vault-canvas-video');
const canvasFallback = document.getElementById('vault-canvas-fallback');
const canvasLabel    = document.getElementById('canvas-label');
const canvasToggleBtn = document.getElementById('canvas-toggle-btn');

// ── Resolve which canvas URL to use for a track ───────────────────
function resolveCanvas(track) {
  // 1. Track-level override wins
  if (track.canvas) return track.canvas;
  // 2. Artist default
  const key = (track.artist || '').toLowerCase();
  for (const [k, v] of Object.entries(ARTIST_CANVAS)) {
    if (key.includes(k) && v) return v;
  }
  return null; // → CSS fallback
}

// ── Resolve fallback gradient colors for artist ───────────────────
function resolveCanvasFallback(artist) {
  const key = (artist || '').toLowerCase();
  for (const [k, v] of Object.entries(ARTIST_CANVAS_FALLBACK)) {
    if (key.includes(k)) return v;
  }
  // Generic: derive from artist color
  const hex = getArtistColor(artist);
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return [
    `rgb(${Math.floor(r*0.3)},${Math.floor(g*0.3)},${Math.floor(b*0.3)})`,
    '#050507',
    `rgb(${Math.floor(r*0.15)},${Math.floor(g*0.15)},${Math.floor(b*0.2)})`,
  ];
}

// ── Detect if URL is a video ──────────────────────────────────────
function isVideoUrl(url) {
  return /\.(mp4|webm|ogg|mov)(\?|$)/i.test(url);
}

// ── Load and show canvas for a track ─────────────────────────────
function showCanvas(track) {
  if (!canvasEnabled) return;

  const url = resolveCanvas(track);

  // Avoid reloading the same source
  if (url && url === currentCanvasUrl) {
    canvasWrap.classList.add('active');
    return;
  }
  currentCanvasUrl = url;

  // Reset both media elements
  canvasImg.style.display   = 'none';
  canvasVideo.style.display = 'none';
  canvasFallback.classList.remove('active');

  if (url) {
    if (isVideoUrl(url)) {
      canvasVideo.src = url;
      canvasVideo.style.display = 'block';
      canvasVideo.play().catch(() => {});
    } else {
      // GIF — use img tag (browser handles the loop automatically)
      canvasImg.src = url;
      canvasImg.style.display = 'block';
    }
  } else {
    // No GIF set — use animated gradient fallback
    const [a, b, c] = resolveCanvasFallback(track.artist);
    canvasFallback.style.setProperty('--canvas-a', a);
    canvasFallback.style.setProperty('--canvas-b', b);
    canvasFallback.style.setProperty('--canvas-c', c);
    canvasFallback.classList.add('active');
  }

  canvasWrap.classList.add('active');
  showCanvasLabel(url ? '◈ CANVAS' : '◈ CANVAS — NO GIF SET');
}

// ── Hide canvas (on pause / stop) ────────────────────────────────
function hideCanvas() {
  canvasWrap.classList.remove('active');
  // Pause video when hidden to save CPU
  if (!canvasVideo.paused) canvasVideo.pause();
}

// ── Resume canvas (on resume play) ───────────────────────────────
function resumeCanvas() {
  if (!canvasEnabled) return;
  canvasWrap.classList.add('active');
  if (canvasVideo.src && canvasVideo.paused) canvasVideo.play().catch(() => {});
}

// ── Canvas label flash ────────────────────────────────────────────
function showCanvasLabel(text) {
  canvasLabel.textContent = text;
  canvasLabel.classList.add('visible');
  clearTimeout(canvasLabelTimer);
  canvasLabelTimer = setTimeout(() => canvasLabel.classList.remove('visible'), 2400);
}

// ── Toggle button ─────────────────────────────────────────────────
canvasToggleBtn.addEventListener('click', () => {
  canvasEnabled = !canvasEnabled;
  canvasToggleBtn.classList.toggle('active', canvasEnabled);
  if (canvasEnabled && isPlaying) {
    const playlist = getPlaylist();
    const t = playlist[currentTrackIdx];
    if (t) showCanvas(t);
  } else {
    hideCanvas();
  }
  showToast(canvasEnabled ? '◈ CANVAS ON' : '◈ CANVAS OFF', '');
});
// Start with canvas enabled
canvasToggleBtn.classList.add('active');

// Hook canvas into play/pause events
// (playAtIndex calls showCanvas; pause hides it; resume resumes it)
audio.addEventListener('pause', () => { if (!audio.ended) hideCanvas(); });
audio.addEventListener('play',  () => { resumeCanvas(); });

// =====================================================================

// Set up all three tabs
const getCoverLink       = setupCoverPicker({ btnId:'find-cover-btn',   artistId:'inp-artist',   titleId:'inp-title',   coverInputId:'inp-cover',   resultsId:'cover-results',   previewId:'cover-preview',   previewImgId:'cover-preview-img',   clearId:'cover-clear-btn' });
const getCoverCloudinary = setupCoverPicker({ btnId:'find-cover-btn-c', artistId:'inp-artist-c', titleId:'inp-title-c', coverInputId:'inp-cover-c', resultsId:'cover-results-c', previewId:'cover-preview-c', previewImgId:'cover-preview-img-c', clearId:'cover-clear-btn-c' });
const getCoverFile       = setupCoverPicker({ btnId:'find-cover-btn-f', artistId:'inp-artist-f', titleId:'inp-title-f', coverInputId:'inp-cover-f', resultsId:'cover-results-f', previewId:'cover-preview-f', previewImgId:'cover-preview-img-f', clearId:'cover-clear-btn-f' });

// ===== INIT =====
resizeCanvas();
window.addEventListener('resize', resizeCanvas);
setDefaultBG();

// Seed default tracks immediately so the page never shows empty
tracks = getLocalTracks();
renderFilters();
renderTracks();

// Then async-load from GitHub (may update the list with newer tracks)
loadTracks().then(loaded => {
  if (loaded && loaded.length > 0) {
    tracks = loaded;
    renderFilters();
    renderTracks();
  }
  if (isAdmin && !ghConfigured()) {
    showToast('GITHUB NOT SET UP — CLICK ⚙ TO CONFIGURE', 'error');
  }
});