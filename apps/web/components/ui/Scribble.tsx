import type { SVGProps } from "react";
import { cx } from "@/lib/sketch";

/* Hand-drawn SVG flourishes. All decorative (aria-hidden), stroke = currentColor. */

type P = SVGProps<SVGSVGElement>;
const base = (className?: string) => cx("pointer-events-none", className);
const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Dashed curved arrow with a solid head. Points to the bottom-right by default; `flip` mirrors it. */
export function Arrow({ className, flip = false, ...p }: P & { flip?: boolean }) {
  return (
    <svg viewBox="0 0 120 80" aria-hidden="true" className={cx(base(className), flip && "-scale-x-100")} {...p}>
      <path d="M6 10 C 30 14, 60 30, 100 62" strokeDasharray="8 7" {...stroke} />
      <path d="M84 60 L 102 64 L 96 46" {...stroke} />
    </svg>
  );
}

/** Horizontal wavy connector; stretches to its container width. */
export function Squiggle({ className, ...p }: P) {
  return (
    <svg viewBox="0 0 400 24" preserveAspectRatio="none" aria-hidden="true" className={base(className)} {...p}>
      <path d="M0 12 q 25 -14 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0" strokeDasharray="10 8" {...stroke} />
    </svg>
  );
}

/** Dashed ellipse for circling a word or card. */
export function DashedCircle({ className, ...p }: P) {
  return (
    <svg viewBox="0 0 200 80" preserveAspectRatio="none" aria-hidden="true" className={base(className)} {...p}>
      <path d="M100 6 C 160 4, 196 22, 194 42 C 192 64, 150 76, 96 74 C 42 74, 6 60, 6 40 C 8 18, 46 6, 100 6" strokeDasharray="7 6" {...stroke} />
    </svg>
  );
}

/** Wavy pen underline; stretches to its container width. */
export function Underline({ className, ...p }: P) {
  return (
    <svg viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true" className={base(className)} {...p}>
      <path d="M2 8 q 20 -10 40 0 t 40 0 t 40 0 t 40 0 t 36 0" {...stroke} />
    </svg>
  );
}

/** Four L-shaped corner ticks framing the parent (parent must be `relative`). */
export function CornerFrame({ className }: { className?: string }) {
  const tick = (pos: string, rot: string) => (
    <svg key={pos} viewBox="0 0 24 24" aria-hidden="true" className={cx("absolute h-6 w-6", pos, rot, base(className))}>
      <path d="M3 21 L3 4 L20 3" {...stroke} />
    </svg>
  );
  return (
    <>
      {tick("-top-2 -left-2", "rotate-0")}
      {tick("-top-2 -right-2", "rotate-90")}
      {tick("-bottom-2 -right-2", "rotate-180")}
      {tick("-bottom-2 -left-2", "-rotate-90")}
    </>
  );
}

/** The wiggling red exclamation mark for headlines. */
export function Bang({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx("inline-block font-heading text-accent animate-wiggle", className)}>!</span>;
}
