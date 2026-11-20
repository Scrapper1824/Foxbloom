import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ABSOLUTE_MS, SESSION_COOKIE, userForSession, type UserRow } from './sessions.js';
import { GUEST_COOKIE } from '../party/guest.js';
import { partyForGuestToken } from '../party/store.js';
import { sessionTitle } from '../playback/sessions.js';
import { streamTokenUser } from './streamTokens.js';
import { userById } from './sessions.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow | null;
    sessionToken: string | undefined;
    /** How this request signed in: the website cookie, a TV app bearer token, a stream token, or not at all. */
    authVia: 'cookie' | 'bearer' | 'stream' | null;
    /** A watch-party guest (no account), only when nobody is signed in. */
    guest: { partyId: string; guestId: number; name: string } | null;
  }
}

/** The only API routes reachable without signing in. Everything else under /api needs a session. */
/** All an account on the temporary password may do. */
const MUST_CHANGE_ALLOWED = new Set(['GET /api/auth/status', 'POST /api/auth/logout', 'POST /api/auth/password']);

export const PUBLIC_API = new Set(['GET /api/auth/status', 'POST /api/auth/login', 'POST /api/auth/setup', 'POST /api/party/:id/guest-join', 'POST /api/tv/pair', 'POST /api/tv/pair/poll', 'GET /api/avatars/:key']);

/**
 * All a watch-party guest (no account, guest cookie) may reach: their party and its current title's stream.
 * The routes themselves check that the title is the party's and that the party is the guest's own.
 */
export const GUEST_ALLOWED = new Set([
  'GET /api/play/:kind/:id/info',
  'POST /api/play/:kind/:id/start',
  'GET /api/play/direct/:kind/:id',
  'GET /api/play/hls/:session/:file',
  'DELETE /api/play/hls/:session',
  'GET /api/play/:kind/:id/subtitle/:track',
  'GET /api/play/:kind/:id/fonts',
  'GET /api/play/:kind/:id/fonts/:name',
  'GET /api/play/:kind/:id/trickplay/:sheet',
  'GET /api/play/:kind/:id/extras',
  'GET /api/party/:id',
  'GET /api/party/:id/socket',
  'POST /api/party/:id/leave',
]);

/**
 * What regular (non-admin) users may do: browse, request, search, choose bundles, see the queue/history,
 * and manage their own sign-in. Everything not listed is admin-only, so routes added later stay locked
 * to admins until they're deliberately opened up here.
 */
export const USER_ALLOWED = new Set([
  'GET /api/auth/status',
  'POST /api/auth/logout',
  'POST /api/auth/logout-others',
  'POST /api/tv/link',
  'POST /api/tv/link/check',
  'POST /api/auth/password',
  'PUT /api/auth/avatar',
  'DELETE /api/auth/avatar',
  'POST /api/auth/totp/setup',
  'POST /api/auth/totp/enable',
  'POST /api/auth/totp/disable',
  'GET /api/status',
  'GET /api/settings', // non-admins only get the request defaults, never keys/URLs/folders
  'GET /api/discover/search',
  'GET /api/discover/browse',
  'GET /api/discover/info',
  'GET /api/discover/details',
  'GET /api/discover/availability',
  'GET /api/discover/filter',
  'GET /api/discover/genres',
  'GET /api/media',
  'GET /api/media/:id',
  'POST /api/media',
  'PATCH /api/media/:id',
  'POST /api/media/:id/refresh',
  'PATCH /api/media/:id/seasons/:season',
  'PATCH /api/episodes/:id',
  'POST /api/media/:id/search',
  'GET /api/media/:id/releases',
  'POST /api/media/:id/grab',
  'POST /api/suggestions/:id/accept',
  'POST /api/suggestions/:id/dismiss',
  // Requests that wait for an admin: users see (and can withdraw) their own.
  'GET /api/requests',
  'DELETE /api/requests/:id',
  'GET /api/queue',
  'GET /api/history',
  'GET /api/search-events',
  // Notifications and watch parties (any account may start, invite and make guest links; only the host ends).
  'GET /api/notifications',
  'POST /api/notifications/read',
  'DELETE /api/notifications/:id',
  'GET /api/party/invitees',
  'POST /api/party',
  'GET /api/party/:id',
  'GET /api/party/:id/socket',
  'POST /api/party/:id/invite',
  'POST /api/party/:id/guest-link',
  'POST /api/party/:id/end',
  'POST /api/party/:id/leave',
  // Watchlists: each user manages only their own (the routes use req.user, never an id from the client).
  'GET /api/watchlist/links',
  'POST /api/watchlist/simkl/start',
  'POST /api/watchlist/simkl/poll',
  'POST /api/watchlist/anilist',
  'DELETE /api/watchlist/links/:service',
  'GET /api/watchlist',
  'GET /api/watchlist/item',
  'PUT /api/watchlist/item',
  'DELETE /api/watchlist/item',
  // Watching: anyone signed in can play what's in the library (files are looked up by id, never by path).
  'GET /api/play/:kind/:id/info',
  'POST /api/play/:kind/:id/start',
  'GET /api/play/direct/:kind/:id',
  'GET /api/play/hls/:session/:file',
  'DELETE /api/play/hls/:session',
  'GET /api/play/:kind/:id/subtitle/:track',
  'GET /api/play/:kind/:id/fonts',
  'GET /api/play/:kind/:id/extras',
  'GET /api/play/:kind/:id/trickplay/:sheet',
  'GET /api/play/:kind/:id/fonts/:name',
  'PUT /api/play/:kind/:id/progress',
  'GET /api/play/progress/:mediaId',
  'PUT /api/media/:id/watched',
  'GET /api/continue',
  'DELETE /api/continue/:mediaId',
  'GET /api/home',
]);

/**
 * Things that start (or will start) downloads. A user whose requests need approval can't do them;
 * adding a title (POST /api/media) still works for them, but becomes a request for an admin.
 */
export const NEEDS_ADMIN_OK = new Set([
  'PATCH /api/media/:id',
  'PATCH /api/media/:id/seasons/:season',
  'PATCH /api/episodes/:id',
  'POST /api/media/:id/search',
  'POST /api/media/:id/grab',
  'POST /api/suggestions/:id/accept',
]);

/** True when this user's requests wait for an admin. */
export const needsApproval = (u: { role: string; needs_approval?: number } | null | undefined) => !!u && u.role !== 'admin' && !!u.needs_approval;

/** Header the web app sends on every request that changes something; other sites can't set it (no CORS). */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'mediarr';

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    if (!(name in out)) out[name] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const isHttps = (req: FastifyRequest) => process.env.COOKIE_SECURE === 'true' || req.protocol === 'https';

export function setSessionCookie(req: FastifyRequest, reply: FastifyReply, token: string) {
  const attrs = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.floor(ABSOLUTE_MS / 1000)}`];
  if (isHttps(req)) attrs.push('Secure');
  reply.header('set-cookie', attrs.join('; '));
}

export function clearSessionCookie(req: FastifyRequest, reply: FastifyReply) {
  const attrs = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (isHttps(req)) attrs.push('Secure');
  reply.header('set-cookie', attrs.join('; '));
}

/** Origin of a URL, or null when it's missing/unparseable. */
function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * True when a request comes from another site: its Origin (or Referer) names a different host than the one
 * it was sent to (Host, or X-Forwarded-Host behind a proxy). A request naming no origin passes, unless
 * `requireOrigin` (websocket upgrades: browsers always send Origin there).
 */
export function crossSite(req: FastifyRequest, requireOrigin = false): boolean {
  // An Origin that names no host ("null", file://) is a foreign page (sandboxed frame, local file), not "no origin".
  if (req.headers.origin && !hostOf(req.headers.origin as string)) return true;
  const origin = hostOf(req.headers.origin as string | undefined) ?? hostOf(req.headers.referer);
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim().toLowerCase();
  if (!origin || !host) return requireOrigin;
  return origin !== host;
}

const CSP = [
  "default-src 'self'",
  // 'wasm-unsafe-eval' lets the subtitle renderer (libass compiled to WebAssembly) run; inline scripts stay blocked.
  "script-src 'self' 'wasm-unsafe-eval'",
  // Inline style attributes are used for progress bars; no inline scripts are allowed.
  "style-src 'self' 'unsafe-inline'",
  // Posters come from TMDB/AniList over HTTPS; the favicon is a data: SVG.
  "img-src 'self' data: https:",
  "connect-src 'self'",
  // The player streams through blob: URLs (Media Source) and runs the subtitle renderer in a worker.
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // Trailers play in YouTube's privacy-enhanced (no-cookie) player; no other site may be framed.
  'frame-src https://www.youtube-nocookie.com',
].join('; ');

export function registerSecurity(app: FastifyInstance) {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionToken', undefined);
  app.decorateRequest('guest', null);
  app.decorateRequest('authVia', null);

  app.addHook('onRequest', async (req, reply) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    req.sessionToken = token;
    req.user = userForSession(token);
    req.authVia = req.user ? 'cookie' : null;
    // The TV app has no cookies across origins: it sends its session token as a bearer token instead.
    // A valid session cookie wins when both are present.
    if (!req.user) {
      const m = /^Bearer ([\w-]{20,100})$/.exec(String(req.headers.authorization ?? ''));
      const user = m ? userForSession(m[1]) : null;
      if (m && user) {
        req.user = user;
        req.sessionToken = m[1];
        req.authVia = 'bearer';
      }
    }
    // The TV's video and subtitle loads carry a stream token (?st=) instead: valid for exactly these three
    // GET routes and only for the token's own title. Cookie or bearer sign-in wins when present.
    if (!req.user && req.method === 'GET') {
      const st = (req.query as Record<string, unknown> | undefined)?.st;
      const params = (req.params ?? {}) as Record<string, string | undefined>;
      const r = req.routeOptions.url;
      let title: string | null = null;
      if (typeof st === 'string') {
        if (r === '/api/play/direct/:kind/:id' || r === '/api/play/:kind/:id/subtitle/:track') title = `${params.kind}:${params.id}`;
        else if (r === '/api/play/hls/:session/:file') title = params.session ? sessionTitle(params.session) : null;
      }
      const uid = typeof st === 'string' && title ? streamTokenUser(st, title) : null;
      const user = uid ? userById(uid) : null;
      if (user) {
        req.user = user;
        req.authVia = 'stream';
      }
    }
    req.guest = null;
    // A signed-in user's session wins: a guest cookie is then ignored entirely. Checked on every request,
    // so a guest's access (streams included) stops the moment their party ends or they leave it.
    if (!req.user && cookies[GUEST_COOKIE]) {
      const g = partyForGuestToken(cookies[GUEST_COOKIE]);
      if (g) req.guest = { partyId: g.party.id, guestId: g.guestId, name: g.name };
    }

    // Decide by the route that actually matched (the router decodes URLs, so "/%61pi/media" reaches
    // /api/media), and also by the decoded path for unmatched requests. Anything API-like needs a session.
    const route = req.routeOptions.url;
    let decoded: string;
    try {
      decoded = decodeURIComponent(req.url.split('?')[0]).toLowerCase();
    } catch {
      return reply.code(400).send({ error: 'Bad request' });
    }
    const isApi = route?.startsWith('/api') || decoded.replace(/\/+/g, '/').startsWith('/api');
    if (!isApi) return; // the web app's files (no data in them)
    const path = route ?? decoded;

    // CORS preflight from the TV app (before sign-in: browsers send no credentials on it).
    if (req.method === 'OPTIONS' && req.headers['access-control-request-method'] && req.headers.origin) {
      return reply
        .code(204)
        .header('Access-Control-Allow-Origin', String(req.headers.origin))
        .header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE')
        .header('Access-Control-Allow-Headers', 'authorization, content-type, x-requested-with, x-foxbloom-client')
        .header('Access-Control-Max-Age', '600')
        .header('Vary', 'Origin')
        .send();
    }

    // Cross-site request protection for anything that changes state. Bearer tokens are never sent by the
    // browser on its own, so cross-site forgery can't use them; the header is still required.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers[CSRF_HEADER] !== CSRF_VALUE) return reply.code(403).send({ error: 'Missing request header' });
      // No cookie means no ambient credentials, so there is nothing for a forged request to ride on (the TV app's
      // sign-in calls come from a file:// origin). Requests that carry a cookie keep the same-site check.
      if (req.authVia !== 'bearer' && req.headers.cookie && crossSite(req)) return reply.code(403).send({ error: 'Cross-site request blocked' });
    }

    const key = `${req.method} ${path}`;
    if (!req.user) {
      if (PUBLIC_API.has(key)) return;
      if (req.guest && GUEST_ALLOWED.has(key)) return;
      return reply.code(401).send({ error: 'Not signed in' });
    }
    // Signed in with the temporary password: nothing but choosing a new one (or signing out) until they do.
    if (req.user.must_change_password && !MUST_CHANGE_ALLOWED.has(key)) {
      return reply.code(403).send({ error: 'Choose a new password first.', mustChangePassword: true });
    }
    if (req.user.role !== 'admin' && !USER_ALLOWED.has(key)) {
      return reply.code(403).send({ error: 'Only an admin can do that.' });
    }
    if (needsApproval(req.user) && NEEDS_ADMIN_OK.has(key)) {
      return reply.code(403).send({ error: 'Your requests need an admin’s approval, so you can’t start downloads yourself. Ask an admin.' });
    }
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('Content-Security-Policy', CSP);
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    // Bearer/stream requests come from the TV app (another origin; <video>/<img> loads send no Origin at all).
    // A bearer header that did not resolve (expired/revoked) still gets CORS, so the TV can read the 401.
    // Requests with no cookie at all (the TV's status, pair, poll and login calls) get the same treatment.
    // Profile pictures are plain images any page of ours (the TV app included) may show.
    const tv = req.authVia === 'bearer' || req.authVia === 'stream' || (!req.headers.cookie && req.url.startsWith('/api/')) || req.routeOptions.url === '/api/avatars/:key';
    const bearerAttempt = !req.authVia && /^Bearer /.test(String(req.headers.authorization ?? ''));
    if ((tv || bearerAttempt) && req.headers.origin) {
      reply.header('Access-Control-Allow-Origin', String(req.headers.origin)).header('Vary', 'Origin');
    }
    reply.header('Cross-Origin-Resource-Policy', tv ? 'cross-origin' : 'same-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
    if (isHttps(req)) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // Never cache API responses (they may hold private data) in the browser or a proxy.
    // A found profile picture keeps its own long cache: its address changes whenever the picture does.
    if (req.url.startsWith('/api/') && !(req.routeOptions.url === '/api/avatars/:key' && reply.statusCode === 200)) reply.header('Cache-Control', 'no-store');
    return payload;
  });
}
