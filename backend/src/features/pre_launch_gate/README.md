# features/

One folder per feature. Each folder holds the feature's Claude Code prompt(s) — named
`CLAUDE_CODE_PROMPT_<FEATURE>.md`, same convention as `backend/src/features/` — plus any
decision notes or specs that belong to it. Prompts are written here first, then executed
via Claude Code; a prompt is marked executed in its own header when it ships.

| Feature | Status |
|---|---|
| [prelaunch-gate](prelaunch-gate/CLAUDE_CODE_PROMPT_PRELAUNCH_GATE.md) — site-wide allowlist while `VITE_PRELAUNCH_MODE=true`: quiz funnel + trust pages open, everything else behind the curtain; trimmed nav; prelaunch ArchetypeSection | ✅ executed 2026-08-10 |
