import type postgres from 'postgres';

export type Sql = postgres.Sql;

export interface DraftRow {
  id: string;
  session_id: string;
  kind: 'payment' | 'request';
  amount: number;
  fee: number;
  phone: string;
  recipient: string;
  reference: string | null;
  expires_at: Date;
  created_at: Date;
}

export interface PaymentRow {
  id: string;
  draft_id: string;
  session_id: string;
  ip_hash: string;
  kind: 'payment' | 'request';
  status: 'pending' | 'success' | 'failed';
  amount: number;
  fee: number;
  phone: string;
  recipient: string;
  reference: string | null;
  provider: string;
  provider_reference: string | null;
  mpesa_receipt: string | null;
  paid_at: Date | null;
  failure_reason: string | null;
  created_at: Date;
  updated_at: Date;
}
