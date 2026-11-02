import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 22, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const ShieldIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3l7 3.5v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9v-5z" />
    <path d="M9 12l2 2 4-4" />
  </Icon>
);

export const LayersIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7" height="7" rx="2" />
    <rect x="14" y="3" width="7" height="7" rx="2" />
    <rect x="8.5" y="14" width="7" height="7" rx="2" />
    <path d="M6.5 10v2h11v-2M12 12v2" />
  </Icon>
);

export const BrainIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4a4 4 0 0 0-4 4c-2 0-3.5 1.5-3.5 3.5S6 15 8 15c0 2 2 4 4 4s4-2 4-4c2 0 3.5-1.5 3.5-3.5S18 8 16 8a4 4 0 0 0-4-4z" />
    <path d="M12 8v11" />
  </Icon>
);

export const GaugeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 14a8 8 0 0 1 16 0" />
    <path d="M12 14l4-4" />
    <path d="M4 18h16" />
  </Icon>
);

export const SparkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
  </Icon>
);

export const BranchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="6" cy="18" r="2.5" />
    <circle cx="18" cy="8" r="2.5" />
    <path d="M6 8.5v7M18 10.5c0 4-6 3-12 5" />
  </Icon>
);

export const SunIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
);

export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12l5 5 9-10" />
  </Icon>
);

export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const ChevronIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
);

export const ArrowUpIcon = (p: IconProps) => (
  <Icon strokeWidth={2.5} {...p}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </Icon>
);

export const CycleIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 12a8 8 0 0 1-13.7 5.7M4 12a8 8 0 0 1 13.7-5.7" />
    <path d="M18 3v4h-4M6 21v-4h4" />
  </Icon>
);
