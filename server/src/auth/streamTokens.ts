import crypto from 'node:crypto';
import { hashToken, sessionHashAlive } from './sessions.js';

/**
 * Short-lived tokens for the TV's video and subtitle loads, which can't send an Authorization header.
 * Each opens exactly one title ("episode:12") for one user, and nothing else. Kept in memory only.
 */
export const STREAM_TOKEN_MS = 6 * 60 * 60 * 1000;

const tokens = new Map<string, { userId: number; title: string; session: string; expires: number }>();

/** `sessionToken` is the TV sign-in this was issued under: the token stops working when that sign-in ends. */
export function issueStreamToken(userId: number, title: string, sessionToken: string): string {
  const t = Date.now();
  for (const [k, v] of tokens) if (v.expires <= t) tokens.delete(k);
  const token = crypto.randomBytes(32).toString('base64url');
  tokens.set(token, { userId, title, session: hashToken(sessionToken), expires: t + STREAM_TOKEN_MS });
  return token;
}

/** The user a stream token belongs to, only while it is valid and for exactly this title. */
export function streamTokenUser(token: string, title: string): number | null {
  const e = tokens.get(token);
  if (!e) return null;
  if (e.expires <= Date.now()) {
    tokens.delete(token);
    return null;
  }
  if (e.title !== title) return null;
  if (!sessionHashAlive(e.session)) {
    tokens.delete(token);
    return null;
  }
  return e.userId;
}
