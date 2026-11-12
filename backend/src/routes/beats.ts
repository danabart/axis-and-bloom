import { Router } from 'express';
import { respondToDialInBeat, resolveDialInBeatIdByRespondToken, resolveDialInBeatOwnerByRespondToken } from '../services/beatEngine.js';
import { decide as matchDecide, MatchError, CUSTOMER_MOVES } from '../services/matchService.js';
import { customerCopy } from '../services/dialReads.js';
import { renderResponsePage } from '../lib/responsePage.js';

const router = Router();

// ── GET /api/beats/dial-in/:token/respond ─────────────────────────────────────
// HOME_TASK_8 (§3.1, spec item 2) — "on-site via the card's door." A capability
// link (the token itself, emailed only to its own recipient) rather than a
// logged-in form — the same low-friction, single-click pattern the email's
// own quick-response buttons need to work without asking the customer to sign
// in again from their inbox. GET is used deliberately for the same reason a
// calendar RSVP or unsubscribe link uses GET: one click, no form, no session
// requirement — respondToDialInBeat() is itself idempotent (a beat_event that
// already has responded_at is a no-op), so a prefetching email client or a
// double-click can't double-adjust the card.
//
// H3/C4 security fix — this used to identify the beat by beat_event.id, a
// plain SERIAL: unauthenticated, no ownership check, trivially enumerable
// (loop integers, mark any customer's beat responded, shift *their* next
// brew-card grind). The SERIAL id never appears in this URL anymore — the
// path segment is now an unguessable 32-byte token (respond_token,
// schema.sql), looked up directly with no separate existence-then-ownership
// step to time or otherwise distinguish. A wrong/guessed/expired-format
// token and a real-but-already-responded beat both resolve through the same
// 404/idempotent-no-op shape below where relevant — nothing here tells an
// attacker "closer" from "not even close."
router.get('/dial-in/:token/respond', async (req, res) => {
  const { token } = req.params;
  const expectation = req.query.expectation as string | undefined;

  // Ella's Bloom Map 3 (CTO call 9, Dana's decision 5): the map buttons the
  // email carries when reorder_email says map. The link carries the move; the
  // server picks the move set's top-ranked coffee at click time, through the
  // one door. Idempotent per beat and move (source beat, source_id
  // <beat_event id>:<move>). The expectation path below is unchanged.
  const move = req.query.move as string | undefined;
  if (move !== undefined) {
    if (!token || !(CUSTOMER_MOVES as readonly string[]).includes(move)) {
      res.status(400).send(renderResponsePage('That link looks incomplete — nothing was recorded.'));
      return;
    }
    try {
      const beat = await resolveDialInBeatOwnerByRespondToken(token);
      if (beat === null) {
        res.status(404).send(renderResponsePage('That link is no longer valid — nothing was recorded.'));
        return;
      }
      const result = await matchDecide({
        userId: beat.userId, trigger: 'hop', move, pickTopRanked: move !== 'stay',
        source: 'beat', sourceId: `${beat.id}:${move}`,
      });
      const copy = await customerCopy();
      res.send(renderResponsePage((copy.moved_to ?? '').replaceAll('{coffee}', result.pickedCoffeeName ?? '')));
    } catch (err) {
      if (err instanceof MatchError) {
        res.status(err.status).send(renderResponsePage(err.message));
        return;
      }
      console.error('[beats/dial-in/respond move]', err);
      res.status(500).send(renderResponsePage('Something went wrong on our end — no changes were made.'));
    }
    return;
  }

  if (!token || !['lighter', 'as_expected', 'bolder'].includes(expectation ?? '')) {
    res.status(400).send(renderResponsePage('That link looks incomplete — nothing was recorded.'));
    return;
  }

  try {
    const beatEventId = await resolveDialInBeatIdByRespondToken(token);
    if (beatEventId === null) {
      res.status(404).send(renderResponsePage('That link is no longer valid — nothing was recorded.'));
      return;
    }
    const applied = await respondToDialInBeat(beatEventId, expectation as 'lighter' | 'as_expected' | 'bolder', 'onsite_feedback');
    res.send(renderResponsePage(
      applied
        ? "Got it — thanks. Liam's adjusted your brew card for next time."
        : "Looks like you've already answered this one — nothing more to do here."
    ));
  } catch (err) {
    console.error('[beats/dial-in/respond]', err);
    res.status(500).send(renderResponsePage('Something went wrong on our end — no changes were made.'));
  }
});

export default router;
