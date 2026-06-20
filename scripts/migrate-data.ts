/**
 * Data migration script — imports legacy JSON exports into PostgreSQL.
 *
 * Usage:
 *   npx tsx scripts/migrate-data.ts
 *   (or) node --loader ts-node/esm scripts/migrate-data.ts
 *
 * Reads from: ../output/82203161765285899_20260528_151950*.json
 *
 * This is a standalone script and uses relative imports to avoid
 * depending on Next.js path aliases.
 */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";

// ─── Resolve paths ────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, "../output");
const MAIN_JSON = path.join(OUTPUT_DIR, "82203161765285899_20260528_151950.json");
const COMMENTS_JSON = path.join(OUTPUT_DIR, "82203161765285899_20260528_151950_comments.json");
const DETAIL_JSON = path.join(OUTPUT_DIR, "82203161765285899_20260528_151950_detail.json");

const BATCH_SIZE = 500;

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// ─── Helpers ──────────────────────────────────────────────────────────

function parseDateTime(raw: string | number | undefined | null): Date | null {
  if (!raw) return null;
  if (typeof raw === "number") return new Date(raw * 1000);
  const d = new Date(String(raw).replace(" ", "T") + "+08:00");
  return isNaN(d.getTime()) ? null : d;
}

function toBigInt(v: string | number | undefined | null): bigint | null {
  if (v === undefined || v === null || v === "") return null;
  try {
    return BigInt(v);
  } catch {
    return null;
  }
}

function sanitize(v: any): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v);
  // Strips null bytes and other control chars except tab/newline
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").trim() || null;
}

function extractContentText(content: any): string | null {
  if (!content) return null;
  if (typeof content === "string") return sanitize(content);
  if (typeof content === "object" && content.text) return sanitize(content.text);
  return null;
}

function progress(label: string, current: number, total: number): void {
  const pct = total > 0 ? Math.round((current / total) * 100) : 100;
  process.stdout.write(`\r  ${label}: ${current}/${total} (${pct}%)`);
  if (current >= total) process.stdout.write("\n");
}

// ─── Step 1: Import feeds ─────────────────────────────────────────────

async function importFeeds(
  feeds: any[],
  detailMap: Record<string, any>
): Promise<void> {
  console.log("\n[1/5] Importing feeds...");
  const total = feeds.length;
  let count = 0;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const chunk = feeds.slice(i, i + BATCH_SIZE);
    const ops = chunk.map((feed: any) => {
      const detail = detailMap[feed.feed_id] || {};
      const createTime = parseDateTime(feed.create_time);
      const createTimeRaw = toBigInt(feed.create_time_raw);

      return prisma.feed.upsert({
        where: { feed_id: feed.feed_id },
        create: {
          feed_id: feed.feed_id,
          author: sanitize(feed.author),
          author_id: sanitize(feed.author_id),
          channel_name: sanitize(feed.channel_name),
          title: sanitize(feed.title),
          content: sanitize(detail.content),
          content_snippet: sanitize(feed.content_snippet),
          share_url: sanitize(detail.share_url),
          images: feed.images ?? null,
          prefer_count: feed.prefer_count ?? 0,
          comment_count: feed.comment_count ?? 0,
          feed_type: detail.feed_type ?? null,
          create_time: createTime,
          create_time_raw: createTimeRaw,
          status: "active",
        },
        update: {
          content: sanitize(detail.content) ?? undefined,
          share_url: sanitize(detail.share_url) ?? undefined,
          feed_type: detail.feed_type ?? undefined,
          comment_count: feed.comment_count ?? undefined,
          prefer_count: feed.prefer_count ?? undefined,
        },
      });
    });

    await prisma.$transaction(ops, { maxWait: 30000, timeout: 60000 });
    count += chunk.length;
    progress("Feeds", count, total);
  }
}

// ─── Step 2: Import comments ──────────────────────────────────────────

async function importComments(
  commentsMap: Record<string, any[]>
): Promise<{ commentCount: number; replyCount: number }> {
  console.log("\n[2/5] Importing comments and replies...");
  const feedIds = Object.keys(commentsMap);
  let commentCount = 0;
  let replyCount = 0;

  // Count total comments for progress
  let totalComments = 0;
  for (const fid of feedIds) {
    if (Array.isArray(commentsMap[fid])) {
      totalComments += commentsMap[fid].length;
    }
  }

  for (let i = 0; i < feedIds.length; i += BATCH_SIZE) {
    const chunkFeedIds = feedIds.slice(i, i + BATCH_SIZE);
    const commentOps: any[] = [];
    const replyOps: any[] = [];

    for (const feedId of chunkFeedIds) {
      const comments = commentsMap[feedId];
      if (!Array.isArray(comments)) continue;

      for (const comment of comments) {
        const createTime = parseDateTime(comment.create_time);
        const createTimeRaw = toBigInt(comment.create_time_raw);
        const contentText = extractContentText(comment.content);

        commentOps.push(
          prisma.comment.upsert({
            where: { comment_id: comment.comment_id },
            create: {
              comment_id: comment.comment_id,
              feed_id: feedId,
              author: sanitize(comment.author),
              author_id: sanitize(comment.author_id),
              content: comment.content ?? null,
              content_text: contentText ?? sanitize(comment.content_text),
              like_count: comment.like_count ?? 0,
              reply_count: comment.reply_count ?? 0,
              comment_index: comment.comment_index ?? null,
              create_time: createTime,
              create_time_raw: createTimeRaw,
              status: "active",
            },
            update: {
              like_count: comment.like_count ?? undefined,
              reply_count: comment.reply_count ?? undefined,
              content_text: contentText ?? sanitize(comment.content_text) ?? undefined,
            },
          })
        );
        commentCount++;

        // Replies nested in replies_preview
        if (comment.replies_preview && Array.isArray(comment.replies_preview)) {
          for (const reply of comment.replies_preview) {
            const replyCreateTime = parseDateTime(reply.create_time);
            const replyCreateTimeRaw = toBigInt(reply.create_time_raw);
            const replyContentText = extractContentText(reply.content);

            replyOps.push(
              prisma.reply.upsert({
                where: { reply_id: reply.reply_id },
                create: {
                  reply_id: reply.reply_id,
                  comment_id: comment.comment_id,
                  feed_id: feedId,
                  author: sanitize(reply.author),
                  author_id: sanitize(reply.author_id),
                  content: reply.content ?? null,
                  content_text: replyContentText ?? null,
                  target_reply_id: sanitize(reply.target_reply_id),
                  target_user: sanitize(reply.target_user),
                  target_user_id: sanitize(reply.target_user_id),
                  create_time: replyCreateTime,
                  create_time_raw: replyCreateTimeRaw,
                  status: "active",
                },
                update: {
                  content_text: replyContentText ?? undefined,
                },
              })
            );
            replyCount++;
          }
        }
      }
    }

    // Execute comment and reply ops in sub-batches
    for (let j = 0; j < commentOps.length; j += BATCH_SIZE) {
      await prisma.$transaction(commentOps.slice(j, j + BATCH_SIZE), {
        maxWait: 30000,
        timeout: 60000,
      });
    }
    for (let j = 0; j < replyOps.length; j += BATCH_SIZE) {
      await prisma.$transaction(replyOps.slice(j, j + BATCH_SIZE), {
        maxWait: 30000,
        timeout: 60000,
      });
    }

    progress("Comments", commentCount, totalComments);
  }

  console.log(`  Replies imported: ${replyCount}`);
  return { commentCount, replyCount };
}

// ─── Step 3: Import members ──────────────────────────────────────────

async function importMembers(members: any[]): Promise<void> {
  console.log("\n[3/5] Importing members...");
  const total = members.length;
  let count = 0;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const chunk = members.slice(i, i + BATCH_SIZE);
    const ops = chunk.map((member: any) => {
      const userInfo = member._user_info || {};
      const joinTime = parseDateTime(member.joinTime);

      return prisma.member.upsert({
        where: { tinyid: member.tinyid },
        create: {
          tinyid: member.tinyid,
          nickname: sanitize(member.nickname),
          global_nickname: sanitize(userInfo.global_nickname),
          avatar_seq: sanitize(member.avatar_seq),
          role: sanitize(member.role),
          country: sanitize(userInfo.country),
          city: sanitize(userInfo.city),
          gender: sanitize(userInfo.gender),
          join_time: joinTime,
          join_time_human: sanitize(member.joinTime_human),
          status: "active",
        },
        update: {
          nickname: sanitize(member.nickname) ?? undefined,
          global_nickname: sanitize(userInfo.global_nickname) ?? undefined,
          avatar_seq: sanitize(member.avatar_seq) ?? undefined,
          role: sanitize(member.role) ?? undefined,
          country: sanitize(userInfo.country) ?? undefined,
          city: sanitize(userInfo.city) ?? undefined,
          gender: sanitize(userInfo.gender) ?? undefined,
          join_time: joinTime ?? undefined,
          join_time_human: sanitize(member.joinTime_human) ?? undefined,
          status: "active",
          left_at: null,
        },
      });
    });

    await prisma.$transaction(ops, { maxWait: 30000, timeout: 60000 });
    count += chunk.length;
    progress("Members", count, total);
  }
}

// ─── Step 4: Seed violation reasons ──────────────────────────────────

const BUILTIN_REASONS = [
  {
    name: "色情低俗",
    notification_template:
      "您在频道发布的{target_type}因涉及「色情低俗」已被处理。请遵守频道规则，共同维护良好的社区环境。",
    sort_order: 1,
  },
  {
    name: "广告营销",
    notification_template:
      "您在频道发布的{target_type}因涉及「广告营销」已被处理。频道禁止未经授权的商业推广行为。",
    sort_order: 2,
  },
  {
    name: "引战恶意",
    notification_template:
      "您在频道发布的{target_type}因涉及「引战恶意」已被处理。请友善交流，避免引战和人身攻击。",
    sort_order: 3,
  },
  {
    name: "水贴刷屏",
    notification_template:
      "您在频道发布的{target_type}因涉及「水贴刷屏」已被处理。请避免重复发布无意义内容。",
    sort_order: 4,
  },
  {
    name: "侵权搬运",
    notification_template:
      "您在频道发布的{target_type}因涉及「侵权搬运」已被处理。请尊重原创，转载需注明出处并获得授权。",
    sort_order: 5,
  },
];

async function seedViolationReasons(): Promise<void> {
  console.log("\n[4/5] Seeding violation reasons...");

  for (const reason of BUILTIN_REASONS) {
    await prisma.violationReason.upsert({
      where: { name: reason.name },
      create: {
        name: reason.name,
        is_builtin: true,
        notification_template: reason.notification_template,
        sort_order: reason.sort_order,
      },
      update: {
        // Don't overwrite existing customizations
        is_builtin: true,
      },
    });
    console.log(`  Seeded: ${reason.name}`);
  }
}

// ─── Step 5: Create default admin ────────────────────────────────────

async function createDefaultAdmin(): Promise<void> {
  console.log("\n[5/5] Creating default admin user...");

  const existing = await prisma.platformUser.findUnique({
    where: { username: "admin" },
  });

  if (existing) {
    console.log("  Admin user already exists, skipping.");
    return;
  }

  const password = await bcrypt.hash("admin123", 12);

  await prisma.platformUser.create({
    data: {
      username: "admin",
      password,
      display_name: "管理员",
      role: "admin",
    },
  });

  console.log("  Created admin user (username: admin, password: admin123)");
  console.log("  ⚠  Please change the default password after first login!");
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startTime = Date.now();

  console.log("=".repeat(60));
  console.log("  Guild Platform — Data Migration Script");
  console.log("=".repeat(60));
  console.log(`Output dir: ${OUTPUT_DIR}`);

  // Verify files exist
  if (!fs.existsSync(MAIN_JSON)) {
    console.error(`\nError: Main JSON not found at ${MAIN_JSON}`);
    process.exit(1);
  }

  // Load main JSON
  console.log("\nLoading main JSON (this may take a moment for large files)...");
  const mainData = JSON.parse(fs.readFileSync(MAIN_JSON, "utf-8"));
  const feeds: any[] = mainData.feeds || [];
  const members: any[] = mainData.members || [];
  console.log(`  Feeds: ${feeds.length}, Members: ${members.length}`);

  // Load detail JSON
  let detailMap: Record<string, any> = {};
  if (fs.existsSync(DETAIL_JSON)) {
    console.log("Loading detail JSON...");
    detailMap = JSON.parse(fs.readFileSync(DETAIL_JSON, "utf-8"));
    console.log(`  Details: ${Object.keys(detailMap).length}`);
  } else {
    console.log("Detail JSON not found, skipping.");
  }

  // Load comments JSON
  let commentsMap: Record<string, any[]> = {};
  if (fs.existsSync(COMMENTS_JSON)) {
    console.log("Loading comments JSON (this may take a moment)...");
    commentsMap = JSON.parse(fs.readFileSync(COMMENTS_JSON, "utf-8"));
    let totalComments = 0;
    for (const k of Object.keys(commentsMap)) {
      if (Array.isArray(commentsMap[k])) totalComments += commentsMap[k].length;
    }
    console.log(`  Feeds with comments: ${Object.keys(commentsMap).length}, Total comments: ${totalComments}`);
  } else {
    console.log("Comments JSON not found, skipping.");
  }

  // Execute migration steps
  try {
    await importFeeds(feeds, detailMap);

    if (Object.keys(commentsMap).length > 0) {
      const { commentCount, replyCount } = await importComments(commentsMap);
      console.log(`  Total: ${commentCount} comments, ${replyCount} replies`);
    }

    await importMembers(members);
    await seedViolationReasons();
    await createDefaultAdmin();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log("\n" + "=".repeat(60));
    console.log(`  Migration complete in ${elapsed}s`);
    console.log("=".repeat(60));
  } catch (err) {
    console.error("\nMigration failed:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
