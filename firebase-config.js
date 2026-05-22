// firebase-config.js — The Vault · Firebase project configuration
// ─────────────────────────────────────────────────────────────────────────────
// SETUP INSTRUCTIONS:
//  1. Go to https://console.firebase.google.com → your project
//  2. Project Settings → General → Your apps → Web app
//  3. Copy the firebaseConfig object values into the fields below.
//  4. In the Firebase Console, enable:
//       • Realtime Database  (Build → Realtime Database → Create database)
//       • Anonymous Authentication  (Build → Authentication → Sign-in method → Anonymous)
//  5. Paste the security rules from firebase-rules.json into:
//       Realtime Database → Rules tab
//
// ⚠  Do NOT commit this file to a public repo with real credentials.
//    Add firebase-config.js to .gitignore if you keep credentials here.
// ─────────────────────────────────────────────────────────────────────────────

const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID",
};
