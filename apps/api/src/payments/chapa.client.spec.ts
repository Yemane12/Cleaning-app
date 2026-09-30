import {
  ChapaClient,
  ChapaError,
  fromChapaAmount,
  isFailedStatus,
  toChapaAmount,
} from './chapa.client';

/**
 * The real client against a fake `fetch`: what goes over the wire is what is
 * asserted, since that is what Chapa will accept or reject.
 */
describe('ChapaClient', () => {
  const answer = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

  let fetchMock: jest.Mock;
  let client: ChapaClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    client = new ChapaClient('CHASECK_TEST-key', fetchMock as unknown as typeof fetch);
  });

  const lastCall = () => {
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    return { url, init, headers: init.headers as Record<string, string> };
  };

  describe('initialize', () => {
    it('opens a checkout with the amount in birr and returns its URL', async () => {
      fetchMock.mockReturnValue(
        answer(200, { status: 'success', data: { checkout_url: 'https://checkout.chapa.co/x' } }),
      );

      const result = await client.initialize({
        txRef: 'bk-1',
        amountMinor: 150_050,
        currency: 'ETB',
        email: 'c@example.com',
        returnUrl: 'https://app.example.test/paid',
        callbackUrl: 'https://api.example.test/api/v1/payments/chapa/callback',
        title: 'Cleaning',
        description: 'Booking BK-1',
      });

      const { url, init, headers } = lastCall();
      expect(url).toBe('https://api.chapa.co/v1/transaction/initialize');
      expect(init.method).toBe('POST');
      expect(headers.Authorization).toBe('Bearer CHASECK_TEST-key');
      expect(JSON.parse(init.body as string)).toEqual(
        expect.objectContaining({
          tx_ref: 'bk-1',
          amount: '1500.50',
          currency: 'ETB',
          return_url: 'https://app.example.test/paid',
          callback_url: 'https://api.example.test/api/v1/payments/chapa/callback',
          customization: { title: 'Cleaning', description: 'Booking BK-1' },
        }),
      );
      expect(result.checkoutUrl).toBe('https://checkout.chapa.co/x');
    });

    it("surfaces Chapa's field errors as one readable message", async () => {
      fetchMock.mockReturnValue(
        answer(400, { status: 'failed', message: { email: ['The email must be valid.'] } }),
      );

      await expect(
        client.initialize({
          txRef: 'bk-1',
          amountMinor: 100,
          currency: 'ETB',
          returnUrl: 'https://x.test',
          title: 'Cleaning',
          description: 'x',
        }),
      ).rejects.toThrow('The email must be valid.');
    });
  });

  describe('verify', () => {
    it('reads a paid transaction back into santim', async () => {
      fetchMock.mockReturnValue(
        answer(200, {
          status: 'success',
          data: {
            status: 'success',
            amount: '1500.50',
            currency: 'ETB',
            reference: 'APx1',
            method: 'telebirr',
          },
        }),
      );

      await expect(client.verify('bk-1')).resolves.toEqual({
        status: 'success',
        amountMinor: 150_050,
        currency: 'ETB',
        reference: 'APx1',
        method: 'telebirr',
      });
      expect(lastCall().url).toBe('https://api.chapa.co/v1/transaction/verify/bk-1');
    });

    it('returns null for a reference Chapa has never seen', async () => {
      fetchMock.mockReturnValue(
        answer(404, { status: 'failed', message: 'Invalid transaction or Transaction not found' }),
      );

      await expect(client.verify('bk-unknown')).resolves.toBeNull();
    });

    it('returns null for a checkout that is not paid yet', async () => {
      fetchMock.mockReturnValue(
        answer(404, { status: null, message: 'Payment not paid yet', data: null }),
      );

      await expect(client.verify('bk-1')).resolves.toBeNull();
    });
  });

  it('refunds as a form post, amount in birr', async () => {
    fetchMock.mockReturnValue(answer(200, { status: 'success', data: {} }));

    await client.refund('bk-1', 2000, { reason: 'Booking cancelled', reference: 'rf-1' });

    const { url, init, headers } = lastCall();
    expect(url).toBe('https://api.chapa.co/v1/refund/bk-1');
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(init.body as string);
    expect(form.get('amount')).toBe('20.00');
    expect(form.get('reason')).toBe('Booking cancelled');
    expect(JSON.parse(form.get('meta')!)).toEqual({ reference: 'rf-1' });
  });

  it('lists banks and wallets with their account-number length', async () => {
    fetchMock.mockReturnValue(
      answer(200, {
        message: 'Banks retrieved',
        data: [
          { id: 855, name: 'telebirr', is_mobilemoney: true, acct_length: 10, currency: 'ETB' },
          { id: 946, name: 'Commercial Bank of Ethiopia', is_mobilemoney: null, acct_length: 13 },
        ],
      }),
    );

    await expect(client.banks()).resolves.toEqual([
      { code: 855, name: 'telebirr', isMobileMoney: true, accountLength: 10, currency: 'ETB' },
      {
        code: 946,
        name: 'Commercial Bank of Ethiopia',
        isMobileMoney: false,
        accountLength: 13,
        currency: 'ETB',
      },
    ]);
  });

  it('sends a transfer with our reference and the amount in birr', async () => {
    fetchMock.mockReturnValue(answer(200, { status: 'success', data: 'Transfer Queued' }));

    await client.transfer({
      reference: 'po-1-1',
      amountMinor: 3400,
      currency: 'ETB',
      bankCode: 855,
      accountNumber: '0912345678',
      accountName: 'Abebe Kebede',
    });

    const { url, init } = lastCall();
    expect(url).toBe('https://api.chapa.co/v1/transfers');
    expect(JSON.parse(init.body as string)).toEqual({
      reference: 'po-1-1',
      amount: '34.00',
      currency: 'ETB',
      bank_code: 855,
      account_number: '0912345678',
      account_name: 'Abebe Kebede',
    });
  });

  it('looks a transfer up by our reference, null if unknown', async () => {
    fetchMock.mockReturnValueOnce(answer(200, { status: 'success', data: { status: 'Success' } }));
    await expect(client.verifyTransfer('po-1-1')).resolves.toEqual({
      status: 'success',
      reference: 'po-1-1',
    });
    expect(lastCall().url).toBe('https://api.chapa.co/v1/transfers/verify/po-1-1');

    fetchMock.mockReturnValueOnce(answer(400, { status: 'failed', message: 'Transfer not found' }));
    await expect(client.verifyTransfer('po-1-2')).resolves.toBeNull();
  });

  describe('errors', () => {
    it('marks a refusal as definite: the request did not happen', async () => {
      fetchMock.mockReturnValue(answer(422, { status: 'failed', message: 'Insufficient balance' }));

      const error = await client
        .transfer({
          reference: 'po-1-1',
          amountMinor: 1,
          currency: 'ETB',
          bankCode: 1,
          accountNumber: '1',
          accountName: 'x',
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ChapaError);
      expect((error as ChapaError).definite).toBe(true);
    });

    it('marks a timeout or server error as unknown', async () => {
      fetchMock.mockRejectedValueOnce(new Error('The operation was aborted due to timeout'));
      const timeout = await client.banks().catch((e: unknown) => e);
      expect((timeout as ChapaError).definite).toBe(false);

      fetchMock.mockReturnValueOnce(answer(502, { message: 'Bad gateway' }));
      const serverError = await client.banks().catch((e: unknown) => e);
      expect((serverError as ChapaError).definite).toBe(false);
    });

    it('treats a "failed" body on a 200 as a refusal', async () => {
      fetchMock.mockReturnValue(answer(200, { status: 'failed', message: 'Invalid currency' }));

      await expect(client.refund('bk-1', 100, { reason: 'x', reference: 'y' })).rejects.toThrow(
        'Invalid currency',
      );
    });
  });

  describe('amounts', () => {
    it('converts santim to birr strings without floating point', () => {
      expect(toChapaAmount(0)).toBe('0.00');
      expect(toChapaAmount(5)).toBe('0.05');
      expect(toChapaAmount(150_050)).toBe('1500.50');
      // 0.1 + 0.2 territory: string maths, not float maths.
      expect(toChapaAmount(30)).toBe('0.30');
    });

    it('converts birr back to santim, from strings or numbers', () => {
      expect(fromChapaAmount('1500.50')).toBe(150_050);
      expect(fromChapaAmount(1500.5)).toBe(150_050);
      expect(fromChapaAmount('0.29')).toBe(29);
      expect(fromChapaAmount('abc')).toBeNaN();
    });

    it('round-trips every amount up to 100,000 birr', () => {
      const mismatches: number[] = [];
      for (let minor = 0; minor <= 10_000_000; minor += 97) {
        if (fromChapaAmount(toChapaAmount(minor)) !== minor) {
          mismatches.push(minor);
        }
      }

      expect(mismatches).toEqual([]);
    });

    it('refuses to send a fractional or negative amount', () => {
      expect(() => toChapaAmount(10.5)).toThrow();
      expect(() => toChapaAmount(-1)).toThrow();
    });
  });

  describe('isFailedStatus', () => {
    it('recognises every way Chapa says a charge or transfer is over', () => {
      for (const status of ['failed', 'cancelled', 'canceled', 'failed/cancelled', 'Failed']) {
        expect(isFailedStatus(status)).toBe(true);
      }
    });

    it('never mistakes success or an in-flight state for failure', () => {
      for (const status of ['success', 'pending', '', 'success/failed']) {
        expect(isFailedStatus(status)).toBe(false);
      }
    });
  });
});
