import type { ComponentPropsWithoutRef } from "react";
import { cx } from "@/lib/sketch";

type Level = "h1" | "h2" | "h3";
export type SketchHeadingProps = ComponentPropsWithoutRef<"h1"> & { as?: Level; underline?: "wavy" | "highlight" | "none" };

const SIZE: Record<Level, string> = { h1: "text-4xl md:text-6xl", h2: "text-3xl md:text-5xl", h3: "text-2xl md:text-3xl" };

export function SketchHeading({ as: Tag = "h2", underline = "none", className, children, ...rest }: SketchHeadingProps) {
  const inner =
    underline === "highlight" ? <span className="bg-postit px-2 -mx-2 [box-decoration-break:clone]">{children}</span> : children;
  return (
    <Tag
      className={cx(
        "font-heading font-bold leading-tight text-fg",
        SIZE[Tag],
        underline === "wavy" && "underline decoration-wavy decoration-accent decoration-[3px] underline-offset-8",
        className,
      )}
      {...rest}
    >
      {inner}
    </Tag>
  );
}
