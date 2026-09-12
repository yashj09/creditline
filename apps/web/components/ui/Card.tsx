import type { ComponentPropsWithoutRef } from "react";
import { cx, tilt, tone as toneMap, type Tone } from "@/lib/sketch";

export type CardProps = ComponentPropsWithoutRef<"div"> & {
  tone?: Tone;
  /** tape = translucent strip top-centre; tack = red thumbtack. Not combinable with `speech`. */
  decoration?: "none" | "tape" | "tack";
  /** Index into the deterministic tilt cycle; the card straightens on hover. Never use on tables/forms. */
  rotate?: number | false;
  /** Speech-bubble tail at the bottom-right (used for the user's chat messages). */
  speech?: boolean;
  as?: "div" | "section" | "article" | "li";
  padding?: "none" | "sm" | "md" | "lg";
};

const PAD = { none: "", sm: "p-3 md:p-4", md: "p-4 md:p-6", lg: "p-6 md:p-8" } as const;

const DECO = {
  none: "",
  tape: "before:content-[''] before:absolute before:-top-3 before:left-1/2 before:h-6 before:w-24 before:-translate-x-1/2 before:-rotate-2 before:bg-fg/10 before:pointer-events-none",
  tack: "before:content-[''] before:absolute before:-top-2 before:left-1/2 before:h-4 before:w-4 before:-translate-x-1/2 before:rounded-full before:border-2 before:border-fg before:bg-accent before:shadow-sketch-sm before:pointer-events-none",
} as const;

/* two stacked border-triangles: pencil outline (before) + card fill (after) */
const SPEECH_OUTER = "before:content-[''] before:absolute before:-bottom-[15px] before:right-7 before:border-[14px] before:border-b-0 before:border-transparent before:border-t-fg";
const SPEECH_INNER = "after:content-[''] after:absolute after:-bottom-[10px] after:right-[31px] after:border-[11px] after:border-b-0 after:border-transparent";

export function Card({ tone = "default", decoration = "none", rotate = false, speech = false, as = "div", padding = "md", className, children, ...rest }: CardProps) {
  const Tag = as as "div"; // renders the real tag; typed as div so shared HTML props flow through
  const t = toneMap[tone];
  const emphasised = tone === "warn" || tone === "bad";
  return (
    <Tag
      className={cx(
        "relative wobbly-md shadow-sketch-soft transition-transform duration-100",
        emphasised ? "border-[3px]" : "border-2",
        t.bg,
        t.border,
        PAD[padding],
        rotate !== false && cx(tilt(rotate), "hover:rotate-0"),
        speech ? cx(SPEECH_OUTER, SPEECH_INNER, t.tail) : DECO[decoration],
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
