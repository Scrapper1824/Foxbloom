import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, initDb, now, type MediaRow } from '../db.js';
import { saveSettings } from '../settings.js';
import { searchReleases } from './grabber.js';

const queries: string[] = [];
let answer: (q: string) => { title: string; seeders: number }[];

beforeEach(() => {
  initDb(':memory:');
  saveSettings({ prowlarrUrl: 'http://prowlarr.test:9696', prowlarrApiKey: 'k' });
  queries.length = 0;
  vi.stubGlobal('fetch', async (url: string) => {
    const u = new URL(url);
    if (!u.pathname.endsWith('/api/v1/search')) return Response.json({});
    const q = u.searchParams.get('query')!;
    queries.push(q);
    return Response.json(answer(q).map((r, i) => ({ guid: `${q}-${i}`, size: 2 * 1024 ** 3, leechers: 0, indexer: 'x', indexerId: 1, protocol: 'torrent', ...r })));
  });
});
afterEach(() => vi.unstubAllGlobals());

function media(type: 'movie' | 'show', title: string, year: number): MediaRow {
  const id = Number(
    db
      .prepare(`INSERT INTO media (type, tmdb_id, title, year, root_folder, folder_name, added_at, adult_checked) VALUES (?, 1, ?, ?, 'D:/x', ?, ?, 1)`)
      .run(type, title, year, title, now()).lastInsertRowid,
  );
  return db.prepare('SELECT * FROM media WHERE id = ?').get(id) as unknown as MediaRow;
}

describe('the wider search when the exact one finds nothing', () => {
  it('finds a movie whose releases leave out the year', async () => {
    const m = media('movie', 'Dune', 2021);
    answer = (q) => (q === 'Dune' ? [{ title: 'Dune.1080p.WEB-DL.x264-GRP', seeders: 80 }] : []);
    expect((await searchReleases(m, { kind: 'movie' })).filter((r) => !r.rejections.length)).toHaveLength(0);
    expect(queries).toEqual(['Dune 2021']);
    const wide = await searchReleases(m, { kind: 'movie' }, 'broad');
    expect(queries).toContain('Dune');
    expect(wide.find((r) => !r.rejections.length)?.title).toBe('Dune.1080p.WEB-DL.x264-GRP');
  });

  it('finds an episode named 1x01 with a title-only search', async () => {
    const m = media('show', 'Severance', 2022);
    answer = (q) => (q === 'Severance' ? [{ title: 'Severance.1x01.Good.News.About.Hell.1080p.WEB-DL', seeders: 40 }, { title: 'Severance.1x02.720p.WEB', seeders: 40 }] : []);
    const wide = await searchReleases(m, { kind: 'episode', season: 1, episode: 1 }, 'broad');
    expect(queries).toEqual(['Severance S01E01', 'Severance']);
    const ok = wide.filter((r) => !r.rejections.length).map((r) => r.title);
    expect(ok).toEqual(['Severance.1x01.Good.News.About.Hell.1080p.WEB-DL']);
  });
});
