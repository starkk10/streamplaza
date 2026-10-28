import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { runScheduledJobs } from "@/server/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Alternativa al worker para hostings con cron externo:
// curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://tu-dominio/api/cron
export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!env.cronSecret || !safeEqual(token, env.cronSecret)) return new Response("Unauthorized", { status: 401 });
  return NextResponse.json(await runScheduledJobs());
}
