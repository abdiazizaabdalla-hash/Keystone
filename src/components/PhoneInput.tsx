'use client';

import { formatPhoneInput } from '@/lib/formatPhone';

// A phone field that formats as you type ("5125550123" -> "(512) 555-0123"). Use it everywhere a phone number is
// typed. Hands the page the formatted text. Existing saved numbers are shown formatted too, but a value that is
// not a plain US number (international, extension) is shown and kept exactly as saved.

interface Props {
  value: string | null | undefined;
  onValueChange: (formatted: string) => void;
  className?: string;
  placeholder?: string;
  id?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  onBlur?: (value: string) => void;
  'aria-label'?: string;
}

export default function PhoneInput({ value, onValueChange, className = '', placeholder = '(555) 123-4567', onBlur, ...rest }: Props) {
  return (
    <input
      id={rest.id}
      name={rest.name}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      required={rest.required}
      disabled={rest.disabled}
      aria-label={rest['aria-label']}
      placeholder={placeholder}
      value={formatPhoneInput(value)}
      onChange={(e) => onValueChange(formatPhoneInput(e.target.value))}
      onBlur={onBlur ? (e) => onBlur(e.target.value) : undefined}
      maxLength={40}
      className={className}
    />
  );
}
