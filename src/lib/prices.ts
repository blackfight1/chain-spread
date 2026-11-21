import { chainById } from "./chains";
import { fetchJson, shortError } from "./http";
import type { MarketRow, TokenPlacement } from "./types";

type DexPair = {
  chainId?: string;
  dexId?: string;
  priceUsd?: string;
  liquidity?: { usd?: number };
  baseToken?: { address?: string; symbol?: string };
  quoteToken?: { symbol?: string };
};

export async function fetchMarkets(tokens: TokenPlacement[], chainIds: string[]): Promise<MarketRow[]> {
  const now = Date.now();
  const rows: MarketRow[] = [];
  const selected = tokens.filter((token) => chainIds.includes(token.chainId));
  const byChain = new Map<string, TokenPlacement[]>();
  for (const token of selected) {
    const list = byChain.get(token.chainId) ?? [];
    list.push(token);
    byChain.set(token.chainId, list);
  }

  await Promise.all(
    [...byChain.entries()].map(async ([chainId, chainTokens]) => {
      const chain = chainById(chainId);
      if (!chain) return;
      try {
        const addresses = chainTokens.map((token) => token.address).join(",");
        const payload = await fetchJson(
          `https://api.dexscreener.com/tokens/v1/${chain.dexChainId}/${addresses}`,
        );
        const pairs = Array.isArray(payload) ? (payload as DexPair[]) : [];
        for (const token of chainTokens) {
          const match = pairs.find((pair) => sameAddress(pair.baseToken?.address, token.address, chain.kind));
          const price = match?.priceUsd ? Number(match.priceUsd) : NaN;
          const liquidity = match?.liquidity?.usd ?? null;
          if (!match || !Number.isFinite(price) || price <= 0) {
            rows.push(emptyMarket(token, now, "missing", "这条链上没有可用池子"));
            continue;
          }
          rows.push({
            asset: token.asset,
            symbol: token.symbol,
            chainId,
            price,
            liquidity,
            dex: dexName(match.dexId),
            pairLabel: `${match.baseToken?.symbol ?? token.symbol}/${match.quoteToken?.symbol ?? "?"} · ${dexName(match.dexId) ?? "pool"}`,
            status: "ok",
            error: null,
            updatedAt: now,
          });
        }
      } catch (error) {
        const message = shortError(error);
        for (const token of chainTokens) {
          rows.push(emptyMarket(token, now, "error", message));
        }
      }
    }),
  );

  return rows;
}

function emptyMarket(
  token: TokenPlacement,
  now: number,
  status: "missing" | "error",
  error: string,
): MarketRow {
  return {
    asset: token.asset,
    symbol: token.symbol,
    chainId: token.chainId,
    price: null,
    liquidity: null,
    dex: null,
    pairLabel: null,
    status,
    error,
    updatedAt: now,
  };
}

function dexName(value: string | undefined): string | null {
  if (!value || value.startsWith("0x")) return null;
  return value;
}

function sameAddress(left: string | undefined, right: string, kind: "evm" | "solana"): boolean {
  if (!left) return false;
  return kind === "evm" ? left.toLowerCase() === right.toLowerCase() : left === right;
}
