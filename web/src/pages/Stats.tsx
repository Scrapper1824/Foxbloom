import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, timeAgo, type MediaType, type StatsReport } from '../api';
import { LineChart, Legend, OTHER, SERIES, StackedBars, type StackSegment } from '../components/charts';
import Spinner from '../components/Spinner';

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 0, label: 'All time' },
];

export function formatBytes(b: number): string {
  if (b >= 1e12) return `${(b / 1e12).toFixed(b >= 1e13 ? 0 : 1)} TB`;
  if (b >= 1e9) return `${(b / 1e9).toFixed(b >= 1e10 ? 0 : 1)} GB`;
  if (b >= 1e6) return `${Math.round(b / 1e6)} MB`;
  if (b > 0) return `${Math.max(1, Math.round(b / 1e3))} KB`;
  return '0';
}

export function formatHours(s: number): string {
  if (s >= 3600) return `${(s / 3600).toFixed(s >= 36000 ? 0 : 1)} h`;
  if (s >= 60) return `${Math.round(s / 60)} min`;
  return s > 0 ? '<1 min' : '0';
}

const TYPE_LABEL: Record<MediaType, string> = { movie: 'Movies', show: 'Shows', anime: 'Anime' };

/**
 * One colour per person that doesn't change with the range or ranking: accounts in id order, then guests;
 * past eight, the rest fold into "Other".
 */
function personSegments(people: StatsReport['people']): { segments: StackSegment[]; group: (key: string) => string } {
  // Only people with watch time (guests stream, but their watching isn't timed).
  const keys = people
    .filter((p) => p.seconds > 0)
    .map((p) => p.key)
    .sort((a, b) => (a === 'guests' ? 1 : b === 'guests' ? -1 : Number(a.slice(1)) - Number(b.slice(1))));
  const name = new Map(people.map((p) => [p.key, p.name]));
  const shown = keys.length > SERIES.length ? keys.slice(0, SERIES.length - 1) : keys;
  const segments: StackSegment[] = shown.map((k, i) => ({ key: k, label: name.get(k) ?? k, color: SERIES[i] }));
  if (keys.length > shown.length) segments.push({ key: 'other', label: 'Other', color: OTHER });
  return { segments, group: (k) => (shown.includes(k) ? k : 'other') };
}

function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="chart-table">
      <summary>Show as a table</summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Admins: who watches what, and how much data streaming and torrents use. */
export default function Stats() {
  const [days, setDays] = useState(30);
  const [type, setType] = useState<'all' | MediaType>('all');
  const q = useQuery({ queryKey: ['stats', days], queryFn: () => api.get<StatsReport>(`/api/stats?days=${days}`), refetchInterval: 5 * 60_000 });
  const r = q.data;

  const dayLabels = r?.daily.map((d) => d.day) ?? [];
  const dataSeries = r
    ? [
        { key: 'streamed', label: 'Streaming to viewers', color: SERIES[0], values: r.daily.map((d) => d.streamed) },
        { key: 'down', label: 'Torrents downloaded', color: SERIES[1], values: r.daily.map((d) => d.torrentDown) },
        { key: 'up', label: 'Torrents uploaded', color: SERIES[2], values: r.daily.map((d) => d.torrentUp) },
      ]
    : [];
  const persons = r ? personSegments(r.people) : null;
  const watchValue = (i: number, seg: string) => {
    const w = r!.daily[i].watch;
    return Object.entries(w).reduce((s, [k, v]) => (persons!.group(k) === seg ? s + v : s), 0);
  };
  const top = (r?.top ?? []).filter((t) => type === 'all' || t.type === type).slice(0, 10);

  return (
    <div className="page stats">
      <div className="page-head stats-head">
        <div>
          <h1>Statistics</h1>
          <p className="muted small">
            {r?.since ? `Counting since ${new Date(`${r.since}T12:00:00`).toLocaleDateString()}.` : 'Counting starts now: watch time and data show up here as people watch.'}
          </p>
        </div>
        <div className="segmented" role="tablist" aria-label="Time range">
          {RANGES.map((x) => (
            <button key={x.days} role="tab" aria-selected={days === x.days} className={days === x.days ? 'on' : ''} onClick={() => setDays(x.days)}>
              {x.label}
            </button>
          ))}
        </div>
      </div>

      {q.error && <div className="error-box">Couldn’t load the statistics: {(q.error as Error).message}</div>}
      {!r && q.isLoading && (
        <div className="stats-loading">
          <Spinner size={22} />
        </div>
      )}

      {r && (
        <>
          <div className="stats-tiles">
            <div className="stats-tile">
              <span>Watch time</span>
              <strong>{formatHours(r.totals.watchSeconds)}</strong>
            </div>
            <div className="stats-tile">
              <span>People watching</span>
              <strong>{r.totals.viewers}</strong>
            </div>
            <div className="stats-tile">
              <span>Streamed to viewers</span>
              <strong>{formatBytes(r.totals.streamedBytes)}</strong>
            </div>
            <div className="stats-tile">
              <span>Torrents ↓ / ↑</span>
              <strong>
                {formatBytes(r.totals.torrentDown)} <small>/</small> {formatBytes(r.totals.torrentUp)}
              </strong>
            </div>
          </div>

          <section className="stats-card">
            <h2>Data used per day</h2>
            <Legend items={dataSeries} />
            <LineChart days={dayLabels} series={dataSeries} format={formatBytes} label="Data used per day: streaming to viewers, torrents downloaded and torrents uploaded" />
            <DataTable
              head={['Day', 'Streaming to viewers', 'Torrents downloaded', 'Torrents uploaded']}
              rows={r.daily.map((d) => [d.day, formatBytes(d.streamed), formatBytes(d.torrentDown), formatBytes(d.torrentUp)])}
            />
          </section>

          <section className="stats-card">
            <h2>Watch time per day</h2>
            {persons!.segments.length > 0 ? (
              <>
                <Legend items={persons!.segments} />
                <StackedBars days={dayLabels} segments={persons!.segments} value={watchValue} format={formatHours} label="Watch time per day, by person" />
                <DataTable
                  head={['Day', ...persons!.segments.map((s) => s.label)]}
                  rows={r.daily.map((d, i) => [d.day, ...persons!.segments.map((s) => formatHours(watchValue(i, s.key)))])}
                />
              </>
            ) : (
              <p className="muted small">Nobody has watched anything in this range yet.</p>
            )}
          </section>

          <div className="stats-columns">
            <section className="stats-card">
              <div className="stats-card-head">
                <h2>Most watched</h2>
                <select className="input small-input" value={type} onChange={(e) => setType(e.target.value as 'all' | MediaType)} aria-label="Show only">
                  <option value="all">Everything</option>
                  {(Object.keys(TYPE_LABEL) as MediaType[]).map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </div>
              {top.length ? (
                <ol className="stats-top">
                  {top.map((t, i) => (
                    <li key={t.mediaId}>
                      <span className="stats-rank">{i + 1}</span>
                      <Link to={`/media/${t.mediaId}`} className="stats-title">
                        {t.title}
                      </Link>
                      <span className="muted small">
                        {formatHours(t.seconds)} · {t.viewers} {t.viewers === 1 ? 'person' : 'people'}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted small">Nothing watched in this range yet.</p>
              )}
            </section>

            <section className="stats-card">
              <h2>People</h2>
              {r.people.length ? (
                <div className="table-scroll">
                  <table className="stats-people">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Watch time</th>
                        <th>Data streamed</th>
                        <th>Last watched</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.people.map((p) => (
                        <tr key={p.key}>
                          <td>{p.name}</td>
                          <td>{formatHours(p.seconds)}</td>
                          <td>{formatBytes(p.bytes)}</td>
                          <td className="muted">{p.lastWatched ? timeAgo(p.lastWatched) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted small">Nobody has watched anything in this range yet.</p>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
