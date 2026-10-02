import type { Bank } from './types';

/** Mobile wallets first (what most cleaners use), then banks, each by name. */
export function sortBanks(banks: Bank[]): { wallets: Bank[]; banks: Bank[] } {
  const byName = (a: Bank, b: Bank) => a.name.localeCompare(b.name);
  return {
    wallets: banks.filter((bank) => bank.isMobileMoney).sort(byName),
    banks: banks.filter((bank) => !bank.isMobileMoney).sort(byName),
  };
}

/** Why an account number would be refused, checked before saving. */
export function accountNumberProblem(
  accountNumber: string,
  bank: Bank | undefined,
): 'digits' | 'length' | null {
  if (!/^[0-9]{6,20}$/.test(accountNumber)) return 'digits';
  if (bank?.accountLength && accountNumber.length !== bank.accountLength) return 'length';
  return null;
}
