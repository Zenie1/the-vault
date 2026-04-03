# THE VAULT 🔒

> A personal underground music archive. Stream, download, and share unreleased tracks with your crew.

---

## What It Is

The Vault is a private music sharing platform built for sharing unreleased, leaked, and underground music with a select group of people. It runs entirely in the browser — no backend, no app install, no account required to listen.

Admins control what gets added. Everyone else just shows up and hits play.

---

## Features

### For Listeners
- 🎵 Stream tracks directly in the browser
- ⬇️ Download any track with one tap
- 🔍 Search by artist, title, or tag
- 🎨 Artist-specific animated backgrounds (Vault Canvas)
- 📱 Fully optimised for mobile (iOS + Android)
- ❤️ Like tracks during your session
- ♩ Lyrics panel with real-time sync (LRCLIB → LRC file → Whisper → Genius)

### For Admins
- ➕ Add tracks via URL, Cloudinary CDN, or direct file upload
- 🖼️ Cover art search powered by iTunes
- 🎬 Per-track canvas backgrounds (MP4 / GIF via Cloudinary)
- 🗑️ Delete tracks from the vault
- ☁️ Auto-sync to GitHub — all changes push to `tracks.json` instantly
- 📂 Import/export `tracks.json` manually
- 🤖 AI-powered Google Drive import — paste filenames, Claude auto-sorts by artist, title, and tags

### Player
- Live frequency-reactive waveform visualiser
- Scrub to seek (mouse + touch)
- Shuffle, loop, skip
- Volume control
- Spinning vinyl disc with cover art popup
- Bar and line waveform modes

### Keyboard Shortcuts
| Key | Action |
|---|---|
| `Space` | Play / Pause |
| `→` | Next track |
| `←` | Previous track |
| `Shift + →` | Skip forward 10s |
| `Shift + ←` | Skip back 10s |
| `↑ / ↓` | Volume up / down |
| `M` | Mute toggle |
| `S` | Shuffle toggle |
| `L` | Loop toggle |
| `K` | Lyrics panel toggle |

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | HTML, CSS, Vanilla JavaScript |
| Audio | Web Audio API |
| Storage | GitHub API (`tracks.json`) + localStorage fallback |
| Media Hosting | Cloudinary (audio + canvas videos) |
| Cover Art | iTunes Search API |
| AI Features | Anthropic Claude API |
| Lyrics | LRCLIB · LRC files · Whisper (Cloudflare Worker) · Genius |
| Fonts | Archivo Black, Syne, DM Mono (Google Fonts) |

---

## File Structure

```
/
├── index.html        # App shell — all HTML and CSS
├── vault.js          # All application logic
├── tracks.json       # Track library — managed by the admin panel
├── README.md         # This file
└── lrc/              # (optional) Time-synced .lrc lyrics files
    ├── nine-vicious-friday.lrc
    └── prettifun-dead.lrc
```

---

## Pushing to GitHub with Git Bash

This is your standard workflow every time you update `index.html` or `vault.js`.

### First time only — link your local folder to GitHub

Open **Git Bash** in your `Valut` folder (right-click the folder → Git Bash Here), then run:

```bash
git remote -v
```

If you see your repo URL listed, you're already linked — skip to the next section. If nothing shows, run:

```bash
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
```

Replace `YOUR-USERNAME` and `YOUR-REPO-NAME` with your actual GitHub username and repo name.

---

### Every update — the 4-command push

Open Git Bash in your `Valut` folder and run these four commands:

```bash
git pull origin main
git add index.html vault.js
git commit -m "update vault"
git push origin main
```

**What each line does:**

- `git pull origin main` — fetches any changes from GitHub first (prevents conflicts with `tracks.json` the admin panel has been updating)
- `git add index.html vault.js` — stages only your code files (intentionally excludes `tracks.json` — let the admin panel own that file)
- `git commit -m "update vault"` — saves a snapshot with a message
- `git push origin main` — uploads to GitHub, which triggers GitHub Pages to redeploy automatically

> ⚠️ **Never run `git add .` or `git add tracks.json`** — this will overwrite the live `tracks.json` with your local copy and wipe any tracks added through the admin panel since your last pull.

---

### If you also updated the README

```bash
git pull origin main
git add index.html vault.js README.md
git commit -m "update vault + readme"
git push origin main
```

---

### If you added LRC files

```bash
git pull origin main
git add index.html vault.js lrc/
git commit -m "add synced lyrics"
git push origin main
```

---

### Checking what changed before you commit

```bash
git status
```

Shows you exactly which files are modified. Green = staged, red = not staged.

```bash
git diff index.html
```

Shows line-by-line what changed in a file before committing.

---

## First-Time GitHub Pages Setup

If the site isn't live yet:

1. Push your files to GitHub (commands above)
2. Go to your repo on github.com
3. Click **Settings → Pages**
4. Under **Source**, select `Deploy from a branch`
5. Choose `main` branch, `/ (root)` folder
6. Click **Save**
7. Wait 1–2 minutes — your site will be live at `https://YOUR-USERNAME.github.io/YOUR-REPO-NAME`

---

## Admin Setup

### Login
Default password: `vault2024`

To change it, open `vault.js` and find:
```js
const ADMIN_PASSWORD = 'vault2024';
```
Replace with your own password and push.

### GitHub Sync (in-browser)
1. Go to `github.com → Settings → Developer Settings → Personal Access Tokens → Fine-grained`
2. Create a token with **Contents: Read & Write** on your vault repo
3. Open the vault, click **⚿ Admin** and log in
4. Click **⚙ GitHub** and fill in your token, username, repo name, and branch
5. Hit **Save & Test Connection**

Every track you add through the panel now auto-commits to `tracks.json` — no Git needed for track management.

---

## Lyrics System

The lyrics panel (press **♩ Lyrics** in the player or hit `K`) works through four tiers, trying each in order:

### Tier 1 — LRCLIB (automatic, no setup)
Free public API. Works instantly for most mainstream tracks. Gives real timestamps — lyrics highlight the exact line as it plays.

### Tier 2 — LRC File (manual, best for unreleased)
For tracks that aren't on LRCLIB (unreleased, vault exclusives), you can provide a `.lrc` file with exact timestamps.

**How to use:**
1. Create or download a `.lrc` file for the track. Format:
   ```
   [00:12.50]First line of the song
   [00:15.80]Second line here
   [00:19.20]And so on
   ```
2. Name it something like `nine-vicious-friday.lrc`
3. Drop it in a `/lrc/` folder in your GitHub repo
4. In the admin panel, edit the track and enter just the filename (e.g. `nine-vicious-friday.lrc`) in the **LRC File** field

### Tier 3 — Whisper Transcription (automatic fallback)
If LRCLIB and LRC both fail, the system sends the audio to a Cloudflare Worker running Hugging Face Whisper. It transcribes the track and returns timestamps automatically. Takes 20–40 seconds. Result is cached in localStorage forever so it only runs once per track.

Requires the Whisper Worker to be deployed — see `WHISPER_WORKER_URL` in `vault.js`.

### Tier 4 — Genius (last resort)
If everything else fails and you've pasted a Genius URL into the track's **Genius Lyrics URL** field, it fetches the plain lyrics text via a CORS proxy. Scroll position is approximate (linear distribution across the track).

**To add a Genius URL:**
1. Go to genius.com, find the song page
2. Copy the full URL (e.g. `https://genius.com/Nine-vicious-friday-lyrics`)
3. Edit the track in admin mode and paste it in the **Genius Lyrics URL** field

---

## Canvas Backgrounds (Spotify-style visuals)

Each track can have a looping video or GIF that plays fullscreen behind the player.

**To add one:**
1. Upload your `.mp4` or `.gif` to Cloudinary
2. Copy the direct media URL (must end in `.mp4` or `.gif`)
3. When adding a track, paste it into the **Canvas** field

**To set a default for an entire artist**, open `vault.js` and find:

```js
const ARTIST_CANVAS = {
  'nine vicious': '',   // ← paste URL here
  'prettifun':    '',
  'che':          '',
  ...
};
```

---

## Important Notes

- **Never `git add tracks.json`** — let the admin panel manage it. Always `git pull` before pushing code.
- Audio files on Cloudinary support CORS, which is required for the waveform visualiser.
- Your GitHub token lives in `localStorage` only — never committed to the repo.
- File uploads (local audio) are session-only and won't sync to GitHub. Use Cloudinary for permanent tracks.
- Lyrics are cached in `localStorage` after first load — clearing browser storage will cause them to re-fetch.

---

## Artists

Current roster:

- Nine Vicious
- Prettifun
- Che
- Playboi Carti
- Lil Yachty
- Young Thug
- Lucki
- Slayr
- Protect
- OsamaSon

---

*Built with HTML, CSS, and JavaScript. No frameworks. No bullshit.*