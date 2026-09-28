<script setup lang="ts">
defineEmits<{ "get-started": [] }>();
</script>

<template>
  <div class="landing">
    <header class="hero">
      <img src="/icons/icon.svg" alt="" class="hero-icon" width="64" height="64" />
      <h1>Secure Notes</h1>
      <p class="tagline">A private diary that lives in real, password-protected Word files -- not in someone else's database.</p>

      <button type="button" class="btn btn-block hero-cta" @click="$emit('get-started')">Get started</button>
      <p class="hero-sub">Free, no account required. Your notes never leave your control.</p>
    </header>

    <main class="screen-body landing-body">
      <section class="section">
        <h2>How it works</h2>
        <div class="cards">
          <div class="card">
            <div class="card-icon">🔑</div>
            <h3>One password</h3>
            <p>Pick a master password once. It unlocks every note, and locks itself again the moment you switch away.</p>
          </div>
          <div class="card">
            <div class="card-icon">📝</div>
            <h3>Write freely</h3>
            <p>A "Daily entry" button for journaling, or "New note" for anything else, filed into folders you organize.</p>
          </div>
          <div class="card">
            <div class="card-icon">📄</div>
            <h3>Real .docx files</h3>
            <p>Every note is saved as an actual password-protected Word document -- openable in Word or LibreOffice, no lock-in.</p>
          </div>
          <div class="card">
            <div class="card-icon">☁️</div>
            <h3>Your own Drive</h3>
            <p>Optionally back up to your own Google Drive. Nothing is ever sent anywhere else.</p>
          </div>
        </div>
      </section>

      <section class="section">
        <h2>Why it's secure</h2>
        <p class="section-intro">
          Notes are encrypted on your device before they're ever saved -- the server (or your Drive) only ever sees
          ciphertext.
        </p>
        <ul class="security-list">
          <li>
            <strong>Real Office encryption.</strong> Notes use the same <code>ECMA-376 Agile Encryption</code> (AES-256)
            scheme Word itself uses for "Encrypt with Password" -- not a custom format, so it's independently
            verifiable and works with tools you already trust.
          </li>
          <li>
            <strong>Strong password hardening.</strong> Your master password is stretched with
            <code>PBKDF2-HMAC-SHA256</code> at 210,000 iterations (OWASP's current baseline) before it's used for
            anything, and each note additionally derives its own per-file key.
          </li>
          <li>
            <strong>Nothing sensitive stored in the clear.</strong> Only a salted password <em>verifier</em> is kept
            unencrypted -- enough to say "wrong password" instantly, never enough to recover it.
          </li>
          <li>
            <strong>Session-only key material.</strong> Your password lives in memory for the current session only,
            never written to disk, and is wiped the instant the app is hidden or backgrounded.
          </li>
          <li>
            <strong>Least-privilege Drive access.</strong> Backup uses Google's narrow <code>drive.file</code> scope,
            so the app can only ever see files it created itself -- never the rest of your Drive.
          </li>
        </ul>
      </section>

      <section class="section">
        <h2>Open source</h2>
        <p>
          Every line of this app is public -- read the code, audit the crypto, or run your own copy. Nothing here
          relies on you trusting a closed server.
        </p>
        <a class="btn btn-secondary" href="https://github.com/benstrobel/secure-notes" target="_blank" rel="noopener noreferrer">
          View on GitHub
        </a>
      </section>

      <section class="section section-cta">
        <button type="button" class="btn btn-block hero-cta" @click="$emit('get-started')">Get started</button>
      </section>
    </main>
  </div>
</template>

<style scoped>
.landing {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.hero {
  text-align: center;
  padding: 3rem 1.5rem 2rem;
  max-width: 480px;
  width: 100%;
  margin: 0 auto;
}

.hero-icon {
  border-radius: 16px;
}

.hero h1 {
  margin: 0.75rem 0 0.4rem;
  font-size: 2rem;
}

.tagline {
  color: var(--ink-light);
  font-size: 1.05rem;
  line-height: 1.5;
  margin: 0 0 1.75rem;
}

.hero-cta {
  font-size: 1.05rem;
  padding: 0.9rem 1.5rem;
}

.hero-sub {
  margin: 0.75rem 0 0;
  font-size: 0.85rem;
  color: #7a7568;
}

.landing-body {
  max-width: 640px;
}

.section {
  margin: 2.5rem 0;
}

.section h2 {
  font-size: 1.3rem;
  margin: 0 0 1rem;
}

.section-intro {
  color: var(--ink-light);
  margin-top: 0;
}

.cards {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
}

@media (max-width: 480px) {
  .cards {
    grid-template-columns: 1fr;
  }
}

.card {
  border: 1.5px solid var(--border);
  border-radius: 12px;
  padding: 1rem;
  background: white;
}

.card-icon {
  font-size: 1.4rem;
}

.card h3 {
  font-size: 1rem;
  margin: 0.4rem 0 0.3rem;
}

.card p {
  margin: 0;
  font-size: 0.88rem;
  color: var(--ink-light);
  line-height: 1.4;
}

.security-list {
  padding-left: 1.1rem;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.security-list li {
  line-height: 1.5;
  font-size: 0.94rem;
}

.security-list code {
  background: var(--paper-dim);
  border-radius: 4px;
  padding: 0.1rem 0.3rem;
  font-size: 0.85em;
}

.section-cta {
  max-width: 420px;
  margin-left: auto;
  margin-right: auto;
}
</style>
