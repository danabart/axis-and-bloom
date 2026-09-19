import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// Pure unit test: db is mocked, no connection. Covers the outcome-writing
// contract of apiEventLog (see CLAUDE_CODE_PROMPT_CLIENT_ERRORS_UNFINISHED.md).
const query = vi.fn();
vi.mock('../db/client.js', () => ({ db: { query: (...args: unknown[]) => query(...args) } }));

import { apiEventLog } from './apiEventLog.js';

function makeReqRes() {
  const req: any = { method: 'POST', path: '/api/client-errors', baseUrl: '/api/client-errors', route: { path: '/' }, body: { message: 'x' } };
  const res: any = new EventEmitter();
  res.statusCode = 204;
  res.locals = {};
  res.json = vi.fn();
  res.send = vi.fn();
  return { req, res };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const updates = () => query.mock.calls.filter(([sql]) => /UPDATE api_event/.test(String(sql)));

describe('apiEventLog outcome', () => {
  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue({ rowCount: 1 });
  });

  it('finish records the real status', async () => {
    const { req, res } = makeReqRes();
    apiEventLog(req, res, () => {});
    res.emit('finish');
    await flush();
    const u = updates();
    expect(u).toHaveLength(1);
    expect(u[0][1][3]).toBe(204);
  });

  it('close without finish records 499 once, with duration and error text', async () => {
    const { req, res } = makeReqRes();
    apiEventLog(req, res, () => {});
    res.emit('close');
    res.emit('close');
    await flush();
    const u = updates();
    expect(u).toHaveLength(1);
    expect(u[0][1][3]).toBe(499);
    expect(typeof u[0][1][5]).toBe('number');
    expect(JSON.parse(u[0][1][4])).toEqual({ error: 'client closed request' });
  });

  it('finish then close issues no second UPDATE', async () => {
    const { req, res } = makeReqRes();
    apiEventLog(req, res, () => {});
    res.emit('finish');
    res.emit('close');
    await flush();
    expect(updates()).toHaveLength(1);
  });

  it('waits for the INSERT to commit before the UPDATE runs', async () => {
    let releaseInsert!: () => void;
    query.mockImplementationOnce(() => new Promise((r) => { releaseInsert = () => r({ rowCount: 1 }); }));
    const { req, res } = makeReqRes();
    apiEventLog(req, res, () => {});
    res.emit('finish');
    await flush();
    expect(updates()).toHaveLength(0); // insert still pending
    releaseInsert();
    await flush();
    expect(updates()).toHaveLength(1);
  });

  it('warns when the UPDATE matches zero rows', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    query.mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 0 });
    const { req, res } = makeReqRes();
    apiEventLog(req, res, () => {});
    res.emit('finish');
    await flush();
    expect(warn).toHaveBeenCalledWith('[apiEventLog/update-no-match]', expect.objectContaining({ status: 204 }));
    warn.mockRestore();
  });
});
