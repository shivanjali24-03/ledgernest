import { useEffect, useRef } from 'react';
import { INDIAN_STATES, PIN_CODE, type PinLookup } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../auth/client';
import { SelectField, TextField } from '../ui/Field';
import { usePinLookup } from './pinLookup';

export type IndianAddress = { line1: string; line2: string; city: string; region: string; postalCode: string };
type Field = keyof IndianAddress;

/** The choice list for a looked-up field, keeping a value saved before (or typed) so nothing is lost */
const choices = (list: string[], current: string, placeholder: string) => [{ value: '', label: placeholder }, ...(current && !list.includes(current) ? [current] : []).map((v) => ({ value: v, label: v })), ...list.map((v) => ({ value: v, label: v }))];

/**
 * An Indian address filled from its PIN code: the state comes from the GST list, and once India Post knows the PIN,
 * the city and the area are picked from its towns and post offices rather than typed. Typing is the fallback when
 * the PIN isn't known or the directory can't be reached. The street (line 1) is always typed.
 */
export default function IndianAddressFields({ value, onChange, error, disabled, autoComplete }: { value: IndianAddress; onChange: (patch: Partial<IndianAddress>) => void; error?: (f: Field) => string | undefined; disabled?: boolean; autoComplete?: boolean }) {
  const { t } = useTranslation();
  const pin = value.postalCode.replace(/\s/g, '');
  const lookup = usePinLookup(pin);
  const found: PinLookup | undefined = lookup.data?.pin === pin ? lookup.data : undefined;
  // Fill from the PIN when it changes, not for an address opened as saved
  const filledFor = useRef(PIN_CODE.test(pin) ? pin : '');
  useEffect(() => {
    if (!found || filledFor.current === pin) return;
    filledFor.current = pin;
    onChange({
      ...(found.state ? { region: found.state.name } : {}),
      city: found.cities.includes(value.city) ? value.city : (found.district ?? ''),
      line2: found.localities.some((l) => l.name === value.line2) ? value.line2 : (found.localities.find((l) => l.delivery)?.name ?? found.localities[0]?.name ?? value.line2),
    });
  }, [found, pin, value.city, value.line2, onChange]);

  const status = !pin
    ? t('address.pinHint')
    : !PIN_CODE.test(pin)
      ? t('address.pinInvalid')
      : lookup.isFetching
        ? t('address.looking')
        : found
          ? t('address.found', { district: found.district, state: found.state?.name ?? '' })
          : lookup.error instanceof ApiError && lookup.error.details?.reason === 'unknown_pin'
            ? t('address.unknown')
            : lookup.error
              ? t('address.unreachable')
              : '';
  const ac = (v: string) => (autoComplete ? v : undefined);
  return (
    <>
      <TextField
        label={t('address.pin')}
        value={value.postalCode}
        onChange={(e) => onChange({ postalCode: e.target.value.replace(/\D/g, '').slice(0, 6) })}
        error={error?.('postalCode')}
        hint={<span aria-live="polite">{status}</span>}
        inputMode="numeric"
        dir="ltr"
        disabled={disabled}
        autoComplete={ac('postal-code')}
      />
      <SelectField
        label={t('address.state')}
        value={INDIAN_STATES.find((s) => s.name === value.region)?.name ?? ''}
        onChange={(e) => onChange({ region: e.target.value })}
        error={error?.('region')}
        disabled={disabled}
        options={[{ value: '', label: t('address.chooseState') }, ...INDIAN_STATES.map((s) => ({ value: s.name, label: `${s.code} · ${s.name}` }))]}
      />
      {found ? (
        <>
          <SelectField label={t('address.city')} value={value.city} onChange={(e) => onChange({ city: e.target.value })} error={error?.('city')} disabled={disabled} options={choices(found.cities, value.city, t('address.chooseCity'))} />
          <SelectField label={t('address.area')} value={value.line2} onChange={(e) => onChange({ line2: e.target.value })} error={error?.('line2')} disabled={disabled} options={choices(found.localities.map((l) => l.name), value.line2, t('address.chooseArea'))} />
        </>
      ) : (
        <>
          <TextField label={t('address.city')} value={value.city} onChange={(e) => onChange({ city: e.target.value })} error={error?.('city')} disabled={disabled} dir="auto" autoComplete={ac('address-level2')} />
          <TextField label={t('address.area')} value={value.line2} onChange={(e) => onChange({ line2: e.target.value })} error={error?.('line2')} disabled={disabled} dir="auto" autoComplete={ac('address-line2')} />
        </>
      )}
      <div className="sm:col-span-2">
        <TextField label={t('address.line1')} value={value.line1} onChange={(e) => onChange({ line1: e.target.value })} error={error?.('line1')} disabled={disabled} dir="auto" autoComplete={ac('address-line1')} />
      </div>
    </>
  );
}
