import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { db, initDb } from '../db.js';
import { resetRateLimits } from './rateLimit.js';
import { prepareSetupCode } from './routes.js';
import { createSession, userForSession } from './sessions.js';

const CSRF = { 'x-requested-with': 'mediarr' };

let app: FastifyInstance;
let dataDir: string;
let token: string;

beforeEach(async () => {
  initDb(':memory:');
  resetRateLimits();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediarr-bearer-'));
  app = await buildApp({ dataDir, webDist: null, logLevel: 'silent' });
  const setupCode = prepareSetupCode(dataDir)!;
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    headers: CSRF,
    payload: { code: setupCode, username: 'owner', password: 'correct horse battery staple' },
  });
  expect(res.statusCode).toBe(200);
  cookie = String(res.headers['set-cookie']).split(';')[0];
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get('owner') as { id: number };
  token = createSession(user.id, '127.0.0.1', 'test');
});
afterEach(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

let cookie: string;
const bearer = () => ({ authorization: `Bearer ${token}` });

describe('bearer sessions', () => {
  it('bearer token signs in', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/status', headers: bearer() });
    expect(res.json().authenticated).toBe(true);
  });

  it('bearer POST from another origin is allowed', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...bearer(), ...CSRF, origin: 'file://' } });
    expect(res.statusCode).toBe(200);
    expect(userForSession(token)).toBeNull();
  });

  it('bearer POST still needs the x-requested-with header', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...bearer(), origin: 'file://' } });
    expect(res.statusCode).toBe(403);
  });

  it('cookie POST from another origin is still blocked', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie, ...CSRF, origin: 'file://' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('Cross-site request blocked');
  });

  it('answers a preflight', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/home',
      headers: {
        origin: 'file://',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization, content-type, x-requested-with',
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('file://');
    expect(String(res.headers['access-control-allow-headers'])).toContain('authorization');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('sends CORS headers only for bearer requests', async () => {
    const b = await app.inject({ method: 'GET', url: '/api/home', headers: { ...bearer(), origin: 'null' } });
    expect(b.headers['access-control-allow-origin']).toBe('null');
    expect(b.headers['cross-origin-resource-policy']).toBe('cross-origin');
    const c = await app.inject({ method: 'GET', url: '/api/home', headers: { cookie, origin: 'null' } });
    expect(c.headers['access-control-allow-origin']).toBeUndefined();
    expect(c.headers['cross-origin-resource-policy']).toBe('same-origin');
  });

  it('rejects an expired bearer session', async () => {
    db.prepare('UPDATE sessions SET last_seen = ?').run(new Date(Date.now() - 8 * 24 * 3600_000).toISOString());
    // the cookie session is stale too, which is fine: only the bearer one is used here
    const res = await app.inject({ method: 'GET', url: '/api/home', headers: bearer() });
    expect(res.statusCode).toBe(401);
  });
});
