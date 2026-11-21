// Shapes from docs/openapi.yaml (v0.2). Keep in sync with the spec.
export type PaymentStatus = 'pending' | 'success' | 'failed';
export type Kind = 'payment' | 'request';
export type MissingField = 'amount' | 'recipient' | 'phone';

export interface PublicConfig {
  provider_mode: 'simulated' | 'live';
  assistant_mode: 'claude' | 'rules';
  max_amount: number;
  access_code_required: boolean;
  shop_name: string;
}

export interface PaymentSummary {
  kind: Kind;
  method: 'mpesa_stk';
  amount: number;
  fee: number;
  total: number;
  currency: 'KES';
  phone: string;
  recipient: string;
  reference: string | null;
  expires_at: string;
}

export interface PaymentDraftResponse {
  payment_summary: PaymentSummary;
  confirmation_id: string;
}

export interface ConfirmPaymentResponse {
  id: string;
  status: PaymentStatus;
  confirmation_id: string;
}

export interface Payment {
  id: string;
  kind: Kind;
  status: PaymentStatus;
  method: 'mpesa_stk';
  provider: 'payhero' | 'simulated';
  amount: number;
  fee: number;
  total: number;
  currency: 'KES';
  phone: string;
  recipient: string;
  reference: string | null;
  mpesa_receipt: string | null;
  paid_at: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface TransactionItem {
  id: string;
  kind: Kind;
  reference: string;
  amount: number;
  currency: 'KES';
  method: 'mpesa_stk';
  recipient: string;
  phone: string;
  created_at: string;
  status: PaymentStatus;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export interface Page<T> {
  items: T[];
  pagination: Pagination;
}

export interface StatusBucket {
  count: number;
  total: number;
}

export interface MerchantSummary {
  shop_name: string;
  currency: 'KES';
  total_received: number;
  success: StatusBucket;
  pending: StatusBucket;
  failed: StatusBucket;
}

export interface AssistantMessageResponse {
  conversation_id: string;
  reply: string;
  missing_fields: MissingField[];
  payment_summary: PaymentSummary | null;
  confirmation_id: string | null;
  assistant_mode: 'claude' | 'rules';
}

export interface CreatePaymentInput {
  amount: number;
  phone: string;
  recipient: string;
  reference?: string;
}
