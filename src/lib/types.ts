export type Settings = {
  enabledChains: string[];
  sizesUsd: number[];
  minNetUsd: number;
  maxImpactBps: number;
  minLiquidityUsd: number;
  safetyUsd: number;
  pollMs: number;
  slippageBps: number;
};

export type TokenPlacement = {
  asset: string;
  symbol: string;
  chainId: string;
  address: string;
  decimals: number;
};

export type MarketRow = {
  asset: string;
  symbol: string;
  chainId: string;
  price: number | null;
  liquidity: number | null;
  dex: string | null;
  pairLabel: string | null;
  status: "ok" | "missing" | "error";
  error: string | null;
  updatedAt: number;
};

export type SpreadStatus = "rejected" | "indicative" | "confirmed";

export type SpreadRow = {
  id: string;
  asset: string;
  symbol: string;
  buyChain: string;
  sellChain: string;
  sizeUsd: number;
  buyPrice: number;
  sellPrice: number;
  spreadBps: number;
  impactBps: number;
  gasUsd: number;
  grossUsd: number;
  netUsd: number;
  buyLiquidity: number;
  sellLiquidity: number;
  status: SpreadStatus;
  reason: string;
  detail: string | null;
  updatedAt: number;
};

export type ArchiveRow = {
  id: number;
  createdAt: number;
  asset: string;
  symbol: string;
  buyChain: string;
  sellChain: string;
  sizeUsd: number;
  netUsd: number;
  status: SpreadStatus;
  reason: string;
  detail: string | null;
};

export type MonitorStatus = {
  running: boolean;
  cycle: number;
  lastPollAt: number | null;
  lastDurationMs: number | null;
  lastError: string | null;
  tokenSource: string | null;
  tokenCount: number;
  marketCount: number;
  opportunityCount: number;
};

export type Snapshot = {
  status: MonitorStatus;
  settings: Settings;
  markets: MarketRow[];
  spreads: SpreadRow[];
  archive: ArchiveRow[];
};
