import path from 'node:path';
import { deleteTorrent, listTorrents, torrentFiles, torrentStatus } from '../clients/qbittorrent.js';
import { db, logHistory, now, type DownloadRow } from '../db.js';
import { prepareFiles } from './fileSelection.js';
import { importDownload } from './importer.js';
import { queueMediaWork } from '../playback/jobs.js';

const LOST_AFTER_MS = 10 * 60_000;
/** A download that gets no further for this long is dropped, its release blocked, and another one searched for. */
export const DEAD_AFTER_MS = 2 * 3600_000;
/** qBittorrent states where a download should be moving. Paused, queued and checking ones are left alone. */
const ACTIVE_DL_STATES = new Set(['downloading', 'forcedDL', 'stalledDL', 'metaDL', 'forcedMetaDL']);

/** Where a download's files go once qBittorrent has given them their clean names (absolute paths). */
export function downloadTargets(dl: Pick<DownloadRow, 'save_path' | 'renamed'>): string[] {
  let renamed: Record<string, unknown> = {};
  try {
    renamed = JSON.parse(dl.renamed ?? '{}') as Record<string, unknown>;
  } catch {
    /* nothing recorded */
  }
  return Object.keys(renamed).map((rel) => path.resolve(dl.save_path, rel));
}

/**
 * Files of a title that qBittorrent is still writing (under their final names, in the library folder), lower-cased:
 * the library scan must not count them as episodes you have.
 */
export function downloadingFiles(mediaId: number): Set<string> {
  const rows = db
    .prepare("SELECT save_path, renamed FROM downloads WHERE media_id = ? AND state IN ('queued','downloading','importing') AND renamed IS NOT NULL")
    .all(mediaId) as Pick<DownloadRow, 'save_path' | 'renamed'>[];
  return new Set(rows.flatMap((r) => downloadTargets(r).map((p) => p.toLowerCase())));
}

/** Never grab this release for this title again (it was grabbed once and stopped downloading). */
export function blockRelease(mediaId: number, infoHash: string | null, title: string, reason: string) {
  db.prepare('INSERT INTO release_blocklist (media_id, info_hash, title, reason, created_at) VALUES (?, ?, ?, ?, ?)').run(
    mediaId,
    infoHash ? infoHash.toLowerCase() : null,
    title,
    reason,
    now(),
  );
}

/** The blocked releases of a title, as the scoring wants them. */
export function blockedReleases(mediaId: number): { hashes: Set<string>; titles: Set<string> } {
  const rows = db.prepare('SELECT info_hash, title FROM release_blocklist WHERE media_id = ?').all(mediaId) as { info_hash: string | null; title: string }[];
  return { hashes: new Set(rows.flatMap((r) => (r.info_hash ? [r.info_hash] : []))), titles: new Set(rows.map((r) => r.title.trim().toLowerCase())) };
}

/**
 * Drops a download that stopped getting anywhere (no seeders left, fake seeders, metadata that never arrives):
 * removes it and its partial files from qBittorrent, blocks the release, and searches for another one.
 */
async function giveUp(dl: DownloadRow, hash: string): Promise<void> {
  try {
    await deleteTorrent(hash, true);
  } catch (err) {
    console.warn(`[downloads] couldn't remove stalled "${dl.release_title}": ${(err as Error).message}`);
    return; // try again on the next check
  }
  const hours = Math.round(DEAD_AFTER_MS / 3600_000);
  blockRelease(dl.media_id, hash, dl.release_title, 'stopped downloading');
  // Its half-written files may have been counted as episodes you have (older versions did): forget them, so the
  // search below looks for those episodes again.
  const gone = new Set(downloadTargets(dl).map((p) => p.toLowerCase()));
  if (gone.size) {
    const files = db.prepare('SELECT id, file_path FROM episodes WHERE media_id = ? AND file_path IS NOT NULL').all(dl.media_id) as { id: number; file_path: string }[];
    const clear = db.prepare('UPDATE episodes SET has_file = 0, file_path = NULL WHERE id = ?');
    for (const e of files) if (gone.has(path.resolve(e.file_path).toLowerCase())) clear.run(e.id);
    db.prepare('UPDATE media SET has_file = 0, file_path = NULL WHERE id = ? AND file_path IS NOT NULL AND LOWER(file_path) IN (' + [...gone].map(() => '?').join(',') + ')').run(
      dl.media_id,
      ...[...gone].map((p) => p.toLowerCase()),
    );
  }
  setState(dl.id, { state: 'failed', error: `Stopped downloading (no progress for ${hours} hours): removed, and Foxbloom is looking for another release` });
  logHistory(dl.media_id, 'failed', `"${dl.release_title}" stopped downloading for ${hours} hours, so it was removed and won't be grabbed again. Looking for another release.`);
  const episodeIds = JSON.parse(dl.episode_ids || '[]') as number[];
  // Not awaited: a search can take a while, and the other downloads still need checking.
  void import('./grabber.js')
    .then(({ autoSearch }) => autoSearch(dl.media_id, { force: true, ...(episodeIds.length ? { episodeIds } : {}) }))
    .catch((err) => console.warn(`[downloads] re-search after "${dl.release_title}" failed: ${(err as Error).message}`));
}

function setState(id: number, fields: Partial<DownloadRow>) {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE downloads SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(
    ...(Object.values(fields) as (string | number | null)[]),
    now(),
    id,
  );
}

export async function runImport(dl: DownloadRow): Promise<void> {
  if (!dl.content_path) throw new Error('Unknown download location');
  setState(dl.id, { state: 'importing', error: null });
  try {
    const files = dl.torrent_files ? (JSON.parse(dl.torrent_files) as string[]) : undefined;
    await importDownload(dl, dl.content_path, files);
    setState(dl.id, { state: 'imported', progress: 1 });
    // New files: find their intros/credits and make seek-bar thumbnails in the background.
    queueMediaWork(dl.media_id);
  } catch (err) {
    setState(dl.id, { state: 'failed', error: `Import failed: ${(err as Error).message}` });
    logHistory(dl.media_id, 'failed', `Import of "${dl.release_title}" failed: ${(err as Error).message}`);
  }
}

/** Syncs active downloads with qBittorrent and imports finished ones. */
export async function pollDownloads(): Promise<void> {
  const active = db
    .prepare("SELECT * FROM downloads WHERE state IN ('queued','downloading')")
    .all() as unknown as DownloadRow[];
  if (!active.length) return;

  const torrents = await listTorrents();
  const byTag = new Map<string, (typeof torrents)[number]>();
  for (const t of torrents) for (const tag of t.tags.split(',')) byTag.set(tag.trim(), t);

  for (const dl of active) {
    // Skip unwanted files of bundles and give the rest clean names, as soon as qBittorrent knows them.
    const justPrepared = !dl.files_selected && (await prepareFiles(dl.id).catch(() => false));
    const t = byTag.get(dl.tag);
    if (!t) {
      if (dl.state === 'downloading' || Date.now() - new Date(dl.created_at).getTime() > LOST_AFTER_MS) {
        setState(dl.id, { state: 'failed', error: 'Torrent is no longer in qBittorrent' });
        logHistory(dl.media_id, 'failed', `"${dl.release_title}" disappeared from qBittorrent`);
      }
      continue;
    }

    const status = torrentStatus(t);
    const contentPath = t.content_path || path.join(t.save_path, t.name);
    if (status === 'error') {
      setState(dl.id, { state: 'failed', qbit_hash: t.hash, error: `qBittorrent reports ${t.state}` });
      logHistory(dl.media_id, 'failed', `"${dl.release_title}" errored in qBittorrent (${t.state})`);
      continue;
    }
    // Renaming a finished torrent's files happens in the background in qBittorrent: give it a poll to finish.
    if (status === 'downloading' || justPrepared) {
      // Progress since the last check (or first sight of it) restarts the clock; a download stuck for too long is replaced.
      const moved = t.progress > dl.progress + 1e-6 || dl.progress_at === null;
      if (!moved && ACTIVE_DL_STATES.has(t.state) && t.progress < 1 && Date.now() - new Date(dl.progress_at!).getTime() > DEAD_AFTER_MS) {
        await giveUp(dl, t.hash);
        continue;
      }
      setState(dl.id, { state: 'downloading', qbit_hash: t.hash, progress: t.progress, content_path: contentPath, ...(moved ? { progress_at: now() } : {}) });
      continue;
    }

    // The exact files to import (by their final names); qBittorrent forgets them once the torrent is removed.
    const files = await torrentFiles(t.hash)
      .then((list) => list.filter((f) => f.priority > 0).map((f) => f.name))
      .catch(() => null);
    const torrentFilesJson = files?.length ? JSON.stringify(files) : null;

    // Done: remove from qBittorrent (keeping files) so Windows releases the file handles, then rename.
    setState(dl.id, {
      state: 'importing',
      qbit_hash: t.hash,
      progress: 1,
      content_path: contentPath,
      save_path: t.save_path,
      torrent_files: torrentFilesJson,
    });
    try {
      await deleteTorrent(t.hash, false);
    } catch (err) {
      setState(dl.id, { state: 'downloading', error: `Could not remove torrent: ${(err as Error).message}` });
      continue;
    }
    await runImport({ ...dl, content_path: contentPath, save_path: t.save_path, torrent_files: torrentFilesJson });
  }
}

// ---- Live progress for the Downloads page ----

let live: { at: number; torrents: Promise<Awaited<ReturnType<typeof listTorrents>>> } | null = null;
const LIVE_MS = 2000;

/** qBittorrent's torrents, asked at most every 2 s however many pages are open. */
function liveTorrents() {
  if (!live || Date.now() - live.at > LIVE_MS) {
    const torrents = listTorrents();
    live = { at: Date.now(), torrents };
    torrents.catch(() => (live = null));
  }
  return live.torrents;
}

export interface LiveDownload {
  progress: number;
  /** Bytes per second; 0 when stalled or paused. */
  speed: number | null;
  /** Seconds left, when qBittorrent can tell. */
  eta: number | null;
}

/**
 * Downloads with their progress as qBittorrent has it right now (the stored value is only updated by the
 * background check). If qBittorrent can't be reached, the stored progress is shown as it is.
 */
export async function withLiveProgress<T extends Pick<DownloadRow, 'tag' | 'state' | 'progress'>>(rows: T[]): Promise<(T & Partial<LiveDownload>)[]> {
  if (!rows.some((r) => r.state === 'queued' || r.state === 'downloading')) return rows;
  let torrents: Awaited<ReturnType<typeof listTorrents>>;
  try {
    torrents = await liveTorrents();
  } catch {
    return rows;
  }
  const byTag = new Map<string, (typeof torrents)[number]>();
  for (const t of torrents) for (const tag of t.tags.split(',')) byTag.set(tag.trim(), t);
  return rows.map((r) => {
    const t = r.state === 'queued' || r.state === 'downloading' ? byTag.get(r.tag) : undefined;
    if (!t) return r;
    // qBittorrent's "infinity" for an unknown ETA is 8640000 s (100 days).
    const eta = t.eta > 0 && t.eta < 8640000 ? t.eta : null;
    return { ...r, progress: Math.max(r.progress, t.progress), speed: t.dlspeed ?? null, eta };
  });
}
