/*
 * Bitch Hangman — cryptography tests.
 *
 * Covers section 11 "Cryptography tests" of the project brief.
 * Run:  node tests/crypto-tests.js
 *
 * Nothing here touches the disk except to read the source files being audited,
 * and nothing touches the network.
 */
'use strict';

const { runAll, ok, eq, includes, notIncludes, match, noMatch, rejects, loadNamespace, read, code, exists } = require('./harness.js');

const C = loadNamespace('app/crypto.js', 'BHCrypto');
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/* ---------------------------------------------------------------- helpers */

function encrypt(C, pem, secret) {
  return C.encryptForRecipient(pem, secret);
}

/** Strip the BEGIN/END markers off a PEM body and base64-decode it. */
function pemToBytes(pem) {
  const body = String(pem).split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^-----/.test(line))
    .join('');
  return C.b64ToBytes(body);
}

/** Rebuild a payload string from a (possibly tampered) envelope. */
function buildPayload(C, envelope) {
  return C.PAYLOAD_PREFIX + C.bytesToB64url(textEncoder.encode(JSON.stringify(envelope)));
}

function decodeEnvelope(C, payload) {
  const json = textDecoder.decode(C.b64urlToBytes(payload.slice(C.PAYLOAD_PREFIX.length)));
  return JSON.parse(json);
}

function flipFirstCiphertextByte(C, envelope) {
  const ct = C.b64urlToBytes(envelope.ct);
  ct[0] = ct[0] ^ 0xff;
  return Object.assign({}, envelope, { ct: C.bytesToB64url(ct) });
}

let keyPair;       // { publicKey, privateKey, pem, fingerprint }
let otherKeyPair;  // an unrelated key pair, used for negative tests

const cases = [
  {
    name: '1. generateKeyPair produces an RSA-OAEP 3072-bit pair with an exportable private key',
    fn: async () => {
      ok(C.isAvailable(), 'Web Crypto must be available in the test runtime');
      const pair = await C.generateKeyPair();
      ok(pair.publicKey && pair.privateKey, 'both keys must be returned');
      eq(pair.publicKey.algorithm.name, 'RSA-OAEP', 'public key algorithm');
      eq(pair.privateKey.algorithm.name, 'RSA-OAEP', 'private key algorithm');
      eq(pair.publicKey.algorithm.modulusLength, 3072, 'modulus length');
      eq(pair.publicKey.algorithm.hash.name, 'SHA-256', 'hash');
      eq(pair.publicKey.extractable, true, 'public key exportable');
      eq(pair.privateKey.extractable, true, 'private key exportable so it can be backed up');
      match(pair.publicKey.usages.join(','), /encrypt/, 'public key may encrypt');
      match(pair.privateKey.usages.join(','), /decrypt/, 'private key may decrypt');
      keyPair = pair;
    }
  },
  {
    name: '1b. the public key exports to a documented PEM (SPKI) form with a SHA-256 fingerprint',
    fn: async () => {
      keyPair.pem = await C.exportPublicKeyPem(keyPair.publicKey);
      includes(keyPair.pem, '-----BEGIN PUBLIC KEY-----', 'PEM header');
      includes(keyPair.pem, '-----END PUBLIC KEY-----', 'PEM footer');
      keyPair.fingerprint = await C.publicKeyPemFingerprint(keyPair.pem);
      match(keyPair.fingerprint, /^[0-9a-f]{64}$/, 'fingerprint is 64 lowercase hex characters');
      const direct = await C.publicKeyFingerprint(keyPair.publicKey);
      eq(direct, keyPair.fingerprint, 'fingerprint from key object and from PEM must match');
    }
  },
  {
    name: '2. encrypt a single word with the public key and decrypt it with the matching private key',
    fn: async () => {
      const payload = await encrypt(C, keyPair.pem, { word: 'PINEAPPLE' });
      match(payload, /^BHANGMAN1\.[A-Za-z0-9_-]+$/, 'payload is a single, transport-safe token');
      const secret = await C.decryptPayload(payload, keyPair.privateKey, keyPair.fingerprint);
      eq(secret.word, 'PINEAPPLE', 'round-tripped word');
      eq(secret.hint, '', 'no hint was supplied');
      eq(secret.kid, keyPair.fingerprint, 'payload records the recipient key fingerprint');
    }
  },
  {
    name: '3. multi-word phrases survive the round trip',
    fn: async () => {
      const word = 'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG';
      const payload = await encrypt(C, keyPair.pem, { word });
      const secret = await C.decryptPayload(payload, keyPair.privateKey, keyPair.fingerprint);
      eq(secret.word, word, 'phrase round-trip');
    }
  },
  {
    name: '4. punctuation and spaces survive the round trip',
    fn: async () => {
      const word = "It's a trap! Really? 100% sure...";
      const payload = await encrypt(C, keyPair.pem, { word });
      const secret = await C.decryptPayload(payload, keyPair.privateKey, keyPair.fingerprint);
      eq(secret.word, word, 'punctuation round-trip');
    }
  },
  {
    name: '5. the hint is recovered correctly (including a multi-word hint)',
    fn: async () => {
      const payload = await encrypt(C, keyPair.pem, { word: 'SOMETHING', hint: 'a film from 1999' });
      const secret = await C.decryptPayload(payload, keyPair.privateKey, keyPair.fingerprint);
      eq(secret.hint, 'a film from 1999', 'hint round-trip');
    }
  },
  {
    name: '6. every payload uses a fresh AES key and IV (no reuse between submissions)',
    fn: async () => {
      const a = decodeEnvelope(C, await encrypt(C, keyPair.pem, { word: 'SAME' }));
      const b = decodeEnvelope(C, await encrypt(C, keyPair.pem, { word: 'SAME' }));
      ok(a.iv !== b.iv, 'IVs must differ');
      ok(a.wrapped !== b.wrapped, 'wrapped AES keys must differ');
      ok(a.ct !== b.ct, 'ciphertexts must differ for identical plaintext');
    }
  },
  {
    name: '7. a wrong private key cannot decrypt the payload',
    fn: async () => {
      const payload = await encrypt(C, keyPair.pem, { word: 'SECRET' });
      otherKeyPair = await C.generateKeyPair();
      await rejects(() => C.decryptPayload(payload, otherKeyPair.privateKey, keyPair.fingerprint), 'DECRYPT_FAILED');
      await rejects(() => C.decryptPayload(payload, otherKeyPair.privateKey, null), 'DECRYPT_FAILED');
    }
  },
  {
    name: '8. modified ciphertext fails authentication (AES-GCM tag)',
    fn: async () => {
      const payload = await encrypt(C, keyPair.pem, { word: 'TAMPER ME' });
      const tampered = buildPayload(C, flipFirstCiphertextByte(C, decodeEnvelope(C, payload)));
      await rejects(() => C.decryptPayload(tampered, keyPair.privateKey, keyPair.fingerprint), 'DECRYPT_FAILED');
    }
  },
  {
    name: '9. modified wrapped key and modified IV are rejected',
    fn: async () => {
      const payload = await encrypt(C, keyPair.pem, { word: 'TAMPER ME TOO' });
      const envelope = decodeEnvelope(C, payload);

      const wrappedBytes = C.b64urlToBytes(envelope.wrapped);
      wrappedBytes[0] = wrappedBytes[0] ^ 0x01;
      const badWrapped = buildPayload(C, Object.assign({}, envelope, { wrapped: C.bytesToB64url(wrappedBytes) }));
      await rejects(() => C.decryptPayload(badWrapped, keyPair.privateKey, keyPair.fingerprint), 'DECRYPT_FAILED');

      const ivBytes = C.b64urlToBytes(envelope.iv);
      ivBytes[11] = ivBytes[11] ^ 0x01;
      const badIv = buildPayload(C, Object.assign({}, envelope, { iv: C.bytesToB64url(ivBytes) }));
      await rejects(() => C.decryptPayload(badIv, keyPair.privateKey, keyPair.fingerprint), 'DECRYPT_FAILED');
    }
  },
  {
    name: '10. malformed payloads are rejected before any crypto work',
    fn: async () => {
      await rejects(() => C.parsePayload(''), 'PAYLOAD_FORMAT');
      await rejects(() => C.parsePayload('hello there'), 'PAYLOAD_FORMAT');
      await rejects(() => C.parsePayload('BHANGMAN1.@@@@'), 'PAYLOAD_FORMAT');
      // Valid base64url that is not valid JSON once decoded.
      await rejects(() => C.parsePayload('BHANGMAN1.' + C.bytesToB64url(textEncoder.encode('not json'))), 'PAYLOAD_JSON');
      // Wrong prefix family entirely.
      await rejects(() => C.parsePayload('BHANGMAN9.abc'), 'PAYLOAD_FORMAT');
      await rejects(() => C.parsePayload('{"v":1}'), 'INVALID_FIELD');
    }
  },
  {
    name: '11. unsupported payload versions are rejected',
    fn: async () => {
      const payload = await encrypt(C, keyPair.pem, { word: 'FUTURE' });
      const envelope = decodeEnvelope(C, payload);
      const v2 = buildPayload(C, Object.assign({}, envelope, { v: 2 }));
      await rejects(() => C.parsePayload(v2), 'UNSUPPORTED_VERSION');
      await rejects(() => C.decryptPayload(v2, keyPair.privateKey, keyPair.fingerprint), 'UNSUPPORTED_VERSION');
    }
  },
  {
    name: '12. algorithm identifiers in the envelope are validated',
    fn: async () => {
      const payload = await encrypt(C, keyPair.pem, { word: 'ALGOS' });
      const envelope = decodeEnvelope(C, payload);
      const downgraded = buildPayload(C, Object.assign({}, envelope, {
        alg: { kek: 'RSA-OAEP-3072/SHA-1', dek: 'AES-128-CBC', enc: 'base64' }
      }));
      await rejects(() => C.parsePayload(downgraded), 'INVALID_FIELD');
    }
  },
  {
    name: '13. field lengths are validated (missing AES key, bad IV length, oversized payload)',
    fn: async () => {
      const payload = await encrypt(C, keyPair.pem, { word: 'LENGTHS' });
      const envelope = decodeEnvelope(C, payload);

      await rejects(() => C.parsePayload(buildPayload(C, Object.assign({}, envelope, { wrapped: '' }))), 'INVALID_FIELD');
      await rejects(() => C.parsePayload(buildPayload(C, Object.assign({}, envelope, { iv: C.bytesToB64url(new Uint8Array(8)) }))), 'INVALID_FIELD');
      await rejects(() => C.parsePayload(buildPayload(C, Object.assign({}, envelope, { ct: C.bytesToB64url(new Uint8Array(4)) }))), 'INVALID_FIELD');
      await rejects(() => C.parsePayload(buildPayload(C, Object.assign({}, envelope, { kid: 'not-hex' }))), 'INVALID_FIELD');
      await rejects(() => C.parsePayload('BHANGMAN1.' + 'A'.repeat(40000)), 'PAYLOAD_TOO_LARGE');
    }
  },
  {
    name: '14. the recipient key fingerprint is checked against the loaded key',
    fn: async () => {
      const payload = await encrypt(C, keyPair.pem, { word: 'ADDRESSED' });
      await rejects(() => C.decryptPayload(payload, keyPair.privateKey, 'deadbeef'.repeat(8)), 'KID_MISMATCH');
      // Decrypting without an expected fingerprint still works.
      const secret = await C.decryptPayload(payload, keyPair.privateKey, null);
      eq(secret.word, 'ADDRESSED', 'decrypt without an expected fingerprint');
    }
  },
  {
    name: '15. describePayload exposes only non-secret metadata',
    fn: async () => {
      const payload = await encrypt(C, keyPair.pem, { word: 'METADATA', hint: 'hidden hint' });
      const meta = C.describePayload(payload);
      eq(meta.version, 1, 'version');
      eq(meta.kid, keyPair.fingerprint, 'kid');
      notIncludes(JSON.stringify(meta), 'METADATA', 'no plaintext word in the metadata');
      notIncludes(JSON.stringify(meta), 'hidden hint', 'no plaintext hint in the metadata');
    }
  },
  {
    name: '16. decrypting requires a private key (empty word and missing key are rejected)',
    fn: async () => {
      const payload = await encrypt(C, keyPair.pem, { word: 'NEEDS KEY' });
      await rejects(() => C.decryptPayload(payload, null, null), 'NO_PRIVATE_KEY');
      await rejects(() => C.encryptForRecipient(keyPair.pem, { word: '   ' }), 'EMPTY_WORD');
      await rejects(() => C.encryptForRecipient('', { word: 'ANY' }), 'MISSING_PUBLIC_KEY');
      await rejects(() => C.encryptForRecipient('not a pem', { word: 'ANY' }), 'INVALID_PUBLIC_KEY');
      await rejects(() => C.encryptForRecipient(keyPair.pem, { word: 'x'.repeat(C.MAX_WORD_LENGTH + 1) }), 'WORD_TOO_LONG');
    }
  },
  {
    name: '17. the secret word and hint never appear in the payload (even as raw bytes)',
    fn: async () => {
      const word = 'ZQXJKWVB';
      const hint = 'UNLIKELYHINTTEXT';
      const payload = await encrypt(C, keyPair.pem, { word, hint });
      const envelope = decodeEnvelope(C, payload);
      const decoded = textDecoder.decode(C.b64urlToBytes(envelope.ct));
      const decodedKey = textDecoder.decode(C.b64urlToBytes(envelope.wrapped));

      notIncludes(payload, word, 'transport string');
      notIncludes(JSON.stringify(envelope), word, 'envelope JSON');
      notIncludes(decoded, word, 'ciphertext bytes');
      notIncludes(decodedKey, word, 'wrapped key bytes');
      notIncludes(JSON.stringify(envelope), 'PRIVATE KEY', 'no private key material');
      ok(!('hint' in envelope), 'the envelope must not carry a hint field');
      ok(!('word' in envelope), 'the envelope must not carry a word field');
    }
  },
  {
    name: '18. the built-in default key pair is a real, matching RSA-OAEP pair',
    fn: async () => {
      const builtIn = loadNamespace('app/default-keys.js', 'BH_DEFAULT_KEYS');
      ok(builtIn && typeof builtIn === 'object', 'BH_DEFAULT_KEYS must be exported');
      match(builtIn.publicKeyPem, /^-----BEGIN PUBLIC KEY-----/, 'the built-in public key is an SPKI PEM');
      match(builtIn.publicKeyPem, /-----END PUBLIC KEY-----\s*$/, 'the public PEM must be properly terminated');
      match(builtIn.privateKeyPem, /^-----BEGIN PRIVATE KEY-----/, 'the built-in private key is a PKCS#8 PEM');

      const fingerprint = await C.publicKeyPemFingerprint(builtIn.publicKeyPem);
      match(fingerprint, /^[0-9a-f]{64}$/, 'the built-in key has a SHA-256 fingerprint');

      // The public half must import and the private half must decrypt what it
      // sealed — that is what proves the two shipped halves belong together.
      await C.importPublicKeyPem(builtIn.publicKeyPem);
      const privateKey = await C.importPrivateKeyPkcs8(pemToBytes(builtIn.privateKeyPem));
      const payload = await C.encryptForRecipient(builtIn.publicKeyPem, { word: 'ZERO SETUP', hint: 'built in' });
      eq(C.describePayload(payload).kid, fingerprint, 'the payload targets the built-in key');
      const secret = await C.decryptPayload(payload, privateKey, fingerprint);
      eq(secret.word, 'ZERO SETUP', 'the built-in private key reads the built-in public key');
      eq(secret.hint, 'built in', 'the hint round-trips through the built-in pair');
    }
  },
  {
    name: '19. a single crypto core and a single built-in key file ship with the app',
    fn: async () => {
      // The old two-app layout (a separate public-only encryptor) is gone.
      eq(exists('encryptor'), false, 'the encryptor/ folder must not exist');
      eq(exists('game'), false, 'the old game/ folder must not exist');

      const core = code('app/crypto.js');
      match(core, /root\.BHCrypto\s*=\s*\{/, 'the shared core exports BHCrypto exactly once');

      // index.html loads exactly one crypto core and one default-keys file.
      const html = read('app/index.html');
      includes(html, '<script src="crypto.js"></script>', 'the page loads the shared crypto core');
      includes(html, '<script src="default-keys.js"></script>', 'the page loads the built-in keys');
      noMatch(html, /encryptor\//, 'the page must not reference the removed encryptor');

      // The built-in key file must be inert: keys only, no storage or network.
      const builtIn = code('app/default-keys.js');
      noMatch(builtIn, /localStorage|fetch\(|XMLHttpRequest|sendBeacon/, 'the key file must be passive data');
    }
  },
  {
    name: '20. a payload made for the built-in key cannot be read with another key',
    fn: async () => {
      const builtIn = loadNamespace('app/default-keys.js', 'BH_DEFAULT_KEYS');
      const builtInFingerprint = await C.publicKeyPemFingerprint(builtIn.publicKeyPem);
      const payload = await C.encryptForRecipient(builtIn.publicKeyPem, { word: 'ISOLATED' });

      // The unrelated test key is refused, and so is a key that only knows the
      // built-in fingerprint but not its private half.
      await rejects(() => C.decryptPayload(payload, otherKeyPair.privateKey, builtInFingerprint), 'DECRYPT_FAILED');
      await rejects(() => C.decryptPayload(payload, otherKeyPair.privateKey, null), 'DECRYPT_FAILED');
      await rejects(() => C.decryptPayload(payload, keyPair.privateKey, builtInFingerprint), 'DECRYPT_FAILED');
    }
  },
  {
    name: '21. a private-key backup round-trips and rejects the wrong passphrase',
    fn: async () => {
      const passphrase = 'correct horse battery staple';
      const backup = await C.createKeyBackup({
        privateKey: keyPair.privateKey,
        publicKey: keyPair.publicKey,
        passphrase
      });

      eq(backup.type, C.BACKUP_TYPE, 'backup type');
      eq(backup.v, C.BACKUP_VERSION, 'backup version');
      eq(backup.kdf.iterations, C.PBKDF2_ITERATIONS, 'PBKDF2 iterations');
      notIncludes(backup.data, 'PRIVATE', 'the backup holds ciphertext, not a readable key');

      const text = C.serializeBackup(backup);
      const restored = await C.restoreKeyBackup(text, passphrase);
      eq(restored.fingerprint, keyPair.fingerprint, 'restored key fingerprint');

      // The restored key must actually decrypt for this recipient.
      const payload = await encrypt(C, backup.publicKeyPem, { word: 'RESTORED' });
      const secret = await C.decryptPayload(payload, restored.privateKey, restored.fingerprint);
      eq(secret.word, 'RESTORED', 'payload decrypted with the restored key');

      await rejects(() => C.restoreKeyBackup(text, 'wrong passphrase entirely'), 'BAD_PASSPHRASE');
      await rejects(() => C.restoreKeyBackup('{"type":"SOMETHING ELSE","v":1}', passphrase), 'BACKUP_FORMAT');
      await rejects(() => C.restoreKeyBackup(text, ''), 'BAD_PASSPHRASE');
    }
  },
  {
    name: '22. weak and mismatched backup passphrases are refused',
    fn: async () => {
      await rejects(() => C.checkPassphrase('short'), 'WEAK_PASSPHRASE');
      await rejects(() => C.checkPassphrase('longenoughpassword', 'differentpassword'), 'PASSPHRASE_MISMATCH');
      eq(C.checkPassphrase('longenoughpassword', 'longenoughpassword'), 'longenoughpassword', 'valid passphrase accepted');
    }
  },
  {
    name: '23. the crypto core uses secure randomness and no insecure primitives',
    fn: async () => {
      ['app/crypto.js'].forEach((file) => {
        const source = code(file);
        noMatch(source, /Math\.random/, file + ' must not use Math.random()');
        noMatch(source, /\beval\s*\(/, file + ' must not use eval');
        match(source, /crypto\.getRandomValues/, file + ' must use crypto.getRandomValues');
        match(source, /crypto\.subtle/, file + ' must use crypto.subtle');
      });
    }
  },
  {
    name: '24. the crypto core is exactly one shared module',
    fn: async () => {
      ok(read('app/crypto.js').length > 0, 'app/crypto.js must exist');
      // There is only one copy now that the encryptor was merged in.
      eq(exists('encryptor/crypto.js'), false, 'no duplicate crypto core may remain');
      eq(exists('game/crypto.js'), false, 'the old game/ copy must be gone');
    }
  },
  {
    name: '25. the crypto and app modules perform no network access',
    fn: async () => {
      ['app/crypto.js', 'app/game-logic.js', 'app/key-management.js', 'app/app.js',
       'app/default-keys.js'].forEach((file) => {
        const source = code(file);
        noMatch(source, /\bfetch\s*\(/, file + ' must not call fetch()');
        noMatch(source, /XMLHttpRequest/, file + ' must not use XMLHttpRequest');
        noMatch(source, /WebSocket/, file + ' must not open a WebSocket');
        noMatch(source, /EventSource/, file + ' must not use EventSource');
        noMatch(source, /sendBeacon/, file + ' must not use sendBeacon(');
        noMatch(source, /importScripts/, file + ' must not import remote scripts');
      });
    }
  },
  {
    name: '26. the service worker only ever caches same-origin files',
    fn: async () => {
      const source = code('app/service-worker.js');
      includes(source, 'url.origin !== self.location.origin', 'must ignore other origins explicitly');
      noMatch(source, /["'`]https?:\/\//, 'service worker must not contain absolute URLs');
      match(source, /caches\.open\(CACHE_NAME\)/, 'must use a named cache');
      includes(source, "request.method !== 'GET'", 'must only handle GET requests');
      includes(source, './default-keys.js', 'the built-in key file is part of the cached shell');
    }
  }
];

runAll('Cryptography tests', cases).then((result) => {
  if (result.failures.length) {
    console.log('\nNotes: the "wrong key", "tamper" and "version" cases are expected to fail loudly — a payload that');
    console.log('carries no clear error is a bug, not a pass.\n');
  }
});
