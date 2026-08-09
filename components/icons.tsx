/**
 * COUNCIL icon set — hand-drawn inline SVGs. No emojis anywhere.
 * Each icon accepts a className for sizing/coloring via currentColor.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = (props: IconProps) => ({
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...props,
});

/** The Council seal — a gavel resting on a sound block. */
export function GavelIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M13.5 6.5 17 3l4 4-3.5 3.5" />
      <path d="M4 17h10" />
      <path d="M6.5 14.5 14.5 6.5" />
      <path d="m14.5 6.5 3 3" />
      <path d="M9 14.5 4 19.5" />
      <path d="M3 21h14" />
    </svg>
  );
}

/** Scales of justice. */
export function ScalesIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3v18" />
      <path d="M8 21h8" />
      <path d="M5 5h14" />
      <path d="M5 5c-1.5 1.5-1.5 4 0 6 1.5 1.5 4 1.5 5.5 0" />
      <path d="M19 5c1.5 1.5 1.5 4 0 6-1.5 1.5-4 1.5-5.5 0" />
      <path d="M12 5v3" />
    </svg>
  );
}

/** A single eye — the Reasoner's clarity. */
export function EyeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

/** A shield with a crack — the Skeptic finds the fault line. */
export function ShieldIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3 5 5.5v5.2c0 4.6 3 8.1 7 9.8 4-1.7 7-5.2 7-9.8V5.5L12 3Z" />
      <path d="M9.5 12.5l2 2 3.2-4" />
    </svg>
  );
}

/** A wrench — the Practicalist's hands-on reality. */
export function WrenchIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14.5 6.5a4 4 0 0 0-5.4 4.9L4 16.5V20h3.5l5.1-5.1a4 4 0 0 0 4.9-5.4l-2.6 2.6-2.5-2.5 2.6-2.6Z" />
    </svg>
  );
}

/** A compass rose — the Perspective's alternative bearings. */
export function CompassIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
    </svg>
  );
}

/** A bolt of lightning — the Devil's Advocate's stress-test. */
export function BoltIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z" />
    </svg>
  );
}

/** A judge's pedestal — the final arbiter. */
export function PedestalIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7 8h10" />
      <path d="M9 8v6" />
      <path d="M15 8v6" />
      <path d="M5 8h14" />
      <path d="M7 8c-1.5 1-1.5 3 0 4" />
      <path d="M17 8c1.5 1 1.5 3 0 4" />
      <path d="M9 14h6" />
      <path d="M8 14v3" />
      <path d="M16 14v3" />
      <path d="M5 17h14" />
      <path d="M8 20h8" />
    </svg>
  );
}

/** Hourglass — deliberation in progress. */
export function HourglassIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 3h12" />
      <path d="M6 21h12" />
      <path d="M7 3c0 4 2.5 6 5 6s5-2 5-6" />
      <path d="M7 21c0-4 2.5-6 5-6s5 2 5 6" />
      <path d="M9.5 14.5c1.5 1 3.5 1 5 0" />
    </svg>
  );
}

/** A check mark — completed. */
export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m4.5 12.5 5 5 10-11" />
    </svg>
  );
}

/** An X — failed. */
export function XIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

/** Alert triangle. */
export function AlertIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5 2.8 20h18.4L12 3.5Z" />
      <path d="M12 10v4.5" />
      <path d="M12 17.4v.1" />
    </svg>
  );
}

/** Sparkles — a verdict is ready. */
export function SparkIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3c.6 3.8 2.2 6.4 6 7-3.8.6-5.4 3.2-6 7-.6-3.8-2.2-6.4-6-7 3.8-.6 5.4-3.2 6-7Z" />
      <path d="M19 14c.3 1.9 1.1 3.2 3 3.5-1.9.3-2.7 1.6-3 3.5-.3-1.9-1.1-3.2-3-3.5 1.9-.3 2.7-1.6 3-3.5Z" />
    </svg>
  );
}

/** Arrows in a cycle — retry / re-open. */
export function RotateIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 10a8 8 0 0 1 14-3.5" />
      <path d="M20 5v4h-4" />
      <path d="M20 14a8 8 0 0 1-14 3.5" />
      <path d="M4 19v-4h4" />
    </svg>
  );
}

/** A flame — challenge / counterargument (not an emoji). */
export function FlameIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3c.5 3-1 5-3 6.5C6.5 11 6 13.5 6.5 16a5.5 5.5 0 0 0 11 0c0-2.5-1.5-4-2.5-5-1 1.2-2.5 1.8-3.5 1.5 1-1.5 1.2-3.5.5-5.5-2.5.7-4.5 2.6-5.5 4.5.4-3.2 2.6-6 5.5-8.5Z" />
    </svg>
  );
}

/** A chat bubble — the challenge reply. */
export function BubbleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M21 11.5a8.5 8.5 0 0 1-12.5 7.5L3 21l2-5.5A8.5 8.5 0 1 1 21 11.5Z" />
    </svg>
  );
}
