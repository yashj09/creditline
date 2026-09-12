import type { ComponentPropsWithoutRef } from "react";
import { cx, tone as toneMap, type Tone } from "@/lib/sketch";

export type PillProps = ComponentPropsWithoutRef<"span"> & { tone?: Tone; filled?: boolean };

export function Pill({ tone = "default", filled = false, className, children, ...rest }: PillProps) {
  const t = toneMap[tone];
  // warn/postit always render as a post-it fill so yellow never appears as text
  const isFilled = filled || tone === "warn" || tone === "postit";
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 border-2 wobbly-pill px-2 py-0.5 font-body text-sm leading-none whitespace-nowrap",
        isFilled ? cx(t.fill, "border-fg") : cx(t.border, t.text, "bg-card"),
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
