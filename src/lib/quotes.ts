import { chainById } from "./chains";
import { baseUnits, fetchJson, fromBaseUnits, shortError } from "./http";
import { findToken, pickStable } from "./tokens";
import type { Settings, SpreadRow, TokenPlacement } from "./types";

const EVM_QUOTE_FROM = "0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0";

type QuoteResult = {
  outAmount: bigint;
  outUsd: number | null;
  gasUsd: number | null;
  impactBps: number | null;
  route: string;
};

export async function confirmSpread(
  spread: SpreadRow,
  tokens: TokenPlacement[],
  settings: Settings,
): Promise<Pick<SpreadRow, "status" | "reason" | "detail" | "netUsd" | "gasUsd" | "impactBps">> {
  const buyChain = chainById(spread.buyChain);
  const sellChain = chainById(spread.sellChain);
  const buyToken = findToken(tokens, spread.asset, spread.buyChain);
  const sellToken = findToken(tokens, spread.asset, spread.sellChain);
  const buyStable = pickStable(tokens, spread.asset, spread.buyChain);
  const sellStable = pickStable(tokens, spread.asset, spread.sellChain);
  if (!buyChain || !sellChain || !buyToken || !sellToken || !buyStable || !sellStable) {
    return {
      ...spread,
      status: "rejected",
      reason: "缺少稳定币或代币地址，无法做可成交报价",
      detail: null,
    };
  }

  try {
    const buy = await quoteSwap(
      buyChain.id,
      buyStable,
      buyToken,
      baseUnits(spread.sizeUsd, buyStable.decimals),
      settings.slippageBps,
    );
    const sell = await quoteSwap(
      sellChain.id,
      sellToken,
      sellStable,
      buy.outAmount,
      settings.slippageBps,
    );
    const stableOut = sell.outUsd ?? fromBaseUnits(sell.outAmount, sellStable.decimals);
    const gasUsd = (buy.gasUsd ?? buyChain.gasUsd) + (sell.gasUsd ?? sellChain.gasUsd);
    const netUsd = stableOut - spread.sizeUsd - gasUsd - settings.safetyUsd;
    const impactBps = Math.max(buy.impactBps ?? 0, sell.impactBps ?? 0, spread.impactBps);
    const detail = `买入 ${buy.route}，卖出 ${sell.route}。卖出收回 ${stableOut.toFixed(4)} USD，Gas ${gasUsd.toFixed(4)} USD。`;
    if (impactBps > settings.maxImpactBps) {
      return {
        status: "rejected",
        reason: "可成交报价的价格冲击超过上限",
        detail,
        netUsd,
        gasUsd,
        impactBps,
      };
    }
    if (netUsd <= settings.minNetUsd) {
      return {
        status: "rejected",
        reason: "可成交报价后净收益低于门槛",
        detail,
        netUsd,
        gasUsd,
        impactBps,
      };
    }
    return {
      status: "confirmed",
      reason: "可成交报价确认，价差仍覆盖成本",
      detail,
      netUsd,
      gasUsd,
      impactBps,
    };
  } catch (error) {
    return {
      ...spread,
      status: "rejected",
      reason: "可成交报价失败",
      detail: shortError(error),
    };
  }
}

async function quoteSwap(
  chainId: string,
  input: TokenPlacement,
  output: TokenPlacement,
  amountIn: bigint,
  slippageBps: number,
): Promise<QuoteResult> {
  const chain = chainById(chainId);
  if (!chain) throw new Error("未知链");
  if (amountIn <= 0n) throw new Error("报价数量是 0");
  if (chain.kind === "solana") return quoteJupiter(input, output, amountIn, slippageBps);
  return quoteLifi(chain.lifiChainId, input, output, amountIn, slippageBps);
}

async function quoteJupiter(
  input: TokenPlacement,
  output: TokenPlacement,
  amountIn: bigint,
  slippageBps: number,
): Promise<QuoteResult> {
  const url = new URL("https://lite-api.jup.ag/swap/v1/quote");
  url.searchParams.set("inputMint", input.address);
  url.searchParams.set("outputMint", output.address);
  url.searchParams.set("amount", amountIn.toString());
  url.searchParams.set("slippageBps", String(slippageBps));
  const payload = (await fetchJson(url.toString())) as {
    outAmount?: string;
    priceImpactPct?: string;
    routePlan?: { swapInfo?: { label?: string } }[];
    error?: string;
  };
  if (!payload.outAmount) throw new Error(payload.error || "Jupiter 没有返回成交数量");
  const impact = payload.priceImpactPct ? Number(payload.priceImpactPct) * 10000 : null;
  const route =
    (payload.routePlan ?? [])
      .map((step) => step.swapInfo?.label)
      .filter(Boolean)
      .join(" → ") || "Jupiter";
  const outAmount = BigInt(payload.outAmount);
  const outUsd = isStable(output.asset) ? fromBaseUnits(outAmount, output.decimals) : null;
  return { outAmount, outUsd, gasUsd: null, impactBps: Number.isFinite(impact) ? impact : null, route };
}

async function quoteLifi(
  chainId: number,
  input: TokenPlacement,
  output: TokenPlacement,
  amountIn: bigint,
  slippageBps: number,
): Promise<QuoteResult> {
  const url = new URL("https://li.quest/v1/quote");
  url.searchParams.set("fromChain", String(chainId));
  url.searchParams.set("toChain", String(chainId));
  url.searchParams.set("fromToken", input.address);
  url.searchParams.set("toToken", output.address);
  url.searchParams.set("fromAmount", amountIn.toString());
  url.searchParams.set("fromAddress", EVM_QUOTE_FROM);
  url.searchParams.set("slippage", (slippageBps / 10000).toFixed(4));
  const payload = (await fetchJson(url.toString())) as {
    tool?: string;
    estimate?: {
      toAmount?: string;
      toAmountUSD?: string;
      gasCosts?: { amountUSD?: string }[];
    };
    message?: string;
  };
  const toAmount = payload.estimate?.toAmount;
  if (!toAmount) throw new Error(payload.message || "LI.FI 没有返回成交数量");
  const outAmount = BigInt(toAmount);
  const quotedUsd = payload.estimate?.toAmountUSD ? Number(payload.estimate.toAmountUSD) : null;
  const gasValues = (payload.estimate?.gasCosts ?? [])
    .map((cost) => Number(cost.amountUSD ?? 0))
    .filter((value) => Number.isFinite(value));
  const gasUsd = gasValues.length ? gasValues.reduce((sum, value) => sum + value, 0) : null;
  return {
    outAmount,
    outUsd: quotedUsd ?? (isStable(output.asset) ? fromBaseUnits(outAmount, output.decimals) : null),
    gasUsd,
    impactBps: null,
    route: payload.tool || "LI.FI",
  };
}

function isStable(asset: string): boolean {
  return asset === "USDC" || asset === "USDT" || asset === "DAI";
}
