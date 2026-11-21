export async function fetchJson(url: string, timeoutMs = 12000): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "chain-spread-monitor",
    },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${text.slice(0, 180)}`);
  }
  return JSON.parse(text) as unknown;
}

export function baseUnits(amount: number, decimals: number): bigint {
  const fixed = Math.abs(amount).toFixed(decimals);
  const [whole, fraction = ""] = fixed.split(".");
  const digits = `${whole}${fraction}`.replace(/^0+/, "") || "0";
  return BigInt(digits);
}

export function fromBaseUnits(amount: bigint, decimals: number): number {
  const negative = amount < 0n;
  const value = negative ? -amount : amount;
  const text = value.toString().padStart(decimals + 1, "0");
  const split = text.length - decimals;
  const parsed = Number(`${text.slice(0, split)}.${text.slice(split)}`);
  return negative ? -parsed : parsed;
}

export function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 180);
}
