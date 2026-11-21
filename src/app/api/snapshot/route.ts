import { getSnapshot, startMonitor } from "@/lib/monitor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  startMonitor();
  return Response.json(getSnapshot());
}
