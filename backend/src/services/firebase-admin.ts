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

export const firestoreDb = getFirestore(app, 'axis-bloom-fs');
export { FieldValue };

const admin = {
  auth: () => getAuth(app),
  appCheck: () => getAppCheck(app),
};
export default admin;
