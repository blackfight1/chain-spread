import { CHAINS } from "./chains";
import {
  defaultSettings,
  getSettings,
  readArchive,
  readLatestSpreads,
  readMarkets,
  replaceCycle,
  saveSettings,
} from "./db";
import { buildSpreads } from "./engine";
import { shortError } from "./http";
import { fetchMarkets } from "./prices";
import { confirmSpread } from "./quotes";
import { loadTokens } from "./tokens";
import type { MonitorStatus, Settings, Snapshot, SpreadRow, TokenPlacement } from "./types";

type QuoteMemory = Pick<SpreadRow, "status" | "reason" | "detail" | "netUsd" | "gasUsd" | "impactBps">;

type Runtime = {
  started: boolean;
  state: MonitorStatus;
  tokens: TokenPlacement[];
  tokensLoadedAt: number;
  lastConfirmAt: number;
  quotes: Map<string, QuoteMemory>;
};

function runtime(): Runtime {
  const globalState = globalThis as { __chainSpread?: Runtime };
  if (!globalState.__chainSpread) {
    globalState.__chainSpread = {
      started: false,
      state: {
        running: false,
        cycle: 0,
        lastPollAt: null,
        lastDurationMs: null,
        lastError: null,
        tokenSource: null,
        tokenCount: 0,
        marketCount: 0,
        opportunityCount: 0,
      },
      tokens: [],
      tokensLoadedAt: 0,
      lastConfirmAt: 0,
      quotes: new Map(),
    };
  }
  return globalState.__chainSpread;
}

export function startMonitor(): void {
  const current = runtime();
  if (current.started) return;
  current.started = true;
  current.state.running = true;
  void loop();
}

export function getSnapshot(): Snapshot {
  const current = runtime();
  const spreads = safeRead(readLatestSpreads, []);
  const markets = safeRead(readMarkets, []);
  return {
    status: {
      ...current.state,
      marketCount: markets.filter((market) => market.status === "ok").length,
      opportunityCount: spreads.filter((spread) => spread.status !== "rejected").length,
    },
    settings: safeRead(getSettings, defaultSettings()),
    markets,
    spreads,
    archive: safeRead(() => readArchive(50), []),
  };
}

export function updateSettings(input: Partial<Settings>): Settings {
  return saveSettings(normalizeSettings(input));
}

async function loop(): Promise<void> {
  const current = runtime();
  while (current.started) {
    const settings = getSettings();
    const startedAt = Date.now();
    try {
      await cycle(settings);
      current.state.lastError = null;
    } catch (error) {
      current.state.lastError = shortError(error);
      console.error("[monitor]", current.state.lastError);
    }
    current.state.cycle += 1;
    current.state.lastPollAt = Date.now();
    current.state.lastDurationMs = Date.now() - startedAt;
    const wait = Math.max(3000, settings.pollMs - current.state.lastDurationMs);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

async function cycle(settings: Settings): Promise<void> {
  const current = runtime();
  if (current.tokens.length === 0 || Date.now() - current.tokensLoadedAt > 30 * 60 * 1000) {
    const loaded = await loadTokens();
    current.tokens = loaded.tokens;
    current.tokensLoadedAt = Date.now();
    current.state.tokenSource = loaded.source;
    current.state.tokenCount = current.tokens.length;
  }

  const activeTokens = current.tokens.filter((token) => settings.enabledChains.includes(token.chainId));
  const markets = await fetchMarkets(activeTokens, settings.enabledChains);
  const spreads = buildSpreads(markets, settings, Date.now());
  const candidate = pickCandidate(spreads, settings, current.lastConfirmAt);
  for (const spread of spreads) {
    const memory = current.quotes.get(spread.id);
    if (memory && spread.id !== candidate?.id) Object.assign(spread, memory);
  }
  if (candidate) {
    const confirmed = await confirmSpread(candidate, activeTokens, settings);
    const memory: QuoteMemory = {
      status: confirmed.status,
      reason: confirmed.reason,
      detail: confirmed.detail,
      netUsd: confirmed.netUsd,
      gasUsd: confirmed.gasUsd,
      impactBps: confirmed.impactBps,
    };
    Object.assign(candidate, memory, { updatedAt: Date.now() });
    current.quotes.set(candidate.id, memory);
    current.lastConfirmAt = Date.now();
  }
  replaceCycle(markets, spreads);
  const best = spreads[0];
  console.log(
    `[monitor] markets=${markets.filter((market) => market.status === "ok").length} spreads=${spreads.length} best=${best ? `${best.symbol} ${best.netUsd.toFixed(4)} ${best.status}` : "none"}`,
  );
}

function pickCandidate(spreads: SpreadRow[], settings: Settings, lastConfirmAt: number): SpreadRow | undefined {
  const liquid = spreads.filter(
    (spread) =>
      spread.buyLiquidity >= settings.minLiquidityUsd &&
      spread.sellLiquidity >= settings.minLiquidityUsd,
  );
  const ready = liquid.find((spread) => spread.status === "indicative");
  if (ready) return ready;
  if (Date.now() - lastConfirmAt < 45_000) return undefined;
  return liquid[0];
}

function normalizeSettings(input: Partial<Settings>): Settings {
  const base = defaultSettings();
  const enabledChains = Array.isArray(input.enabledChains)
    ? input.enabledChains.filter((id) => CHAINS.some((chain) => chain.id === id))
    : base.enabledChains;
  const sizesUsd = Array.isArray(input.sizesUsd)
    ? [...new Set(input.sizesUsd.map(Number).filter((size) => size >= 1 && size <= 10))].sort((a, b) => a - b)
    : base.sizesUsd;
  return {
    enabledChains: enabledChains.length ? enabledChains : base.enabledChains,
    sizesUsd: sizesUsd.length ? sizesUsd : base.sizesUsd,
    minNetUsd: clamp(input.minNetUsd, 0, 100, base.minNetUsd),
    maxImpactBps: clamp(input.maxImpactBps, 1, 5000, base.maxImpactBps),
    minLiquidityUsd: clamp(input.minLiquidityUsd, 0, 1_000_000_000, base.minLiquidityUsd),
    safetyUsd: clamp(input.safetyUsd, 0, 50, base.safetyUsd),
    pollMs: clamp(input.pollMs, 8000, 120000, base.pollMs),
    slippageBps: clamp(input.slippageBps, 1, 300, base.slippageBps),
  };
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function safeRead<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch (error) {
    runtime().state.lastError = shortError(error);
    return fallback;
  }
}
