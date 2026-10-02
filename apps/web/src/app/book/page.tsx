'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RequireRole } from '@/components/RequireRole';
import { Alert, Button, Card, Choice, Field, Loading, PageTitle, TextArea } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { DEFAULT_TIME_ZONE, dateIn, upcomingDates } from '@/lib/time';
import type { Address, Cleaner, Quote, Service, Slot } from '@/lib/types';

/** How far ahead a customer can book, and how much longer than the base visit. */
const BOOKABLE_DAYS = 14;
const MAX_EXTRA_MINUTES = 240;
const MAX_DURATION_MINUTES = 600;

export default function BookPage() {
  return (
    <RequireRole role="CUSTOMER">
      <BookingFlow />
    </RequireRole>
  );
}

interface Catalogue {
  services: Service[];
  cleaners: Cleaner[];
  addresses: Address[];
}

function BookingFlow() {
  const { t } = useI18n();
  const format = useFormat();
  const router = useRouter();

  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);

  const [serviceId, setServiceId] = useState<string | null>(null);
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null);
  const [cleanerId, setCleanerId] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [chosenSlot, setChosenSlot] = useState<string | null>(null);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);

  useEffect(() => {
    Promise.all([api.services(), api.cleaners(), api.addresses()])
      .then(([services, cleaners, addresses]) => {
        setCatalogue({ services, cleaners, addresses });
        const preferred = addresses.find((address) => address.isDefault) ?? addresses[0];
        if (preferred) setAddressId(preferred.id);
      })
      .catch(setLoadError);
  }, []);

  const service = catalogue?.services.find((candidate) => candidate.id === serviceId) ?? null;
  const cleaner = catalogue?.cleaners.find((candidate) => candidate.id === cleanerId) ?? null;
  const timeZone = cleaner?.timeZone ?? DEFAULT_TIME_ZONE;
  const days = upcomingDates(BOOKABLE_DAYS, timeZone);
  const durations = service ? durationOptions(service) : [];

  // The price for the chosen service and length, from the API's own quote.
  // Each answer is kept with the question it answers, so a stale one never shows.
  const quoteKey = serviceId && durationMinutes ? `${serviceId}/${durationMinutes}` : null;
  const quoted = useKeyedLoad(quoteKey, () => api.quote(serviceId!, durationMinutes!));
  const quote: Quote | null = quoted.value ?? null;

  // Free times for the chosen cleaner, day and length.
  const slotsKey =
    cleanerId && date && durationMinutes ? `${cleanerId}/${date}/${durationMinutes}` : null;
  const slotLoad = useKeyedLoad(slotsKey, () => api.slots(cleanerId!, date!, durationMinutes!));
  const slots: Slot[] | null = slotLoad.value ?? null;
  // A choice from an earlier day or length is no longer on offer.
  const slotStart = slots?.some((slot) => slot.start === chosenSlot) ? chosenSlot : null;

  function chooseService(next: Service) {
    setServiceId(next.id);
    setDurationMinutes(next.baseDurationMinutes);
  }

  function chooseCleaner(next: Cleaner) {
    setCleanerId(next.id);
    setDate((current) => current ?? dateIn(new Date(), next.timeZone));
  }

  async function payAndBook() {
    if (!serviceId || !cleanerId || !addressId || !slotStart || !durationMinutes) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const booking = await api.book({
        serviceId,
        cleanerId,
        addressId,
        scheduledStart: slotStart,
        durationMinutes,
        customerNotes: notes.trim() || undefined,
      });
      if (booking.payment.checkoutUrl) {
        // Chapa's hosted checkout; it returns to /payment/return?booking=…
        window.location.assign(booking.payment.checkoutUrl);
      } else {
        router.push(`/bookings/${booking.id}`);
      }
    } catch (error) {
      setSubmitError(error);
      setSubmitting(false);
    }
  }

  if (loadError) {
    return <Alert tone="error">{format.error(loadError)}</Alert>;
  }
  if (!catalogue) {
    return <Loading label={t('common.loading')} />;
  }

  const cleanerName = (candidate: Cleaner | null) => candidate?.name ?? t('common.unnamedCleaner');

  return (
    <div className="space-y-6">
      <PageTitle>{t('book.title')}</PageTitle>

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">{t('book.service.title')}</h2>
        {catalogue.services.length === 0 ? (
          <p className="text-stone-600">{t('book.service.none')}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {catalogue.services.map((candidate) => (
              <Choice
                key={candidate.id}
                selected={candidate.id === serviceId}
                onSelect={() => chooseService(candidate)}
              >
                <span className="block font-semibold">{candidate.name}</span>
                {candidate.description && (
                  <span className="block text-stone-600">{candidate.description}</span>
                )}
                <span className="mt-1 block text-stone-700">
                  {t('book.service.from', {
                    price: format.money(candidate.basePriceMinor, candidate.currency),
                  })}
                  {' · '}
                  {format.duration(candidate.baseDurationMinutes)}
                </span>
              </Choice>
            ))}
          </div>
        )}

        {service && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-stone-800">{t('book.service.duration')}</p>
            <div className="flex flex-wrap gap-2">
              {durations.map((minutes) => (
                <Choice
                  key={minutes}
                  selected={minutes === durationMinutes}
                  onSelect={() => setDurationMinutes(minutes)}
                >
                  {format.duration(minutes)}
                </Choice>
              ))}
            </div>
            {quote && (
              <p className="text-sm font-semibold text-stone-900">
                {t('book.service.price', { price: format.money(quote.priceMinor, quote.currency) })}
              </p>
            )}
          </div>
        )}
      </Card>

      {service && (
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold">{t('book.cleaner.title')}</h2>
          {catalogue.cleaners.length === 0 ? (
            <p className="text-stone-600">{t('book.cleaner.none')}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {catalogue.cleaners.map((candidate) => (
                <Choice
                  key={candidate.id}
                  selected={candidate.id === cleanerId}
                  onSelect={() => chooseCleaner(candidate)}
                >
                  <span className="block font-semibold">{cleanerName(candidate)}</span>
                  {candidate.bio && <span className="block text-stone-600">{candidate.bio}</span>}
                </Choice>
              ))}
            </div>
          )}
        </Card>
      )}

      {cleaner && date && (
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold">{t('book.time.title')}</h2>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {days.map((day) => (
              <Choice
                key={day}
                selected={day === date}
                onSelect={() => setDate(day)}
                className="shrink-0"
              >
                {format.day(day)}
              </Choice>
            ))}
          </div>
          <p className="text-sm font-medium text-stone-800">
            {t('book.time.slots', { day: format.day(date) })}
          </p>
          {slotLoad.error ? (
            <Alert tone="error">{format.error(slotLoad.error)}</Alert>
          ) : slots === null ? (
            <Loading label={t('common.loading')} />
          ) : slots.length === 0 ? (
            <p className="text-stone-600">{t('book.time.none')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {slots.map((slot) => (
                <Choice
                  key={slot.start}
                  selected={slot.start === slotStart}
                  onSelect={() => setChosenSlot(slot.start)}
                >
                  {format.time(slot.start, timeZone)}
                </Choice>
              ))}
            </div>
          )}
          <p className="text-xs text-stone-500">{t('book.time.zone')}</p>
        </Card>
      )}

      {slotStart && (
        <AddressStep
          addresses={catalogue.addresses}
          selectedId={addressId}
          onSelect={setAddressId}
          onAdded={(address) => {
            setCatalogue((current) =>
              current ? { ...current, addresses: [...current.addresses, address] } : current,
            );
            setAddressId(address.id);
          }}
        />
      )}

      {slotStart && addressId && service && quote && durationMinutes && (
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold">{t('book.review.title')}</h2>
          <div className="space-y-1 text-stone-800">
            <p className="font-semibold">
              {t('book.review.summary', { service: service.name, cleaner: cleanerName(cleaner) })}
            </p>
            <p>
              {t('book.review.when', {
                when: format.dateTime(slotStart, timeZone),
                duration: format.duration(durationMinutes),
              })}
            </p>
            <p>
              {t('book.review.total')}:{' '}
              <span className="font-semibold">
                {format.money(quote.priceMinor, quote.currency)}
              </span>
            </p>
          </div>
          <TextArea
            label={t('book.review.notes')}
            optionalLabel={t('common.optional')}
            rows={3}
            maxLength={1000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
          <p className="text-sm text-stone-600">{t('book.review.policy')}</p>
          {submitError !== null && <Alert tone="error">{format.error(submitError)}</Alert>}
          <Button onClick={() => void payAndBook()} busy={submitting} className="w-full">
            {submitting
              ? t('book.review.paying')
              : t('book.review.pay', { price: format.money(quote.priceMinor, quote.currency) })}
          </Button>
        </Card>
      )}
    </div>
  );
}

/** The lengths on offer: the base visit, then half-hour steps up to a cap. */
function durationOptions(service: Service): number[] {
  const longest = Math.min(service.baseDurationMinutes + MAX_EXTRA_MINUTES, MAX_DURATION_MINUTES);
  const options: number[] = [];
  for (let minutes = service.baseDurationMinutes; minutes <= longest; minutes += 30) {
    options.push(minutes);
  }
  return options;
}

/**
 * Loads `load()` whenever `key` changes and reports the answer only while it
 * still matches the current key — so changing a choice never briefly shows
 * the previous choice's price or times. `null` key: nothing to load.
 */
function useKeyedLoad<T>(
  key: string | null,
  load: () => Promise<T>,
): { value?: T; error?: unknown } {
  const [result, setResult] = useState<{ key: string; value?: T; error?: unknown } | null>(null);

  useEffect(() => {
    if (!key) return;
    let current = true;
    load().then(
      (value) => current && setResult({ key, value }),
      (error: unknown) => current && setResult({ key, error }),
    );
    return () => {
      current = false;
    };
    // `load` is a fresh closure each render; `key` names what it loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return result && result.key === key ? result : {};
}

function AddressStep({
  addresses,
  selectedId,
  onSelect,
  onAdded,
}: {
  addresses: Address[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdded: (address: Address) => void;
}) {
  const { t } = useI18n();
  const format = useFormat();
  const [adding, setAdding] = useState(addresses.length === 0);
  const [form, setForm] = useState({
    label: '',
    line1: '',
    line2: '',
    city: 'Addis Ababa',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const update =
    (field: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [field]: event.target.value }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const address = await api.addAddress({
        label: form.label.trim() || undefined,
        line1: form.line1.trim(),
        line2: form.line2.trim() || undefined,
        city: form.city.trim(),
        notes: form.notes.trim() || undefined,
      });
      onAdded(address);
      setAdding(false);
    } catch (failure) {
      setError(failure);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-semibold">{t('book.address.title')}</h2>
      {addresses.length === 0 && !adding && (
        <p className="text-stone-600">{t('book.address.none')}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {addresses.map((address) => (
          <Choice
            key={address.id}
            selected={address.id === selectedId}
            onSelect={() => onSelect(address.id)}
          >
            {address.label && <span className="block font-semibold">{address.label}</span>}
            <span className="block">{address.line1}</span>
            <span className="block text-stone-600">{address.city}</span>
          </Choice>
        ))}
      </div>

      {adding ? (
        <form onSubmit={save} className="space-y-3 rounded-lg border border-stone-200 p-4">
          {error !== null && <Alert tone="error">{format.error(error)}</Alert>}
          <Field
            label={t('book.address.label')}
            optionalLabel={t('common.optional')}
            hint={t('book.address.labelHint')}
            maxLength={60}
            value={form.label}
            onChange={update('label')}
          />
          <Field
            label={t('book.address.line1')}
            required
            maxLength={200}
            value={form.line1}
            onChange={update('line1')}
          />
          <Field
            label={t('book.address.line2')}
            optionalLabel={t('common.optional')}
            maxLength={200}
            value={form.line2}
            onChange={update('line2')}
          />
          <Field
            label={t('book.address.city')}
            required
            maxLength={100}
            value={form.city}
            onChange={update('city')}
          />
          <TextArea
            label={t('book.address.notes')}
            optionalLabel={t('common.optional')}
            rows={2}
            maxLength={500}
            value={form.notes}
            onChange={update('notes')}
          />
          <div className="flex gap-2">
            <Button type="submit" busy={saving}>
              {t('book.address.saveAddress')}
            </Button>
            {addresses.length > 0 && (
              <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
                {t('common.cancel')}
              </Button>
            )}
          </div>
        </form>
      ) : (
        <Button variant="secondary" onClick={() => setAdding(true)}>
          {t('book.address.add')}
        </Button>
      )}
    </Card>
  );
}
