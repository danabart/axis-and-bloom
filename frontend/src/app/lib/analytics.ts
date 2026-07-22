// Site-wide GA4 + Meta Pixel wiring, env-driven (VITE_GA4_ID / VITE_META_PIXEL_ID).
// No-ops cleanly — no script tags, no network calls — when an ID is unset, so local
// dev/preview builds stay clean by default.
//
// Consent: `consentGranted` defaults to whatever was last stored locally, or `false` if
// no choice has been made yet — nothing fires until the ConsentBanner (launch/30_compliance)
// records an explicit accept via `setAnalyticsConsent()`.

const GA4_ID = import.meta.env.VITE_GA4_ID as string | undefined;
const META_PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID as string | undefined;

const CONSENT_STORAGE_KEY = 'axisbloom.analyticsConsent';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void; queue?: unknown[]; loaded?: boolean; version?: string };
    _fbq?: unknown;
  }
}

function readStoredConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Has the visitor already made a choice? Drives whether ConsentBanner renders itself. */
export function hasStoredConsentChoice(): boolean {
  try {
    return localStorage.getItem(CONSENT_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

let consentGranted = readStoredConsent();
let initialized = false;

function loadGa4() {
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer!.push(arguments); };
  window.gtag('js', new Date());
  // send_page_view: false — this is an SPA, page views are fired manually on every
  // route change (see trackPageView / App.tsx), not just on the initial script load.
  window.gtag('config', GA4_ID, { send_page_view: false });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`;
  document.head.appendChild(script);
}

function loadMetaPixel() {
  // Standard Meta Pixel base code, inlined (no behavior change from Meta's own snippet).
  const f = window as Window & { fbq?: any; _fbq?: any };
  if (f.fbq) return;
  const n: any = (f.fbq = function (...args: unknown[]) {
    n.callMethod ? n.callMethod(...args) : n.queue.push(args);
  });
  if (!f._fbq) f._fbq = n;
  n.push = n;
  n.loaded = true;
  n.version = '2.0';
  n.queue = [];
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://connect.facebook.net/en_US/fbevents.js';
  document.head.appendChild(script);

  window.fbq!('init', META_PIXEL_ID);
}

function ensureInit() {
  if (initialized) return;
  initialized = true;
  if (!consentGranted) return;
  if (GA4_ID) loadGa4();
  if (META_PIXEL_ID) loadMetaPixel();
}

/** Called by ConsentBanner when the visitor makes a choice. */
export function setAnalyticsConsent(granted: boolean) {
  consentGranted = granted;
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, String(granted));
  } catch {
    // localStorage unavailable (private browsing, etc.) — consent still honored in-memory
  }
  if (granted) {
    initialized = false; // allow ensureInit() to actually load the scripts now
    ensureInit();
  }
}

/** Fire on every route change (including the initial one) — SPA has no full page loads. */
export function trackPageView(path: string) {
  ensureInit();
  if (!consentGranted) return;
  if (GA4_ID) window.gtag?.('event', 'page_view', { page_path: path });
  if (META_PIXEL_ID) window.fbq?.('track', 'PageView');
}

/** Fires a custom event to both GA4 and Meta Pixel. */
export function trackEvent(name: string, params: Record<string, unknown> = {}) {
  ensureInit();
  if (!consentGranted) return;
  if (GA4_ID) window.gtag?.('event', name, params);
  if (META_PIXEL_ID) window.fbq?.('trackCustom', name, params);
}

/** Meta's own standard "Lead" event — ads optimize on this, kept separate from trackEvent's custom events. */
export function trackLead(params: Record<string, unknown> = {}) {
  ensureInit();
  if (!consentGranted) return;
  if (META_PIXEL_ID) window.fbq?.('track', 'Lead', params);
}
