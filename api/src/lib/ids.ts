import { randomBytes } from 'node:crypto';

/** Prefixed, URL-safe, unguessable ids, e.g. pay_4Hd9sQ1wZr6TxY0p. */
export type IdPrefix = 'usr' | 'cnv' | 'msg' | 'cnf' | 'pay' | 'req';

export function newId(prefix: IdPrefix, bytes = 12): string {
  return `${prefix}_${randomBytes(bytes).toString('base64url')}`;
}
