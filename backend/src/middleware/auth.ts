import type { Request, Response, NextFunction } from 'express';
import admin from '../services/firebase-admin.js';
import { db } from '../db/client.js';
import { hasLiamAccess } from '../services/liamAccess.js';

export interface AuthRequest extends Request {
  uid?: string;
  email?: string;
  isAnonymous?: boolean;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    req.email = decoded.email;
    req.isAnonymous = decoded.firebase?.sign_in_provider === 'anonymous';
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export async function blockAnonymousAuth(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.isAnonymous) {
    res.status(403).json({ error: 'Create a free account to continue', code: 'anonymous_not_allowed' });
    return;
  }
  next();
}

export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    req.email = decoded.email;
    req.isAnonymous = decoded.firebase?.sign_in_provider === 'anonymous';
    const result = await db.query(
      `SELECT ut.name FROM user_profile up
       JOIN user_type ut ON ut.id = up.user_type_id
       WHERE up.firebase_uid = $1`,
      [decoded.uid]
    );
    if (result.rows[0]?.name !== 'admin') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Liam access & cost brief (2026-10-01) — subscribers and admins only. Sits
// after requireAuth + blockAnonymousAuth on every customer route in
// routes/sommelier.ts, ahead of the per-account limiter, the daily cap and any
// model call. The decision itself lives in services/liamAccess.ts.
export async function requireLiamAccess(req: AuthRequest, res: Response, next: NextFunction) {
  const access = await hasLiamAccess(req.uid!);
  if (!access.allowed) {
    res.status(403).json({ error: 'liam_not_included' });
    return;
  }
  next();
}

export async function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (token) {
    try {
      const decoded = await admin.auth().verifyIdToken(token);
      req.uid = decoded.uid;
      req.email = decoded.email;
      req.isAnonymous = decoded.firebase?.sign_in_provider === 'anonymous';
    } catch {}
  }
  next();
}
