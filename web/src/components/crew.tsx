// The four crew mascots from the design reference. Decorative: the name always appears as text.

interface MascotProps {
  size?: number;
  className?: string;
}

export function Scout({ size = 64, className }: MascotProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="36" r="22" fill="#4285F4" />
      <circle cx="25" cy="33" r="3.2" fill="#FFFFFF" />
      <circle className="eye" cx="25" cy="33" r="1.8" fill="#041E49" />
      <circle cx="40" cy="31" r="9" fill="#E8F0FE" stroke="#041E49" strokeWidth="2.5" />
      <circle className="eye" cx="40" cy="31" r="3" fill="#041E49" />
      <path d="M46.5 37.5l6 6" stroke="#041E49" strokeWidth="3" strokeLinecap="round" />
      <path d="M26 45q6 4 12 0" stroke="#FFFFFF" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function Sage({ size = 64, className }: MascotProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M14 22l6-10 6 7h12l6-7 6 10v20c0 9-8 16-18 16S14 51 14 42z" fill="#A142F4" />
      <circle cx="25" cy="31" r="7" fill="#FFFFFF" />
      <circle cx="39" cy="31" r="7" fill="#FFFFFF" />
      <circle className="eye" cx="25" cy="31" r="3.4" fill="#21005D" />
      <circle className="eye" cx="39" cy="31" r="3.4" fill="#21005D" />
      <path d="M29 38l3 4 3-4z" fill="#F9AB00" />
      <path d="M22 47q10 6 20 0" stroke="#EADDFF" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function Guard({ size = 64, className }: MascotProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 8l20 8v14c0 13-9 21-20 26-11-5-20-13-20-26V16z" fill="#34A853" />
      <circle cx="25" cy="27" r="5" fill="#FFFFFF" />
      <circle cx="39" cy="27" r="5" fill="#FFFFFF" />
      <circle className="eye" cx="25" cy="27" r="2.4" fill="#072711" />
      <circle className="eye" cx="39" cy="27" r="2.4" fill="#072711" />
      <path d="M24 39l6 6 11-11" stroke="#FFFFFF" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Ballast({ size = 64, className }: MascotProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect x="12" y="14" width="40" height="40" rx="14" fill="#F9AB00" />
      <circle cx="25" cy="29" r="4.5" fill="#FFFFFF" />
      <circle cx="39" cy="29" r="4.5" fill="#FFFFFF" />
      <circle className="eye" cx="25" cy="29" r="2.2" fill="#3E2700" />
      <circle className="eye" cx="39" cy="29" r="2.2" fill="#3E2700" />
      <path d="M20 46a12 12 0 0 1 24 0" stroke="#3E2700" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M32 46l6-6" stroke="#3E2700" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
