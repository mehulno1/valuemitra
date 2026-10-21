import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { badRequest } from '../lib/errors.js';

export const idParam = (req: FastifyRequest, key = 'id') => {
  const v = Number((req.params as any)[key]);
  if (!Number.isInteger(v) || v <= 0) throw badRequest(`Invalid ${key}`);
  return v;
};

export function body<S extends z.ZodType>(req: FastifyRequest, schema: S): z.infer<S> {
  const r = schema.safeParse(req.body ?? {});
  if (!r.success) throw badRequest(r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  return r.data;
}

/** Read all files (and fields) from a multipart request. */
export async function multipartFiles(req: FastifyRequest) {
  const files: { name: string; mime: string; buffer: Buffer }[] = [];
  const fields: Record<string, string> = {};
  for await (const part of (req as any).parts()) {
    if (part.type === 'file') files.push({ name: part.filename, mime: part.mimetype, buffer: await part.toBuffer() });
    else fields[part.fieldname] = String(part.value);
  }
  return { files, fields };
}
