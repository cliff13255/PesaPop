// Deterministic Kenyan sample data for the mock server.

export const DEMO_PASSWORD = 'password123';
export const DEMO_TOKENS = {
  customer: 'demo-customer-token',
  merchant: 'demo-merchant-token',
};

// Small seeded PRNG so every restart produces the same data.
function rng(seedValue) {
  let s = seedValue >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const RECIPIENTS = [
  ['Kenya Power', 'ACC-104233'],
  ['Nairobi Water', 'NW-558120'],
  ['Naivas Supermarket', null],
  ['Safaricom Home Fibre', 'SHF-77120'],
  ['Mama Mboga Wanjiru', null],
  ['Brian Otieno', null],
  ['Zuku', 'ZK-30018'],
  ['Java House Kilimani', null],
  ['Kevin Mutua', null],
  ['Greenfield Academy Fees', 'ADM-2291'],
];
const CUSTOMER_NAMES = ['Achieng Odhiambo', 'Peter Njoroge', 'Faith Chebet', 'Mohamed Abdi', 'Grace Wambui', 'Daniel Kiprop'];
const METHODS = ['mpesa_stk', 'mpesa_stk', 'mpesa_stk', 'payhero', 'lipwa'];
const FAIL_REASONS = [
  'The customer cancelled the M-Pesa prompt.',
  'Insufficient M-Pesa balance.',
  'The M-Pesa prompt timed out.',
];
const AMOUNTS = [50, 100, 150, 200, 250, 300, 500, 750, 1000, 1200, 1500, 2000, 2500, 3500, 5000, 7800, 12000];

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const kePhone = (r) => `+2547${String(Math.floor(r() * 1e8)).padStart(8, '0')}`;
const code = (r, prefix, len) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  let out = prefix;
  for (let i = 0; i < len; i++) out += chars[Math.floor(r() * chars.length)];
  return out;
};

function makePayment(r, i, { ownerId, merchantId, recipient, reference, phone, createdAt }) {
  const roll = r();
  const status = roll < 0.72 ? 'success' : roll < 0.86 ? 'failed' : 'pending';
  const method = pick(r, METHODS);
  const amount = pick(r, AMOUNTS);
  const updated = new Date(Date.parse(createdAt) + 25_000).toISOString();
  return {
    id: code(r, 'pay_', 12),
    owner_id: ownerId,
    merchant_id: merchantId,
    status,
    method,
    amount,
    fee: 0,
    total: amount,
    currency: 'KES',
    phone,
    recipient,
    reference,
    receipt:
      status === 'success'
        ? {
            provider: method === 'mpesa_stk' ? 'mpesa' : method,
            provider_reference: code(r, 'ws_CO_', 20),
            mpesa_receipt: code(r, 'S', 9),
            paid_at: updated,
          }
        : null,
    failure_reason: status === 'failed' ? pick(r, FAIL_REASONS) : null,
    created_at: createdAt,
    updated_at: status === 'pending' ? createdAt : updated,
  };
}

export function seed() {
  const r = rng(254);
  const t0 = Date.now();
  const hoursAgo = (h) => new Date(t0 - h * 3_600_000).toISOString();

  const customer = {
    id: 'usr_demoCustomer1',
    name: 'Wanjiku Kamau',
    phone: '+254712345678',
    email: 'customer@pesapop.test',
    role: 'customer',
    created_at: hoursAgo(24 * 30),
    password: DEMO_PASSWORD,
  };
  const merchant = {
    id: 'usr_demoMerchant1',
    name: 'Duka la Mama Njeri',
    phone: '+254722000111',
    email: 'merchant@pesapop.test',
    role: 'merchant',
    created_at: hoursAgo(24 * 60),
    password: DEMO_PASSWORD,
  };

  const users = new Map([customer, merchant].map((u) => [u.id, u]));
  const tokens = new Map([
    [DEMO_TOKENS.customer, customer.id],
    [DEMO_TOKENS.merchant, merchant.id],
  ]);
  const payments = new Map();
  const paymentRequests = new Map();

  // Customer: 23 payments over the last ~3 weeks.
  for (let i = 0; i < 23; i++) {
    const [recipient, reference] = pick(r, RECIPIENTS);
    const p = makePayment(r, i, {
      ownerId: customer.id,
      merchantId: null,
      recipient,
      reference,
      phone: customer.phone,
      createdAt: hoursAgo(3 + i * 21 + Math.floor(r() * 10)),
    });
    payments.set(p.id, p);
  }

  // Merchant: 30 payments received from customers.
  for (let i = 0; i < 30; i++) {
    const p = makePayment(r, i, {
      ownerId: `usr_customer${i}`,
      merchantId: merchant.id,
      recipient: merchant.name,
      reference: code(r, 'INV-', 4),
      phone: kePhone(r),
      createdAt: hoursAgo(1 + i * 15 + Math.floor(r() * 8)),
    });
    payments.set(p.id, p);
  }

  // Merchant: 6 payment requests with Lipwa links.
  const descriptions = ['2 bags of cement', 'Weekly vegetable order', 'Catering deposit', 'School uniform x3', 'Tailoring: suit alteration', 'Delivery to Rongai'];
  for (let i = 0; i < 6; i++) {
    const roll = r();
    const reqId = code(r, 'req_', 10);
    paymentRequests.set(reqId, {
      id: reqId,
      merchant_id: merchant.id,
      amount: pick(r, AMOUNTS),
      currency: 'KES',
      customer_phone: kePhone(r),
      description: `Invoice #${1040 + i}: ${descriptions[i]} for ${pick(r, CUSTOMER_NAMES)}`,
      status: roll < 0.5 ? 'success' : roll < 0.8 ? 'pending' : 'failed',
      link: `https://lipwa.link/p/${reqId}`,
      created_at: hoursAgo(2 + i * 30),
    });
  }

  return {
    users,
    tokens,
    payments,
    paymentRequests,
    drafts: new Map(),
    conversations: new Map(),
  };
}
