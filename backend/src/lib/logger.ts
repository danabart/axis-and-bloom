// Structured logger — Observability Foundation, Part B
// (backend/src/features/observability/CLAUDE_CODE_PROMPT_OBSERVABILITY_FOUNDATION.md,
// see OBSERVABILITY_POLICY.md at the repo root for the full model). Emits one
// JSON line per event to stdout/stderr; Cloud Run parses the `severity` field
// natively, which is what makes CRITICAL routable as its own alert policy.
//
// Deliberately dependency-free (no winston/pino) — this is a small, stable
// surface, not a subsystem. Existing `console.error` call sites are NOT
// mass-migrated (diff noise) — this logger is mandatory for all code touched
// by this prompt and all future code; migrate the rest opportunistically.

type Severity = 'CRITICAL' | 'ERROR' | 'WARNING' | 'INFO';

function emit(severity: Severity, tag: string, message: string, context?: object): void {
  const line = {
    severity,
    tag,
    message,
    ...(context ?? {}),
    timestamp: new Date().toISOString(),
  };
  const json = JSON.stringify(line);
  // CRITICAL/ERROR to stderr, WARNING/INFO to stdout -- matches the
  // console.error/console.warn/console.log split Cloud Run already expects,
  // and keeps this usable as a plain console fallback if JSON parsing ever
  // fails on the platform side.
  if (severity === 'CRITICAL' || severity === 'ERROR') {
    console.error(json);
  } else {
    console.log(json);
  }
}

export const log = {
  critical: (tag: string, message: string, context?: object) => emit('CRITICAL', tag, message, context),
  error:    (tag: string, message: string, context?: object) => emit('ERROR', tag, message, context),
  warn:     (tag: string, message: string, context?: object) => emit('WARNING', tag, message, context),
  info:     (tag: string, message: string, context?: object) => emit('INFO', tag, message, context),
};
