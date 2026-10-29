# Bitch Hangman

A cheeky, seven-life Hangman game **and** a public-key encryptor — as **one app**.
Open it and two jobs are waiting:

| Job | What it does |
|---|---|
| **Play a game** | Type a word yourself, **or** paste an encrypted word someone sent you. Seven lives, one beer. |
| **Generate a word** | Type a secret, encrypt it in your browser, and send the host the payload. The plaintext never leaves your device. |

Everything runs in the browser. There are no accounts, no backend, and no network
requests during play.

> **Zero setup.** The app ships with one **built-in key pair**, so *both* jobs work
> the moment you open it — nothing to configure, no keys to enter. That built-in
> private key is **public by design** (it is published with the page), so it is a
> convenience default, not a secret. Want your own? **Key settings → Change key
> pair.** See [§4](#4-the-built-in-key-pair-and-how-to-change-it).

---

## 1. How the two jobs fit together

```
  HOST (runs the game)                        COWORKER
  --------------------                        --------
  1. Opens the app
  2. Shares the app URL
  3. Receives the "BHANGMAN1.…" payload  ◄─── 4. "Generate a word"
                                               5. Types a secret word + hint
                                                  (encrypted in their browser)
                                               6. Copies the payload
                                               7. Sends it in Teams
  8. "Play a game" → paste the payload
  9. It decrypts locally;
     everyone guesses out loud
```

Only the ciphertext travels through Teams. No per-word passphrase is ever needed,
and the host never sees the plaintext word until the round is won or lost.

---

## 2. Folder structure

```
Bitch-Hangman/
├── app/                          ← THE APP (this folder is what gets published)
│   ├── index.html                the one page: home / play / game / encrypt / keys
│   ├── styles.css                party-game theme (dark / cream / red / amber)
│   ├── app.js                    UI controller (five views, board, import, keyboard)
│   ├── crypto.js                 the crypto core (hybrid AES-GCM + RSA-OAEP)
│   ├── default-keys.js           the BUILT-IN key pair (zero-setup default)
│   ├── game-logic.js             pure seven-life rules (no DOM)
│   ├── key-management.js         storage, clipboard and file helpers
│   ├── manifest.json             PWA manifest
│   ├── service-worker.js         offline cache (same-origin files only)
│   └── assets/icon.svg           inline app icon
├── shared/
│   └── payload-format.md         the documented payload / backup format
├── tests/
│   ├── crypto-tests.js           27 automated crypto + static-audit checks
│   ├── game-tests.js             29 automated rules + offline + UI checks
│   └── harness.js                a tiny dependency-free test harness
├── tools/
│   └── serve.js                  Node.js fallback local server
├── .github/workflows/pages.yml   publishes app/ to GitHub Pages
├── start-game.bat                Windows launcher (double-click this)
├── .gitignore                    keeps key backups and payloads out of Git
└── README.md                     you are here
```

There is **one** crypto core (`app/crypto.js`) and **one** key file
(`app/default-keys.js`). The old separate `game/` and `encryptor/` folders are gone.

---

## 3. Requirements

- **Windows 10 or 11** with a modern browser (Microsoft Edge, Chrome, Firefox).
- **One** of the following, already installed, to run the local server:
  - **Python 3** (any recent version) — *preferred*, standard library only, **or**
  - **Node.js 18+** — used automatically if Python is missing.
- **Nothing else.** No `pip`, no `npm install`, no admin rights, no downloads.

If neither Python nor Node is installed, you can still *open* `app/index.html` from
`file://`, but browsers disable the Web Crypto API there. **Play a game → type a
word** still works; encryption and decryption do not. Install Python (tick **"Add
python.exe to PATH"** in the installer) and re-run `start-game.bat` for the rest.

---

## 4. The built-in key pair, and how to change it

**Why it exists.** The app is meant to be playable instantly. Instead of making you
create a key before anything works, it ships one pair in
[default-keys.js](file:///d:/Lester/Documents/Scripts/Bitch-Hangman/app/default-keys.js):

- **Generate a word** encrypts to its **public** half.
- **Play a game → paste a payload** decrypts with its **private** half.

Both halves ship together, so the round-trip works with **no setup at all**.

**The honest catch.** Because the private half is published with the page, anyone
who can open the app can decrypt payloads made with the built-in key. That is fine
for a party game where the host is the only one looking — but it is **not a
secret**. Use your own pair for anything that matters.

**Change it (Key settings):**

- **Change key pair → Generate a new key pair** — creates a fresh **RSA-OAEP
  3072-bit** pair. You give a **backup passphrase**; a passphrase-protected
  `bitch-hangman-key-backup-<date>.json` downloads automatically (and is verified
  before use). The new key is **remembered in this browser** and the whole app
  switches to it.
- **Restore from a backup** — bring a key back on a fresh install or another PC
  (600,000 PBKDF2 rounds; give it a few seconds).
- **Use built-in key** — drop your generated key from this browser and go back to
  the shipped default.

While your own key is active, the header chip reads **"Custom key active"**;
otherwise it reads **"Built-in key"**. The **fingerprint** (64 hex characters) is
shown so both sides can check they share the same pair.

---

## 5. Run the app

1. Double-click **`start-game.bat`**.
2. A console window opens, picks a free port between **8777 and 8796**, and opens
   your browser at `http://127.0.0.1:<port>/`.
3. **Keep the console window open while you use the app.** Closing it stops the
   server.
4. The header shows a **key chip** ("Built-in key" or "Custom key active"). That
   plus `127.0.0.1` means you are on a secure context, so Web Crypto works.
5. The **home screen** shows the two jobs. That is all.

No admin rights are requested. The server binds to `127.0.0.1` **only**, so nobody
on your network can reach it, and nothing is downloaded at launch.

**Manual fallback (if the `.bat` is blocked by policy):**

```powershell
# from the Bitch-Hangman folder
python -m http.server 8777 --bind 127.0.0.1 --directory app   # open http://127.0.0.1:8777/
# or, with Node.js:
node tools/serve.js 8777 app
```

---

## 6. Job 1 — Play a game

From the home screen, **Play a game**. The screen is replaced by two panels and the
game board.

**Type a word (the quick way, no keys).** Put the secret in *Secret word or phrase*,
add an optional hint, and press **Start game** (or **Enter**). The box is cleared
the instant the round begins, so the word is not left on screen. This path needs no
key and no payload at all.

**Paste an encrypted word (a coworker's submission).** Paste the `BHANGMAN1.…`
text into *Encrypted payload* and press **Unlock & start**. The app shows which key
the payload targets, checks it against the loaded key, then decrypts locally with
the private half. The paste box is cleared on success. A wrong-key, tampered,
truncated or unsupported-version payload is rejected with a plain-language message.

Either way, the round starts on the board (see [§8](#8-how-to-play)). **Back**
returns to the home screen.

---

## 7. Job 2 — Generate a word

From the home screen, **Generate a word**. Two panels appear:

1. **Type your secret** — the word (up to 500 characters) and an optional hint (up
   to 300). Press **Encrypt**. Encryption happens in your browser; the plaintext
   never leaves the device.
2. **Send it** — press **Copy encrypted payload**, then paste it to the host in
   Teams. The payload already targets the app's current public key; no password is
   involved. **Start over** clears everything.

Share the app's URL (see [§10](#10-deploy-to-github-pages)) and tell coworkers to
press **Generate a word**. They send **only** the payload — never the plaintext.

---

## 8. How to play

**Guessing**

- The clue is shown as blanks: `_` for each letter still hidden.
- Guess with the **A–Z buttons** or your **physical keyboard**. Typing inside a
  text box never counts as a guess.
- **Correct** → every occurrence is revealed; no life lost.
- **Wrong** → **one** life lost and **one** illustration stage appears.
- **Repeat** → no penalty, no change.
- You have **exactly 7 lives**. The stages appear in this order:

  | Wrong guess | Stage |
  |---|---|
  | start | Gallows only |
  | 1 | Head |
  | 2 | Body |
  | 3 | Left arm |
  | 4 | Right arm |
  | 5 | Left leg and foot |
  | 6 | Right leg and foot |
  | **7** | **Beer mug — round over** |

- **Win:** every guessable letter is revealed.
- **Lose:** the **seventh** wrong guess. Guessing is then blocked, and the answer is
  shown.

**Board controls**

- **Reveal hint** — shows the hint, if the word had one.
- **Restart round** — same secret, fresh lives.
- **New game…** — back to the play screen for a new word or payload.

Non-guessable characters (spaces, punctuation, digits) are shown automatically and
never cost a life. Accents fold to their base letter (**É** is revealed by guessing
**E**); non-Latin characters with no A-Z equivalent are shown automatically so they
cannot trap the round.

Everyone takes turns **verbally** on the same PC. There are no accounts, no
networking, and no server — just the one page and your keyboard.

---

## 9. Back up and restore the private key

Backups apply to **your own** key (not the built-in one).

**Back up:** the backup file downloads when you **Generate a new key pair**. Keep at
least one copy off this PC. It is useless to a thief without your passphrase and
priceless if you lose your PC — losing it means losing the ability to read old
submissions.

**Remembered automatically:** so you do **not** re-enter a key on every visit, your
key pair is kept in this browser's `localStorage` (stored raw PKCS#8 under
`bh.privateKeyPkcs8`, scoped to `http://127.0.0.1:<port>`, this PC only) and
re-loaded on start-up. Open the app and it is already active.

**Restore** (new PC, fresh browser, or after switching back to the built-in key):

1. Open **Key settings**.
2. Under **Restore from a backup**, choose the `.json` file **or** paste its text.
3. Enter the backup passphrase.
4. Click **Restore & use**.

When you see your fingerprint again, the whole app uses your restored key, and it is
remembered for next time.

**Privacy, honestly:** the secret **word and hint are never stored anywhere** — they
live only in the current round's memory. Your **key pair**, however, *is* saved in
this browser. That is a deliberate convenience trade-off: anything that can run
script on this origin, or anyone with access to this Windows account, could read the
saved private key. Press **Use built-in key** to delete your saved key and drop it
from memory; closing the tab drops the in-memory copy only. (A page cannot promise
*guaranteed* memory erasure — that is an honest limitation.)

---

## 10. Deploy to GitHub Pages

You need a free GitHub account and `git` (or you can use GitHub's web uploader).

1. **Create a repository** on GitHub. Public is fine — it will hold your **public**
   key (and the built-in pair, which is already public by design).
2. **Push this project.** From the `Bitch-Hangman` folder:

   ```powershell
   git init
   git add .
   git commit -m "Bitch Hangman: single app"
   git branch -M main
   git remote add origin https://github.com/<your-user>/<your-repo>.git
   git push -u origin main
   ```
3. **Enable Pages:** in the repository, open **Settings → Pages → Build and
   deployment → Source** and choose **GitHub Actions**.
4. **Wait for the deployment.** The included workflow
   [.github/workflows/pages.yml](file:///d:/Lester/Documents/Scripts/Bitch-Hangman/.github/workflows/pages.yml)
   publishes **only the `app/` folder**. Watch it under the **Actions** tab until the
   "Deploy app to GitHub Pages" run is green.
5. **Find the real URL.** On the deployment job summary (or in **Settings → Pages**)
   GitHub shows something like `https://<your-user>.github.io/<your-repo>/`. This
   project uses relative paths, so it works from a project sub-path as well as a
   custom domain. *Do not guess the URL — always copy the one GitHub shows you.*
6. **Open it over HTTPS** and share it. Coworkers only need the URL and **Generate a
   word**.

Whenever you change the app, commit and push again; the workflow rebuilds
automatically. You can also trigger it manually from **Actions → Run workflow**.

> Trae cannot publish the site for you without you authorising access to your own
> GitHub account. The steps above are the supported path.

---

## 11. Test offline operation

This proves the whole point: the app needs no internet to decrypt.

1. Open the app once while online so the service worker caches the shell.
2. **Disconnect** the PC from the internet (pull the cable / turn off Wi-Fi).
3. Reload the app and **paste a fresh payload**. It still decrypts, because
   decryption is entirely local.
4. Finish a full round.

You can also verify in the browser's **DevTools → Network** tab that playing makes
**no** requests — the only allowed traffic is the first load of the app's own files.

---

## 12. Security and privacy — the honest version

**What this design gives you**

- The sender encrypts with the **public** key; only the matching **private** key
  decrypts.
- The ciphertext is **authenticated** (AES-256-GCM): tampered payloads are rejected.
- The payload is **self-contained**: no server lookup and no per-message passphrase.
- The app makes **no network requests** during play: no CDN, no fonts, no remote
  images, no analytics, no backend.
- Your secret **word and hint are never written to disk, storage or a log**.

**The built-in key is not private.** Its private half is published with the page, so
anyone who can open the app can read payloads made with it. It exists so the app
works with zero setup. Generate your own pair in **Key settings** for anything that
should stay private — that key lives only in your browser, never in the repo.

**Crypto construction (v1)** — see [payload-format.md](file:///d:/Lester/Documents/Scripts/Bitch-Hangman/shared/payload-format.md)

- Data: **AES-256-GCM**, fresh random 96-bit IV per payload.
- Key wrap: **RSA-OAEP** with **SHA-256**, **3072-bit** modulus.
- Randomness: `crypto.getRandomValues()` only — **never** `Math.random()`.
- Key backup: **PBKDF2-SHA-256**, 600,000 iterations, 16-byte salt, then
  **AES-256-GCM**.
- Fingerprint: SHA-256 of the public key, shown as 64 lowercase hex characters.

**Real limitations — read these**

1. **The built-in private key is public.** Payloads made with it can be read by
   anyone who opens the app. Use your own pair for anything that matters.
2. **If your private key (or its passphrase) leaks, every message encrypted to that
   key can be read.** Rotate immediately and keep old backups only where needed.
3. **Your saved key is readable by this browser profile.** To spare you a per-visit
   setup, your own key pair is kept in `localStorage` on this origin. Anyone who can
   run script on `http://127.0.0.1:<port>` — or use this Windows account — could read
   it. Press **Use built-in key** to delete it; treat it like any other local
   credential.
4. **Browser memory erasure is not guaranteed.** Switching keys and closing the tab
   drop the reference; we do not claim forensic wiping.
5. **The hosted site never transmits your word**, but the **hosting provider** still
   sees ordinary request metadata (IP address, user agent, timing). The page sets
   `referrer: no-referrer` and loads no external scripts or trackers.
6. **Base64URL is encoding, not encryption.** The `BHANGMAN1.` text is safe to paste
   because the contents are already encrypted — not because it "looks scrambled".
7. **A payload's `kid` (fingerprint) is metadata**, visible to anyone who sees the
   payload. It identifies *which* key it targets; it reveals nothing about the word.
8. **Physical reality:** this is a party game for coworkers. It protects the *word*
   in transit through Teams. It is not a replacement for a company secrets channel.

---

## 13. Testing

Run the suites yourself (Node.js required):

```powershell
node tests/crypto-tests.js
node tests/game-tests.js
```

**Automated results (latest run on this machine):**

- `tests/crypto-tests.js` — **27 passed, 0 failed.**
  Key generation (3072-bit RSA-OAEP/SHA-256, exportable private key), PEM +
  fingerprint, single-word / phrase / punctuation / hint round-trips, fresh key &
  IV per payload, wrong-key rejection, tamper detection (ciphertext, wrapped key,
  IV), malformed-payload rejection, unsupported-version rejection, algorithm
  validation, field-length validation, `kid` check, metadata-only `describePayload`,
  no plaintext or private key in the payload, the built-in pair is a real matching
  pair that round-trips (zero setup), a payload for the built-in key cannot be read
  with another key, backup round-trip + weak-passphrase refusal, and audits that the
  crypto core uses secure randomness, ships as exactly **one** module, makes no
  network calls, and that the service worker caches only same-origin files.
- `tests/game-tests.js` — **29 passed, 0 failed.**
  All seven life-stages in the required order, exactly seven switchable parts,
  correct/incorrect/repeat/blocked guesses, punctuation & spaces auto-shown, empty
  and letter-less phrase rejection, Unicode folding, restart, import handling,
  keyboard + button wiring, memory-only secret handling, never rendering hidden
  letters, no external resources, secure-context warning, launcher audit
  (loopback-only, no admin, no downloads), required PWA + offline files (and the
  absence of the removed `encryptor/`), a cross-check that every element `app.js`
  touches exists in the page and is cached up front, a check that the **home screen
  offers two jobs and swaps the page for each of the five views**, a check that a
  locally typed word starts a playable round with no key, and a check that **one key
  pair runs everything** — built-in by default, your own remembered, with **Use
  built-in key** to revert.

**Manual checks that could not be automated from Node** (do these in a browser):

- Click every A–Z button **and** press each key on a physical keyboard.
- Watch the seven illustration stages appear in order, ending with the beer mug.
- On the home screen, open **Play a game** and **Generate a word**, and confirm each
  replaces the page; **Back** returns to the two options.
- Encrypt a word, then paste the payload back through **Play a game** and confirm it
  decrypts with the built-in key.
- Generate your own key, reload, and confirm the chip reads **"Custom key active"**;
  then press **Use built-in key** and confirm it reverts.
- Deploy to GitHub Pages, then confirm the site loads and the two jobs work from the
  published URL.
- Disconnect from the internet and finish a round (§11).
- Confirm in DevTools → Network that gameplay issues **no** requests.

---

## 14. Troubleshooting

| Symptom | Fix |
|---|---|
| **"Web Crypto is unavailable here"** banner | You opened `app/index.html` from `file://`. Use `start-game.bat`. Typing a word still works; encryption/decryption need the server. |
| The `.bat` window closes instantly | Python/Node not found. Install Python (tick *Add python.exe to PATH*) or Node.js, then retry. |
| "Every port between 8777 and 8796 is already in use" | Close whatever is using them, or edit `START_PORT`/`END_PORT` in [start-game.bat](file:///d:/Lester/Documents/Scripts/Bitch-Hangman/start-game.bat). |
| Header chip says **"No key"** | The built-in key failed to load — usually a non-secure context. Run through `start-game.bat`, or press **Key settings → Use built-in key**. |
| Import says **wrong/unknown recipient (`KID_MISMATCH`)** | The payload was encrypted to a *different* key. Ask the sender to use the current app URL/key, or switch to the matching key in **Key settings**. |
| Import says **cannot be decrypted / tampered** | The text was altered or truncated in transit. Ask the sender to copy it again in one piece. |
| Import says **unsupported version** | The payload was made by a newer format than this app. Update the app. |
| **Restore fails** | Wrong passphrase, or the file is not a Bitch Hangman backup. Check both, then retry. |
| **Copy** button does nothing | Clipboard permission denied. The text is selected for you — press **Ctrl+C**, or right-click → Copy. |
| Word refuses to start | It had no A–Z letters (e.g. only punctuation/digits/Cyrillic). A phrase must contain at least one guessable Latin letter. |
| Accents look surprising | The app applies Unicode **NFC** and folds accents: guessing **E** reveals **É**. Non-Latin characters with no A–Z equivalent are shown automatically so they can't trap the round. |
| PWA "Install" does not appear | Installability needs HTTPS or `localhost`. `127.0.0.1` supports the crypto; some browsers only offer install on `https://`. The app works either way. |

---

## 15. Quick reference

| I want to… | Do this |
|---|---|
| Play on my own, no keys | Double-click `start-game.bat` → **Play a game** → type a word → **Start game** |
| Play a coworker's submission | **Play a game** → paste the `BHANGMAN1.…` payload → **Unlock & start** |
| Send someone a secret word | **Generate a word** → type it → **Encrypt** → **Copy encrypted payload** |
| Just get started | Nothing — the built-in key already runs both jobs |
| Use my own key | **Key settings → Generate a new key pair** (with a passphrase); it is remembered in this browser |
| Go back to the built-in key | **Key settings → Use built-in key** |
| Move my key to a new PC | **Key settings → Restore from a backup** |
| Give coworkers the tool | Publish `app/` to GitHub Pages, share the URL |
| Run the tests | `node tests/crypto-tests.js` and `node tests/game-tests.js` |
