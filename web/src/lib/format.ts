const kes = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 });
export const formatKES = (n: number) => `KES ${kes.format(n)}`;

const dateFmt = new Intl.DateTimeFormat('en-KE', {
  timeZone: 'Africa/Nairobi',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
/** Readable date in Nairobi time (24-hour), e.g. "21 Nov 2026, 18:30". */
export const formatDate = (iso: string) => dateFmt.format(new Date(iso));

const E164 = /^\+254(7|1)[0-9]{8}$/;

/** Accepts 0712 345 678, 254712345678 or +254712345678; returns +254712345678, or null if invalid. */
export function normalizePhone(raw: string): string | null {
  const s = raw.replace(/[\s-]/g, '');
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^\+254([71]\d{8})$/))) return `+254${m[1]}`;
  if ((m = s.match(/^254([71]\d{8})$/))) return `+254${m[1]}`;
  if ((m = s.match(/^0([71]\d{8})$/))) return `+254${m[1]}`;
  return null;
}
export const isE164 = (s: string) => E164.test(s);

/** Whole KES between 1 and 250,000, or null. Accepts "1,500" and "1500". */
export function parseAmount(raw: string): number | null {
  const s = raw.replace(/[,\s]/g, '');
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= 250000 ? n : null;
}

export const MISSING_LABEL: Record<string, string> = {
  amount: 'Amount (KES)',
  recipient: 'Who you are paying',
  phone: 'M-Pesa phone number',
};
