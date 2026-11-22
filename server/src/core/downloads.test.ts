import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, initDb, now } from '../db.js';
import { saveSettings } from '../settings.js';
import { pollDownloads } from './downloads.js';
import { prepareFiles } from './fileSelection.js';

let root: string;
let dlId: number;
const calls: string[] = [];
let torrent: { progress: number; state: string; name: string };
let files: { index: number; name: string; size: number; priority: number }[];

beforeEach(() => {
  initDb(':memory:');
  saveSettings({ qbitUrl: 'http://qbit.test:8080', qbitUsername: 'admin', qbitPassword: 'pw' });
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'foxbloom-dl-'));
  const mediaId = Number(
    db
      .prepare(`INSERT INTO media (type, tmdb_id, title, year, root_folder, folder_name, added_at) VALUES ('movie', 438631, 'Dune', 2021, ?, 'Dune (2021)', ?)`)
      .run(root, now()).lastInsertRowid,
  );
  dlId = Number(
    db
      .prepare(`INSERT INTO downloads (media_id, release_title, tag, save_path, state, created_at, updated_at) VALUES (?, 'Dune.2021.1080p.WEB-DL', 'mediarr-1', ?, 'downloading', ?, ?)`)
      .run(mediaId, root, now(), now()).lastInsertRowid,
  );
  calls.length = 0;
  torrent = { progress: 0.4, state: 'downloading', name: 'Dune.2021.1080p.WEB-DL' };
  files = [{ index: 0, name: 'Dune.2021.1080p.WEB-DL/Dune.2021.1080p.WEB-DL.mkv', size: 4_000_000_000, priority: 1 }];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/auth/login')) return new Response('Ok.', { headers: { 'set-cookie': 'SID=abc; path=/' } });
    const p = u.pathname.replace('/api/v2', '');
    calls.push(p);
    if (p === '/torrents/info') return Response.json([{ hash: 'h1', ...torrent, save_path: root, content_path: path.join(root, torrent.name), tags: 'mediarr-1', category: 'mediarr', size: 1 }]);
    if (p === '/torrents/files') return Response.json(files);
    if (p === '/torrents/renameFile') {
      const body = new URLSearchParams(String(init?.body));
      files = files.map((f) => (f.name === body.get('oldPath') ? { ...f, name: body.get('newPath')! } : f));
      return new Response('');
    }
    if (p === '/categories' || p === '/torrents/createCategory') return Response.json({ mediarr: {} });
    return new Response('');
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(root, { recursive: true, force: true });
});

const dl = () => db.prepare('SELECT * FROM downloads WHERE id = ?').get(dlId) as { state: string; renamed: string | null; files_selected: number };

describe('clean file names in qBittorrent', () => {
  it('waits until the download is done: no renaming while it downloads', async () => {
    expect(await prepareFiles(dlId)).toBe(true);
    await pollDownloads();
    expect(calls).not.toContain('/torrents/renameFile');
    expect(dl()).toMatchObject({ files_selected: 1, renamed: null, state: 'downloading' });
  });

  it('renames once it is done, gives qBittorrent a check to finish, then removes and imports it', async () => {
    await prepareFiles(dlId);
    torrent = { ...torrent, progress: 1, state: 'stalledUP' };
    await pollDownloads();
    // Renamed into the movie's folder, but not removed yet: qBittorrent moves the files in the background.
    expect(calls.filter((c) => c === '/torrents/renameFile')).toHaveLength(1);
    expect(files[0].name).toBe('Dune (2021)/Dune (2021) [1080p].mkv');
    expect(calls).not.toContain('/torrents/delete');
    expect(JSON.parse(dl().renamed!)).toEqual({ 'Dune (2021)/Dune (2021) [1080p].mkv': [] });
    expect(dl().state).toBe('downloading');
    // Next check: removed from qBittorrent (keeping the files) and imported; never renamed twice.
    calls.length = 0;
    await pollDownloads();
    expect(calls).toContain('/torrents/delete');
    expect(calls).not.toContain('/torrents/renameFile');
  });
});
