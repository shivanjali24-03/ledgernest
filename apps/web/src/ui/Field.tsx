import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import clsx from 'clsx';

export const inputClass =
  'h-10 w-full rounded-xl border bg-white px-3 text-sm outline-none transition-colors placeholder:text-ink-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 disabled:opacity-60 dark:bg-ink-900';

interface FieldProps {
  label: string;
  error?: string;
  hint?: ReactNode;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}

/** Label, control, hint and error wired together for screen readers. */
export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-xs text-ink-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1.5 text-xs text-expense">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextField({ label, error, hint, className, ...input }: Omit<FieldProps, 'children'> & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} error={error} hint={hint}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={clsx(inputClass, invalid ? 'border-expense' : 'border-ink-200 dark:border-ink-700', className)}
          {...input}
        />
      )}
    </Field>
  );
}

export function SelectField({
  label,
  error,
  hint,
  options,
  className,
  ...select
}: Omit<FieldProps, 'children'> & SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string; disabled?: boolean }[] }) {
  return (
    <Field label={label} error={error} hint={hint}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={clsx(inputClass, 'pe-8', invalid ? 'border-expense' : 'border-ink-200 dark:border-ink-700', className)}
          {...select}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}
