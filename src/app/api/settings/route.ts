import { updateSettings } from "@/lib/monitor";
import type { Settings } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<Settings>;
  const settings = updateSettings(body);
  return Response.json({ settings });
}
