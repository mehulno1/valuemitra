import type { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/error.middleware.js';
import { listClients, getClient, createClient, updateClient, deleteClient } from './clients.service.js';
import { CreateClientSchema } from '@valuemitra/shared';
import { z } from 'zod';

const UpdateClientSchema = CreateClientSchema.partial();

// GET /api/clients
export const list = asyncHandler(async (req: Request, res: Response) => {
  const search = req.query['search'] as string | undefined;
  const clients = await listClients(req.tenant!.id, search);
  res.json({ success: true, data: clients });
});

// GET /api/clients/:clientId
export const get = asyncHandler(async (req: Request, res: Response) => {
  const client = await getClient(req.tenant!.id, req.params['clientId']!);
  res.json({ success: true, data: client });
});

// POST /api/clients
export const create = asyncHandler(async (req: Request, res: Response) => {
  const input = CreateClientSchema.parse(req.body);
  const client = await createClient(req.tenant!.id, req.user!.id, input);
  res.status(201).json({ success: true, data: client });
});

// PATCH /api/clients/:clientId
export const update = asyncHandler(async (req: Request, res: Response) => {
  const data = UpdateClientSchema.parse(req.body);
  const client = await updateClient(req.tenant!.id, req.user!.id, req.params['clientId']!, data);
  res.json({ success: true, data: client });
});

// DELETE /api/clients/:clientId
export const remove = asyncHandler(async (req: Request, res: Response) => {
  await deleteClient(req.tenant!.id, req.user!.id, req.params['clientId']!);
  res.json({ success: true, message: 'Client deleted' });
});
