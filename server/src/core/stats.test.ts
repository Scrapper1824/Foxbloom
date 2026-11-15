import { beforeEach, describe, expect, it } from 'vitest';
import { db, initDb, now } from '../db.js';
import { addWatch, dayOf, GUESTS, pruneStats, recordTorrentTotals, resetTorrentTotals, statsReport, statsUser, watchedBetween } from './stats.js';

const DAY = 86_400_000;
const NOW = new Date('2026-11-14T15:00:00');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

let alice: number;
let bob: number;
let movie: number;
let show: number;

beforeEach(() => {
  initDb(':memory:');
  resetTorrentTotals();
  const addUser = db.prepare("INSERT INTO users (username, password_hash, created_at, password_changed_at) VALUES (?, 'x', ?, ?)");
  alice = Number(addUser.run('alice', now(), now()).lastInsertRowid);
  bob = Number(addUser.run('bob', now(), now()).lastInsertRowid);
  const addMedia = db.prepare("INSERT INTO media (type, tmdb_id, title, year, root_folder, folder_name, added_at) VALUES (?, ?, ?, 2026, 'C:\\\\lib', ?, ?)");
  movie = Number(addMedia.run('movie', 1, 'Spider-Man', 'Spider-Man', now()).lastInsertRowid);
  show = Number(addMedia.run('anime', 2, 'My Isekai Life', 'My Isekai Life', now()).lastInsertRowid);
});

describe('watch time between progress saves', () => {
  it('counts forward playback, never more than the time that passed, and nothing after a gap', () => {
    const t = 1_000_000;
    expect(watchedBetween(null, 100, t)).toBe(0);
    expect(watchedBetween({ position: 100, savedAt: t }, 110, t + 10_000)).toBe(10);
    expect(watchedBetween({ position: 100, savedAt: t }, 400, t + 10_000)).toBe(0); // a seek forward
    expect(watchedBetween({ position: 100, savedAt: t }, 90, t + 10_000)).toBe(0); // a seek back
    expect(watchedBetween({ position: 100, savedAt: t }, 110, t + 3_600_000)).toBe(0); // the next sitting
  });

  it('maps watch-party guests to one Guests bucket', () => {
    expect(statsUser(7)).toBe(7);
    expect(statsUser(-3)).toBe(GUESTS);
  });
});

describe('the report', () => {
  it('adds up watch time and streamed data per day, person and title, with every day of the range present', () => {
    addWatch(alice, show, 11, 1800, 900e6, ago(1));
    addWatch(alice, show, 12, 1200, 600e6, ago(1));
    addWatch(bob, show, 11, 600, 300e6, ago(2));
    addWatch(bob, movie, 0, 3600, 3e9, ago(0));
    addWatch(GUESTS, movie, 0, 0, 1e9, ago(0)); // guests: data, no watch time
    addWatch(alice, movie, 0, 999, 1, ago(20)); // outside 7 days

    const r = statsReport(7, NOW);
    expect(r.from).toBe(dayOf(ago(6)));
    expect(r.to).toBe(dayOf(NOW));
    expect(r.daily).toHaveLength(7);
    expect(r.daily.find((d) => d.day === dayOf(ago(1)))).toMatchObject({ streamed: 1.5e9, watch: { [`u${alice}`]: 3000 } });
    expect(r.totals).toMatchObject({ watchSeconds: 7200, viewers: 2, streamedBytes: 5.8e9 });
    expect(r.people.map((p) => [p.name, p.seconds])).toEqual([
      ['bob', 4200],
      ['alice', 3000],
      ['Guests', 0],
    ]);
    expect(r.top.map((t) => [t.title, t.seconds, t.viewers])).toEqual([
      ['My Isekai Life', 3600, 2], // a tie: more people watched it
      ['Spider-Man', 3600, 1],
    ]);
  });

  it('all time includes what was watched before statistics existed', () => {
    db.prepare("INSERT INTO watch_progress (user_id, media_id, episode_id, position, duration, watched, updated_at) VALUES (?, ?, 5, 0, 1440, 1, ?)").run(alice, show, now());
    db.prepare("INSERT INTO watch_progress (user_id, media_id, episode_id, position, duration, watched, updated_at) VALUES (?, ?, 0, 1200, 8700, 0, ?)").run(bob, movie, now());
    const r = statsReport(0, NOW);
    expect(r.top.map((t) => [t.title, t.seconds])).toEqual([
      ['My Isekai Life', 1440],
      ['Spider-Man', 1200],
    ]);
    // Not in a dated range: there's no telling when that happened.
    expect(statsReport(7, NOW).top).toEqual([]);
  });

  it('counts torrent traffic as the daily increase in qBittorrent’s totals, across a qBittorrent restart', () => {
    recordTorrentTotals(1000, 100, ago(1)); // starting point
    recordTorrentTotals(5000, 300, ago(1));
    recordTorrentTotals(7000, 400, NOW);
    recordTorrentTotals(500, 50, NOW); // qBittorrent restarted: counts from zero
    const r = statsReport(7, NOW);
    expect(r.daily.find((d) => d.day === dayOf(ago(1)))).toMatchObject({ torrentDown: 4000, torrentUp: 200 });
    expect(r.daily.find((d) => d.day === dayOf(NOW))).toMatchObject({ torrentDown: 2500, torrentUp: 150 });
    expect(r.totals).toMatchObject({ torrentDown: 6500, torrentUp: 350 });
  });

  it('keeps a year', () => {
    addWatch(alice, movie, 0, 60, 1, ago(400));
    addWatch(alice, movie, 0, 60, 1, ago(10));
    pruneStats(NOW);
    expect((db.prepare('SELECT COUNT(*) AS n FROM watch_stats').get() as { n: number }).n).toBe(1);
  });
});
