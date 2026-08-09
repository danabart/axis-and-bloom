import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { initializeAppCheck, ReCaptchaV3Provider, getToken as getAppCheckToken } from 'firebase/app-check';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

// C6 -- Firebase App Check (monitoring mode; SECURITY_FINDINGS.md H2/M10).
// Local dev only: import.meta.env.DEV is statically false in a production
// build, so this whole branch -- and the debug-token codepath it enables --
// is dead-code-eliminated from the shipped bundle. Never live in prod.
if (import.meta.env.DEV) {
  // Firebase's documented local-dev hook (no type declaration ships for it).
  // `true` auto-generates a debug token and logs it to the console the
  // first time App Check tries to fetch one -- register that token once in
  // the Firebase console (App Check > Apps > Manage debug tokens) and every
  // later `npm run dev` on this machine authenticates without live reCAPTCHA.
  (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider(import.meta.env.VITE_RECAPTCHA_APPCHECK_SITE_KEY),
  isTokenAutoRefreshEnabled: true,
});

export const auth = getAuth(app);
export const firestore = getFirestore(app, 'axis-bloom-fs');

// C6 -- attach the App Check token to every call to our own backend, via a
// global fetch() wrapper rather than a change to lib/api.ts's getHeaders().
// Only ~20 of the ~100 real /api/* call sites in this app actually go
// through api.ts -- the rest call fetch() directly from components. This is
// the SINGLE place that sets X-Firebase-AppCheck; api.ts deliberately does
// not, so it's never double-added. No axios/XHR usage anywhere in the
// frontend (confirmed by grep before writing this), so wrapping fetch alone
// gives full coverage.
//
// Installed synchronously, immediately after initializeAppCheck() above --
// before any component has mounted or fired a request -- so nothing can
// race past it unwrapped.
//
// Monitoring mode means this must never throw or block a request: a
// missing/expired/unattested token just means the request goes out with no
// header, and the backend logs-but-allows it while APP_CHECK_ENFORCED=false.
const KNOWN_BACKEND_ORIGINS = new Set(
  [window.location.origin, import.meta.env.VITE_API_URL]
    .filter((value): value is string => Boolean(value))
    .map((value) => {
      try { return new URL(value).origin; } catch { return null; }
    })
    .filter((value): value is string => Boolean(value)),
);

function isBackendApiRequest(input: RequestInfo | URL): boolean {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.origin);
    // Matches today's relative `/api/*` calls (same-origin, the only shape
    // this app actually uses) and any future absolute call straight at the
    // Cloud Run backend origin (VITE_API_URL, set at build time in
    // deploy.yml) -- never a third-party request that merely happens to
    // have an `/api/` path.
    return KNOWN_BACKEND_ORIGINS.has(url.origin) && url.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

const nativeFetch = window.fetch.bind(window);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  if (!isBackendApiRequest(input)) return nativeFetch(input, init);

  let token: string | undefined;
  try {
    token = (await getAppCheckToken(appCheck, /* forceRefresh */ false)).token;
  } catch {
    // Not attested yet, offline, no live reCAPTCHA locally, etc. -- fail
    // open, exactly like the backend does in monitoring mode.
  }
  if (!token) return nativeFetch(input, init);

  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set('X-Firebase-AppCheck', token);
  return nativeFetch(input, { ...init, headers });
};
