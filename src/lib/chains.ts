export type ChainKind = "evm" | "solana";

export type ChainDef = {
  id: string;
  label: string;
  lifiKey: string;
  lifiChainId: number;
  dexChainId: string;
  kind: ChainKind;
  gasUsd: number;
};

export const CHAINS: ChainDef[] = [
  {
    id: "solana",
    label: "Solana",
    lifiKey: "SOL",
    lifiChainId: 1151111081099710,
    dexChainId: "solana",
    kind: "solana",
    gasUsd: 0.02,
  },
  {
    id: "bsc",
    label: "BNB Chain",
    lifiKey: "BSC",
    lifiChainId: 56,
    dexChainId: "bsc",
    kind: "evm",
    gasUsd: 0.1,
  },
  {
    id: "base",
    label: "Base",
    lifiKey: "BAS",
    lifiChainId: 8453,
    dexChainId: "base",
    kind: "evm",
    gasUsd: 0.03,
  },
  {
    id: "arbitrum",
    label: "Arbitrum",
    lifiKey: "ARB",
    lifiChainId: 42161,
    dexChainId: "arbitrum",
    kind: "evm",
    gasUsd: 0.05,
  },
  {
    id: "polygon",
    label: "Polygon",
    lifiKey: "POL",
    lifiChainId: 137,
    dexChainId: "polygon",
    kind: "evm",
    gasUsd: 0.02,
  },
  {
    id: "optimism",
    label: "Optimism",
    lifiKey: "OPT",
    lifiChainId: 10,
    dexChainId: "optimism",
    kind: "evm",
    gasUsd: 0.04,
  },
];

export const DEFAULT_ENABLED_CHAINS = ["solana", "bsc", "base", "arbitrum"];

export const TRACKED_COIN_KEYS = [
  "USDC",
  "USDT",
  "WETH",
  "WBTC",
  "DAI",
  "LINK",
  "UNI",
  "AAVE",
] as const;

export function chainById(id: string): ChainDef | undefined {
  return CHAINS.find((chain) => chain.id === id);
}

export function chainLabel(id: string): string {
  return chainById(id)?.label ?? id;
}
