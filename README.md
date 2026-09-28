# Secure Notes

A private, encrypted note-taking / diary **PWA** (installable web app). Every
note is stored as a real password-protected `.docx` file, organized into
folders you control, backed up to your own Google Drive, and -- because it's
a web app -- it installs on any phone (including a locked-down work phone
that won't allow sideloaded/unsigned apps) just by visiting the page and
choosing "Add to Home Screen".

## How it works

- **One password unlocks everything.** You're asked for it every time you
  open the app (and again whenever it's backgrounded/hidden -- switching
  tabs, closing the app, locking the phone). It's held in memory only for
  that session (`data/session.ts`), never written to disk, and wiped the
  moment the page is hidden.
- **Each note is its own encrypted `.docx`.** `crypto/agileDocx.ts` +
  `crypto/docxPackage.ts` build a minimal WordprocessingML document and
  encrypt it with **ECMA-376 Agile Encryption** (AES-256) -- the exact same
  scheme Word itself uses for "Encrypt with Password" -- wrapped in a real
  OLE2/CFB container (`crypto/docxFile.ts`, via the well-tested `cfb`
  library). No proprietary format: open it in Word or LibreOffice on any
  PC with the same password, no app required.
- **Two ways to create a note:**
  - **"+ Daily entry"** always opens *today's* entry, filed in the "Daily"
    folder created for you at setup. Just looking at it never creates
    anything -- the file (and its Drive copy) is only written the first
    time you actually type something and leave the editor.
  - **"+ New note"** asks for a title and which folder to file it in
    up front, then opens a blank editor for it -- same lazy-write rule
    applies.
- **Folders** are a real tree you manage from the note list: create,
  rename, move, and delete (only when empty) -- they're mirrored into
  matching nested folders in Drive, too.
- **The note list's metadata** (folder tree, titles, timestamps, Drive
  file ids) is kept in one small AES-256-GCM encrypted index
  (`crypto/metadataCipher.ts`) in IndexedDB, so the app doesn't have to
  decrypt every note just to render the list.
- **The only thing stored unencrypted** is a small vault config: a
  PBKDF2 password *verifier* (a salted hash, not the password itself)
  plus non-secret settings. That's what lets the app say "wrong
  password" instantly without touching any note -- standard practice,
  the same approach password managers use for their KDF header.

## Installing it (PWA)

Open the deployed URL in a mobile browser and use the browser's own
"Add to Home Screen" / "Install app" option (Chrome/Edge on Android show an
install prompt automatically; Safari on iOS: Share → Add to Home Screen).
It then behaves like a normal app -- own icon, own window, works offline
for anything already synced locally -- without ever going through an app
store or needing "install unknown apps" permission, which is exactly what
makes it usable on a locked-down work phone.

## Google Drive integration

Android/iOS have no local-folder-sync mount for Google Drive, so this talks
to the **Drive v3 REST API directly** (`data/driveClient.ts`, plain
`fetch()` -- no heavy client library). Authorization uses **Google Identity
Services'** browser-native token client (`data/driveAuth.ts`) requesting
only the **`drive.file`** scope: access to files this app itself creates,
never your whole Drive.

**Important, honest limitation:** `drive.file` genuinely cannot be scoped
to "one specific folder regardless of who put files there" -- that
granularity doesn't exist in Drive's current API (a real constraint I
verified against Google's own docs, not a shortcut taken here). What it
does guarantee is that this app can never see or touch anything in your
Drive except files it created itself, which in practice is equivalent for
this app's own behavior. See **Backup file** below for the safety net this
implies.

Setup requires you (as the person deploying this) to register a **Web**
OAuth client in Google Cloud Console once:

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and
   create a project (any name).
2. **APIs & Services → Library** → search "Google Drive API" → **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**.
   - Fill in the app name and your email as support/developer contact.
   - Scopes → **Add or Remove Scopes** → search `drive.file` → add it.
   - Test users → **add your own Google account email** (keeps the app in
     "Testing" status, which works indefinitely for you without needing
     Google's app-verification review -- that's only required to remove
     the "unverified app" warning for *other* users).
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized JavaScript origins: the exact origin you deploy to, e.g.
     `https://yourname.github.io` (no path, no trailing slash). Add
     `http://localhost:5173` too if you want Drive to work with `npm run dev`.
   - Create, then copy the **Client ID**.
5. Put that Client ID in `.env.local` (copy `.env.example`) as
   `VITE_GOOGLE_CLIENT_ID`, or set it as a build-time environment variable
   in your hosting provider.

**The first time** you tap "Connect Google Drive", Google shows an
"unverified app" warning -- expected for an app in Testing status. Choose
**Advanced → Go to (your app name)** to continue; safe since it's your own
app and your own Cloud project. Without this env var set, the app works
fully local-only and the Drive button just says it isn't configured.

## Backup file (the real disaster-recovery path)

Because `drive.file` only ever sees files this app created, if you ever
lose access to that grant (revoke it, switch browsers/devices without
re-syncing, etc.) there's no way for the app to "browse back in." The
answer is **Settings → Download vault as zip**: a real zip mirroring your
folder structure, each `.docx` exactly as encrypted as it always was --
openable directly in Word/LibreOffice, or restorable with **Settings →
Restore from zip** (works for your own export, or a zip you make yourself
of the Drive folder via Drive's own "Download" button). Restoring decrypts
with whatever password the vault is currently unlocked with.

## Project layout

```
src/
  crypto/      agileDocx.ts, docxPackage.ts, docxFile.ts, passwordHash.ts,
               metadataCipher.ts, bytes.ts -- pure TS, no Vue/DOM
               dependencies beyond Web Crypto, unit-testable as-is
  data/        db.ts (IndexedDB), session.ts, vault.ts, notes.ts (folders +
               notes + Drive sync orchestration), driveClient.ts,
               driveAuth.ts, zipBackup.ts, types.ts
  composables/ useVault.ts -- wires the data layer to Vue's reactivity
  components/  SetupView, UnlockView, NoteListView, NoteEditorView,
               SettingsView, ModalDialog
  App.vue      top-level state machine + auto-lock-on-hide
```

## Building

```
npm install
npm run dev       # http://localhost:5173
npm test          # unit tests (crypto, vault, notes, folders, zip backup)
npm run build     # -> dist/, a static site (deploy anywhere over HTTPS)
```

`.github/workflows/build.yml` runs typecheck + tests + build on every push
and uploads `dist/` as a downloadable artifact.

## Deploying to bunny.net

`.github/workflows/deploy.yml` builds the app and pushes `dist/` to
bunny.net on every push to `main`. It assumes the storage zone, pull
zone, and DNS are already set up -- the pipeline only ever uploads the
build, it never provisions infrastructure and never purges the CDN
cache (see the note at the end of this section). Set the bunny.net side
up once by hand:

1. **Storage → Add Storage Zone.** Any name/region; this holds the built
   site. Note its **name**, and, under the zone's **FTP & API Access**
   page, its **hostname** (the region's Storage API endpoint, e.g.
   `storage.bunnycdn.com` or a region-prefixed variant) and its
   **password** (full read/write access key -- this is what the pipeline
   authenticates with).
2. **CDN → Add Pull Zone.** Origin type **Storage Zone**, pointed at the
   zone from step 1.
3. On that pull zone, **Hostnames → Add Custom Hostname**, enter your
   domain (or subdomain), and enable **Force SSL** / the free
   Let's-Encrypt-backed certificate. It can't finish issuing until DNS
   (next step) actually resolves to bunny.net, so leave Force SSL off
   until you've confirmed `https://` works.
4. Point your domain at the pull zone in whatever DNS provider you use:
   - **Subdomain** (e.g. `notes.example.com`): a `CNAME` record to the
     pull zone's own hostname (shown on the pull zone as something like
     `your-zone.b-cdn.net`).
   - **Root/apex domain** (e.g. `example.com`): plain `CNAME` records
     aren't valid at the apex per the DNS spec. Either use your DNS
     provider's ALIAS/ANAME equivalent if it has one, or move the
     domain's nameservers to bunny.net (**DNS → Add DNS Zone**) and use
     its `PullZone`-type record there, which links directly to the pull
     zone and works at the apex.
5. Register the Google OAuth client for the domain you just set up (see
   **Google Drive integration** above).
6. Set these in the GitHub repo (**Settings → Secrets and variables →
   Actions**):

   | Name | Value |
   |---|---|
   | `BUNNY_STORAGE_HOSTNAME` | Storage endpoint hostname, from step 1 |
   | `BUNNY_STORAGE_ZONE` | Storage zone name, from step 1 |
   | `BUNNY_STORAGE_ACCESS_KEY` | Storage zone password, from step 1 |
   | `VITE_GOOGLE_CLIENT_ID` | OAuth Client ID, from step 5 -- baked into the build at build time |

7. Push to `main` (or run the `Deploy to bunny.net` workflow manually).

**No automatic cache purge.** The pipeline only uploads to the storage
zone; it doesn't call bunny.net's purge-cache API (that needs an
account-level API key and the pull zone's ID, which the pipeline
otherwise has no reason to hold). This means a deploy can take up to the
pull zone's configured cache TTL to show up on edges that already have
the old files cached -- check **Caching** on the pull zone if you want to
tune that. To force it, purge manually from the pull zone's **Caching →
Purge Cache** button in the dashboard, or `curl -X POST
"https://api.bunny.net/pullzone/<id>/purgeCache" -H "AccessKey:
<account API key>"`.

## How this was validated

Unlike a typical from-memory implementation, the two highest-risk pieces
here were independently verified rather than just asserted:

- **The `.docx` encryption** (`crypto/agileDocx.ts`) was cross-checked
  against **msoffcrypto-tool** -- a Python implementation of the same
  MS-OFFCRYPTO spec, entirely unrelated to this code -- successfully
  decrypting a file this code produced and reading the exact right content
  back, plus correctly rejecting a wrong password. The spin-count key
  derivation runs on a synchronous, audited SHA-512 (`@noble/hashes`)
  rather than `crypto.subtle.digest` directly, because at 100,000
  sequential iterations the latter's async/microtask overhead alone adds
  several seconds of pure overhead with no algorithmic benefit.
- **The whole golden path** was driven end-to-end in a real headless
  Chromium browser (not just unit tests): first-run setup, writing a daily
  entry, creating a folder, creating a titled note inside it, reopening an
  entry without changes (confirming nothing spurious gets written),
  exporting a zip, locking, rejecting a wrong password, unlocking,
  confirming notes/folders survived, and re-importing that zip -- with
  zero console errors throughout. The exported zip's `.docx` files were
  then independently opened by the same Python decoder above.
- 25 unit tests cover the crypto primitives, vault setup/unlock/password
  rotation, folder create/rename/move/delete (including refusing to delete
  a non-empty folder), lazy note creation, and zip export/import.

What could **not** be validated here: the actual Google OAuth consent flow
and live Drive API calls, since that requires a real Google account and a
Cloud Console project only you can create. `driveClient.ts`/`driveAuth.ts`
were written carefully against Drive's documented REST API and Google
Identity Services' documented token-client API, but the connect-and-sync
path is worth testing for real once you've done the Cloud Console setup
above.

## Security notes

- PBKDF2-HMAC-SHA256 with 210,000 iterations for the password verifier and
  for deriving the metadata index's AES key (OWASP's current baseline).
- Each note's actual AES-256 key is derived per-file following the
  ECMA-376 Agile spec (its own salt, its own 100,000-iteration SHA-512
  chain) -- compromising one note's file doesn't help attack another.
- There is intentionally **no password recovery**. Forgetting the master
  password means the notes are unrecoverable, by design.
- Password fields use `autocomplete="new-password"` / `"current-password"`
  correctly so browsers don't offer to save/suggest the master password
  as a generic text-field guess.

## Possible future upgrades

- A background sync (e.g. a periodic Background Sync API registration)
  so notes upload even when the app isn't open, instead of syncing
  opportunistically on save/unlock/"Sync now" as it does today.
- A proper folder-tree UI (drag to move, breadcrumbs beyond the simple
  up-one-level nav here) if the flat "up" navigation feels limiting once
  you have deeper nesting.
- Rich text / Markdown formatting in the editor (notes are plain text
  today, matching the original `.docx` paragraphs-of-plain-text design).
