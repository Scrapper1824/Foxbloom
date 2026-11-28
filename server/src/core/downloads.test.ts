import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const autoSearch = vi.fn(async () => 0);
vi.mock('./grabber.js', () => ({ autoSearch }));

const dbm = await import('../db.js');
const { initDb, now } = dbm;
const { saveSettings } = await import('../settings.js');
const { pollDownloads, DEAD_AFTER_MS } = await import('./downloads.js');

let dlId: number;
let mediaId: number;
const calls: { path: string; body: string }[] = [];
let torrent: Record<string, unknown>;

beforeEach(() => {
  initDb(':memory:');
  saveSettings({ qbitUrl: 'http://qbit.test:8080', qbitUsername: 'admin', qbitPassword: 'pw' });
  mediaId = Number(
    dbm.db.prepare(`INSERT INTO media (type, tmdb_id, title, year, root_folder, folder_name, added_at) VALUES ('show', 84773, 'The Rings of Power', 2022, 'D:/TV', 'The Rings of Power (2022)', ?)`).run(now()).lastInsertRowid,
  );
  dlId = Number(
    dbm.db
      .prepare(
        `INSERT INTO downloads (media_id, episode_ids, release_title, tag, qbit_hash, save_path, state, progress, files_selected, created_at, updated_at)
         VALUES (?, '[11]', 'The.Rings.of.Power.S01E01.1080p.WEB-DL-NTb', 'mediarr-14', 'deadbeef', 'D:/TV', 'downloading', 0.1, 1, ?, ?)`,
      )
      .run(mediaId, '2026-10-01T00:00:00.000Z', now()).lastInsertRowid,
  );
  calls.length = 0;
  autoSearch.mockClear();
  torrent = { hash: 'deadbeef', name: 'x', progress: 0.1, state: 'stalledDL', save_path: 'D:/TV', tags: 'mediarr-14', category: 'mediarr', size: 1, dlspeed: 0, eta: 8640000, num_seeds: 0, num_complete: 0 };
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/auth/login')) return new Response('Ok.', { headers: { 'set-cookie': 'SID=abc; path=/' } });
    const p = u.pathname.replace('/api/v2', '');
    calls.push({ path: p, body: String(init?.body ?? '') });
    if (p === '/torrents/info') return Response.json([torrent]);
    return new Response('');
  });
});
afterEach(() => vi.unstubAllGlobals());

const row = () => dbm.db.prepare('SELECT state, error, progress_at FROM downloads WHERE id = ?').get(dlId) as { state: string; error: string | null; progress_at: string | null };
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

describe('downloads that stop downloading', () => {
  it('gives an existing download a grace period first instead of dropping it straight away', async () => {
    await pollDownloads();
    expect(row().state).toBe('downloading');
    expect(row().progress_at).not.toBeNull();
    expect(calls.some((c) => c.path === '/torrents/delete')).toBe(false);
  });

  it('keeps a slow download that is still moving', async () => {
    dbm.db.prepare('UPDATE downloads SET progress_at = ? WHERE id = ?').run(ago(DEAD_AFTER_MS + 60_000), dlId);
    torrent = { ...torrent, progress: 0.12, state: 'downloading', dlspeed: 2000 };
    await pollDownloads();
    expect(row().state).toBe('downloading');
    expect(Date.now() - new Date(row().progress_at!).getTime()).toBeLessThan(60_000);
  });

  it('drops one that made no progress for too long, blocks that release and searches again', async () => {
    dbm.db.prepare('UPDATE downloads SET progress_at = ? WHERE id = ?').run(ago(DEAD_AFTER_MS + 60_000), dlId);
    await pollDownloads();
    const del = calls.find((c) => c.path === '/torrents/delete');
    expect(del && new URLSearchParams(del.body).get('deleteFiles')).toBe('true');
    expect(row().state).toBe('failed');
    expect(row().error).toMatch(/stopped downloading/i);
    const blocked = dbm.db.prepare('SELECT info_hash, title FROM release_blocklist WHERE media_id = ?').all(mediaId);
    expect(blocked).toEqual([{ info_hash: 'deadbeef', title: 'The.Rings.of.Power.S01E01.1080p.WEB-DL-NTb' }]);
    await vi.waitFor(() => expect(autoSearch).toHaveBeenCalledWith(mediaId, expect.objectContaining({ episodeIds: [11] })));
  });

  it('forgets the half-downloaded file, so the episode is searched for again', async () => {
    dbm.db.prepare('UPDATE downloads SET progress_at = ?, renamed = ? WHERE id = ?').run(
      ago(DEAD_AFTER_MS + 60_000),
      JSON.stringify({ 'The Rings of Power (2022)/Season 01/The Rings of Power - S01E01.mkv': [11] }),
      dlId,
    );
    dbm.db
      .prepare('INSERT INTO episodes (id, media_id, season, episode, has_file, file_path) VALUES (11, ?, 1, 1, 1, ?), (12, ?, 1, 2, 1, ?)')
      .run(mediaId, 'D:/TV/The Rings of Power (2022)/Season 01/The Rings of Power - S01E01.mkv', mediaId, 'D:/TV/The Rings of Power (2022)/Season 01/The Rings of Power - S01E02.mkv');
    await pollDownloads();
    const eps = dbm.db.prepare('SELECT id, has_file FROM episodes ORDER BY id').all();
    expect(eps).toEqual([
      { id: 11, has_file: 0 },
      { id: 12, has_file: 1 }, // a real file of another episode is left alone
    ]);
  });

  it('leaves alone a download you paused, or one waiting in qBittorrent’s queue', async () => {
    dbm.db.prepare('UPDATE downloads SET progress_at = ? WHERE id = ?').run(ago(DEAD_AFTER_MS + 60_000), dlId);
    for (const state of ['stoppedDL', 'pausedDL', 'queuedDL', 'checkingDL']) {
      torrent = { ...torrent, state };
      await pollDownloads();
      expect(row().state).toBe('downloading');
    }
  });
});
