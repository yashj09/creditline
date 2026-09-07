import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mandate",
  description: "Claude executes real on-chain financial actions inside limits you set, with a hardware tap for anything irreversible.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b" style={{ borderColor: "var(--border)" }}>
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Mandate <span className="muted text-sm font-normal">· bounded delegation for AI agents</span>
            </Link>
            <nav className="flex gap-5 text-sm">
              <Link href="/">Chat</Link>
              <Link href="/mandate">Mandate</Link>
              <Link href="/activity">Activity</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
