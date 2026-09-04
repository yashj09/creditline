export type Protocol = "aave-v3" | "compound-v3" | "spark" | "morpho-blue";

export interface VenueRate {
  /** stable id, e.g. "compound-v3-base" */
  venueId: string;
  protocol: Protocol;
  network: string; // mainnet network the rate was observed on
  chainId: number;
  marketName: string;
  asset: string; // USDC variant symbol
  borrowAprPct: number;
  supplyAprPct: number;
  utilizationPct: number;
  availableUsd: number;
  totalBorrowUsd: number;
  totalDepositUsd: number;
  source: "messari-standardized" | "aave-official" | "morpho-api";
  observedBlock?: number;
  observedAt?: number; // unix seconds
  /** Where Mandate can actually execute this venue today (testnet twin), if anywhere. */
  executable?: { chainId: number; network: string; note: string };
}

export interface MarketsSnapshot {
  fetchedAt: string;
  rates: VenueRate[];
  warnings: string[];
}
