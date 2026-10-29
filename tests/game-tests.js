/*
 * Bitch Hangman — game logic and offline-purity tests.
 *
 * Covers section 11 "Game tests" plus the static parts of the hosting/offline
 * checklist. Run:  node tests/game-tests.js
 *
 * The rule tests drive the pure logic module. The presentation tests inspect
 * app/index.html and app/app.js as text, because the DOM behaviour of a
 * localhost page cannot be observed from Node — those are called out in the
 * README as "verify in the browser".
 */
'use strict';

const { runAll, ok, eq, includes, notIncludes, match, noMatch, rejects, loadNamespace, read, code, exists } = require('./harness.js');

const L = loadNamespace('app/game-logic.js', 'BHLogic');

const indexHtml = read('app/index.html');
const appJs = read('app/app.js');
const keyMgmt = read('app/key-management.js');
// Comments legitimately mention storage/network words, so static audits look at
// the code only.
const appCode = code('app/app.js');
const keyMgmtCode = code('app/key-management.js');

/* ---------------------------------------------------------------- helpers */

/** Masked view: '_' for an unrevealed letter, the character once revealed. */
function mask(round) {
  return L.renderWord(round).map(function (tile) {
    return tile.revealed ? tile.char : '_';
  }).join('');
}

const WRONG_LETTERS = ['B', 'D', 'F', 'G', 'J', 'K', 'L']; // none of them appear in CAT

function playWrong(round, count) {
  let last = null;
  for (let i = 0; i < count; i++) {
    last = L.guess(round, WRONG_LETTERS[i]);
  }
  return last;
}

function countParts(source) {
  return (source.match(/data-part="/g) || []).length;
}

const cases = [
  {
    name: '1. a correct guess reveals every occurrence and costs no life',
    fn: async () => {
      const round = L.createRound({ word: 'BANANA' });
      const outcome = L.guess(round, 'n');
      eq(outcome.result, 'correct', 'lowercase input is accepted and folded');
      eq(round.wrong, 0, 'no life lost');
      eq(mask(round), '__N_N_', 'both Ns revealed');
      eq(L.stageIndex(round), 0, 'illustration unchanged');
      eq(L.guess(round, 'B').result, 'correct', 'second correct guess');
      eq(mask(round), 'B_N_N_', 'B revealed as well');
    }
  },
  {
    name: '2. an incorrect guess costs exactly one life and advances one stage',
    fn: async () => {
      const round = L.createRound({ word: 'CAT' });
      const outcome = L.guess(round, 'Z');
      eq(outcome.result, 'incorrect', 'not in the word');
      eq(round.wrong, 1, 'exactly one life lost');
      eq(L.stageIndex(round), 1, 'exactly one stage advanced');
      eq(L.isLost(round), false, 'round continues');
    }
  },
  {
    name: '3. a repeated guess costs no life and does not advance the illustration',
    fn: async () => {
      const round = L.createRound({ word: 'CAT' });
      L.guess(round, 'Z');
      const before = L.stageIndex(round);
      const again = L.guess(round, 'z');
      eq(again.result, 'repeat', 'recognised as a repeat');
      eq(round.wrong, 1, 'life count unchanged');
      eq(L.stageIndex(round), before, 'stage unchanged');

      const correctRepeat = L.createRound({ word: 'CAT' });
      L.guess(correctRepeat, 'C');
      eq(L.guess(correctRepeat, 'C').result, 'repeat', 'repeating a correct guess is also a no-op');
      eq(correctRepeat.wrong, 0, 'no life lost');
    }
  },
  {
    name: '4. the first wrong guess shows the head',
    fn: async () => {
      const round = L.createRound({ word: 'CAT' });
      playWrong(round, 1);
      eq(L.stageName(round), 'head', 'stage 1 is the head');
      includes(indexHtml, 'data-part="head"', 'the head exists in the illustration');
    }
  },
  {
    name: '5. the second wrong guess shows the body',
    fn: async () => {
      const round = L.createRound({ word: 'CAT' });
      playWrong(round, 2);
      eq(L.stageName(round), 'body', 'stage 2 is the body');
      includes(indexHtml, 'data-part="body"', 'the body exists in the illustration');
    }
  },
  {
    name: '6. the third wrong guess shows the left arm',
    fn: async () => {
      const round = L.createRound({ word: 'CAT' });
      playWrong(round, 3);
      eq(L.stageName(round), 'left-arm', 'stage 3 is the left arm');
      includes(indexHtml, 'data-part="left-arm"', 'the left arm exists in the illustration');
    }
  },
  {
    name: '7. the fourth wrong guess shows the right arm',
    fn: async () => {
      const round = L.createRound({ word: 'CAT' });
      playWrong(round, 4);
      eq(L.stageName(round), 'right-arm', 'stage 4 is the right arm');
      includes(indexHtml, 'data-part="right-arm"', 'the right arm exists in the illustration');
    }
  },
  {
    name: '8. the fifth wrong guess shows the left leg and foot',
    fn: async () => {
      const round = L.createRound({ word: 'CAT' });
      playWrong(round, 5);
      eq(L.stageName(round), 'left-leg', 'stage 5 is the left leg and foot');
      includes(indexHtml, 'data-part="left-leg"', 'the left leg exists in the illustration');
    }
  },
  {
    name: '9. the sixth wrong guess shows the right leg and foot',
    fn: async () => {
      const round = L.createRound({ word: 'CAT' });
      playWrong(round, 6);
      eq(L.stageName(round), 'right-leg', 'stage 6 is the right leg and foot');
      eq(L.isLost(round), false, 'one life still remains');
      includes(indexHtml, 'data-part="right-leg"', 'the right leg exists in the illustration');
    }
  },
  {
    name: '10. the seventh wrong guess shows the beer mug and ends the round',
    fn: async () => {
      const round = L.createRound({ word: 'CAT' });
      const outcome = playWrong(round, 7);
      eq(L.stageName(round), 'beer', 'stage 7 is the beer mug');
      eq(outcome.status, 'lost', 'the round is lost');
      eq(round.wrong, 7, 'exactly seven lives were spent');
      includes(indexHtml, 'data-part="beer"', 'the beer mug exists in the illustration');
      // The beer mug must be the final part in document order.
      const order = ['gallows', 'head', 'body', 'left-arm', 'right-arm', 'left-leg', 'right-leg', 'beer'];
      const found = (indexHtml.match(/data-part="([^"]+)"/g) || []).map(function (s) {
        return s.replace(/data-part="|"/g, '');
      });
      eq(found.join(','), order.slice(1).join(','), 'illustration parts appear in the required order');
      eq(countParts(indexHtml), 7, 'exactly seven switchable parts (the gallows is not a life)');
    }
  },
  {
    name: '11. the illustration has exactly eight states and seven lives',
    fn: async () => {
      eq(L.STAGES.length, 8, 'gallows + seven stages');
      eq(L.STAGES[0], 'gallows', 'stage 0 is the bare gallows');
      eq(L.STAGES[7], 'beer', 'stage 7 is the beer');
      eq(L.LIVES, 7, 'seven lives');
      eq(L.letterKeys().length, 26, 'A-Z buttons');
      eq(L.letterKeys()[0], 'A', 'first letter');
      eq(L.letterKeys()[25], 'Z', 'last letter');
      eq(L.stageIndex(L.createRound({ word: 'CAT' })), 0, 'a fresh round shows the gallows only');
    }
  },
  {
    name: '12. winning blocks any further guesses',
    fn: async () => {
      const round = L.createRound({ word: 'CAT' });
      L.guess(round, 'C');
      L.guess(round, 'A');
      const won = L.guess(round, 'T');
      eq(won.result, 'correct', 'last letter found');
      eq(round.status, 'won', 'round won');
      eq(L.isWon(round), true, 'win detection');
      eq(L.guess(round, 'B').result, 'blocked', 'no guessing after a win');
      eq(round.wrong, 0, 'no life changes after the round ended');
    }
  },
  {
    name: '13. losing blocks any further guesses',
    fn: async () => {
      const round = L.createRound({ word: 'CAT' });
      playWrong(round, 7);
      eq(L.guess(round, 'C').result, 'blocked', 'even a correct letter is refused');
      eq(round.wrong, 7, 'life count stays at the loss point');
      eq(L.isLost(round), true, 'loss detection');
    }
  },
  {
    name: '14. spaces, punctuation and digits are shown automatically and never cost a life',
    fn: async () => {
      const round = L.createRound({ word: "HI, THERE!" });
      const tiles = L.renderWord(round);
      const fixed = tiles.filter(function (t) { return !t.guessable; }).map(function (t) { return t.char; });
      eq(fixed.join(''), ', !', 'punctuation and the space are pre-revealed');
      eq(L.remainingKeys(round).length, 5, 'only H, I, T, E, R are guessable');
      L.guess(round, 'Z');
      eq(round.wrong, 1, 'a wrong letter still costs a life');
      L.guess(round, 'H');
      eq(mask(round), 'H_, _H___!', 'letters inside the phrase are revealed, punctuation untouched');
      eq(round.wrong, 1, 'punctuation does not consume lives');
    }
  },
  {
    name: '15. a phrase with no guessable letters is rejected',
    fn: async () => {
      await rejects(() => L.createRound({ word: '   ' }), 'EMPTY_WORD');
      await rejects(() => L.createRound({ word: '!!! ???' }), 'NO_LETTERS');
      await rejects(() => L.createRound({ word: '' }), 'EMPTY_WORD');
      // Digits and symbols alone are not guessable either.
      await rejects(() => L.createRound({ word: '12345 ---' }), 'NO_LETTERS');
    }
  },
  {
    name: '16. Unicode handling is documented and never changes the phrase',
    fn: async () => {
      eq(L.foldChar('é'), 'E', 'accented Latin letters fold to their base letter');
      eq(L.foldChar('É'), 'E', 'uppercase accents fold too');
      eq(L.foldChar('a'), 'A', 'plain letters fold to uppercase');
      eq(L.foldChar(' '), null, 'whitespace is not guessable');
      eq(L.foldChar('7'), null, 'digits are not guessable');
      eq(L.foldChar('Д'), null, 'non-Latin letters are not guessable');

      const accented = L.createRound({ word: 'CAFÉ AU LAIT' });
      eq(L.remainingKeys(accented).length, 8, 'C, A, F, E, U, L, I, T are the distinct guessable letters');
      L.guess(accented, 'E');
      const tiles = L.renderWord(accented);
      eq(tiles[3].char, 'É', 'the original accented character is preserved for display');
      eq(tiles[3].revealed, true, 'guessing E reveals É');

      // Mixed scripts stay playable: letters with no A-Z equivalent are shown
      // automatically, while the Latin ones still have to be guessed.
      const mixed = L.createRound({ word: 'МИР OK' });
      const autoShown = L.renderWord(mixed).filter(function (t) {
        return t.revealed && t.char && t.char.trim() && !/[A-Za-z]/.test(t.char);
      });
      eq(autoShown.length, 3, 'the three Cyrillic letters are displayed, not hidden');
      eq(L.remainingKeys(mixed).length, 2, 'only O and K remain guessable');

      // A phrase that is entirely unguessable is refused up front with a clear code.
      await rejects(() => L.createRound({ word: 'ПРИВЕТ' }), 'NO_LETTERS');

      // Normalisation is limited and documented.
      eq(L.normalizeWord('  hello\tworld\n  '), 'hello world', 'tabs and newlines become single spaces, outer space trimmed');
      eq(L.normalizeWord('A  B'), 'A  B', 'inner spacing is preserved verbatim');
      eq(L.normalizeWord('Cafe\u0301'), 'Café', 'NFC composition is applied');
    }
  },
  {
    name: '17. restarting the round resets the current round in place',
    fn: async () => {
      const round = L.createRound({ word: 'SECRET', hint: 'shhh' });
      playWrong(round, 2);
      L.guess(round, 'S');
      eq(round.wrong, 2, 'before restart');

      const restarted = L.createRound({ word: round.word, hint: round.hint });
      eq(restarted.wrong, 0, 'lives restored');
      eq(Object.keys(restarted.guessed).length, 0, 'guesses cleared');
      eq(restarted.status, 'playing', 'playable again');
      eq(mask(restarted), '______', 'word masked again');
      eq(restarted.hint, 'shhh', 'the hint is kept for the same secret');

      // app.js must restart from the current secret rather than re-importing.
      match(appJs, /function restartRound\(\)/, 'restartRound exists');
      includes(appJs, 'startRound(secret)', 'restart builds a fresh round from the in-memory secret');
    }
  },
  {
    name: '18. importing a new word clears the previous round and its traces',
    fn: async () => {
      const first = L.createRound({ word: 'FIRSTWORD' });
      playWrong(first, 3);
      const second = L.createRound({ word: 'SECOND', hint: '' });
      eq(second.wrong, 0, 'new round starts with full lives');
      eq(mask(second), '______', 'new word is masked');
      ok(first !== second, 'rounds are independent objects');

      const importBlock = appJs.slice(appJs.indexOf('function handleImport()'), appJs.indexOf('function isTypingContext'));
      includes(importBlock, 'startRound(', 'the import handler starts a fresh round');
      includes(importBlock, "el['payload-input'].value = ''", 'the ciphertext box is cleared after a successful import');
      match(appJs, /function startRound[\s\S]*?answer-box'\]\.classList\.add\('hidden'\)/, 'starting a round hides the previous answer');
    }
  },
  {
    name: '19. guesses work from the on-screen buttons and the physical keyboard',
    fn: async () => {
      includes(indexHtml, 'id="letter-grid"', 'letter grid container exists');
      match(appJs, /L\.letterKeys\(\)\.forEach/, 'A-Z buttons are generated from the logic module');
      includes(appJs, "document.addEventListener('keydown', onKeyDown)", 'physical keyboard is wired up');
      includes(appJs, 'if (!/^[a-zA-Z]$/.test(event.key))', 'keydown only reacts to A-Z letters');
      includes(appJs, 'isTypingContext', 'typing in a textarea or input must not guess letters');
      includes(appJs, 'handleGuess(event.key.toUpperCase())', 'keyboard input is routed to the same handler as the buttons');
      includes(indexHtml, 'aria-label="Letter guesses"', 'the grid is labelled for screen readers');
    }
  },
  {
    name: '20. the secret word and hint are only ever held in memory',
    fn: async () => {
      // The round (word + hint) lives only in `state.round`. Key material may be
      // remembered, but round data never is — and app.js reaches storage only
      // through BHKeys, never directly.
      noMatch(appCode, /localStorage/, 'app.js must not touch localStorage directly');
      noMatch(appCode, /sessionStorage/, 'app.js must not use sessionStorage');
      noMatch(appCode, /indexedDB/, 'app.js must not use IndexedDB');
      noMatch(appCode, /document\.cookie/, 'app.js must not use cookies');
      noMatch(appCode, /console\.(log|warn|error|info)/, 'the secret must never be logged');
      noMatch(appCode, /setItem\(\s*[^)]*round/, 'the round must never be written to storage');
      includes(appCode, 'round: null', 'the round is an in-memory field');

      // key-management.js deliberately remembers the key pair so the player does
      // not set it up again each visit — but never the secret word or hint.
      includes(keyMgmt, "'bh.publicKeyPem'", 'the public key is remembered');
      includes(keyMgmt, "'bh.fingerprint'", 'the public fingerprint is remembered');
      includes(keyMgmt, "'bh.privateKeyPkcs8'", 'the private key is remembered for convenience');
      match(keyMgmtCode, /s\.setItem\(STORAGE_KEYS\.publicKeyPem/, 'the public key is persisted on purpose');
      match(keyMgmtCode, /s\.setItem\(STORAGE_KEYS\.privateKeyB64/, 'the private key is persisted on purpose');
      noMatch(keyMgmtCode, /round|word|hint/i, 'key-management.js must not touch round data');
      noMatch(keyMgmtCode, /fetch\(|XMLHttpRequest|sendBeacon/, 'key material never leaves the origin');
    }
  },
  {
    name: '21. the game never renders unrevealed letters into the page',
    fn: async () => {
      const round = L.createRound({ word: 'HIDDENWORD' });
      const tiles = L.renderWord(round);
      eq(tiles.filter(function (t) { return t.revealed; }).length, 0, 'nothing is revealed at the start');
      eq(tiles.map(function (t) { return t.char; }).join(''), '', 'no characters are handed to the renderer yet');
      L.guess(round, 'H');
      const after = L.renderWord(round);
      eq(after.filter(function (t) { return t.revealed; }).length, 1, 'only the guessed letter appears');
      includes(appJs, 'Only revealed characters are ever written into the DOM', 'the renderer documents this rule');
    }
  },
  {
    name: '22. no app file requests anything from the network',
    fn: async () => {
      const files = [
        'app/index.html', 'app/styles.css', 'app/app.js', 'app/crypto.js',
        'app/game-logic.js', 'app/key-management.js', 'app/default-keys.js',
        'app/service-worker.js', 'app/manifest.json', 'app/assets/icon.svg'
      ];

      files.forEach(function (file) {
        const source = read(file);
        noMatch(source, /(?:src|href)\s*=\s*["'](?:\/\/|https?:)/i, file + ' must not load an external resource');
        noMatch(source, /@import\s+(?:url\()?["']?(?:\/\/|https?:)/i, file + ' must not @import a remote stylesheet');
        noMatch(source, /url\(\s*["']?(?:\/\/|https?:)/i, file + ' must not reference a remote URL in CSS');
      });

      const manifest = JSON.parse(read('app/manifest.json'));
      eq(manifest.start_url, './index.html', 'the manifest uses a relative start URL (GitHub Pages friendly)');
      eq(manifest.scope, './', 'the manifest uses a relative scope');
      match(manifest.icons[0].src, /^(?:\.\/)?[\w.-]+\/[\w.-]+\.svg$/, 'icons are relative');

      match(read('app/app.js'), /navigator\.serviceWorker\.register\('service-worker\.js'\)/, 'the service worker is registered with a relative path');
    }
  },
  {
    name: '23. the game refuses to run crypto without a secure context and says so',
    fn: async () => {
      includes(appJs, 'showEnvironmentWarning', 'there is a visible warning path');
      includes(appJs, 'C.isAvailable()', 'Web Crypto availability is checked before use');
      match(appJs, /Web Crypto is only available on https:\/\/ or http:\/\/localhost/, 'the warning explains the file:// restriction');
      includes(indexHtml, 'id="env-warning"', 'the warning element exists');
      includes(indexHtml, 'start-game.bat', 'the page points at the launcher');
    }
  },
  {
    name: '24. the launcher serves localhost only and needs no admin rights or downloads',
    fn: async () => {
      const bat = read('start-game.bat');
      includes(bat, '127.0.0.1', 'bound to loopback');
      includes(bat, '-m http.server', 'uses the Python standard library server');
      includes(bat, 'tools\\serve.js', 'offers the Node.js fallback');
      noMatch(bat, /runas/i, 'must not request administrator rights');
      noMatch(bat, /(?:pip|npm)\s+install/i, 'must not download packages');
      noMatch(bat, /\b0\.0\.0\.0\b/, 'must not bind to all interfaces');
      includes(bat, 'netstat', 'checks for port conflicts');
    }
  },
  {
    name: '25. required PWA and offline files are present',
    fn: async () => {
      ['app/manifest.json', 'app/service-worker.js', 'app/assets/icon.svg', 'app/default-keys.js'].forEach(function (file) {
        ok(read(file).length > 0, file + ' must exist and not be empty');
      });
      includes(indexHtml, 'rel="manifest"', 'the manifest is linked');
      includes(indexHtml, 'name="theme-color"', 'a theme colour is declared');
      includes(indexHtml, 'aria-labelledby="hangman-title hangman-desc"', 'the illustration is described for screen readers');
      includes(indexHtml, '<title id="hangman-title">', 'the illustration has a title');
      // The single-app layout must not leave the old encryptor folder behind.
      eq(exists('encryptor'), false, 'the old encryptor/ folder must be gone');
    }
  },
  {
    name: '26. every element app.js looks up exists in the page and is cached up front',
    fn: async () => {
      // A missing id (or a missing entry in cacheElements) makes init() throw
      // before any listeners are attached, which silently kills every button.
      const pageIds = new Set((indexHtml.match(/\bid="([^"]+)"/g) || []).map(function (s) {
        return s.replace(/id="|"/g, '');
      }));

      const arrStart = appJs.indexOf('[', appJs.indexOf('function cacheElements()'));
      const arrEnd = appJs.indexOf(']', arrStart);
      eq(arrStart > -1 && arrEnd > arrStart, true, 'the cached-element list must be readable');
      const cached = new Set((appJs.slice(arrStart, arrEnd).match(/'[a-z0-9-]+'/g) || []).map(function (s) {
        return s.replace(/'/g, '');
      }));

      const referenced = new Set((appCode.match(/el\['([^']+)'\]/g) || []).map(function (s) {
        return s.replace(/el\['|'\]/g, '');
      }));
      ok(referenced.size > 20, 'the audit should find the element references');

      referenced.forEach(function (id) {
        ok(cached.has(id), "el['" + id + "'] is used but not listed in cacheElements()");
        ok(pageIds.has(id), "el['" + id + "'] is used but index.html has no id=\"" + id + '"');
      });

      // Direct getElementById lookups must also resolve.
      (appCode.match(/\$\('([^']+)'\)/g) || []).forEach(function (s) {
        const id = s.replace(/\$\('|'\)/g, '');
        ok(pageIds.has(id), 'index.html must contain id="' + id + '"');
      });

      // And the two lists must not silently drift apart the other way round.
      cached.forEach(function (id) {
        ok(pageIds.has(id), 'cacheElements() lists "' + id + '" but index.html has no such id');
      });
    }
  },
  {
    name: '27. a word can be started locally, with no key and no payload',
    fn: async () => {
      ['manual-word', 'manual-hint', 'btn-manual-start', 'manual-status'].forEach(function (id) {
        includes(indexHtml, 'id="' + id + '"', 'index.html must offer ' + id);
      });

      includes(appCode, 'function handleManualStart()', 'a manual-start handler exists');
      includes(
        appCode,
        "el['btn-manual-start'].addEventListener('click', handleManualStart)",
        'the Start game button is wired'
      );

      const block = appCode.slice(
        appCode.indexOf('function handleManualStart()'),
        appCode.indexOf('function handleImport()')
      );
      includes(block, 'L.createRound(', 'local play uses the shared game rules');
      includes(block, 'startRound(', 'the local round is handed to the board');
      noMatch(block, /privateKey/, 'starting a local round must not need a private key');
      noMatch(block, /decryptPayload/, 'a local round must not decrypt anything');
      noMatch(block, /localStorage|sessionStorage/, 'the local word is not persisted');

      // Guessing must never be gated on key material.
      noMatch(
        appCode,
        /round\.status === 'playing' && state\.privateKey/,
        'letter buttons must not require a private key'
      );
      noMatch(appCode, /isAvailable\(\)[\s\S]{0,80}btn-manual-start/, 'local play is not disabled without Web Crypto');

      // A typed phrase yields a genuinely playable round.
      const typed = L.createRound({ word: 'betty bought butter', hint: 'tongue twister' });
      eq(typed.status, 'playing', 'a locally typed phrase starts playable');
      eq(L.remainingKeys(typed).length, 9, 'the distinct guessable letters are counted');
      eq(typed.hint, 'tongue twister', 'the optional hint is kept for the round');
      const played = L.guess(typed, 'b');
      eq(played.result, 'correct', 'the first local guess is scored like any other');
    }
  },
  {
    name: '28. the home screen offers two jobs and swaps the page for each view',
    fn: async () => {
      // Five views, toggled by .hidden. Only the home view is shown on load.
      match(indexHtml, /<section class="view" id="view-home">/, 'the home view is visible on load');
      includes(indexHtml, 'class="view hidden" id="view-play"', 'the play view starts hidden');
      includes(indexHtml, 'class="view hidden" id="view-game"', 'the game view starts hidden');
      includes(indexHtml, 'class="view hidden" id="view-encrypt"', 'the encrypt view starts hidden');
      includes(indexHtml, 'class="view hidden" id="view-keys"', 'the key view starts hidden');

      // The two jobs on the first screen, plus the key settings entry.
      includes(indexHtml, 'id="btn-go-play"', 'the play-a-game option exists');
      includes(indexHtml, 'id="btn-go-encrypt"', 'the generate-a-word option exists');
      includes(indexHtml, 'id="btn-open-keys"', 'the key settings entry exists');

      // Navigation is wired and each job replaces the home screen.
      includes(appCode, 'function showView(', 'a view switcher exists');
      includes(appCode, "VIEWS = ['home', 'play', 'game', 'encrypt', 'keys']", 'every view is listed once');
      includes(appCode, "el['view-' + view]", 'the switcher toggles each view');
      includes(appCode, "showView('home')", 'the back buttons return home');
      includes(appCode, "showView('play')", 'play a game opens the play view');
      includes(appCode, "showView('encrypt')", 'generate a word opens the encrypt view');
      includes(appCode, "showView('game')", 'starting a round replaces the page with the game');
      includes(appCode, "showView('keys')", 'key settings opens the key view');

      [
        "el['btn-go-play'].addEventListener('click'",
        "el['btn-go-encrypt'].addEventListener('click'",
        "el['btn-open-keys'].addEventListener('click'",
        "el['btn-home-from-play'].addEventListener('click'",
        "el['btn-home-from-encrypt'].addEventListener('click'",
        "el['btn-home-from-keys'].addEventListener('click'"
      ].forEach(function (needle) {
        includes(appCode, needle, 'wired: ' + needle);
      });
    }
  },
  {
    name: '29. one key pair runs everything: built-in by default, your own remembered',
    fn: async () => {
      // The app must boot a usable key with no setup: the shipped pair is
      // imported when the player has not saved one of their own.
      includes(appCode, 'function loadBuiltInKey(', 'there is a built-in-key loader');
      includes(appCode, 'window.BH_DEFAULT_KEYS', 'the built-in key comes from default-keys.js');
      includes(appCode, 'C.importPrivateKeyPkcs8(', 'the private half is imported so decryption works');

      // A key the player generated or restored is remembered in this browser and
      // takes priority over the built-in one on later visits.
      includes(appCode, 'function bootKey(', 'there is a key boot path');
      includes(appCode, 'K.loadStoredKey()', 'a saved key is read on start-up');
      includes(appCode, 'function saveKeyLocally(', 'there is a key save path');
      includes(appCode, 'C.exportPrivateKeyPkcs8(', 'the generated private key is exported for storage');
      includes(appCode, 'K.rememberKey(', 'the key is remembered after generate/restore');
      match(appCode, /saveKeyLocally\(privateKey, restored\.publicKeyPem, fingerprint, created\)/, 'a generated key is remembered');
      match(
        appCode,
        /saveKeyLocally\(restored\.privateKey, restored\.publicKeyPem, restored\.fingerprint, restored\.created\)/,
        'a restored backup is remembered'
      );

      // The shipped file carries both halves of the built-in pair.
      const builtIn = read('app/default-keys.js');
      includes(builtIn, 'window.BH_DEFAULT_KEYS', 'the file exports BH_DEFAULT_KEYS');
      includes(builtIn, 'BEGIN PUBLIC KEY', 'the built-in public key is an SPKI PEM');
      includes(builtIn, 'BEGIN PRIVATE KEY', 'the built-in private key is a PKCS#8 PEM');

      // "Use built-in key" drops the saved key and switches back to the default.
      includes(appCode, 'function handleUseDefault(', 'there is a switch-back-to-default path');
      includes(appCode, "el['btn-use-default'].addEventListener('click', handleUseDefault)", 'the built-in-key button is wired');
      includes(appCode, 'K.forgetKey()', 'switching back deletes the saved key');
      includes(indexHtml, 'id="btn-use-default"', 'the use-built-in-key button exists');

      // Changing the pair is offered through generate + restore.
      includes(indexHtml, 'id="btn-generate"', 'the change-key-pair button exists');
      includes(indexHtml, 'Change key pair', 'the generate panel is labelled "Change key pair"');

      // The private key is only ever stored as base64 PKCS#8 under its own key.
      includes(keyMgmt, 'privateKeyB64', 'the private key is stored under its own storage key');
      includes(keyMgmt, 'forgetKey', 'key-management.js exposes a full-forget helper');
    }
  }
];

runAll('Game and offline tests', cases).then(function (result) {
  console.log('\nManual checks that cannot be automated from Node (see README section "Testing"):');
  console.log('  * click each A-Z button and press each key on a real keyboard');
  console.log('  * confirm the seven illustration stages appear in order on screen');
  console.log('  * pull the network cable and finish a round from a decrypted payload');
  if (result.failures.length) {
    console.log('  (' + result.failures.length + ' automated checks failed — fix those first)');
  }
});
