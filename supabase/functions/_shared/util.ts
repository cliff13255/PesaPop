const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Unguessable prefixed id, e.g. pay_Xk3...; works in Deno and Node. */
export function newId(prefix: 'cnf' | 'pay' | 'cnv' | 'msg', length = 20): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (const b of bytes) out += B64URL[b & 63];
  return `${prefix}_${out}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compares secrets without leaking their length or content through timing. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

/** +254712345678 -> +2547******78 */
export const maskPhone = (p: string) => (p.length > 7 ? `${p.slice(0, 5)}******${p.slice(-2)}` : '******');

/** Accepts 0712 345 678, 254712345678, +254712345678 (also 01...). Returns E.164 or null. */
export function normalizePhone(raw: string): string | null {
  const s = raw.replace(/[\s-]/g, '');
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^\+254([71]\d{8})$/))) return `+254${m[1]}`;
  if ((m = s.match(/^254([71]\d{8})$/))) return `+254${m[1]}`;
  if ((m = s.match(/^0([71]\d{8})$/))) return `+254${m[1]}`;
  return null;
}
