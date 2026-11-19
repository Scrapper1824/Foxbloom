import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { initDb } from '../db.js';
import { resetRateLimits } from './rateLimit.js';
import { prepareSetupCode } from './routes.js';

const CSRF = { 'x-requested-with': 'mediarr' };
const FILE = { ...CSRF, origin: 'file://' };
const PASSWORD = 'correct horse battery staple';

let app: FastifyInstance;
let dataDir: string;
let cookie: string;

beforeEach(async () => {
  initDb(':memory:');
  resetRateLimits();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediarr-tvcors-'));
  app = await buildApp({ dataDir, webDist: null, logLevel: 'silent' });
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    headers: CSRF,
    payload: { code: prepareSetupCode(dataDir)!, username: 'owner', password: PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  cookie = String(res.headers['set-cookie']).split(';')[0];
});
afterEach(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const noCredentials = (res: { headers: Record<string, unknown> }) => expect(res.headers['access-control-allow-credentials']).toBeUndefined();

describe('TV calls without a cookie (file:// origin)', () => {
  it('GET status works and carries CORS', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/status', headers: FILE });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('file://');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    noCredentials(res);
  });

  it('POST pair and poll work and carry CORS', async () => {
    const pair = await app.inject({ method: 'POST', url: '/api/tv/pair', headers: FILE, payload: { deviceName: 'Samsung TV', baseUrl: 'http://x.test' } });
    expect(pair.statusCode).toBe(200);
    expect(pair.headers['access-control-allow-origin']).toBe('file://');
    noCredentials(pair);
    const poll = await app.inject({ method: 'POST', url: '/api/tv/pair/poll', headers: FILE, payload: { pairId: pair.json().pairId } });
    expect(poll.statusCode).toBe(200);
    expect(poll.json().status).toBe('waiting');
    expect(poll.headers['access-control-allow-origin']).toBe('file://');
    noCredentials(poll);
  });

  it('POST login works and carries CORS', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: FILE, payload: { username: 'owner', password: PASSWORD } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('file://');
    noCredentials(res);
  });

  it('still needs x-requested-with', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/tv/pair', headers: { origin: 'file://' }, payload: { deviceName: 'TV', baseUrl: 'http://x.test' } });
    expect(res.statusCode).toBe(403);
  });

  it('a cookie POST from file:// is still blocked and gets no CORS', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...FILE, cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('Cross-site request blocked');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    noCredentials(res);
  });
});
