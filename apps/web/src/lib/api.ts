import { publicEnv } from './env';
import { accessToken } from './supabase';
import type {
  Address,
  Booking,
  BookingListItem,
  Cleaner,
  CreatedBooking,
  NewAddress,
  PaymentSummary,
  Profile,
  Quote,
  Service,
  Slot,
} from './types';

/** A refusal from the API, carrying its message for the user. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Method = 'GET' | 'POST' | 'PATCH';

export interface RequestOptions {
  method?: Method;
  body?: unknown;
  /** Defaults to the signed-in user's token. */
  token?: string | null;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

/** One call to the API, as the signed-in user. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = options.token === undefined ? await accessToken() : options.token;
  const baseUrl = options.baseUrl ?? publicEnv().apiUrl;
  const fetchImpl = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/v1${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError('network', 0);
  }

  const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(messageOf(payload) ?? `HTTP ${response.status}`, response.status);
  }

  return payload as T;
}

/** Nest answers `{ message: string | string[] }`; validation errors come as a list. */
export function messageOf(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const message = (payload as { message?: unknown }).message;
  if (Array.isArray(message)) {
    return message.map(String).join('; ');
  }
  return typeof message === 'string' ? message : undefined;
}

const query = (params: Record<string, string | number>) =>
  new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));

/** Every API call the app makes. */
export const api = {
  me: () => request<Profile>('/auth/me'),
  updateMe: (changes: { fullName?: string; phone?: string }) =>
    request<Profile>('/auth/me', { method: 'PATCH', body: changes }),

  services: () => request<Service[]>('/services'),
  quote: (serviceId: string, durationMinutes: number) =>
    request<Quote>(`/services/${serviceId}/quote?${query({ durationMinutes })}`),

  cleaners: () => request<Cleaner[]>('/cleaners'),
  slots: (cleanerId: string, date: string, durationMinutes: number) =>
    request<Slot[]>(`/cleaners/${cleanerId}/slots?${query({ date, durationMinutes })}`),

  addresses: () => request<Address[]>('/addresses'),
  addAddress: (address: NewAddress) =>
    request<Address>('/addresses', { method: 'POST', body: address }),

  book: (booking: {
    cleanerId: string;
    serviceId: string;
    addressId: string;
    scheduledStart: string;
    durationMinutes: number;
    customerNotes?: string;
  }) => request<CreatedBooking>('/bookings', { method: 'POST', body: booking }),
  bookings: () => request<BookingListItem[]>('/bookings'),
  booking: (id: string) => request<Booking>(`/bookings/${id}`),
  payment: (id: string) => request<PaymentSummary>(`/bookings/${id}/payment`),
  syncPayment: (id: string) => request<Booking>(`/bookings/${id}/payment/sync`, { method: 'POST' }),
  cancel: (id: string, reason?: string) =>
    request<Booking>(`/bookings/${id}/cancel`, {
      method: 'PATCH',
      body: reason ? { reason } : {},
    }),
};
