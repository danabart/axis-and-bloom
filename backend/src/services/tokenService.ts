import { db } from '../db/client.js';
import { firestoreDb } from './firebase-admin.js';
import { getSommelierConfig } from './sommelierConfig.js';

export async function getTokenBalance(uid: string): Promise<number> {
  const result = await db.query('SELECT balance FROM user_tokens WHERE uid = $1', [uid]);
  return result.rows.length ? Number(result.rows[0].balance) : 0;
}

export async function spendToken(
  uid: string,
  reason: string,
  referenceId: string
): Promise<{ success: boolean; newBalance: number }> {
  const costPerTurn = getSommelierConfig()?.tokenEconomy?.costPerTurn ?? 1;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query(
      'SELECT balance FROM user_tokens WHERE uid = $1 FOR UPDATE',
      [uid]
    );
    const balance = lock.rows.length ? Number(lock.rows[0].balance) : 0;
    if (balance < costPerTurn) {
      await client.query('ROLLBACK');
      return { success: false, newBalance: balance };
    }
    await client.query(
      `UPDATE user_tokens
       SET balance = balance - $2, lifetime_spent = lifetime_spent + $2, updated_at = NOW()
       WHERE uid = $1`,
      [uid, costPerTurn]
    );
    await client.query(
      `INSERT INTO token_events (uid, delta, reason, reference_id, balance_after)
       SELECT $1, -$2, $3, $4, balance FROM user_tokens WHERE uid = $1`,
      [uid, costPerTurn, reason, referenceId]
    );
    await client.query('COMMIT');
    const newBalance = balance - costPerTurn;
    firestoreDb.doc(`users/${uid}`).set({ tokenBalance: newBalance }, { merge: true }).catch(() => {});
    return { success: true, newBalance };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function grantTokens(
  uid: string,
  amount: number,
  reason: string,
  referenceId?: string
): Promise<number> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE user_tokens
       SET balance = balance + $2, lifetime_earned = lifetime_earned + $2, updated_at = NOW()
       WHERE uid = $1`,
      [uid, amount]
    );
    await client.query(
      `INSERT INTO token_events (uid, delta, reason, reference_id, balance_after)
       SELECT $1, $2, $3, $4, balance FROM user_tokens WHERE uid = $1`,
      [uid, amount, reason, referenceId ?? null]
    );
    await client.query('COMMIT');
    const row = await db.query('SELECT balance FROM user_tokens WHERE uid = $1', [uid]);
    const newBalance = row.rows.length ? Number(row.rows[0].balance) : 0;
    firestoreDb.doc(`users/${uid}`).set({ tokenBalance: newBalance }, { merge: true }).catch(() => {});
    return newBalance;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
