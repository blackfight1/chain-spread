import { chainById } from "./chains";
import type { MarketRow, Settings, SpreadRow } from "./types";

export function buildSpreads(markets: MarketRow[], settings: Settings, now: number): SpreadRow[] {
  const live = markets.filter((market) => market.status === "ok" && market.price && market.price > 0);
  const byAsset = new Map<string, MarketRow[]>();
  for (const market of live) {
    const list = byAsset.get(market.asset) ?? [];
    list.push(market);
    byAsset.set(market.asset, list);
  }

  const spreads: SpreadRow[] = [];
  for (const group of byAsset.values()) {
    for (let left = 0; left < group.length; left += 1) {
      for (let right = left + 1; right < group.length; right += 1) {
        const cheaper = group[left].price! <= group[right].price! ? group[left] : group[right];
        const richer = cheaper === group[left] ? group[right] : group[left];
        for (const sizeUsd of settings.sizesUsd) {
          spreads.push(compare(cheaper, richer, sizeUsd, settings, now));
        }
      }
    }
  }
  return spreads.sort((a, b) => b.netUsd - a.netUsd);
}

function compare(
  buy: MarketRow,
  sell: MarketRow,
  sizeUsd: number,
  settings: Settings,
  now: number,
): SpreadRow {
  const buyPrice = buy.price ?? 0;
  const sellPrice = sell.price ?? 0;
  const buyLiquidity = buy.liquidity ?? 0;
  const sellLiquidity = sell.liquidity ?? 0;
  const spreadBps = buyPrice > 0 ? ((sellPrice - buyPrice) / buyPrice) * 10000 : 0;
  const grossUsd = buyPrice > 0 ? sizeUsd * ((sellPrice - buyPrice) / buyPrice) : 0;
  const gasUsd = (chainById(buy.chainId)?.gasUsd ?? 0) + (chainById(sell.chainId)?.gasUsd ?? 0);
  const netUsd = grossUsd - gasUsd - settings.safetyUsd;
  const impactBps = Math.max(
    buyLiquidity > 0 ? (sizeUsd / buyLiquidity) * 10000 : Number.POSITIVE_INFINITY,
    sellLiquidity > 0 ? (sizeUsd / sellLiquidity) * 10000 : Number.POSITIVE_INFINITY,
  );
  let status: SpreadRow["status"] = "indicative";
  let reason = "池子价差覆盖成本，等待可成交报价";
  if (buyLiquidity < settings.minLiquidityUsd || sellLiquidity < settings.minLiquidityUsd) {
    status = "rejected";
    reason = "流动性低于下限";
  } else if (!Number.isFinite(impactBps) || impactBps > settings.maxImpactBps) {
    status = "rejected";
    reason = "价格冲击超过上限";
  } else if (netUsd <= settings.minNetUsd) {
    status = "rejected";
    reason = "净收益低于门槛";
  }

  return {
    id: `${buy.asset}|${buy.chainId}|${sell.chainId}|${sizeUsd}`,
    asset: buy.asset,
    symbol: buy.symbol,
    buyChain: buy.chainId,
    sellChain: sell.chainId,
    sizeUsd,
    buyPrice,
    sellPrice,
    spreadBps,
    impactBps: Number.isFinite(impactBps) ? impactBps : 0,
    gasUsd,
    grossUsd,
    netUsd,
    buyLiquidity,
    sellLiquidity,
    status,
    reason,
    detail: null,
    updatedAt: now,
  };
}
