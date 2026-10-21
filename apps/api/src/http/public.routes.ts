// No-login routes for the field engineer's visit link. The token is the only credential: random,
// stored hashed, expiring, revocable, rate-limited.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as site from '../modules/site/service.js';
import { body, multipartFiles } from './util.js';

export async function publicRoutes(app: FastifyInstance) {
  const limit = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
  app.get('/api/public/visit/:token', limit, async (req) => site.publicVisitInfo((req.params as any).token));
  app.post('/api/public/visit/:token/upload', limit, async (req) => {
    const { files, fields } = await multipartFiles(req);
    return site.engineerUpload((req.params as any).token, fields.kind === 'sheet' ? 'sheet' : 'photos', files);
  });
  // thumbnails load in a burst (one per photo), so a looser limit than the rest
  app.get('/api/public/visit/:token/photo/:id', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { token, id } = req.params as { token: string; id: string };
    const buf = await site.publicThumb(token, Number(id) || 0);
    return reply.header('Content-Type', 'image/jpeg').header('Cache-Control', 'private, max-age=3600').header('X-Content-Type-Options', 'nosniff').send(buf);
  });
  app.post('/api/public/visit/:token/submit', limit, async (req) => {
    const b = body(req, z.object({ note: z.string().max(1000).nullish() }));
    await site.engineerSubmit((req.params as any).token, b.note ?? null);
    return { ok: true };
  });
}
