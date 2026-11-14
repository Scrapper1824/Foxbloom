import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { db, initDb } from '../db.js';
import { TEMP_PASSWORD } from './password.js';
import { resetRateLimits } from './rateLimit.js';
import { prepareSetupCode } from './routes.js';

const CSRF = { 'x-requested-with': 'mediarr' };
const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a brand new long password';

let app: FastifyInstance;
let dataDir: string;
let admin: string;

const cookieFrom = (res: { headers: Record<string, unknown> }) => String(res.headers['set-cookie']).split(';')[0];
const call = (cookie: string | null, method: string, url: string, payload?: unknown) =>
  app.inject({ method: method as 'GET', url, headers: { ...CSRF, ...(cookie ? { cookie } : {}) }, payload: payload as object });
const login = (username: string, password: string) => call(null, 'POST', '/api/auth/login', { username, password });

beforeEach(async () => {
  initDb(':memory:');
  resetRateLimits();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediarr-temp-'));
  app = await buildApp({ dataDir, webDist: null, logLevel: 'silent' });
  const code = prepareSetupCode(dataDir)!;
  admin = cookieFrom(await call(null, 'POST', '/api/auth/setup', { code, username: 'owner', password: PASSWORD }));
});
afterEach(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('temporary password', () => {
  it('signs in with Temp1234, can do nothing until a new password is chosen, then works normally', async () => {
    expect(TEMP_PASSWORD).toBe('Temp1234');
    const add = await call(admin, 'POST', '/api/users', { username: 'friend', tempPassword: true, role: 'user' });
    expect(add.statusCode).toBe(200);
    expect(add.json()).toMatchObject({ username: 'friend', mustChangePassword: true });

    const res = await login('friend', 'Temp1234');
    expect(res.statusCode).toBe(200);
    const friend = cookieFrom(res);
    expect((await call(friend, 'GET', '/api/auth/status')).json().user).toMatchObject({ username: 'friend', mustChangePassword: true });

    // Locked to changing the password (server-side, not just the screen).
    const blocked = await call(friend, 'GET', '/api/media');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ mustChangePassword: true });
    expect((await call(friend, 'GET', '/api/home')).statusCode).toBe(403);

    // Not Temp1234 again, and the usual length rule.
    expect((await call(friend, 'POST', '/api/auth/password', { currentPassword: 'Temp1234', newPassword: 'Temp1234' })).statusCode).toBe(400);
    expect((await call(friend, 'POST', '/api/auth/password', { currentPassword: 'Temp1234', newPassword: 'short' })).statusCode).toBe(400);
    const changed = await call(friend, 'POST', '/api/auth/password', { currentPassword: 'Temp1234', newPassword: NEW_PASSWORD });
    expect(changed.statusCode).toBe(200);

    expect((await call(friend, 'GET', '/api/auth/status')).json().user.mustChangePassword).toBe(false);
    expect((await call(friend, 'GET', '/api/media')).statusCode).toBe(200);
    // The temp password no longer works; the new one does.
    expect((await login('friend', 'Temp1234')).statusCode).toBe(401);
    expect((await login('friend', NEW_PASSWORD)).statusCode).toBe(200);
  });

  it('still requires a normal password when the box is off', async () => {
    const res = await call(admin, 'POST', '/api/users', { username: 'friend', password: 'Temp1234', role: 'user' });
    expect(res.statusCode).toBe(400);
  });

  it('expires after 7 days unused', async () => {
    await call(admin, 'POST', '/api/users', { username: 'friend', tempPassword: true, role: 'user' });
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000).toISOString();
    db.prepare('UPDATE users SET password_changed_at = ? WHERE username = ?').run(eightDaysAgo, 'friend');
    const res = await login('friend', 'Temp1234');
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/expired/i);
  });

  it('lets an admin reset someone to the temp password, signing them out', async () => {
    const add = await call(admin, 'POST', '/api/users', { username: 'friend', password: NEW_PASSWORD, role: 'user' });
    const id = add.json().id;
    const friend = cookieFrom(await login('friend', NEW_PASSWORD));
    const reset = await call(admin, 'PATCH', `/api/users/${id}`, { tempPassword: true });
    expect(reset.json()).toMatchObject({ mustChangePassword: true });
    expect((await call(friend, 'GET', '/api/auth/status')).json().authenticated).toBe(false);
    expect((await login('friend', 'Temp1234')).statusCode).toBe(200);
  });
});
