/**
 * A thin, typed client for the parts of Chapa's API this app uses.
 *
 * Chapa is Ethiopia's payment gateway: hosted checkout for telebirr, CBE
 * Birr, M-Pesa and cards; refunds; and transfers to bank accounts and mobile
 * wallets. Its official SDKs are thin HTTP wrappers too, so this avoids a
 * dependency and keeps every request shape visible and tested
 * (chapa.client.spec.ts).
 *
 * Money crosses this boundary in one direction only: the app works in
 * integer minor units (santim); Chapa takes and returns decimal strings of
 * birr. Conversion happens here and nowhere else.
 */

export const CHAPA_API_URL = 'https://api.chapa.co/v1';
const TIMEOUT_MS = 10_000;

/** A failed call to Chapa. */
export class ChapaError extends Error {
  constructor(
    message: string,
    /** HTTP status Chapa answered with; 0 if it never answered (network, timeout). */
    readonly status: number,
  ) {
    super(message);
    this.name = 'ChapaError';
  }

  /**
   * Chapa answered and refused, so the request did not take effect. Anything
   * else — no answer, or a server error — leaves its outcome unknown.
   */
  get definite(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

export interface CheckoutRequest {
  txRef: string;
  amountMinor: number;
  currency: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  returnUrl: string;
  callbackUrl?: string;
  /** Chapa caps this at 16 characters. */
  title: string;
  /** Letters, digits, spaces, hyphens, underscores and dots only. */
  description: string;
}

export interface ChapaTransaction {
  /** "success" once paid; otherwise e.g. "pending" or "failed". */
  status: string;
  amountMinor: number;
  currency: string;
  /** Chapa's own reference for the transaction. */
  reference: string | null;
  /** telebirr, cbebirr, mpesa, card… */
  method: string | null;
}

export interface ChapaBank {
  code: number;
  name: string;
  isMobileMoney: boolean;
  /** Expected account-number length, when Chapa knows it. */
  accountLength: number | null;
  currency: string;
}

export interface TransferRequest {
  reference: string;
  amountMinor: number;
  currency: string;
  bankCode: number;
  accountNumber: string;
  accountName: string;
}

export interface ChapaTransferStatus {
  /** "success" once delivered; otherwise e.g. "pending" or "failed". */
  status: string;
  reference: string;
}

type Body = { json: object } | { form: Record<string, string> };

export class ChapaClient {
  constructor(
    private readonly secretKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl: string = CHAPA_API_URL,
  ) {}

  /** Opens a hosted checkout and returns the page to send the customer to. */
  async initialize(request: CheckoutRequest): Promise<{ checkoutUrl: string }> {
    const payload = await this.call<{ data?: { checkout_url?: string } }>(
      'POST',
      '/transaction/initialize',
      {
        json: {
          tx_ref: request.txRef,
          amount: toChapaAmount(request.amountMinor),
          currency: request.currency,
          email: request.email,
          first_name: request.firstName,
          last_name: request.lastName,
          return_url: request.returnUrl,
          callback_url: request.callbackUrl,
          customization: { title: request.title, description: request.description },
        },
      },
    );

    const checkoutUrl = payload.data?.checkout_url;
    if (!checkoutUrl) {
      throw new ChapaError('Chapa returned no checkout_url', 502);
    }

    return { checkoutUrl };
  }

  /**
   * The transaction as Chapa sees it, or null while Chapa has no paid
   * transaction under this reference — it never heard of it, or the checkout
   * is still unpaid (Chapa answers both with a 404).
   */
  async verify(txRef: string): Promise<ChapaTransaction | null> {
    try {
      const payload = await this.call<{
        data?: {
          status?: string;
          amount?: string | number;
          currency?: string;
          reference?: string;
          method?: string;
        } | null;
      }>('GET', `/transaction/verify/${encodeURIComponent(txRef)}`);

      const data = payload.data;
      if (!data) {
        return null;
      }

      return {
        status: String(data.status ?? '').toLowerCase(),
        amountMinor: fromChapaAmount(data.amount),
        currency: String(data.currency ?? ''),
        reference: data.reference ?? null,
        method: data.method ?? null,
      };
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  /** Refunds part or all of a paid transaction. */
  async refund(
    txRef: string,
    amountMinor: number,
    { reason, reference }: { reason: string; reference: string },
  ): Promise<void> {
    await this.call('POST', `/refund/${encodeURIComponent(txRef)}`, {
      form: {
        amount: toChapaAmount(amountMinor),
        reason,
        meta: JSON.stringify({ reference }),
      },
    });
  }

  /** Banks and mobile wallets a transfer can be sent to. */
  async banks(): Promise<ChapaBank[]> {
    const payload = await this.call<{
      data?: Array<{
        id: number;
        name: string;
        is_mobilemoney?: boolean | null;
        acct_length?: number | null;
        currency?: string;
      }>;
    }>('GET', '/banks');

    return (payload.data ?? []).map((bank) => ({
      code: bank.id,
      name: bank.name,
      isMobileMoney: bank.is_mobilemoney === true,
      accountLength: bank.acct_length ?? null,
      currency: bank.currency ?? 'ETB',
    }));
  }

  /** Queues a transfer. Delivery is confirmed later (verifyTransfer, or a webhook). */
  async transfer(request: TransferRequest): Promise<void> {
    await this.call('POST', '/transfers', {
      json: {
        reference: request.reference,
        amount: toChapaAmount(request.amountMinor),
        currency: request.currency,
        bank_code: request.bankCode,
        account_number: request.accountNumber,
        account_name: request.accountName,
      },
    });
  }

  /** A transfer as Chapa sees it, or null if Chapa has never heard of it. */
  async verifyTransfer(reference: string): Promise<ChapaTransferStatus | null> {
    try {
      const payload = await this.call<{ data?: { status?: string } | null }>(
        'GET',
        `/transfers/verify/${encodeURIComponent(reference)}`,
      );

      return payload.data
        ? { status: String(payload.data.status ?? '').toLowerCase(), reference }
        : null;
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: Body): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.secretKey}` };
    let encoded: string | undefined;

    if (body && 'json' in body) {
      headers['Content-Type'] = 'application/json';
      encoded = JSON.stringify(body.json);
    } else if (body && 'form' in body) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      encoded = new URLSearchParams(body.form).toString();
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: encoded,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new ChapaError(`Chapa did not answer: ${(error as Error).message}`, 0);
    }

    const payload = (await response.json().catch(() => null)) as
      ({ status?: string; message?: unknown } & T) | null;

    if (!response.ok) {
      throw new ChapaError(
        messageOf(payload) ?? `Chapa answered ${response.status}`,
        response.status,
      );
    }

    // Chapa sometimes reports a refusal in the body of a 200.
    if (!payload || payload.status === 'failed') {
      throw new ChapaError(messageOf(payload) ?? 'Chapa reported a failure', 400);
    }

    return payload;
  }
}

/** 12345 santim → "123.45" birr, without floating point. */
export function toChapaAmount(amountMinor: number): string {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new Error(`Not a non-negative integer amount: ${amountMinor}`);
  }

  const units = Math.floor(amountMinor / 100);
  const cents = amountMinor % 100;
  return `${units}.${String(cents).padStart(2, '0')}`;
}

/** "123.45" or 123.45 birr → 12345 santim. NaN for anything unreadable. */
export function fromChapaAmount(value: unknown): number {
  const amount = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isFinite(amount) ? Math.round(amount * 100) : Number.NaN;
}

/** Chapa's `message` is a string, or an object of field errors. */
function messageOf(payload: { message?: unknown } | null): string | undefined {
  const message = payload?.message;

  if (typeof message === 'string') {
    return message;
  }

  if (message && typeof message === 'object') {
    return Object.values(message as Record<string, unknown>)
      .flat()
      .map(String)
      .join('; ');
  }

  return undefined;
}

/**
 * Chapa answers an unknown reference with 404, or a 400 saying "not found";
 * an unpaid checkout with 404 "Payment not paid yet".
 */
function isNotFound(error: unknown): boolean {
  return (
    error instanceof ChapaError &&
    (error.status === 404 || (error.status === 400 && /not found/i.test(error.message)))
  );
}
