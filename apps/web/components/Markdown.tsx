"use client";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Mono } from "@/components/ui";
import { cx } from "@/lib/sketch";

/* Element overrides so agent prose matches the sketch design system. */
const components: Components = {
  p: ({ children }) => <p className="my-2 text-lg leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-bold text-fg">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => <h3 className="mt-4 mb-2 font-heading text-2xl">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-4 mb-2 font-heading text-xl">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-3 mb-1 font-heading text-lg">{children}</h4>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-6 text-lg marker:text-accent">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-6 text-lg marker:font-heading marker:text-fg/70">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-ink underline decoration-2 underline-offset-4 hover:decoration-wavy">
      {children}
    </a>
  ),
  code: ({ className, children }) => {
    const isBlock = /language-/.test(className ?? "");
    return isBlock ? (
      <Mono as="code" className="block text-sm">{children}</Mono>
    ) : (
      <Mono as="code" className="border border-dashed border-fg/50 bg-muted/60 px-1 py-0.5 wobbly-pill text-[0.9em]">{children}</Mono>
    );
  },
  pre: ({ children }) => <Mono as="pre" block className="my-3 text-sm">{children}</Mono>,
  blockquote: ({ children }) => <blockquote className="my-3 border-l-4 border-dashed border-ink pl-4 text-fg/80">{children}</blockquote>,
  hr: () => <hr className="my-4 border-t-2 border-dashed border-fg/40" />,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full text-base">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="text-left font-heading text-sm uppercase tracking-wide text-fg/60">{children}</thead>,
  tr: ({ children }) => <tr className="border-b border-dotted border-fg/30">{children}</tr>,
  th: ({ children }) => <th className="py-1 pr-3 border-b-2 border-dashed border-fg/40">{children}</th>,
  td: ({ children }) => <td className="py-1.5 pr-3 tabular-nums">{children}</td>,
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cx("min-w-0 break-words", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
