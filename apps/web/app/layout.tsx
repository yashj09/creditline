import type { Metadata } from "next";
import Link from "next/link";
import { Kalam, Patrick_Hand } from "next/font/google";
import { Nav } from "@/components/Nav";
import { Scribble } from "@/components/ui";
import "./globals.css";

const kalam = Kalam({ weight: "700", subsets: ["latin"], variable: "--font-kalam", display: "swap" });
const patrick = Patrick_Hand({ weight: "400", subsets: ["latin"], variable: "--font-patrick", display: "swap" });

export const metadata: Metadata = {
  title: "Mandate — bounded delegation for AI agents",
  description: "Claude executes real on-chain financial actions inside limits you set, with a hardware tap for anything irreversible.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${kalam.variable} ${patrick.variable}`}>
      <body className="min-h-screen">
        <header className="sticky top-0 z-20 border-b-[3px] border-dashed border-fg bg-paper/85 backdrop-blur-sm">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 md:px-6">
            <Link
              href="/"
              className="group inline-flex items-baseline gap-2 wobbly-sm px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
            >
              <span className="relative font-heading text-2xl leading-none md:text-3xl">
                Mandate
                <Scribble.Underline className="absolute -bottom-2 left-0 h-2.5 w-full text-accent transition-transform duration-100 group-hover:scale-x-105" />
              </span>
              <span className="hidden font-body text-base text-fg/60 sm:inline">· bounded delegation for AI agents</span>
            </Link>
            <Nav />
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8 md:px-6">{children}</main>
      </body>
    </html>
  );
}
