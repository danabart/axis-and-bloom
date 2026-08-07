# Cyber Security — feature workspace

Security threat model, vulnerability register, and the ordered set of Claude Code prompts to close the findings. Created 2026-08-05.

This folder is **specs and prompts only** — no code changes are made here. All fixes go through Claude Code, per house convention.

## Files
- **`SECURITY_FINDINGS.md`** — the vulnerability register. Every finding (open + already-fixed-by-design + verified-safe), with severity, exact location, concrete attack, and status. This is the audit record; update the status column as prompts land.
- **`CLAUDE_CODE_PROMPTS.md`** — the runnable work, as full standalone specs. Console tasks first, then C1…C16 in priority order (each has Goal / Why / Files / Steps / Acceptance / Guardrails). Paste one at a time into Claude Code; see the "How to run" preamble.
- **`SECURITY_SERVICES.md`** — third-party services to register with (Cloudflare edge/WAF/bot, dependency + secret scanning, DAST, monitoring, pentest) and the no-cost hygiene (MFA, backups/DR, least privilege, incident checklist) that tools don't cover.
- **`CLOUDFLARE_SETUP.md`** — step-by-step runbook to move DNS to Cloudflare and turn on the free protections (WAF, HSTS, Bot Fight, edge security headers, Turnstile, one rate-limit rule), with the Firebase-Hosting-specific SSL/proxy ordering and the origin-bypass caveat.
- **`RUN_ORDER.md`** — the master execution checklist. Tick top to bottom: Phase 0 console caps → Phase 1 Cloudflare edge → Phase 2 high-value code (C1–C5) → Phase 3 front door (C6/C16/C8/C7) → Phase 4 hygiene (C9–C15).

## Priority at a glance
- **P0 — do today, no code:** Anthropic spend cap + GCP billing budget (caps the worst case regardless of any bug).
- **P1 — highest-impact code:** global Liam kill-switch (C2), stop public AI-content generation (C3), the two cross-user/abuse bugs the deep audit found — beats IDOR (C4) and order-bonus/price abuse (C5).
- **P2 — close the front door:** App Check (C6), auth-endpoint rate limiting (C8), remove schema-leaking health routes (C1).
- **P3 — hygiene & hardening:** dependency upgrades (C11), static-site security headers (C12), Dockerfile non-root (C13), keyless CI (C14), Firestore rules as code (C10), Twilio webhook signature (C9), and the low-severity bundle (C15).

## Reassurance — what the audit found already SOLID
The core was built with security in mind. Confirmed clean by two independent review passes: no SQL injection anywhere (fully parameterized), no IDOR in users/orders/households/QR (every query scoped to the caller's uid), admin API gated by a real DB role check (not just hidden UI), Liam's LLM action-markers are all server-verified against whitelists and scoped to the caller's own data (no prompt-injection privilege escalation, no stored XSS — React escapes output), and no real server secret ships in the frontend bundle (only the public Firebase web config; no source maps). The gaps below are real but they're the edges, not the foundation.
