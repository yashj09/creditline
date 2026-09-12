import { createPublicClient, http, type PublicClient } from "viem";
import { chains } from "../chains.ts";
import { readCometPosition } from "../exec/compound.ts";
import { BASE_SEPOLIA } from "../addresses.ts";
import {
  COMPOUND_V3_BASE_TWIN,
  MESSARI_LENDING_SUBGRAPHS,
  checkSubgraphHealth,
  fetchAaveOfficialUsdcRates,
  fetchMessariUsdcRates,
} from "./graph.ts";
import { fetchMorphoUsdcRates } from "./morpho.ts";
import type { MarketsSnapshot, VenueRate } from "./types.ts";

export interface FetchMarketsOptions {
  graphApiKey: string;
  includeMorpho?: boolean;
  /** viem client for Base Sepolia, used to read the executable Compound twin's live rate. */
  baseSepoliaClient?: PublicClient;
}

/**
 * Builds the venue table the agent reasons over: one standardized query across every Messari lending subgraph,
 * Aave-official fallback when a deployment is unhealthy, Morpho via its API, plus the live rate of the venue we can
 * actually execute on (Compound v3 Base Sepolia).
 */
export async function fetchMarkets(opts: FetchMarketsOptions): Promise<MarketsSnapshot> {
  const warnings: string[] = [];
  const rates: VenueRate[] = [];

  const results = await Promise.allSettled(
    MESSARI_LENDING_SUBGRAPHS.map(async (entry) => {
      const health = await checkSubgraphHealth(entry.subgraphId, opts.graphApiKey);
      if (!health.ok && entry.protocol === "aave-v3") {
        warnings.push(`${entry.venueId}: Messari deployment unhealthy (${health.error ?? `age ${health.ageHours?.toFixed(0)}h, errors=${health.hasIndexingErrors}`}) → Aave official subgraph`);
        return { rates: await fetchAaveOfficialUsdcRates(entry, opts.graphApiKey), warnings: [] };
      }
      if (!health.ok) warnings.push(`${entry.venueId}: unhealthy (${health.error ?? `age ${health.ageHours?.toFixed(0)}h`}) — shown with caveat`);
      return fetchMessariUsdcRates(entry, opts.graphApiKey);
    }),
  );
  for (const r of results) {
    if (r.status === "fulfilled") {
      rates.push(...r.value.rates);
      warnings.push(...r.value.warnings);
    } else warnings.push(String(r.reason?.message ?? r.reason));
  }

  if (opts.includeMorpho !== false) {
    try {
      rates.push(...(await fetchMorphoUsdcRates()));
    } catch (e) {
      warnings.push(`morpho: ${(e as Error).message}`);
    }
  }

  // Executable twin: live Compound v3 Base Sepolia numbers (real Circle USDC, CCTP → Arc).
  try {
    const client = opts.baseSepoliaClient ?? createPublicClient({ chain: chains.baseSepolia, transport: http() });
    rates.push(await compoundTwinRate(client));
  } catch (e) {
    warnings.push(`compound base sepolia: ${(e as Error).message}`);
  }

  return { fetchedAt: new Date().toISOString(), rates, warnings };
}

/** Chains for which core/exec has a working executor. Keep in sync with plan/build.ts. */
export const IMPLEMENTED_EXECUTOR_CHAINS = new Set<number>([84532]);

/** Live rate of the executable Compound v3 Base Sepolia twin, read from the Comet contract itself. */
export async function compoundTwinRate(client: PublicClient): Promise<VenueRate> {
  const pos = await readCometPosition(client, "0x0000000000000000000000000000000000000001");
  return {
    venueId: "compound-v3-base-sepolia", protocol: "compound-v3", network: "base-sepolia", chainId: BASE_SEPOLIA.chainId,
    marketName: "cUSDCv3 (testnet twin of Compound v3 Base)", asset: "USDC",
    borrowAprPct: pos.borrowAprPct, supplyAprPct: pos.supplyAprPct, utilizationPct: pos.utilizationPct,
    availableUsd: Number(pos.availableUsdc) / 1e6, totalBorrowUsd: 0, totalDepositUsd: Number(pos.availableUsdc) / 1e6,
    source: "onchain", observedAt: Math.floor(Date.now() / 1000), executable: COMPOUND_V3_BASE_TWIN,
  };
}

export interface Ranked {
  cheapestMainnet: VenueRate | undefined;
  /** Cheapest venue that Mandate can execute on today. */
  recommended: VenueRate | undefined;
  table: VenueRate[];
  explanation: string;
}

/** Ranks venues for a USDC borrow of `amountUsd`. Mainnet rates inform the decision; execution needs a testnet twin. */
export function rankVenues(snapshot: MarketsSnapshot, amountUsd: number): Ranked {
  const eligible = snapshot.rates.filter((r) => r.availableUsd >= amountUsd && r.borrowAprPct > 0);
  const table = [...eligible].sort((a, b) => a.borrowAprPct - b.borrowAprPct);
  const cheapestMainnet = table.find((r) => !r.network.includes("sepolia"));
  // Only venues whose twin has an implemented executor may be recommended; the plan builder relies on this invariant.
  const withTwin = table.filter((r) => r.executable && IMPLEMENTED_EXECUTOR_CHAINS.has(r.executable.chainId));
  const recommended = withTwin[0];
  const parts: string[] = [];
  if (cheapestMainnet) parts.push(`Cheapest observed borrow rate: ${cheapestMainnet.venueId} at ${cheapestMainnet.borrowAprPct.toFixed(2)}% APR (${cheapestMainnet.utilizationPct.toFixed(0)}% utilized, $${Math.round(cheapestMainnet.availableUsd).toLocaleString()} available).`);
  if (recommended) {
    parts.push(
      recommended === cheapestMainnet
        ? `It is executable today via ${recommended.executable!.network}.`
        : `Recommended executable venue: ${recommended.venueId} at ${recommended.borrowAprPct.toFixed(2)}% APR → executes on ${recommended.executable!.network} (${recommended.executable!.note}).`,
    );
  } else parts.push("No executable venue has enough liquidity for this amount.");
  if (snapshot.warnings.length) parts.push(`Data caveats: ${snapshot.warnings.join(" | ")}`);
  return { cheapestMainnet, recommended, table, explanation: parts.join(" ") };
}
