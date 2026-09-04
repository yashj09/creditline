import type { Protocol, VenueRate } from "./types.ts";

/**
 * Messari Standardized Lending Subgraphs (schema 3.1.0) on The Graph decentralized network.
 * One query shape works across every protocol below — that is the point of the standard.
 * IDs verified from messari/subgraphs deployment.json + Graph Explorer on 2026-09-05.
 */
export const MESSARI_LENDING_SUBGRAPHS: Array<{
  venueId: string;
  protocol: Protocol;
  network: string;
  chainId: number;
  subgraphId: string;
  executable?: VenueRate["executable"];
}> = [
  { venueId: "aave-v3-ethereum", protocol: "aave-v3", network: "ethereum", chainId: 1, subgraphId: "JCNWRypm7FYwV8fx5HhzZPSFaMxgkPuw4TnR3Gpi81zk" },
  { venueId: "aave-v3-base", protocol: "aave-v3", network: "base", chainId: 8453, subgraphId: "D7mapexM5ZsQckLJai2FawTKXJ7CqYGKM8PErnS3cJi9" },
  {
    venueId: "aave-v3-arbitrum", protocol: "aave-v3", network: "arbitrum", chainId: 42161,
    subgraphId: "4xyasjQeREe7PxnF6wVdobZvCw5mhoHZq3T7guRpuNPf",
    executable: { chainId: 421614, network: "arbitrum-sepolia", note: "Aave v3 Arbitrum Sepolia lends real Circle USDC (CCTP domain 3)" },
  },
  { venueId: "compound-v3-ethereum", protocol: "compound-v3", network: "ethereum", chainId: 1, subgraphId: "AwoxEZbiWLvv6e3QdvdMZw4WDURdGbvPfHmZRc8Dpfz9" },
  { venueId: "compound-v3-arbitrum", protocol: "compound-v3", network: "arbitrum", chainId: 42161, subgraphId: "5MjRndNWGhqvNX7chUYLQDnvEgc8DaH8eisEkcJt71SR" },
  { venueId: "spark-ethereum", protocol: "spark", network: "ethereum", chainId: 1, subgraphId: "GbKdmBe4ycCYCQLQSjqGg6UHYoYfbyJyq5WrG35pv1si" },
];

/** Compound v3 on Base has no Messari deployment; its rate is read from the Comet contract (see compound.ts) and
 *  merged in `venues.ts` — it is our primary executable venue (Base Sepolia twin). */
export const COMPOUND_V3_BASE_TWIN: VenueRate["executable"] = {
  chainId: 84532,
  network: "base-sepolia",
  note: "Compound v3 Base Sepolia lends real Circle USDC; CCTP Fast Transfer to Arc in ~8s",
};

export const GRAPH_GATEWAY = "https://gateway.thegraph.com/api/subgraphs/id";

/** The one standardized query. `inputToken_` nested filter may be rejected by older graph-node — we filter client-side. */
export const USDC_MARKETS_QUERY = /* GraphQL */ `
  query UsdcMarkets {
    markets(where: { isActive: true, canBorrowFrom: true }, orderBy: totalDepositBalanceUSD, orderDirection: desc, first: 40) {
      id
      name
      inputToken { symbol decimals }
      inputTokenBalance
      inputTokenPriceUSD
      totalDepositBalanceUSD
      totalBorrowBalanceUSD
      rates { rate side type }
    }
    _meta { block { number timestamp } hasIndexingErrors }
  }
`;

const USDC_SYMBOLS = new Set(["USDC", "USDC.e", "USDbC", "USDC.E"]);

interface MessariMarket {
  id: string;
  name: string;
  inputToken: { symbol: string; decimals: number };
  inputTokenBalance: string;
  inputTokenPriceUSD: string;
  totalDepositBalanceUSD: string;
  totalBorrowBalanceUSD: string;
  rates: Array<{ rate: string; side: "LENDER" | "BORROWER"; type: "STABLE" | "VARIABLE" | "FIXED" }>;
}
interface MessariResponse {
  data?: { markets: MessariMarket[]; _meta: { block: { number: number; timestamp: number }; hasIndexingErrors: boolean } };
  errors?: Array<{ message: string }>;
}

export async function querySubgraph<T>(subgraphId: string, query: string, apiKey: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${GRAPH_GATEWAY}/${subgraphId}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`graph gateway ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export interface SubgraphHealth {
  subgraphId: string;
  ok: boolean;
  block?: number;
  ageHours?: number;
  hasIndexingErrors?: boolean;
  error?: string;
}

/** `_meta` probe: stale (> maxAgeHours) or erroring deployments are flagged so we can fall back. */
export async function checkSubgraphHealth(subgraphId: string, apiKey: string, maxAgeHours = 48): Promise<SubgraphHealth> {
  try {
    const r = await querySubgraph<{ data?: { _meta: { block: { number: number; timestamp: number }; hasIndexingErrors: boolean } }; errors?: Array<{ message: string }> }>(
      subgraphId,
      `{ _meta { block { number timestamp } hasIndexingErrors } }`,
      apiKey,
    );
    if (r.errors?.length) return { subgraphId, ok: false, error: r.errors.map((e) => e.message).join("; ") };
    const meta = r.data!._meta;
    const ageHours = (Date.now() / 1000 - meta.block.timestamp) / 3600;
    return { subgraphId, ok: !meta.hasIndexingErrors && ageHours <= maxAgeHours, block: meta.block.number, ageHours, hasIndexingErrors: meta.hasIndexingErrors };
  } catch (e) {
    return { subgraphId, ok: false, error: String((e as Error).message) };
  }
}

/** Runs the standardized query on one Messari subgraph and normalizes its USDC markets. */
export async function fetchMessariUsdcRates(
  entry: (typeof MESSARI_LENDING_SUBGRAPHS)[number],
  apiKey: string,
): Promise<{ rates: VenueRate[]; warnings: string[] }> {
  const warnings: string[] = [];
  const r = await querySubgraph<MessariResponse>(entry.subgraphId, USDC_MARKETS_QUERY, apiKey);
  if (r.errors?.length || !r.data) {
    return { rates: [], warnings: [`${entry.venueId}: ${r.errors?.map((e) => e.message).join("; ") ?? "no data"}`] };
  }
  const { markets, _meta } = r.data;
  if (_meta.hasIndexingErrors) warnings.push(`${entry.venueId}: subgraph reports indexing errors`);
  const ageH = (Date.now() / 1000 - _meta.block.timestamp) / 3600;
  if (ageH > 48) warnings.push(`${entry.venueId}: data is ${ageH.toFixed(0)}h old`);

  const rates: VenueRate[] = [];
  for (const m of markets) {
    if (!USDC_SYMBOLS.has(m.inputToken.symbol)) continue;
    const borrow = m.rates.find((x) => x.side === "BORROWER" && x.type === "VARIABLE") ?? m.rates.find((x) => x.side === "BORROWER");
    const supply = m.rates.find((x) => x.side === "LENDER");
    if (!borrow) continue;
    const dep = Number(m.totalDepositBalanceUSD);
    const bor = Number(m.totalBorrowBalanceUSD);
    rates.push({
      venueId: entry.venueId,
      protocol: entry.protocol,
      network: entry.network,
      chainId: entry.chainId,
      marketName: m.name,
      asset: m.inputToken.symbol,
      borrowAprPct: Number(borrow.rate),
      supplyAprPct: supply ? Number(supply.rate) : 0,
      utilizationPct: dep > 0 ? (bor / dep) * 100 : 0,
      availableUsd: (Number(m.inputTokenBalance) / 10 ** m.inputToken.decimals) * Number(m.inputTokenPriceUSD),
      totalBorrowUsd: bor,
      totalDepositUsd: dep,
      source: "messari-standardized",
      observedBlock: _meta.block.number,
      observedAt: _meta.block.timestamp,
      executable: entry.executable,
    });
  }
  return { rates, warnings };
}

/** Fallback for Aave if a Messari deployment is unhealthy: Aave's official subgraphs (rates in RAY = 1e27 APR). */
export const AAVE_OFFICIAL_SUBGRAPHS: Record<string, string> = {
  "aave-v3-ethereum": "Cd2gEDVeqnjBn1hSeqFMitw8Q1iiyV9FYUZkLNRcL87g",
  "aave-v3-base": "GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF",
  "aave-v3-arbitrum": "DLuE98kEb5pQNXAcKFQGQgfSQ57Xdou4jnVbAEqMfy3B",
};

export async function fetchAaveOfficialUsdcRates(entry: (typeof MESSARI_LENDING_SUBGRAPHS)[number], apiKey: string): Promise<VenueRate[]> {
  const id = AAVE_OFFICIAL_SUBGRAPHS[entry.venueId];
  if (!id) return [];
  const q = `{ reserves(where:{ symbol_in:["USDC","USDC.e","USDbC"], borrowingEnabled:true, isActive:true }) { name symbol decimals liquidityRate variableBorrowRate availableLiquidity totalCurrentVariableDebt totalLiquidity price { priceInEth } } _meta { block { number timestamp } } }`;
  const r = await querySubgraph<{ data?: { reserves: any[]; _meta: any } }>(id, q, apiKey);
  return (r.data?.reserves ?? []).map((res) => ({
    venueId: entry.venueId,
    protocol: entry.protocol,
    network: entry.network,
    chainId: entry.chainId,
    marketName: res.name,
    asset: res.symbol,
    borrowAprPct: (Number(res.variableBorrowRate) / 1e27) * 100,
    supplyAprPct: (Number(res.liquidityRate) / 1e27) * 100,
    utilizationPct: Number(res.totalLiquidity) > 0 ? (Number(res.totalCurrentVariableDebt) / Number(res.totalLiquidity)) * 100 : 0,
    availableUsd: Number(res.availableLiquidity) / 10 ** Number(res.decimals),
    totalBorrowUsd: Number(res.totalCurrentVariableDebt) / 10 ** Number(res.decimals),
    totalDepositUsd: Number(res.totalLiquidity) / 10 ** Number(res.decimals),
    source: "aave-official" as const,
    observedBlock: r.data?._meta?.block?.number,
    observedAt: r.data?._meta?.block?.timestamp,
    executable: entry.executable,
  }));
}
