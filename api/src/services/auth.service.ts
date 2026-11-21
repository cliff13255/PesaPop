import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { Prisma, type User } from '@prisma/client';
import { env } from '../config/env.js';
import { ApiError, errors } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { prisma } from '../lib/prisma.js';
import type { LoginBody, RegisterBody } from '../schemas.js';

const ROUNDS = env.NODE_ENV === 'test' ? 4 : 12;
// Compared against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('pesapop-dummy-password', ROUNDS);

export function issueToken(user: Pick<User, 'id' | 'role'>): string {
  return jwt.sign({ role: user.role }, env.JWT_SECRET, {
    subject: user.id,
    algorithm: 'HS256',
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  });
}

export async function register(body: RegisterBody): Promise<User> {
  const passwordHash = await bcrypt.hash(body.password, ROUNDS);
  try {
    return await prisma.user.create({
      data: { id: newId('usr'), name: body.name, phone: body.phone, email: body.email, role: body.role, passwordHash },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw errors.conflict('An account with this email or phone already exists.');
    }
    throw err;
  }
}

export async function login(body: LoginBody): Promise<User> {
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  const ok = await bcrypt.compare(body.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw new ApiError(401, 'invalid_credentials', 'Wrong email or password.');
  return user;
}
