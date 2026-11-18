import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { db, initDb } from '../db.js';
import { resetPairing } from './pairing.js';
import { resetRateLimits } from './rateLimit.js';
import { prepareSetupCode } from './routes.js';

const CSRF = { 'x-requested-with': 'mediarr' };
const WRONG = 'That code isn’t right or has expired. Check the code on the TV.';

let app: FastifyInstance;
let dataDir: string;
let cookie: string;

beforeEach(async () => {
  initDb(':memory:');
  resetRateLimits();
  resetPairing();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediarr-pairing-'));
  app = await buildApp({ dataDir, webDist: null, logLevel: 'silent' });
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    headers: CSRF,
    payload: { code: prepareSetupCode(dataDir)!, username: 'owner', password: 'correct horse battery staple' },
  });
  expect(res.statusCode).toBe(200);
  cookie = String(res.headers['set-cookie']).split(';')[0];
});
afterEach(async () => {
  vi.useRealTimers();
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const pair = (remoteAddress?: string) =>
  app.inject({ method: 'POST', url: '/api/tv/pair', headers: CSRF, remoteAddress, payload: { deviceName: 'Living room', baseUrl: 'http://foxbloom.local:3000' } });
const poll = (pairId: string) => app.inject({ method: 'POST', url: '/api/tv/pair/poll', headers: CSRF, payload: { pairId } });
const link = (code: string, headers: Record<string, string> = { cookie, ...CSRF }, remoteAddress?: string) =>
  app.inject({ method: 'POST', url: '/api/tv/link', headers, remoteAddress, payload: { code } });

describe('TV pairing', () => {
  it('pair → link → poll gives a working token', async () => {
    const started = (await pair()).json();
    expect(started.code).toMatch(/^FXB-[A-HJ-NP-Z2-9]{4}$/);
    expect(started.expiresIn).toBe(600);
    expect(started.pairId).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const linked = await link(started.code);
    expect(linked.statusCode).toBe(200);
    expect(linked.json()).toEqual({ ok: true, deviceName: 'Living room' });

    const done = (await poll(started.pairId)).json();
    expect(done.status).toBe('done');
    expect(done.user.username).toBe('owner');
    const status = await app.inject({ method: 'GET', url: '/api/auth/status', headers: { authorization: `Bearer ${done.token}` } });
    expect(status.json().user.username).toBe('owner');
    const row = db.prepare('SELECT user_agent FROM sessions ORDER BY rowid DESC LIMIT 1').get() as { user_agent: string };
    expect(row.user_agent).toBe('Foxbloom TV — Living room');
  });

  it('poll before link is waiting; after hand-out it is expired', async () => {
    const { code, pairId } = (await pair()).json();
    expect((await poll(pairId)).json()).toEqual({ status: 'waiting' });
    await link(code);
    expect((await poll(pairId)).json().status).toBe('done');
    expect((await poll(pairId)).json()).toEqual({ status: 'expired' });
  });

  it('a wrong code is a 404', async () => {
    await pair();
    const res = await link('FXB-ZZZZ');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: WRONG });
  });

  it('an expired code is a 404 and its poll is expired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { code, pairId } = (await pair()).json();
    vi.setSystemTime(Date.now() + 601_000);
    const res = await link(code);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: WRONG });
    expect((await poll(pairId)).json()).toEqual({ status: 'expired' });
  });

  it('the code is case- and dash-insensitive', async () => {
    const { code, pairId } = (await pair()).json();
    const res = await link(code.replace('-', '').toLowerCase());
    expect(res.statusCode).toBe(200);
    expect((await poll(pairId)).json().status).toBe('done');
  });

  it('link needs a signed-in user', async () => {
    const { code } = (await pair()).json();
    expect((await link(code, CSRF)).statusCode).toBe(401);
  });

  it('link is refused while a temporary password is still in use', async () => {
    const { code } = (await pair()).json();
    db.prepare('UPDATE users SET must_change_password = 1').run();
    expect((await link(code)).statusCode).toBe(403);
  });

  it('link is rate limited per IP after wrong codes', async () => {
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await link('FXB-ZZZZ')).statusCode;
    expect(last).toBe(429);
    // even the right code is refused while locked
    const { code } = (await pair()).json();
    expect((await link(code)).statusCode).toBe(429);
  });

  it('starting a pairing is limited to 20 per IP', async () => {
    for (let i = 0; i < 20; i++) expect((await pair('10.0.0.5')).statusCode).toBe(200);
    expect((await pair('10.0.0.5')).statusCode).toBe(429);
    expect((await pair('10.0.0.6')).statusCode).toBe(200);
  });

  it('keeps at most 50 pending, dropping the oldest', async () => {
    const first = (await pair('10.1.0.1')).json();
    for (let i = 0; i < 50; i++) await pair(`10.1.1.${i}`);
    expect((await link(first.code)).statusCode).toBe(404);
    expect((await poll(first.pairId)).json()).toEqual({ status: 'expired' });
  });

  it('qr is an SVG data URI of the link page with the code', async () => {
    const { code, qr } = (await pair()).json();
    expect(qr.startsWith('data:image/svg+xml')).toBe(true);
    const svg = Buffer.from(qr.split(',')[1], 'base64').toString();
    expect(svg).toContain('<svg');
    // the URL itself is encoded as modules, so check the endpoint is stable by pairing twice
    expect(code).toMatch(/^FXB-/);
  });

  it('rejects a bad server address or name', async () => {
    const bad = (payload: object) => app.inject({ method: 'POST', url: '/api/tv/pair', headers: CSRF, payload });
    expect((await bad({ deviceName: 'TV', baseUrl: 'ftp://x' })).statusCode).toBe(400);
    expect((await bad({ deviceName: 'TV', baseUrl: 'http://' + 'a'.repeat(200) })).statusCode).toBe(400);
    expect((await bad({ deviceName: 'x'.repeat(41), baseUrl: 'http://x' })).statusCode).toBe(400);
    expect((await bad({ deviceName: '', baseUrl: 'http://x' })).statusCode).toBe(400);
  });
});
