import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { db, initDb, now } from '../db.js';
import { cacheDir, usePlaybackDataDir } from '../playback/ffmpeg.js';
import { fileKey, type MediaProbe } from '../playback/probe.js';
import { createSession as createStream, startPlayback, stopPlayback, useLauncher } from '../playback/sessions.js';
import { currentVersion } from '../system/updater.js';
import { resetRateLimits } from './rateLimit.js';
import { prepareSetupCode } from './routes.js';
import { createSession, deleteUserSessions } from './sessions.js';
import { STREAM_TOKEN_MS, issueStreamToken, streamTokenUser } from './streamTokens.js';

const probe: MediaProbe = {
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  duration: 60,
  bitrate: 0,
  video: { index: 0, codec: 'h264', profile: null, pixFmt: 'yuv420p', bitDepth: 8, width: 1280, height: 720 },
  audio: [{ index: 1, order: 0, codec: 'aac', channels: 2, language: 'eng', title: null, isDefault: true }],
  subtitles: [{ index: 2, order: 0, codec: 'subrip', language: 'eng', title: null, text: true, isDefault: false, forced: false }] as MediaProbe['subtitles'],
  fonts: [],
  chapters: [],
};
let subFile = '';
vi.mock('../playback/probe.js', async (orig) => ({
  ...(await orig<typeof import('../playback/probe.js')>()),
  probeFile: async () => probe,
  extractSubtitle: async () => subFile,
}));
vi.mock('../playback/ffmpeg.js', async (orig) => ({
  ...(await orig<typeof import('../playback/ffmpeg.js')>()),
  requireFfmpeg: () => ({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }),
}));

const CSRF = { 'x-requested-with': 'mediarr' };
let app: FastifyInstance;
let dataDir: string;
let cookie: string;
let bearer: string;
let userId: number;
let movieId: number;
let otherId: number;

beforeEach(async () => {
  initDb(':memory:');
  resetRateLimits();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediarr-st-'));
  usePlaybackDataDir(dataDir);
  startPlayback();
  app = await buildApp({ dataDir, webDist: null, logLevel: 'silent' });
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    headers: CSRF,
    payload: { code: prepareSetupCode(dataDir)!, username: 'owner', password: 'correct horse battery staple' },
  });
  cookie = String(res.headers['set-cookie']).split(';')[0];
  userId = (db.prepare('SELECT id FROM users WHERE username = ?').get('owner') as { id: number }).id;
  bearer = createSession(userId, '127.0.0.1', 'tv');

  const lib = path.join(dataDir, 'lib');
  const add = (title: string) => {
    const f = path.join(lib, title, `${title}.mp4`);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '0123456789abcdef');
    return Number(
      db
        .prepare(`INSERT INTO media (type, tmdb_id, title, year, root_folder, folder_name, file_path, added_at) VALUES ('movie', ?, ?, 2026, ?, ?, ?, ?)`)
        .run(title.length + title.charCodeAt(0), title, lib, title, f, now()).lastInsertRowid,
    );
  };
  movieId = add('One');
  otherId = add('Two');
  subFile = path.join(dataDir, 'sub.srt');
  fs.writeFileSync(subFile, '1\n00:00:00,000 --> 00:00:01,000\nhi\n');
});
afterEach(async () => {
  stopPlayback();
  vi.useRealTimers();
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: 'GET', url, headers });
const caps = { mp4: true, h264: true, aac: true };

describe('stream tokens', () => {
  it("stream token opens its own title's direct file", async () => {
    const st = issueStreamToken(userId, `movie:${movieId}`, bearer);
    const res = await get(`/api/play/direct/movie/${movieId}?st=${st}`, { range: 'bytes=0-3' });
    expect(res.statusCode).toBe(206);
    expect(res.body).toBe('0123');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it("stream token opens its own title's subtitle", async () => {
    const st = issueStreamToken(userId, `movie:${movieId}`, bearer);
    const res = await get(`/api/play/movie/${movieId}/subtitle/0?st=${st}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('hi');
  });

  it("stream token opens its own title's preview thumbnails (and not another title's)", async () => {
    const file = (db.prepare('SELECT file_path FROM media WHERE id = ?').get(movieId) as { file_path: string }).file_path;
    const dir = path.join(cacheDir('cache', 'trickplay'), fileKey(file));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'sheet0.jpg'), 'jpegbytes');
    const st = issueStreamToken(userId, `movie:${movieId}`, bearer);
    const res = await get(`/api/play/movie/${movieId}/trickplay/0.jpg?st=${st}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('jpegbytes');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    const other = issueStreamToken(userId, `movie:${otherId}`, bearer);
    expect((await get(`/api/play/movie/${movieId}/trickplay/0.jpg?st=${other}`)).statusCode).toBe(401);
  });

  it('stream token for another title', async () => {
    const st = issueStreamToken(userId, `movie:${otherId}`, bearer);
    expect((await get(`/api/play/direct/movie/${movieId}?st=${st}`)).statusCode).toBe(401);
    expect((await get(`/api/play/movie/${movieId}/subtitle/0?st=${st}`)).statusCode).toBe(401);
  });

  it('stream token on /api/home', async () => {
    const st = issueStreamToken(userId, `movie:${movieId}`, bearer);
    expect((await get(`/api/home?st=${st}`)).statusCode).toBe(401);
    expect((await get(`/api/play/movie/${movieId}/info?st=${st}`)).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: `/api/play/hls/x?st=${st}`, headers: CSRF })).statusCode).toBe(401);
  });

  it('wrong or missing stream token', async () => {
    expect((await get(`/api/play/direct/movie/${movieId}?st=nope`)).statusCode).toBe(401);
    expect((await get(`/api/play/direct/movie/${movieId}`)).statusCode).toBe(401);
  });

  it('expired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const st = issueStreamToken(userId, `movie:${movieId}`, bearer);
    vi.setSystemTime(Date.now() + STREAM_TOKEN_MS - 1000);
    expect(streamTokenUser(st, `movie:${movieId}`)).toBe(userId);
    vi.setSystemTime(Date.now() + 2000);
    expect((await get(`/api/play/direct/movie/${movieId}?st=${st}`)).statusCode).toBe(401);
  });

  it('a stream token of a deleted user opens nothing', async () => {
    const st = issueStreamToken(99999, `movie:${movieId}`, bearer);
    expect((await get(`/api/play/direct/movie/${movieId}?st=${st}`)).statusCode).toBe(401);
  });

  it("hls files need a token for that stream's title", async () => {
    useLauncher((_f, _a, s) => spawn(process.execPath, ['-e', 'setTimeout(()=>{},3000)', s.dir], { stdio: ['ignore', 'pipe', 'pipe'] }));
    const s = createStream({
      userId,
      title: `movie:${movieId}`,
      file: 'x.mp4',
      ffmpeg: 'ffmpeg',
      probe,
      decision: { mode: 'transcode', reason: '', audio: 0, burnSubtitle: null, height: null, videoBitrate: 8e6 },
      encoder: 'libx264',
      startAt: 0,
    });
    const good = issueStreamToken(userId, `movie:${movieId}`, bearer);
    const other = issueStreamToken(userId, `movie:${otherId}`, bearer);
    // Past sign-in the route answers 404 for a file name it doesn't serve; without sign-in it would be 401.
    expect((await get(`/api/play/hls/${s.id}/bogus.bin?st=${good}`)).statusCode).toBe(404);
    expect((await get(`/api/play/hls/${s.id}/bogus.bin?st=${other}`)).statusCode).toBe(401);
  });

  it('playlist served to a stream token carries it on every segment line, and the segments then open', async () => {
    useLauncher((_f, _a, s, segment) =>
      spawn(process.execPath, ['-e', "require('fs').writeFileSync(require('path').join(process.argv[1],'seg'+process.argv[2]+'.ts'),'x');setTimeout(()=>{},3000)", s.dir, String(segment)], { stdio: ['ignore', 'pipe', 'pipe'] }),
    );
    const s = createStream({
      userId,
      title: `movie:${movieId}`,
      file: 'x.mp4',
      ffmpeg: 'ffmpeg',
      probe,
      decision: { mode: 'transcode', reason: '', audio: 0, burnSubtitle: null, height: null, videoBitrate: 8e6 },
      encoder: 'libx264',
      startAt: 0,
    });
    const st = issueStreamToken(userId, `movie:${movieId}`, bearer);
    const playlistUrl = `/api/play/hls/${s.id}/main.m3u8?st=${st}`;
    const pl = await get(playlistUrl);
    expect(pl.statusCode).toBe(200);
    const segs = pl.body.split(String.fromCharCode(10)).map((l) => l.trim()).filter((l) => l.startsWith('seg'));
    expect(segs.length).toBeGreaterThan(0);
    for (const l of segs) expect(l).toBe(`${l.split('?')[0]}?st=${encodeURIComponent(st)}`);
    const next = new URL(segs[0], `http://tv.local${playlistUrl}`);
    const seg = await get(next.pathname + next.search);
    expect(seg.statusCode).not.toBe(401);
    // A cookie viewer's playlist is untouched.
    const plain = await get(`/api/play/hls/${s.id}/main.m3u8`, { cookie });
    expect(plain.body).not.toContain('?st=');
  });

  it('signing the TV out ends its stream tokens', async () => {
    const st = issueStreamToken(userId, `movie:${movieId}`, bearer);
    expect((await get(`/api/play/direct/movie/${movieId}?st=${st}`)).statusCode).toBe(200);
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...CSRF, authorization: `Bearer ${bearer}` } });
    expect(out.statusCode).toBe(200);
    expect((await get(`/api/play/direct/movie/${movieId}?st=${st}`)).statusCode).toBe(401);
  });

  it('a password reset (all sessions removed) ends stream tokens', async () => {
    const st = issueStreamToken(userId, `movie:${movieId}`, bearer);
    deleteUserSessions(userId);
    expect((await get(`/api/play/direct/movie/${movieId}?st=${st}`)).statusCode).toBe(401);
  });

  it('start via bearer issues a token tied to that TV session', async () => {
    const body = (await app.inject({ method: 'POST', url: `/api/play/movie/${movieId}/start`, headers: { ...CSRF, authorization: `Bearer ${bearer}` }, payload: { caps } })).json();
    expect((await get(`/api/play/direct/movie/${movieId}?st=${body.streamToken}`)).statusCode).toBe(200);
    deleteUserSessions(userId);
    expect((await get(`/api/play/direct/movie/${movieId}?st=${body.streamToken}`)).statusCode).toBe(401);
  });

  it('cookie sign-in still wins over a stream token', async () => {
    const st = issueStreamToken(userId, `movie:${otherId}`, bearer);
    expect((await get(`/api/home?st=${st}`, { cookie })).statusCode).toBe(200);
  });
});

describe('start', () => {
  const start = (headers: Record<string, string>) =>
    app.inject({ method: 'POST', url: `/api/play/movie/${movieId}/start`, headers: { ...CSRF, ...headers }, payload: { caps } });

  it('start via bearer returns streamToken', async () => {
    const res = await start({ authorization: `Bearer ${bearer}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe('direct');
    expect(streamTokenUser(body.streamToken, `movie:${movieId}`)).toBe(userId);
    expect(streamTokenUser(body.streamToken, `movie:${otherId}`)).toBeNull();
  });

  it('start via cookie has no streamToken', async () => {
    const res = await start({ cookie });
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('streamToken');
  });
});

describe('status for the TV', () => {
  it('signed out has no address or version', async () => {
    const body = (await get('/api/auth/status')).json();
    expect(body).not.toHaveProperty('localUrls');
    expect(body).not.toHaveProperty('version');
  });

  it('signed in has version and home addresses', async () => {
    const body = (await get('/api/auth/status', { cookie })).json();
    expect(body.version).toBe(currentVersion());
    expect(Array.isArray(body.localUrls)).toBe(true);
    for (const u of body.localUrls) expect(u).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/);
  });
});
