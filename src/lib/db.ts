import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_ENABLED_CHAINS } from "./chains";
import type {
  ArchiveRow,
  MarketRow,
  Settings,
  SpreadRow,
  SpreadStatus,
} from "./types";

const dbPath = path.join(process.cwd(), "data", "monitor.sqlite");

export const defaultSettings = (): Settings => ({
  enabledChains: [...DEFAULT_ENABLED_CHAINS],
  sizesUsd: [1, 5, 10],
  minNetUsd: 0.05,
  maxImpactBps: 150,
  minLiquidityUsd: 20000,
  safetyUsd: 0.02,
  pollMs: 12000,
  slippageBps: 50,
});

let database: DatabaseSync | null = null;

function databaseSync(): DatabaseSync {
  if (!database) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    database = new DatabaseSync(dbPath);
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 3000;
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS markets (
        asset TEXT NOT NULL,
        symbol TEXT NOT NULL,
        chain_id TEXT NOT NULL,
        price REAL,
        liquidity REAL,
        dex TEXT,
        pair_label TEXT,
        status TEXT NOT NULL,
        error TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (asset, chain_id)
      );
      CREATE TABLE IF NOT EXISTS spreads (
        id TEXT PRIMARY KEY,
        asset TEXT NOT NULL,
        symbol TEXT NOT NULL,
        buy_chain TEXT NOT NULL,
        sell_chain TEXT NOT NULL,
        size_usd REAL NOT NULL,
        buy_price REAL NOT NULL,
        sell_price REAL NOT NULL,
        spread_bps REAL NOT NULL,
        impact_bps REAL NOT NULL,
        gas_usd REAL NOT NULL,
        gross_usd REAL NOT NULL,
        net_usd REAL NOT NULL,
        buy_liquidity REAL NOT NULL,
        sell_liquidity REAL NOT NULL,
        status TEXT NOT NULL,
        reason TEXT NOT NULL,
        detail TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS archive (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        asset TEXT NOT NULL,
        symbol TEXT NOT NULL,
        buy_chain TEXT NOT NULL,
        sell_chain TEXT NOT NULL,
        size_usd REAL NOT NULL,
        net_usd REAL NOT NULL,
        status TEXT NOT NULL,
        reason TEXT NOT NULL,
        detail TEXT
      );
    `);
    const existing = database.prepare("SELECT json FROM settings WHERE id = 1").get();
    if (!existing) {
      database
        .prepare("INSERT INTO settings (id, json) VALUES (1, ?)")
        .run(JSON.stringify(defaultSettings()));
    }
  }
  return database;
}

export function getSettings(): Settings {
  const row = databaseSync().prepare("SELECT json FROM settings WHERE id = 1").get();
  const stored = row ? (JSON.parse(String(row.json)) as Partial<Settings>) : {};
  return { ...defaultSettings(), ...stored };
}

export function saveSettings(settings: Settings): Settings {
  const next = { ...defaultSettings(), ...settings };
  databaseSync()
    .prepare("UPDATE settings SET json = ? WHERE id = 1")
    .run(JSON.stringify(next));
  return next;
}

export function readSpreads(): SpreadRow[] {
  return databaseSync()
    .prepare("SELECT * FROM spreads")
    .all()
    .map(mapSpread);
}

export function replaceCycle(markets: MarketRow[], spreads: SpreadRow[]): void {
  const db = databaseSync();
  const previous = new Map(readSpreads().map((row) => [row.id, row]));
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM markets");
    db.exec("DELETE FROM spreads");
    const insertMarket = db.prepare(`
      INSERT INTO markets (
        asset, symbol, chain_id, price, liquidity, dex, pair_label, status, error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const market of markets) {
      insertMarket.run(
        market.asset,
        market.symbol,
        market.chainId,
        market.price,
        market.liquidity,
        market.dex,
        market.pairLabel,
        market.status,
        market.error,
        market.updatedAt,
      );
    }
    const insertSpread = db.prepare(`
      INSERT INTO spreads (
        id, asset, symbol, buy_chain, sell_chain, size_usd, buy_price, sell_price,
        spread_bps, impact_bps, gas_usd, gross_usd, net_usd, buy_liquidity, sell_liquidity,
        status, reason, detail, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertArchive = db.prepare(`
      INSERT INTO archive (
        created_at, asset, symbol, buy_chain, sell_chain, size_usd, net_usd, status, reason, detail
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const spread of spreads) {
      insertSpread.run(
        spread.id,
        spread.asset,
        spread.symbol,
        spread.buyChain,
        spread.sellChain,
        spread.sizeUsd,
        spread.buyPrice,
        spread.sellPrice,
        spread.spreadBps,
        spread.impactBps,
        spread.gasUsd,
        spread.grossUsd,
        spread.netUsd,
        spread.buyLiquidity,
        spread.sellLiquidity,
        spread.status,
        spread.reason,
        spread.detail,
        spread.updatedAt,
      );
      const prior = previous.get(spread.id);
      const changed =
        !prior ||
        prior.status !== spread.status ||
        prior.reason !== spread.reason ||
        Math.abs(prior.netUsd - spread.netUsd) >= 0.02;
      if (changed && (spread.status !== "rejected" || spread.detail)) {
        insertArchive.run(
          spread.updatedAt,
          spread.asset,
          spread.symbol,
          spread.buyChain,
          spread.sellChain,
          spread.sizeUsd,
          spread.netUsd,
          spread.status,
          spread.reason,
          spread.detail,
        );
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  databaseSync().exec(`
    DELETE FROM archive
    WHERE id NOT IN (SELECT id FROM archive ORDER BY id DESC LIMIT 400)
  `);
}

export function readMarkets(): MarketRow[] {
  return databaseSync()
    .prepare("SELECT * FROM markets ORDER BY asset, chain_id")
    .all()
    .map(mapMarket);
}

export function readLatestSpreads(): SpreadRow[] {
  return databaseSync()
    .prepare("SELECT * FROM spreads ORDER BY net_usd DESC")
    .all()
    .map(mapSpread);
}

export function readArchive(limit = 40): ArchiveRow[] {
  return databaseSync()
    .prepare("SELECT * FROM archive ORDER BY id DESC LIMIT ?")
    .all(limit)
    .map(mapArchive);
}

function mapMarket(row: Record<string, unknown>): MarketRow {
  return {
    asset: String(row.asset),
    symbol: String(row.symbol),
    chainId: String(row.chain_id),
    price: row.price == null ? null : Number(row.price),
    liquidity: row.liquidity == null ? null : Number(row.liquidity),
    dex: row.dex == null ? null : String(row.dex),
    pairLabel: row.pair_label == null ? null : String(row.pair_label),
    status: String(row.status) as MarketRow["status"],
    error: row.error == null ? null : String(row.error),
    updatedAt: Number(row.updated_at),
  };
}

function mapSpread(row: Record<string, unknown>): SpreadRow {
  return {
    id: String(row.id),
    asset: String(row.asset),
    symbol: String(row.symbol),
    buyChain: String(row.buy_chain),
    sellChain: String(row.sell_chain),
    sizeUsd: Number(row.size_usd),
    buyPrice: Number(row.buy_price),
    sellPrice: Number(row.sell_price),
    spreadBps: Number(row.spread_bps),
    impactBps: Number(row.impact_bps),
    gasUsd: Number(row.gas_usd),
    grossUsd: Number(row.gross_usd),
    netUsd: Number(row.net_usd),
    buyLiquidity: Number(row.buy_liquidity),
    sellLiquidity: Number(row.sell_liquidity),
    status: String(row.status) as SpreadStatus,
    reason: String(row.reason),
    detail: row.detail == null ? null : String(row.detail),
    updatedAt: Number(row.updated_at),
  };
}

function mapArchive(row: Record<string, unknown>): ArchiveRow {
  return {
    id: Number(row.id),
    createdAt: Number(row.created_at),
    asset: String(row.asset),
    symbol: String(row.symbol),
    buyChain: String(row.buy_chain),
    sellChain: String(row.sell_chain),
    sizeUsd: Number(row.size_usd),
    netUsd: Number(row.net_usd),
    status: String(row.status) as SpreadStatus,
    reason: String(row.reason),
    detail: row.detail == null ? null : String(row.detail),
  };
}
