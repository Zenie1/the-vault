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
| Fonts | Archivo Black, Syne, DM Mono (Google Fonts) |

---

## Setup

### 1. Deploy the site
Push `index.html` and `tracks.json` to a GitHub repository and enable GitHub Pages, or drag the file into [Netlify Drop](https://app.netlify.com/drop).

### 2. Configure GitHub sync
1. Go to `github.com → Settings → Developer Settings → Personal Access Tokens → Fine-grained`
2. Create a token with **Contents: Read & Write** on your vault repo
3. Open the vault in your browser, click **⚿ Admin**, log in
4. Click **⚙ GitHub** and fill in your token, username, repo name, and branch
5. Hit **Save & Test Connection** — done. Every track you add now auto-commits to `tracks.json`

### 3. Add your first track
1. Log in as admin
2. Click **+ Add Track**
3. Choose a tab — URL link, Cloudinary, or file upload
4. Fill in artist, title, tags, and optionally a cover art and canvas background URL
5. Hit **Save Track**

### 4. Share with friends
Copy the URL and send it. That's it — no login needed to listen or download.

---

## Admin Login

Default password: `vault2024`

To change it, open `index.html` and find this line near the top of the script section:

```js
const ADMIN_PASSWORD = 'vault2024';
```

Replace `vault2024` with your own password and push the update.

---

## Adding Canvas Backgrounds (Spotify-style visuals)

Each track can have a looping video or GIF that plays fullscreen behind the player when that track is active.

**To add one:**
1. Upload your `.mp4` or `.gif` to Cloudinary
2. Copy the direct media URL (not a webpage link — it must end in `.mp4` or `.gif`)
3. When adding a track, paste it into the **Canvas Background** field

**To set a default for an entire artist**, open `index.html` and find:

```js
const ARTIST_CANVAS = {
  'nine vicious': '',   // ← paste URL here
  'prettifun':    '',
  'che':          '',
  ...
};
```

Any track by that artist will use this background unless overridden at the track level.

---

## File Structure

```
/
├── index.html        # The entire app — player, UI, admin panel
├── tracks.json       # Track library — managed by the admin panel
└── README.md         # This file
```

---

## Important Notes

- **Never push an old `tracks.json`** from your local machine via Git — it will overwrite whatever the admin panel saved. Let the admin panel manage `tracks.json` exclusively, or always pull before you push.
- Audio files hosted on Cloudinary support CORS out of the box, which is required for the waveform visualiser to work.
- The GitHub token is stored in your browser's `localStorage` only — it is never committed to the repo.
- File uploads (local audio) are stored as base64 data URLs in your browser session only. They won't survive a page refresh or sync to GitHub. Use Cloudinary for permanent tracks.

---

## Artists

Current roster in the vault:

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
