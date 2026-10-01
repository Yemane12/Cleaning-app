import type { ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from 'react';

/** Small, unstyled-elsewhere building blocks, so every screen looks alike. */

type Variant = 'primary' | 'secondary' | 'danger';

const variants: Record<Variant, string> = {
  primary: 'bg-emerald-700 text-white hover:bg-emerald-800 disabled:bg-emerald-700/50',
  secondary:
    'border border-stone-300 bg-white text-stone-800 hover:bg-stone-50 disabled:text-stone-400',
  danger: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-red-700/50',
};

export function Button({
  variant = 'primary',
  busy = false,
  className = '',
  disabled,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...props}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner() {
  return (
    <span
      aria-hidden
      className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

export function Card({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-stone-200 bg-white p-5 shadow-sm ${className}`}>
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  optionalLabel,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  /** Shown after the label when the field may be left empty. */
  optionalLabel?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-stone-800">
        {label}
        {optionalLabel && <span className="font-normal text-stone-500"> ({optionalLabel})</span>}
      </span>
      <input
        {...props}
        className="block w-full rounded-lg border border-stone-300 px-3 py-2 text-stone-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
      />
      {hint && <span className="block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

export function TextArea({
  label,
  optionalLabel,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; optionalLabel?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-stone-800">
        {label}
        {optionalLabel && <span className="font-normal text-stone-500"> ({optionalLabel})</span>}
      </span>
      <textarea
        {...props}
        className="block w-full rounded-lg border border-stone-300 px-3 py-2 text-stone-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
      />
    </label>
  );
}

const tones = {
  error: 'border-red-200 bg-red-50 text-red-800',
  info: 'border-sky-200 bg-sky-50 text-sky-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
};

export function Alert({
  tone = 'info',
  children,
}: {
  tone?: keyof typeof tones;
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}
    >
      {children}
    </div>
  );
}

export function PageTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="text-2xl font-bold tracking-tight text-stone-900">{children}</h1>;
}

export function Loading({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-stone-600">
      <Spinner />
      {label}
    </p>
  );
}

/** A choice among options, as a row of toggle buttons. */
export function Choice({
  selected,
  onSelect,
  children,
  className = '',
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
        selected
          ? 'border-emerald-700 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-700/20'
          : 'border-stone-300 bg-white text-stone-800 hover:border-stone-400'
      } ${className}`}
    >
      {children}
    </button>
  );
}
