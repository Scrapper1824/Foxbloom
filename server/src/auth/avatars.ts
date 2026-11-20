import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { db, now } from '../db.js';

/** Biggest picture accepted. The website and TV shrink pictures to 256x256 before sending, which is far smaller. */
export const AVATAR_MAX_BYTES = 256 * 1024;

/** Only these, recognised by their first bytes (never by what the upload says it is), so nothing scriptable is served. */
function imageType(b: Buffer): string | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Where a user's picture is served, or null. The address has a random key that changes with every new picture, so it
 * can be cached forever and loaded by the TV as a plain <img> (no sign-in header). Only signed-in users ever see it.
 */
export function avatarUrl(userId: number): string | null {
  const row = db.prepare('SELECT key FROM user_avatars WHERE user_id = ?').get(userId) as { key: string } | undefined;
  return row ? '/api/avatars/' + row.key : null;
}

export async function avatarRoutes(app: FastifyInstance) {
  // Your own picture: { image: "data:image/png;base64,..." }.
  app.put<{ Body: { image?: unknown } }>('/api/auth/avatar', { bodyLimit: 1024 * 1024 }, async (req, reply) => {
    const m = typeof req.body?.image === 'string' ? /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=\s]+)$/.exec(req.body.image) : null;
    if (!m) return reply.code(400).send({ error: 'That is not a picture.' });
    const data = Buffer.from(m[1], 'base64');
    if (data.length > AVATAR_MAX_BYTES) return reply.code(413).send({ error: 'That picture is too big (256 KB at most).' });
    const mime = imageType(data);
    if (!mime) return reply.code(400).send({ error: 'Use a PNG, JPEG or WebP picture.' });
    const key = crypto.randomBytes(18).toString('base64url');
    db.prepare(
      'INSERT INTO user_avatars (user_id, key, mime, data, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET key = excluded.key, mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at',
    ).run(req.user!.id, key, mime, data, now());
    return { avatar: '/api/avatars/' + key };
  });

  app.delete('/api/auth/avatar', async (req) => {
    db.prepare('DELETE FROM user_avatars WHERE user_id = ?').run(req.user!.id);
    return { ok: true };
  });

  // Public (see PUBLIC_API): the unguessable key is the permission, as with a share link.
  app.get<{ Params: { key: string } }>('/api/avatars/:key', async (req, reply) => {
    const row = db.prepare('SELECT mime, data FROM user_avatars WHERE key = ?').get(req.params.key) as { mime: string; data: Uint8Array } | undefined;
    if (!row) return reply.code(404).send({ error: 'Not found' });
    return reply
      .header('Content-Type', row.mime)
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .send(Buffer.from(row.data));
  });
}
