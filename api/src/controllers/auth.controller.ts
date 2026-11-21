import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import { toUser } from '../lib/serializers.js';
import * as auth from '../services/auth.service.js';

export async function register(req: Request, res: Response) {
  const user = await auth.register(req.body);
  res.status(201).json({ token: auth.issueToken(user), user: toUser(user) });
}

export async function login(req: Request, res: Response) {
  const user = await auth.login(req.body);
  res.json({ token: auth.issueToken(user), user: toUser(user) });
}

export async function me(req: Request, res: Response) {
  res.json(toUser(currentUser(req)));
}
