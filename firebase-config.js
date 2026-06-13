// firebase-config.js — The Vault · Firebase project configuration (ES module)
// ─────────────────────────────────────────────────────────────────────────────
// Exports `app` and `db` for use in session.js and any other ES modules.
// ⚠  Do NOT commit this file to a public repo.
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js';
import { getDatabase }   from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-database.js';

const firebaseConfig = {
  apiKey:            'AIzaSyDE64cLcQIKTjgLLIY7Njzdi9mNoIY_lHU',
  authDomain:        'the-vault-88b96.firebaseapp.com',
  databaseURL:       'https://the-vault-88b96-default-rtdb.firebaseio.com',
  projectId:         'the-vault-88b96',
  storageBucket:     'the-vault-88b96.firebasestorage.app',
  messagingSenderId: '840138932766',
  appId:             '1:840138932766:web:a488fb298c276476fb640f',
};

export const app = initializeApp(firebaseConfig);
export const db  = getDatabase(app);

// Expose Firebase db + helpers to window so vault.js (non-module defer script) can use them.
// vault.js only calls these functions on user interaction (login click), never at init time,
// so the module will have finished loading by then.
import { ref, get, set } from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-database.js';
window._vaultDb    = db;
window._vaultDbRef = ref;
window._vaultDbGet = get;
window._vaultDbSet = set;
