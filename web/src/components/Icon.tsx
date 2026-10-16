/**
 * Iconos SVG inline.
 *
 * Por qué no emojis: un emoji depende de la fuente del sistema, se ve distinto
 * en cada plataforma, no se puede colorear con tokens y no escala con precisión.
 * La versión anterior de esta UI usaba ⚡, ✕ y ⤢ como iconos estructurales, que
 * es un antipatrón.
 *
 * Por qué inline y no `@phosphor-icons/react`: son seis iconos. Una dependencia
 * de cientos de KB para eso no se justifica en una app que ya pesa 160 KB
 * comprimida y se abre desde el WiFi de un auditorio.
 *
 * Todos comparten lienzo de 24, grosor de trazo 1.75 y remates redondeados,
 * para que la familia se vea coherente.
 *
 * Accesibilidad: por defecto van con `aria-hidden`, porque casi siempre
 * acompañan a texto visible. Cuando un icono va solo dentro de un control, el
 * CONTROL lleva el `aria-label` — no el icono.
 */
interface IconProps {
  size?: number;
  className?: string;
  /** Solo si el icono transmite información que no está en el texto. */
  title?: string;
}

function Svg({
  size = 20,
  className,
  title,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

export const IconX = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const IconExpand = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9" />
    <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9" />
    <path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15" />
    <path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 13l4 4 10-10" />
  </Svg>
);

export const IconBolt = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 2.5 5 13.5h5.5L9.5 21.5l8-11.5H12l1-7.5z" />
  </Svg>
);

export const IconWallet = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 16.5v-8z" />
    <path d="M3 9h15" />
    <path d="M16.5 13h1.5" />
  </Svg>
);

export const IconKey = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8.5" cy="8.5" r="4" />
    <path d="M11.5 11.5 20 20" />
    <path d="M17 17l-2 2" />
  </Svg>
);

export const IconDevice = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
    <path d="M10.5 18.5h3" />
  </Svg>
);

export const IconSliders = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h10M18 7h2" />
    <path d="M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Svg>
);
