import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cx } from "@/lib/sketch";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-2 font-body font-bold border-[3px] border-fg wobbly-sm cursor-pointer " +
  "transition-[translate,box-shadow,background-color,color] duration-100 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 disabled:opacity-50 disabled:pointer-events-none";

const SIZE: Record<ButtonSize, string> = { md: "min-h-12 px-5 text-lg", sm: "min-h-9 px-3 py-1 text-base" };

const LIFT = "hover:shadow-sketch-sm hover:translate-x-0.5 hover:translate-y-0.5 active:shadow-none active:translate-x-1 active:translate-y-1";

const VARIANT: Record<ButtonVariant, string> = {
  primary: cx("bg-card text-fg shadow-sketch hover:bg-accent hover:text-white", LIFT),
  secondary: cx("bg-muted text-fg shadow-sketch hover:bg-ink hover:text-white", LIFT),
  ghost: "border-dashed bg-transparent text-fg shadow-none hover:bg-muted active:translate-x-0.5 active:translate-y-0.5",
};

/** Shared so <Link> CTAs can look like buttons without a polymorphic component. */
export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cx(BASE, SIZE[size], VARIANT[variant], className);
}

export type ButtonProps = ComponentPropsWithoutRef<"button"> & { variant?: ButtonVariant; size?: ButtonSize; icon?: ReactNode };

export function Button({ variant = "primary", size = "md", icon, className, type = "button", children, ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClasses(variant, size, className)} {...rest}>
      {icon}
      {children}
    </button>
  );
}
