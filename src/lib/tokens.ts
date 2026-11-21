import { CHAINS, TRACKED_COIN_KEYS, chainById } from "./chains";
import { FALLBACK_TOKENS } from "./fallback-tokens";
import { fetchJson } from "./http";
import type { TokenPlacement } from "./types";

const allowed = new Set<string>(TRACKED_COIN_KEYS);

type LifiToken = {
  address?: string;
  symbol?: string;
  decimals?: number;
  coinKey?: string;
  verificationStatus?: string;
};

export async function loadTokens(): Promise<{ tokens: TokenPlacement[]; source: string }> {
  try {
    const keys = CHAINS.map((chain) => chain.lifiKey).join(",");
    const payload = (await fetchJson(`https://li.quest/v1/tokens?chains=${keys}`)) as {
      tokens?: Record<string, LifiToken[]>;
    };
    const chosen = new Map<string, TokenPlacement>();
    for (const [chainIdValue, list] of Object.entries(payload.tokens ?? {})) {
      const chain = CHAINS.find((item) => item.lifiChainId === Number(chainIdValue));
      if (!chain || !Array.isArray(list)) continue;
      for (const token of list) {
        const asset = token.coinKey ?? "";
        if (!allowed.has(asset)) continue;
        if (token.verificationStatus && token.verificationStatus !== "verified") continue;
        if (!token.address || token.address === "0x0000000000000000000000000000000000000000") continue;
        if (typeof token.decimals !== "number") continue;
        const next: TokenPlacement = {
          asset,
          symbol: token.symbol || asset,
          chainId: chain.id,
          address: token.address,
          decimals: token.decimals,
        };
        const key = `${asset}:${chain.id}`;
        const current = chosen.get(key);
        if (!current || prefer(next, current)) chosen.set(key, next);
      }
    }
    const tokens = [...chosen.values()];
    if (tokens.length < 8) {
      return { tokens: FALLBACK_TOKENS, source: "内置对照表" };
    }
    return { tokens, source: "LI.FI coinKey" };
  } catch {
    return { tokens: FALLBACK_TOKENS, source: "内置对照表" };
  }
}

function prefer(next: TokenPlacement, current: TokenPlacement): boolean {
  const nextExact = next.symbol.toUpperCase() === next.asset ? 1 : 0;
  const currentExact = current.symbol.toUpperCase() === current.asset ? 1 : 0;
  return nextExact > currentExact;
}

export function tokensOn(tokens: TokenPlacement[], chainId: string): TokenPlacement[] {
  return tokens.filter((token) => token.chainId === chainId);
}

export function findToken(
  tokens: TokenPlacement[],
  asset: string,
  chainId: string,
): TokenPlacement | undefined {
  return tokens.find((token) => token.asset === asset && token.chainId === chainId);
}

export function pickStable(
  tokens: TokenPlacement[],
  asset: string,
  chainId: string,
): TokenPlacement | undefined {
  const order =
    asset === "USDC"
      ? ["USDT", "DAI"]
      : asset === "USDT"
        ? ["USDC", "DAI"]
        : asset === "DAI"
          ? ["USDC", "USDT"]
          : ["USDC", "USDT", "DAI"];
  for (const key of order) {
    const token = findToken(tokens, key, chainId);
    if (token) return token;
  }
  return undefined;
}

export function knownChain(chainId: string): boolean {
  return Boolean(chainById(chainId));
}
