import type { ComponentPropsWithoutRef } from "react";
import { cx } from "@/lib/sketch";

export type MonoProps = ComponentPropsWithoutRef<"span"> & {
  as?: "span" | "pre" | "code";
  tone?: "default" | "muted";
  /** Ticket/receipt block: dashed wobbly frame, preserved whitespace. */
  block?: boolean;
};

/**
 * System monospace on purpose: hashes and the Ledger approval text must be
 * unambiguous (0/O, 1/l/I). The hand-drawn feel comes from the frame, not the glyphs.
 */
export function Mono({ as: Tag = "span", tone = "default", block = false, className, children, ...rest }: MonoProps) {
  return (
    <Tag
      className={cx(
        "font-mono tracking-tight",
        tone === "muted" ? "text-fg/60" : "text-fg",
        block ? "block whitespace-pre-wrap break-words border-2 border-dashed border-fg bg-card p-4 wobbly-sm text-[15px] leading-relaxed" : "text-[0.95em]",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
