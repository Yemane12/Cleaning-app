'use client';

import { useState } from 'react';
import { BackLink } from '@/components/BackLink';
import { Alert, Button, Card, Field, Loading, PageTitle } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { accountNumberProblem, sortBanks } from '@/lib/banks';
import { useFormat } from '@/lib/format';
import type { Bank, PayoutAccount } from '@/lib/types';
import { useResource } from '@/lib/use-resource';

/** Where a cleaner's pay goes: a mobile wallet or a bank account, from Chapa's list. */
export default function PayoutPage() {
  const { t } = useI18n();
  const format = useFormat();
  const loaded = useResource(() => Promise.all([api.banks(), api.payoutAccount()]));

  if (!loaded.value) {
    return loaded.error !== null ? (
      <Alert tone="error">{format.error(loaded.error)}</Alert>
    ) : (
      <Loading label={t('common.loading')} />
    );
  }

  const [banks, account] = loaded.value;
  return (
    <div className="mx-auto max-w-md space-y-6">
      <BackLink />
      <PageTitle>{t('cleaner.payout.title')}</PageTitle>
      <p className="text-stone-600">{t('cleaner.payout.intro')}</p>
      <PayoutForm banks={banks} account={account} onSaved={loaded.reload} />
    </div>
  );
}

function PayoutForm({
  banks,
  account,
  onSaved,
}: {
  banks: Bank[];
  account: PayoutAccount;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const format = useFormat();
  const { profile, refreshProfile } = useAuth();
  const [bankCode, setBankCode] = useState<number | null>(account.bankCode);
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState(account.accountName ?? profile?.fullName ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const grouped = sortBanks(banks);
  const bank = banks.find((candidate) => candidate.code === bankCode);
  const digits = accountNumber.replace(/[\s-]/g, '');

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!bank) return;
    const problem = accountNumberProblem(digits, bank);
    if (problem) {
      setMessage({
        tone: 'error',
        text: t(`cleaner.payout.problems.${problem}`, {
          bank: bank.name,
          length: bank.accountLength ?? 0,
        }),
      });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      await api.setPayoutAccount({
        bankCode: bank.code,
        accountNumber: digits,
        accountName: accountName.trim(),
      });
      await refreshProfile();
      setAccountNumber('');
      setMessage({ tone: 'success', text: t('cleaner.payout.saved', { bank: bank.name }) });
      onSaved();
    } catch (failure) {
      setMessage({ tone: 'error', text: format.error(failure) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {account.payoutsEnabled && account.bankName && (
        <Alert tone="success">
          {t('cleaner.payout.current', {
            bank: account.bankName,
            last4: account.accountNumberLast4 ?? '',
            name: account.accountName ?? '',
          })}
        </Alert>
      )}
      <Card>
        <form onSubmit={save} className="space-y-4">
          {message && <Alert tone={message.tone}>{message.text}</Alert>}
          <label className="block space-y-1">
            <span className="text-sm font-medium text-stone-800">{t('cleaner.payout.method')}</span>
            <select
              required
              value={bankCode ?? ''}
              onChange={(event) => setBankCode(Number(event.target.value) || null)}
              className="block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
            >
              <option value="">{t('cleaner.payout.choose')}</option>
              <optgroup label={t('cleaner.payout.wallets')}>
                {grouped.wallets.map((wallet) => (
                  <option key={wallet.code} value={wallet.code}>
                    {wallet.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t('cleaner.payout.banks')}>
                {grouped.banks.map((candidate) => (
                  <option key={candidate.code} value={candidate.code}>
                    {candidate.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <Field
            label={
              bank?.isMobileMoney
                ? t('cleaner.payout.walletNumber')
                : t('cleaner.payout.accountNumber')
            }
            hint={
              bank?.isMobileMoney
                ? t('cleaner.payout.walletHint')
                : bank?.accountLength
                  ? t('cleaner.payout.lengthHint', { length: bank.accountLength })
                  : undefined
            }
            inputMode="numeric"
            autoComplete="off"
            required
            value={accountNumber}
            onChange={(event) => setAccountNumber(event.target.value)}
          />
          <Field
            label={t('cleaner.payout.accountName')}
            hint={t('cleaner.payout.accountNameHint')}
            required
            minLength={2}
            maxLength={100}
            value={accountName}
            onChange={(event) => setAccountName(event.target.value)}
          />
          <Button type="submit" busy={busy} disabled={!bank}>
            {t('cleaner.payout.save')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
