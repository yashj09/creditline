import type { ComponentPropsWithoutRef } from "react";
import { cx, tilt } from "@/lib/sketch";

export type StickyProps = ComponentPropsWithoutRef<"span"> & { tone?: "postit" | "muted" | "ok"; rotate?: number | false };

const BG = { postit: "bg-postit text-fg", muted: "bg-muted text-fg", ok: "bg-ink text-white" } as const;

/** Sticky-note tag for section labels and loud callouts ("GUARDIAN REQUIRED"). */
export function Sticky({ tone = "postit", rotate = false, className, children, ...rest }: StickyProps) {
  return (
    <span
      className={cx(
        "inline-block border-2 border-fg px-3 py-1 font-heading text-base uppercase tracking-wide shadow-sketch-sm",
        BG[tone],
        rotate !== false && tilt(rotate),
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
