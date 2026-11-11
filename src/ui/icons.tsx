/**
 * Small stroke icons (16px grid, currentColor). Inline SVG keeps the bundle
 * dependency-free and lets every icon inherit its link's color.
 */
type IconProps = { size?: number; className?: string };

function Svg({ size = 16, className = "icon", children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3.5v9M3.5 8h9" />
  </Svg>
);

export const IconShipments = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 5.5 8 2.5l5.5 3v5L8 13.5l-5.5-3z" />
    <path d="M2.5 5.5 8 8.5l5.5-3M8 8.5v5" />
  </Svg>
);

export const IconReview = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 3.5h10M3 8h6M3 12.5h4" />
    <path d="m10.5 11.5 1.5 1.5 2.5-3" />
  </Svg>
);

export const IconSpark = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2v3M8 11v3M2 8h3M11 8h3M3.8 3.8l2 2M10.2 10.2l2 2M3.8 12.2l2-2M10.2 5.8l2-2" />
  </Svg>
);

export const IconPlug = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 2.5v3M10 2.5v3M4.5 5.5h7v2.5a3.5 3.5 0 0 1-7 0z" />
    <path d="M8 11.5v2" />
  </Svg>
);

export const IconArrowUp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 13V3.5M4 7.5l4-4 4 4" />
  </Svg>
);

export const IconRoute = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="4" cy="4" r="1.5" />
    <circle cx="12" cy="12" r="1.5" />
    <path d="M5.5 4H10a2 2 0 0 1 0 4H6a2 2 0 0 0 0 4h4.5" />
  </Svg>
);

export const IconTool = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 2.5a3 3 0 0 0-2.8 4.1L2.5 11.3l2.2 2.2 4.7-4.7A3 3 0 0 0 13.5 6l-1.8 1.8-1.9-.4-.4-1.9L11.2 3.7A3 3 0 0 0 10 2.5z" />
  </Svg>
);
