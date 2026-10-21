// LLM adapter for reading and drafting. One entry point: a structured call validated against a
// Zod schema. Swapping providers means replacing this file.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import { env } from '../config/env.js';

let client: Anthropic | null = null;
const anthropic = () => {
  if (!env.ANTHROPIC_API_KEY) throw new Error('AI is not configured (ANTHROPIC_API_KEY)');
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 3, timeout: 10 * 60_000 });
  return client;
};

export type Block = Anthropic.Beta.BetaContentBlockParam;

export const textBlock = (text: string): Block => ({ type: 'text', text });
export const imageBlock = (jpeg: Buffer, mediaType: 'image/jpeg' | 'image/png' = 'image/jpeg'): Block => ({
  type: 'image',
  source: { type: 'base64', media_type: mediaType, data: jpeg.toString('base64') },
});

export class AiRefusal extends Error {}

/**
 * Structured call. Effort defaults to medium: document reading is extraction, not open reasoning.
 * Refusals fall back server-side to another model; a refusal of the whole chain throws AiRefusal.
 */
export async function structured<S extends z.ZodType>(opts: {
  system: string;
  content: Block[];
  schema: S;
  effort?: 'low' | 'medium' | 'high';
  maxTokens?: number;
}): Promise<{ data: z.infer<S>; model: string; usage: { input: number; output: number } }> {
  const res = await anthropic().beta.messages.parse({
    model: env.ANTHROPIC_MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: opts.content }],
    output_config: { effort: opts.effort ?? 'medium', format: betaZodOutputFormat(opts.schema) },
  } as any);
  if (res.stop_reason === 'refusal') throw new AiRefusal(`Model declined: ${(res as any).stop_details?.explanation ?? 'no detail'}`);
  if (res.stop_reason === 'max_tokens') throw new Error('Model output was cut off (max_tokens)');
  const parsed = (res as any).parsed_output;
  if (!parsed) throw new Error('Model output did not match the expected structure');
  return { data: parsed, model: res.model, usage: { input: res.usage.input_tokens, output: res.usage.output_tokens } };
}

export const aiConfigured = () => !!env.ANTHROPIC_API_KEY;
