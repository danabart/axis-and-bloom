import type { Request } from 'express';

// C17 — real client IP behind Cloudflare -> Firebase Hosting -> Cloud Run.
//
// Measured empirically against production (2026-08-07 — see
// WHAT_WE_BUILT_SECURITY.md) before writing any of this, via a temporary
// logging route hit through every path a request can actually take:
//
//   1. X-Forwarded-For never carries the real visitor IP in this chain.
//      Firebase Hosting's /api/** rewrite to Cloud Run REPLACES whatever
//      X-Forwarded-For a client sent with its own fresh 2-entry chain:
//      [whoever actually connected to Firebase Hosting, Google's own
//      internal hop into the Cloud Run container]. A forged 2-entry
//      X-Forwarded-For sent straight at the *.web.app origin was fully
//      discarded and replaced with Firebase Hosting's real view — confirmed
//      by direct test, not assumed.
//   2. CF-Connecting-IP DOES carry the real visitor IP, unchanged, whenever
//      the request genuinely went through Cloudflare (confirmed on 3
//      separate real requests through axisandbloomcoffee.com / www).
//   3. CF-Connecting-IP is NOT stripped or validated by Firebase Hosting or
//      Cloud Run — a request that bypasses Cloudflare (hits *.web.app or
//      *.run.app directly) can set an arbitrary CF-Connecting-IP and it
//      arrives untouched (confirmed by direct test). Never trust it blindly.
//   4. Cloud Run's own ingress (GFE) always APPENDS the true direct TCP peer
//      as the LAST X-Forwarded-For entry — a client hitting the *.run.app
//      URL directly can prepend whatever fake entries it wants, but cannot
//      control that final appended value (confirmed: a forged leading entry
//      survived, but the real caller IP was still appended after it).
//      `trust proxy = 1` (Express's resolution of req.ip = X-Forwarded-For's
//      last entry, set in index.ts) is therefore always a real,
//      non-spoofable "who actually opened this connection" value — just not
//      a distinct-per-visitor one once Firebase Hosting is in front, since
//      every real visitor collapses onto Firebase Hosting's/Google's own
//      internal address there. That collapse is exactly finding M11.
//
// Trust rule: use CF-Connecting-IP as the rate-limit key ONLY when the entry
// Firebase Hosting itself set — X-Forwarded-For's second-to-last entry, in
// what a genuine Firebase-Hosting-routed request always makes a 2-entry
// chain — falls inside Cloudflare's published IP ranges. That means Firebase
// Hosting's own immediate upstream really was a Cloudflare edge. Otherwise,
// fall back to req.ip (trust proxy=1's resolution): safe and non-spoofable,
// just not per-visitor.
//
// Known residual gap, not closable in code alone: a request that skips
// Firebase Hosting entirely and hits the raw Cloud Run *.run.app URL can
// craft a single fake X-Forwarded-For entry containing a real, publicly
// published Cloudflare IP address, which passes this range check and gets
// its forged CF-Connecting-IP trusted. Cloudflare's IP list is public, so
// this is "requires deliberately reading Cloudflare's docs," not "trivial" —
// but it is not zero. Fully closing it means restricting Cloud Run ingress
// so *.run.app isn't reachable except via Firebase Hosting (see
// CLOUDFLARE_SETUP.md's "important caveat" section and
// WHAT_WE_BUILT_SECURITY.md) — an infra change, flagged there, out of this
// fix's scope. What this DOES fully close, and what C17's acceptance bar
// asks for: a spoofed X-Forwarded-For *alone*, on a direct-to-origin
// request, never changes the keyed IP — it falls back to the tamper-proof
// req.ip instead of being able to redirect the limiter onto an arbitrary
// address.

// Cloudflare's published IP ranges — https://www.cloudflare.com/ips-v4 and
// -v6 (checked 2026-08-07). These change rarely but do change; re-verify
// against the published list periodically.
const CLOUDFLARE_IPV4_CIDRS = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
];
const CLOUDFLARE_IPV6_CIDRS = [
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    result = (result << 8) | n;
  }
  return result >>> 0;
}

function isIpv4InCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

// Minimal IPv6 parser — expands `::` shorthand and packs into a 128-bit
// BigInt. No dependency added for this; the format is small and fixed.
function ipv6ToBigInt(ip: string): bigint | null {
  const parts = ip.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  if (parts.length === 1 && head.length !== 8) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const groups = [...head, ...Array(parts.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  let result = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    result = (result << 16n) | BigInt(Number.parseInt(g, 16));
  }
  return result;
}

function isIpv6InCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const ipBig = ipv6ToBigInt(ip);
  const rangeBig = ipv6ToBigInt(range);
  if (ipBig === null || rangeBig === null) return false;
  if (bits === 0) return true;
  const mask = ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - bits)) - 1n);
  return (ipBig & mask) === (rangeBig & mask);
}

function isCloudflareIp(ip: string): boolean {
  const clean = ip.trim().replace(/^::ffff:/i, ''); // unwrap IPv4-mapped IPv6
  if (clean.includes(':')) {
    return CLOUDFLARE_IPV6_CIDRS.some((c) => isIpv6InCidr(clean, c));
  }
  return CLOUDFLARE_IPV4_CIDRS.some((c) => isIpv4InCidr(clean, c));
}

/**
 * Resolves the real visitor IP for rate-limit keying, given the measured
 * Cloudflare -> Firebase Hosting -> Cloud Run chain (see file header for the
 * empirical basis). Use as an express-rate-limit `keyGenerator`.
 */
export function getRealClientIp(req: Request): string {
  const xffHeader = req.headers['x-forwarded-for'];
  const xffChain = (Array.isArray(xffHeader) ? xffHeader[0] : xffHeader ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const cfHeader = req.headers['cf-connecting-ip'];
  const cfConnectingIp = Array.isArray(cfHeader) ? cfHeader[0] : cfHeader;

  // Firebase Hosting's own hop is the second-to-last entry in a genuine
  // 2-entry chain (see file header) — only trust CF-Connecting-IP when that
  // entry really is a Cloudflare edge.
  const firebaseHostingUpstream = xffChain.length >= 2 ? xffChain[xffChain.length - 2] : null;
  if (cfConnectingIp && firebaseHostingUpstream && isCloudflareIp(firebaseHostingUpstream)) {
    return cfConnectingIp.trim();
  }

  // Not verifiably via Cloudflare — fall back to Express's own trust-proxy
  // resolution (trust proxy=1 in index.ts -> X-Forwarded-For's last entry),
  // which Cloud Run's ingress sets from the real TCP peer and a client
  // cannot override, even on a direct-to-origin request.
  return req.ip ?? 'unknown';
}
