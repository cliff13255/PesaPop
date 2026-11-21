// Payment assistant. It extracts intent and asks for missing details. It can create a DRAFT
// (via the same createDraft the payment form uses) but can NEVER confirm a payment.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { Config } from './config.ts';

export const Extraction = z.object({
  action: z.enum(['collect', 'cancel', 'other']).describe('collect = user wants to pay someone; cancel = user wants to stop; other = anything else'),
  reply: z.string().describe('Short, friendly reply to show the user'),
  amount: z.number().int().nullable().describe('Whole KES amount for the current payment, or null if not stated'),
  recipient: z.string().nullable().describe('Who is being paid, or null if not stated'),
  phone: z.string().nullable().describe('M-Pesa phone number exactly as the user gave it, or null'),
  reference: z.string().nullable().describe('Account number or note, or null'),
  ready_to_review: z.boolean().describe('true only when amount, recipient and phone were all stated by the user and they want to proceed'),
});
export type Extraction = z.infer<typeof Extraction>;

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export type ModelResult = { kind: 'ok'; extraction: Extraction } | { kind: 'refused' };

export interface AssistantModel {
  readonly mode: 'claude' | 'rules';
  extract(history: ChatTurn[], maxAmount: number): Promise<ModelResult>;
}

/** Appended to the stored assistant turn after a draft is created (never shown to the user). */
export const DRAFT_MARKER = '[PesaPop note: a payment draft was created and is waiting for the user to tap Confirm in the app. Any new request is a new payment.]';

const systemPrompt = (maxAmount: number) => `You are PesaPop's payment assistant in Kenya. People pay with M-Pesa STK Push: they type who to pay and how much, you collect the details, the app shows a summary, and the user confirms by tapping a button.

Extract the details of the payment currently being discussed:
- amount: whole Kenyan shillings. "1k" = 1000, "500 bob" = 500, "2,500" = 2500. This demo allows at most KES ${maxAmount}.
- recipient: the person or business being paid.
- phone: the M-Pesa number that should receive the payment prompt, exactly as the user typed it.
- reference: an account number or note, only if the user gives one.

Rules:
- Never guess or invent an amount, recipient or phone number. If any is missing or unclear, set it to null and ask for it in your reply.
- Carry forward details the user already gave earlier in this conversation for the same payment.
- Never say a payment was made, sent or completed. You only prepare a summary; the user confirms in the app.
- Never ask for an M-Pesa PIN or any password. If the user offers one, tell them never to share it.
- If the user says cancel, stop or never mind: action = cancel, and clear the details.
- Set ready_to_review = true only when amount, recipient and phone are all known and the user wants to go ahead.
- Keep replies short and friendly, in plain English. You may understand Swahili or Sheng.`;

export function createClaudeModel(apiKey: string, model: string): AssistantModel {
  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  return {
    mode: 'claude',
    async extract(history, maxAmount) {
      const res = await client.beta.messages.parse({
        model,
        max_tokens: 16000,
        system: systemPrompt(maxAmount),
        messages: history.map((t) => ({ role: t.role, content: t.content })),
        output_config: { effort: 'low', format: betaZodOutputFormat(Extraction) },
        // Server-side fallback: if the model declines, the API retries on a fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
      if (res.stop_reason === 'refusal') return { kind: 'refused' };
      if (!res.parsed_output) throw new Error(`assistant returned no structured output (stop_reason=${res.stop_reason})`);
      return { kind: 'ok', extraction: Extraction.parse(res.parsed_output) };
    },
  };
}

// ---------- Rule-based fallback (used when ANTHROPIC_API_KEY is not set; labelled in the UI) ----------
function extractFromText(text: string, into: Partial<Extraction>) {
  const t = text.toLowerCase();
  const phoneMatch = text.match(/(\+?254|0)[\s-]?[71]\d{2}[\s-]?\d{3}[\s-]?\d{3}/);
  if (phoneMatch) into.phone = phoneMatch[0];
  const rest = phoneMatch ? text.replace(phoneMatch[0], ' ') : text;
  const amt = rest.match(/(?:kes|ksh|sh)?\s*(\d[\d,]*)(\s*k\b)?/i);
  if (amt) {
    let n = Number(amt[1]!.replace(/,/g, ''));
    if (amt[2]) n *= 1000;
    if (Number.isInteger(n) && n > 0) into.amount = n;
  }
  const rec = rest.match(/\bto\s+([A-Za-z][A-Za-z.'&-]*(?:\s+[A-Z][A-Za-z.'&-]*)*)/);
  if (rec) into.recipient = rec[1]!;
  else if (/electricity|kplc|kenya power|tokens/.test(t)) into.recipient = 'Kenya Power';
  const ref = text.match(/\b(?:ref(?:erence)?|account|acc)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Za-z0-9-]{3,})/i);
  if (ref) into.reference = ref[1]!;
}

export const rulesModel: AssistantModel = {
  mode: 'rules',
  async extract(history) {
    const fields: Partial<Extraction> = {};
    const last = history[history.length - 1]?.content ?? '';
    if (/\b(cancel|stop|never ?mind|forget it)\b/i.test(last)) {
      return { kind: 'ok', extraction: { action: 'cancel', reply: "Okay, I've cancelled that. Nothing was paid.", amount: null, recipient: null, phone: null, reference: null, ready_to_review: false } };
    }
    if (/\bpin\b|password/i.test(last)) {
      return { kind: 'ok', extraction: { action: 'other', reply: 'Never share your M-Pesa PIN or any password, including with me. You only enter your PIN on your own phone.', amount: null, recipient: null, phone: null, reference: null, ready_to_review: false } };
    }
    // Only user turns since the last draft or cancel belong to the current payment.
    let start = 0;
    history.forEach((t, i) => {
      if (t.role === 'assistant' && t.content.includes(DRAFT_MARKER)) start = i + 1;
      if (t.role === 'user' && /\b(cancel|stop|never ?mind|forget it)\b/i.test(t.content)) start = i + 1;
    });
    for (const t of history.slice(start)) if (t.role === 'user') extractFromText(t.content, fields);
    const any = fields.amount !== undefined || fields.recipient !== undefined || fields.phone !== undefined;
    const e: Extraction = {
      action: any ? 'collect' : 'other',
      reply: any ? 'Got it.' : 'Tell me who you want to pay, how much, and the M-Pesa number for the prompt.',
      amount: fields.amount ?? null,
      recipient: fields.recipient ?? null,
      phone: fields.phone ?? null,
      reference: fields.reference ?? null,
      ready_to_review: true,
    };
    return { kind: 'ok', extraction: e };
  },
};

export function createAssistantModel(config: Config): AssistantModel {
  return config.anthropicApiKey ? createClaudeModel(config.anthropicApiKey, config.assistantModel) : rulesModel;
}
