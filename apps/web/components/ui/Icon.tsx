import type { LucideIcon } from "lucide-react";
import { cx } from "@/lib/sketch";

export type IconProps = {
  icon: LucideIcon;
  /** Accessible name; omit for purely decorative icons. */
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const BOX = { sm: "h-8 w-8", md: "h-10 w-10", lg: "h-14 w-14" } as const;
const GLYPH = { sm: 16, md: 20, lg: 28 } as const;

/** Lucide icon inside a rough pencil circle. */
export function Icon({ icon: Glyph, label, size = "md", className }: IconProps) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cx("inline-flex shrink-0 items-center justify-center border-[3px] border-fg bg-card wobbly-pill text-fg", BOX[size], className)}
    >
      <Glyph size={GLYPH[size]} strokeWidth={2.75} aria-hidden="true" />
    </span>
  );
}
