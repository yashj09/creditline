import Link from "next/link";
import { Bot, CheckCircle2, FileSignature, Fingerprint, Hand, Landmark, Network, ShieldCheck, Smartphone, type LucideIcon } from "lucide-react";
import { LiveRates } from "@/components/landing/LiveRates";
import { RecentReceipts } from "@/components/landing/RecentReceipts";
import { Card, Icon, Scribble, SketchHeading, Sticky, buttonClasses } from "@/components/ui";

const BEATS: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: FileSignature, title: "You set a mandate", body: "Per-tx cap, daily cap, expiry, allow-list. Signed by your wallet, stored on-chain." },
  { icon: Bot, title: "It borrows on its own", body: "Wrap, supply, borrow on Compound v3 — reversible, inside caps, no human needed." },
  { icon: Hand, title: "Bridging needs you", body: "A CCTP burn can't be undone. The agent stops and asks." },
  { icon: Smartphone, title: "Your Ledger shows the text", body: "Plain words, clear-signed. What you read is what the contract enforces." },
  { icon: CheckCircle2, title: "Tap. Settled on Arc.", body: "Fast Transfer lands in ~8s, the payee is paid in USDC, repayment is scheduled." },
];

const HOW: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: ShieldCheck, title: "Caps live on-chain", body: "MandateAccount measures USDC outflow per step and per rolling day. The agent cannot raise its own limits." },
  { icon: Bot, title: "Reversible steps run alone", body: "Supplying collateral and borrowing can be unwound, so the agent executes them without asking." },
  { icon: Fingerprint, title: "Irreversible steps wait for a tap", body: "Bridges and payments require a guardian signature from a Ledger. No blind signing — the device shows the text." },
];

const RAILS: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Landmark, title: "Arc · Circle", body: "Native USDC settlement and gas. CCTP v2 Fast Transfer brings borrowed USDC over in seconds." },
  { icon: Network, title: "The Graph", body: "One Messari standardized query ranks live borrow rates across Aave v3, Compound v3 and Spark." },
  { icon: Fingerprint, title: "Ledger", body: "Clear-signed EIP-191 text; the contract rebuilds it byte-for-byte and refuses anything else." },
];

export default function LandingPage() {
  return (
    <div className="space-y-4">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative py-12 md:py-20">
        <Scribble.CornerFrame className="hidden text-fg/40 md:block" />
        <Sticky rotate={3} className="mb-6">bounded delegation for AI agents</Sticky>
        <SketchHeading as="h1" className="max-w-4xl text-5xl md:text-7xl">
          Claude spends.{" "}
          You set the{" "}
          <span className="whitespace-nowrap">
            <span className="relative inline-block">
              limits
              <Scribble.DashedCircle className="absolute -left-3 -right-3 -top-2 -bottom-2 hidden h-[calc(100%+1rem)] w-[calc(100%+1.5rem)] text-ink md:block" />
            </span>
            <Scribble.Bang />
          </span>
        </SketchHeading>
        <p className="mt-6 max-w-2xl text-xl leading-relaxed text-fg/80 first-letter:float-left first-letter:mr-2 first-letter:font-heading first-letter:text-6xl first-letter:leading-none md:text-2xl">
          Claude executes real on-chain financial actions for you, inside limits you set, with a hardware tap for anything irreversible.
        </p>
        <div className="relative mt-10 flex flex-wrap items-center gap-4">
          <Scribble.Arrow className="absolute -top-20 -left-6 hidden h-24 w-32 animate-bounce-slow text-fg md:block" />
          <Link href="/chat" className={buttonClasses("primary", "md", "text-xl")}>Open the console</Link>
          <Link href="/mandate" className={buttonClasses("secondary", "md")}>Set a mandate</Link>
        </div>
      </section>

      {/* ── Hero loop: 5 beats, CSS-timed ───────────────────────────────── */}
      <section className="py-12 md:py-20" aria-labelledby="loop-heading">
        <h2 id="loop-heading" className="mb-8"><Sticky rotate={0}>One intent, start to finish</Sticky></h2>
        <div className="relative">
          <Scribble.Squiggle className="absolute top-1/2 left-0 hidden h-6 w-full -translate-y-1/2 text-fg/40 md:block" />
          <ol className="relative grid grid-cols-1 gap-6 md:grid-cols-5">
            {BEATS.map((b, i) => (
              <Card
                key={b.title}
                as="li"
                decoration="tape"
                rotate={i}
                padding="sm"
                className="z-10 animate-beat hover:[animation-play-state:paused]"
                style={{ animationDelay: `${i * 2}s` }}
              >
                <div className="mb-3 flex items-center gap-3">
                  <Icon icon={b.icon} size="sm" />
                  <span className="font-heading text-base text-fg/60">{i + 1}</span>
                </div>
                <h3 className="font-heading text-xl">{b.title}</h3>
                <p className="mt-1 text-base text-fg/80">{b.body}</p>
              </Card>
            ))}
          </ol>
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────── */}
      <section className="py-12 md:py-20" aria-labelledby="how-heading">
        <SketchHeading as="h2" id="how-heading" underline="wavy" className="mb-10">How it works</SketchHeading>
        <div className="relative">
          <Scribble.Squiggle className="absolute top-8 left-1/6 hidden h-5 w-2/3 text-ink/40 md:block" />
          <div className="grid gap-8 md:grid-cols-3">
            {HOW.map((h, i) => (
              <Card key={h.title} decoration="tack" rotate={i + 1} className="z-10">
                <div className="mb-4 flex items-center gap-3">
                  <Icon icon={h.icon} />
                  <span className="inline-flex h-8 w-8 items-center justify-center border-2 border-fg bg-postit wobbly-pill font-heading">{i + 1}</span>
                </div>
                <h3 className="font-heading text-2xl">{h.title}</h3>
                <p className="mt-2 text-lg text-fg/80">{h.body}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ── Live rates ──────────────────────────────────────────────────── */}
      <section className="py-12 md:py-20" aria-labelledby="rates-heading">
        <div className="mb-6 flex flex-wrap items-baseline gap-4">
          <h2 id="rates-heading"><Sticky rotate={2}>Live USDC borrow rates</Sticky></h2>
          <p className="text-lg text-fg/70">The agent shops venues with one standardized query. This is the same table it reasons over.</p>
        </div>
        <LiveRates />
      </section>

      {/* ── Receipts ────────────────────────────────────────────────────── */}
      <section className="py-12 md:py-20" aria-labelledby="receipts-heading">
        <div className="mb-6 flex flex-wrap items-baseline gap-4">
          <h2 id="receipts-heading"><Sticky rotate={1}>Receipts</Sticky></h2>
          <p className="text-lg text-fg/70">Every executed step leaves a hash and a reason.</p>
        </div>
        <RecentReceipts />
      </section>

      {/* ── Rails ───────────────────────────────────────────────────────── */}
      <section className="py-12 md:py-20" aria-labelledby="rails-heading">
        <SketchHeading as="h2" id="rails-heading" underline="highlight" className="mb-10">Built on</SketchHeading>
        <div className="grid gap-8 md:grid-cols-3">
          {RAILS.map((r, i) => (
            <Card key={r.title} tone="postit" decoration="tape" rotate={i + 2}>
              <div className="mb-4"><Icon icon={r.icon} /></div>
              <h3 className="font-heading text-2xl">{r.title}</h3>
              <p className="mt-2 text-lg text-fg/80">{r.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t-[3px] border-dashed border-fg/50 py-10 text-base text-fg/60">
        <span><span className="font-heading text-xl text-fg">Mandate</span> · Base Sepolia · Arc testnet</span>
        <nav aria-label="Footer" className="flex gap-5">
          <Link href="/chat" className="hover:text-ink hover:underline hover:decoration-wavy">Chat</Link>
          <Link href="/mandate" className="hover:text-ink hover:underline hover:decoration-wavy">Mandate</Link>
          <Link href="/activity" className="hover:text-ink hover:underline hover:decoration-wavy">Activity</Link>
        </nav>
      </footer>
    </div>
  );
}
