import type { ComponentPropsWithoutRef } from "react";
import { cx } from "@/lib/sketch";

export type InputProps = ComponentPropsWithoutRef<"input"> & { invalid?: boolean };

export function Input({ invalid = false, className, ...rest }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cx(
        "w-full min-h-12 border-2 wobbly-sm bg-card px-4 py-2 font-body text-lg text-fg tabular-nums",
        "placeholder:text-fg/40 focus:outline-none focus:border-ink focus:ring-2 focus:ring-ink/20",
        invalid ? "border-accent" : "border-fg",
        className,
      )}
      {...rest}
    />
  );
}
