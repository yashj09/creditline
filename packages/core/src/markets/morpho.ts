import type { VenueRate } from "./types.ts";

/** Morpho has no Graph-network subgraph; its official API is free and keyless. Included for completeness of the venue table. */
export const MORPHO_API = "https://api.morpho.org/graphql";

const NETWORK: Record<number, string> = { 1: "ethereum", 8453: "base", 42161: "arbitrum" };

export async function fetchMorphoUsdcRates(chainIds: number[] = [1, 8453]): Promise<VenueRate[]> {
  const query = `query($chains:[Int!]) { markets(first: 60, where: { chainId_in: $chains }, orderBy: BorrowAssetsUsd, orderDirection: Desc) { items { marketId lltv loanAsset { symbol } collateralAsset { symbol } chain { id } state { borrowApy supplyApy utilization borrowAssetsUsd supplyAssetsUsd liquidityAssetsUsd } } } }`;
  const res = await fetch(MORPHO_API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { chains: chainIds } }),
  });
  if (!res.ok) throw new Error(`morpho api ${res.status}`);
  const body = (await res.json()) as { data?: { markets: { items: any[] } }; errors?: Array<{ message: string }> };
  if (body.errors?.length) throw new Error(`morpho api: ${body.errors.map((e) => e.message).join("; ")}`);
  const items = body.data?.markets.items ?? [];
  return items
    .filter((m) => m.loanAsset?.symbol === "USDC" && m.collateralAsset?.symbol && /ETH/i.test(m.collateralAsset.symbol))
    .map((m) => ({
      venueId: `morpho-blue-${NETWORK[m.chain.id] ?? m.chain.id}`,
      protocol: "morpho-blue" as const,
      network: NETWORK[m.chain.id] ?? String(m.chain.id),
      chainId: m.chain.id,
      marketName: `${m.collateralAsset.symbol}/USDC (LLTV ${(Number(m.lltv) / 1e16).toFixed(0)}%)`,
      asset: "USDC",
      borrowAprPct: Number(m.state?.borrowApy ?? 0) * 100,
      supplyAprPct: Number(m.state?.supplyApy ?? 0) * 100,
      utilizationPct: Number(m.state?.utilization ?? 0) * 100,
      availableUsd: Number(m.state?.liquidityAssetsUsd ?? 0),
      totalBorrowUsd: Number(m.state?.borrowAssetsUsd ?? 0),
      totalDepositUsd: Number(m.state?.supplyAssetsUsd ?? 0),
      source: "morpho-api" as const,
      observedAt: Math.floor(Date.now() / 1000),
    }));
}
