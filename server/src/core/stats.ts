import { db } from '../db.js';

/**
 * Viewing and data statistics for admins. Watch time and streamed bytes are kept per person, title and day
 * (user 0 = watch-party guests, who have no account); torrent traffic per day. Nothing older than a year is kept.
 */

export const GUESTS = 0;
const KEEP_DAYS = 365;

/** The server's local calendar day, as YYYY-MM-DD. */
export function dayOf(at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`;
}

/** Stats owner for a playback viewer: an account's id, or GUESTS for a party guest (negative viewer ids). */
export const statsUser = (viewerId: number) => (viewerId > 0 ? viewerId : GUESTS);

export function addWatch(userId: number, mediaId: number, episodeId: number, seconds: number, bytes: number, at = new Date()) {
  if (!(seconds > 0) && !(bytes > 0)) return;
  db.prepare(
    `INSERT INTO watch_stats (user_id, media_id, episode_id, day, seconds, bytes) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, media_id, episode_id, day) DO UPDATE SET seconds = seconds + excluded.seconds, bytes = bytes + excluded.bytes`,
  ).run(userId, mediaId, episodeId, dayOf(at), Math.max(0, seconds), Math.max(0, Math.round(bytes)));
}

/**
 * Seconds actually watched between two progress saves: how far playback moved forward, but never more than
 * the time that passed (plus a little slack), and nothing after a long gap (a seek, or the next sitting).
 */
export function watchedBetween(prev: { position: number; savedAt: number } | null, position: number, now: number): number {
  if (!prev) return 0;
  const moved = position - prev.position;
  const wall = (now - prev.savedAt) / 1000;
  if (moved <= 0 || wall <= 0 || wall > 120 || moved > wall + 5) return 0;
  return moved;
}

// ---- Torrent traffic (qBittorrent reports totals since it started; we keep the daily increase) ----

let lastTotals: { down: number; up: number } | null = null;

/** Records qBittorrent's running totals; a drop means qBittorrent restarted, so the new totals are all new. */
export function recordTorrentTotals(down: number, up: number, at = new Date()) {
  if (!Number.isFinite(down) || !Number.isFinite(up)) return;
  const prev = lastTotals;
  lastTotals = { down, up };
  if (!prev) return; // the first reading only sets the starting point
  const dDown = down >= prev.down ? down - prev.down : down;
  const dUp = up >= prev.up ? up - prev.up : up;
  if (!dDown && !dUp) return;
  db.prepare(
    `INSERT INTO traffic_stats (day, torrent_down, torrent_up) VALUES (?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET torrent_down = torrent_down + excluded.torrent_down, torrent_up = torrent_up + excluded.torrent_up`,
  ).run(dayOf(at), dDown, dUp);
}
export const resetTorrentTotals = () => (lastTotals = null);

export function pruneStats(now = new Date()) {
  const cutoff = dayOf(new Date(now.getTime() - KEEP_DAYS * 86_400_000));
  db.prepare('DELETE FROM watch_stats WHERE day < ?').run(cutoff);
  db.prepare('DELETE FROM traffic_stats WHERE day < ?').run(cutoff);
}

// ---- The report ----

export interface StatsReport {
  days: number;
  from: string;
  to: string;
  totals: { watchSeconds: number; viewers: number; streamedBytes: number; torrentDown: number; torrentUp: number };
  daily: { day: string; streamed: number; torrentDown: number; torrentUp: number; watch: Record<string, number> }[];
  people: { key: string; name: string; seconds: number; bytes: number; lastWatched: string | null }[];
  top: { mediaId: number; title: string; type: string; poster: string | null; seconds: number; viewers: number }[];
  /** First day anything was recorded (null: nothing yet). */
  since: string | null;
}

const keyFor = (userId: number) => (userId === GUESTS ? 'guests' : `u${userId}`);

/** The last `days` days (0 = everything kept). */
export function statsReport(days: number, now = new Date()): StatsReport {
  const to = dayOf(now);
  const since = (db.prepare('SELECT MIN(day) AS d FROM (SELECT MIN(day) AS day FROM watch_stats UNION ALL SELECT MIN(day) FROM traffic_stats)').get() as { d: string | null }).d;
  const from = days > 0 ? dayOf(new Date(now.getTime() - (days - 1) * 86_400_000)) : (since ?? to);

  const rows = db
    .prepare('SELECT user_id, media_id, day, seconds, bytes FROM watch_stats WHERE day >= ? AND day <= ?')
    .all(from, to) as { user_id: number; media_id: number; day: string; seconds: number; bytes: number }[];
  const traffic = db.prepare('SELECT day, torrent_down, torrent_up FROM traffic_stats WHERE day >= ? AND day <= ?').all(from, to) as {
    day: string;
    torrent_down: number;
    torrent_up: number;
  }[];

  // Every day in the range, so the charts have no holes.
  const daily = new Map<string, StatsReport['daily'][number]>();
  for (let t = new Date(`${from}T12:00:00`); dayOf(t) <= to; t = new Date(t.getTime() + 86_400_000)) {
    daily.set(dayOf(t), { day: dayOf(t), streamed: 0, torrentDown: 0, torrentUp: 0, watch: {} });
  }
  const people = new Map<number, { seconds: number; bytes: number }>();
  const titles = new Map<number, { seconds: number; viewers: Set<number> }>();
  for (const r of rows) {
    const d = daily.get(r.day);
    if (d) {
      d.streamed += r.bytes;
      if (r.seconds > 0) d.watch[keyFor(r.user_id)] = (d.watch[keyFor(r.user_id)] ?? 0) + r.seconds;
    }
    const p = people.get(r.user_id) ?? { seconds: 0, bytes: 0 };
    p.seconds += r.seconds;
    p.bytes += r.bytes;
    people.set(r.user_id, p);
    const t = titles.get(r.media_id) ?? { seconds: 0, viewers: new Set<number>() };
    t.seconds += r.seconds;
    if (r.seconds > 0) t.viewers.add(r.user_id);
    titles.set(r.media_id, t);
  }
  for (const r of traffic) {
    const d = daily.get(r.day);
    if (d) {
      d.torrentDown += r.torrent_down;
      d.torrentUp += r.torrent_up;
    }
  }

  // All time: titles watched before statistics existed still count, from the progress already saved.
  if (days === 0) {
    const saved = db
      .prepare(
        `SELECT media_id, user_id, SUM(CASE WHEN watched = 1 THEN duration ELSE position END) AS seconds
         FROM watch_progress GROUP BY media_id, user_id`,
      )
      .all() as { media_id: number; user_id: number; seconds: number }[];
    const fromProgress = new Map<number, { seconds: number; viewers: Set<number> }>();
    for (const s of saved) {
      if (!(s.seconds > 0)) continue;
      const t = fromProgress.get(s.media_id) ?? { seconds: 0, viewers: new Set<number>() };
      t.seconds += s.seconds;
      t.viewers.add(s.user_id);
      fromProgress.set(s.media_id, t);
    }
    for (const [id, p] of fromProgress) {
      const t = titles.get(id) ?? { seconds: 0, viewers: new Set<number>() };
      // Whichever saw more (the two overlap for anything watched since statistics started).
      if (p.seconds > t.seconds) t.seconds = p.seconds;
      for (const v of p.viewers) t.viewers.add(v);
      titles.set(id, t);
    }
  }

  const names = new Map((db.prepare('SELECT id, username FROM users').all() as { id: number; username: string }[]).map((u) => [u.id, u.username]));
  const lastWatched = new Map(
    (db.prepare('SELECT user_id, MAX(updated_at) AS at FROM watch_progress GROUP BY user_id').all() as { user_id: number; at: string }[]).map((r) => [r.user_id, r.at]),
  );
  const peopleOut = [...people]
    .filter(([id]) => id === GUESTS || names.has(id))
    .map(([id, p]) => ({ key: keyFor(id), name: id === GUESTS ? 'Guests' : names.get(id)!, seconds: p.seconds, bytes: p.bytes, lastWatched: lastWatched.get(id) ?? null }))
    .sort((a, b) => b.seconds - a.seconds || b.bytes - a.bytes);

  const media = db.prepare('SELECT id, title, type, poster FROM media WHERE id = ?');
  const top = [...titles]
    .filter(([, t]) => t.seconds > 0)
    .map(([id, t]) => {
      const m = media.get(id) as { id: number; title: string; type: string; poster: string | null } | undefined;
      return m ? { mediaId: id, title: m.title, type: m.type, poster: m.poster, seconds: t.seconds, viewers: t.viewers.size } : null;
    })
    .filter((t): t is NonNullable<typeof t> => !!t)
    .sort((a, b) => b.seconds - a.seconds || b.viewers - a.viewers || a.title.localeCompare(b.title))
    .slice(0, 30);

  const dailyOut = [...daily.values()];
  return {
    days,
    from,
    to,
    since,
    daily: dailyOut,
    people: peopleOut,
    top,
    totals: {
      watchSeconds: peopleOut.reduce((s, p) => s + p.seconds, 0),
      viewers: peopleOut.filter((p) => p.seconds > 0).length,
      streamedBytes: dailyOut.reduce((s, d) => s + d.streamed, 0),
      torrentDown: dailyOut.reduce((s, d) => s + d.torrentDown, 0),
      torrentUp: dailyOut.reduce((s, d) => s + d.torrentUp, 0),
    },
  };
}

// ---- Background: torrent traffic every 5 minutes, old records trimmed daily ----

let timers: NodeJS.Timeout[] = [];

export function startStats(readTotals: () => Promise<{ down: number; up: number }>, configured: () => boolean) {
  stopStats();
  const poll = () => {
    if (!configured()) return;
    readTotals()
      .then((t) => recordTorrentTotals(t.down, t.up))
      .catch(() => {}); // qBittorrent away for a moment: try again next time
  };
  poll();
  pruneStats();
  timers = [setInterval(poll, 5 * 60_000).unref(), setInterval(() => pruneStats(), 24 * 3600_000).unref()];
}

export function stopStats() {
  for (const t of timers) clearInterval(t);
  timers = [];
  resetTorrentTotals();
}
