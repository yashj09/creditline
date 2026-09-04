// Quick venue-table probe. With GRAPH_API_KEY set it runs the full standardized query across all Messari subgraphs.
import { fetchMorphoUsdcRates } from "../src/markets/morpho.ts";
import { fetchMarkets, rankVenues } from "../src/markets/venues.ts";

const key = process.env.GRAPH_API_KEY;
if (key) {
  const snap = await fetchMarkets({ graphApiKey: key });
  const ranked = rankVenues(snap, Number(process.env.AMOUNT ?? 100));
  console.table(ranked.table.map((r) => ({ venue: r.venueId, market: r.marketName, borrowAPR: r.borrowAprPct.toFixed(2) + "%", util: r.utilizationPct.toFixed(0) + "%", availUsd: Math.round(r.availableUsd), src: r.source, exec: r.executable?.network ?? "" })));
  console.log("\n" + ranked.explanation);
  if (snap.warnings.length) console.log("\nwarnings:", snap.warnings);
} else {
  console.log("GRAPH_API_KEY not set — Morpho-only probe");
  const r = await fetchMorphoUsdcRates([1, 8453]);
  console.log(r.length, "Morpho USDC markets with ETH-like collateral");
  for (const x of r.slice(0, 4)) console.log(" ", x.venueId, x.marketName, x.borrowAprPct.toFixed(2) + "%", "avail $" + Math.round(x.availableUsd).toLocaleString());
}
