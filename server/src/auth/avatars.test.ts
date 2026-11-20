import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { db, initDb } from '../db.js';
import { resetRateLimits } from './rateLimit.js';
import { prepareSetupCode } from './routes.js';
import { createSession } from './sessions.js';

const CSRF = { 'x-requested-with': 'mediarr' };
// The smallest valid images of each allowed kind (only the leading bytes are checked).
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b30000000049454e44ae426082', 'hex');
const JPEG = Buffer.concat([Buffer.from('ffd8ffe000104a46494600', 'hex'), Buffer.alloc(40), Buffer.from('ffd9', 'hex')]);
const dataUrl = (mime: string, b: Buffer) => `data:${mime};base64,${b.toString('base64')}`;

let app: FastifyInstance;
let dataDir: string;
let cookie: string;
let token: string;
let otherToken: string;

beforeEach(async () => {
  initDb(':memory:');
  resetRateLimits();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediarr-avatar-'));
  app = await buildApp({ dataDir, webDist: null, logLevel: 'silent' });
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    headers: CSRF,
    payload: { code: prepareSetupCode(dataDir)!, username: 'owner', password: 'correct horse battery staple' },
  });
  cookie = String(res.headers['set-cookie']).split(';')[0];
  const owner = db.prepare('SELECT id FROM users WHERE username = ?').get('owner') as { id: number };
  token = createSession(owner.id, '127.0.0.1', 'test');
  await app.inject({ method: 'POST', url: '/api/users', headers: { ...CSRF, cookie }, payload: { username: 'kid', password: 'another long passphrase here', role: 'user' } });
  const kid = db.prepare('SELECT id FROM users WHERE username = ?').get('kid') as { id: number };
  otherToken = createSession(kid.id, '127.0.0.1', 'test');
});
afterEach(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const put = (image: unknown, headers: Record<string, string> = { cookie }) => app.inject({ method: 'PUT', url: '/api/auth/avatar', headers: { ...CSRF, ...headers }, payload: { image } });
const status = (t: string) => app.inject({ method: 'GET', url: '/api/auth/status', headers: { authorization: `Bearer ${t}` } }).then((r) => r.json());

describe('profile pictures', () => {
  it('a signed-in user sets their own picture; status gives its address; anyone can load it as an image', async () => {
    const res = await put(dataUrl('image/png', PNG));
    expect(res.statusCode).toBe(200);
    const avatar = res.json().avatar as string;
    expect(avatar).toMatch(/^\/api\/avatars\/[A-Za-z0-9_-]{22,}$/);
    expect((await status(token)).user.avatar).toBe(avatar);
    const img = await app.inject({ method: 'GET', url: avatar });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(String(img.headers['cache-control'])).toContain('immutable');
    expect(img.rawPayload.equals(PNG)).toBe(true);
  });

  it('works from the TV with a bearer token, and a new picture gets a new address (the old one stops working)', async () => {
    const first = (await put(dataUrl('image/png', PNG), { authorization: `Bearer ${token}`, origin: 'file://' })).json().avatar;
    const second = (await put(dataUrl('image/jpeg', JPEG), { authorization: `Bearer ${token}`, origin: 'file://' })).json().avatar;
    expect(second).not.toBe(first);
    expect((await app.inject({ method: 'GET', url: first })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: second })).headers['content-type']).toBe('image/jpeg');
  });

  it('a regular user can set theirs, and it shows only on their own account', async () => {
    const res = await put(dataUrl('image/png', PNG), { authorization: `Bearer ${otherToken}` });
    expect(res.statusCode).toBe(200);
    expect((await status(otherToken)).user.avatar).toBe(res.json().avatar);
    expect((await status(token)).user.avatar).toBeNull();
  });

  it('the admin users list includes each picture', async () => {
    const avatar = (await put(dataUrl('image/png', PNG))).json().avatar;
    const users = (await app.inject({ method: 'GET', url: '/api/users', headers: { cookie } })).json() as Array<{ username: string; avatar: string | null }>;
    expect(users.find((u) => u.username === 'owner')!.avatar).toBe(avatar);
    expect(users.find((u) => u.username === 'kid')!.avatar).toBeNull();
  });

  it('refuses anything that is not a PNG, JPEG or WebP, whatever it claims to be', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await put(dataUrl('image/svg+xml', svg))).statusCode).toBe(400);
    expect((await put(dataUrl('image/png', svg))).statusCode).toBe(400);
    expect((await put('not a data url')).statusCode).toBe(400);
    expect((await put(undefined)).statusCode).toBe(400);
  });

  it('refuses pictures over 256 KB', async () => {
    const big = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(300 * 1024)]);
    expect((await put(dataUrl('image/png', big))).statusCode).toBe(413);
  });

  it('remove clears it and its address stops working', async () => {
    const avatar = (await put(dataUrl('image/png', PNG))).json().avatar;
    const del = await app.inject({ method: 'DELETE', url: '/api/auth/avatar', headers: { ...CSRF, cookie } });
    expect(del.statusCode).toBe(200);
    expect((await status(token)).user.avatar).toBeNull();
    expect((await app.inject({ method: 'GET', url: avatar })).statusCode).toBe(404);
  });

  it('needs a sign-in to set one', async () => {
    expect((await put(dataUrl('image/png', PNG), {})).statusCode).toBe(401);
  });

  it('deleting the account deletes the picture', async () => {
    const avatar = (await put(dataUrl('image/png', PNG), { authorization: `Bearer ${otherToken}` })).json().avatar;
    const kid = db.prepare('SELECT id FROM users WHERE username = ?').get('kid') as { id: number };
    await app.inject({ method: 'DELETE', url: `/api/users/${kid.id}`, headers: { ...CSRF, cookie } });
    expect((await app.inject({ method: 'GET', url: avatar })).statusCode).toBe(404);
  });
});
