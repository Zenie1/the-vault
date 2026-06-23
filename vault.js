// =============================================================
// vault.js — The Vault · all application logic
// Loaded by index.html via <script src="vault.js" defer>
// =============================================================
// ===== CONFIG =====
// Admin auth — password is SHA-256 hashed and stored in Firebase at vault-config/adminHash.
// No plaintext password lives in this file.

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Verify input against the SHA-256 hash stored in Firebase.
// Returns: true | false | 'firebase-unavailable'
async function checkPassword(input) {
  try {
    console.log('[Vault] Checking password…');
    const inputHash = await hashPassword(input);
    console.log('[Vault] Input hashed, fetching stored hash from Firebase…');

    const db    = window._vaultDb;
    const dbRef = window._vaultDbRef;
    const dbGet = window._vaultDbGet;

    if (!db || !dbRef || !dbGet) {
      console.warn('[Vault] Firebase not ready — window._vaultDb:', window._vaultDb);
      return 'firebase-unavailable';
    }

    const snapshot   = await dbGet(dbRef(db, 'vault-config/adminHash'));
    const storedHash = snapshot.val();
    console.log('[Vault] Stored hash present:', !!storedHash);

    if (!storedHash) {
      console.warn('[Vault] No adminHash found in Firebase — run setup-admin.html first');
      return 'firebase-unavailable';
    }

    const result = inputHash === storedHash;
    console.log('[Vault] Hash match result:', result);
    return result;
  } catch(e) {
    console.warn('[Vault] checkPassword error:', e.message);
    return 'firebase-unavailable';
  }
}

async function changeAdminPassword(currentPw, newPw) {
  const ok = await checkPassword(currentPw);
  if (!ok) return false;
  try {
    const newHash = await hashPassword(newPw);
    const db    = window._vaultDb;
    const dbRef = window._vaultDbRef;
    const dbSet = window._vaultDbSet;
    if (!db || !dbRef || !dbSet) return false;
    await dbSet(dbRef(db, 'vault-config/adminHash'), newHash);
    return true;
  } catch(e) {
    console.warn('[Vault] changeAdminPassword error:', e.message);
    return false;
  }
}

// ===== GITHUB CONFIG =====
// These are loaded from localStorage so you set them once in the GitHub Settings modal
// GUEST_REPO: set this once so guests can load tracks without a token
// Format: 'owner/repo' e.g. 'zenie1/the-vault'  — leave blank if not using GitHub
const GUEST_REPO = 'Zenie1/the-vault';
const GUEST_BRANCH = 'main';

// Cloudinary config — used by the stem separation worker to upload results
// CLOUDINARY_UPLOAD_PRESET must be an *unsigned* preset in your Cloudinary settings
const CLOUDINARY_CLOUD         = 'dmpwlevyh';           // your cloud name
const CLOUDINARY_UPLOAD_PRESET = 'vault_stems_unsigned'; // create this in Cloudinary dashboard

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

// ===== ARTIST PALETTE SYSTEM =====
// Default palettes — loaded from artists.json at runtime (which overrides these).
// Format: { primary, secondary, text, glow, gradient: [start, end] }
const ARTIST_PALETTES_DEFAULT = {
  'playboi carti': { primary:'#ff3c3c', secondary:'#1a0505', text:'#ff9999', glow:'#ff1111', gradient:['#ff3c3c','#8b0000'] },
  'lil yachty':    { primary:'#00e5ff', secondary:'#00121a', text:'#80f2ff', glow:'#00ccff', gradient:['#00e5ff','#005f7a'] },
  'young thug':    { primary:'#9f3cff', secondary:'#0d0019', text:'#cc99ff', glow:'#8800ff', gradient:['#9f3cff','#4a0080'] },
  'lucki':         { primary:'#00ff9f', secondary:'#001a0d', text:'#80ffcc', glow:'#00ff7f', gradient:['#00ff9f','#008040'] },
  'nine vicious':  { primary:'#ff9f00', secondary:'#1a0a00', text:'#ffcc80', glow:'#ff8800', gradient:['#ff9f00','#804f00'] },
  'prettifun':     { primary:'#ff3c9f', secondary:'#1a0011', text:'#ff99cc', glow:'#ff0080', gradient:['#ff3c9f','#800040'] },
  'slayr':         { primary:'#c8ff00', secondary:'#0d1a00', text:'#e4ff80', glow:'#aaff00', gradient:['#c8ff00','#558800'] },
  'protect':       { primary:'#3c9fff', secondary:'#000d1a', text:'#80bfff', glow:'#0080ff', gradient:['#3c9fff','#004080'] },
  'che':           { primary:'#ff6b3c', secondary:'#1a0500', text:'#ffaa88', glow:'#ff5500', gradient:['#ff6b3c','#802800'] },
  'osamaon':       { primary:'#c8ff3c', secondary:'#0d1a00', text:'#e4ff99', glow:'#aaff22', gradient:['#c8ff3c','#558800'] },
  'destroy lonely':{ primary:'#b06aff', secondary:'#0e0018', text:'#d4a0ff', glow:'#9933ff', gradient:['#b06aff','#520099'] },
  'lil uzi vert':  { primary:'#ff69b4', secondary:'#1a0012', text:'#ffb3d9', glow:'#ff1493', gradient:['#ff69b4','#8b0057'] },
  'ken carson':    { primary:'#00ff88', secondary:'#001a0d', text:'#80ffcc', glow:'#00e070', gradient:['#00ff88','#007040'] },
  'osamason':      { primary:'#c8ff3c', secondary:'#0d1a00', text:'#e4ff99', glow:'#aaff22', gradient:['#c8ff3c','#558800'] },
  '1oneam':        { primary:'#a0c4ff', secondary:'#060d1a', text:'#cce0ff', glow:'#7ab0ff', gradient:['#a0c4ff','#2255aa'] },
};

// Runtime store — loaded from artists.json on startup, populated by admin edits
let artistPalettes = {};

// ── Color math utilities ──────────────────────────────────────────────────────
function hexToHsl(hex) {
  let r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h=0, s=0, l=(max+min)/2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d/(2-max-min) : d/(max+min);
    switch(max) {
      case r: h = ((g-b)/d + (g<b?6:0))/6; break;
      case g: h = ((b-r)/d + 2)/6; break;
      case b: h = ((r-g)/d + 4)/6; break;
    }
  }
  return [h*360, s*100, l*100];
}

function hslToHex(h, s, l) {
  h/=360; s/=100; l/=100;
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l*(1+s) : l+s-l*s, p = 2*l-q;
    const hue2rgb = (p,q,t) => { if(t<0)t+=1; if(t>1)t-=1; if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; };
    r=hue2rgb(p,q,h+1/3); g=hue2rgb(p,q,h); b=hue2rgb(p,q,h-1/3);
  }
  return '#'+[r,g,b].map(x=>Math.round(x*255).toString(16).padStart(2,'0')).join('');
}

// Auto-derive a complete palette from a single primary hex color
function generatePaletteFromPrimary(primary) {
  const [h, s, l] = hexToHsl(primary);
  return {
    primary,
    secondary: hslToHex(h, Math.min(s*0.6,100), Math.max(l*0.12,2)),
    text:      hslToHex(h, Math.min(s*0.65,100), Math.min(l+30,88)),
    glow:      hslToHex(h, Math.min(s*1.05,100), Math.min(l+6,72)),
    gradient:  [primary, hslToHex(h, s, Math.max(l-22,3))]
  };
}

// Return full palette for an artist.
// Priority: runtime artistPalettes → ARTIST_PALETTES_DEFAULT → auto-generate from ARTIST_COLORS.
function getArtistPalette(artist) {
  const key = (artist||'').toLowerCase();
  for (const [k,v] of Object.entries(artistPalettes)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  for (const [k,v] of Object.entries(ARTIST_PALETTES_DEFAULT)) {
    if (key.includes(k)) return v;
  }
  return generatePaletteFromPrimary(getArtistColor(artist));
}

// Convert hex to rgba string with given alpha (0-1)
function hexToRgba(hex, a) {
  const r2 = parseInt(hex.slice(1,3),16), g2 = parseInt(hex.slice(3,5),16), b2 = parseInt(hex.slice(5,7),16);
  return `rgba(${r2},${g2},${b2},${a})`;
}

// Apply full artist palette as CSS variables on :root and #player-bar
function applyArtistPalette(artist) {
  const p = getArtistPalette(artist);
  const root = document.documentElement;
  root.style.setProperty('--artist-primary',        p.primary);
  root.style.setProperty('--artist-secondary',       p.secondary);
  root.style.setProperty('--artist-text',            p.text);
  root.style.setProperty('--artist-glow',            p.glow);
  root.style.setProperty('--artist-gradient-start',  p.gradient[0]);
  root.style.setProperty('--artist-gradient-end',    p.gradient[1]);
  // Computed rgba helpers for CSS overlays that need opacity control
  const sr = parseInt(p.secondary.slice(1,3),16), sg = parseInt(p.secondary.slice(3,5),16), sb = parseInt(p.secondary.slice(5,7),16);
  root.style.setProperty('--artist-secondary-bg',   `rgba(${sr},${sg},${sb},0.42)`);
  const gr = parseInt(p.glow.slice(1,3),16), gg = parseInt(p.glow.slice(3,5),16), gb = parseInt(p.glow.slice(5,7),16);
  root.style.setProperty('--artist-glow-30',        `rgba(${gr},${gg},${gb},0.30)`);
  // Backward compat
  root.style.setProperty('--artist-color',           p.primary);
  root.style.setProperty('--current-color',          p.primary);
  const bar = document.getElementById('player-bar');
  if (bar) bar.style.setProperty('--current-color', p.primary);
}

// ===== STORAGE — GitHub API + localStorage fallback =====
let ghFileSha = null;      // tracks the SHA of tracks.json for updates
let ghArtistsSha = null;   // tracks the SHA of artists.json for updates
let ghProjectsSha = null;  // tracks the SHA of projects.json for updates

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
        const trackArr = _extractTracks(decoded);
        const projArr  = _extractProjects(decoded);
        localStorage.setItem('vault-tracks-v2', JSON.stringify(decoded));
        if (projArr.length && !projects.length) { projects = projArr; localStorage.setItem(PROJECTS_KEY, JSON.stringify(projArr)); }
        return trackArr;
      }
      if (res.status === 404) { ghFileSha = null; return getLocalTracks(); }
    } catch(e) { /* suppressed */ }
  } else {
    // Guest with no token — try public raw GitHub URL
    const pub = getPublicRepo();
    if (pub) {
      try {
        const res = await fetch(`https://raw.githubusercontent.com/${pub.owner}/${pub.repo}/${pub.branch}/tracks.json?t=${Date.now()}`);
        if (res.ok) {
          const decoded = await res.json();
          const trackArr = _extractTracks(decoded);
          const projArr  = _extractProjects(decoded);
          localStorage.setItem('vault-tracks-v2', JSON.stringify(decoded));
          if (projArr.length && !projects.length) { projects = projArr; localStorage.setItem(PROJECTS_KEY, JSON.stringify(projArr)); }
          return trackArr;
        }
      } catch(e) { /* suppressed */ }
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
    if (!s) return DEFAULT_TRACKS;
    const p = JSON.parse(s);
    if (Array.isArray(p)) return p;
    if (p && Array.isArray(p.tracks)) return p.tracks;
    return DEFAULT_TRACKS;
  } catch { return DEFAULT_TRACKS; }
}

function getLocalProjects() {
  try {
    const s = localStorage.getItem(PROJECTS_KEY);
    return s ? JSON.parse(s) : [];
  } catch { return []; }
}

function _extractTracks(decoded) {
  if (Array.isArray(decoded)) return decoded;
  if (decoded && Array.isArray(decoded.tracks)) return decoded.tracks;
  return [];
}
function _extractProjects(decoded) {
  if (decoded && Array.isArray(decoded.projects)) return decoded.projects;
  return [];
}

async function saveProjects(p) {
  await saveProjectsFile(p);
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

  // Save flat tracks array to localStorage (projects are now in projects.json / PROJECTS_KEY)
  try { localStorage.setItem('vault-tracks-v2', JSON.stringify(t)); } catch(e) {}

  if (!ghConfigured()) {
    showToast('SAVED LOCALLY — SET UP GITHUB TO PERSIST', 'error');
    return;
  }

  const c = getGHConfig();
  let content;
  try {
    // Use TextEncoder for safe base64 encoding (handles all Unicode)
    // tracks.json is now a lean flat array — projects live in projects.json
    const json = JSON.stringify(forGithub, null, 2);
    const bytes = new TextEncoder().encode(json);
    const binStr = Array.from(bytes).map(b => String.fromCharCode(b)).join('');
    content = btoa(binStr);
  } catch(e) {
    /* suppressed */
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
      /* suppressed */
      const reason = err.message || 'unknown error';
      showToast(`GITHUB SAVE FAILED: ${reason.slice(0,40).toUpperCase()}`, 'error');
    }
  } catch(e) {
    /* suppressed */
    showToast('NETWORK ERROR — SAVED LOCALLY ONLY', 'error');
  }
}

// ===== ARTISTS.JSON — palette storage =====
async function loadArtists() {
  if (ghConfigured()) {
    try {
      const c = getGHConfig();
      const res = await fetch(
        `https://api.github.com/repos/${c.owner}/${c.repo}/contents/artists.json?ref=${c.branch}&t=${Date.now()}`,
        { headers: { 'Authorization': `token ${c.token}`, 'Accept': 'application/vnd.github.v3+json' } }
      );
      if (res.ok) {
        const data = await res.json();
        ghArtistsSha = data.sha;
        const decoded = JSON.parse(atob(data.content.replace(/\n/g,'')));
        localStorage.setItem('vault-artists-v1', JSON.stringify(decoded));
        return decoded;
      }
      if (res.status === 404) { ghArtistsSha = null; return getLocalArtists(); }
    } catch(e) { /* suppressed */ }
  } else {
    const pub = getPublicRepo();
    if (pub) {
      try {
        const res = await fetch(`https://raw.githubusercontent.com/${pub.owner}/${pub.repo}/${pub.branch}/artists.json?t=${Date.now()}`);
        if (res.ok) {
          const decoded = await res.json();
          localStorage.setItem('vault-artists-v1', JSON.stringify(decoded));
          return decoded;
        }
      } catch(e) { /* suppressed */ }
    }
  }
  return getLocalArtists();
}

function getLocalArtists() {
  try {
    const s = localStorage.getItem('vault-artists-v1');
    return s ? JSON.parse(s) : {};
  } catch { return {}; }
}

async function saveArtists(data) {
  try { localStorage.setItem('vault-artists-v1', JSON.stringify(data)); } catch(e) {}

  if (!ghConfigured()) {
    showToast('PALETTE SAVED LOCALLY — SET UP GITHUB TO PERSIST', 'error');
    return;
  }

  const c = getGHConfig();
  let content;
  try {
    const json = JSON.stringify(data, null, 2);
    const bytes = new TextEncoder().encode(json);
    content = btoa(Array.from(bytes).map(b => String.fromCharCode(b)).join(''));
  } catch(e) { showToast('ENCODING ERROR', 'error'); return; }

  const body = {
    message: `vault: update artists.json [${new Date().toISOString().split('T')[0]}]`,
    content,
    branch: c.branch,
  };
  if (ghArtistsSha) body.sha = ghArtistsSha;

  try {
    const res = await fetch(
      `https://api.github.com/repos/${c.owner}/${c.repo}/contents/artists.json`,
      {
        method: 'PUT',
        headers: { 'Authorization': `token ${c.token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    if (res.ok) {
      const d2 = await res.json();
      ghArtistsSha = d2.content.sha;
      showToast('PALETTE SAVED TO GITHUB ✓', 'success');
    } else {
      const err = await res.json();
      showToast(`PALETTE SAVE FAILED: ${(err.message||'').slice(0,40).toUpperCase()}`, 'error');
    }
  } catch(e) {
    showToast('NETWORK ERROR — PALETTE SAVED LOCALLY ONLY', 'error');
  }
}

// ===== PROJECTS.JSON — split storage =====
async function loadProjects() {
  if (ghConfigured()) {
    try {
      const c = getGHConfig();
      const res = await fetch(
        `https://api.github.com/repos/${c.owner}/${c.repo}/contents/projects.json?ref=${c.branch}&t=${Date.now()}`,
        { headers: { 'Authorization': `token ${c.token}`, 'Accept': 'application/vnd.github.v3+json' } }
      );
      if (res.ok) {
        const data = await res.json();
        ghProjectsSha = data.sha;
        const decoded = JSON.parse(atob(data.content.replace(/\n/g,'')));
        const projArr = decoded.projects || (Array.isArray(decoded) ? decoded : []);
        localStorage.setItem(PROJECTS_KEY, JSON.stringify(projArr));
        return projArr;
      }
      if (res.status === 404) { ghProjectsSha = null; return getLocalProjects(); }
    } catch(e) { /* suppressed */ }
  } else {
    const pub = getPublicRepo();
    if (pub) {
      try {
        const res = await fetch(`https://raw.githubusercontent.com/${pub.owner}/${pub.repo}/${pub.branch}/projects.json?t=${Date.now()}`);
        if (res.ok) {
          const decoded = await res.json();
          const projArr = decoded.projects || [];
          localStorage.setItem(PROJECTS_KEY, JSON.stringify(projArr));
          return projArr;
        }
      } catch(e) { /* suppressed */ }
    }
  }
  return getLocalProjects();
}

async function saveProjectsFile(p) {
  projects = p;
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(p));

  if (!ghConfigured()) {
    showToast('PROJECTS SAVED LOCALLY — SET UP GITHUB TO PERSIST', 'error');
    return;
  }

  const c = getGHConfig();
  let content;
  try {
    const json = JSON.stringify({ projects: p }, null, 2);
    const bytes = new TextEncoder().encode(json);
    content = btoa(Array.from(bytes).map(b => String.fromCharCode(b)).join(''));
  } catch(e) { showToast('ENCODING ERROR', 'error'); return; }

  const body = {
    message: `vault: update projects.json [${new Date().toISOString().split('T')[0]}]`,
    content,
    branch: c.branch,
  };
  if (ghProjectsSha) body.sha = ghProjectsSha;

  try {
    const res = await fetch(
      `https://api.github.com/repos/${c.owner}/${c.repo}/contents/projects.json`,
      {
        method: 'PUT',
        headers: { 'Authorization': `token ${c.token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    if (res.ok) {
      const d = await res.json();
      ghProjectsSha = d.content.sha;
      showToast('PROJECTS SAVED TO GITHUB ✓', 'success');
    } else {
      const err = await res.json();
      showToast(`PROJECTS SAVE FAILED: ${(err.message||'').slice(0,40).toUpperCase()}`, 'error');
    }
  } catch(e) {
    showToast('NETWORK ERROR — PROJECTS SAVED LOCALLY ONLY', 'error');
  }
}

// One-time migration: writes current projects to projects.json and trims tracks.json
async function migrateToSplitFiles() {
  showToast('MIGRATING…', '');
  await saveProjectsFile(projects);
  await saveTracks(tracks);
  const btn = document.getElementById('migrate-split-btn');
  if (btn) { btn.textContent = '✓ Migrated'; btn.disabled = true; }
  showToast('MIGRATION COMPLETE — tracks.json & projects.json are now split ✓', 'success');
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
    document.getElementById('cache-btn').style.display = 'flex';
    document.getElementById('change-pw-btn').style.display = 'flex';
    loginBtn.textContent = '⚿ Logout';
    document.body.classList.add('admin-mode');
    const cpb = document.getElementById('create-proj-btn');
    if (cpb) cpb.style.display = 'flex';
  } else {
    badge.className = 'status-badge guest';
    statusText.textContent = 'GUEST';
    addBtn.style.display = 'none';
    gdriveBtn.style.display = 'none';
    document.getElementById('gh-settings-btn').style.display = 'none';
    document.getElementById('cache-btn').style.display = 'none';
    document.getElementById('change-pw-btn').style.display = 'none';
    loginBtn.textContent = '⚿ Admin';
    document.body.classList.remove('admin-mode');
    const cpb = document.getElementById('create-proj-btn');
    if (cpb) cpb.style.display = 'none';
  }
  renderTracks();
  updateStemSeparateBtn();
}

// ── Admin inactivity auto-logout (30 min) ──────────────────────────
let adminInactivityTimer = null;
const ADMIN_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function startAdminInactivityTimer() {
  clearTimeout(adminInactivityTimer);
  adminInactivityTimer = setTimeout(() => {
    if (isAdmin) {
      setAdmin(false);
      showToast('SESSION EXPIRED — AUTO LOGGED OUT', 'error');
    }
  }, ADMIN_TIMEOUT_MS);
}

function resetAdminInactivityTimer() {
  if (!isAdmin) return;
  clearTimeout(adminInactivityTimer);
  adminInactivityTimer = setTimeout(() => {
    setAdmin(false);
    showToast('SESSION EXPIRED — AUTO LOGGED OUT', 'error');
  }, ADMIN_TIMEOUT_MS);
}

// Reset timer on any admin interaction
['click', 'keydown', 'mousemove', 'touchstart'].forEach(evt => {
  document.addEventListener(evt, resetAdminInactivityTimer, { passive: true });
});

// ===== STATE =====
let tracks = [], activeFilter = 'all', searchQuery = '', sortMode = 'default';
let projects = [];
let activeView = 'tracks'; // 'tracks' | 'projects' | 'project-detail' | 'history' | 'artist'
let activeProjectId = null;
let activeArtistName = null;
const PROJECTS_KEY = 'vault-projects-v1';
let currentTrackIdx = -1, isPlaying = false;
let uploadedFile = null, uploadedDataUrl = null, activeTab = 'link';

// ===== PLAY COUNTS =====
const PLAY_COUNT_KEY = 'vault-play-counts';
function getPlayCounts() {
  try { return JSON.parse(localStorage.getItem(PLAY_COUNT_KEY) || '{}'); } catch { return {}; }
}
function incrementPlayCount(id) {
  const counts = getPlayCounts();
  counts[id] = (counts[id] || 0) + 1;
  localStorage.setItem(PLAY_COUNT_KEY, JSON.stringify(counts));
}
function getPlayCount(id) { return getPlayCounts()[id] || 0; }

// ===== RECENTLY PLAYED =====
const RECENTLY_KEY = 'vault-recently-played';
const RECENTLY_MAX = 10;
function getRecentlyPlayed() {
  try { return JSON.parse(localStorage.getItem(RECENTLY_KEY) || '[]'); } catch { return []; }
}
function addToRecentlyPlayed(id) {
  let list = getRecentlyPlayed().filter(x => x !== id);
  list.unshift(id);
  list = list.slice(0, RECENTLY_MAX);
  localStorage.setItem(RECENTLY_KEY, JSON.stringify(list));
}
function renderRecentlyPlayed() {
  const section = document.getElementById('recently-played-section');
  const strip   = document.getElementById('recently-strip');
  const list    = getRecentlyPlayed();
  const found   = list.map(id => tracks.find(t => t.id === id)).filter(Boolean);
  if (!found.length) { section.classList.remove('visible'); return; }
  section.classList.add('visible');
  strip.innerHTML = found.map(t => `
    <div class="recently-chip" onclick="handlePlay(${t.id})" title="${escHtml(t.artist)} — ${escHtml(t.title)}">
      ${t.coverArt
        ? `<img src="${t.coverArt}" alt="" loading="lazy">`
        : `<div style="width:28px;height:28px;background:var(--surface3);flex-shrink:0;border-radius:2px;display:flex;align-items:center;justify-content:center;font-size:10px">♪</div>`}
      <div class="recently-chip-info">
        <div class="recently-chip-title">${escHtml(t.title)}</div>
        <div class="recently-chip-artist">${escHtml(t.artist)}</div>
      </div>
    </div>`).join('');
}

// ===== QUEUE =====
let queue = []; // array of track IDs
let queueOpen = false;

function renderQueue() {
  const list    = document.getElementById('queue-list');
  const empty   = document.getElementById('queue-empty');
  const countEl = document.getElementById('queue-count');
  const toggleBtn = document.getElementById('queue-toggle-btn');
  countEl.textContent = queue.length ? `(${queue.length})` : '';
  toggleBtn.classList.toggle('active', queue.length > 0 || queueOpen);
  if (!queue.length) {
    empty.style.display = 'block';
    // Remove any existing items but keep the empty message
    list.querySelectorAll('.queue-item').forEach(el => el.remove());
    return;
  }
  empty.style.display = 'none';
  const items = queue.map((id, qi) => {
    const t = tracks.find(x => x.id === id);
    if (!t) return '';
    const isNow = isPlaying && getPlaylist()[currentTrackIdx]?.id === id && qi === 0;
    return `<div class="queue-item${isNow ? ' now-playing' : ''}" data-qi="${qi}">
      ${t.coverArt
        ? `<img src="${t.coverArt}" alt="" loading="lazy">`
        : `<div style="width:36px;height:36px;background:var(--surface3);border-radius:2px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">♪</div>`}
      <div class="queue-item-info" onclick="playFromQueue(${qi})">
        <div class="queue-item-title">${escHtml(t.title)}</div>
        <div class="queue-item-artist">${escHtml(t.artist)}</div>
      </div>
      <button class="queue-item-remove" onclick="removeFromQueue(${qi})" title="Remove">✕</button>
    </div>`;
  }).join('');
  // Re-render only items, keeping empty message in DOM
  list.querySelectorAll('.queue-item').forEach(el => el.remove());
  list.insertAdjacentHTML('afterbegin', items);
}
function addToQueue(id) {
  if (queue.includes(id)) { showToast('ALREADY IN QUEUE', ''); return; }
  queue.push(id);
  renderQueue();
  showToast('ADDED TO QUEUE ✓', 'success');
  // Sync to collab queue if session is active
  const vs = window._vaultSession;
  if (vs && vs.isActive && vs.role === 'host' && typeof window._addToCollabQueue === 'function') {
    const t = tracks.find(x => x.id === id);
    if (t) window._addToCollabQueue({ trackId: String(t.id), title: t.title, artist: t.artist });
  }
}
function removeFromQueue(qi) {
  queue.splice(qi, 1);
  renderQueue();
}
function playFromQueue(qi) {
  const id = queue[qi];
  queue.splice(qi, 1);
  const t = tracks.find(x => x.id === id);
  if (!t) return;
  const playlist = getPlaylist();
  const idx = playlist.findIndex(x => x.id === id);
  if (idx !== -1) { playAtIndex(idx); } else { showToast('TRACK NOT IN CURRENT VIEW', 'error'); }
  renderQueue();
}
function openQueuePanel() {
  queueOpen = true;
  document.getElementById('queue-panel').classList.add('open');
  document.getElementById('queue-toggle-btn').classList.add('active');
  document.body.classList.add('queue-open');
}
function closeQueuePanel() {
  queueOpen = false;
  document.getElementById('queue-panel').classList.remove('open');
  document.getElementById('queue-toggle-btn').classList.toggle('active', queue.length > 0);
  document.body.classList.remove('queue-open');
}
document.getElementById('queue-toggle-btn').addEventListener('click', () => {
  if (queueOpen) closeQueuePanel(); else openQueuePanel();
});
document.getElementById('queue-close-btn').addEventListener('click', closeQueuePanel);
document.getElementById('queue-clear-btn').addEventListener('click', () => {
  queue = []; renderQueue(); showToast('QUEUE CLEARED', '');
});

function getPlaylist() { return getFiltered(); }
function getFilteredAll() { return getFiltered(); }

function getFiltered() {
  let list = tracks.filter(t => {
    const matchFilter = activeFilter === 'all' || t.artist === activeFilter;
    const q = searchQuery.toLowerCase();
    const matchSearch = !q ||
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      (t.tags||[]).some(tag => tag.toLowerCase().includes(q));
    return matchFilter && matchSearch;
  });
  if (sortMode === 'trending') {
    const counts = getPlayCounts();
    list = [...list].sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0));
  } else if (sortMode === 'az') {
    list = [...list].sort((a, b) => a.title.localeCompare(b.title));
  }
  // Invalidate preload buffers when playlist order changes
  _preloadMap.clear();
  preloadNext.src = '';
  preloadPrev.src = '';
  return list;
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
    b.className = 'filter-btn artist-link' + (activeFilter===a?' active':'');
    b.dataset.filter = a;
    b.dataset.artist = a;
    b.textContent = a.toUpperCase().slice(0,14);
    b.style.color = getArtistColor(a);
    fb.appendChild(b);
  });
  fb.querySelectorAll('.filter-btn').forEach(b => {
    b.addEventListener('click', () => {
      if (b.dataset.filter !== 'all' && typeof openArtistPage === 'function') {
        openArtistPage(b.dataset.filter);
        return;
      }
      activeFilter = b.dataset.filter;
      fb.querySelectorAll('.filter-btn').forEach(x => x.classList.toggle('active', x.dataset.filter===activeFilter));
      if (activeFilter !== 'all') { setArtistBG(activeFilter); showArtistHeader(activeFilter); }
      else { setDefaultBG(); hideArtistHeader(); }
      setView('tracks');
    });
  });

  // PROJECTS and HISTORY view buttons — injected once
  const sortWrap = document.querySelector('.sort-wrap');
  if (sortWrap && !sortWrap.querySelector('.view-btn')) {
    const projectsBtn = document.createElement('button');
    projectsBtn.className = 'sort-btn view-btn' + (activeView === 'projects' || activeView === 'project-detail' ? ' active' : '');
    projectsBtn.id = 'projects-view-btn';
    projectsBtn.textContent = '⊞ Projects';
    projectsBtn.addEventListener('click', () => {
      if (activeView === 'projects' || activeView === 'project-detail') { setView('tracks'); }
      else { setView('projects'); }
    });

    const historyBtn = document.createElement('button');
    historyBtn.className = 'sort-btn view-btn' + (activeView === 'history' ? ' active' : '');
    historyBtn.id = 'history-view-btn';
    historyBtn.textContent = '◷ History';
    historyBtn.addEventListener('click', () => {
      if (activeView === 'history') { setView('tracks'); }
      else { setView('history'); }
    });

    const statsBtn = document.createElement('button');
    statsBtn.className = 'sort-btn view-btn' + (activeView === 'stats' ? ' active' : '');
    statsBtn.id = 'stats-view-btn';
    statsBtn.textContent = '◈ Stats';
    statsBtn.addEventListener('click', () => {
      if (activeView === 'stats') { setView('tracks'); }
      else { setView('stats'); }
    });

    const selectBtn = document.createElement('button');
    selectBtn.className = 'sort-btn view-btn';
    selectBtn.id = 'select-mode-btn';
    selectBtn.textContent = '☐ Select';
    selectBtn.addEventListener('click', () => {
      if (selectionMode) exitSelectionMode(); else enterSelectionMode();
    });

    sortWrap.appendChild(projectsBtn);
    sortWrap.appendChild(historyBtn);
    sortWrap.appendChild(statsBtn);
    sortWrap.appendChild(selectBtn);
  }
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
  const counts = getPlayCounts();
  grid.innerHTML = list.map((t, idx) => {
    const pal = getArtistPalette(t.artist);
    const color = pal.primary;
    // Compute rgba helpers for CSS overlays (needed because we can't add opacity to hex vars in CSS)
    const secR = parseInt(pal.secondary.slice(1,3),16), secG = parseInt(pal.secondary.slice(3,5),16), secB = parseInt(pal.secondary.slice(5,7),16);
    const glowR = parseInt(pal.glow.slice(1,3),16), glowG = parseInt(pal.glow.slice(3,5),16), glowB = parseInt(pal.glow.slice(5,7),16);
    const tags = (t.tags||[]).map(tag=>`<span class="tag">${escHtml(tag)}</span>`).join('');
    const proj = t.projectId ? projects.find(p => p.id === t.projectId) : null;
    const projBadge = proj ? `<button class="track-project-badge" onclick="event.stopPropagation();openProjectDetail('${proj.id}')" title="${escHtml(proj.title)}">${escHtml(proj.title.slice(0,12))}</button>` : '';
    const hasAudio = !!t.url;
    const pIdx = playlist.findIndex(x=>x.id===t.id);
    const isCurrentlyPlaying = currentTrackIdx === pIdx && isPlaying;
    const sourceBadge = t.type === 'cloudinary' ? `<span class="source-badge cloudinary">☁ CDN</span>` : t.type === 'file' ? `<span class="source-badge file">📁 LOCAL</span>` : '';
    const coverSrc = t.coverArt || '';
    const plays = counts[t.id] || 0;
    const fireBadge = plays >= 5 ? `<span class="track-fire-badge" title="${plays} plays">🔥</span>` : '';
    const playCountEl = plays > 0 ? `<div class="track-play-count${plays >= 5 ? ' hot' : ''}">${plays} play${plays !== 1 ? 's' : ''}</div>` : '';
    const notesEl = t.notes ? `<div class="track-notes-preview" title="${escHtml(t.notes)}">📝 ${escHtml(t.notes)}</div>` : '';
    const cCount = commentCounts && commentCounts.get(t.id) || 0;
    const commentBadgeEl = `<span class="track-comment-badge" data-comment-track="${t.id}">${cCount > 0 ? '💬 ' + cCount : ''}</span>`;
    return `
      <div class="track-card${isCurrentlyPlaying?' playing':''}" style="--artist-color:${color};--artist-primary:${pal.primary};--artist-secondary:${pal.secondary};--artist-text:${pal.text};--artist-glow:${pal.glow};--artist-gradient-start:${pal.gradient[0]};--artist-gradient-end:${pal.gradient[1]};--artist-secondary-bg:rgba(${secR},${secG},${secB},0.42);--artist-glow-30:rgba(${glowR},${glowG},${glowB},0.30)" data-id="${t.id}" data-url="${t.url||''}">
        <div class="track-card-top">
          ${coverSrc ? `<img class="track-cover loaded" src="${coverSrc}" alt="cover" loading="lazy">` : `<img class="track-cover" src="" data-fetch-cover="${t.id}" alt="cover">`}
          <div class="track-card-meta">
            <div class="track-artist"><span class="artist-link" onclick="event.stopPropagation();openArtistPage('${t.artist.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')">${escHtml(t.artist)}</span>${sourceBadge}${fireBadge}${projBadge}</div>
            <div class="track-title">${escHtml(t.title)}</div>
          </div>
        </div>
        <div class="track-bottom">
          <div class="track-tags">${tags}</div>
          <div class="track-actions">
            ${hasAudio ? `<button class="icon-btn play-btn${isCurrentlyPlaying?' active':''}" onclick="handlePlay(${t.id})" title="${isCurrentlyPlaying?'Pause':'Play'}">${isCurrentlyPlaying?'⏸':'▶'}</button>` : ''}
            ${t.url && t.type!=='file' ? `<button class="icon-btn" title="Download" style="color:var(--muted)" onclick="downloadTrack(${t.id})">↓</button>` : ''}
            <button class="icon-btn queue-btn" onclick="addToQueue(${t.id})" title="Add to Queue">+</button>
            <button class="icon-btn" onclick="copyLink(${t.id})" title="Copy">⟁</button>
            <button class="icon-btn edit-btn" onclick="openEditModal(${t.id})" title="Edit">✎</button>
            <button class="icon-btn delete-btn" onclick="deleteTrack(${t.id})" title="Delete">✕</button>
          </div>
        </div>
        ${commentBadgeEl}
        ${playCountEl}
        ${notesEl}
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
  const pal = getArtistPalette(artist);
  const color = pal.primary;
  document.getElementById('artist-header').classList.add('visible');
  document.getElementById('artist-header').style.setProperty('--artist-glow', hexToRgba(pal.glow, 0.12));
  document.getElementById('artist-header').style.setProperty('--artist-primary', pal.primary);
  const avatar = document.getElementById('artist-avatar');
  avatar.style.color = color;
  avatar.style.borderColor = color;
  avatar.textContent = artist.slice(0,2).toUpperCase();
  const nameEl = document.getElementById('artist-name-display');
  nameEl.textContent = artist.toUpperCase();
  nameEl.style.color = pal.text || color;
  const count = tracks.filter(t=>t.artist===artist).length;
  document.getElementById('artist-track-count').textContent = `${count} TRACK${count!==1?'S':''} IN VAULT`;
}
function hideArtistHeader() { document.getElementById('artist-header').classList.remove('visible'); }

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}

// ===== PLAYER =====
const audio    = document.getElementById('audio-player');
const audioXfade = document.getElementById('audio-xfade');
const playerBar  = document.getElementById('player-bar');

// CORS FIX: must be set ONCE before any src is ever assigned.
audio.crossOrigin    = 'anonymous';
audioXfade.crossOrigin = 'anonymous';

// ===== PRELOAD SYSTEM =====
// Two hidden <audio> elements buffer the next and previous tracks in the
// background so skipping feels instant instead of waiting on Cloudinary.
const preloadNext = new Audio();
const preloadPrev = new Audio();
preloadNext.crossOrigin = 'anonymous';
preloadPrev.crossOrigin = 'anonymous';
preloadNext.preload = 'auto';
preloadPrev.preload = 'auto';

// Map of url → preload Audio element so we can detect a cache hit
const _preloadMap = new Map(); // url → Audio element

// Cover art image cache — preload cover Images so vinyl swap is instant
const _coverCache = new Map(); // url → Image element

function _preloadCoverArt(url) {
  if (!url || _coverCache.has(url)) return;
  const img = new Image();
  img.src = url;
  _coverCache.set(url, img);
}

// Returns the index of the track that will play next, respecting queue/shuffle/loop.
function _getNextIdx() {
  const pl = getPlaylist();
  if (!pl.length) return 0;
  if (isLooping) return currentTrackIdx;
  if (queue.length) {
    const qi = pl.findIndex(t => t.id === queue[0]);
    return qi !== -1 ? qi : 0;
  }
  if (isShuffled) return Math.floor(Math.random() * pl.length);
  return currentTrackIdx >= pl.length - 1 ? 0 : currentTrackIdx + 1;
}

function schedulePreload(playlist, idx) {
  // Preload up to 2 tracks ahead and 1 behind (non-blocking, low priority)
  const toPreload = [];
  if (idx + 1 < playlist.length)  toPreload.push({ el: preloadNext, track: playlist[idx + 1] });
  if (idx - 1 >= 0)               toPreload.push({ el: preloadPrev, track: playlist[idx - 1] });
  // Wrap-around
  if (idx === 0 && playlist.length > 1)
    toPreload.push({ el: preloadPrev, track: playlist[playlist.length - 1] });
  if (idx === playlist.length - 1 && playlist.length > 1)
    toPreload.push({ el: preloadNext, track: playlist[0] });

  toPreload.forEach(({ el, track }) => {
    if (!track || !track.url || track.type === 'file') return;
    if (el.src === track.url) return; // already buffering this one
    el.src = track.url;
    el.load();
    _preloadMap.set(track.url, el);
    // Also preload cover art
    if (track.coverArt) _preloadCoverArt(track.coverArt);
  });
}

// When we skip to a track, check if a preloader has already buffered it.
// If so, swap its buffer into the main audio element for instant start.
function getPreloadedBuffer(url) {
  return _preloadMap.get(url) || null;
}

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

function dismissYtBar() {
  if (!window.ytPlayer) return;
  var bar = document.getElementById('yt-inline-bar');
  if (!bar || !bar.classList.contains('active')) return;
  try {
    if (window.ytPlayer.player) window.ytPlayer.player.stopVideo();
  } catch(e) {}
  bar.classList.remove('active');
  setTimeout(function() {
    if (window.ytPlayer) {
      window.ytPlayer._resetBtn(window.ytPlayer._activeBtnId);
      window.ytPlayer._activeBtnId  = null;
      window.ytPlayer.currentArtist = null;
      window.ytPlayer.currentTrack  = null;
      if (typeof window.ytPlayer.hide === 'function') window.ytPlayer.hide();
    }
  }, 400);
}

function playAtIndex(idx) {
  const playlist = getPlaylist();
  if (idx < 0 || idx >= playlist.length) return;
  const t = playlist[idx];
  if (!t.url) { showToast('NO AUDIO SOURCE — ADD A URL OR FILE', 'error'); return; }
  currentTrackIdx = idx;

  // ── Cancel any in-progress crossfade before hard-switching ──────────────
  if (xfadeTimer) { clearTimeout(xfadeTimer); xfadeTimer = null; }
  if (gainMain && audioCtx) {
    const _now = audioCtx.currentTime;
    gainMain.gain.cancelScheduledValues(_now);
    gainMain.gain.setValueAtTime(1, _now);
    gainXfade.gain.cancelScheduledValues(_now);
    gainXfade.gain.setValueAtTime(0, _now);
  }
  if (audioXfade && audioXfade.src) {
    audioXfade.pause();
    audioXfade.src = '';
    audioXfade.load();
  }
  isXfading = false;
  gaplessTriggered = false;

  // ── Preload hit: swap the already-buffered element's src into main audio ──
  // We can't transfer the buffer directly, but re-assigning the same URL after
  // the browser has already cached/started fetching it is near-instant.
  // Clean up preload map so we don't accidentally reuse stale entries.
  _preloadMap.delete(t.url);

  // crossOrigin is already set to 'anonymous' at init time (above).
  // We just assign src and play — no retry needed.
  audio.src = t.url;
  audio.load();
  audio.volume = parseFloat(document.getElementById('volume-slider').value);
  _decodePCM(t.url); // async PCM fingerprint — non-blocking
  if (typeof loadComments === 'function') loadComments(String(t.id)); // Feature 3

  dismissYtBar();
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

  applyArtistPalette(t.artist);
  applyVizArtistConfig(t.artist);
  _updateMediaSession();
  const color = getArtistPalette(t.artist).primary;
  document.getElementById('player-title').textContent = t.title;
  const _paEl = document.getElementById('player-artist');
  _paEl.textContent = t.artist.toUpperCase();
  _paEl.classList.add('artist-link');
  _paEl.onclick = (e) => { e.stopPropagation(); openArtistPage(t.artist); };
  const ppBtn = document.getElementById('play-pause-btn');
  ppBtn.innerHTML = '⏸';
  ppBtn.classList.add('is-playing');
  ppBtn.style.background = color;
  document.getElementById('player-vinyl').classList.add('spinning');
  playerBar.classList.add('visible');
  setArtistBG(t.artist);
  showCanvas(t);       // ◈ Vault Canvas
  maybeFetchLyrics(t); // ♩ Lyrics
  maybeLoadStems(t);   // ⊕ Stems

  // Log for session history (host side)
  if (window._vaultSession && window._vaultSession.isActive && window._vaultSession.role === 'host') {
    if (typeof window.logSessionTrack === 'function') window.logSessionTrack(t.title, t.artist);
  }

  // Track play count + recently played
  incrementPlayCount(t.id);
  addToRecentlyPlayed(t.id);
  renderRecentlyPlayed();
  renderQueue();

  // Load cover art into vinyl — use preloaded Image if available
  const vinylImg = document.getElementById('player-cover-img');
  vinylImg.classList.remove('loaded');
  if (t.coverArt) {
    vinylImg.src = t.coverArt;
    // If image was preloaded it may already be complete
    if (vinylImg.complete) { vinylImg.classList.add('loaded'); }
    else { vinylImg.onload = () => vinylImg.classList.add('loaded'); }
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

  // Schedule background preloading of adjacent tracks (deferred so current
  // track gets full bandwidth priority for the first ~800 ms)
  setTimeout(() => schedulePreload(playlist, idx), 800);
}

document.getElementById('play-pause-btn').addEventListener('click', () => {
  if (!audio.src) return;
  _cancelSleepFade();
  const ppBtn = document.getElementById('play-pause-btn');
  if (isPlaying) {
    audio.pause(); isPlaying = false;
    ppBtn.innerHTML = '▶'; ppBtn.classList.remove('is-playing');
    document.getElementById('player-vinyl').classList.remove('spinning');
    stopWaveform();
    hideCanvas();
  } else {
    dismissYtBar();
    audio.play(); isPlaying = true;
    ppBtn.innerHTML = '⏸'; ppBtn.classList.add('is-playing');
    document.getElementById('player-vinyl').classList.add('spinning');
    // startWaveform fires via 'playing' event
  }
  renderTracks();
});

document.getElementById('prev-btn').addEventListener('click', () => {
  _cancelSleepFade();
  const playlist = getPlaylist();
  if (playlist.length === 0) return;
  const newIdx = isShuffled
    ? Math.floor(Math.random() * playlist.length)
    : (currentTrackIdx <= 0 ? playlist.length - 1 : currentTrackIdx - 1);
  crossfadeTo(newIdx);
});
document.getElementById('next-btn').addEventListener('click', () => {
  _cancelSleepFade();
  const playlist = getPlaylist();
  if (playlist.length === 0) return;
  const newIdx = isShuffled
    ? Math.floor(Math.random() * playlist.length)
    : (currentTrackIdx >= playlist.length - 1 ? 0 : currentTrackIdx + 1);
  crossfadeTo(newIdx);
});

audio.addEventListener('ended', () => {
  if (isLooping) return; // audio.loop handles it
  // End-of-track sleep mode: fade out instead of advancing
  if (_sleepEOT) {
    _sleepEOT = false;
    _startSleepFade(10000); // 10s fade on EOT
    return;
  }
  gaplessTriggered = false; // reset gapless flag for next track
  isXfading = false;        // ensure clean state
  // Reset gain to 1 in case a fade was in progress
  if (gainMain && audioCtx) gainMain.gain.setValueAtTime(1, audioCtx.currentTime);
  // Queue takes priority over shuffle/normal
  if (queue.length) {
    playFromQueue(0);
    return;
  }
  const playlist = getPlaylist();
  const newIdx = isShuffled
    ? Math.floor(Math.random() * playlist.length)
    : (currentTrackIdx >= playlist.length - 1 ? 0 : currentTrackIdx + 1);
  // "You Might Like" — show suggestions before auto-advance (natural track end only)
  const _sessionOn = !!document.getElementById('session-btn')?.classList.contains('session-active');
  if (!_sleepFading && !_sleepEOT && !_sessionOn && playlist.length >= 5) {
    const shown = _showYML(newIdx);
    if (!shown) playAtIndex(newIdx);
  } else {
    playAtIndex(newIdx);
  }
});

// ===== WAVEFORM VISUALIZER (live frequency-reactive) =====
const waveCanvas = document.getElementById('waveform-canvas');
const waveCtx = waveCanvas.getContext('2d');
let analyser, sourceNode, audioCtx, freqData, waveAnimFrame;
let smoothedBars = [];

let waveformMuteGain = null; // controls speaker output independently of analyser
let _waveLastDrawTime = -1; // FIX: Waveform vs scrubber — throttle PCM-mode redraws — The Vault conflict resolution

// ── Crossfade nodes ──────────────────────────────────────────────────────────
let gainMain = null, gainXfade = null;
let sourceNodeXfade = null;
let xfadeDuration = 2;   // seconds (0 = instant)
let xfadeTimer = null;
let isXfading = false;

// ── EQ / FX nodes ────────────────────────────────────────────────────────────
let eqBass = null, eqMid = null, eqTreble = null;
let reverbDryGain = null, reverbWetGain = null, convolver = null, reverbMerge = null;
let lofiHighCut = null, lofiDistort = null;

// ── Gapless playback ─────────────────────────────────────────────────────────
let gaplessEnabled = true;
let gaplessTriggered = false;  // prevents double-trigger per track

// ── Pitch shift ──────────────────────────────────────────────────────────────
let pitchNode = null;
let pitchNodeXfade = null; // FIX: Pitch shift vs crossfade conflict — separate pitch node for xfade path — The Vault conflict resolution
let pitchSemitones = 0;
let pitchWorkletReady = false;

function setupAudioContext() {
  if (audioCtx && sourceNode) return; // already wired up — do nothing
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    // ── Crossfade gain nodes ─────────────────────────────────────────
    gainMain  = audioCtx.createGain(); gainMain.gain.value  = 1;
    gainXfade = audioCtx.createGain(); gainXfade.gain.value = 0;

    // ── EQ filters ───────────────────────────────────────────────────
    eqBass = audioCtx.createBiquadFilter();
    eqBass.type = 'lowshelf'; eqBass.frequency.value = 80; eqBass.gain.value = 0;

    eqMid = audioCtx.createBiquadFilter();
    eqMid.type = 'peaking'; eqMid.frequency.value = 1000; eqMid.Q.value = 1.2; eqMid.gain.value = 0;

    eqTreble = audioCtx.createBiquadFilter();
    eqTreble.type = 'highshelf'; eqTreble.frequency.value = 8000; eqTreble.gain.value = 0;

    // ── Reverb (dry / wet parallel paths) ────────────────────────────
    reverbDryGain = audioCtx.createGain(); reverbDryGain.gain.value = 1;
    reverbWetGain = audioCtx.createGain(); reverbWetGain.gain.value = 0;
    convolver = audioCtx.createConvolver();
    reverbMerge = audioCtx.createGain(); reverbMerge.gain.value = 1;
    _buildIR(); // generate impulse response buffer

    // ── Lo-fi chain ───────────────────────────────────────────────────
    lofiHighCut = audioCtx.createBiquadFilter();
    lofiHighCut.type = 'highshelf';
    lofiHighCut.frequency.value = 3500;
    lofiHighCut.gain.value = 0;  // 0 dB = bypass

    lofiDistort = audioCtx.createWaveShaper();
    lofiDistort.oversample = '2x';
    // curve = null means identity / bypass

    // ── Waveform analyser & output gain ─────────────────────────────
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.7;
    freqData = new Uint8Array(analyser.frequencyBinCount);

    waveformMuteGain = audioCtx.createGain();
    waveformMuteGain.gain.value = 1;

    // ── Source nodes ─────────────────────────────────────────────────
    if (!sourceNode) {
      sourceNode = audioCtx.createMediaElementSource(audio);
    }
    if (!sourceNodeXfade) {
      sourceNodeXfade = audioCtx.createMediaElementSource(audioXfade);
    }

    // ── Wire the full signal chain ───────────────────────────────────
    // sourceNode    → gainMain  ─┐
    //                             ├→ eqBass → eqMid → eqTreble
    // sourceNodeXfade → gainXfade ┘            ↓
    //                                  [reverb dry/wet split]
    //                             reverbDryGain ──────────────────────┐
    //                             convolver → reverbWetGain ──────────┤
    //                                                           reverbMerge
    //                                                                ↓
    //                                               lofiHighCut → lofiDistort
    //                                                                ↓
    //                                                            analyser
    //                                                                ↓
    //                                                       waveformMuteGain
    //                                                                ↓
    //                                                           destination

    sourceNode.connect(gainMain);
    sourceNodeXfade.connect(gainXfade);

    gainMain.connect(eqBass);
    gainXfade.connect(eqBass);

    eqBass.connect(eqMid);
    eqMid.connect(eqTreble);

    // Reverb split
    eqTreble.connect(reverbDryGain);
    eqTreble.connect(convolver);
    reverbDryGain.connect(reverbMerge);
    convolver.connect(reverbWetGain);
    reverbWetGain.connect(reverbMerge);

    // Lo-fi → analyser → output
    reverbMerge.connect(lofiHighCut);
    lofiHighCut.connect(lofiDistort);
    lofiDistort.connect(analyser);
    analyser.connect(waveformMuteGain);
    waveformMuteGain.connect(audioCtx.destination);

    // Viz analyser taps from eqBass (sees both gainMain + gainXfade mixed)
    if (typeof setupVizAnalyser === 'function') setupVizAnalyser();

  } catch(e) {
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

  if (!W || !H) {
    waveAnimFrame = requestAnimationFrame(drawWaveform);
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const bufW = Math.round(W * dpr);
  const bufH = Math.round(H * dpr);
  if (waveCanvas.width !== bufW || waveCanvas.height !== bufH) {
    waveCanvas.width  = bufW;
    waveCanvas.height = bufH;
  }

  waveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  waveCtx.clearRect(0, 0, W, H);

  const rawColor = getComputedStyle(document.getElementById('player-bar'))
    .getPropertyValue('--current-color').trim() || '#c41e3a';
  // Use the richer glow color for oscilloscope stroke lines
  const glowColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--artist-glow').trim() || rawColor;
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

  // Use static PCM fingerprint only when paused — while playing, live FFT drives the animation
  const _pcmDisplay = _getPCMBars(BAR_COUNT);
  // Animated shimmer while PCM decodes
  const _needsShimmer = !_pcmDisplay && !!audio.src && !isPlaying;
  let activeBars;
  if (_pcmDisplay && !isPlaying) {
    activeBars = _pcmDisplay;
  } else if (_needsShimmer) {
    const _st = Date.now() * 0.003;
    activeBars = Array.from({length: BAR_COUNT}, (_, i) =>
      (0.2 + Math.sin(i * 0.3 + _st) * 0.15) * 255);
  } else {
    activeBars = smoothedBars; // live FFT fallback
  }

  // FIX: Waveform vs scrubber conflict — throttle redraws in PCM static mode when paused — The Vault conflict resolution
  if (_pcmDisplay && !isPlaying && !isScrubbing) {
    const _ct = audio.currentTime;
    if (Math.abs(_ct - _waveLastDrawTime) < 0.1) {
      waveAnimFrame = requestAnimationFrame(drawWaveform);
      return;
    }
    _waveLastDrawTime = _ct;
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
        const amp = (activeBars[i] / 255) * (H * 0.44);
        const y = midY - Math.max(2, amp);
        if (i === 0) waveCtx.moveTo(x, y);
        else waveCtx.lineTo(x, y);
      }
      // Lower line (mirror, drawn back)
      for (let i = BAR_COUNT - 1; i >= 0; i--) {
        const x = (i / (BAR_COUNT - 1)) * W;
        const amp = (activeBars[i] / 255) * (H * 0.44);
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
        const amp = (activeBars[i] / 255) * (H * 0.44);
        const y = midY - Math.max(2, amp);
        if (i === 0) waveCtx.moveTo(x, y);
        else waveCtx.lineTo(x, y);
      }
      waveCtx.strokeStyle = isPastPass ? glowColor : glowColor + '44';
      waveCtx.lineWidth = 1.5;
      waveCtx.globalAlpha = isPastPass ? 1 : 0.4;
      waveCtx.stroke();

      waveCtx.beginPath();
      for (let i = 0; i < BAR_COUNT; i++) {
        const x = (i / (BAR_COUNT - 1)) * W;
        const amp = (activeBars[i] / 255) * (H * 0.44);
        const y = midY + Math.max(2, amp);
        if (i === 0) waveCtx.moveTo(x, y);
        else waveCtx.lineTo(x, y);
      }
      waveCtx.stroke();

      waveCtx.restore();
    }

    // Playhead line — use glow color for extra pop
    waveCtx.globalAlpha = 0.9;
    waveCtx.beginPath();
    waveCtx.moveTo(playheadX, 4);
    waveCtx.lineTo(playheadX, H - 4);
    waveCtx.strokeStyle = glowColor;
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
      const rawH = (activeBars[i] / 255) * H;
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

  // Comment markers (Feature 3)
  _drawCommentDots(W, H);

  waveAnimFrame = requestAnimationFrame(drawWaveform);
}

function _drawCommentDots(W, H) {
  var cmts = window._trackComments;
  if (!cmts || !cmts.length || !audio.duration) return;
  var dur = audio.duration;
  waveCtx.save();
  waveCtx.shadowBlur = 0;
  waveCtx.globalAlpha = 0.85;
  cmts.forEach(function(cm) {
    var cx = (cm.timestamp / dur) * W;
    if (cx < 0 || cx > W) return;
    waveCtx.fillStyle = '#fff';
    waveCtx.beginPath();
    waveCtx.arc(cx, H - 5, 3, 0, Math.PI * 2);
    waveCtx.fill();
  });
  waveCtx.restore();
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

// ── PCM amplitude waveform (static fingerprint) ───────────────────────────────
const _pcmCache = new Map();
let _pcmLoadingUrl = null;

// Comment markers — populated by loadComments() (Feature 3)
window._trackComments = [];

async function _decodePCM(url) {
  if (!url || _pcmCache.has(url) || _pcmLoadingUrl === url) return;
  _pcmLoadingUrl = url;
  try {
    setupAudioContext();
    const resp = await fetch(url, { mode: 'cors' });
    const buf  = await resp.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(buf);
    const isMobile = window.innerWidth < 768;
    const BAR_COUNT = isMobile ? 120 : 200;
    const channels  = decoded.numberOfChannels;
    const totalLen  = decoded.length;
    const chunkSize = Math.floor(totalLen / BAR_COUNT);
    const result    = new Float32Array(BAR_COUNT);
    for (let i = 0; i < BAR_COUNT; i++) {
      let rms = 0;
      for (let c = 0; c < channels; c++) {
        const data  = decoded.getChannelData(c);
        const start = i * chunkSize;
        const end   = Math.min(start + chunkSize, totalLen);
        let sum = 0;
        for (let j = start; j < end; j++) sum += data[j] * data[j];
        rms += Math.sqrt(sum / (end - start));
      }
      result[i] = rms / channels;
    }
    const maxVal = Math.max(...result, 0.0001);
    for (let i = 0; i < BAR_COUNT; i++) result[i] /= maxVal;
    _pcmCache.set(url, result);
  } catch (e) {
    // CORS or decode failure — live FFT bars will be used as fallback
  } finally {
    if (_pcmLoadingUrl === url) _pcmLoadingUrl = null;
  }
}

function _getPCMBars(count) {
  if (!audio.src) return null;
  const data = _pcmCache.get(audio.src);
  if (!data) return null;
  const result = new Float32Array(count);
  const srcLen = data.length;
  for (let i = 0; i < count; i++) {
    result[i] = data[Math.floor((i / count) * srcLen)] * 255;
  }
  return result;
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
    .getPropertyValue('--current-color').trim() || '#c41e3a';

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
  if (e.shiftKey) {
    if (!audio.duration) return;
    e.preventDefault();
    var ts = getScrubPos(e) * audio.duration;
    _openCommentInput(ts);
    return;
  }
  if (!audio.duration) return;
  isScrubbing = true;
  scrubProgress = getScrubPos(e);
  showScrubTooltip(scrubProgress, e);
  waveCanvas.style.cursor = 'grabbing';
});

waveCanvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!audio.duration) return;
  var t = Math.floor(getScrubPos(e) * audio.duration);
  copyTimestamp(t);
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

waveCanvas.addEventListener('mousemove', (e) => {
  if (isScrubbing) return;
  showScrubTooltip(getScrubPos(e), e);
  // Check if hovering over a comment marker
  const _cmTip = document.getElementById('comment-hover-tooltip');
  if (!_cmTip || !window._trackComments || !audio.duration) return;
  const _rect = waveCanvas.getBoundingClientRect();
  const _mx   = e.clientX - _rect.left;
  const _W    = _rect.width;
  const _hovered = window._trackComments.find(cm => {
    return Math.abs((cm.timestamp / audio.duration) * _W - _mx) < 8;
  });
  if (_hovered) {
    _cmTip.textContent = _hovered.authorName + ': ' + _hovered.text;
    _cmTip.style.left    = _mx + 'px';
    _cmTip.style.display = 'block';
  } else {
    _cmTip.style.display = 'none';
  }
});

waveCanvas.addEventListener('mouseleave', () => {
  if (!isScrubbing) scrubTooltip.classList.remove('visible');
  const _cmTip = document.getElementById('comment-hover-tooltip');
  if (_cmTip) _cmTip.style.display = 'none';
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
  _historyTimeUpdate();

  // ── T-10s: pre-buffer the next track into audioXfade so the crossfade
  //    starts instantly with no network wait. Only for tracks > 15s.
  // FIX: Sleep timer vs gapless conflict — skip preload during sleep fade — The Vault conflict resolution
  if (gaplessEnabled && !isXfading && !gaplessTriggered && !isLooping && !_sleepFading && audio.duration > 15) {
    const _remaining = audio.duration - audio.currentTime;
    const _triggerAt = Math.max(0.5, xfadeDuration) + 0.25;
    if (_remaining > _triggerAt && _remaining <= 10) {
      const _ni = _getNextIdx();
      const _nt = getPlaylist()[_ni];
      if (_nt && _nt.url && audioXfade.src !== _nt.url) {
        audioXfade.src = _nt.url;
        audioXfade.load();         // buffer silently — no play() call
      }
    }
  }

  // ── Gapless playback ─────────────────────────────────────────────
  // When the track is within (xfadeDuration + 0.5s) of ending, start
  // the crossfade automatically so the next track begins seamlessly.
  // FIX: Sleep timer vs gapless conflict — skip crossfade trigger during sleep fade — The Vault conflict resolution
  if (gaplessEnabled && !isXfading && !gaplessTriggered && !isLooping && !_sleepFading) {
    const remaining = audio.duration - audio.currentTime;
    const triggerAt  = Math.max(0.5, xfadeDuration) + 0.25;
    if (remaining > 0 && remaining <= triggerAt) {
      gaplessTriggered = true;
      if (queue.length) {
        playFromQueue(0);
      } else {
        const playlist = getPlaylist();
        if (playlist.length > 1) {
          const nextIdx = isShuffled
            ? Math.floor(Math.random() * playlist.length)
            : (currentTrackIdx >= playlist.length - 1 ? 0 : currentTrackIdx + 1);
          crossfadeTo(nextIdx);
        }
      }
    }
  }
});

document.getElementById('volume-slider').addEventListener('input', (e) => {
  _cancelSleepFade();
  const val = parseFloat(e.target.value);
  if (stemOpen && stemMaster && stemAudioCtx) {
    // Control stem master volume
    const now = stemAudioCtx.currentTime;
    stemMaster.gain.cancelScheduledValues(now);
    stemMaster.gain.setValueAtTime(stemMaster.gain.value, now);
    stemMaster.gain.linearRampToValueAtTime(val, now + 0.03);
    audio.volume = 1; // keep PCM flowing for waveform
  } else {
    audio.volume = val;
    // Also control waveform muteGain for normal playback
    if (waveformMuteGain && audioCtx) {
      const now = audioCtx.currentTime;
      waveformMuteGain.gain.cancelScheduledValues(now);
      waveformMuteGain.gain.setValueAtTime(waveformMuteGain.gain.value, now);
      waveformMuteGain.gain.linearRampToValueAtTime(val, now + 0.03);
    }
  }
  const icon = document.getElementById('vol-icon');
  icon.textContent = val === 0 ? '🔇' : val < 0.5 ? '🔉' : '🔊';
});

document.getElementById('vol-icon').addEventListener('click', () => {
  const slider = document.getElementById('volume-slider');
  const restore = 0.8;
  const isMuted = stemOpen
    ? (stemMaster ? stemMaster.gain.value === 0 : false)
    : (waveformMuteGain ? waveformMuteGain.gain.value === 0 : audio.volume === 0);
  if (!isMuted) {
    // Mute everything
    if (stemOpen && stemMaster && stemAudioCtx) {
      stemMaster.gain.cancelScheduledValues(stemAudioCtx.currentTime);
      stemMaster.gain.setValueAtTime(0, stemAudioCtx.currentTime);
    }
    if (waveformMuteGain && audioCtx) {
      waveformMuteGain.gain.cancelScheduledValues(audioCtx.currentTime);
      waveformMuteGain.gain.setValueAtTime(0, audioCtx.currentTime);
    }
    audio.volume = stemOpen ? 1 : 0;
    slider.value = 0;
    document.getElementById('vol-icon').textContent = '🔇';
  } else {
    // Unmute
    if (stemOpen && stemMaster && stemAudioCtx) {
      const now = stemAudioCtx.currentTime;
      stemMaster.gain.cancelScheduledValues(now);
      stemMaster.gain.setValueAtTime(0, now);
      stemMaster.gain.linearRampToValueAtTime(restore, now + 0.04);
      audio.volume = 1;
    } else {
      if (waveformMuteGain && audioCtx) {
        const now = audioCtx.currentTime;
        waveformMuteGain.gain.cancelScheduledValues(now);
        waveformMuteGain.gain.setValueAtTime(0, now);
        waveformMuteGain.gain.linearRampToValueAtTime(restore, now + 0.04);
      }
      audio.volume = restore;
    }
    slider.value = restore;
    document.getElementById('vol-icon').textContent = '🔊';
  }
});

function fmt(s) {
  const m = Math.floor(s/60), sec = Math.floor(s%60);
  return `${m}:${sec.toString().padStart(2,'0')}`;
}

// ===== FEATURE 2 — SHAREABLE TIMESTAMPS =====

function copyTimestamp(tOverride) {
  const pl = getPlaylist();
  const track = pl[currentTrackIdx];
  if (!track) { showToast('NO TRACK PLAYING', 'error'); return; }
  const t = (tOverride !== undefined) ? tOverride : Math.floor(audio.currentTime);
  const url = window.location.origin + window.location.pathname +
    '?track=' + encodeURIComponent(String(track.id)) + '&t=' + t;
  navigator.clipboard.writeText(url)
    .then(() => showToast('LINK COPIED — STARTS AT ' + fmt(t), 'success'))
    .catch(() => {
      const inp = document.createElement('input');
      inp.value = url; document.body.appendChild(inp); inp.select();
      document.execCommand('copy'); document.body.removeChild(inp);
      showToast('LINK COPIED ✓', 'success');
    });
}

function checkUrlParams() {
  const params     = new URLSearchParams(window.location.search);
  const trackIdStr = params.get('track');
  const t          = parseFloat(params.get('t')) || 0;
  if (!trackIdStr) return;

  function tryPlay() {
    const track = tracks.find(tr => String(tr.id) === trackIdStr);
    if (!track) return;
    const pl  = getPlaylist();
    let   idx = pl.findIndex(x => String(x.id) === trackIdStr);
    if (idx === -1) idx = tracks.findIndex(x => String(x.id) === trackIdStr);
    if (idx === -1) return;
    playAtIndex(idx);
    if (t > 0) {
      const onCP = () => {
        audio.currentTime = Math.min(t, audio.duration || t);
        audio.removeEventListener('canplay', onCP);
      };
      audio.addEventListener('canplay', onCP);
      showToast('JUMPED TO ' + fmt(t), 'info');
    }
  }

  if (tracks && tracks.length > 0) {
    setTimeout(tryPlay, 100);
  } else {
    document.addEventListener('vault-tracks-loaded', () => setTimeout(tryPlay, 100), { once: true });
  }
  window.history.replaceState({}, '', window.location.pathname + window.location.hash);
}

// ===== FEATURE 3 — TRACK COMMENTS =====

let _trackCommentsList = [];
window._trackComments  = _trackCommentsList;
let _commentsOff       = null;
let _commentTimestamp  = 0;
const commentCounts    = new Map();

function _getCurrentTrackIdStr() {
  const pl = getPlaylist();
  const t  = pl[currentTrackIdx];
  return t ? String(t.id) : null;
}

function loadComments(trackId) {
  if (_commentsOff) { _commentsOff(); _commentsOff = null; }
  _trackCommentsList = [];
  window._trackComments = _trackCommentsList;

  if (!window._vaultDb || !window._vaultOnValue || !window._vaultDbRef) return;

  const _cRef = window._vaultDbRef(window._vaultDb, 'comments/' + trackId);
  _commentsOff = window._vaultOnValue(_cRef, snap => {
    const data = snap.val() || {};
    _trackCommentsList = Object.entries(data).map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => a.timestamp - b.timestamp);
    window._trackComments = _trackCommentsList;
    const tid = parseInt(trackId, 10) || trackId;
    commentCounts.set(tid, _trackCommentsList.length);
    _refreshCommentBadge(trackId, _trackCommentsList.length);
  });
}

function postComment(text, timestamp) {
  const trackId = _getCurrentTrackIdStr();
  if (!trackId || !text.trim()) return;
  if (!window._vaultDb || !window._vaultPush || !window._vaultDbRef) {
    showToast('FIREBASE NOT READY', 'error'); return;
  }
  const uid = window._vaultUid || ('anon-' + Math.random().toString(36).slice(2));
  window._vaultPush(
    window._vaultDbRef(window._vaultDb, 'comments/' + trackId),
    {
      text      : text.trim().slice(0, 200),
      timestamp : Math.floor(timestamp),
      authorName: (typeof isAdmin !== 'undefined' && isAdmin) ? 'host' : 'listener',
      uid,
      createdAt : Date.now(),
    }
  ).then(() => showToast('COMMENT POSTED AT ' + fmt(timestamp), 'success'))
   .catch(e  => showToast('POST FAILED: ' + e.message, 'error'));
}

function deleteComment(trackId, commentKey) {
  if (!window._vaultDb || !window._vaultRemove || !window._vaultDbRef) return;
  window._vaultRemove(
    window._vaultDbRef(window._vaultDb, 'comments/' + trackId + '/' + commentKey)
  ).then(() => showToast('COMMENT DELETED', 'success'))
   .catch(e  => showToast('DELETE FAILED: ' + e.message, 'error'));
}

function _refreshCommentBadge(trackId, count) {
  const el = document.querySelector('[data-comment-track="' + trackId + '"]');
  if (!el) return;
  el.textContent = count > 0 ? '💬 ' + count : '';
}

function _openCommentInput(timestamp) {
  _commentTimestamp = timestamp;
  const labelEl = document.getElementById('comment-at-label');
  const wrap    = document.getElementById('comment-input-wrap');
  const input   = document.getElementById('comment-input');
  if (!wrap) return;
  if (labelEl) labelEl.style.display = 'none';
  wrap.style.display = 'flex';
  if (input) {
    input.placeholder = 'Comment at ' + fmt(timestamp) + '…';
    input.value = '';
    input.focus();
  }
}

function _closeCommentInput() {
  const labelEl = document.getElementById('comment-at-label');
  const wrap    = document.getElementById('comment-input-wrap');
  if (wrap)    wrap.style.display = 'none';
  if (labelEl) labelEl.style.display = '';
}

// Comment input event wiring — vault.js is defer so DOM is already ready here.
// Actual wiring happens near the bottom of vault.js after all elements are queried.

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
  document.getElementById('edit-stem-vocals').value = (t.stems && t.stems.vocals) || '';
  document.getElementById('edit-stem-drums').value  = (t.stems && t.stems.drums)  || '';
  document.getElementById('edit-stem-bass').value   = (t.stems && t.stems.bass)   || '';
  document.getElementById('edit-stem-other').value  = (t.stems && t.stems.other)  || '';
  document.getElementById('edit-stem-keys').value   = (t.stems && t.stems.keys)   || '';
  document.getElementById('edit-notes').value       = t.notes || '';

  // Populate palette editor
  const _palKey = (t.artist || '').toLowerCase();
  const _existingPal = artistPalettes[_palKey]
    || (() => { for (const [k,v] of Object.entries(artistPalettes)) { if (_palKey.includes(k)||k.includes(_palKey)) return v; } return null; })()
    || ARTIST_PALETTES_DEFAULT[_palKey]
    || (() => { for (const [k,v] of Object.entries(ARTIST_PALETTES_DEFAULT)) { if (_palKey.includes(k)) return v; } return null; })()
    || generatePaletteFromPrimary(getArtistColor(t.artist));
  document.getElementById('pe-primary').value    = _existingPal.primary;
  document.getElementById('pe-secondary').value  = _existingPal.secondary;
  document.getElementById('pe-text').value       = _existingPal.text;
  document.getElementById('pe-glow').value       = _existingPal.glow;
  document.getElementById('pe-grad-start').value = _existingPal.gradient[0];
  document.getElementById('pe-grad-end').value   = _existingPal.gradient[1];
  // Update artist label in preview and re-render preview
  const ppLabel = document.getElementById('pp-artist-label');
  if (ppLabel) ppLabel.textContent = (t.artist || 'ARTIST').toUpperCase();
  updatePalettePreview();

  // Populate visualizer editor
  const _vizCfg = (_existingPal && _existingPal.visualizer) || {};
  const _mode = document.getElementById('ve-mode');
  if (_mode) {
    _mode.value = _vizCfg.mode || '808';
    document.getElementById('ve-intensity').value   = _vizCfg.intensity     ?? 1.0;
    document.getElementById('ve-trail').value        = _vizCfg.trailLength   ?? 50;
    document.getElementById('ve-rotation').value     = _vizCfg.rotationSpeed ?? 1.0;
    document.getElementById('ve-mirror').checked     = !!_vizCfg.mirrorMode;
    document.getElementById('ve-burst').checked      = _vizCfg.particleBurst !== false;
    document.getElementById('ve-intensity-val').textContent = parseFloat(_vizCfg.intensity ?? 1.0).toFixed(1);
    document.getElementById('ve-trail-val').textContent     = _vizCfg.trailLength   ?? 50;
    document.getElementById('ve-rotation-val').textContent  = parseFloat(_vizCfg.rotationSpeed ?? 1.0).toFixed(1);
    _veUpdateVisibility(_mode.value);
  }

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
  const notes     = document.getElementById('edit-notes').value.trim();
  const stems = {
    vocals: document.getElementById('edit-stem-vocals').value.trim(),
    drums:  document.getElementById('edit-stem-drums').value.trim(),
    bass:   document.getElementById('edit-stem-bass').value.trim(),
    other:  document.getElementById('edit-stem-other').value.trim(),
    keys:   document.getElementById('edit-stem-keys').value.trim(),
  };
  const hasStems = Object.values(stems).some(v => v);

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
    stems:     hasStems ? stems : undefined,
    notes:     notes     || undefined,
    type: url.includes('cloudinary.com') ? 'cloudinary' : (url.startsWith('data:') ? 'file' : 'url'),
  };
  if (!canvas)     delete tracks[idx].canvas;
  if (!lyricsUrl)  delete tracks[idx].lyricsUrl;
  if (!lrcFile)    delete tracks[idx].lrcFile;
  if (!hasStems)   delete tracks[idx].stems;
  if (!notes)      delete tracks[idx].notes;

  await saveTracks(tracks);
  // Bust the lyrics cache for this track so new lrcFile/lyricsUrl takes effect
  const cache = getLyricsCache();
  delete cache[editingTrackId];
  saveLyricsCache(cache);
  // If this track is currently loaded in the lyrics panel, reload it
  if (lyricsTrackId === editingTrackId) { lyricsTrackId = null; lyricsLines = []; }

  // Save palette — stored by lowercase artist name, affects all tracks by this artist
  const _paletteSaveKey = artist.toLowerCase();
  const _newPalette = {
    primary:  document.getElementById('pe-primary').value,
    secondary:document.getElementById('pe-secondary').value,
    text:     document.getElementById('pe-text').value,
    glow:     document.getElementById('pe-glow').value,
    gradient: [document.getElementById('pe-grad-start').value, document.getElementById('pe-grad-end').value],
  };
  // Include visualizer config if the editor fields exist
  if (document.getElementById('ve-mode')) {
    const _veMode = document.getElementById('ve-mode').value;
    const _veViz = { mode: _veMode };
    _veViz.intensity     = parseFloat(document.getElementById('ve-intensity').value);
    _veViz.particleBurst = document.getElementById('ve-burst').checked;
    if (_veMode === '808' || _veMode === 'oscilloscope') {
      _veViz.trailLength = parseInt(document.getElementById('ve-trail').value);
    }
    if (_veMode === 'radial' || _veMode === 'tunnel') {
      _veViz.rotationSpeed = parseFloat(document.getElementById('ve-rotation').value);
    }
    if (_veMode === 'spectrum') {
      _veViz.mirrorMode = document.getElementById('ve-mirror').checked;
    }
    _newPalette.visualizer = _veViz;
    // Update live settings if this artist is currently playing
    const _ct = getPlaylist()[currentTrackIdx];
    if (_ct && _ct.artist.toLowerCase() === _paletteSaveKey) {
      applyVizArtistConfig(_ct.artist);
    }
  }
  // Preserve existing visualizer if editor not rendered
  const _existEntry = artistPalettes[_paletteSaveKey];
  if (_existEntry && _existEntry.visualizer && !_newPalette.visualizer) {
    _newPalette.visualizer = _existEntry.visualizer;
  }
  artistPalettes[_paletteSaveKey] = _newPalette;
  saveArtists(artistPalettes); // fire-and-forget; shows its own toast

  // Re-apply palette immediately if this artist is currently playing
  const _currentTrack = getPlaylist()[currentTrackIdx];
  if (_currentTrack && _currentTrack.artist.toLowerCase() === _paletteSaveKey) {
    applyArtistPalette(_currentTrack.artist);
  }

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
    `<img class="cover-option" src="${r.url}" data-url="${r.url}" title="${escHtml(r.label)}" loading="lazy">`
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

async function doLogin() {
  const pw      = document.getElementById('admin-password').value;
  const err     = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit-btn');

  // Brute force protection
  const BF_KEY   = 'vault-bf';
  const MAX_ATT  = 5;
  const LOCKOUT  = 15 * 60 * 1000; // 15 minutes
  let bf = JSON.parse(sessionStorage.getItem(BF_KEY) || '{"attempts":0,"lockedUntil":0}');

  if (Date.now() < bf.lockedUntil) {
    const mins = Math.ceil((bf.lockedUntil - Date.now()) / 60000);
    err.textContent = `TOO MANY ATTEMPTS — TRY AGAIN IN ${mins} MIN`;
    err.style.display = 'block';
    document.getElementById('admin-password').value = '';
    return;
  }

  // Loading state — disables button and shows feedback while Firebase fetches
  submitBtn.disabled   = true;
  submitBtn.textContent = 'CHECKING…';
  err.style.display    = 'none';

  const result = await checkPassword(pw);
  document.getElementById('admin-password').value = '';

  // Restore button immediately after fetch completes
  submitBtn.disabled   = false;
  submitBtn.textContent = 'UNLOCK VAULT';

  if (result === 'firebase-unavailable') {
    err.textContent = 'UNABLE TO VERIFY — CHECK YOUR CONNECTION';
    err.style.display = 'block';
    document.getElementById('admin-password').focus();
    return;
  }

  if (result === true) {
    bf = { attempts: 0, lockedUntil: 0 };
    sessionStorage.setItem(BF_KEY, JSON.stringify(bf));
    // Store a session token so isAdmin survives accidental page refresh
    const sessionToken = crypto.randomUUID();
    sessionStorage.setItem('vault-session', sessionToken);
    setAdmin(true);
    closeModal('login-modal');
    err.style.display = 'none';
    showToast('VAULT UNLOCKED — WELCOME BACK', 'success');
    startAdminInactivityTimer();
  } else {
    bf.attempts += 1;
    if (bf.attempts >= MAX_ATT) {
      bf.lockedUntil = Date.now() + LOCKOUT;
      err.textContent = 'VAULT LOCKED — TOO MANY ATTEMPTS (15 MIN)';
    } else {
      err.textContent = `ACCESS DENIED (${MAX_ATT - bf.attempts} ATTEMPT${MAX_ATT - bf.attempts !== 1 ? 'S' : ''} LEFT)`;
    }
    sessionStorage.setItem(BF_KEY, JSON.stringify(bf));
    err.style.display = 'block';
    document.getElementById('admin-password').focus();
  }
}

document.getElementById('login-cancel-btn').addEventListener('click', () => { closeModal('login-modal'); document.getElementById('login-error').style.display='none'; });
document.getElementById('login-close').addEventListener('click', () => { closeModal('login-modal'); document.getElementById('login-error').style.display='none'; });

// ===== CHANGE PASSWORD =====
document.getElementById('change-pw-btn').addEventListener('click', () => openModal('change-pw-modal'));
document.getElementById('change-pw-close').addEventListener('click', () => closeModal('change-pw-modal'));
document.getElementById('change-pw-cancel').addEventListener('click', () => closeModal('change-pw-modal'));
document.getElementById('change-pw-submit').addEventListener('click', doChangePassword);

async function doChangePassword() {
  const currentEl  = document.getElementById('cp-current');
  const newEl      = document.getElementById('cp-new');
  const confirmEl  = document.getElementById('cp-confirm');
  const errEl      = document.getElementById('cp-error');

  const currentPw = currentEl.value;
  const newPw     = newEl.value;
  const confirmPw = confirmEl.value;

  errEl.style.display = 'none';

  if (!newPw || newPw.length < 6) {
    errEl.textContent = 'NEW PASSWORD MUST BE AT LEAST 6 CHARACTERS';
    errEl.style.display = 'block';
    return;
  }
  if (newPw !== confirmPw) {
    errEl.textContent = 'PASSWORDS DO NOT MATCH';
    errEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('change-pw-submit');
  btn.textContent = 'UPDATING…';
  btn.disabled = true;

  const ok = await changeAdminPassword(currentPw, newPw);

  btn.textContent = 'UPDATE PASSWORD';
  btn.disabled = false;
  currentEl.value = '';
  newEl.value = '';
  confirmEl.value = '';

  if (ok) {
    closeModal('change-pw-modal');
    showToast('PASSWORD UPDATED ✓', 'success');
  } else {
    errEl.textContent = 'INCORRECT CURRENT PASSWORD';
    errEl.style.display = 'block';
  }
}

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
  const stemVocals = document.getElementById('inp-stem-vocals-c').value.trim();
  const stemDrums  = document.getElementById('inp-stem-drums-c').value.trim();
  const stemBass   = document.getElementById('inp-stem-bass-c').value.trim();
  const stemOther  = document.getElementById('inp-stem-other-c').value.trim();
  const stemKeys   = document.getElementById('inp-stem-keys-c').value.trim();
  const stems = (stemVocals||stemDrums||stemBass||stemOther||stemKeys)
    ? { vocals:stemVocals, drums:stemDrums, bass:stemBass, other:stemOther, keys:stemKeys }
    : undefined;
  if (!artist || !title) { showToast('ARTIST + TITLE REQUIRED', 'error'); return; }
  if (!url) { showToast('CLOUDINARY URL REQUIRED', 'error'); return; }
  if (!/cloudinary\.com/i.test(url) && !confirm('URL doesn\'t look like a Cloudinary link — add anyway?')) return;
  addTrack({ artist, title, url, tags, type:'cloudinary', coverArt: coverArt || undefined, canvas, lyricsUrl, lrcFile, stems });
  ['inp-artist-c','inp-title-c','inp-url-c','inp-tags-c','inp-cover-c','inp-canvas-c','inp-lyrics-c','inp-lrc-c','inp-stem-vocals-c','inp-stem-drums-c','inp-stem-bass-c','inp-stem-other-c','inp-stem-keys-c'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
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
  const stemVocals = document.getElementById('inp-stem-vocals').value.trim();
  const stemDrums  = document.getElementById('inp-stem-drums').value.trim();
  const stemBass   = document.getElementById('inp-stem-bass').value.trim();
  const stemOther  = document.getElementById('inp-stem-other').value.trim();
  const stemKeys   = document.getElementById('inp-stem-keys').value.trim();
  const stems = (stemVocals||stemDrums||stemBass||stemOther||stemKeys)
    ? { vocals:stemVocals, drums:stemDrums, bass:stemBass, other:stemOther, keys:stemKeys }
    : undefined;
  if (!artist || !title) { showToast('ARTIST + TITLE REQUIRED', 'error'); return; }
  addTrack({ artist, title, url, tags, type:'url', coverArt: coverArt || undefined, canvas, lyricsUrl, lrcFile, stems });
}

function saveFromFile() {
  const artist = document.getElementById('inp-artist-f').value.trim();
  const title = document.getElementById('inp-title-f').value.trim();
  const tags = document.getElementById('inp-tags-f').value.split(',').map(t=>t.trim()).filter(Boolean);
  const coverArt = getCoverFile();
  const canvas = document.getElementById('inp-canvas-f').value.trim() || undefined;
  const lyricsUrl = document.getElementById('inp-lyrics-f').value.trim() || undefined;
  const lrcFile   = document.getElementById('inp-lrc-f').value.trim()   || undefined;
  const stemVocals = document.getElementById('inp-stem-vocals-f').value.trim();
  const stemDrums  = document.getElementById('inp-stem-drums-f').value.trim();
  const stemBass   = document.getElementById('inp-stem-bass-f').value.trim();
  const stemOther  = document.getElementById('inp-stem-other-f').value.trim();
  const stemKeys   = document.getElementById('inp-stem-keys-f').value.trim();
  const stems = (stemVocals||stemDrums||stemBass||stemOther||stemKeys)
    ? { vocals:stemVocals, drums:stemDrums, bass:stemBass, other:stemOther, keys:stemKeys }
    : undefined;
  if (!artist || !title) { showToast('ARTIST + TITLE REQUIRED', 'error'); return; }
  if (!uploadedDataUrl) { showToast('NO FILE SELECTED', 'error'); return; }
  addTrack({ artist, title, url: uploadedDataUrl, tags, type:'file', coverArt: coverArt || undefined, canvas, lyricsUrl, lrcFile, stems });
}

function addTrack(data) {
  const newTrack = { id:Date.now(), added: new Date().toISOString().split('T')[0], ...data };
  tracks.unshift(newTrack);
  saveTracks(tracks); // async — fires and continues
  renderFilters();
  renderTracks();
  // Reset
  ['inp-artist','inp-title','inp-url','inp-tags','inp-cover','inp-canvas','inp-lyrics','inp-lrc',
   'inp-stem-vocals','inp-stem-drums','inp-stem-bass','inp-stem-other','inp-stem-keys',
   'inp-artist-f','inp-title-f','inp-tags-f','inp-cover-f','inp-canvas-f','inp-lyrics-f','inp-lrc-f',
   'inp-stem-vocals-f','inp-stem-drums-f','inp-stem-bass-f','inp-stem-other-f','inp-stem-keys-f',
   'inp-artist-c','inp-title-c','inp-url-c','inp-tags-c','inp-cover-c','inp-canvas-c','inp-lyrics-c','inp-lrc-c',
   'inp-stem-vocals-c','inp-stem-drums-c','inp-stem-bass-c','inp-stem-other-c','inp-stem-keys-c',
  ].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
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
        <div class="atitle">${escHtml(t.title)}</div>
        <div class="aartist">${escHtml(t.artist)}</div>
        <div class="atags">${(t.tags||[]).map(tag=>`<span class="tag">${escHtml(tag)}</span>`).join('')}</div>
      </div>
    `).join('');
    output.classList.add('visible');
    output._parsed = parsed;
  } catch (err) {
    progress.classList.remove('visible');
    showToast('API ERROR — CHECK CONSOLE','error');
    /* suppressed */
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
  initParticles('#c41e3a');
  drawBG('#c41e3a');
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

// Called by swipe.js for right-swipe on track cards
function toggleTrackLike(id) {
  if (likedTracks.has(id)) {
    likedTracks.delete(id);
    showToast('REMOVED FROM LIKED', '');
  } else {
    likedTracks.add(id);
    showToast('ADDED TO LIKED ♥', 'success');
  }
  saveLiked();
  updateLikeBtn();
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
    case 'p':
    case 'P':
      { const sb = document.getElementById('stem-toggle-btn'); if (sb) sb.click(); }
      break;
    case 'q':
    case 'Q':
      { const qb = document.getElementById('queue-toggle-btn'); if (qb) qb.click(); }
      break;
    case 'v':
    case 'V':
      toggleVisualizer();
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
    resultsEl.innerHTML = results.slice(0, 6).map(r => `<img class="cover-option" src="${r.url}" data-url="${r.url}" title="${escHtml(r.label)}" loading="lazy">`).join('');
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
const STEM_WORKER_URL    = 'https://stem-worker.ngninji9.workers.dev'; // ← your Cloudflare Worker
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
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
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
// STEM PLAYER — Web Audio API mixer
// 4 channels: vocals / drums / bass / other
// Each channel: AudioBufferSourceNode → GainNode → masterGain → destination
// Faders control gain. Mute sets gain to 0, preserving fader position.
// VU meters animate from the analyser on each channel.
// =====================================================================

const stemPanel       = document.getElementById('stem-panel');
const stemChannelsEl  = document.getElementById('stem-channels');
const stemUnavailEl   = document.getElementById('stem-unavailable');
const stemTrackName   = document.getElementById('stem-track-name');
const stemToggleBtn   = document.getElementById('stem-toggle-btn');
const stemCloseBtn    = document.getElementById('stem-close-btn');

let stemOpen       = false;
let stemTrackId    = null;
let stemAudioCtx   = null;
let stemMaster     = null;

const STEM_KEYS = ['vocals', 'drums', 'bass', 'other', 'keys'];
const stemChannels = {};
STEM_KEYS.forEach(k => { stemChannels[k] = { source:null, gain:null, analyser:null, buf:null, muted:false, faderVal:1 }; });

let stemVuFrame = null;
let _stemPushDebounce = null; // FIX: Stems + session sync — debounce timer for volume changes — The Vault conflict resolution

// ── Panel open / close ────────────────────────────────────────────
function openStemPanel() {
  stemOpen = true;
  stemPanel.classList.add('open');
  stemToggleBtn.classList.add('active');
  playerBar.classList.add('stem-open');
  document.getElementById('lyrics-panel').classList.add('stem-open');
  document.querySelector('.app').style.paddingBottom =
    lyricsOpen ? 'calc(120px + 52vh + 200px)' : 'calc(120px + 200px)';
  // Silence speakers via muteGain — analyser still gets full PCM for waveform
  if (waveformMuteGain && audioCtx) {
    waveformMuteGain.gain.cancelScheduledValues(audioCtx.currentTime);
    waveformMuteGain.gain.setValueAtTime(0, audioCtx.currentTime);
  }
  audio.volume = 1; // keep PCM flowing to Web Audio graph
  const playlist = getPlaylist();
  const t = playlist[currentTrackIdx];
  if (t) maybeLoadStems(t);
}

function closeStemPanel() {
  stemOpen = false;
  stemPanel.classList.remove('open');
  stemToggleBtn.classList.remove('active');
  playerBar.classList.remove('stem-open');
  document.getElementById('lyrics-panel').classList.remove('stem-open');
  document.querySelector('.app').style.paddingBottom =
    lyricsOpen ? 'calc(120px + 52vh)' : '';
  stopStemVU();
  // Restore speaker output via muteGain
  const sliderVal = parseFloat(document.getElementById('volume-slider').value);
  if (waveformMuteGain && audioCtx) {
    const now = audioCtx.currentTime;
    waveformMuteGain.gain.cancelScheduledValues(now);
    waveformMuteGain.gain.setValueAtTime(0, now);
    waveformMuteGain.gain.linearRampToValueAtTime(sliderVal, now + 0.05);
  }
  audio.volume = sliderVal;
}

stemToggleBtn.addEventListener('click', () => {
  if (stemOpen) closeStemPanel(); else openStemPanel();
});
stemCloseBtn.addEventListener('click', closeStemPanel);

// ── Called from playAtIndex on every track change ─────────────────
function maybeLoadStems(track) {
  stemTrackName.textContent = `— ${track.artist} · ${track.title}`;
  if (!stemOpen) return;
  if (stemTrackId === track.id && stemChannels.vocals.source) return;

  teardownStems();
  stemTrackId = track.id;

  const stems = track.stems;
  const hasAnyUrl = stems && STEM_KEYS.some(k => stems[k]);

  if (!hasAnyUrl) {
    stemChannelsEl.style.display = 'none';
    stemUnavailEl.style.display  = 'flex';
    // Reset unavail message in case a previous separation failed
    const unavailMsg = document.getElementById('stem-unavail-msg');
    if (unavailMsg) unavailMsg.textContent = 'NO STEMS AVAILABLE FOR THIS TRACK';
    updateStemSeparateBtn();
    stopStemVU();
    return;
  }

  stemChannelsEl.style.display = 'flex';
  stemUnavailEl.style.display  = 'none';
  // Silence speakers, keep PCM flowing for waveform
  if (waveformMuteGain && audioCtx) {
    waveformMuteGain.gain.cancelScheduledValues(audioCtx.currentTime);
    waveformMuteGain.gain.setValueAtTime(0, audioCtx.currentTime);
  }
  audio.volume = 1;
  const sliderVal = parseFloat(document.getElementById('volume-slider').value);
  if (stemMaster && stemAudioCtx) stemMaster.gain.setValueAtTime(sliderVal, stemAudioCtx.currentTime);

  if (!stemAudioCtx || stemAudioCtx.state === 'closed') {
    stemAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (stemAudioCtx.state === 'suspended') stemAudioCtx.resume();

  stemMaster = stemAudioCtx.createGain();
  stemMaster.gain.value = 1;
  stemMaster.connect(stemAudioCtx.destination);

  STEM_KEYS.forEach(k => {
    const url = stems && stems[k];
    if (url) {
      loadStemBuffer(k, url);
    } else {
      setStemChannelDisabled(k, true);
    }
  });

  startStemVU();
}

// ── Fetch + decode a stem buffer ──────────────────────────────────
async function loadStemBuffer(key, url) {
  setStemChannelDisabled(key, false);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arrayBuf = await res.arrayBuffer();
    const audioBuf = await stemAudioCtx.decodeAudioData(arrayBuf);
    stemChannels[key].buf = audioBuf;
    if (isPlaying && audio.currentTime > 0) {
      startStemSource(key, audio.currentTime);
    }
  } catch(e) {
    console.warn(`Stem load failed [${key}]:`, e.message);
    setStemChannelDisabled(key, true);
  }
}

// ── Create and start a source node at a given offset ─────────────
function startStemSource(key, offset = 0) {
  const ch = stemChannels[key];
  if (!ch.buf || !stemAudioCtx) return;

  if (ch.source) {
    try { ch.source.stop(); } catch(e) {}
    ch.source.disconnect();
  }

  if (!ch.gain) {
    ch.gain = stemAudioCtx.createGain();
    ch.gain.gain.value = ch.muted ? 0 : ch.faderVal;
    ch.gain.connect(stemMaster);
  }

  if (!ch.analyser) {
    ch.analyser = stemAudioCtx.createAnalyser();
    ch.analyser.fftSize = 256;
    ch.analyser.smoothingTimeConstant = 0.75;
    ch.gain.connect(ch.analyser);
  }

  ch.source = stemAudioCtx.createBufferSource();
  ch.source.buffer = ch.buf;
  ch.source.loop = audio.loop;
  ch.source.connect(ch.gain);
  ch.source.start(0, offset % ch.buf.duration);
}

// ── Sync stems to main audio events ──────────────────────────────
audio.addEventListener('play', () => {
  if (!stemOpen || stemTrackId === null) return;
  const offset = audio.currentTime;
  STEM_KEYS.forEach(k => { if (stemChannels[k].buf) startStemSource(k, offset); });
  if (stemAudioCtx && stemAudioCtx.state === 'suspended') stemAudioCtx.resume();
});

audio.addEventListener('pause', () => {
  STEM_KEYS.forEach(k => {
    const ch = stemChannels[k];
    if (ch.source) { try { ch.source.stop(); } catch(e) {} ch.source = null; }
  });
});

let lastStemSyncTime = 0;
audio.addEventListener('timeupdate', () => {
  if (!stemOpen || !isPlaying) return;
  const now = audio.currentTime;
  if (Math.abs(now - lastStemSyncTime) > 1.2) {
    STEM_KEYS.forEach(k => { if (stemChannels[k].buf) startStemSource(k, now); });
  }
  lastStemSyncTime = now;
});

// ── Fader input handlers ──────────────────────────────────────────
STEM_KEYS.forEach(k => {
  const fader = document.getElementById(`stem-fader-${k}`);
  if (!fader) return;
  fader.addEventListener('input', () => {
    const val = parseFloat(fader.value);
    stemChannels[k].faderVal = val;
    const ch = stemChannels[k];
    if (ch.gain && !ch.muted && stemAudioCtx) {
      ch.gain.gain.setTargetAtTime(val, stemAudioCtx.currentTime, 0.02);
    }
    // FIX: Stems + session sync — debounced push on volume change — The Vault conflict resolution
    clearTimeout(_stemPushDebounce);
    _stemPushDebounce = setTimeout(() => {
      document.dispatchEvent(new CustomEvent('vault:stems-changed'));
    }, 150);
  });
});

// ── Mute button handlers ──────────────────────────────────────────
STEM_KEYS.forEach(k => {
  const btn = document.getElementById(`stem-mute-${k}`);
  if (!btn) return;
  btn.addEventListener('click', () => {
    const ch = stemChannels[k];
    ch.muted = !ch.muted;
    btn.classList.toggle('muted', ch.muted);
    btn.textContent = ch.muted ? 'MUTED' : 'MUTE';
    if (ch.gain && stemAudioCtx) {
      ch.gain.gain.setTargetAtTime(
        ch.muted ? 0 : ch.faderVal,
        stemAudioCtx.currentTime, 0.02
      );
    }
    // FIX: Stems + session sync — push mute state immediately — The Vault conflict resolution
    document.dispatchEvent(new CustomEvent('vault:stems-changed'));
  });
});

// ── VU meter animation ────────────────────────────────────────────
function animateStemVU() {
  stemVuFrame = requestAnimationFrame(animateStemVU);
  STEM_KEYS.forEach(k => {
    const ch = stemChannels[k];
    const vu = document.getElementById(`stem-vu-${k}`);
    if (!vu) return;
    if (!ch.analyser || ch.muted) { vu.style.height = '0%'; return; }
    const data = new Uint8Array(ch.analyser.frequencyBinCount);
    ch.analyser.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    vu.style.height = Math.min(100, (avg / 255) * 250).toFixed(1) + '%';
  });
}

function startStemVU() {
  if (stemVuFrame) cancelAnimationFrame(stemVuFrame);
  animateStemVU();
}

function stopStemVU() {
  if (stemVuFrame) { cancelAnimationFrame(stemVuFrame); stemVuFrame = null; }
  STEM_KEYS.forEach(k => {
    const vu = document.getElementById(`stem-vu-${k}`);
    if (vu) vu.style.height = '0%';
  });
}

// ── Disable / enable a channel UI ────────────────────────────────
function setStemChannelDisabled(key, disabled) {
  const fader = document.getElementById(`stem-fader-${key}`);
  const mute  = document.getElementById(`stem-mute-${key}`);
  const channel = fader && fader.closest('.stem-channel');
  const label = channel && channel.querySelector('.stem-label');
  const opacity = disabled ? '0.25' : '';
  if (fader) { fader.disabled = disabled; fader.style.opacity = opacity; }
  if (mute)  { mute.disabled  = disabled; mute.style.opacity  = opacity; }
  if (label) { label.style.opacity = disabled ? '0.35' : ''; }
}

// FIX: Stems + session sync — expose stem state for session.js — The Vault conflict resolution
window.getVaultStemState = function() {
  if (!stemOpen) return null;
  const state = {};
  STEM_KEYS.forEach(k => {
    const ch = stemChannels[k];
    state[k] = { muted: !!ch.muted, volume: ch.faderVal };
  });
  return state;
};

window.applyGuestStemState = function(stemsObj) {
  if (!stemOpen || !stemAudioCtx) return; // silently ignore if stems not loaded
  STEM_KEYS.forEach(k => {
    const incoming = stemsObj[k];
    if (!incoming) return;
    const ch = stemChannels[k];
    ch.muted    = !!incoming.muted;
    if (typeof incoming.volume === 'number') ch.faderVal = incoming.volume;
    if (ch.gain && stemAudioCtx) {
      ch.gain.gain.setTargetAtTime(ch.muted ? 0 : ch.faderVal, stemAudioCtx.currentTime, 0.02);
    }
    const btn   = document.getElementById(`stem-mute-${k}`);
    if (btn)   { btn.classList.toggle('muted', ch.muted); btn.textContent = ch.muted ? 'MUTED' : 'MUTE'; }
    const fader = document.getElementById(`stem-fader-${k}`);
    if (fader) fader.value = ch.faderVal;
  });
};

// ── Tear down all stems and reset state ──────────────────────────
function teardownStems() {
  stopStemVU();
  STEM_KEYS.forEach(k => {
    const ch = stemChannels[k];
    if (ch.source)   { try { ch.source.stop(); } catch(e) {} ch.source.disconnect();   ch.source   = null; }
    if (ch.gain)     { ch.gain.disconnect();     ch.gain     = null; }
    if (ch.analyser) { ch.analyser.disconnect(); ch.analyser = null; }
    ch.buf = null; ch.muted = false; ch.faderVal = 1;
    const fader = document.getElementById(`stem-fader-${k}`);
    const mute  = document.getElementById(`stem-mute-${k}`);
    if (fader) { fader.value = 1; fader.disabled = false; fader.style.opacity = ''; }
    if (mute)  { mute.classList.remove('muted'); mute.textContent = 'MUTE'; mute.disabled = false; mute.style.opacity = ''; }
  });
  if (stemMaster) { try { stemMaster.disconnect(); } catch(e) {} stemMaster = null; }
  // Restore speaker output when stems tear down mid-session
  if (stemOpen && waveformMuteGain && audioCtx) {
    const sliderVal = parseFloat(document.getElementById('volume-slider').value);
    const now = audioCtx.currentTime;
    waveformMuteGain.gain.cancelScheduledValues(now);
    waveformMuteGain.gain.setValueAtTime(0, now);
    waveformMuteGain.gain.linearRampToValueAtTime(sliderVal, now + 0.05);
    audio.volume = sliderVal;
  }
}

// =====================================================================
// STEM AUTO-SEPARATION — Cloudflare Worker + Hugging Face Demucs
// =====================================================================

// Show/hide the Separate button based on admin status
function updateStemSeparateBtn() {
  const btn = document.getElementById('stem-separate-btn');
  if (!btn) return;
  btn.style.display = isAdmin ? 'inline-block' : 'none';
}

// Wire up the Separate button
document.getElementById('stem-separate-btn').addEventListener('click', () => {
  const playlist = getPlaylist();
  const t = playlist[currentTrackIdx];
  if (!t) { showToast('PLAY A TRACK FIRST', 'error'); return; }
  separateStems(t);
});

// ── Main separation function ──────────────────────────────────────
async function separateStems(track) {
  if (!track.url) { showToast('NO AUDIO URL ON THIS TRACK', 'error'); return; }

  const btn       = document.getElementById('stem-separate-btn');
  const progress  = document.getElementById('stem-progress');
  const progressMsg = document.getElementById('stem-progress-msg');
  const unavailMsg  = document.getElementById('stem-unavail-msg');
  const unavailSub  = document.getElementById('stem-unavail-sub');

  // Switch to progress state
  btn.style.display      = 'none';
  unavailMsg.style.display = 'none';
  unavailSub.style.display = 'none';
  progress.style.display = 'flex';
  progressMsg.textContent = 'SENDING TO DEMUCS…';

  const maxRetries = 8;  // up to ~4 mins of polling
  const retryDelay = 30; // seconds between retries when model is loading

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      progressMsg.textContent = attempt === 0
        ? 'SEPARATING STEMS — THIS TAKES 2-5 MINS…'
        : `MODEL LOADING — RETRY ${attempt}/${maxRetries}…`;

      const res = await fetch(STEM_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioUrl: track.url,
          cloudinaryCloud: CLOUDINARY_CLOUD,
          cloudinaryUploadPreset: CLOUDINARY_UPLOAD_PRESET,
        }),
        signal: AbortSignal.timeout(360000), // 6 min timeout
      });

      const data = await res.json();

      // Model still warming up — wait and retry
      if (res.status === 503 && data.status === 'loading') {
        const wait = (data.retry_after || retryDelay) * 1000;
        progressMsg.textContent = `MODEL WARMING UP — RETRYING IN ${Math.ceil(wait/1000)}s…`;
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      if (!res.ok || data.error) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      if (data.status === 'done' && data.stems) {
        // Save stems to the track
        progressMsg.textContent = 'SAVING STEMS…';

        const idx = tracks.findIndex(x => x.id === track.id);
        if (idx !== -1) {
          tracks[idx].stems = data.stems;
          await saveTracks(tracks);

          // Reload the stem panel with the new stems
          teardownStems();
          stemTrackId = null;
          maybeLoadStems(tracks[idx]);

          showToast('STEMS READY ✓', 'success');
        }

        // Restore unavailable UI (in case track switches)
        progress.style.display   = 'none';
        unavailMsg.style.display = '';
        unavailSub.style.display = '';
        btn.style.display        = isAdmin ? 'inline-block' : 'none';
        return;
      }

      throw new Error('Unexpected response from worker');

    } catch (e) {
      console.error('Stem separation error:', e);

      // If we've exhausted retries, give up
      if (attempt >= maxRetries) {
        progress.style.display   = 'none';
        unavailMsg.style.display = '';
        unavailSub.style.display = '';
        btn.style.display        = isAdmin ? 'inline-block' : 'none';
        unavailMsg.textContent   = 'SEPARATION FAILED — TRY AGAIN';
        showToast(`SEPARATION FAILED: ${e.message.slice(0, 40).toUpperCase()}`, 'error');
        return;
      }

      // Retry after a delay for transient errors
      await new Promise(r => setTimeout(r, retryDelay * 1000));
    }
  }
}

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

// ===== MOBILE ACTION ROW — mirror desktop buttons =====
const mobileCanvasBtn = document.getElementById('mobile-canvas-btn');
const mobileLyricsBtn = document.getElementById('mobile-lyrics-btn');
const mobileStemsBtn  = document.getElementById('mobile-stems-btn');

if (mobileCanvasBtn) {
  mobileCanvasBtn.addEventListener('click', () => {
    document.getElementById('canvas-toggle-btn').click();
    mobileCanvasBtn.classList.toggle('active', canvasEnabled);
  });
  // Keep in sync with desktop toggle
  const origCanvasToggle = canvasToggleBtn.addEventListener;
  mobileCanvasBtn.classList.add('active'); // starts enabled
}

if (mobileLyricsBtn) {
  mobileLyricsBtn.addEventListener('click', () => {
    document.getElementById('lyrics-toggle-btn').click();
  });
}

if (mobileStemsBtn) {
  mobileStemsBtn.addEventListener('click', () => {
    document.getElementById('stem-toggle-btn').click();
  });
}

// Keep mobile button active states in sync with desktop buttons
function syncMobileActionBtns() {
  if (mobileCanvasBtn) mobileCanvasBtn.classList.toggle('active', canvasEnabled);
  if (mobileLyricsBtn) mobileLyricsBtn.classList.toggle('active', lyricsOpen);
  if (mobileStemsBtn)  mobileStemsBtn.classList.toggle('active', stemOpen);
}

// Patch the existing toggle functions to also sync mobile buttons
const _origLyricsToggle = lyricsToggleBtn.onclick;
lyricsToggleBtn.addEventListener('click', () => setTimeout(syncMobileActionBtns, 50));
stemToggleBtn.addEventListener('click',   () => setTimeout(syncMobileActionBtns, 50));
canvasToggleBtn.addEventListener('click', () => setTimeout(syncMobileActionBtns, 50));

// ===== INIT =====
resizeCanvas();
window.addEventListener('resize', resizeCanvas);
setDefaultBG();

// Seed default tracks immediately so the page never shows empty
tracks = getLocalTracks();
projects = getLocalProjects();
renderFilters();
renderTracks();
renderRecentlyPlayed();
renderQueue();
checkUrlParams(); // Feature 2 — play track from URL params

// ===== COMMENT INPUT + SHARE BUTTON WIRING (Features 2 & 3) =====
(function() {
  var postBtn   = document.getElementById('comment-post-btn');
  var cancelBtn = document.getElementById('comment-cancel-btn');
  var inputEl   = document.getElementById('comment-input');
  var shareBtn  = document.getElementById('share-ts-btn');

  if (postBtn) postBtn.addEventListener('click', function() {
    var text = (inputEl && inputEl.value.trim()) || '';
    if (!text) return;
    postComment(text, _commentTimestamp);
    _closeCommentInput();
  });
  if (cancelBtn) cancelBtn.addEventListener('click', _closeCommentInput);
  if (inputEl) inputEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { if (postBtn) postBtn.click(); }
    if (e.key === 'Escape') _closeCommentInput();
  });
  if (shareBtn) shareBtn.addEventListener('click', function() { copyTimestamp(); });
})();

// Seed artist palettes from localStorage immediately (so cards render with correct colors)
artistPalettes = getLocalArtists();

// Expose for pull-to-refresh
window.reloadTracks = loadTracks;

// Then async-load from GitHub (may update the list with newer tracks + palettes)
loadTracks().then(loaded => {
  if (loaded && loaded.length > 0) {
    tracks = loaded;
    renderFilters();
    renderTracks();
    renderRecentlyPlayed();
  }
  document.dispatchEvent(new Event('vault-tracks-loaded')); // Feature 2
  if (isAdmin && !ghConfigured()) {
    showToast('GITHUB NOT SET UP — CLICK ⚙ TO CONFIGURE', 'error');
  }
});
loadArtists().then(loaded => {
  if (loaded && Object.keys(loaded).length > 0) {
    artistPalettes = loaded;
    renderTracks(); // re-render so cards pick up freshly loaded palettes
  }
});
// projects.json fail → log warning, use local cache, app continues
loadProjects().then(loaded => {
  if (loaded && loaded.length > 0) {
    projects = loaded;
    renderTracks(); // update project badges on cards
  }
}).catch(e => console.warn('[Vault] projects.json load failed — using local cache', e));

// ===== SORT BUTTONS =====
document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    sortMode = btn.dataset.sort;
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === sortMode));
    renderTracks();
  });
});

// ===== SPEED CONTROL =====
const SPEEDS = [0.75, 1, 1.25, 1.5];
let speedIdx = 1; // default 1×
const speedBtn = document.getElementById('speed-btn');
speedBtn.addEventListener('click', () => {
  speedIdx = (speedIdx + 1) % SPEEDS.length;
  const rate = SPEEDS[speedIdx];
  audio.playbackRate = rate;
  speedBtn.textContent = rate === 1 ? '1×' : `${rate}×`;
  speedBtn.classList.toggle('active', rate !== 1);
  showToast(`SPEED: ${rate}×`, '');
});

// ===== SLEEP TIMER =====
let sleepTimer    = null;
let sleepEndTime  = null;
let _sleepEOT     = false;  // "end of track" mode

// ── Fade-out engine ─────────────────────────────────────────────────────────
let _sleepFadeRaf    = null;
let _sleepFadePreVol = 1;
let _sleepFading     = false;

function _startSleepFade(fadeDuration) {
  fadeDuration = fadeDuration || 20000;
  if (_sleepFading) return;
  _sleepFading     = true;
  // FIX: Sleep timer vs gapless conflict — cancel buffered preload immediately — The Vault conflict resolution
  if (audioXfade && audioXfade.src) {
    audioXfade.pause();
    audioXfade.src = '';
    try { audioXfade.load(); } catch (_) {}
  }
  isXfading       = false;
  gaplessTriggered = false;
  _sleepFadePreVol = audio.volume;
  const startVol  = audio.volume;
  const startTime = performance.now();

  function tick(now) {
    const t      = Math.min(1, (now - startTime) / fadeDuration);
    const eased  = t * t;                        // ease-in: slow start, faster at end
    const vol    = Math.max(0, startVol * (1 - eased));

    audio.volume = vol;
    if (waveformMuteGain && audioCtx) {
      waveformMuteGain.gain.setValueAtTime(vol, audioCtx.currentTime);
    }
    const slider = document.getElementById('volume-slider');
    if (slider) slider.value = vol;

    if (t < 1) {
      _sleepFadeRaf = requestAnimationFrame(tick);
    } else {
      _finishSleepFade();
    }
  }
  _sleepFadeRaf = requestAnimationFrame(tick);
}

function _finishSleepFade() {
  _sleepFading = false;
  _sleepFadeRaf = null;
  audio.pause();
  // Restore volume to pre-fade level
  audio.volume = _sleepFadePreVol;
  if (waveformMuteGain && audioCtx) {
    waveformMuteGain.gain.cancelScheduledValues(audioCtx.currentTime);
    waveformMuteGain.gain.setValueAtTime(_sleepFadePreVol, audioCtx.currentTime);
  }
  const slider = document.getElementById('volume-slider');
  if (slider) slider.value = _sleepFadePreVol;
  const icon = document.getElementById('vol-icon');
  if (icon) icon.textContent = _sleepFadePreVol < 0.05 ? '🔇' : _sleepFadePreVol < 0.5 ? '🔉' : '🔊';

  isPlaying = false;
  document.getElementById('play-pause-btn').innerHTML = '▶';
  document.getElementById('play-pause-btn').classList.remove('is-playing');
  document.getElementById('player-vinyl').classList.remove('spinning');
  stopWaveform();
  hideCanvas();
  sleepBtn.classList.remove('active');
  sleepBtn.textContent = '☽ Sleep';
  sleepTimer = null; sleepEndTime = null; _sleepEOT = false;
  document.querySelectorAll('.sleep-option').forEach(o => o.classList.remove('active'));
  showToast('SLEEP TIMER — GOODNIGHT 🌙', 'success');
}

function _cancelSleepFade() {
  if (!_sleepFading) return;
  if (_sleepFadeRaf) { cancelAnimationFrame(_sleepFadeRaf); _sleepFadeRaf = null; }
  _sleepFading = false;
  audio.volume = _sleepFadePreVol;
  if (waveformMuteGain && audioCtx) {
    waveformMuteGain.gain.cancelScheduledValues(audioCtx.currentTime);
    waveformMuteGain.gain.setValueAtTime(_sleepFadePreVol, audioCtx.currentTime);
  }
  const slider = document.getElementById('volume-slider');
  if (slider) slider.value = _sleepFadePreVol;
  const icon = document.getElementById('vol-icon');
  if (icon) icon.textContent = _sleepFadePreVol < 0.05 ? '🔇' : _sleepFadePreVol < 0.5 ? '🔉' : '🔊';
  showToast('SLEEP TIMER CANCELLED', '');
}

// ── Timer UI ─────────────────────────────────────────────────────────────────
const sleepBtn  = document.getElementById('sleep-btn');
const sleepDrop = document.getElementById('sleep-dropdown');

sleepBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  sleepDrop.classList.toggle('open');
});

document.querySelectorAll('.sleep-option').forEach(opt => {
  opt.addEventListener('click', () => {
    const mins = parseInt(opt.dataset.mins);
    sleepDrop.classList.remove('open');
    // Cancel any running fade
    _cancelSleepFade();
    // Clear existing timer
    if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; sleepEndTime = null; }
    _sleepEOT = false;
    document.querySelectorAll('.sleep-option').forEach(o => o.classList.remove('active'));

    if (mins === 0) {
      // Cancel
      sleepBtn.classList.remove('active');
      sleepBtn.textContent = '☽ Sleep';
      showToast('SLEEP TIMER CANCELLED', '');
      return;
    }

    if (mins === -1) {
      // Fade now — start 20s fade immediately
      _startSleepFade(20000);
      opt.classList.add('active');
      sleepBtn.classList.add('active');
      sleepBtn.textContent = '☽ Fading…';
      return;
    }

    if (mins === -2) {
      // End of track — start 10s fade when current track ends
      _sleepEOT = true;
      opt.classList.add('active');
      sleepBtn.classList.add('active');
      sleepBtn.textContent = '☽ EOT';
      showToast('SLEEP AT END OF TRACK', 'success');
      return;
    }

    opt.classList.add('active');
    sleepEndTime = Date.now() + mins * 60 * 1000;
    sleepBtn.classList.add('active');
    sleepBtn.textContent = `☽ ${mins}m`;
    showToast(`SLEEP TIMER: ${mins} MINUTES`, 'success');
    sleepTimer = setTimeout(() => {
      sleepTimer = null;
      _startSleepFade(20000);
    }, mins * 60 * 1000);
  });
});

// Close sleep dropdown on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('#sleep-btn') && !e.target.closest('#sleep-dropdown')) {
    sleepDrop.classList.remove('open');
  }
});

// =====================================================================
// FULL-SCREEN VISUALIZER ENGINE
// Modes:
//   0 — 808 BASS LINE   (FL Studio-style decimated time-domain bass tracker)
//   1 — OSCILLOSCOPE    (triggered, stabilised time-domain waveform)
//   2 — SPECTRUM        (log-mapped frequency bars, mirrored + gradient)
//   3 — RADIAL          (360° frequency burst, dual-ring)
// =====================================================================

let vizOpen       = false;
let vizMode       = 0;
let vizAnimFrame  = null;
let vizAnalyser   = null;   // dedicated high-res analyser for the viz
let vizTD         = null;   // Uint8Array — time-domain data (4096 samples)
let vizFD         = null;   // Uint8Array — frequency data  (2048 bins)
const VIZ_MODES   = ['808 BASS', 'OSCILLOSCOPE', 'SPECTRUM', 'RADIAL', 'TUNNEL', 'AURORA'];

// Beat-flash & particle state
let vizBeatFlash  = 0;
let vizPrevBass   = 0;
const vizPtcls    = [];   // [{x,y,vx,vy,life,decay,size}]

// Per-artist settings (applied via applyVizArtistConfig)
let vizIntensity      = 1.0;   // amplitude / energy multiplier
let vizTrailLength    = 50;    // phosphor persistence (higher = longer trail)
let vizMirrorMode     = false; // spectrum: render bars mirrored from center
let vizRotationSpeed  = 1.0;   // radial/tunnel: orbit speed multiplier
let vizParticleBurst  = true;  // 808: spawn burst on beat drop
let vizManualOverride = false; // true when user manually picked a mode
let vizFadeIn         = 0;     // fade-in value (1→0) when mode switches
let vizRadialAngle    = 0;     // cumulative rotation offset for radial
let vizTunnelZ        = 0;     // tunnel depth accumulator
let vizAuroraTime     = 0;     // aurora phase accumulator
let _vizCurrentArtist = '';    // artist whose config is currently loaded

// DOM refs
const vizOverlay   = document.getElementById('viz-overlay');
const vizCanvas    = document.getElementById('viz-canvas');
const vizCtx       = vizCanvas.getContext('2d');
const vizTitleEl   = document.getElementById('viz-track-title');
const vizArtistEl  = document.getElementById('viz-track-artist');
const vizModeLabel = document.getElementById('viz-mode-label');

// ── Analyser setup ──────────────────────────────────────────────────
function setupVizAnalyser() {
  if (vizAnalyser) return true;
  if (!audioCtx || !sourceNode) return false;
  try {
    vizAnalyser = audioCtx.createAnalyser();
    vizAnalyser.fftSize = 4096;
    vizAnalyser.smoothingTimeConstant = 0.72;
    // Tap from eqBass so viz sees BOTH gainMain + gainXfade mixed together
    // (sourceNode alone only sees the main element, not the crossfade element)
    if (eqBass) {
      eqBass.connect(vizAnalyser);
    } else {
      sourceNode.connect(vizAnalyser); // fallback for legacy path
    }
    // Analysis only — NOT connected to destination (no extra audio output)
    vizTD = new Uint8Array(vizAnalyser.fftSize);
    vizFD = new Uint8Array(vizAnalyser.frequencyBinCount);
    return true;
  } catch(e) {
    return false;
  }
}

// ── Open / Close ────────────────────────────────────────────────────
function openVisualizer() {
  vizOpen = true;
  vizOverlay.classList.add('active');
  document.getElementById('viz-btn').classList.add('active');
  document.body.classList.add('viz-open');
  resizeVizCanvas();
  try { setupAudioContext(); } catch(e) {}
  setupVizAnalyser();
  _updateVizTrackInfo();
  _startVizLoop();
}

function closeVisualizer() {
  vizOpen = false;
  vizOverlay.classList.remove('active');
  document.getElementById('viz-btn').classList.remove('active');
  document.body.classList.remove('viz-open');
  _stopVizLoop();
}

function toggleVisualizer() {
  if (vizOpen) closeVisualizer(); else openVisualizer();
}

// ── Wiring ──────────────────────────────────────────────────────────
document.getElementById('viz-btn').addEventListener('click', toggleVisualizer);
document.getElementById('viz-close-btn').addEventListener('click', closeVisualizer);
document.getElementById('viz-mode-btn').addEventListener('click', () => {
  _setVizMode((vizMode + 1) % VIZ_MODES.length, true);
});
document.querySelectorAll('.viz-dot').forEach(dot => {
  dot.addEventListener('click', () => _setVizMode(parseInt(dot.dataset.mode), true));
});

// Keep mobile button in sync
const mobileVizBtn = document.getElementById('mobile-viz-btn');
if (mobileVizBtn) {
  mobileVizBtn.addEventListener('click', toggleVisualizer);
  // Sync active state on canvas/viz toggle
  const _syncMobileViz = () => setTimeout(() => {
    mobileVizBtn.classList.toggle('active', vizOpen);
    syncMobileActionBtns();
  }, 50);
  document.getElementById('viz-btn').addEventListener('click', _syncMobileViz);
}

// ── Helpers ─────────────────────────────────────────────────────────
function _setVizMode(m, isManual = false) {
  vizMode = m;
  if (isManual) vizManualOverride = true;
  vizFadeIn = 0.85;
  vizModeLabel.textContent = VIZ_MODES[m];
  document.querySelectorAll('.viz-dot').forEach(d =>
    d.classList.toggle('active', parseInt(d.dataset.mode) === m)
  );
  vizCtx.fillStyle = '#0a0408';
  vizCtx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  vizPtcls.length = 0;
  vizBeatFlash = vizPrevBass = 0;
}

function resizeVizCanvas() {
  const dpr = window.devicePixelRatio || 1;
  vizCanvas.width  = window.innerWidth  * dpr;
  vizCanvas.height = window.innerHeight * dpr;
  vizCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', () => { if (vizOpen) resizeVizCanvas(); });

function _updateVizTrackInfo() {
  const pl = getPlaylist();
  const t  = pl[currentTrackIdx];
  if (!t) return;
  if (vizTitleEl)  vizTitleEl.textContent  = t.title;
  if (vizArtistEl) vizArtistEl.textContent = t.artist.toUpperCase();
  vizOverlay.style.setProperty('--current-color', getArtistColor(t.artist));
  applyVizArtistConfig(t.artist);
}
// Update info whenever a track starts
audio.addEventListener('play', () => { if (vizOpen) _updateVizTrackInfo(); });

function _stopVizLoop() {
  if (vizAnimFrame) { cancelAnimationFrame(vizAnimFrame); vizAnimFrame = null; }
}

function _startVizLoop() {
  _stopVizLoop();
  const loop = () => {
    vizAnimFrame = requestAnimationFrame(loop);
    // Wire analyser lazily (audio context may not exist until first play)
    if (!vizAnalyser && audioCtx && sourceNode) setupVizAnalyser();
    const W = window.innerWidth;
    const H = window.innerHeight;
    const color = getComputedStyle(playerBar).getPropertyValue('--current-color').trim() || '#c41e3a';
    switch (vizMode) {
      case 0: _viz808(W, H, color);      break;
      case 1: _vizScope(W, H, color);    break;
      case 2: _vizSpectrum(W, H, color); break;
      case 3: _vizRadial(W, H, color);   break;
      case 4: _vizTunnel(W, H, color);   break;
      case 5: _vizAurora(W, H, color);   break;
    }
    // Fade-in transition overlay when mode switches
    if (vizFadeIn > 0) {
      vizCtx.fillStyle = `rgba(10,4,8,${vizFadeIn.toFixed(3)})`;
      vizCtx.fillRect(0, 0, W, H);
      vizFadeIn = Math.max(0, vizFadeIn - 0.048);
    }
  };
  loop();
}

// ── Shared utils ────────────────────────────────────────────────────
function _hexRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

function _getBassEnergy() {
  if (!vizFD) return 0;
  const end = Math.max(1, Math.floor(vizFD.length * 0.025));
  let sum = 0;
  for (let i = 0; i < end; i++) sum += vizFD[i];
  return sum / (end * 255);
}

function _spawnBurst(W, H, n, color) {
  for (let i = 0; i < n; i++) {
    const angle = Math.random() * Math.PI * 2;
    const spd   = 5 + Math.random() * 12;
    vizPtcls.push({
      x:     W * (0.25 + Math.random() * 0.5),
      y:     H * (0.25 + Math.random() * 0.5),
      vx:    Math.cos(angle) * spd,
      vy:    Math.sin(angle) * spd,
      life:  1,
      decay: 0.025 + Math.random() * 0.04,
      size:  2 + Math.random() * 5,
      color,
    });
  }
}

function _drawParticles() {
  for (let i = vizPtcls.length - 1; i >= 0; i--) {
    const p = vizPtcls[i];
    p.x += p.vx; p.y += p.vy;
    p.vy += 0.18; p.vx *= 0.97; p.vy *= 0.96;
    p.life -= p.decay;
    if (p.life <= 0) { vizPtcls.splice(i, 1); continue; }
    const a = Math.floor(p.life * 185).toString(16).padStart(2, '0');
    vizCtx.beginPath();
    vizCtx.arc(p.x, p.y, Math.max(0.5, p.size * p.life), 0, Math.PI * 2);
    vizCtx.fillStyle = p.color + a;
    vizCtx.fill();
  }
}

// ── MODE 0 — 808 BASS LINE ──────────────────────────────────────────
// Decimated time-domain data isolates bass frequencies (sub + 808 range).
// 4096 samples ÷ 32 = 128 points → covers ~0–689 Hz.
// When an 808 plays, the line oscillates at the pitch of the 808.
// When the 808 slides, the oscillation frequency visibly shifts.
// Phosphor trail (partial clear) creates a cinematic glow persistence.
function _viz808(W, H, color) {
  if (vizAnalyser) {
    vizAnalyser.getByteTimeDomainData(vizTD);
    vizAnalyser.getByteFrequencyData(vizFD);
  }

  // Phosphor trail — partial clear (shorter trail = faster alpha; longer = slower)
  vizCtx.fillStyle = `rgba(10,4,8,${Math.min(1, 8 / vizTrailLength).toFixed(3)})`;
  vizCtx.fillRect(0, 0, W, H);

  const bassE = _getBassEnergy();

  // ── Beat detection ──
  const inc = bassE - vizPrevBass;
  if (inc > 0.10 && bassE > 0.20) {
    vizBeatFlash = Math.min(1, vizBeatFlash + 0.55);
    if (vizParticleBurst) _spawnBurst(W, H, 12, color);
  }
  vizBeatFlash = Math.max(0, vizBeatFlash - 0.032);
  vizPrevBass  = vizPrevBass * 0.88 + bassE * 0.12;

  // Beat flash tint
  if (vizBeatFlash > 0.01) {
    const [r,g,b] = _hexRgb(color);
    vizCtx.fillStyle = `rgba(${r},${g},${b},${(vizBeatFlash * 0.07).toFixed(3)})`;
    vizCtx.fillRect(0, 0, W, H);
  }

  _drawParticles();

  if (!vizTD) return;

  const mid = H * 0.5;

  // ── Ghost full-range oscilloscope (very faint background layer) ──
  vizCtx.beginPath();
  vizCtx.strokeStyle = color + '0d';
  vizCtx.lineWidth = 1;
  for (let i = 0; i < vizTD.length; i++) {
    const x = (i / (vizTD.length - 1)) * W;
    const y = mid + ((vizTD[i] / 128) - 1) * H * 0.44;
    i === 0 ? vizCtx.moveTo(x, y) : vizCtx.lineTo(x, y);
  }
  vizCtx.stroke();

  // ── 808 BASS LINE — the main feature ──
  const DECIMATE = 32;
  const bassLine = [];
  for (let i = 0; i < vizTD.length; i += DECIMATE) bassLine.push(vizTD[i]);

  // Amplitude scales with bass energy + per-artist intensity
  const ampScale = (0.20 + bassE * 4.2) * vizIntensity;

  // Multi-pass glow: draw outer soft glow layers first, sharp core on top
  const PASSES = [
    { lw: 22,  a: 0.025 },
    { lw: 14,  a: 0.055 },
    { lw: 7,   a: 0.13  },
    { lw: 3.5, a: 0.50  },
    { lw: 1.5, a: 1.0   },
  ];

  vizCtx.lineJoin = 'round';
  vizCtx.lineCap  = 'round';

  for (const { lw, a } of PASSES) {
    vizCtx.beginPath();
    vizCtx.lineWidth   = lw;
    vizCtx.strokeStyle = color;
    vizCtx.globalAlpha = a;
    for (let i = 0; i < bassLine.length; i++) {
      const x = (i / (bassLine.length - 1)) * W;
      const y = mid + ((bassLine[i] / 128) - 1) * H * 0.46 * ampScale;
      i === 0 ? vizCtx.moveTo(x, y) : vizCtx.lineTo(x, y);
    }
    vizCtx.stroke();
  }
  vizCtx.globalAlpha = 1;

  // ── Small frequency bar strip at bottom ──
  if (vizFD) {
    const BC = 80;
    const bW = W / BC;
    const bMaxH = H * 0.09;
    for (let i = 0; i < BC; i++) {
      const t  = Math.pow(i / BC, 1.65);
      const bi = Math.min(Math.floor(t * vizFD.length * 0.55), vizFD.length - 1);
      const v  = vizFD[bi] / 255;
      vizCtx.fillStyle = color;
      vizCtx.globalAlpha = 0.10 + v * 0.52;
      vizCtx.fillRect(i * bW + 0.5, H - Math.max(1, v * bMaxH), Math.max(1, bW - 1), Math.max(1, v * bMaxH));
    }
    vizCtx.globalAlpha = 1;
  }
}

// ── MODE 1 — OSCILLOSCOPE ───────────────────────────────────────────
// Triggered on zero-crossing for a stable display.
function _vizScope(W, H, color) {
  if (vizAnalyser) vizAnalyser.getByteTimeDomainData(vizTD);

  // Phosphor trail — partial clear for oscilloscope (trail behind the wave)
  vizCtx.fillStyle = `rgba(10,4,8,${Math.min(1, 6 / vizTrailLength).toFixed(3)})`;
  vizCtx.fillRect(0, 0, W, H);

  if (!vizTD) return;

  // Subtle grid
  vizCtx.strokeStyle = color + '08';
  vizCtx.lineWidth = 0.5;
  for (let d = 1; d <= 3; d++) {
    const y = (d / 4) * H;
    vizCtx.beginPath(); vizCtx.moveTo(0, y); vizCtx.lineTo(W, y); vizCtx.stroke();
  }
  for (let d = 1; d <= 5; d++) {
    const x = (d / 6) * W;
    vizCtx.beginPath(); vizCtx.moveTo(x, 0); vizCtx.lineTo(x, H); vizCtx.stroke();
  }

  // Trigger: find zero-crossing (low→high) for stable display
  const sliceW = Math.floor(vizTD.length * 0.50);
  let trigger  = 0;
  for (let i = 8; i < vizTD.length - sliceW; i++) {
    if (vizTD[i - 1] < 128 && vizTD[i] >= 128) { trigger = i; break; }
  }

  // Multi-pass glow
  const PASSES = [
    { lw: 12, a: 0.04 },
    { lw: 6,  a: 0.10 },
    { lw: 2.5,a: 0.45 },
    { lw: 1,  a: 1.0  },
  ];

  vizCtx.lineJoin = 'round';
  for (const { lw, a } of PASSES) {
    vizCtx.beginPath();
    vizCtx.lineWidth = lw; vizCtx.strokeStyle = color; vizCtx.globalAlpha = a;
    for (let i = 0; i < sliceW; i++) {
      const x = (i / (sliceW - 1)) * W;
      const s = vizTD[trigger + i] ?? 128;
      const y = H * 0.5 + ((s / 128) - 1) * H * 0.46 * vizIntensity;
      i === 0 ? vizCtx.moveTo(x, y) : vizCtx.lineTo(x, y);
    }
    vizCtx.stroke();
  }
  vizCtx.globalAlpha = 1;

  // Centre axis
  vizCtx.strokeStyle = color + '18';
  vizCtx.lineWidth = 1;
  vizCtx.beginPath();
  vizCtx.moveTo(0, H * 0.5); vizCtx.lineTo(W, H * 0.5);
  vizCtx.stroke();
}

// ── MODE 2 — SPECTRUM ───────────────────────────────────────────────
// Log-ish frequency mapping; bass → crimson, treble → moonlight purple.
// Includes top-mirror reflection.
function _vizSpectrum(W, H, color) {
  if (vizAnalyser) vizAnalyser.getByteFrequencyData(vizFD);

  vizCtx.fillStyle = 'rgba(10,4,8,0.20)';
  vizCtx.fillRect(0, 0, W, H);

  if (!vizFD) return;

  const BC      = 128;
  const [r, g, b]   = _hexRgb(color);
  const [r2, g2, b2] = [180, 138, 216];
  const maxBH   = H * 0.74 * vizIntensity;

  // mirrorMode: bars grow from horizontal center outward (left+right halves)
  if (vizMirrorMode) {
    const halfBC  = BC / 2;
    const cx      = W * 0.5;
    const bW      = (W * 0.46) / halfBC;
    for (let i = 0; i < halfBC; i++) {
      const t   = Math.pow(i / halfBC, 1.78);
      const bi  = Math.min(Math.floor(t * vizFD.length * 0.78), vizFD.length - 1);
      const val = vizFD[bi] / 255;
      const bh  = Math.max(2, val * maxBH);
      const lo  = i / halfBC;
      const cr  = Math.round(r + (r2 - r) * lo);
      const cg  = Math.round(g + (g2 - g) * lo);
      const cb  = Math.round(b + (b2 - b) * lo);
      const alpha = 0.12 + val * 0.88;
      vizCtx.globalAlpha = alpha;
      // right half
      const xR = cx + i * bW;
      const gradR = vizCtx.createLinearGradient(xR, H - bh, xR, H);
      gradR.addColorStop(0, `rgba(${cr},${cg},${cb},0.92)`);
      gradR.addColorStop(1, `rgba(${cr},${cg},${cb},0.12)`);
      vizCtx.fillStyle = gradR;
      vizCtx.fillRect(xR, H - bh, Math.max(1, bW - 0.5), bh);
      // left half (mirrored)
      const xL = cx - (i + 1) * bW;
      const gradL = vizCtx.createLinearGradient(xL, H - bh, xL, H);
      gradL.addColorStop(0, `rgba(${cr},${cg},${cb},0.92)`);
      gradL.addColorStop(1, `rgba(${cr},${cg},${cb},0.12)`);
      vizCtx.fillStyle = gradL;
      vizCtx.fillRect(xL, H - bh, Math.max(1, bW - 0.5), bh);
    }
  } else {
    const pad    = W * 0.04;
    const usableW = W - pad * 2;
    const bW     = usableW / BC;
    for (let i = 0; i < BC; i++) {
      const t   = Math.pow(i / BC, 1.78);
      const bi  = Math.min(Math.floor(t * vizFD.length * 0.78), vizFD.length - 1);
      const val = vizFD[bi] / 255;
      const bh  = Math.max(2, val * maxBH);
      const x   = pad + i * bW;
      const lo  = i / BC;
      const cr  = Math.round(r + (r2 - r) * lo);
      const cg  = Math.round(g + (g2 - g) * lo);
      const cb  = Math.round(b + (b2 - b) * lo);
      const grad = vizCtx.createLinearGradient(x, H - bh, x, H);
      grad.addColorStop(0, `rgba(${cr},${cg},${cb},0.92)`);
      grad.addColorStop(1, `rgba(${cr},${cg},${cb},0.12)`);
      vizCtx.fillStyle = grad;
      vizCtx.globalAlpha = 0.12 + val * 0.88;
      if (vizCtx.roundRect) {
        vizCtx.beginPath();
        vizCtx.roundRect(x + 0.5, H - bh, Math.max(1, bW - 1), bh, Math.min(2, bW / 2));
        vizCtx.fill();
      } else {
        vizCtx.fillRect(x + 0.5, H - bh, Math.max(1, bW - 1), bh);
      }
      // Top mirror reflection
      vizCtx.globalAlpha = (0.12 + val * 0.88) * 0.22;
      vizCtx.fillRect(x + 0.5, 0, Math.max(1, bW - 1), bh * 0.32);
    }
  }
  vizCtx.globalAlpha = 1;
}

// ── MODE 3 — RADIAL ─────────────────────────────────────────────────
// 360° bars radiate outward; dual-ring with inner glow.
function _vizRadial(W, H, color) {
  if (vizAnalyser) vizAnalyser.getByteFrequencyData(vizFD);

  vizCtx.fillStyle = 'rgba(10,4,8,0.13)';
  vizCtx.fillRect(0, 0, W, H);

  if (!vizFD) return;

  const cx     = W * 0.5;
  const cy     = H * 0.5;
  const minDim = Math.min(W, H);
  const baseR  = minDim * 0.17;
  const maxExt = minDim * 0.32;
  const BC     = 200;
  const [r, g, b]   = _hexRgb(color);
  const [r2,g2,b2]  = [180, 138, 216];

  // Base ring
  vizCtx.beginPath();
  vizCtx.arc(cx, cy, baseR, 0, Math.PI * 2);
  vizCtx.strokeStyle = color + '1a';
  vizCtx.lineWidth = 1;
  vizCtx.stroke();

  vizRadialAngle += 0.002 * vizRotationSpeed;

  for (let i = 0; i < BC; i++) {
    const t   = Math.pow(i / BC, 1.55);
    const bi  = Math.min(Math.floor(t * vizFD.length * 0.72), vizFD.length - 1);
    const val = vizFD[bi] / 255;
    const barH = Math.max(2, val * maxExt * vizIntensity);
    const angle = (i / BC) * Math.PI * 2 - Math.PI * 0.5 + vizRadialAngle;

    const lo = i / BC;
    const cr = Math.round(r + (r2 - r) * lo);
    const cg = Math.round(g + (g2 - g) * lo);
    const cb = Math.round(b + (b2 - b) * lo);

    const x1 = cx + Math.cos(angle) * baseR;
    const y1 = cy + Math.sin(angle) * baseR;
    const x2 = cx + Math.cos(angle) * (baseR + barH);
    const y2 = cy + Math.sin(angle) * (baseR + barH);

    vizCtx.beginPath();
    vizCtx.moveTo(x1, y1);
    vizCtx.lineTo(x2, y2);
    vizCtx.strokeStyle = `rgb(${cr},${cg},${cb})`;
    vizCtx.lineWidth   = Math.max(1, minDim * 0.011);
    vizCtx.globalAlpha = 0.12 + val * 0.88;
    vizCtx.stroke();

    // Mirror bar on opposite side (subtle, half opacity)
    const x3 = cx - Math.cos(angle) * baseR;
    const y3 = cy - Math.sin(angle) * baseR;
    const x4 = cx - Math.cos(angle) * (baseR + barH * 0.55);
    const y4 = cy - Math.sin(angle) * (baseR + barH * 0.55);
    vizCtx.beginPath();
    vizCtx.moveTo(x3, y3);
    vizCtx.lineTo(x4, y4);
    vizCtx.globalAlpha = (0.12 + val * 0.88) * 0.35;
    vizCtx.stroke();
  }

  // Centre glow
  const grd = vizCtx.createRadialGradient(cx, cy, 0, cx, cy, baseR);
  grd.addColorStop(0, `rgba(${r},${g},${b},0.14)`);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  vizCtx.fillStyle = grd;
  vizCtx.globalAlpha = 1;
  vizCtx.beginPath();
  vizCtx.arc(cx, cy, baseR, 0, Math.PI * 2);
  vizCtx.fill();

  vizCtx.globalAlpha = 1;
}

// ── MODE 4 — TUNNEL ─────────────────────────────────────────────────
// Concentric rings rush toward the viewer; speed driven by bass energy.
function _vizTunnel(W, H, color) {
  if (vizAnalyser) {
    vizAnalyser.getByteFrequencyData(vizFD);
    vizAnalyser.getByteTimeDomainData(vizTD);
  }

  vizCtx.fillStyle = `rgba(10,4,8,${Math.min(1, 5 / vizTrailLength).toFixed(3)})`;
  vizCtx.fillRect(0, 0, W, H);

  const bassE  = _getBassEnergy();
  const cx     = W * 0.5;
  const cy     = H * 0.5;
  const [r, g, b] = _hexRgb(color);

  // Beat burst
  const inc = bassE - vizPrevBass;
  if (inc > 0.10 && bassE > 0.20) {
    vizBeatFlash = Math.min(1, vizBeatFlash + 0.6);
    if (vizParticleBurst) _spawnBurst(W, H, 10, color);
  }
  vizBeatFlash = Math.max(0, vizBeatFlash - 0.03);
  vizPrevBass  = vizPrevBass * 0.88 + bassE * 0.12;

  if (vizBeatFlash > 0.01) {
    vizCtx.fillStyle = `rgba(${r},${g},${b},${(vizBeatFlash * 0.08).toFixed(3)})`;
    vizCtx.fillRect(0, 0, W, H);
  }

  _drawParticles();

  // Advance tunnel depth
  vizTunnelZ = (vizTunnelZ + (0.8 + bassE * 3.5) * vizRotationSpeed * vizIntensity) % 80;

  const RINGS = 14;
  const maxR  = Math.max(W, H) * 0.78;

  for (let k = 0; k < RINGS; k++) {
    // Each ring has a depth value z ∈ [0,80); map to radius
    const z    = ((k / RINGS) * 80 + vizTunnelZ) % 80;
    const t    = z / 80;
    const rad  = t * maxR;
    if (rad < 2) continue;

    // Frequency bin for this ring (outer = higher freq)
    const bi  = Math.min(Math.floor(t * (vizFD ? vizFD.length * 0.6 : 0)), vizFD ? vizFD.length - 1 : 0);
    const val = vizFD ? vizFD[bi] / 255 : 0.5;

    const alpha = (1 - t) * (0.15 + val * 0.65);
    const lw    = Math.max(0.5, (1 - t) * 4 * (0.5 + val * vizIntensity));

    // Slight hue blend toward purple at distance
    const cr = Math.round(r + (140 - r) * t);
    const cg = Math.round(g + (80  - g) * t);
    const cb = Math.round(b + (200 - b) * t);

    vizCtx.beginPath();
    vizCtx.arc(cx, cy, rad, 0, Math.PI * 2);
    vizCtx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`;
    vizCtx.lineWidth = lw;
    vizCtx.stroke();
  }

  // Cross-hair centre point
  vizCtx.beginPath();
  vizCtx.arc(cx, cy, 3 + bassE * 10 * vizIntensity, 0, Math.PI * 2);
  vizCtx.fillStyle = `rgba(${r},${g},${b},0.85)`;
  vizCtx.globalAlpha = 1;
  vizCtx.fill();
}

// ── MODE 5 — AURORA ─────────────────────────────────────────────────
// Shimmering curtains of light — sine-wave bands driven by frequency data.
function _vizAurora(W, H, color) {
  if (vizAnalyser) vizAnalyser.getByteFrequencyData(vizFD);

  vizCtx.fillStyle = `rgba(10,4,8,${Math.min(1, 4 / vizTrailLength).toFixed(3)})`;
  vizCtx.fillRect(0, 0, W, H);

  vizAuroraTime += 0.018;

  const [r, g, b] = _hexRgb(color);
  const bassE = _getBassEnergy();
  const LAYERS = 6;

  for (let layer = 0; layer < LAYERS; layer++) {
    const lFrac = layer / LAYERS;
    // Each layer sits at a different vertical band
    const baseY = H * (0.15 + lFrac * 0.65);
    const amp   = (40 + lFrac * 60) * vizIntensity;
    const speed = 0.7 + lFrac * 0.5;
    const freq  = 0.006 + lFrac * 0.004;

    // Sample a frequency bin for this layer
    const bi  = vizFD ? Math.min(Math.floor(lFrac * vizFD.length * 0.5), vizFD.length - 1) : 0;
    const val = vizFD ? vizFD[bi] / 255 : 0.4;

    // Blend between artist color and a complementary cool hue
    const blend = lFrac;
    const cr  = Math.round(r * (1 - blend) + 80  * blend);
    const cg  = Math.round(g * (1 - blend) + 180 * blend);
    const cb  = Math.round(b * (1 - blend) + 255 * blend);

    const alpha = (0.05 + val * 0.25) * (0.5 + (1 - lFrac) * 0.5);

    vizCtx.beginPath();
    for (let x = 0; x <= W; x += 3) {
      const y = baseY
        + Math.sin(x * freq + vizAuroraTime * speed + layer) * amp * (0.5 + val * 0.5)
        + Math.sin(x * freq * 1.7 - vizAuroraTime * speed * 0.6 + layer * 2) * amp * 0.3
        + bassE * 35 * vizIntensity * Math.sin(x * 0.01 + vizAuroraTime);
      x === 0 ? vizCtx.moveTo(x, y) : vizCtx.lineTo(x, y);
    }

    const curtainH = 60 + val * 120 * vizIntensity;
    const grad = vizCtx.createLinearGradient(0, baseY - curtainH, 0, baseY + curtainH * 0.4);
    grad.addColorStop(0, `rgba(${cr},${cg},${cb},0)`);
    grad.addColorStop(0.35, `rgba(${cr},${cg},${cb},${(alpha * 1.8).toFixed(3)})`);
    grad.addColorStop(0.65, `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`);
    grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);

    vizCtx.lineWidth   = 2 + val * 4;
    vizCtx.strokeStyle = `rgba(${cr},${cg},${cb},${(alpha * 2).toFixed(3)})`;
    vizCtx.stroke();

    // Soft fill below the wave
    vizCtx.lineTo(W, H);
    vizCtx.lineTo(0, H);
    vizCtx.closePath();
    vizCtx.fillStyle = grad;
    vizCtx.fill();
  }

  vizCtx.globalAlpha = 1;
}

// ── Per-artist visualizer config ─────────────────────────────────────
function applyVizArtistConfig(artist) {
  // If user manually picked a mode AND same artist is still playing, don't override
  if (vizManualOverride && artist === _vizCurrentArtist) return;
  // Different artist → clear manual override, reset to artist default
  vizManualOverride = false;
  _vizCurrentArtist = artist;

  // Look up config in runtime palette store (which carries the full JSON incl. visualizer)
  const key = (artist || '').toLowerCase();
  let cfg = null;
  for (const [k, v] of Object.entries(artistPalettes)) {
    if ((key.includes(k) || k.includes(key)) && v && v.visualizer) {
      cfg = v.visualizer;
      break;
    }
  }
  if (!cfg) return;

  const MODE_MAP = { '808': 0, 'oscilloscope': 1, 'spectrum': 2, 'radial': 3, 'tunnel': 4, 'aurora': 5 };

  // Apply settings with defaults
  vizIntensity     = cfg.intensity     ?? 1.0;
  vizTrailLength   = cfg.trailLength   ?? 50;
  vizMirrorMode    = cfg.mirrorMode    ?? false;
  vizRotationSpeed = cfg.rotationSpeed ?? 1.0;
  vizParticleBurst = cfg.particleBurst ?? true;

  // Switch mode (not manual — won't set override flag)
  if (cfg.mode && MODE_MAP[cfg.mode] !== undefined) {
    _setVizMode(MODE_MAP[cfg.mode]);
  }
}

// =====================================================================
// ██████  CROSSFADE ENGINE
// =====================================================================

/**
 * crossfadeTo(idx)
 * Smoothly transitions to the track at playlist index `idx`.
 * - Loads the incoming track into the secondary <audio id="audio-xfade"> element
 * - Ramps gainMain 1→0 and gainXfade 0→1 over xfadeDuration seconds
 * - After the fade, swaps audio state back to the main element (so all
 *   existing event handlers / timeupdate / ended continue to work)
 * - Falls back to direct playAtIndex() when xfadeDuration=0 or no context
 */
function crossfadeTo(idx) {
  // FIX: Sleep timer vs gapless conflict — safety net: don't crossfade during sleep fade — The Vault conflict resolution
  if (_sleepFading) return;
  const playlist = getPlaylist();
  if (idx < 0 || idx >= playlist.length) return;
  const t = playlist[idx];
  if (!t || !t.url) { showToast('NO AUDIO SOURCE', 'error'); return; }

  // Ensure audio context is running
  if (!audioCtx || !gainMain) {
    playAtIndex(idx);
    return;
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();

  // Instant switch when duration=0 or not currently playing
  if (xfadeDuration <= 0 || !isPlaying) {
    playAtIndex(idx);
    return;
  }

  // Cancel any in-progress crossfade cleanly
  if (isXfading) {
    clearTimeout(xfadeTimer);
    const now0 = audioCtx.currentTime;
    gainMain.gain.cancelScheduledValues(now0);
    gainXfade.gain.cancelScheduledValues(now0);
    gainMain.gain.setValueAtTime(1, now0);
    gainXfade.gain.setValueAtTime(0, now0);
    audioXfade.pause();
    audioXfade.src = '';
    audioXfade.load();
    isXfading = false;
  }

  isXfading = true;

  // Load + start the incoming track on the secondary element.
  // If the T-10s pre-buffer already loaded this URL, skip the src
  // re-assignment so the browser can start from its buffer immediately.
  const _preBuffered = audioXfade.src === t.url && audioXfade.readyState >= 2;
  if (!_preBuffered) {
    audioXfade.src = t.url;
    audioXfade.currentTime = 0;
  } else {
    audioXfade.currentTime = 0; // rewind to start for the xfade
  }
  audioXfade.volume = 1;
  // FIX: Pitch shift vs crossfade conflict — apply current pitch to xfade node before fade-in — The Vault conflict resolution
  if (pitchNodeXfade && pitchWorkletReady) {
    const _pitchRatio = Math.pow(2, pitchSemitones / 12);
    pitchNodeXfade.port.postMessage({ ratio: _pitchRatio });
  }
  const xp = audioXfade.play();
  if (xp) xp.catch(() => {});

  // Ramp gains
  const now = audioCtx.currentTime;
  const end = now + xfadeDuration;

  gainMain.gain.cancelScheduledValues(now);
  gainMain.gain.setValueAtTime(gainMain.gain.value, now);
  gainMain.gain.linearRampToValueAtTime(0, end);

  gainXfade.gain.cancelScheduledValues(now);
  gainXfade.gain.setValueAtTime(gainXfade.gain.value, now);
  gainXfade.gain.linearRampToValueAtTime(1, end);

  // Update UI immediately so the user sees the incoming track right away
  currentTrackIdx = idx;
  _updatePlayerUI(t, idx);

  // ── Early-swap: start main audio ~300 ms before fade completes ──
  // This gives the browser time to seek to the right position in the
  // cached buffer before we switch gain control back to gainMain.
  const EARLY_MS = Math.min(300, xfadeDuration * 500);
  const swapDelay = Math.max(0, xfadeDuration * 1000 - EARLY_MS);

  setTimeout(() => {
    if (!isXfading) return; // cancelled in the meantime
    // Pre-warm main audio element at xfade's current position
    const saveTime = audioXfade.currentTime;
    audio.src = t.url;
    audio.currentTime = saveTime;
    // Keep gainMain at 0 — xfade is still audible
    const ap = audio.play();
    if (ap) ap.catch(() => {});
  }, swapDelay);

  // ── Final swap: hand off audio at fade end ──────────────────────
  xfadeTimer = setTimeout(() => {
    isXfading = false;
    const nc = audioCtx.currentTime;
    // Switch gains atomically
    gainXfade.gain.cancelScheduledValues(nc);
    gainXfade.gain.setValueAtTime(0, nc);
    gainMain.gain.cancelScheduledValues(nc);
    gainMain.gain.setValueAtTime(1, nc);
    // Silence and clean up xfade element
    audioXfade.pause();
    audioXfade.src = '';
    audioXfade.load();
    // Reset gapless trigger for the new track
    gaplessTriggered = false;
  }, xfadeDuration * 1000 + 60);
}

/**
 * _updatePlayerUI(t, idx)
 * Updates title, artist, cover art, viz overlay, etc. for track `t`.
 * Extracted from playAtIndex so crossfadeTo can call it immediately.
 */
function _updatePlayerUI(t, idx) {
  applyArtistPalette(t.artist);
  applyVizArtistConfig(t.artist);
  _updateMediaSession();
  const color = getArtistPalette(t.artist).primary;
  document.getElementById('player-title').textContent = t.title;
  const _paEl2 = document.getElementById('player-artist');
  _paEl2.textContent = t.artist.toUpperCase();
  _paEl2.classList.add('artist-link');
  _paEl2.onclick = (e) => { e.stopPropagation(); openArtistPage(t.artist); };
  const ppBtn = document.getElementById('play-pause-btn');
  ppBtn.innerHTML = '⏸';
  ppBtn.classList.add('is-playing');
  ppBtn.style.background = color;
  document.getElementById('player-vinyl').classList.add('spinning');
  playerBar.classList.add('visible');
  isPlaying = true;

  setArtistBG(t.artist);
  showCanvas(t);
  maybeFetchLyrics(t);
  maybeLoadStems(t);
  incrementPlayCount(t.id);
  addToRecentlyPlayed(t.id);
  renderRecentlyPlayed();
  renderQueue();

  // Cover art
  const vinylImg = document.getElementById('player-cover-img');
  vinylImg.classList.remove('loaded');
  if (t.coverArt) {
    vinylImg.src = t.coverArt;
    if (vinylImg.complete) vinylImg.classList.add('loaded');
    else vinylImg.onload = () => vinylImg.classList.add('loaded');
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

  // Viz HUD
  const vt = document.getElementById('viz-track-title');
  const va = document.getElementById('viz-track-artist');
  if (vt) vt.textContent = t.title;
  if (va) va.textContent = t.artist.toUpperCase();

  renderTracks();
  updateLikeBtn();
  setTimeout(() => schedulePreload(getPlaylist(), idx), 800);
}

// Wire crossfade slider
(function() {
  const sl  = document.getElementById('xfade-slider');
  const lbl = document.getElementById('xfade-val');
  if (!sl) return;
  sl.addEventListener('input', () => {
    xfadeDuration = parseFloat(sl.value);
    lbl.textContent = xfadeDuration === 0 ? 'OFF' : xfadeDuration + 's';
  });
})();

// =====================================================================
// ██████  EQ / FX ENGINE
// =====================================================================

/**
 * _buildIR()
 * Generates a simple exponentially-decaying noise impulse response for
 * the reverb ConvolverNode. Called once during setupAudioContext().
 */
function _buildIR() {
  if (!audioCtx || !convolver) return;
  try {
    const sr  = audioCtx.sampleRate;
    const len = Math.round(sr * 2.8);   // 2.8-second tail
    const buf = audioCtx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        // exponential decay with slight pre-delay
        const env = i < sr * 0.01
          ? 0
          : Math.pow(1 - (i - sr * 0.01) / (len - sr * 0.01), 3.2);
        ch[i] = (Math.random() * 2 - 1) * env;
      }
    }
    convolver.buffer = buf;
  } catch(e) {
    console.warn('IR build failed:', e);
  }
}

/**
 * _makeDistCurve(amount)
 * Creates a soft-clip WaveShaperNode curve for lo-fi warmth.
 * amount 0 = clean, 100 = heavily crushed.
 */
function _makeDistCurve(amount) {
  const n = 256;
  const curve = new Float32Array(n);
  const k = amount === 0 ? 0.001 : amount;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = (Math.PI + k) * x / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

// EQ preset definitions
const EQ_PRESETS = {
  clean:  { bass: 0,   mid: 0,   treble: 0,   reverb: 0,    lofi: false },
  bass:   { bass: 8,   mid: -1,  treble: -2,  reverb: 0,    lofi: false },
  lofi:   { bass: 3,   mid: -2,  treble: -6,  reverb: 0.12, lofi: true  },
  reverb: { bass: 1,   mid: 0,   treble: 2,   reverb: 0.55, lofi: false },
};

function applyEQPreset(name) {
  const p = EQ_PRESETS[name];
  if (!p) return;
  // Ensure audio context exists before touching nodes
  if (!eqBass) return;

  const bassEl   = document.getElementById('eq-bass-sl');
  const midEl    = document.getElementById('eq-mid-sl');
  const trebleEl = document.getElementById('eq-treble-sl');
  const reverbEl = document.getElementById('eq-reverb-sl');

  if (bassEl)   { bassEl.value   = p.bass;   _setEQSliderVal('bass',   p.bass);   }
  if (midEl)    { midEl.value    = p.mid;    _setEQSliderVal('mid',    p.mid);    }
  if (trebleEl) { trebleEl.value = p.treble; _setEQSliderVal('treble', p.treble); }
  if (reverbEl) { reverbEl.value = p.reverb; _setEQSliderVal('reverb', p.reverb); }

  _setLoFi(p.lofi);

  // Highlight active preset button
  document.querySelectorAll('.eq-preset-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.preset === name);
  });
}

function _setEQSliderVal(band, val) {
  if (!eqBass || !audioCtx) return; // audio not set up yet
  if (band === 'bass') {
    eqBass.gain.setTargetAtTime(val, audioCtx.currentTime, 0.05);
    const el = document.getElementById('eq-bass-val');
    if (el) el.textContent = (val >= 0 ? '+' : '') + val + ' dB';
  } else if (band === 'mid') {
    eqMid.gain.setTargetAtTime(val, audioCtx.currentTime, 0.05);
    const el = document.getElementById('eq-mid-val');
    if (el) el.textContent = (val >= 0 ? '+' : '') + val + ' dB';
  } else if (band === 'treble') {
    eqTreble.gain.setTargetAtTime(val, audioCtx.currentTime, 0.05);
    const el = document.getElementById('eq-treble-val');
    if (el) el.textContent = (val >= 0 ? '+' : '') + val + ' dB';
  } else if (band === 'reverb') {
    const pct = Math.round(val * 100);
    reverbWetGain.gain.setTargetAtTime(val, audioCtx.currentTime, 0.05);
    reverbDryGain.gain.setTargetAtTime(1 - val * 0.7, audioCtx.currentTime, 0.05);
    const el = document.getElementById('eq-reverb-val');
    if (el) el.textContent = pct + '%';
  }
}

function _setLoFi(on) {
  const btn  = document.getElementById('eq-lofi-toggle');
  const grp  = document.getElementById('eq-lofi-group');
  if (!btn) return;
  btn.classList.toggle('on', on);
  if (grp) grp.classList.toggle('on', on);
  if (!lofiHighCut || !lofiDistort || !audioCtx) return;
  if (on) {
    lofiHighCut.gain.setTargetAtTime(-12, audioCtx.currentTime, 0.08);
    lofiDistort.curve = _makeDistCurve(60);
  } else {
    lofiHighCut.gain.setTargetAtTime(0, audioCtx.currentTime, 0.08);
    lofiDistort.curve = null;
  }
}

// Wire EQ panel controls
(function wireEQ() {
  // EQ sliders
  ['bass','mid','treble','reverb'].forEach(band => {
    const sl = document.getElementById(`eq-${band}-sl`);
    if (!sl) return;
    sl.addEventListener('input', () => {
      setupAudioContext(); // ensure nodes exist
      _setEQSliderVal(band, parseFloat(sl.value));
      // Deactivate preset buttons (manual tweak)
      document.querySelectorAll('.eq-preset-btn').forEach(b => b.classList.remove('active'));
    });
  });

  // Preset buttons
  document.querySelectorAll('.eq-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setupAudioContext();
      applyEQPreset(btn.dataset.preset);
    });
  });

  // Lo-fi toggle
  const lofiBtn = document.getElementById('eq-lofi-toggle');
  if (lofiBtn) {
    lofiBtn.addEventListener('click', () => {
      setupAudioContext();
      _setLoFi(!lofiBtn.classList.contains('on'));
      document.querySelectorAll('.eq-preset-btn').forEach(b => b.classList.remove('active'));
    });
  }

  // Gapless toggle
  const gapBtn = document.getElementById('eq-gapless-toggle');
  const gapGrp = document.getElementById('eq-gapless-group');
  if (gapBtn) {
    gapBtn.addEventListener('click', () => {
      gaplessEnabled = !gaplessEnabled;
      gapBtn.classList.toggle('on', gaplessEnabled);
      if (gapGrp) gapGrp.classList.toggle('on', gaplessEnabled);
    });
  }

  // FX panel open/close button
  const eqOpenBtn  = document.getElementById('eq-btn');
  const eqPanel    = document.getElementById('eq-panel');
  const eqCloseBtn = document.getElementById('eq-panel-close');

  function toggleEQPanel() {
    const isOpen = eqPanel.classList.toggle('open');
    playerBar.classList.toggle('eq-open', isOpen);
    document.getElementById('stem-panel')?.classList.toggle('eq-open', isOpen);
    document.getElementById('lyrics-panel')?.classList.toggle('eq-open', isOpen);
    eqOpenBtn?.classList.toggle('active', isOpen);
    if (isOpen) setupAudioContext(); // ensure audio nodes ready
  }

  if (eqOpenBtn)  eqOpenBtn.addEventListener('click', toggleEQPanel);
  if (eqCloseBtn) eqCloseBtn.addEventListener('click', toggleEQPanel);
  document.getElementById('mobile-eq-btn')?.addEventListener('click', toggleEQPanel);

  // Keyboard shortcut: E
  // (added to the existing keydown switch in vault.js main handler)
})();

// Add 'e'/'E' keyboard shortcut to the existing keydown handler
(function() {
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'e' || e.key === 'E') {
      document.getElementById('eq-btn')?.click();
    }
  });
})();

// =====================================================================
// ██████  PITCH SHIFT ENGINE
// =====================================================================

/**
 * Loads the AudioWorklet pitch-processor module and wires the PitchShifterNode
 * into the signal chain between gainMain and eqBass.
 * Falls back gracefully if AudioWorklet is not supported.
 */
async function _initPitchWorklet() {
  if (pitchWorkletReady || pitchNode) return;
  if (!audioCtx) return;
  try {
    await audioCtx.audioWorklet.addModule('pitch-processor.js');
    pitchNode = new AudioWorkletNode(audioCtx, 'pitch-shifter', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    pitchNode.port.postMessage({ ratio: 1.0 });

    // Re-wire: gainMain  → pitchNode      → eqBass
    gainMain.disconnect(eqBass);
    gainMain.connect(pitchNode);
    pitchNode.connect(eqBass);

    // FIX: Pitch shift vs crossfade conflict — wire xfade path through its own pitch node — The Vault conflict resolution
    pitchNodeXfade = new AudioWorkletNode(audioCtx, 'pitch-shifter', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    pitchNodeXfade.port.postMessage({ ratio: 1.0 });
    // Re-wire: gainXfade → pitchNodeXfade → eqBass
    gainXfade.disconnect(eqBass);
    gainXfade.connect(pitchNodeXfade);
    pitchNodeXfade.connect(eqBass);

    pitchWorkletReady = true;
    console.log('[Vault] Pitch worklet ready');
  } catch(e) {
    console.warn('[Vault] Pitch worklet not available — pitch shift disabled:', e);
    pitchNode = null;
    pitchWorkletReady = false;
  }
}

/**
 * setPitchSemitones(st)
 * Adjusts pitch by `st` semitones without changing playback speed.
 */
async function setPitchSemitones(st) {
  pitchSemitones = Math.max(-12, Math.min(12, Math.round(st)));
  const display = document.getElementById('pitch-display');
  if (display) {
    display.textContent = pitchSemitones === 0 ? '0st' : (pitchSemitones > 0 ? '+' : '') + pitchSemitones + 'st';
    display.classList.toggle('shifted', pitchSemitones !== 0);
  }

  if (pitchSemitones === 0 && !pitchWorkletReady) return; // no-op when flat + not loaded

  // Lazy-init worklet on first use
  if (!pitchWorkletReady) {
    setupAudioContext();
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    await _initPitchWorklet();
  }

  if (pitchNode) {
    const ratio = Math.pow(2, pitchSemitones / 12);
    pitchNode.port.postMessage({ ratio });
    // FIX: Pitch shift vs crossfade conflict — keep xfade node in sync — The Vault conflict resolution
    if (pitchNodeXfade) pitchNodeXfade.port.postMessage({ ratio });
  }
}

// Wire pitch controls
(function wirePitch() {
  const upBtn    = document.getElementById('pitch-up-btn');
  const downBtn  = document.getElementById('pitch-down-btn');
  const resetBtn = document.getElementById('pitch-reset-btn');

  if (upBtn)    upBtn.addEventListener('click',    () => setPitchSemitones(pitchSemitones + 1));
  if (downBtn)  downBtn.addEventListener('click',  () => setPitchSemitones(pitchSemitones - 1));
  if (resetBtn) resetBtn.addEventListener('click', () => setPitchSemitones(0));
})();

// =====================================================================
// end of The Vault feature extensions
// =====================================================================

// ===== PALETTE EDITOR =====
// Updates the live preview strip inside the edit modal whenever a picker changes.
function updatePalettePreview() {
  const preview = document.getElementById('palette-preview');
  if (!preview) return;
  const vals = {
    '--pe-primary':    document.getElementById('pe-primary')?.value    || '#c41e3a',
    '--pe-secondary':  document.getElementById('pe-secondary')?.value  || '#1a0a0d',
    '--pe-text':       document.getElementById('pe-text')?.value       || '#ff6b8a',
    '--pe-glow':       document.getElementById('pe-glow')?.value       || '#ff003c',
    '--pe-grad-start': document.getElementById('pe-grad-start')?.value || '#c41e3a',
    '--pe-grad-end':   document.getElementById('pe-grad-end')?.value   || '#6b0020',
  };
  for (const [k, v] of Object.entries(vals)) {
    preview.style.setProperty(k, v);
  }
}

// Wire live-update on every picker input
['pe-primary','pe-secondary','pe-text','pe-glow','pe-grad-start','pe-grad-end'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', updatePalettePreview);
});

// "Generate from Primary" — derives the other 4 slots from the primary color
const _peGenerateBtn = document.getElementById('pe-generate-btn');
if (_peGenerateBtn) {
  _peGenerateBtn.addEventListener('click', () => {
    const primary = document.getElementById('pe-primary').value;
    const pal = generatePaletteFromPrimary(primary);
    document.getElementById('pe-secondary').value  = pal.secondary;
    document.getElementById('pe-text').value       = pal.text;
    document.getElementById('pe-glow').value       = pal.glow;
    document.getElementById('pe-grad-start').value = pal.gradient[0];
    document.getElementById('pe-grad-end').value   = pal.gradient[1];
    updatePalettePreview();
  });
}

// "Reset to Default" — restores ARTIST_PALETTES_DEFAULT for the current artist
const _peResetBtn = document.getElementById('pe-reset-btn');
if (_peResetBtn) {
  _peResetBtn.addEventListener('click', () => {
    if (!editingTrackId) return;
    const t = tracks.find(x => x.id === editingTrackId);
    if (!t) return;
    const key = (t.artist || '').toLowerCase();
    let defaultPal = null;
    for (const [k, v] of Object.entries(ARTIST_PALETTES_DEFAULT)) {
      if (key.includes(k)) { defaultPal = v; break; }
    }
    if (!defaultPal) defaultPal = generatePaletteFromPrimary(getArtistColor(t.artist));
    document.getElementById('pe-primary').value    = defaultPal.primary;
    document.getElementById('pe-secondary').value  = defaultPal.secondary;
    document.getElementById('pe-text').value       = defaultPal.text;
    document.getElementById('pe-glow').value       = defaultPal.glow;
    document.getElementById('pe-grad-start').value = defaultPal.gradient[0];
    document.getElementById('pe-grad-end').value   = defaultPal.gradient[1];
    updatePalettePreview();
  });
}

// =====================================================================
// VISUALIZER EDITOR — wired to edit modal fields
// =====================================================================

function _veUpdateVisibility(mode) {
  const trailRow    = document.getElementById('ve-trail-row');
  const rotRow      = document.getElementById('ve-rotation-row');
  const mirrorRow   = document.getElementById('ve-mirror-row');
  if (!trailRow) return;
  trailRow.style.display  = (mode === '808' || mode === 'oscilloscope') ? '' : 'none';
  rotRow.style.display    = (mode === 'radial' || mode === 'tunnel')    ? '' : 'none';
  mirrorRow.style.display = (mode === 'spectrum')                       ? '' : 'none';
}

(function _wireVizEditor() {
  const modeEl = document.getElementById('ve-mode');
  if (!modeEl) return;

  modeEl.addEventListener('change', () => _veUpdateVisibility(modeEl.value));

  const rangePairs = [
    ['ve-intensity', 've-intensity-val', v => parseFloat(v).toFixed(1)],
    ['ve-trail',     've-trail-val',     v => parseInt(v)],
    ['ve-rotation',  've-rotation-val',  v => parseFloat(v).toFixed(1)],
  ];
  rangePairs.forEach(([inputId, labelId, fmt]) => {
    const el = document.getElementById(inputId);
    const lb = document.getElementById(labelId);
    if (el && lb) el.addEventListener('input', () => { lb.textContent = fmt(el.value); });
  });

  // Preview button — opens the visualizer in the selected mode with current settings
  const previewBtn = document.getElementById('ve-preview-btn');
  if (previewBtn) {
    previewBtn.addEventListener('click', () => {
      const MODE_MAP = { '808': 0, 'oscilloscope': 1, 'spectrum': 2, 'radial': 3, 'tunnel': 4, 'aurora': 5 };
      const mode = document.getElementById('ve-mode').value;
      const modeIdx = MODE_MAP[mode] ?? 0;
      // Apply settings to live vars so preview is accurate
      vizIntensity     = parseFloat(document.getElementById('ve-intensity').value);
      vizTrailLength   = parseInt(document.getElementById('ve-trail').value);
      vizRotationSpeed = parseFloat(document.getElementById('ve-rotation').value);
      vizMirrorMode    = document.getElementById('ve-mirror').checked;
      vizParticleBurst = document.getElementById('ve-burst').checked;
      vizManualOverride = true;
      _setVizMode(modeIdx, true);
      if (typeof openVisualizer === 'function' && !vizOpen) openVisualizer();
    });
  }
})();

// =====================================================================
// MEDIA SESSION API — Lock screen / notification tray controls
// =====================================================================

function _updateMediaSession() {
  try {
    if (!('mediaSession' in navigator)) return;
    const pl = getPlaylist();
    const t  = pl[currentTrackIdx];
    if (!t) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title:   t.title,
      artist:  t.artist,
      album:   'The Vault',
      artwork: t.coverArt
        ? [
            { src: t.coverArt, sizes: '96x96',   type: 'image/jpeg' },
            { src: t.coverArt, sizes: '256x256', type: 'image/jpeg' },
            { src: t.coverArt, sizes: '512x512', type: 'image/jpeg' },
          ]
        : [],
    });
  } catch (e) {}
}

function _updatePositionState() {
  try {
    if (!('mediaSession' in navigator) || !audio.duration || !isFinite(audio.duration)) return;
    navigator.mediaSession.setPositionState({
      duration:     audio.duration,
      playbackRate: audio.playbackRate || 1,
      position:     Math.min(audio.currentTime, audio.duration),
    });
  } catch (e) {}
}

let _positionStateTimer = null;

// Wire media session to audio events
audio.addEventListener('play', () => {
  try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; } catch (e) {}
  if (!_positionStateTimer) _positionStateTimer = setInterval(_updatePositionState, 5000);
});
audio.addEventListener('pause', () => {
  try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; } catch (e) {}
  clearInterval(_positionStateTimer); _positionStateTimer = null;
  _updatePositionState();
});
audio.addEventListener('ended', () => {
  try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none'; } catch (e) {}
  clearInterval(_positionStateTimer); _positionStateTimer = null;
});
audio.addEventListener('seeked', _updatePositionState);

// Set up action handlers (safe to call multiple times)
(function _setupMediaSessionHandlers() {
  try {
    if (!('mediaSession' in navigator)) return;

    const setH = (action, fn) => {
      try { navigator.mediaSession.setActionHandler(action, fn); } catch (e) {}
    };

    setH('play',          () => audio.play().catch(() => {}));
    setH('pause',         () => audio.pause());
    setH('nexttrack',     () => document.getElementById('next-btn')?.click());
    setH('previoustrack', () => document.getElementById('prev-btn')?.click());
    setH('seekto',        d  => {
      if (audio.duration) audio.currentTime = d.seekTime;
      _updatePositionState();
    });
    setH('seekbackward',  d  => {
      audio.currentTime = Math.max(0, audio.currentTime - (d.seekOffset || 10));
      _updatePositionState();
    });
    setH('seekforward',   d  => {
      if (audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + (d.seekOffset || 10));
      _updatePositionState();
    });
    setH('stop', () => { audio.pause(); audio.currentTime = 0; });
  } catch (e) {}
})();

// =====================================================================
// SERVICE WORKER + OFFLINE
// =====================================================================

const _cachedTrackUrls = new Set();
let   _swReady         = false;

function _swSend(msg) {
  if (!navigator.serviceWorker?.controller) return;
  navigator.serviceWorker.controller.postMessage(msg);
}

function _cacheCurrentTrack() {
  const pl = getPlaylist();
  const t  = pl[currentTrackIdx];
  if (t && t.url) _swSend({ type: 'CACHE_TRACK', url: t.url, trackId: t.id });
}

// Offline UI
function _setOffline(offline) {
  const badge = document.getElementById('offline-badge');
  if (badge) badge.style.display = offline ? 'flex' : 'none';
  if (!offline) showToast('Back online', 'success');
  else showToast("You're offline — cached tracks available", '');
  _applyOfflineState();
}

function _applyOfflineState() {
  document.querySelectorAll('#tracks-grid .track-card').forEach(card => {
    const id = parseInt(card.dataset.id);
    const t  = tracks.find(x => x.id === id);
    const cached = t && t.url && _cachedTrackUrls.has(t.url);
    card.classList.toggle('is-cached', !!cached);
    if (!navigator.onLine) {
      card.classList.toggle('offline-uncached', !cached || !t || !t.url);
    } else {
      card.classList.remove('offline-uncached');
    }
  });
}

window.addEventListener('online',  () => _setOffline(false));
window.addEventListener('offline', () => _setOffline(true));
if (!navigator.onLine) _setOffline(true);

// Cache current track when audio starts playing
audio.addEventListener('play', _cacheCurrentTrack);

// SW registration and message handling
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then(() => { _swReady = true; })
    .catch(() => {});

  navigator.serviceWorker.addEventListener('message', event => {
    const d = event.data;
    if (!d) return;
    switch (d.type) {
      case 'SERVED_OFFLINE':
        showToast('PLAYING FROM CACHE', '');
        break;
      case 'TRACK_CACHED':
        if (d.url) _cachedTrackUrls.add(d.url);
        break;
      case 'CACHED_URLS':
        (d.urls || []).forEach(u => _cachedTrackUrls.add(u));
        _applyOfflineState();
        break;
      case 'CACHE_INFO':
        _renderCacheInfo(d);
        break;
      case 'CACHE_PROGRESS':
        _renderCacheProgress(d.done, d.total);
        break;
      case 'AUDIO_CACHE_CLEARED':
        _cachedTrackUrls.clear();
        showToast('AUDIO CACHE CLEARED', 'success');
        _refreshCacheInfo();
        _applyOfflineState();
        break;
    }
  });

  // On load, fetch cached URL list so offline indicators show immediately
  navigator.serviceWorker.ready.then(reg => {
    if (reg.active) reg.active.postMessage({ type: 'GET_CACHED_URLS' });
  });
}

// ── Admin cache modal ──────────────────────────────────────────────────────────

document.getElementById('cache-btn').addEventListener('click', () => {
  openModal('cache-modal');
  _refreshCacheInfo();
});

document.getElementById('cache-clear-btn').addEventListener('click', () => {
  _swSend({ type: 'CLEAR_AUDIO_CACHE' });
  document.getElementById('cache-track-list').innerHTML = '';
  document.getElementById('cache-track-count').textContent = '0 tracks cached';
  document.getElementById('cache-total-size').textContent = '';
});

document.getElementById('cache-all-btn').addEventListener('click', () => {
  const toCache = tracks
    .filter(t => t.url)
    .map(t => ({ url: t.url, trackId: t.id }));
  if (!toCache.length) { showToast('NO AUDIO URLS TO CACHE', 'error'); return; }
  _swSend({ type: 'CACHE_ALL_TRACKS', tracks: toCache });
  document.getElementById('cache-progress-wrap').style.display = 'block';
  _renderCacheProgress(0, toCache.length);
});

document.getElementById('cache-modal-close').addEventListener('click', () => closeModal('cache-modal'));

function _refreshCacheInfo() {
  document.getElementById('cache-track-count').textContent = 'Loading…';
  _swSend({ type: 'GET_CACHE_INFO' });
}

function _renderCacheInfo(data) {
  const count = (data.tracks || []).length;
  const mb    = ((data.totalBytes || 0) / (1024 * 1024)).toFixed(1);
  document.getElementById('cache-track-count').textContent = `${count} track${count === 1 ? '' : 's'} cached`;
  document.getElementById('cache-total-size').textContent  = data.totalBytes ? `${mb} MB` : '';

  const list = document.getElementById('cache-track-list');
  list.innerHTML = '';
  (data.tracks || []).forEach(entry => {
    const t   = tracks.find(x => x.url === entry.url);
    const li  = document.createElement('div');
    li.className = 'cache-track-row';
    const name = t ? `${t.artist} — ${t.title}` : entry.url.split('/').pop();
    const sz   = entry.size ? `${(entry.size / (1024 * 1024)).toFixed(1)} MB` : '';
    li.innerHTML = `<span class="cache-track-name">${name}</span><span class="cache-track-sz">${sz}</span>`;
    list.appendChild(li);
  });
}

function _renderCacheProgress(done, total) {
  const wrap = document.getElementById('cache-progress-wrap');
  const fill = document.getElementById('cache-progress-fill');
  const text = document.getElementById('cache-progress-text');
  if (!wrap || !fill || !text) return;
  wrap.style.display = 'block';
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  fill.style.width = pct + '%';
  text.textContent = done >= total
    ? `✓ All ${total} tracks cached`
    : `Caching ${done} / ${total}…`;
  if (done >= total) {
    setTimeout(() => { wrap.style.display = 'none'; _refreshCacheInfo(); }, 2000);
  }
}

// =====================================================================
// VIEW MANAGEMENT
// =====================================================================
function setView(v) {
  activeView = v;

  const tracksGrid   = document.getElementById('tracks-grid');
  const filterBtns   = document.getElementById('filter-btns');
  const sortWrap     = document.querySelector('.sort-wrap');
  const sectionLabel = document.getElementById('section-label');
  const recentSec    = document.getElementById('recently-played-section');
  const artistHdr    = document.getElementById('artist-header');
  const projectsOv   = document.getElementById('projects-overlay');
  const historyOv    = document.getElementById('history-overlay');
  const statsOv      = document.getElementById('stats-overlay');
  const projDetailOv = document.getElementById('project-detail-overlay');
  const artistOv     = document.getElementById('artist-overlay');

  // Show/hide main track grid — keep visible for 'artist' since it's a fixed overlay
  const showTracks = v === 'tracks' || v === 'artist';
  if (tracksGrid)   tracksGrid.style.display  = showTracks ? '' : 'none';
  if (filterBtns)   filterBtns.style.display  = showTracks ? '' : 'none';
  if (sectionLabel) sectionLabel.style.display = showTracks ? '' : 'none';
  if (recentSec)    recentSec.style.display    = showTracks ? '' : 'none';
  if (artistHdr && v !== 'tracks') artistHdr.classList.remove('visible');

  if (projectsOv)   projectsOv.classList.toggle('open', v === 'projects');
  if (projDetailOv) projDetailOv.classList.toggle('open', v === 'project-detail');
  if (historyOv)    historyOv.classList.toggle('open', v === 'history');
  if (statsOv)      statsOv.classList.toggle('open', v === 'stats');
  if (artistOv)     artistOv.classList.toggle('open', v === 'artist');

  if (v !== 'project-detail' && projDetailOv) projDetailOv.innerHTML = '';

  // Update button active states
  const pb = document.getElementById('projects-view-btn');
  const hb = document.getElementById('history-view-btn');
  const sb = document.getElementById('stats-view-btn');
  if (pb) pb.classList.toggle('active', v === 'projects' || v === 'project-detail');
  if (hb) hb.classList.toggle('active', v === 'history');
  if (sb) sb.classList.toggle('active', v === 'stats');

  if (v === 'projects')       renderProjectsGrid();
  if (v === 'project-detail') renderProjectDetail(activeProjectId);
  if (v === 'history')        renderHistoryPage();
  if (v === 'stats')          renderStatsPage();
  if (v === 'artist')         renderArtistPage(activeArtistName);
  if (v === 'tracks') { renderTracks(); }
}

function openProjectDetail(id) {
  activeProjectId = String(id);
  setView('project-detail');
}

// =====================================================================
// FEATURE 2: PROJECTS
// =====================================================================
function renderProjectsGrid() {
  const ov = document.getElementById('projects-overlay');
  if (!ov) return;
  const grid = ov.querySelector('.projects-grid');
  if (!grid) return;

  if (!projects.length) {
    grid.innerHTML = '<div class="empty-state"><span class="big">∅</span>NO PROJECTS YET' +
      (isAdmin ? '<br><button class="btn primary" onclick="openProjectModal()">+ CREATE PROJECT</button>' : '') + '</div>';
    return;
  }

  grid.innerHTML = projects.map(p => {
    const count = tracks.filter(t => t.projectId === p.id).length;
    return `<div class="proj-card" onclick="openProjectDetail('${p.id}')">
      ${p.cover ? `<img class="proj-card-cover" src="${p.cover}" alt="">` : '<div class="proj-card-cover-placeholder">◈</div>'}
      <div class="proj-card-info">
        <div class="proj-card-title">${escHtml(p.title)}</div>
        <div class="proj-card-artist">${escHtml(p.artist)}</div>
        <div class="proj-card-meta">${count} track${count!==1?'s':''} · ${escHtml(p.releaseDate||'')}</div>
      </div>
      ${isAdmin ? `<div class="proj-card-actions">
        <button onclick="event.stopPropagation();openProjectModal('${p.id}')" title="Edit">✎</button>
        <button onclick="event.stopPropagation();deleteProject('${p.id}')" title="Delete">✕</button>
      </div>` : ''}
    </div>`;
  }).join('');
}

function renderProjectDetail(id) {
  const ov = document.getElementById('project-detail-overlay');
  if (!ov) return;
  ov.innerHTML = '';
  const p = projects.find(x => String(x.id) === String(id));
  if (!p) { setView('projects'); return; }

  const projTracks = (p.trackIds || [])
    .map(tid => tracks.find(t => String(t.id) === String(tid)))
    .filter(Boolean);

  const pal = getArtistPalette(p.artist);

  ov.innerHTML = `
    <div class="proj-detail-header" style="--artist-primary:${pal.primary};--artist-secondary:${pal.secondary}">
      ${p.cover ? `<img class="proj-detail-cover" src="${p.cover}" alt="">` : '<div class="proj-detail-cover-placeholder">◈</div>'}
      <div class="proj-detail-info">
        <div class="proj-detail-title">${escHtml(p.title)}</div>
        <div class="proj-detail-artist">${escHtml(p.artist)}</div>
        ${p.releaseDate ? `<div class="proj-detail-date">${escHtml(p.releaseDate)}</div>` : ''}
        ${p.description ? `<div class="proj-detail-desc">${escHtml(p.description)}</div>` : ''}
        <div class="proj-detail-btns">
          <button class="btn primary" onclick="playProject('${p.id}')">▶ Play All</button>
          <button class="btn" onclick="shuffleProject('${p.id}')">⇄ Shuffle</button>
          <button class="sort-btn" onclick="setView('projects')">← Back</button>
        </div>
      </div>
    </div>
    <div class="proj-tracklist">
      ${projTracks.map((t, i) => {
        const liked = likedTracks.has(String(t.id));
        return `<div class="proj-track-row" onclick="playProjectTrack('${p.id}',${i})">
          <span class="proj-track-num">${i+1}</span>
          <span class="proj-track-title">${escHtml(t.title)}</span>
          <span class="proj-track-artist">${escHtml(t.artist)}</span>
          <span class="proj-track-dur" id="ptdur-${t.id}">—</span>
          <button class="icon-btn" onclick="event.stopPropagation();toggleTrackLike(${t.id})" title="Like">${liked?'♥':'♡'}</button>
        </div>`;
      }).join('')}
    </div>`;

  // Attempt to fill in durations from audio metadata
  projTracks.forEach(t => {
    const tmp = new Audio();
    tmp.src = t.url;
    tmp.addEventListener('loadedmetadata', () => {
      const el = document.getElementById('ptdur-' + t.id);
      if (el) el.textContent = fmt(tmp.duration);
    }, { once: true });
  });
}

function playProject(id) {
  const p = projects.find(x => x.id === id);
  if (!p || !p.trackIds?.length) return;
  activeFilter = 'all';
  searchQuery = '';
  const first = tracks.findIndex(t => String(t.id) === String(p.trackIds[0]));
  if (first !== -1) playAtIndex(first);
}

function shuffleProject(id) {
  const p = projects.find(x => x.id === id);
  if (!p || !p.trackIds?.length) return;
  const ridx = Math.floor(Math.random() * p.trackIds.length);
  const tid = p.trackIds[ridx];
  const idx = tracks.findIndex(t => String(t.id) === String(tid));
  if (idx !== -1) playAtIndex(idx);
}

function playProjectTrack(pid, trackIdx) {
  const p = projects.find(x => x.id === pid);
  if (!p || !p.trackIds?.length) return;
  const tid = p.trackIds[trackIdx];
  const idx = tracks.findIndex(t => String(t.id) === String(tid));
  if (idx !== -1) playAtIndex(idx);
}

// ── Admin project management ──────────────────────────────────────────────────
let _editingProjectId = null;

function openProjectModal(id) {
  _editingProjectId = id || null;
  const modal = document.getElementById('project-modal');
  if (!modal) return;

  const p = id ? projects.find(x => x.id === id) : null;
  modal.querySelector('#pm-title').value        = p?.title       || '';
  modal.querySelector('#pm-artist').value       = p?.artist      || '';
  modal.querySelector('#pm-cover').value        = p?.cover       || '';
  modal.querySelector('#pm-release').value      = p?.releaseDate || '';
  modal.querySelector('#pm-desc').value         = p?.description || '';

  // Build searchable track checklist
  const list = modal.querySelector('#pm-track-list');
  list.innerHTML = tracks.map(t => {
    const checked = (p?.trackIds || []).map(String).includes(String(t.id));
    return `<label class="pm-track-item">
      <input type="checkbox" value="${t.id}" ${checked ? 'checked' : ''}>
      <span>${escHtml(t.artist)} — ${escHtml(t.title)}</span>
    </label>`;
  }).join('');

  openModal('project-modal');
}

async function saveProject() {
  const modal = document.getElementById('project-modal');
  if (!modal) return;
  const title  = modal.querySelector('#pm-title').value.trim();
  const artist = modal.querySelector('#pm-artist').value.trim();
  if (!title) { showToast('PROJECT NEEDS A TITLE', 'error'); return; }

  const checked = [...modal.querySelectorAll('#pm-track-list input:checked')].map(i => i.value);

  if (_editingProjectId) {
    const idx = projects.findIndex(x => x.id === _editingProjectId);
    if (idx !== -1) {
      projects[idx] = {
        ...projects[idx],
        title,
        artist,
        cover:       modal.querySelector('#pm-cover').value.trim(),
        releaseDate: modal.querySelector('#pm-release').value.trim(),
        description: modal.querySelector('#pm-desc').value.trim(),
        trackIds:    checked,
      };
    }
  } else {
    projects.push({
      id:          'proj-' + Date.now(),
      title,
      artist,
      cover:       modal.querySelector('#pm-cover').value.trim(),
      releaseDate: modal.querySelector('#pm-release').value.trim(),
      description: modal.querySelector('#pm-desc').value.trim(),
      trackIds:    checked,
    });
  }

  // Assign projectId to each track
  tracks.forEach(t => {
    const inProject = projects.find(p => (p.trackIds||[]).map(String).includes(String(t.id)));
    if (inProject) t.projectId = inProject.id;
    else delete t.projectId;
  });

  await saveProjects(projects);
  closeModal('project-modal');
  showToast(_editingProjectId ? 'PROJECT UPDATED' : 'PROJECT CREATED', 'success');
  if (activeView === 'projects') renderProjectsGrid();
  if (activeView === 'project-detail') renderProjectDetail(activeProjectId);
  renderTracks();
}

async function deleteProject(id) {
  if (!confirm('Delete this project? Tracks are not deleted.')) return;
  projects = projects.filter(p => p.id !== id);
  tracks.forEach(t => { if (t.projectId === id) delete t.projectId; });
  await saveProjects(projects);
  showToast('PROJECT DELETED', 'success');
  renderProjectsGrid();
  renderTracks();
}

// Search filter for pm-track-list
function _pmSearch(q) {
  const modal = document.getElementById('project-modal');
  if (!modal) return;
  const lq = q.toLowerCase();
  modal.querySelectorAll('.pm-track-item').forEach(item => {
    item.style.display = !lq || item.textContent.toLowerCase().includes(lq) ? '' : 'none';
  });
}

// iTunes cover art search for project modal
async function _pmFindCover() {
  const modal = document.getElementById('project-modal');
  if (!modal) return;
  const q = (modal.querySelector('#pm-artist').value + ' ' + modal.querySelector('#pm-title').value).trim();
  if (!q) return;
  try {
    const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=album&limit=5`);
    const data = await res.json();
    const results = modal.querySelector('#pm-cover-results');
    results.innerHTML = (data.results||[]).map(r =>
      `<img src="${r.artworkUrl100.replace('100x100','300x300')}" onclick="document.getElementById('project-modal').querySelector('#pm-cover').value='${r.artworkUrl100.replace('100x100','600x600')}';this.parentNode.innerHTML=''" style="width:60px;height:60px;object-fit:cover;border-radius:4px;cursor:pointer;margin:2px">`
    ).join('');
  } catch { showToast('COVER SEARCH FAILED', 'error'); }
}

// =====================================================================
// FEATURE 3 helper — expose session active state for YML
// =====================================================================
// (session.js sets window.sessionIsActive on start/end)

// =====================================================================
// FEATURE 4: YOU MIGHT LIKE
// =====================================================================
const HISTORY_MAX_RECENT = 10;
let _ymlRecentIds = [];
let _ymlTimer = null;
let _ymlCountdownRaf = null;
let _ymlNextIdx = -1;

function _showYML(nextIdx) {
  _ymlNextIdx = nextIdx;
  const playlist = getPlaylist();
  const current  = playlist[currentTrackIdx];
  if (!current) return false;

  // Build candidate pool: exclude current + last 10
  const excluded = new Set([String(current.id), ..._ymlRecentIds.map(String)]);
  let candidates = tracks.filter(t => !excluded.has(String(t.id)));

  // Priority 1: same artist, not in last 10
  let picks = candidates.filter(t => t.artist === current.artist);
  // Priority 2: matching tags
  if (picks.length < 2) {
    const tags = new Set(current.tags || []);
    picks = [...picks, ...candidates.filter(t => t.artist !== current.artist && (t.tags||[]).some(tag => tags.has(tag)))];
  }
  // Priority 3: any unplayed
  if (picks.length < 2) {
    picks = [...picks, ...candidates.filter(t => !picks.find(p => p.id === t.id))];
  }

  // Dedupe and slice 2–3
  const seen = new Set();
  picks = picks.filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; }).slice(0, 3);
  if (picks.length < 2) return false;

  const tray = document.getElementById('yml-tray');
  if (!tray) return false;

  const cards = tray.querySelector('.yml-cards');
  if (!cards) return false;
  cards.innerHTML = picks.map(t => `
    <div class="yml-card" onclick="_ymlPlay(${t.id})">
      ${t.coverArt ? `<img src="${t.coverArt}" alt="">` : '<div class="yml-cover-ph">♪</div>'}
      <div class="yml-card-info">
        <div class="yml-card-title">${escHtml(t.title)}</div>
        <div class="yml-card-artist">${escHtml(t.artist)}</div>
      </div>
      <button class="yml-play-btn">▶ Play</button>
    </div>`).join('');

  tray.classList.add('visible');

  // Countdown bar — 6 seconds
  const bar = tray.querySelector('.yml-countdown-bar');
  const start = performance.now();
  const dur   = 6000;
  function tick(now) {
    const pct = Math.max(0, 1 - (now - start) / dur);
    bar.style.width = (pct * 100) + '%';
    if (pct > 0) _ymlCountdownRaf = requestAnimationFrame(tick);
    else _ymlExpire();
  }
  _ymlCountdownRaf = requestAnimationFrame(tick);

  return true;
}

function _ymlPlay(id) {
  _ymlDismiss();
  const idx = getPlaylist().findIndex(t => t.id === id);
  if (idx !== -1) playAtIndex(idx);
}

function _ymlExpire() {
  _ymlDismiss();
  playAtIndex(_ymlNextIdx);
}

function _ymlDismiss() {
  if (_ymlCountdownRaf) { cancelAnimationFrame(_ymlCountdownRaf); _ymlCountdownRaf = null; }
  const tray = document.getElementById('yml-tray');
  if (!tray) return;
  tray.classList.remove('visible');
  // Clear cards so stale content never flashes on the next open
  const cards = tray.querySelector('.yml-cards');
  if (cards) cards.innerHTML = '';
  // Reset bar width for next show
  const bar = tray.querySelector('.yml-countdown-bar');
  if (bar) bar.style.width = '100%';
}

// Update recent ids on each new track start
const _origPlayAtIndex = playAtIndex;
// Hook history tracking — handled in _historyTimeUpdate

// =====================================================================
// FEATURE 5: PLAY HISTORY
// =====================================================================
const HISTORY_KEY = 'vault_history';
const HISTORY_CAP = 500;
let _historyRecordedAt = -1;
let _historyCompletedId = -1;

function _getHistory() {
  try {
    const s = localStorage.getItem(HISTORY_KEY);
    return s ? JSON.parse(s) : { plays: [], totalTime: 0 };
  } catch { return { plays: [], totalTime: 0 }; }
}

function _saveHistory(h) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch {}
}

function _historyTimeUpdate() {
  if (!audio.duration || audio.duration < 5) return;
  const pl = getPlaylist();
  const t  = pl[currentTrackIdx];
  if (!t) return;
  const ct = audio.currentTime;
  const dur = audio.duration;

  // Record play after 30 seconds
  if (ct >= 30 && _historyRecordedAt !== t.id) {
    _historyRecordedAt = t.id;
    const h = _getHistory();
    h.plays.unshift({
      trackId:   t.id,
      title:     t.title,
      artist:    t.artist,
      cover:     t.coverArt || '',
      playedAt:  Date.now(),
      duration:  Math.round(dur),
      completed: false,
    });
    if (h.plays.length > HISTORY_CAP) h.plays = h.plays.slice(0, HISTORY_CAP);
    h.totalTime = (h.totalTime || 0) + 30;
    _saveHistory(h);
  }

  // Mark completed if past 80%
  if (ct / dur >= 0.8 && _historyCompletedId !== t.id) {
    _historyCompletedId = t.id;
    const h = _getHistory();
    const entry = h.plays.find(p => p.trackId === t.id && !p.completed);
    if (entry) {
      entry.completed = true;
      h.totalTime = (h.totalTime || 0) + Math.max(0, Math.round(dur) - 30);
      _saveHistory(h);
    }
  }
}

// Reset per-track flags when a new track starts
audio.addEventListener('loadstart', () => {
  _historyRecordedAt = -1;
  _historyCompletedId = -1;
  _ymlRecentIds.push(String(getPlaylist()[currentTrackIdx]?.id || ''));
  if (_ymlRecentIds.length > HISTORY_MAX_RECENT) _ymlRecentIds.shift();
});

// ── History page rendering ─────────────────────────────────────────────────────
function renderHistoryPage() {
  const ov = document.getElementById('history-overlay');
  if (!ov) return;
  const h = _getHistory();
  const plays = h.plays || [];

  // ── Stats ─────────────────────────────────────────────────────────────────
  const totalSec  = h.totalTime || 0;
  const totalHr   = Math.floor(totalSec / 3600);
  const totalMin  = Math.floor((totalSec % 3600) / 60);
  const timeStr   = totalHr ? `${totalHr}h ${totalMin}m` : `${totalMin}m`;
  const uniqueIds = new Set(plays.map(p => p.trackId)).size;

  // Most played artist
  const artistTime = {};
  plays.forEach(p => { artistTime[p.artist] = (artistTime[p.artist]||0) + (p.duration||0); });
  const topArtist = Object.entries(artistTime).sort((a,b)=>b[1]-a[1])[0]?.[0] || '';
  const topArtistColor = topArtist ? getArtistColor(topArtist) : 'var(--text-primary)';

  // Streak
  const days = new Set(plays.map(p => new Date(p.playedAt).toDateString()));
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    if (days.has(d.toDateString())) streak++;
    else if (i > 0) break;
  }

  // Top tracks this week / all time
  const now = Date.now();
  const weekAgo = now - 7*24*3600*1000;
  const weekPlays = plays.filter(p => p.playedAt >= weekAgo);

  function topTracks(pool, n) {
    const cnt = {};
    pool.forEach(p => { cnt[p.trackId] = (cnt[p.trackId]||0) + 1; });
    return Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([id,ct]) => {
      const e = pool.find(p => String(p.trackId) === id);
      return { ...(e||{}), count: ct };
    });
  }

  function topArtists(pool, n) {
    const cnt = {};
    pool.forEach(p => { cnt[p.artist] = (cnt[p.artist]||0) + (p.duration||180); });
    return Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([a,s]) => ({ artist: a, seconds: s }));
  }

  const topT  = topTracks(plays, 5);
  const topTW = topTracks(weekPlays, 5);
  const topA  = topArtists(plays, 5);
  const topAW = topArtists(weekPlays, 5);

  const maxTCount = Math.max(1, ...(topT.map(t=>t.count)));
  const maxTWCount = Math.max(1, ...(topTW.map(t=>t.count)));
  const maxASec = Math.max(1, ...(topA.map(a=>a.seconds)));
  const maxASWec = Math.max(1, ...(topAW.map(a=>a.seconds)));

  function fmtSec(s) { const m=Math.floor(s/60),h=Math.floor(m/60); return h?`${h}h ${m%60}m`:`${m}m`; }

  function trackRow(e, max, i) {
    return `<div class="hist-rank-row">
      <span class="hist-rank-num">${i+1}</span>
      ${e.cover?`<img src="${e.cover}" alt="" class="hist-rank-cover">`:'<div class="hist-rank-cover hist-no-cover">♪</div>'}
      <div class="hist-rank-info"><div>${escHtml(e.title||'—')}</div><div style="opacity:.6;font-size:10px">${escHtml(e.artist||'')}</div></div>
      <div class="hist-bar-wrap"><div class="hist-bar" style="width:${Math.round((e.count/max)*100)}%"></div></div>
      <span class="hist-rank-cnt">${e.count}</span>
    </div>`;
  }

  function artistRow(e, max, i) {
    const col = getArtistColor(e.artist);
    return `<div class="hist-rank-row">
      <span class="hist-rank-num">${i+1}</span>
      <div class="hist-rank-cover" style="background:${col};display:flex;align-items:center;justify-content:center;font-size:11px;color:#000">${escHtml(e.artist.slice(0,2).toUpperCase())}</div>
      <div class="hist-rank-info"><div style="color:${col}">${escHtml(e.artist)}</div></div>
      <div class="hist-bar-wrap"><div class="hist-bar" style="width:${Math.round((e.seconds/max)*100)}%;background:${col}"></div></div>
      <span class="hist-rank-cnt">${fmtSec(e.seconds)}</span>
    </div>`;
  }

  // Recent plays (last 50)
  const recent = plays.slice(0, 50);

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    return `${Math.floor(s/86400)}d ago`;
  }

  ov.innerHTML = `
    <div class="history-header">
      <div class="history-title">◷ PLAY HISTORY</div>
      <button class="sort-btn" onclick="setView('tracks')">✕ Close</button>
    </div>

    <div class="hist-stats-row">
      <div class="hist-stat">
        <div class="hist-stat-val">${timeStr}</div>
        <div class="hist-stat-label">Total Listening</div>
      </div>
      <div class="hist-stat">
        <div class="hist-stat-val">${uniqueIds}</div>
        <div class="hist-stat-label">Unique Tracks</div>
      </div>
      <div class="hist-stat">
        <div class="hist-stat-val" style="color:${topArtistColor}">${topArtist||'—'}</div>
        <div class="hist-stat-label">Top Artist</div>
      </div>
      <div class="hist-stat">
        <div class="hist-stat-val">${streak}</div>
        <div class="hist-stat-label">Day Streak</div>
      </div>
    </div>

    <div class="hist-section">
      <div class="hist-section-header">
        <span>TOP TRACKS</span>
        <div class="hist-toggle">
          <button class="sort-btn active" id="tt-alltime">All Time</button>
          <button class="sort-btn" id="tt-week">This Week</button>
        </div>
      </div>
      <div id="hist-top-tracks">
        ${topT.length ? topT.map((e,i)=>trackRow(e,maxTCount,i)).join('') : '<div style="opacity:.4;font-size:11px;padding:12px">No plays yet</div>'}
      </div>
    </div>

    <div class="hist-section">
      <div class="hist-section-header">
        <span>TOP ARTISTS</span>
        <div class="hist-toggle">
          <button class="sort-btn active" id="ta-alltime">All Time</button>
          <button class="sort-btn" id="ta-week">This Week</button>
        </div>
      </div>
      <div id="hist-top-artists">
        ${topA.length ? topA.map((e,i)=>artistRow(e,maxASec,i)).join('') : '<div style="opacity:.4;font-size:11px;padding:12px">No plays yet</div>'}
      </div>
    </div>

    <div class="hist-section">
      <div class="hist-section-header"><span>RECENT PLAYS</span></div>
      <div class="hist-recent-list">
        ${recent.length ? recent.map(p => `
          <div class="hist-recent-row" onclick="_histPlayTrack(${p.trackId})">
            ${p.cover?`<img src="${p.cover}" alt="" class="hist-recent-cover">`:'<div class="hist-recent-cover hist-no-cover">♪</div>'}
            <div class="hist-recent-info">
              <div>${escHtml(p.title||'—')}</div>
              <div style="opacity:.6;font-size:10px">${escHtml(p.artist||'')}</div>
            </div>
            <div class="hist-recent-time">${timeAgo(p.playedAt)}</div>
            ${p.completed?'<span class="hist-completed" title="Completed">✓</span>':''}
          </div>`).join('') : '<div style="opacity:.4;font-size:11px;padding:12px">No plays yet</div>'}
      </div>
    </div>

    <div class="hist-section">
      <div class="hist-section-header"><span>14-DAY CHART</span></div>
      <canvas id="hist-chart" height="80" style="width:100%;display:block"></canvas>
    </div>

    ${isAdmin ? `<div class="hist-admin-row">
      <button class="btn" onclick="_histExport()">↓ Export JSON</button>
      <button class="btn" style="color:#e57373" onclick="_histClear()">✕ Clear History</button>
    </div>` : ''}
  `;

  // Wire toggles
  const ttAll = ov.querySelector('#tt-alltime'), ttWk = ov.querySelector('#tt-week');
  const taAll = ov.querySelector('#ta-alltime'), taWk = ov.querySelector('#ta-week');
  const ttEl  = ov.querySelector('#hist-top-tracks');
  const taEl  = ov.querySelector('#hist-top-artists');

  if (ttAll) ttAll.addEventListener('click', () => {
    ttAll.classList.add('active'); ttWk.classList.remove('active');
    ttEl.innerHTML = topT.length ? topT.map((e,i)=>trackRow(e,maxTCount,i)).join('') : '<div style="opacity:.4;font-size:11px;padding:12px">No plays yet</div>';
  });
  if (ttWk) ttWk.addEventListener('click', () => {
    ttWk.classList.add('active'); ttAll.classList.remove('active');
    ttEl.innerHTML = topTW.length ? topTW.map((e,i)=>trackRow(e,maxTWCount,i)).join('') : '<div style="opacity:.4;font-size:11px;padding:12px">No plays this week</div>';
  });
  if (taAll) taAll.addEventListener('click', () => {
    taAll.classList.add('active'); taWk.classList.remove('active');
    taEl.innerHTML = topA.length ? topA.map((e,i)=>artistRow(e,maxASec,i)).join('') : '<div style="opacity:.4;font-size:11px;padding:12px">No plays yet</div>';
  });
  if (taWk) taWk.addEventListener('click', () => {
    taWk.classList.add('active'); taAll.classList.remove('active');
    taEl.innerHTML = topAW.length ? topAW.map((e,i)=>artistRow(e,maxASWec,i)).join('') : '<div style="opacity:.4;font-size:11px;padding:12px">No plays this week</div>';
  });

  // Draw 14-day bar chart
  requestAnimationFrame(() => _drawHistChart(plays));
}

function _drawHistChart(plays) {
  const canvas = document.getElementById('hist-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth * devicePixelRatio;
  canvas.height = canvas.offsetHeight * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  const days = 14;
  const now = new Date();

  // Build per-day counts and dominant artist color
  const buckets = Array.from({length: days}, (_, i) => {
    const d = new Date(now); d.setDate(d.getDate() - (days-1-i));
    const ds = d.toDateString();
    const dayPlays = plays.filter(p => new Date(p.playedAt).toDateString() === ds);
    const artistCnt = {};
    dayPlays.forEach(p => { artistCnt[p.artist] = (artistCnt[p.artist]||0)+1; });
    const top = Object.entries(artistCnt).sort((a,b)=>b[1]-a[1])[0]?.[0] || '';
    return { count: dayPlays.length, color: top ? getArtistColor(top) : 'rgba(255,255,255,0.18)', label: d.toLocaleDateString('en-US',{month:'short',day:'numeric'}) };
  });

  const maxCount = Math.max(1, ...buckets.map(b=>b.count));
  const barW = (W / days) * 0.7;
  const gap   = (W / days) * 0.3;

  ctx.clearRect(0, 0, W, H);
  buckets.forEach((b, i) => {
    const x = i * (barW + gap);
    const h = b.count > 0 ? Math.max(4, (b.count / maxCount) * (H - 20)) : 2;
    const y = H - h - 16;
    ctx.fillStyle = b.color;
    ctx.globalAlpha = b.count > 0 ? 0.85 : 0.18;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, h, 2);
    ctx.fill();
    if (i % 2 === 0) {
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#888';
      ctx.font = `${9 * devicePixelRatio / devicePixelRatio}px IBM Plex Mono,monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(b.label.split(' ')[1], x + barW/2, H - 2);
    }
  });
}

function _histPlayTrack(id) {
  const idx = tracks.findIndex(t => t.id === id);
  if (idx !== -1) { setView('tracks'); setTimeout(() => playAtIndex(idx), 100); }
}

function _histExport() {
  const h = _getHistory();
  const blob = new Blob([JSON.stringify(h, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'vault-history.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function _histClear() {
  if (!confirm('Clear all play history? This cannot be undone.')) return;
  _saveHistory({ plays: [], totalTime: 0 });
  showToast('HISTORY CLEARED', 'success');
  renderHistoryPage();
}

// =====================================================================
// FEATURE: ARTIST PAGE
// =====================================================================

var artistPageHistory = [];
window.artistPageHistory = artistPageHistory;

function openArtistPage(artist) {
  if (!artist) return;
  activeArtistName = artist;
  history.pushState({ view: 'artist', artist }, '', '#artist/' + artist.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''));
  setView('artist');
  if (window.ytPlayer) {
    window.ytPlayer._resetBtn(window.ytPlayer._activeBtnId);
    window.ytPlayer._activeBtnId = null;
  }
  var overlay = document.getElementById('artist-overlay');
  if (overlay) overlay.scrollTop = 0;
}

window._apOpenArtistFromSimilar = function(artist) {
  if (activeArtistName) artistPageHistory.push(activeArtistName);
  openArtistPage(artist);
};

window._apGoBack = function() {
  if (!artistPageHistory.length) return;
  var prev = artistPageHistory.pop();
  openArtistPage(prev);
};

function closeArtistPage() {
  artistPageHistory = [];
  window.artistPageHistory = artistPageHistory;
  if (window.location.hash.startsWith('#artist/')) {
    history.back();
  } else {
    activeArtistName = null;
    setView('tracks');
  }
}

window.addEventListener('popstate', function() {
  if (!location.hash.startsWith('#artist/')) {
    closeArtistPage();
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && activeView === 'artist') closeArtistPage();
  if (e.key === 'Escape' && karaokeOpen) { closeKaraoke(); return; }
  if (e.key === 'Escape' && selectionMode) { exitSelectionMode(); return; }
  if (e.key === 'K' && e.shiftKey) { e.preventDefault(); toggleKaraoke(); }
});

function _getArtistVizConfig(artist) {
  const key = (artist || '').toLowerCase();
  for (const [k, v] of Object.entries(artistPalettes)) {
    if ((key.includes(k) || k.includes(key)) && v.visualizer) return v.visualizer;
  }
  return null;
}

function _renderAPDiscGrid(sortedTracks, counts) {
  if (!sortedTracks.length) return '<div style="opacity:.4;font-size:11px;padding:12px 0">No tracks</div>';
  return sortedTracks.map((t) => {
    const plays = counts[t.id] || 0;
    return `
      <div class="ap-disc-item" onclick="closeArtistPage();setTimeout(()=>{const idx=getPlaylist().findIndex(x=>x.id===${t.id});if(idx!==-1)playAtIndex(idx);},150)">
        ${t.coverArt ? `<img class="ap-disc-cover" src="${t.coverArt}" alt="">` : `<div class="ap-disc-cover-placeholder">♪</div>`}
        ${plays > 0 ? `<div class="ap-disc-plays-badge">${plays}</div>` : ''}
        <div class="ap-disc-info">
          <div class="ap-disc-title">${escHtml(t.title)}</div>
          <div class="ap-disc-plays">${plays > 0 ? plays + ' play' + (plays !== 1 ? 's' : '') : 'unplayed'}</div>
        </div>
      </div>`;
  }).join('');
}

function _renderAPDiscList(sortedTracks, counts) {
  if (!sortedTracks.length) return '<div style="opacity:.4;font-size:11px;padding:12px 0">No tracks</div>';
  return sortedTracks.map((t, i) => {
    const plays = counts[t.id] || 0;
    return `
      <div class="ap-disc-row" onclick="closeArtistPage();setTimeout(()=>{const idx=getPlaylist().findIndex(x=>x.id===${t.id});if(idx!==-1)playAtIndex(idx);},150)">
        <div class="ap-disc-row-num">${i + 1}</div>
        ${t.coverArt
          ? `<img class="ap-disc-row-cover" src="${t.coverArt}" alt="">`
          : `<div class="ap-disc-row-cover" style="display:flex;align-items:center;justify-content:center;font-size:16px;color:rgba(255,255,255,0.2);border-radius:4px;background:rgba(255,255,255,0.06)">♪</div>`}
        <div class="ap-disc-row-info">
          <div class="ap-disc-row-title">${escHtml(t.title)}</div>
          <div class="ap-disc-row-plays">${plays > 0 ? plays + ' play' + (plays !== 1 ? 's' : '') : 'unplayed'}</div>
        </div>
      </div>`;
  }).join('');
}

function apSetDiscView(mode) {
  const disc    = document.getElementById('ap-discography');
  const gridBtn = document.getElementById('ap-grid-btn');
  const listBtn = document.getElementById('ap-list-btn');
  if (!disc || !activeArtistName) return;
  const artistTracks = tracks.filter(t => t.artist.toLowerCase() === activeArtistName.toLowerCase());
  const counts  = getPlayCounts();
  const sorted  = [...artistTracks].sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0));
  if (mode === 'grid') {
    disc.className = 'ap-disc-grid';
    disc.innerHTML = _renderAPDiscGrid(sorted, counts);
    gridBtn?.classList.add('active');
    listBtn?.classList.remove('active');
  } else {
    disc.className = 'ap-disc-list';
    disc.innerHTML = _renderAPDiscList(sorted, counts);
    listBtn?.classList.add('active');
    gridBtn?.classList.remove('active');
  }
}

function openArtistViz(artist) {
  closeArtistPage();
  setTimeout(() => {
    applyArtistPalette(artist);
    applyVizArtistConfig(artist);
    if (typeof openVisualizer === 'function') openVisualizer();
  }, 200);
}

function _drawAPHistChart(plays, primaryColor) {
  const canvas = document.getElementById('ap-hist-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  canvas.height = canvas.offsetHeight * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  const days = 14, now = new Date();
  const buckets = Array.from({ length: days }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (days - 1 - i));
    const ds = d.toDateString();
    return {
      count: plays.filter(p => new Date(p.playedAt).toDateString() === ds).length,
      label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    };
  });
  const maxCount = Math.max(1, ...buckets.map(b => b.count));
  const barW = (W / days) * 0.7, gap = (W / days) * 0.3;
  ctx.clearRect(0, 0, W, H);
  buckets.forEach((b, i) => {
    const x = i * (barW + gap);
    const h = b.count > 0 ? Math.max(4, (b.count / maxCount) * (H - 20)) : 2;
    const y = H - h - 16;
    ctx.fillStyle = primaryColor;
    ctx.globalAlpha = b.count > 0 ? 0.85 : 0.18;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, barW, h, 2);
    else ctx.rect(x, y, barW, h);
    ctx.fill();
    if (i % 2 === 0) {
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#888';
      ctx.font = '9px IBM Plex Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(b.label.split(' ')[1], x + barW / 2, H - 2);
    }
  });
  ctx.globalAlpha = 1;
}

function renderArtistPage(artist) {
  const ov = document.getElementById('artist-overlay');
  if (!ov || !artist) return;

  const pal          = getArtistPalette(artist);
  const artistTracks = tracks.filter(t => t.artist.toLowerCase() === artist.toLowerCase());
  const counts       = getPlayCounts();
  const hist         = _getHistory();
  const artistPlays  = hist.plays.filter(p => p.artist && p.artist.toLowerCase() === artist.toLowerCase());

  // Stats
  const totalPlays = artistPlays.length;
  const totalSec   = artistPlays.reduce((acc, p) => acc + (p.duration || 0), 0);
  const hh = Math.floor(totalSec / 3600), mm = Math.floor((totalSec % 3600) / 60);
  const listenStr  = hh > 0 ? `${hh}h ${mm}m` : mm > 0 ? `${mm}m` : '0m';

  const sortedByPlays = [...artistTracks].sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0));
  const topTrack   = sortedByPlays[0];
  const topName    = topTrack ? topTrack.title : '—';

  // Avatar initials
  const words    = artist.trim().split(/\s+/);
  const initials = words.length >= 2
    ? (words[0][0] + words[words.length - 1][0]).toUpperCase()
    : artist.slice(0, 2).toUpperCase();

  // Projects that include this artist's tracks
  const artistProjects = projects.filter(p =>
    (p.tracks || []).some(tid => artistTracks.some(t => t.id === tid))
  );

  // Viz config
  const vizCfg = _getArtistVizConfig(artist);
  const vizMode = vizCfg ? (vizCfg.mode || 'bars').toUpperCase() : 'BARS';

  ov.innerHTML = `
    <div class="ap-container">
      <div class="ap-header" style="background:linear-gradient(135deg,${pal.gradient[0]}cc 0%,${pal.gradient[1]}88 55%,#080808 100%)">
        <button class="ap-close-btn" onclick="closeArtistPage()">✕</button>
        <div class="ap-header-left">
          <h1 class="ap-name">${escHtml(artist.toUpperCase())}</h1>
          <div class="ap-meta">${artistTracks.length} track${artistTracks.length !== 1 ? 's' : ''} &middot; ${listenStr} played &middot; Top: ${escHtml(topName)}</div>
        </div>
        <div class="ap-avatar" style="background:${pal.primary};box-shadow:0 0 0 3px ${pal.glow},0 4px 20px ${hexToRgba(pal.glow, 0.35)}">${escHtml(initials)}</div>
      </div>

      <div class="ap-stats" style="--ap-primary:${pal.primary};--ap-secondary:${pal.secondary}">
        <div class="ap-stat"><div class="ap-stat-val">${artistTracks.length}</div><div class="ap-stat-label">Tracks</div></div>
        <div class="ap-stat"><div class="ap-stat-val">${totalPlays}</div><div class="ap-stat-label">Plays</div></div>
        <div class="ap-stat"><div class="ap-stat-val">${listenStr}</div><div class="ap-stat-label">Listened</div></div>
        <div class="ap-stat" title="${escHtml(topName)}"><div class="ap-stat-val" style="font-size:11px;line-height:1.2">${escHtml(topName.length > 14 ? topName.slice(0, 13) + '…' : topName)}</div><div class="ap-stat-label">Top Track</div></div>
      </div>

      ${artistProjects.length ? `
      <div class="ap-section">
        <div class="ap-section-title">PROJECTS</div>
        <div class="ap-projects-row">
          ${artistProjects.map(p => `
            <div class="ap-project-card" onclick="closeArtistPage();setTimeout(()=>openProjectDetail('${p.id}'),150)">
              <div class="ap-project-name">${escHtml(p.title)}</div>
              <div class="ap-project-count">${(p.tracks || []).length} tracks</div>
            </div>`).join('')}
        </div>
      </div>` : ''}

      <div class="ap-section">
        <div class="ap-section-header">
          <span class="ap-section-title" style="margin-bottom:0">DISCOGRAPHY</span>
          <div class="ap-view-toggle" style="--ap-primary:${pal.primary}">
            <button class="ap-view-btn active" id="ap-grid-btn" onclick="apSetDiscView('grid')">⊞</button>
            <button class="ap-view-btn" id="ap-list-btn" onclick="apSetDiscView('list')">≡</button>
          </div>
        </div>
        <div id="ap-discography" class="ap-disc-grid" style="margin-top:12px">
          ${_renderAPDiscGrid(sortedByPlays, counts)}
        </div>
      </div>

      <div class="ap-section">
        <div class="ap-section-title">LAST 14 DAYS</div>
        <canvas id="ap-hist-canvas" height="80" style="width:100%;display:block;margin-top:4px"></canvas>
      </div>

      <div class="ap-section">
        <div class="ap-section-title">VISUALIZER</div>
        <div class="ap-viz-row">
          <div class="ap-viz-info">
            <div class="ap-viz-mode" style="color:${pal.text}">${vizMode}</div>
            <div class="ap-viz-pills">
              <span class="ap-viz-pill" style="background:${hexToRgba(pal.primary, 0.15)};color:${pal.text}">themed</span>
              ${vizCfg && vizCfg.intensity ? `<span class="ap-viz-pill">intensity ${vizCfg.intensity}</span>` : ''}
            </div>
          </div>
          <button class="btn" onclick="openArtistViz('${artist.replace(/'/g, "\\'")}')">⊞ Open Viz</button>
        </div>
      </div>

      ${isAdmin ? `
      <div class="ap-admin-row">
        <button class="btn" onclick="closeArtistPage();setTimeout(()=>openEditModal(${topTrack ? topTrack.id : -1}),150)">✎ Edit Top Track</button>
        <button class="btn" onclick="closeArtistPage()">⊞ All Tracks</button>
      </div>` : ''}
    </div>
  `;

  requestAnimationFrame(() => _drawAPHistChart(artistPlays, pal.primary));
}

// =====================================================================
// FEATURE 1 â€” DOWNLOAD QUEUE (ZIP)
// =====================================================================

let selectionMode = false;
const selectedTracks = new Set(); // track ids

function enterSelectionMode() {
  selectionMode = true;
  document.body.classList.add('selection-mode');
  const btn = document.getElementById('select-mode-btn');
  if (btn) { btn.textContent = 'â˜‘ Select'; btn.classList.add('active'); }
  document.getElementById('selection-bar').classList.add('visible');
  _updateSelectionBar();
  document.getElementById('tracks-grid').addEventListener('click', _selectionGridClick, true);
}

function exitSelectionMode() {
  selectionMode = false;
  selectedTracks.clear();
  document.body.classList.remove('selection-mode');
  const btn = document.getElementById('select-mode-btn');
  if (btn) { btn.textContent = 'â˜ Select'; btn.classList.remove('active'); }
  document.getElementById('selection-bar').classList.remove('visible');
  document.querySelectorAll('.track-card.selected').forEach(c => c.classList.remove('selected'));
  document.getElementById('tracks-grid').removeEventListener('click', _selectionGridClick, true);
}

function _selectionGridClick(e) {
  const card = e.target.closest('.track-card');
  if (!card) return;
  if (e.target.closest('.icon-btn')) return;
  e.stopPropagation();
  e.preventDefault();
  const id = parseInt(card.dataset.id);
  if (selectedTracks.has(id)) {
    selectedTracks.delete(id);
    card.classList.remove('selected');
  } else {
    selectedTracks.add(id);
    card.classList.add('selected');
  }
  _updateSelectionBar();
}

function _updateSelectionBar() {
  const n = selectedTracks.size;
  const countEl = document.getElementById('selection-count');
  const dlBtn   = document.getElementById('download-zip-btn');
  if (countEl) countEl.textContent = n + ' TRACK' + (n !== 1 ? 'S' : '') + ' SELECTED';
  if (dlBtn)   dlBtn.disabled = (n === 0);
}

async function downloadSelectedAsZip() {
  if (!window.JSZip) { showToast('JSZip not loaded â€” try refreshing', 'error'); return; }
  const ids = [...selectedTracks];
  const selected = ids.map(id => tracks.find(t => t.id === id)).filter(Boolean);
  if (!selected.length) { showToast('NO TRACKS SELECTED', 'error'); return; }
  if (selected.length > 20) showToast('Large download â€” this may take a while', '');

  const dlBtn        = document.getElementById('download-zip-btn');
  const progressWrap = document.getElementById('zip-progress-wrap');
  const progressBar  = document.getElementById('zip-progress-bar');
  const progressText = document.getElementById('zip-progress-text');
  if (dlBtn)        dlBtn.disabled = true;
  if (progressWrap) progressWrap.style.display = 'flex';

  const zip    = new JSZip();
  const folder = zip.folder('The Vault');
  let done = 0;
  let failed = 0;

  showToast('Preparing downloadâ€¦', '');

  for (const track of selected) {
    if (!track.url) { failed++; continue; }
    try {
      const response = await fetch(track.url, { mode: 'cors' });
      if (!response.ok) throw new Error(response.status);
      const blob = await response.blob();
      let ext = track.url.split('.').pop().split('?')[0].toLowerCase();
      if (!['mp3','wav','flac','m4a','ogg','aac'].includes(ext)) ext = 'mp3';
      let filename = (track.artist + ' - ' + track.title + '.' + ext)
        .replace(/[/\\?%*:|"<>]/g, '-');
      folder.file(filename, blob);
      done++;
    } catch (err) {
      console.warn('[ZIP] Failed to fetch:', track.title, err);
      failed++;
    }
    const total = selected.length;
    const pct = Math.round(((done + failed) / total) * 100);
    if (progressBar)  progressBar.style.width = pct + '%';
    if (progressText) progressText.textContent = (done + failed) + '/' + total;
    showToast('Adding ' + (done + failed) + '/' + total + 'â€¦', '');
  }

  try {
    const content = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'the-vault-' + Date.now() + '.zip';
    a.click();
    URL.revokeObjectURL(url);
    const msg = failed > 0
      ? done + '/' + selected.length + ' tracks (' + failed + ' unavailable)'
      : done + ' track' + (done !== 1 ? 's' : '') + ' downloaded';
    showToast(msg, 'success');
  } catch (err) {
    showToast('ZIP generation failed', 'error');
    console.error('[ZIP] generateAsync error:', err);
  }

  if (progressWrap) progressWrap.style.display = 'none';
  if (progressBar)  progressBar.style.width = '0%';
  if (dlBtn)        dlBtn.disabled = false;
}

// Wire selection bar buttons
(function() {
  document.getElementById('select-all-btn').addEventListener('click', function() {
    document.querySelectorAll('#tracks-grid .track-card').forEach(function(card) {
      const id = parseInt(card.dataset.id);
      selectedTracks.add(id);
      card.classList.add('selected');
    });
    _updateSelectionBar();
  });
  document.getElementById('clear-selection-btn').addEventListener('click', function() {
    selectedTracks.clear();
    document.querySelectorAll('.track-card.selected').forEach(function(c) { c.classList.remove('selected'); });
    _updateSelectionBar();
  });
  document.getElementById('exit-selection-btn').addEventListener('click', exitSelectionMode);
  document.getElementById('download-zip-btn').addEventListener('click', downloadSelectedAsZip);
})();

// =====================================================================
// FEATURE 2 â€” VAULT STATS PAGE
// =====================================================================

function renderStatsPage() {
  const ov = document.getElementById('stats-overlay');
  if (!ov) return;
  const h     = _getHistory();
  const plays = h.plays || [];
  if (!plays.length) {
    ov.innerHTML = '<div class="stats-page"><div class="stats-header-row"><div class="stats-title">â—ˆ VAULT STATS</div><button class="sort-btn" onclick="setView(\'tracks\')">âœ• Close</button></div><div style="text-align:center;padding:60px 20px;font-family:var(--font-mono);font-size:11px;color:var(--muted);letter-spacing:2px;text-transform:uppercase">No listening history yet â€” start playing!</div></div>';
    return;
  }

  const totalSec = h.totalTime || 0;
  const totalHr  = Math.floor(totalSec / 3600);
  const totalMin = Math.floor((totalSec % 3600) / 60);
  const timeStr  = totalHr ? totalHr + 'h ' + totalMin + 'm' : totalMin + 'm';
  const uniqueIds = new Set(plays.map(function(p) { return p.trackId; })).size;

  const dayCounts = {};
  plays.forEach(function(p) {
    const d = new Date(p.playedAt).toLocaleDateString('en-US', {month:'short', day:'numeric'});
    dayCounts[d] = (dayCounts[d] || 0) + 1;
  });
  const topDay    = Object.entries(dayCounts).sort(function(a,b) { return b[1]-a[1]; })[0];
  const topDayStr = topDay ? topDay[0] + ' (' + topDay[1] + ' plays)' : 'â€”';

  const trackCounts = {};
  plays.forEach(function(p) { trackCounts[p.trackId] = (trackCounts[p.trackId]||0) + 1; });
  const topTracks = Object.entries(trackCounts)
    .sort(function(a,b) { return b[1]-a[1]; }).slice(0, 10)
    .map(function(entry) {
      const id  = entry[0], cnt = entry[1];
      const rec = plays.find(function(p) { return String(p.trackId) === id; });
      return { trackId: id, title: (rec && rec.title)||'â€”', artist: (rec && rec.artist)||'', count: cnt };
    });
  const maxTCount = Math.max(1, topTracks[0] ? topTracks[0].count : 1);

  const artistSec = {};
  plays.forEach(function(p) { artistSec[p.artist] = (artistSec[p.artist]||0) + (p.duration||180); });
  const topArtists = Object.entries(artistSec).sort(function(a,b) { return b[1]-a[1]; }).slice(0, 8);
  const maxASec    = topArtists.length ? Math.max(1, topArtists[0][1]) : 1;

  function fmtSec(s) {
    const m = Math.floor(s/60), hr = Math.floor(m/60);
    return hr ? hr + 'h ' + (m%60) + 'm' : m + 'm';
  }

  const tagCounts = {};
  plays.forEach(function(p) {
    const t = tracks.find(function(x) { return String(x.id) === String(p.trackId); });
    ((t && t.tags) || []).forEach(function(tag) { tagCounts[tag] = (tagCounts[tag]||0) + 1; });
  });
  const topTags = Object.entries(tagCounts).sort(function(a,b) { return b[1]-a[1]; }).slice(0, 8);

  const streakSet  = new Set(plays.map(function(p) { return new Date(p.playedAt).toDateString(); }));
  let streak = 0;
  const todayD = new Date();
  for (let si = 0; si < 365; si++) {
    const sd = new Date(todayD); sd.setDate(sd.getDate() - si);
    if (streakSet.has(sd.toDateString())) streak++;
    else if (si > 0) break;
  }
  const mostPlayedEntry = topTracks[0];
  const hourCounts = [0,0,0,0];
  plays.forEach(function(p) {
    const hh = new Date(p.playedAt).getHours();
    if (hh >= 5 && hh < 12) hourCounts[0]++;
    else if (hh >= 12 && hh < 17) hourCounts[1]++;
    else if (hh >= 17 && hh < 22) hourCounts[2]++;
    else hourCounts[3]++;
  });
  const timeLabels = ['Morning','Afternoon','Evening','Night'];
  const favTime = timeLabels[hourCounts.indexOf(Math.max.apply(null, hourCounts))];
  const firstPlay    = plays[plays.length - 1];
  const memberSince  = firstPlay ? new Date(firstPlay.playedAt).toLocaleDateString('en-US', {month:'long',year:'numeric'}) : 'â€”';

  const topBarsHtml = topTracks.map(function(t) {
    const col  = getArtistColor(t.artist);
    const pIdx = tracks.findIndex(function(x) { return String(x.id) === String(t.trackId); });
    return '<div class="stats-bar-row" onclick="setView(\'tracks\');setTimeout(function(){ if(' + pIdx + '!==-1) playAtIndex(' + pIdx + '); },100)">' +
      '<div class="stats-bar-label">' + _esc(t.title) + '<small>' + _esc(t.artist) + '</small></div>' +
      '<div class="stats-bar-track"><div class="stats-bar-fill" style="width:' + Math.round((t.count/maxTCount)*100) + '%;background:' + col + '"></div></div>' +
      '<div class="stats-bar-count">' + t.count + '</div></div>';
  }).join('');

  const artistBarsHtml = topArtists.map(function(entry) {
    const artist = entry[0], secs = entry[1];
    const col = getArtistColor(artist);
    return '<div class="stats-bar-row">' +
      '<div class="stats-bar-label" style="color:' + col + '">' + _esc(artist) + '<small>' + fmtSec(secs) + '</small></div>' +
      '<div class="stats-bar-track"><div class="stats-bar-fill" style="width:' + Math.round((secs/maxASec)*100) + '%;background:' + col + '"></div></div>' +
      '<div class="stats-bar-count">' + fmtSec(secs) + '</div></div>';
  }).join('');

  const tagBarsHtml = topTags.map(function(entry) {
    const tag = entry[0], cnt = entry[1];
    const maxCnt = topTags[0] ? topTags[0][1] : 1;
    return '<div class="stats-bar-row">' +
      '<div class="stats-bar-label">' + _esc(tag) + '</div>' +
      '<div class="stats-bar-track"><div class="stats-bar-fill" style="width:' + Math.round((cnt/maxCnt)*100) + '%;background:var(--accent)"></div></div>' +
      '<div class="stats-bar-count">' + cnt + '</div></div>';
  }).join('');

  ov.innerHTML =
    '<div class="stats-page">' +
      '<div class="stats-header-row">' +
        '<div class="stats-title">â—ˆ VAULT STATS</div>' +
        '<button class="sort-btn" onclick="setView(\'tracks\')">âœ• Close</button>' +
      '</div>' +
      '<div class="stats-overview">' +
        '<div class="stats-card"><div class="stats-card-val">' + tracks.length + '</div><div class="stats-card-lbl">Tracks in Vault</div></div>' +
        '<div class="stats-card"><div class="stats-card-val">' + timeStr + '</div><div class="stats-card-lbl">Total Listening</div></div>' +
        '<div class="stats-card"><div class="stats-card-val">' + plays.length + '</div><div class="stats-card-lbl">Total Plays</div></div>' +
        '<div class="stats-card"><div class="stats-card-val" style="font-size:16px">' + topDayStr + '</div><div class="stats-card-lbl">Most Active Day</div></div>' +
      '</div>' +
      '<div class="stats-section"><div class="stats-section-title">Top Tracks by Play Count</div>' + topBarsHtml + '</div>' +
      '<div class="stats-section"><div class="stats-section-title">Top Artists by Listening Time</div>' + artistBarsHtml + '</div>' +
      '<div class="stats-section"><div class="stats-section-title">Listening Over Time (last 30 days)</div><div class="stats-canvas-wrap"><canvas id="stats-line-canvas" height="80"></canvas></div></div>' +
      '<div class="stats-section"><div class="stats-section-title">Activity Heatmap (52 weeks)</div><div class="stats-heatmap" id="stats-heatmap"></div></div>' +
      '<div class="stats-section"><div class="stats-section-title">Personal Records</div><div class="stats-records">' +
        '<div class="stats-record-item"><div class="stats-record-label">Listening Streak</div><div class="stats-record-val">ðŸ”¥ ' + streak + ' day' + (streak!==1?'s':'') + '</div></div>' +
        '<div class="stats-record-item"><div class="stats-record-label">Most Played Track</div><div class="stats-record-val">' + (mostPlayedEntry ? _esc(mostPlayedEntry.title) + ' Â· ' + mostPlayedEntry.count + ' plays' : 'â€”') + '</div></div>' +
        '<div class="stats-record-item"><div class="stats-record-label">Favorite Time of Day</div><div class="stats-record-val">ðŸ• ' + favTime + '</div></div>' +
        '<div class="stats-record-item"><div class="stats-record-label">Unique Tracks Played</div><div class="stats-record-val">' + uniqueIds + ' / ' + tracks.length + '</div></div>' +
        '<div class="stats-record-item"><div class="stats-record-label">Member Since</div><div class="stats-record-val">' + memberSince + '</div></div>' +
        '<div class="stats-record-item"><div class="stats-record-label">Completed Tracks</div><div class="stats-record-val">' + plays.filter(function(p) { return p.completed; }).length + '</div></div>' +
      '</div></div>' +
      (topTags.length ? '<div class="stats-section"><div class="stats-section-title">Genre / Tag Breakdown</div>' + tagBarsHtml + '</div>' : '') +
    '</div>';

  requestAnimationFrame(function() {
    _drawStatsLineChart(plays);
    _buildStatsHeatmap(plays);
  });
}

function _esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _drawStatsLineChart(plays) {
  const canvas = document.getElementById('stats-line-canvas');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = canvas.offsetWidth  * dpr;
  canvas.height = canvas.offsetHeight * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  const days = 30;
  const now  = new Date();
  const buckets = [];
  for (let i = days - 1; i >= 0; i--) {
    const d  = new Date(now); d.setDate(d.getDate() - i);
    const ds = d.toDateString();
    const dayPlays = plays.filter(function(p) { return new Date(p.playedAt).toDateString() === ds; });
    const cnt = dayPlays.length;
    const ac  = {};
    dayPlays.forEach(function(p) { ac[p.artist] = (ac[p.artist]||0)+1; });
    const topA = Object.entries(ac).sort(function(a,b) { return b[1]-a[1]; })[0];
    buckets.push({ cnt: cnt, color: topA ? getArtistColor(topA[0]) : 'rgba(196,30,58,0.8)' });
  }
  const maxCnt    = Math.max(1, buckets.reduce(function(m,b) { return Math.max(m,b.cnt); }, 0));
  const topBucket = buckets.reduce(function(best,b) { return b.cnt > best.cnt ? b : best; }, {cnt:0, color:'rgba(196,30,58,0.8)'});
  const lineColor = topBucket.color;
  const pad = { l:4, r:4, t:8, b:18 };
  const chartW = W - pad.l - pad.r;
  const chartH = H - pad.t - pad.b;
  const pts = buckets.map(function(b, i) {
    return { x: pad.l + (i / (days-1)) * chartW, y: pad.t + chartH - (b.cnt / maxCnt) * chartH };
  });

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pad.t + chartH);
  pts.forEach(function(p) { ctx.lineTo(p.x, p.y); });
  ctx.lineTo(pts[pts.length-1].x, pad.t + chartH);
  ctx.closePath();
  ctx.fillStyle = 'rgba(196,30,58,0.12)';
  ctx.fill();

  ctx.beginPath();
  pts.forEach(function(p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
  ctx.strokeStyle = lineColor;
  ctx.lineWidth   = 2;
  ctx.lineJoin    = 'round';
  ctx.stroke();

  ctx.fillStyle  = 'rgba(255,255,255,0.3)';
  ctx.font       = '9px monospace';
  ctx.textAlign  = 'center';
  buckets.forEach(function(b, i) {
    if (i % 5 !== 0) return;
    const d = new Date(now); d.setDate(d.getDate() - (days - 1 - i));
    ctx.fillText(d.getDate(), pts[i].x, H - 2);
  });
}

function _buildStatsHeatmap(plays) {
  const wrap = document.getElementById('stats-heatmap');
  if (!wrap) return;
  const WEEKS = 52;
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - (WEEKS * 7 - 1));

  const ac = {};
  plays.forEach(function(p) { ac[p.artist] = (ac[p.artist]||0)+1; });
  const topAEntry = Object.entries(ac).sort(function(a,b) { return b[1]-a[1]; })[0];
  const hmColor   = topAEntry ? getArtistColor(topAEntry[0]) : '#c41e3a';

  const dayMap = {};
  plays.forEach(function(p) {
    const key = new Date(p.playedAt).toDateString();
    dayMap[key] = (dayMap[key]||0) + 1;
  });
  const maxDay = Math.max(1, Object.keys(dayMap).reduce(function(m,k) { return Math.max(m, dayMap[k]); }, 0));

  wrap.innerHTML = '';
  for (let w = 0; w < WEEKS; w++) {
    const col = document.createElement('div');
    col.className = 'stats-heatmap-col';
    for (let d = 0; d < 7; d++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + w * 7 + d);
      const cell = document.createElement('div');
      cell.className = 'stats-heatmap-cell';
      if (date > today) {
        cell.style.background = 'transparent';
      } else {
        const cnt     = dayMap[date.toDateString()] || 0;
        const dateStr = date.toLocaleDateString('en-US', {month:'short', day:'numeric'});
        cell.title = cnt ? cnt + ' play' + (cnt!==1?'s':'') + ' â€” ' + dateStr : dateStr;
        if (cnt === 0) {
          cell.style.background = 'rgba(255,255,255,0.05)';
        } else {
          cell.style.background = hmColor;
          cell.style.opacity    = String(0.3 + (cnt / maxDay) * 0.7);
        }
      }
      col.appendChild(cell);
    }
    wrap.appendChild(col);
  }
}

// =====================================================================
// FEATURE 3 â€” LYRICS KARAOKE MODE
// =====================================================================

let karaokeOpen   = false;
let _karaokeTimer = null;
let _karaokeLastLine = '';

function openKaraoke() {
  if (!lyricsLines || !lyricsLines.length) {
    showToast('KARAOKE REQUIRES SYNCED LYRICS', 'error');
    return;
  }
  karaokeOpen = true;
  const ov = document.getElementById('karaoke-overlay');
  if (ov) ov.classList.add('active');
  const pl = getPlaylist();
  const t  = pl[currentTrackIdx];
  const titleEl  = document.getElementById('karaoke-title');
  const artistEl = document.getElementById('karaoke-artist');
  if (titleEl  && t) titleEl.textContent  = t.title;
  if (artistEl && t) artistEl.textContent = t.artist;
  _karaokeUpdatePlayBtn();
  syncKaraokeDisplay();
}

function closeKaraoke() {
  karaokeOpen = false;
  const ov = document.getElementById('karaoke-overlay');
  if (ov) ov.classList.remove('active');
  clearTimeout(_karaokeTimer);
  _karaokeLastLine = '';
}

function toggleKaraoke() {
  if (karaokeOpen) closeKaraoke(); else openKaraoke();
}

function _karaokeUpdatePlayBtn() {
  const btn = document.getElementById('karaoke-play-btn');
  if (btn) btn.textContent = isPlaying ? 'â¸' : 'â–¶';
}

function syncKaraokeDisplay() {
  if (!karaokeOpen || !lyricsLines || !lyricsLines.length) return;

  let activeIdx = 0;
  if (lyricsIsSynced) {
    const now = audio.currentTime;
    for (let i = lyricsLines.length - 1; i >= 0; i--) {
      if (lyricsLines[i].time !== undefined && lyricsLines[i].time <= now) {
        activeIdx = i;
        break;
      }
    }
  } else if (audio.duration) {
    activeIdx = Math.floor((audio.currentTime / audio.duration) * (lyricsLines.length - 1));
  }

  const prevText = ((lyricsLines[activeIdx - 1] && lyricsLines[activeIdx - 1].text) || '').toUpperCase();
  const currText = ((lyricsLines[activeIdx]     && lyricsLines[activeIdx].text)     || 'â™ª').toUpperCase();
  const nextText = ((lyricsLines[activeIdx + 1] && lyricsLines[activeIdx + 1].text) || '').toUpperCase();

  const prevEl = document.getElementById('karaoke-prev');
  const currEl = document.getElementById('karaoke-current');
  const nextEl = document.getElementById('karaoke-next');

  if (prevEl) prevEl.textContent = prevText;
  if (nextEl) nextEl.textContent = nextText;

  if (currEl && currText !== _karaokeLastLine) {
    _karaokeLastLine  = currText;
    currEl.textContent = currText;
    currEl.classList.remove('k-animate');
    void currEl.offsetWidth;
    currEl.classList.add('k-animate');
  }

  if (audio.duration) {
    const pct = (audio.currentTime / audio.duration) * 100;
    const pb  = document.getElementById('karaoke-progress');
    if (pb) pb.style.width = pct + '%';
  }
}

audio.addEventListener('timeupdate', function() {
  if (!karaokeOpen) return;
  clearTimeout(_karaokeTimer);
  _karaokeTimer = setTimeout(syncKaraokeDisplay, lyricsIsSynced ? 200 : 400);
});

audio.addEventListener('play',  _karaokeUpdatePlayBtn);
audio.addEventListener('pause', _karaokeUpdatePlayBtn);

function _karaokeUpdateBtn() {
  const btn = document.getElementById('lyrics-karaoke-btn');
  if (!btn) return;
  if (lyricsLines && lyricsLines.length > 0) {
    btn.style.display = '';
  } else {
    btn.style.display = 'none';
  }
}

(function() {
  const karaokeBtn   = document.getElementById('lyrics-karaoke-btn');
  const karaokeClose = document.getElementById('karaoke-close-btn');
  const karaokePlay  = document.getElementById('karaoke-play-btn');

  if (karaokeBtn)   karaokeBtn.addEventListener('click', toggleKaraoke);
  if (karaokeClose) karaokeClose.addEventListener('click', closeKaraoke);
  if (karaokePlay)  karaokePlay.addEventListener('click', function() {
    if (isPlaying) audio.pause(); else audio.play().catch(function(){});
    _karaokeUpdatePlayBtn();
  });

  // Initial hide until lyrics load
  _karaokeUpdateBtn();
})();

// Periodically sync karaoke button visibility with lyrics state
setInterval(_karaokeUpdateBtn, 1500);


// =====================================================================
// FIX 2 â€” PWA INSTALL PROMPT
// =====================================================================
(function() {
  var deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    deferredPrompt = e;
    if (localStorage.getItem('vault-pwa-dismissed')) return;
    setTimeout(function() {
      var banner = document.getElementById('pwa-install-banner');
      if (banner) banner.classList.add('visible');
    }, 30000);
  });

  window.addEventListener('appinstalled', function() {
    var banner = document.getElementById('pwa-install-banner');
    if (banner) banner.classList.remove('visible');
    deferredPrompt = null;
    showToast('THE VAULT installed', 'success');
  });

  var installBtn = document.getElementById('pwa-install-btn');
  var dismissBtn = document.getElementById('pwa-dismiss-btn');

  if (installBtn) {
    installBtn.addEventListener('click', function() {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function() {
        deferredPrompt = null;
        var banner = document.getElementById('pwa-install-banner');
        if (banner) banner.classList.remove('visible');
      });
    });
  }

  if (dismissBtn) {
    dismissBtn.addEventListener('click', function() {
      var banner = document.getElementById('pwa-install-banner');
      if (banner) banner.classList.remove('visible');
      localStorage.setItem('vault-pwa-dismissed', '1');
    });
  }
})();

// =====================================================================
// FIX 3 â€” DOUBLE-TAP TO LIKE
// =====================================================================
if (window.matchMedia('(pointer: coarse)').matches) {
  document.addEventListener('touchend', function(e) {
    var card = e.target.closest('.track-card');
    if (!card) return;
    var now = Date.now();
    var lastTap = parseInt(card.dataset.lastTap || '0');
    if (now - lastTap < 300 && now - lastTap > 50) {
      e.preventDefault();
      var trackId = parseInt(card.dataset.id);
      if (trackId && typeof toggleTrackLike === 'function') {
        toggleTrackLike(trackId);
        showHeartBurst(card);
      }
    }
    card.dataset.lastTap = String(now);
  }, { passive: false });
}

function showHeartBurst(card) {
  var heart = document.createElement('div');
  heart.textContent = 'â™¥';
  heart.style.cssText = [
    'position:absolute',
    'top:50%',
    'left:50%',
    'transform:translate(-50%,-50%) scale(0)',
    'font-size:52px',
    'color:#ff3c3c',
    'pointer-events:none',
    'z-index:100',
    'animation:heartBurst 0.55s ease-out forwards',
    'text-shadow:0 0 20px rgba(255,60,60,0.8)'
  ].join(';');
  var prevPos = getComputedStyle(card).position;
  if (prevPos === 'static') card.style.position = 'relative';
  card.appendChild(heart);
  setTimeout(function() {
    heart.remove();
    if (prevPos === 'static') card.style.position = '';
  }, 600);
}

// =====================================================================
// FIX 4 â€” PULL TO REFRESH
// =====================================================================
(function() {
  if (!window.matchMedia('(pointer: coarse)').matches) return;

  var pullStartY  = 0;
  var isPulling   = false;
  var THRESHOLD   = 75;

  var indicator = document.createElement('div');
  indicator.id  = 'pull-refresh-indicator';
  indicator.style.cssText = [
    'position:fixed',
    'top:0',
    'left:50%',
    'transform:translateX(-50%) translateY(-100%)',
    'background:rgba(20,20,20,0.95)',
    'color:rgba(255,255,255,0.6)',
    'font-family:var(--font-mono,monospace)',
    'font-size:10px',
    'letter-spacing:3px',
    'text-transform:uppercase',
    'padding:10px 20px',
    'border-radius:0 0 20px 20px',
    'border:1px solid rgba(255,255,255,0.08)',
    'border-top:none',
    'z-index:9999',
    'transition:transform 0.2s ease',
    'pointer-events:none',
    'white-space:nowrap'
  ].join(';');
  indicator.textContent = 'â†“ Pull to refresh';
  document.body.appendChild(indicator);

  document.addEventListener('touchstart', function(e) {
    if (window.scrollY === 0 && e.touches.length === 1) {
      pullStartY = e.touches[0].clientY;
      isPulling  = true;
    }
  }, { passive: true });

  document.addEventListener('touchmove', function(e) {
    if (!isPulling) return;
    var dist = e.touches[0].clientY - pullStartY;
    if (dist <= 0) { isPulling = false; return; }
    var translateY = Math.min(dist * 0.4, THRESHOLD * 0.8);
    indicator.style.transform = 'translateX(-50%) translateY(' + (translateY - 40) + 'px)';
    indicator.textContent = dist > THRESHOLD ? 'â†‘ Release to refresh' : 'â†“ Pull to refresh';
    indicator.style.color = dist > THRESHOLD ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)';
  }, { passive: true });

  document.addEventListener('touchend', function(e) {
    if (!isPulling) return;
    var dist = e.changedTouches[0].clientY - pullStartY;
    isPulling = false;
    indicator.style.transform = 'translateX(-50%) translateY(-100%)';

    if (dist > THRESHOLD && window.scrollY === 0) {
      indicator.textContent = 'âŸ³ Refreshing...';
      indicator.style.transform = 'translateX(-50%) translateY(0px)';

      if (typeof window.reloadTracks === 'function') {
        window.reloadTracks().then(function() {
          showToast('Vault refreshed', 'success');
          setTimeout(function() {
            indicator.style.transform = 'translateX(-50%) translateY(-100%)';
          }, 800);
        }).catch(function() {
          indicator.style.transform = 'translateX(-50%) translateY(-100%)';
        });
      } else {
        setTimeout(function() { location.reload(); }, 500);
      }
    }
  }, { passive: true });
})();

// =====================================================================
// FIX 5 â€” MOBILE ACTION ROW: SESSION + HISTORY BUTTONS
// =====================================================================
(function() {
  var mobileSessionBtn = document.getElementById('mobile-session-btn');
  var mobileHistoryBtn = document.getElementById('mobile-history-btn');

  if (mobileSessionBtn) {
    mobileSessionBtn.addEventListener('click', function() {
      var sessionBtn = document.getElementById('session-btn');
      if (sessionBtn) sessionBtn.click();
    });
  }

  if (mobileHistoryBtn) {
    mobileHistoryBtn.addEventListener('click', function() {
      var historyBtn = document.getElementById('history-view-btn');
      if (historyBtn) {
        historyBtn.click();
      } else if (typeof setView === 'function') {
        setView('history');
      }
    });
  }
})();

// =====================================================================
// FIX 6 â€” NOW-PLAYING MINI CARD ON TAP
// =====================================================================
(function() {
  if (!window.matchMedia('(pointer: coarse)').matches) return;

  var playerInfo = document.querySelector('.player-info');
  if (!playerInfo) return;

  playerInfo.addEventListener('click', function() {
    var card      = document.getElementById('now-playing-card');
    var coverEl   = document.getElementById('now-playing-cover');
    var titleEl   = document.getElementById('now-playing-title');
    var artistEl  = document.getElementById('now-playing-artist');
    var likeBtn   = document.getElementById('now-playing-like');
    var artistBtn = document.getElementById('now-playing-artist-btn');
    if (!card) return;

    var pl    = typeof getPlaylist === 'function' ? getPlaylist() : tracks;
    var track = pl && pl[currentTrackIdx];
    if (!track) return;

    if (coverEl)  coverEl.src          = track.coverArt || '';
    if (titleEl)  titleEl.textContent  = track.title   || '';
    if (artistEl) artistEl.textContent = track.artist  || '';

    var liked = likedTracks && likedTracks.has ? likedTracks.has(track.id) : false;
    if (likeBtn) likeBtn.textContent = liked ? 'â™¥' : 'â™¡';

    if (likeBtn) {
      likeBtn.onclick = function() {
        if (typeof toggleTrackLike === 'function') {
          toggleTrackLike(track.id);
          var isNowLiked = likedTracks && likedTracks.has ? likedTracks.has(track.id) : false;
          likeBtn.textContent = isNowLiked ? 'â™¥' : 'â™¡';
        }
      };
    }

    if (artistBtn) {
      artistBtn.onclick = function() {
        card.classList.remove('visible');
        if (typeof openArtistPage === 'function') openArtistPage(track.artist);
      };
    }

    card.classList.add('visible');
  });

  var shareBtn = document.getElementById('now-playing-share');
  if (shareBtn) {
    shareBtn.addEventListener('click', function() {
      if (typeof copyTimestamp === 'function') copyTimestamp();
    });
  }

  var closeBtn = document.getElementById('now-playing-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', function() {
      var card = document.getElementById('now-playing-card');
      if (card) card.classList.remove('visible');
    });
  }
})();

