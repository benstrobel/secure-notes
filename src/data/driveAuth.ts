// Wraps Google Identity Services' token client (the browser-native OAuth
// flow for client-side web apps -- no backend, no client secret) to get a
// short-lived access token scoped to drive.file: access only to files this
// app itself creates, never the rest of the user's Drive.
//
// Requires a Web OAuth Client ID registered in Google Cloud Console with
// this app's deployed origin as an authorized JavaScript origin -- see
// README.md. Configured via the VITE_GOOGLE_CLIENT_ID build-time env var.

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string; expires_in?: number }) => void;
            error_callback?: (error: { type?: string; message?: string }) => void;
          }): { requestAccessToken(opts?: { prompt?: string }): void };
        };
      };
    };
  }
}

let scriptLoadPromise: Promise<void> | null = null;

// GIS never persists a token for us -- without this cache, every call site
// (autosave, background sync, delete) would re-ask Google for a token on
// every single action. Re-asking silently (prompt: "none") turned out to be
// unreliable in practice (likely third-party-cookie blocking): it can pop a
// window that opens and immediately closes, and on a standalone mobile PWA
// that appears to reload the whole app instead of behaving like a popup,
// wiping the unlocked session. So a silent request now only ever returns an
// already-cached token -- it never itself triggers a live GIS round-trip.
let cachedToken: { token: string; expiresAt: number } | null = null;

function loadGisScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;
  scriptLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity Services"));
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

export function isDriveConfigured(): boolean {
  return Boolean(CLIENT_ID);
}

/**
 * Requests a Drive access token. With `promptIfNeeded: false`, returns an
 * already-cached token or null -- never makes a live request -- used for
 * silent background sync. With `promptIfNeeded: true`, makes a live request
 * (showing Google's consent/account-chooser UI only if actually needed);
 * this must be called from a real user gesture, e.g. a button click.
 */
export async function getAccessToken(promptIfNeeded: boolean): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  if (!promptIfNeeded) return null;

  if (!CLIENT_ID) throw new Error("VITE_GOOGLE_CLIENT_ID is not configured -- see README.md");
  await loadGisScript();

  // If the popup is closed (by the user, by GIS itself, or by the OS on a
  // mobile PWA) without a completed grant, GIS doesn't reliably invoke
  // either callback below in every version/browser -- observed in practice
  // as "Syncing..." never resolving. The timeout guarantees this always
  // settles one way or another.
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Drive authorization timed out"));
    }, 60_000);

    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: DRIVE_FILE_SCOPE,
      callback: (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (response.access_token) {
          const expiresInMs = (response.expires_in ?? 3600) * 1000;
          cachedToken = { token: response.access_token, expiresAt: Date.now() + expiresInMs - 60_000 };
          resolve(response.access_token);
        } else {
          reject(new Error(response.error ?? "Drive authorization failed"));
        }
      },
      error_callback: (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error(error.message ?? error.type ?? "Drive authorization failed"));
      },
    });
    client.requestAccessToken({ prompt: "" });
  });
}
