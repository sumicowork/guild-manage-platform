/**
 * Quick fix script — patches member join_time and feed/comment create_time_raw
 * that were set to NULL due to parseDateTime not handling numeric strings.
 *
 * Usage: npx tsx scripts/fix-times.ts
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, "../output");
const MAIN_JSON = path.join(OUTPUT_DIR, "82203161765285899_20260528_151950.json");

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

function parseDateTime(raw: string | number | undefined | null): Date | null {
  if (!raw) return null;
  if (typeof raw === "number") return new Date(raw * 1000);
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) return new Date(Number(s) * 1000);
  const d = new Date(s.replace(" ", "T") + "+08:00");
  return isNaN(d.getTime()) ? null : d;
}

function toBigInt(v: string | number | undefined | null): bigint | null {
  if (v === undefined || v === null || v === "") return null;
  try { return BigInt(v); } catch { return null; }
}

async function main() {
  console.log("=== Time Fix Script ===\n");

  // Load JSON
  const mainData = JSON.parse(fs.readFileSync(MAIN_JSON, "utf-8"));
  const feeds: any[] = mainData.feeds || [];
  const members: any[] = mainData.members || [];

  // ─── Fix member join_time ───────────────────────────────────────
  console.log(`[1/3] Fixing member join_time (${members.length} members)...`);
  let memberFixed = 0;
  const BATCH = 500;

  for (let i = 0; i < members.length; i += BATCH) {
    const chunk = members.slice(i, i + BATCH);
    const ops = chunk
      .map((m: any) => {
        const joinTime = parseDateTime(m.joinTime);
        if (!joinTime) return null;
        return prisma.member.updateMany({
          where: { tinyid: m.tinyid },
          data: {
            join_time: joinTime,
            join_time_human: m.joinTime_human || null,
          },
        });
      })
      .filter(Boolean);

    if (ops.length > 0) {
      await prisma.$transaction(ops, { maxWait: 30000, timeout: 60000 });
      memberFixed += ops.length;
    }
    process.stdout.write(`\r  Members: ${memberFixed}/${members.length}`);
  }
  console.log(`\n  Fixed ${memberFixed} members\n`);

  // ─── Fix feed create_time_raw (if null) ────────────────────────
  console.log(`[2/3] Checking feed create_time_raw...`);
  let feedFixed = 0;

  for (let i = 0; i < feeds.length; i += BATCH) {
    const chunk = feeds.slice(i, i + BATCH);
    const ops = chunk
      .map((f: any) => {
        const raw = toBigInt(f.create_time_raw);
        if (!raw) return null;
        return prisma.feed.updateMany({
          where: {
            feed_id: f.feed_id,
            create_time_raw: null,
          },
          data: { create_time_raw: raw },
        });
      })
      .filter(Boolean);

    if (ops.length > 0) {
      await prisma.$transaction(ops, { maxWait: 30000, timeout: 60000 });
      feedFixed += ops.length;
    }
    process.stdout.write(`\r  Feeds checked: ${i + chunk.length}/${feeds.length}`);
  }
  console.log(`\n  Fixed ${feedFixed} feeds (create_time_raw was null)\n`);

  // ─── Verify ────────────────────────────────────────────────────
  console.log("[3/3] Verifying...");
  const memberNull = await prisma.member.count({ where: { join_time: null } });
  const memberTotal = await prisma.member.count();
  const feedNullTime = await prisma.feed.count({ where: { create_time: null } });
  const feedTotal = await prisma.feed.count();
  const commentNullTime = await prisma.comment.count({ where: { create_time: null } });
  const commentTotal = await prisma.comment.count();

  console.log(`  Members: ${memberTotal - memberNull}/${memberTotal} have join_time`);
  console.log(`  Feeds:   ${feedTotal - feedNullTime}/${feedTotal} have create_time`);
  console.log(`  Comments:${commentTotal - commentNullTime}/${commentTotal} have create_time`);

  await prisma.$disconnect();
  console.log("\nDone!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
