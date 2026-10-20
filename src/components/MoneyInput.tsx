'use client';

// A dollar-amount field: shows a $ sign and thousands commas as you type ("450000" -> "$450,000"), keeps cents to
// two places, and hands the page the PLAIN number text ("450000" or "450000.5"), so everything that already reads
// these values as numbers keeps working. Use it for every place a person types money.

/** Digits and at most one decimal point with at most two cents digits. "1,234.567" -> "1234.56" */
export function cleanMoneyText(raw: string): string {
  let cleaned = raw.replace(/[^\d.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot !== -1) cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
  const [intRaw, dec] = cleaned.split('.');
  const intPart = (intRaw || '').replace(/^0+(?=\d)/, '');
  return dec !== undefined ? `${intPart || '0'}.${dec.slice(0, 2)}` : intPart;
}

/** "1234567.5" -> "1,234,567.5" */
export function formatMoneyText(raw: string): string {
  const [intPart, dec] = cleanMoneyText(raw).split('.');
  const withCommas = (intPart || '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec !== undefined ? `${withCommas}.${dec}` : withCommas;
}

interface Props {
  value: string | number | null | undefined;
  onValueChange: (plain: string) => void;
  className?: string;
  placeholder?: string;
  id?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
}

export default function MoneyInput({ value, onValueChange, className = '', placeholder, id, name, required, disabled, ...rest }: Props) {
  const shown = value === null || value === undefined || value === '' ? '' : formatMoneyText(String(value));
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" aria-hidden="true">
        $
      </span>
      <input
        id={id}
        name={name}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        required={required}
        disabled={disabled}
        aria-label={rest['aria-label']}
        placeholder={placeholder}
        value={shown}
        onChange={(e) => onValueChange(cleanMoneyText(e.target.value))}
        onWheel={(e) => e.currentTarget.blur()}
        className={className}
        style={{ paddingLeft: '1.75rem' }}
      />
    </div>
  );
}
