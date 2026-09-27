// C11 — firebase-admin 12 → 14. v13 removed the old `import admin from
// 'firebase-admin'; admin.auth()/.firestore()/.initializeApp()` default-
// export namespace entirely (deprecated since v12, gone since v13) in favor
// of per-service modular imports (`firebase-admin/app`, `/auth`, `/app-check`,
// `/firestore`). Rebuilt on the modular API here, in this one file only —
// every consumer elsewhere in the backend still does
// `import admin from '../services/firebase-admin.js'; admin.auth()` /
// `admin.appCheck()` unchanged, via the same-shaped default export below,
// so this migration doesn't ripple out into a multi-file refactor.
import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getAppCheck } from 'firebase-admin/app-check';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const app = getApps().length
  ? getApp()
  : initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      }),
    });

const rawFirestoreDb = getFirestore(app, 'axis-bloom-fs');

// Customer Blueprint C3, Part 0 (2026-09-27) — Firestore credentials are NOT
// split by environment the way DATABASE_URL/TEST_DATABASE_URL are: every
// process, local or deployed, talks to the one real production Firestore
// database. This silently leaked 2 real feedback_events docs into prod during
// the C2 smoke test, when a local server pointed at axisandbloom_test for
// Postgres still wrote to prod Firestore for a route that touches it — see
// WHAT_WE_BUILT.md's C2 addendum. This proxy makes that fail loud instead of
// silently, by blocking every write-shaped call (`set`/`update`/`delete`/
// `create`/`add`/`recursiveDelete`) unless NODE_ENV is 'production' (the real
// deploy) or 'test' (vitest sets this by default, and customerIntegrity's
// live parity checks need real Firestore reads/writes to keep working).
// Scope: only doc()/collection()/collectionGroup() refs obtained through
// firestoreDb are guarded (the only pattern used anywhere in this codebase —
// grepped 2026-09-27, no `.batch()`/`.runTransaction()` usage exists). A ref
// obtained via `.parent` bypasses this, same reason: not a pattern in use.
const WRITE_METHODS = new Set(['set', 'update', 'delete', 'create', 'add']);
const WRITE_ALLOWED_ENVS = new Set(['production', 'test']);

function isFirestoreWriteAllowed(): boolean {
  return WRITE_ALLOWED_ENVS.has(process.env.NODE_ENV ?? '');
}

function blockedWriteError(method: string, path: string): Error {
  return new Error(
    `[firestore-write-guard] blocked firestoreDb.${method}() on "${path}" — ` +
    `NODE_ENV=${JSON.stringify(process.env.NODE_ENV ?? null)} is neither 'production' nor 'test'. ` +
    `Firestore is shared across every environment; this call would have written to the real ` +
    `production database. Run with NODE_ENV=test or NODE_ENV=production if this write is intended.`
  );
}

// Wraps a DocumentReference/CollectionReference so its write methods throw
// when not allowed, and so any child ref obtained via .doc()/.collection()
// off it is guarded the same way. Every function property is rebound to the
// real `target` (not the proxy) before being returned — the Firestore SDK's
// classes use private fields internally, and calling a private-field-using
// method with `this` set to a Proxy (rather than the real instance) throws.
function guardRef<T extends object>(ref: T, path: string): T {
  return new Proxy(ref, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      if (typeof prop === 'string' && WRITE_METHODS.has(prop)) {
        return (...args: unknown[]) => {
          if (!isFirestoreWriteAllowed()) throw blockedWriteError(prop, path);
          return value.apply(target, args);
        };
      }
      if (prop === 'doc' || prop === 'collection') {
        return (...args: unknown[]) => {
          const childPath = args[0] !== undefined ? `${path}/${String(args[0])}` : `${path}/(auto-id)`;
          return guardRef(value.apply(target, args), childPath);
        };
      }
      return value.bind(target);
    },
  });
}

export const firestoreDb: FirebaseFirestore.Firestore = new Proxy(rawFirestoreDb, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (typeof value !== 'function') return value;
    if (prop === 'recursiveDelete') {
      return (...args: unknown[]) => {
        if (!isFirestoreWriteAllowed()) throw blockedWriteError('recursiveDelete', String(args[0] ?? '(unknown)'));
        return value.apply(target, args);
      };
    }
    if (prop === 'doc' || prop === 'collection') {
      return (...args: unknown[]) => guardRef(value.apply(target, args), String(args[0] ?? ''));
    }
    return value.bind(target);
  },
});
export { FieldValue };

const admin = {
  auth: () => getAuth(app),
  appCheck: () => getAppCheck(app),
};
export default admin;
