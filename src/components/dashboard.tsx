"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CHAINS, chainLabel } from "@/lib/chains";
import type { MarketRow, Settings, Snapshot, SpreadRow, SpreadStatus } from "@/lib/types";

const emptySettings: Settings = {
  enabledChains: [],
  sizesUsd: [1, 5, 10],
  minNetUsd: 0.05,
  maxImpactBps: 150,
  minLiquidityUsd: 20000,
  safetyUsd: 0.02,
  pollMs: 12000,
  slippageBps: 50,
};

export function Dashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asset, setAsset] = useState("全部");
  const [draft, setDraft] = useState<Settings>(emptySettings);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState("");

  useEffect(() => {
    let stop = false;
    const pull = async () => {
      try {
        const response = await fetch("/api/snapshot", { cache: "no-store" });
        if (!response.ok) throw new Error(`接口返回 ${response.status}`);
        const body = (await response.json()) as Snapshot;
        if (!stop) {
          setSnapshot(body);
          setError(null);
        }
      } catch (pullError) {
        if (!stop) setError(pullError instanceof Error ? pullError.message : "监控接口没有响应");
      }
    };
    void pull();
    const timer = setInterval(pull, 2000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  const settingsKey = JSON.stringify(snapshot?.settings ?? null);
  useEffect(() => {
    if (settingsKey === "null") return;
    setDraft(JSON.parse(settingsKey) as Settings);
  }, [settingsKey]);

  const assets = useMemo(() => {
    const names = new Set((snapshot?.markets ?? []).map((market) => market.asset));
    return ["全部", ...names];
  }, [snapshot]);

  const visibleSpreads = (snapshot?.spreads ?? []).filter((spread) => asset === "全部" || spread.asset === asset);
  const opportunities = visibleSpreads.filter((spread) => spread.status !== "rejected");

  async function saveSettings() {
    setSaving(true);
    setSavedNote("");
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!response.ok) throw new Error(`保存失败 ${response.status}`);
      setSavedNote("已保存，下一轮扫描会用新门槛。");
    } catch (saveError) {
      setSavedNote(saveError instanceof Error ? saveError.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <p className="font-mono text-xs tracking-[0.22em] text-primary">CHAIN SPREAD</p>
          <h1 className="text-3xl font-semibold tracking-tight">跨链同币监控</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            同一枚币在不同链上的池子价格。先在便宜的一边估价买入，再在贵的一边估价卖出。这里只记录价差，不保存私钥，也不发送交易。
          </p>
        </div>
        <StatusPills snapshot={snapshot} />
      </header>

      {error ? (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">监控接口暂时读不到：{error}</CardContent>
        </Card>
      ) : null}
      {snapshot?.status.lastError ? (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">最近一轮扫描出错：{snapshot.status.lastError}</CardContent>
        </Card>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="监控资产" value={String(new Set((snapshot?.markets ?? []).map((item) => item.asset)).size || 0)} />
        <Metric label="有效报价" value={String(snapshot?.status.marketCount ?? 0)} />
        <Metric label="超过门槛" value={String(snapshot?.status.opportunityCount ?? 0)} hint="含待报价确认" />
        <Metric
          label="最佳净收益"
          value={snapshot?.spreads[0] ? usd(snapshot.spreads[0].netUsd, true) : "—"}
          hint={
            snapshot?.spreads[0]
              ? `${snapshot.spreads[0].symbol} · ${snapshot.spreads[0].sizeUsd} USD · ${snapshot.spreads[0].reason}`
              : "等第一轮扫描"
          }
        />
      </section>

      <Tabs defaultValue="board">
        <TabsList className="h-auto max-w-full flex-wrap">
          <TabsTrigger value="board">机会</TabsTrigger>
          <TabsTrigger value="markets">行情</TabsTrigger>
          <TabsTrigger value="archive">档案</TabsTrigger>
          <TabsTrigger value="settings">设置</TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="mt-4 space-y-4">
          <AssetFilters assets={assets} asset={asset} onChange={setAsset} />
          {!snapshot ? (
            <Empty text="正在连接监控进程。" />
          ) : snapshot.status.lastPollAt == null ? (
            <Empty text="正在拉取代币对照和第一轮池子价格，大约需要十几秒。" />
          ) : visibleSpreads.length === 0 ? (
            <Empty text="这一轮没有可比较的报价。看看行情页里哪些链没有池子。" />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {opportunities.length
                  ? `${opportunities.length} 条比较的净收益超过门槛。`
                  : "这一轮没有净收益超过门槛的价差。下面是最接近的比较，以及不执行的原因。"}
              </p>
              <SpreadTable rows={visibleSpreads.slice(0, 40)} />
            </>
          )}
        </TabsContent>

        <TabsContent value="markets" className="mt-4 space-y-4">
          <AssetFilters assets={assets} asset={asset} onChange={setAsset} />
          <MarketGrid
            markets={(snapshot?.markets ?? []).filter((market) => asset === "全部" || market.asset === asset)}
            ready={Boolean(snapshot?.status.lastPollAt)}
          />
        </TabsContent>

        <TabsContent value="archive" className="mt-4">
          {(snapshot?.archive.length ?? 0) === 0 ? (
            <Empty text="档案还是空的。状态或原因变化时才会记一笔，避免每秒刷一行。" />
          ) : (
            <div className="space-y-2">
              {snapshot?.archive.map((item) => (
                <Card key={item.id}>
                  <CardContent className="flex flex-col gap-1 py-4 text-sm md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="font-medium">
                        {item.symbol} · {chainLabel(item.buyChain)} 买入 → {chainLabel(item.sellChain)} 卖出
                      </div>
                      <div className="text-muted-foreground">
                        {item.reason}
                        {item.detail ? ` ${item.detail}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 font-mono text-xs">
                      <span>{item.sizeUsd} USD</span>
                      <span className={item.netUsd > 0 ? "text-primary" : "text-muted-foreground"}>{usd(item.netUsd, true)}</span>
                      <StatusBadge status={item.status} />
                      <span className="text-muted-foreground">{clock(item.createdAt)}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>扫描门槛</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex flex-wrap gap-2">
                {CHAINS.map((chain) => {
                  const on = draft.enabledChains.includes(chain.id);
                  return (
                    <Button
                      key={chain.id}
                      type="button"
                      variant={on ? "default" : "outline"}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          enabledChains: on
                            ? current.enabledChains.filter((id) => id !== chain.id)
                            : [...current.enabledChains, chain.id],
                        }))
                      }
                    >
                      {chain.label}
                    </Button>
                  );
                })}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="金额档，1 到 10 USD，用逗号分开">
                  <Input
                    value={draft.sizesUsd.join(", ")}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        sizesUsd: event.target.value
                          .split(/[,，\s]+/)
                          .map(Number)
                          .filter((size) => Number.isFinite(size)),
                      }))
                    }
                  />
                </Field>
                <NumberField label="净收益门槛 USD" value={draft.minNetUsd} onChange={(minNetUsd) => setDraft({ ...draft, minNetUsd })} />
                <NumberField label="价格冲击上限 bps" value={draft.maxImpactBps} onChange={(maxImpactBps) => setDraft({ ...draft, maxImpactBps })} />
                <NumberField label="最低流动性 USD" value={draft.minLiquidityUsd} onChange={(minLiquidityUsd) => setDraft({ ...draft, minLiquidityUsd })} />
                <NumberField label="安全垫 USD" value={draft.safetyUsd} onChange={(safetyUsd) => setDraft({ ...draft, safetyUsd })} />
                <NumberField label="滑点 bps" value={draft.slippageBps} onChange={(slippageBps) => setDraft({ ...draft, slippageBps })} />
                <NumberField label="轮询间隔毫秒，最少 8000" value={draft.pollMs} onChange={(pollMs) => setDraft({ ...draft, pollMs })} />
              </div>
              <p className="text-sm text-muted-foreground">
                Gas 先用固定估算：Solana 0.02、BNB Chain 0.10、Base 0.03、Arbitrum 0.05、Polygon 0.02、Optimism 0.04 美元。可成交报价拿到真实 Gas 后会改用那一个数字。
              </p>
              <div className="flex items-center gap-3">
                <Button type="button" onClick={saveSettings} disabled={saving}>
                  {saving ? "保存中" : "保存设置"}
                </Button>
                {savedNote ? <span className="text-sm text-muted-foreground">{savedNote}</span> : null}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </main>
  );
}

function StatusPills({ snapshot }: { snapshot: Snapshot | null }) {
  const status = snapshot?.status;
  return (
    <div className="flex flex-wrap gap-2 font-mono text-xs">
      <Badge variant={status?.running ? "default" : "secondary"}>{status?.running ? "扫描中" : "启动中"}</Badge>
      <Badge variant="outline">第 {status?.cycle ?? 0} 轮</Badge>
      <Badge variant="outline">{status?.lastPollAt ? `更新于 ${ago(status.lastPollAt)}` : "等待第一轮"}</Badge>
      <Badge variant="outline">{status?.tokenSource ?? "代币对照加载中"}</Badge>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 py-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="font-mono text-2xl">{value}</div>
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

function AssetFilters({
  assets,
  asset,
  onChange,
}: {
  assets: string[];
  asset: string;
  onChange: (asset: string) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {assets.map((item) => (
        <Button key={item} type="button" size="sm" variant={item === asset ? "default" : "outline"} onClick={() => onChange(item)}>
          {item}
        </Button>
      ))}
    </div>
  );
}

function SpreadTable({ rows }: { rows: SpreadRow[] }) {
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <Card key={row.id} className={row.status === "confirmed" ? "border-primary/60" : undefined}>
          <CardContent className="grid gap-3 py-4 md:grid-cols-[1.4fr_1fr_auto] md:items-center">
            <div>
              <div className="font-medium">
                {row.symbol}
                <span className="ml-2 text-muted-foreground">
                  {chainLabel(row.buyChain)} 买入 → {chainLabel(row.sellChain)} 卖出
                </span>
              </div>
              <div className="text-sm text-muted-foreground">
                {row.reason}
                {row.detail ? ` ${row.detail}` : ""}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 font-mono text-xs text-muted-foreground">
              <span>{row.sizeUsd} USD</span>
              <span>{row.spreadBps.toFixed(1)} bps</span>
              <span>冲击 {row.impactBps.toFixed(1)}</span>
            </div>
            <div className="flex items-center gap-3 md:justify-end">
              <span className={`font-mono ${row.netUsd > 0 ? "text-primary" : "text-foreground"}`}>{usd(row.netUsd, true)}</span>
              <StatusBadge status={row.status} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MarketGrid({ markets, ready }: { markets: MarketRow[]; ready: boolean }) {
  if (!ready) return <Empty text="第一轮报价还没回来。" />;
  if (markets.length === 0) return <Empty text="这个资产在已开启的链上没有对照地址。" />;
  const groups = new Map<string, MarketRow[]>();
  for (const market of markets) {
    const list = groups.get(market.asset) ?? [];
    list.push(market);
    groups.set(market.asset, list);
  }
  return (
    <div className="space-y-6">
      {[...groups.entries()].map(([name, rows]) => (
        <section key={name} className="space-y-2">
          <h2 className="font-mono text-sm text-muted-foreground">{name}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {rows.map((market) => (
              <Card key={`${market.asset}-${market.chainId}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-base">
                    {chainLabel(market.chainId)}
                    <Badge variant={market.status === "ok" ? "default" : "secondary"}>
                      {market.status === "ok" ? "已连接" : market.status === "missing" ? "无池子" : "报价失败"}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <div className="font-mono text-xl">{market.price == null ? "—" : usd(market.price, false)}</div>
                  <div className="text-muted-foreground">
                    流动性 {market.liquidity == null ? "—" : compact(market.liquidity)}
                    {market.pairLabel ? ` · ${market.pairLabel}` : ""}
                  </div>
                  <div className="text-muted-foreground">{market.error ? market.error : `更新于 ${ago(market.updatedAt)}`}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: SpreadStatus }) {
  if (status === "confirmed") return <Badge>可成交</Badge>;
  if (status === "indicative") return <Badge variant="secondary">待报价确认</Badge>;
  return <Badge variant="outline">不执行</Badge>;
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <Input
        inputMode="decimal"
        value={Number.isFinite(value) ? String(value) : ""}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="py-8 text-sm text-muted-foreground">{text}</CardContent>
    </Card>
  );
}

function usd(value: number, signed: boolean): string {
  const digits = Math.abs(value) >= 1 ? 2 : 4;
  const text = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const sign = signed ? (value > 0 ? "+" : value < 0 ? "-" : "") : "";
  return `${sign}$${text}`;
}

function compact(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

function ago(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 5) return "刚刚";
  if (seconds < 60) return `${seconds} 秒前`;
  return `${Math.floor(seconds / 60)} 分钟前`;
}

function clock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
