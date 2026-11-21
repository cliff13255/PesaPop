// Server configuration from environment variables (Supabase secrets in production).
export type ProviderMode = 'simulated' | 'sandbox' | 'live';

export interface Config {
  /** simulated = no real M-Pesa (clearly labelled in the UI); sandbox/live = PayHero STK Push. */
  providerMode: ProviderMode;
  /** Highest amount (KES) one demo payment may request. */
  maxAmount: number;
  /** At most `rateLimitCount` confirmed payments per browser or IP per `rateLimitWindowMinutes`. */
  rateLimitCount: number;
  rateLimitWindowMinutes: number;
  /** Assistant messages allowed per browser per minute. */
  assistantPerMinute: number;
  /** Optional shared passcode. When set, every call except health/config/webhooks must send it. */
  accessCode: string | null;
  /** Allowed browser origins for CORS ('*' allows any). */
  corsOrigins: string[];
  /** Name of the single demo merchant shown in the Merchant view. */
  shopName: string;
  ipSalt: string;
  payhero: {
    baseUrl: string;
    username: string | null;
    password: string | null;
    channelId: string | null;
    /** Public URL of POST /webhooks/payhero, e.g. https://<ref>.supabase.co/functions/v1/api/webhooks/payhero */
    callbackUrl: string | null;
    /** Random secret appended to the callback URL and checked on every callback. */
    callbackToken: string | null;
  };
  anthropicApiKey: string | null;
  assistantModel: string;
}

const int = (v: string | undefined, fallback: number, min: number, max: number) => {
  const n = v === undefined || v === '' ? fallback : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid integer config value: ${v}`);
  return n;
};
const str = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

export function loadConfig(get: (key: string) => string | undefined): Config {
  const mode = (get('PROVIDER_MODE') ?? 'simulated').trim();
  if (mode !== 'simulated' && mode !== 'sandbox' && mode !== 'live') {
    throw new Error('PROVIDER_MODE must be simulated, sandbox or live');
  }
  return {
    providerMode: mode,
    maxAmount: int(get('MAX_AMOUNT'), 1000, 1, 250000),
    rateLimitCount: int(get('RATE_LIMIT_COUNT'), 5, 1, 1000),
    rateLimitWindowMinutes: int(get('RATE_LIMIT_WINDOW_MINUTES'), 10, 1, 1440),
    assistantPerMinute: int(get('ASSISTANT_PER_MINUTE'), 10, 1, 1000),
    accessCode: str(get('DEMO_ACCESS_CODE')),
    corsOrigins: (get('CORS_ORIGINS') ?? '*').split(',').map((s) => s.trim()).filter(Boolean),
    shopName: str(get('SHOP_NAME')) ?? 'PesaPop Demo Shop',
    ipSalt: str(get('IP_HASH_SALT')) ?? 'pesapop-demo',
    payhero: {
      baseUrl: (str(get('PAYHERO_BASE_URL')) ?? 'https://backend.payhero.co.ke').replace(/\/$/, ''),
      username: str(get('PAYHERO_API_USERNAME')),
      password: str(get('PAYHERO_API_PASSWORD')),
      channelId: str(get('PAYHERO_CHANNEL_ID')),
      callbackUrl: str(get('PAYHERO_CALLBACK_URL')),
      callbackToken: str(get('PAYHERO_CALLBACK_TOKEN')),
    },
    anthropicApiKey: str(get('ANTHROPIC_API_KEY')),
    assistantModel: str(get('ASSISTANT_MODEL')) ?? 'claude-opus-5-5',
  };
}
