import { prisma } from "@/lib/db";
import { crawlEvents } from "@/lib/events";
import {
  getGuildFeeds,
  getFeedComments,
  getFeedDetail,
  getNextPageReplies,
  deletePost,
  movePost,
} from "@/lib/cli/feed";
import { getGuildMembers } from "@/lib/cli/member";
import { getRateLimitStats, resetRateLimitStats } from "@/lib/cli/executor";
import fs from "fs";
import path from "path";

const GUILD_ID = process.env.GUILD_ID || "";

// ─── Cancellation support ────────────────────────────────────────────

/**
 * Thrown when a crawl is cancelled via AbortSignal.
 * Caller (scheduler) catches this and marks the task as 'cancelled'.
 */
export class CrawlCancelledError extends Error {
  constructor(taskId: bigint) {
    super(`Crawl task #${taskId} was cancelled`);
    this.name = "CrawlCancelledError";
  }
}

/**
 * Check abort signal at cooperative cancellation points (loop tops).
 * Throws CrawlCancelledError if aborted, so the crawl unwinds quickly.
 */
function checkAbort(signal: AbortSignal | undefined, taskId: bigint): void {
  if (signal?.aborted) {
    throw new CrawlCancelledError(taskId);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Parse a "YYYY-MM-DD HH:mm:ss", Unix number, or numeric string timestamp into a Date */
function parseDateTime(
  raw: string | number | undefined | null
): Date | null {
  if (!raw) return null;
  if (typeof raw === "number") return new Date(raw * 1000);
  // Handle numeric strings like "1780050984" (Unix timestamps as strings)
  if (typeof raw === "string" && /^\d+$/.test(raw)) {
    return new Date(parseInt(raw, 10) * 1000);
  }
  // Handle "YYYY-MM-DD HH:mm:ss" format
  const d = new Date(raw.replace(" ", "T") + "+08:00");
  return isNaN(d.getTime()) ? null : d;
}

/** Safe BigInt conversion */
function toBigInt(v: string | number | undefined | null): bigint | null {
  if (v === undefined || v === null || v === "") return null;
  try {
    return BigInt(v);
  } catch {
    return null;
  }
}

/** Log with task context */
function log(taskId: bigint, msg: string): void {
  console.log(`[Crawler][Task ${taskId}] ${msg}`);
}

/** Update the crawl_task stats column in DB */
async function updateTaskStats(
  taskId: bigint,
  stats: Record<string, unknown>
): Promise<void> {
  await prisma.crawlTask.update({
    where: { id: taskId },
    data: { stats: stats as any },
  });
  crawlEvents.emit("update", { taskId: String(taskId), stats });
}

/** Update task status */
async function updateTaskStatus(
  taskId: bigint,
  status: string,
  errorLog?: string
): Promise<void> {
  await prisma.crawlTask.update({
    where: { id: taskId },
    data: {
      status,
      finished_at: status === "completed" || status === "failed" ? new Date() : undefined,
      error_log: errorLog,
    },
  });
  crawlEvents.emit("status", { taskId: String(taskId), status, errorLog });
}

/** Extract text content from a comment/reply content object */
function extractContentText(content: any): string | null {
  if (!content) return null;
  if (typeof content === "string") return content;
  if (typeof content === "object" && content.text) return content.text;
  return null;
}

// ─── Upsert helpers (batch-safe) ──────────────────────────────────────

async function upsertFeed(feed: any, detail?: any, channelNameToId?: Map<string, string>): Promise<void> {
  const createTime = parseDateTime(feed.create_time);
  const createTimeRaw = toBigInt(feed.create_time_raw);

  const resolveChannelId = (): string | null | undefined => {
    if (feed.channel_id) return String(feed.channel_id);
    if (feed.channel_name && channelNameToId?.has(feed.channel_name))
      return channelNameToId.get(feed.channel_name);
    return null;
  };

  await prisma.feed.upsert({
    where: { feed_id: feed.feed_id },
    create: {
      feed_id: feed.feed_id,
      author: feed.author ?? null,
      author_id: feed.author_id ?? null,
      channel_name: feed.channel_name ?? null,
      channel_id: resolveChannelId(),
      title: feed.title ?? null,
      content: detail?.content ?? null,
      content_snippet: feed.content_snippet ?? null,
      share_url: detail?.share_url ?? null,
      images: feed.images ?? null,
      prefer_count: feed.prefer_count ?? 0,
      comment_count: feed.comment_count ?? 0,
      feed_type: detail?.feed_type ?? feed.feed_type ?? null,
      create_time: createTime,
      create_time_raw: createTimeRaw,
      status: "active",
    },
    update: {
      author: feed.author ?? undefined,
      author_id: feed.author_id ?? undefined,
      channel_name: feed.channel_name ?? undefined,
      channel_id: resolveChannelId(),
      title: feed.title ?? undefined,
      content: detail?.content ?? undefined,
      content_snippet: feed.content_snippet ?? undefined,
      share_url: detail?.share_url ?? undefined,
      images: feed.images ?? undefined,
      prefer_count: feed.prefer_count != null ? Number(feed.prefer_count) : undefined,
      comment_count: feed.comment_count != null ? Number(feed.comment_count) : undefined,
      feed_type: detail?.feed_type ?? feed.feed_type ?? undefined,
      create_time: createTime ?? undefined,
      create_time_raw: createTimeRaw ?? undefined,
      // If previously marked deleted, reactivate
      status: "active",
      deleted_at: null,
    },
  });
}

async function upsertComment(comment: any, feedId: string): Promise<void> {
  const createTime = parseDateTime(comment.create_time);
  const createTimeRaw = toBigInt(comment.create_time_raw);
  const contentText = extractContentText(comment.content);

  await prisma.comment.upsert({
    where: { comment_id: comment.comment_id },
    create: {
      comment_id: comment.comment_id,
      feed_id: feedId,
      author: comment.author ?? null,
      author_id: comment.author_id ?? null,
      content: comment.content ?? null,
      content_text: contentText ?? comment.content_text ?? null,
      like_count: comment.like_count ?? 0,
      reply_count: comment.reply_count ?? 0,
      comment_index: comment.comment_index ?? null,
      create_time: createTime,
      create_time_raw: createTimeRaw,
      status: "active",
    },
    update: {
      author: comment.author ?? undefined,
      author_id: comment.author_id ?? undefined,
      content: comment.content ?? undefined,
      content_text: contentText ?? comment.content_text ?? undefined,
      like_count: comment.like_count ?? undefined,
      reply_count: comment.reply_count ?? undefined,
      comment_index: comment.comment_index ?? undefined,
      create_time: createTime ?? undefined,
      create_time_raw: createTimeRaw ?? undefined,
      status: "active",
      deleted_at: null,
    },
  });
}

async function upsertReply(
  reply: any,
  commentId: string,
  feedId: string
): Promise<void> {
  const createTime = parseDateTime(reply.create_time);
  const createTimeRaw = toBigInt(reply.create_time_raw);
  const contentText = extractContentText(reply.content);

  await prisma.reply.upsert({
    where: { reply_id: reply.reply_id },
    create: {
      reply_id: reply.reply_id,
      comment_id: commentId,
      feed_id: feedId,
      author: reply.author ?? null,
      author_id: reply.author_id ?? null,
      content: reply.content ?? null,
      content_text: contentText ?? null,
      target_reply_id: reply.target_reply_id ?? null,
      target_user: reply.target_user ?? null,
      target_user_id: reply.target_user_id ?? null,
      create_time: createTime,
      create_time_raw: createTimeRaw,
      status: "active",
    },
    update: {
      author: reply.author ?? undefined,
      author_id: reply.author_id ?? undefined,
      content: reply.content ?? undefined,
      content_text: contentText ?? undefined,
      target_reply_id: reply.target_reply_id ?? undefined,
      target_user: reply.target_user ?? undefined,
      target_user_id: reply.target_user_id ?? undefined,
      create_time: createTime ?? undefined,
      create_time_raw: createTimeRaw ?? undefined,
      status: "active",
      deleted_at: null,
    },
  });
}

/**
 * Fetch all nested replies for a comment that has has_more_replies=true.
 * Paginates through getNextPageReplies using attach_info until no more pages.
 * Matches Python scraper's _fetch_more_replies logic.
 */
async function fetchAllRepliesForComment(
  feedId: string,
  comment: any,
  guildId: string,
  channelId: string,
  onReply: (reply: any) => Promise<void>,
  adminIdentityId?: number
): Promise<number> {
  if (!comment.has_more_replies) return 0;

  let attachInfo: string = comment.attach_info ?? "";
  if (!attachInfo) return 0;

  let fetched = 0;
  let pages = 0;
  const MAX_PAGES = 20;

  while (attachInfo && pages < MAX_PAGES) {
    pages++;
    try {
      const result = await getNextPageReplies(
        feedId,
        comment.comment_id,
        guildId,
        channelId,
        attachInfo,
        adminIdentityId
      );

      if (result.replies && result.replies.length > 0) {
        for (const reply of result.replies) {
          try {
            await onReply(reply);
            fetched++;
          } catch (err) {
            console.error(`[Crawler] Failed to upsert sub-reply ${reply.reply_id}:`, err);
          }
        }
      }

      if (!result.hasMore || !result.nextAttachInfo) break;
      attachInfo = result.nextAttachInfo;
    } catch (err) {
      console.error(
        `[Crawler] Failed to fetch next-page-replies for comment ${comment.comment_id}:`,
        err
      );
      break;
    }
  }

  return fetched;
}

/**
 * Normalize member object from CLI.
 * CLI `manage get-guild-member-list` may return Chinese keys:
 *   加入时间 → joinTime,  昵称 → nickname
 */
function normalizeMember(m: any): any {
  return {
    tinyid: m.tinyid,
    nickname: m.nickname ?? m["昵称"] ?? null,
    role: m.role ?? null,
    joinTime: m.joinTime ?? m["加入时间"] ?? null,
    joinTime_human: m.joinTime_human ?? null,
    _user_info: m._user_info || {},
  };
}

async function upsertMember(rawMember: any): Promise<void> {
  const member = normalizeMember(rawMember);
  const userInfo = member._user_info || {};
  const joinTime = parseDateTime(member.joinTime);

  await prisma.member.upsert({
    where: { tinyid: member.tinyid },
    create: {
      tinyid: member.tinyid,
      nickname: member.nickname ?? null,
      global_nickname: userInfo.global_nickname ?? null,
      role: member.role ?? null,
      country: userInfo.country || null,
      city: userInfo.city || null,
      gender: userInfo.gender || null,
      join_time: joinTime,
      join_time_human: member.joinTime_human ?? null,
      status: "active",
    },
    update: {
      nickname: member.nickname ?? undefined,
      global_nickname: userInfo.global_nickname ?? undefined,
      role: member.role ?? undefined,
      country: userInfo.country || undefined,
      city: userInfo.city || undefined,
      gender: userInfo.gender || undefined,
      join_time: joinTime ?? undefined,
      join_time_human: member.joinTime_human ?? undefined,
      status: "active",
      left_at: null,
    },
  });
}

// ─── Full Crawl ───────────────────────────────────────────────────────

/**
 * Runs a full crawl: feeds → comments → details → members.
 * Uses upserts so existing data is never deleted.
 * Updates crawl_task stats periodically.
 */
export async function runFullCrawl(
  guildId: string,
  taskId: bigint,
  adminIdentityId?: number,
  signal?: AbortSignal
): Promise<void> {
  const gid = guildId || GUILD_ID;
  log(taskId, `Starting full crawl for guild ${gid}`);

  await prisma.crawlTask.update({
    where: { id: taskId },
    data: { status: "running", started_at: new Date() },
  });

  const stats = {
    startedISO: new Date().toISOString(),
    wallTimeSec: 0,
    rateLimits: {} as Record<string, number>,
    feedsTotal: 0,
    commentsTotal: 0,
    detailsTotal: 0,
    membersTotal: 0,
    errors: 0,
    timing: {} as Record<string, { started: number; startedISO: string; ended?: number; endedISO?: string; calls: number; lastLogTime: number; lastLogCount: number; current?: number; total?: number }>,
  };

  const recordPhaseStart = (phase: string) => {
    const now = Date.now();
    stats.timing[phase] = { started: now, startedISO: new Date(now).toISOString(), calls: 0, lastLogTime: now, lastLogCount: 0 };
  };
  const recordPhaseCall = (phase: string, current?: number) => {
    const t = stats.timing[phase];
    if (t) { t.calls++; if (current != null) t.current = current; }
  };
  const recordPhaseTotal = (phase: string, total: number) => {
    const t = stats.timing[phase];
    if (t) t.total = total;
  };
  const logPhaseSpeed = (phase: string, itemCount: number) => {
    const t = stats.timing[phase];
    if (!t) return;
    const now = Date.now();
    const elapsed = (now - t.lastLogTime) / 1000;
    if (elapsed < 5) return; // skip if <5s since last log
    const calls = t.calls - t.lastLogCount;
    const cpm = calls / elapsed * 60;
    log(taskId, `[${phase}] ${itemCount} items, ${calls} calls in ${elapsed.toFixed(0)}s → ${cpm.toFixed(0)} calls/min`);
    t.lastLogTime = now;
    t.lastLogCount = t.calls;
  };
  const recordPhaseEnd = (phase: string) => {
    const t = stats.timing[phase];
    if (t) { t.ended = Date.now(); t.endedISO = new Date().toISOString(); }
    const dur = t ? (t.ended! - t.started) / 1000 : 0;
    log(taskId, `[${phase}] done: ${t?.calls || 0} calls in ${dur.toFixed(0)}s (${(t?.calls || 0) / dur * 60 | 0} calls/min)`);
  };

  try {
    // ── Estimate totals from last successful crawl ──
    let estFeeds = 0, estMembers = 0;
    try {
      const [lastFull, lastMember] = await Promise.all([
        prisma.crawlTask.findFirst({ where: { task_type: 'full', status: 'completed' }, orderBy: { id: 'desc' }, select: { stats: true } }),
        prisma.crawlTask.findFirst({ where: { task_type: 'members', status: 'completed' }, orderBy: { id: 'desc' }, select: { stats: true } }),
      ]);
      estFeeds = ((lastFull?.stats as any)?.feedsTotal) || 36000;
      estMembers = ((lastMember?.stats as any)?.membersTotal) || 2600;
    } catch { /* best-effort */ }

    // ── Phase 1: Feeds ──
    log(taskId, "Phase 1: Fetching feeds...");
    recordPhaseStart("feeds");
    recordPhaseTotal("feeds", estFeeds);
    let cursor = "";
    let pageCount = 0;
    const allFeedIds: string[] = [];
    const feedChannelMap: Record<string, string> = {}; // feed_id → channel_id

    // Build channel_name → channel_id map (getGuildFeeds only returns channel_name)
    const channelNameToId = new Map<string, string>();
    {
      const channels = await prisma.feed.findMany({
        where: { channel_id: { not: null }, channel_name: { not: null } },
        select: { channel_id: true, channel_name: true },
        distinct: ['channel_name'],
      });
      for (const ch of channels) {
        if (ch.channel_id && ch.channel_name) {
          channelNameToId.set(ch.channel_name, ch.channel_id);
        }
      }
      log(taskId, `Channel map: ${channelNameToId.size} entries`);
    }

    while (true) {
      checkAbort(signal, taskId);
      const page = await getGuildFeeds(gid, cursor, 500, 2, adminIdentityId);
      if (!page.feeds || page.feeds.length === 0) break;

      for (const feed of page.feeds) {
        try {
          await upsertFeed(feed, undefined, channelNameToId);
          allFeedIds.push(feed.feed_id);
          if (feed.channel_id) {
            feedChannelMap[feed.feed_id] = String(feed.channel_id);
          }
          recordPhaseCall("feeds", stats.feedsTotal + 1);
          stats.feedsTotal++;
        } catch (err) {
          stats.errors++;
          console.error(`[Crawler] Failed to upsert feed ${feed.feed_id}:`, err);
        }
      }

      pageCount++;
        await updateTaskStats(taskId, { ...stats, phase: "feeds" });
        if (pageCount % 10 === 0) {
          log(taskId, `Feeds: ${stats.feedsTotal} processed (page ${pageCount})`);
          logPhaseSpeed("feeds", stats.feedsTotal);
        }
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    log(taskId, `Phase 1 complete: ${stats.feedsTotal} feeds in ${pageCount} pages`);
    recordPhaseEnd("feeds");

    // ── Phase 2+3+4: Comments, Details, Members (parallel — different CLI commands, independent rate limits) ──
    log(taskId, "Phase 2+3+4: Launching comments, details, and members in parallel...");

    await Promise.all([
      // Phase 2: Comments
      (async () => {
    recordPhaseStart("comments");
    log(taskId, "Phase 2: Fetching comments...");
    recordPhaseTotal("comments", allFeedIds.length);
    for (let i = 0; i < allFeedIds.length; i++) {
      checkAbort(signal, taskId);
      const feedId = allFeedIds[i];
      try {
        let commentCursor = "";
        let commentPages = 0;
        while (true) {
          const commentPage = await getFeedComments(feedId, gid, commentCursor, adminIdentityId);
          if (!commentPage.comments || commentPage.comments.length === 0) break;

          for (const comment of commentPage.comments) {
            await upsertComment(comment, feedId);
            recordPhaseCall("comments", i + 1);
            stats.commentsTotal++;

            // Process replies nested in comments (initial batch from API)
            if (comment.replies_preview && Array.isArray(comment.replies_preview)) {
              for (const reply of comment.replies_preview) {
                try {
                  await upsertReply(reply, comment.comment_id, feedId);
                } catch (err) {
                  stats.errors++;
                  console.error(`[Crawler] Failed to upsert reply ${reply.reply_id}:`, err);
                }
              }
            }

            // Fetch remaining sub-replies via pagination if has_more_replies
            if (comment.has_more_replies) {
              const channelId = feedChannelMap[feedId];
              if (channelId) {
                await fetchAllRepliesForComment(
                  feedId,
                  comment,
                  gid,
                  channelId,
                  async (reply) => {
                    recordPhaseCall("comments", i + 1);
                    await upsertReply(reply, comment.comment_id, feedId);
                    stats.commentsTotal++;
                  },
                  adminIdentityId
                );
              }
            }
          }

          commentPages++;
          if (!commentPage.hasMore || !commentPage.nextCursor) break;
          commentCursor = commentPage.nextCursor;
        }
      } catch (err) {
        stats.errors++;
        console.error(`[Crawler] Failed to fetch comments for feed ${feedId}:`, err);
      }

      await updateTaskStats(taskId, { ...stats, phase: "comments" });
      if ((i + 1) % 50 === 0) {
        log(taskId, `Comments: ${stats.commentsTotal} from ${i + 1}/${allFeedIds.length} feeds`);
        logPhaseSpeed("comments", i + 1);
      }
    }

    log(taskId, `Phase 2 complete: ${stats.commentsTotal} comments`);
    recordPhaseEnd("comments");
      })(),

      // Phase 3: Details (parallel workers)
      (async () => {
    const DETAIL_WORKERS = 3;
    recordPhaseStart("details");
    log(taskId, `Phase 3: Fetching feed details with ${DETAIL_WORKERS} parallel workers...`);
    recordPhaseTotal("details", allFeedIds.length);

    // Interleave feeds across workers for even identity distribution
    const detailChunks: string[][] = Array.from({ length: DETAIL_WORKERS }, () => []);
    allFeedIds.forEach((id, i) => detailChunks[i % DETAIL_WORKERS].push(id));

    await Promise.all(detailChunks.map((chunk) => (async () => {
      for (const feedId of chunk) {
        try {
          const detail = await getFeedDetail(feedId, gid, adminIdentityId);
          if (detail && detail.content) {
            await prisma.feed.update({
              where: { feed_id: feedId },
              data: {
                content: detail.content,
                share_url: detail.share_url || undefined,
                feed_type: detail.feed_type || undefined,
              },
            });
            stats.detailsTotal++;
            recordPhaseCall("details", stats.detailsTotal);
          }
        } catch (err) {
          stats.errors++;
          console.error(`[Crawler] Failed to fetch detail for feed ${feedId}:`, err);
        }
        await updateTaskStats(taskId, { ...stats, phase: "details" });
        if (stats.detailsTotal % 50 === 0) {
          log(taskId, `Details: ${stats.detailsTotal}/${allFeedIds.length}`);
          logPhaseSpeed("details", stats.detailsTotal);
        }
      }
    })()));

    log(taskId, `Phase 3 complete: ${stats.detailsTotal} details`);
    recordPhaseEnd("details");
      })(),

      // Phase 4: Members
      (async () => {
    recordPhaseStart("members");
    recordPhaseTotal("members", estMembers);
    log(taskId, "Phase 4: Fetching members...");
    let memberCursor = "";
    let memberPages = 0;
    while (true) {
      const memberPage = await getGuildMembers(gid, memberCursor, 100, adminIdentityId);
      if (!memberPage.members || memberPage.members.length === 0) break;

      for (const member of memberPage.members) {
        try {
          await upsertMember(member);
          recordPhaseCall("members", stats.membersTotal + 1);
          stats.membersTotal++;
          await updateTaskStats(taskId, { ...stats, phase: "members" });
        } catch (err) {
          stats.errors++;
          console.error(`[Crawler] Failed to upsert member ${member.tinyid}:`, err);
        }
      }

      memberPages++;
      if (memberPages % 5 === 0) {
        log(taskId, `Members: ${stats.membersTotal} (page ${memberPages})`);
        logPhaseSpeed("members", stats.membersTotal);
      }

      if (!memberPage.nextPos) break;
      memberCursor = memberPage.nextPos;
    }

    log(taskId, `Phase 4 complete: ${stats.membersTotal} members`);
    recordPhaseEnd("members");
      })(),
    ]);

    log(taskId, `Phases 2+3+4 complete`);

    // ── Detailed timing report ──
    const rlStats = getRateLimitStats();
    resetRateLimitStats();
    stats.rateLimits = rlStats;
    const total153 = Object.values(rlStats).reduce((a, b) => a + b, 0);

    let overallStart = Infinity, overallEnd = 0;
    for (const t of Object.values(stats.timing)) {
      if (t.started < overallStart) overallStart = t.started;
      if (t.ended && t.ended > overallEnd) overallEnd = t.ended;
    }
    stats.wallTimeSec = Math.round((overallEnd - overallStart) / 1000);
    const totalWall = (overallEnd - overallStart) / 1000;

    log(taskId, `\n╔══════════════════════════════════════════════════╗`);
    log(taskId, `║          全量爬取速度报告                         ║`);
    log(taskId, `╠══════════════════════════════════════════════════╣`);
    log(taskId, `║ 总耗时:     ${totalWall.toFixed(0)}s (${(totalWall / 3600).toFixed(1)}h)`);
    log(taskId, `║ 153 限流:   ${total153} 次`);
    log(taskId, `╠══════════════════════╤═══════╤════════╤══════════╣`);
    log(taskId, `║ 阶段                  │ 调用次数  │ 耗时(s) │ avg(ms)   ║`);
    log(taskId, `╟──────────────────────┼───────┼────────┼──────────╢`);
    for (const [phase, t] of Object.entries(stats.timing)) {
      const dur = ((t.ended || Date.now()) - t.started) / 1000;
      const avgMs = t.calls > 0 ? (dur * 1000 / t.calls).toFixed(0) : '-';
      const label = { feeds: '拉帖子列表', comments: '拉评论(+回复)', details: '拉帖子详情', members: '拉成员' }[phase] || phase;
      const startTime = t.startedISO?.slice(11, 19) || '-';
      const endTime = t.endedISO?.slice(11, 19) || '-';
      log(taskId, `║ ${startTime}→${endTime} ${label.padEnd(12)} │ ${String(t.calls).padStart(5)} │ ${dur.toFixed(0).padStart(6)} │ ${String(avgMs).padStart(6)}ms ║`);
    }
    log(taskId, `╚══════════════════════╧═══════╧════════╧══════════╝`);
    if (rlStats && total153 > 0) {
      log(taskId, `153 breakdown: ${Object.entries(rlStats).map(([k, v]) => `${k}=${v}x`).join(', ')}`);
    }

    // Final stats
    await updateTaskStats(taskId, { ...stats, phase: "completed" });
    await updateTaskStatus(taskId, "completed");
    log(taskId, `Full crawl completed. Stats: ${JSON.stringify(stats)}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Crawler] Full crawl failed:`, err);
    await updateTaskStats(taskId, { ...stats, phase: "failed" });
    await updateTaskStatus(taskId, "failed", errMsg);
    throw err;
  }
}

// ─── Update (Incremental) Crawl ──────────────────────────────────────

/**
 * Runs an incremental update crawl.
 * - Scans feeds, detects new posts and comment_count changes.
 * - Early terminates after 2 consecutive pages with no changes.
 * - Fetches comments for changed feeds using 3 parallel workers.
 * - Runs deletion detection after completion.
 */
export async function runUpdateCrawl(
  guildId: string,
  taskId: bigint,
  adminIdentityId?: number,
  signal?: AbortSignal
): Promise<void> {
  const gid = guildId || GUILD_ID;
  log(taskId, `Starting update crawl for guild ${gid}`);

  await prisma.crawlTask.update({
    where: { id: taskId },
    data: { status: "running", started_at: new Date() },
  });

  const stats: Record<string, any> = {
    newFeeds: 0,
    updatedFeeds: 0,
    commentsAdded: 0,
    cleanPages: 0,
    errors: 0,
    autoActions: 0,
    timing: {} as Record<string, any>,
  };

  const recordPhaseStart = (phase: string) => {
    const now = Date.now();
    stats.timing[phase] = { started: now, startedISO: new Date(now).toISOString(), calls: 0, lastLogTime: now, lastLogCount: 0 };
  };
  const recordPhaseCall = (phase: string, current?: number) => {
    const t = stats.timing[phase];
    if (t) { t.calls++; if (current != null) t.current = current; }
  };
  const recordPhaseTotal = (phase: string, total: number) => {
    const t = stats.timing[phase];
    if (t) t.total = total;
  };
  const recordPhaseEnd = (phase: string) => {
    const t = stats.timing[phase];
    if (t) { t.ended = Date.now(); t.endedISO = new Date().toISOString(); }
  };

  // Load enabled auto-rules for real-time enforcement during crawl
  const autoRules = await prisma.autoRule.findMany({
    where: { enabled: true },
  });
  if (autoRules.length > 0) {
    log(taskId, `Loaded ${autoRules.length} enabled auto-rule(s): ${autoRules.map(r => r.name).join(', ')}`);
  }

  // Build channel_name → channel_id map for resolving batch-fetched feeds
  // (getGuildFeeds only returns channel_name, not channel_id)
  let channelNameToId: Map<string, string> = new Map();
  {
    const channels = await prisma.feed.findMany({
      where: { channel_id: { not: null }, channel_name: { not: null } },
      select: { channel_id: true, channel_name: true },
      distinct: ['channel_name'],
    });
    for (const ch of channels) {
      if (ch.channel_id && ch.channel_name) {
        channelNameToId.set(ch.channel_name, ch.channel_id);
      }
    }
    log(taskId, `Channel map: ${channelNameToId.size} entries`);
  }

  try {
    // ── Phase 1: Scan feeds for changes ──
    log(taskId, "Phase 1: Scanning feeds for changes...");
    const MAX_SCAN_PAGES = 6; // 增量最多扫 6 页 (3000 条)，对齐 Python 原版
    recordPhaseStart("scan");
    recordPhaseTotal("scan", MAX_SCAN_PAGES);
    let cursor = "";
    let consecutiveCleanPages = 0;
    let pageCount = 0;
    const changedFeedIds: string[] = [];
    const allSeenFeedIds = new Set<string>();
    const feedChannelMap: Record<string, string> = {}; // feed_id → channel_id
    let oldestSeenTime: number | null = null; // 扫描范围的最老帖子时间戳

    while (consecutiveCleanPages < 2 && pageCount < MAX_SCAN_PAGES) {
      checkAbort(signal, taskId);
      pageCount++;
      recordPhaseCall("scan", pageCount);
      await updateTaskStats(taskId, { ...stats, phase: "scan" });
      const page = await getGuildFeeds(gid, cursor, 500, 2, adminIdentityId);

      let pageHasChanges = false;

      for (const feed of page.feeds) {
        allSeenFeedIds.add(feed.feed_id);
        if (feed.channel_id) {
          feedChannelMap[feed.feed_id] = String(feed.channel_id);
        }

        // 跟踪扫描范围的最老时间戳（用于限定删除检测范围）
        const feedTime = feed.create_time_raw;
        if (typeof feedTime === "number" && (oldestSeenTime === null || feedTime < oldestSeenTime)) {
          oldestSeenTime = feedTime;
        }
      }

      // Batch-fetch existing feeds to avoid N+1 queries
      const pageFeedIds = page.feeds.map((f: any) => f.feed_id);
      const existingFeeds = await prisma.feed.findMany({
        where: { feed_id: { in: pageFeedIds } },
        select: { feed_id: true, comment_count: true, status: true, channel_name: true, title: true, images: true },
      });
      const existingMap = new Map(existingFeeds.map((f) => [f.feed_id, f]));

      for (const feed of page.feeds) {
          const existing = existingMap.get(feed.feed_id);

          if (!existing) {
            // New feed
            await upsertFeed(feed, undefined, channelNameToId);
            stats.newFeeds++;
            pageHasChanges = true;

            // ── Auto-rule enforcement: check if this feed should be auto-handled ──
            if (autoRules.length > 0 && feed.author_id) {
              const matchedRule = autoRules.find(
                (r) => r.target_author_id === feed.author_id
              );
              if (matchedRule) {
                const feedChannelId = feed.channel_id
                  ? String(feed.channel_id)
                  : channelNameToId.get(feed.channel_name) || "";
                const feedCreateTime = feed.create_time_raw ? String(feed.create_time_raw) : "";

                try {
                  let actionOk = false;
                  if (matchedRule.action === "delete") {
                    actionOk = await deletePost(
                      gid,
                      feed.feed_id,
                      feedChannelId,
                      feedCreateTime,
                      adminIdentityId
                    );
                    if (actionOk) {
                      await prisma.feed.update({
                        where: { feed_id: feed.feed_id },
                        data: { status: "deleted", deleted_at: new Date() },
                      });
                    }
                  } else if (matchedRule.action === "move" && matchedRule.target_channel_id) {
                    actionOk = await movePost(
                      gid,
                      feed.feed_id,
                      matchedRule.target_channel_id,
                      feedChannelId,
                      adminIdentityId
                    );
                    if (actionOk) {
                      await prisma.feed.update({
                        where: { feed_id: feed.feed_id },
                        data: { status: "moved" },
                      });
                    }
                  }

                  if (actionOk) {
                    stats.autoActions++;
                    log(
                      taskId,
                      `[AutoRule] ${matchedRule.name}: ${matchedRule.action} feed ${feed.feed_id} (author: ${feed.author ?? feed.author_id})`
                    );
                    // Skip comment fetching for this feed — it's been handled
                    continue;
                  }
                } catch (err) {
                  stats.errors++;
                  console.error(
                    `[AutoRule] Failed to execute ${matchedRule.action} on feed ${feed.feed_id}:`,
                    err
                  );
                }
              }
            }

            changedFeedIds.push(feed.feed_id);
          } else if (existing.status === "deleted") {
            // Was marked deleted but now visible again — re-activate and fetch comments
            await upsertFeed(feed, undefined, channelNameToId);
            stats.updatedFeeds++;
            changedFeedIds.push(feed.feed_id);
            pageHasChanges = true;
          } else {
            // ── Change detection: comment_count, channel_name, title, images ──
            let hasChanges = false;
            const updateData: Record<string, any> = {};

            // Comment count
            if (
              feed.comment_count !== undefined &&
              feed.comment_count !== null &&
              existing.comment_count !== Number(feed.comment_count)
            ) {
              updateData.comment_count = Number(feed.comment_count);
              hasChanges = true;
            }

            // Channel name
            if (
              feed.channel_name !== undefined &&
              feed.channel_name !== null &&
              existing.channel_name !== feed.channel_name
            ) {
              updateData.channel_name = feed.channel_name;
              hasChanges = true;
            }

            // Title
            if (
              feed.title !== undefined &&
              feed.title !== null &&
              existing.title !== feed.title
            ) {
              updateData.title = feed.title;
              hasChanges = true;
            }

            // Images (compare as JSON arrays)
            const feedImages = Array.isArray(feed.images) ? feed.images : null;
            const existingImages = existing.images; // Json value
            const imagesEqual =
              feedImages === null && existingImages === null ? true
              : feedImages === null || existingImages === null ? false
              : JSON.stringify(feedImages) === JSON.stringify(existingImages);
            if (!imagesEqual) {
              updateData.images = feedImages;
              hasChanges = true;
            }

            if (hasChanges) {
              await prisma.feed.update({
                where: { feed_id: feed.feed_id },
                data: updateData,
              });
              stats.updatedFeeds++;
              changedFeedIds.push(feed.feed_id);
              pageHasChanges = true;
            }
          }
          // If feed.comment_count is undefined/null, skip the comparison entirely.
          // Otherwise missing fields would cause a perpetual false-positive loop:
          //   DB=5 ≠ (undefined ?? 0)=0 → changed → upsert skips field → DB stays 5 → loop
        }

      if (pageHasChanges) {
        consecutiveCleanPages = 0;
      } else {
        consecutiveCleanPages++;
        stats.cleanPages++;
      }

      log(
        taskId,
        `Feed scan (page ${pageCount}): ${stats.newFeeds} new, ${stats.updatedFeeds} updated, clean pages: ${consecutiveCleanPages}`
      );

      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    if (pageCount >= MAX_SCAN_PAGES) {
      log(taskId, `Scan hit max page limit (${MAX_SCAN_PAGES} pages), stopping early`);
    }

    log(
      taskId,
      `Phase 1 complete: ${stats.newFeeds} new feeds, ${stats.updatedFeeds} changed. Fetching comments for ${changedFeedIds.length} feeds.`
    );
    recordPhaseEnd("scan");
    // ── Phase 2: Fetch comments for changed feeds (single worker to avoid 153) ──
    if (changedFeedIds.length > 0) {
      log(taskId, "Phase 2: Fetching comments for changed feeds...");
      recordPhaseStart("comments");
    recordPhaseTotal("comments", changedFeedIds.length);
    const WORKER_COUNT = 1; // 单 worker 顺序执行，避免触发 153 限流
      recordPhaseTotal("comments", changedFeedIds.length);
      const chunks: string[][] = Array.from({ length: WORKER_COUNT }, () => []);
      changedFeedIds.forEach((id, i) => chunks[i % WORKER_COUNT].push(id));

      const workers = chunks.map(async (chunk, workerIdx) => {
        let feedIdx = 0;
        for (const feedId of chunk) {
          feedIdx++;
          recordPhaseCall("comments", feedIdx);
          await updateTaskStats(taskId, { ...stats, phase: "comments" });
          checkAbort(signal, taskId);
          try {
            let commentCursor = "";
            while (true) {
              checkAbort(signal, taskId);
              const commentPage = await getFeedComments(feedId, gid, commentCursor, adminIdentityId);
              if (!commentPage.comments || commentPage.comments.length === 0) break;

              for (const comment of commentPage.comments) {
                try {
                  await upsertComment(comment, feedId);
                  stats.commentsAdded++;

                  if (comment.replies_preview && Array.isArray(comment.replies_preview)) {
                    for (const reply of comment.replies_preview) {
                      try {
                        await upsertReply(reply, comment.comment_id, feedId);
                      } catch {
                        stats.errors++;
                      }
                    }
                  }

                  // Fetch remaining sub-replies via pagination if has_more_replies
                  if (comment.has_more_replies) {
                    const channelId = feedChannelMap[feedId];
                    if (channelId) {
                      await fetchAllRepliesForComment(
                        feedId,
                        comment,
                        gid,
                        channelId,
                        async (reply) => {
                          await upsertReply(reply, comment.comment_id, feedId);
                          stats.commentsAdded++;
                        },
                        adminIdentityId
                      );
                    }
                  }
                } catch {
                  stats.errors++;
                }
              }

              if (!commentPage.hasMore || !commentPage.nextCursor) break;
              commentCursor = commentPage.nextCursor;
            }
          } catch (err) {
            stats.errors++;
            console.error(`[Crawler][Worker ${workerIdx}] Failed comments for ${feedId}:`, err);
          }
        }
      });

      await Promise.all(workers);
      log(taskId, `Phase 2 complete: ${stats.commentsAdded} comments added`);
      recordPhaseEnd("comments");
    }

    // ── Phase 2.5: Fetch details for all changed feeds ──
    if (changedFeedIds.length > 0) {
      log(taskId, `Phase 2.5: Fetching details for ${changedFeedIds.length} changed feeds...`);
      let detailsFetched = 0;
      for (const feedId of changedFeedIds) {
        checkAbort(signal, taskId);
        try {
          const detail = await getFeedDetail(feedId, gid, adminIdentityId);
          if (detail && detail.content) {
            await prisma.feed.update({
              where: { feed_id: feedId },
              data: {
                content: detail.content,
                share_url: detail.share_url || undefined,
                feed_type: detail.feed_type || undefined,
              },
            });
            detailsFetched++;
          }
        } catch (err) {
          console.error(`[Crawl] Failed to fetch detail for ${feedId}:`, err);
        }
      }
      log(taskId, `Phase 2.5 complete: ${detailsFetched} details fetched/updated`);
    }

    // ── Phase 3: Deletion detection（仅限扫描范围内）──
    // 只检查 create_time_raw >= oldestSeenTime 的帖子，
    // 更老的帖子不在本次扫描范围，不做删除判断。
    if (oldestSeenTime !== null) {
      log(taskId, `Phase 3: Deletion detection (feeds after ${new Date(oldestSeenTime * 1000).toISOString()})...`);
      const deletions = await detectDeletions(gid, allSeenFeedIds, oldestSeenTime);
      stats["deletions"] = deletions;
      log(taskId, `Deletions detected: ${JSON.stringify(deletions)}`);
    } else {
      log(taskId, "Phase 3: Skipped (no feeds scanned)");
    }

    await updateTaskStats(taskId, { ...stats, phase: "completed" });
    await updateTaskStatus(taskId, "completed");
    log(taskId, `Update crawl completed. Stats: ${JSON.stringify(stats)}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Crawler] Update crawl failed:`, err);
    await updateTaskStats(taskId, { ...stats, phase: "failed" });
    await updateTaskStatus(taskId, "failed", errMsg);
    throw err;
  }
}

// ─── Member Crawl ─────────────────────────────────────────────────────

/**
 * Fetches all guild members and updates the database.
 */
export async function runMemberCrawl(
  guildId: string,
  taskId: bigint,
  adminIdentityId?: number,
  signal?: AbortSignal
): Promise<void> {
  const gid = guildId || GUILD_ID;
  log(taskId, `Starting member crawl for guild ${gid}`);

  await prisma.crawlTask.update({
    where: { id: taskId },
    data: { status: "running", started_at: new Date() },
  });

  const stats: Record<string, any> = { membersTotal: 0, newMembers: 0, errors: 0, timing: {} as Record<string, any> };

  const recordPhaseStart = (phase: string) => {
    const now = Date.now();
    stats.timing[phase] = { started: now, startedISO: new Date(now).toISOString(), calls: 0, lastLogTime: now, lastLogCount: 0 };
  };
  const recordPhaseCall = (phase: string, current?: number) => {
    const t = stats.timing[phase];
    if (t) { t.calls++; if (current != null) t.current = current; }
  };
  const recordPhaseTotal = (phase: string, total: number) => {
    const t = stats.timing[phase];
    if (t) t.total = total;
  };
  const recordPhaseEnd = (phase: string) => {
    const t = stats.timing[phase];
    if (t) { t.ended = Date.now(); t.endedISO = new Date().toISOString(); }
  };

  try {
    // Estimate total from last successful member crawl
    let estMembers = 2600;
    try {
      const last = await prisma.crawlTask.findFirst({ where: { task_type: 'members', status: 'completed' }, orderBy: { id: 'desc' }, select: { stats: true } });
      estMembers = ((last?.stats as any)?.membersTotal) || 2600;
    } catch { /* best-effort */ }

    recordPhaseStart("members");
    recordPhaseTotal("members", estMembers);
    let cursor = "";
    let pageCount = 0;
    const seenTinyIds = new Set<string>();

    while (true) {
      checkAbort(signal, taskId);
      const page = await getGuildMembers(gid, cursor, 100, adminIdentityId);
      if (!page.members || page.members.length === 0) break;

      for (const member of page.members) {
        seenTinyIds.add(member.tinyid);
        try {
          const existing = await prisma.member.findUnique({
            where: { tinyid: member.tinyid },
            select: { id: true },
          });
          await upsertMember(member);
          stats.membersTotal++;
          await updateTaskStats(taskId, { ...stats, phase: "members" });
          if (!existing) stats.newMembers++;
        } catch (err) {
          stats.errors++;
          console.error(`[Crawler] Failed to upsert member ${member.tinyid}:`, err);
        }
      }

      recordPhaseCall("members", stats.membersTotal);
      pageCount++;
      if (pageCount % 5 === 0) {
        log(taskId, `Members: ${stats.membersTotal} (page ${pageCount})`);
      }

      if (!page.nextPos) break;
      cursor = page.nextPos;
    }

    // Mark members not seen in this crawl as "left"
    // Only do this if the crawl completed successfully (reached the end of member list)
    const unseenMembers = await prisma.member.findMany({
      where: {
        tinyid: { notIn: Array.from(seenTinyIds) },
        status: "active",
      },
      select: { tinyid: true },
    });

    if (unseenMembers.length > 0) {
      const tinyIds = unseenMembers.map((m: { tinyid: string }) => m.tinyid);
      await prisma.member.updateMany({
        where: { tinyid: { in: tinyIds } },
        data: { status: "left", left_at: new Date() },
      });
      stats["membersLeftThisCrawl"] = unseenMembers.length;
      log(taskId, `Marked ${unseenMembers.length} members as left`);
    }

    await updateTaskStats(taskId, { ...stats, phase: "completed" });
    await updateTaskStatus(taskId, "completed");
    recordPhaseEnd("members");
    log(taskId, `Member crawl completed. Stats: ${JSON.stringify(stats)}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Crawler] Member crawl failed:`, err);
    await updateTaskStats(taskId, { ...stats, phase: "failed" });
    await updateTaskStatus(taskId, "failed", errMsg);
    throw err;
  }
}

// ─── Deletion Detection ───────────────────────────────────────────────

/**
 * Detects deleted feeds, comments, and members who left by comparing
 * DB active records against the latest crawl IDs.
 *
 * @param guildId         Guild ID
 * @param seenFeedIds     Set of feed IDs seen in the latest crawl
 * @param oldestSeenTime  Optional: oldest create_time_raw from the scan.
 *                        When provided, only feeds newer than this boundary
 *                        are checked (for incremental updates where the scan
 *                        didn't cover all feeds).
 */
export async function detectDeletions(
  guildId: string,
  seenFeedIds?: Set<string>,
  oldestSeenTime?: number
): Promise<{ feedsDeleted: number; commentsDeleted: number; membersLeft: number }> {
  let feedsDeleted = 0;
  let commentsDeleted = 0;
  let membersLeft = 0;

  // Detect deleted feeds
  if (seenFeedIds && seenFeedIds.size > 0) {
    // Build query: only check feeds within the scan time range
    const whereClause: any = { status: "active" };
    if (oldestSeenTime != null) {
      whereClause.create_time_raw = { gte: BigInt(oldestSeenTime) };
    }

    const activeFeeds = await prisma.feed.findMany({
      where: whereClause,
      select: { feed_id: true },
    });

    const deletedFeedIds = activeFeeds
      .filter((f: { feed_id: string }) => !seenFeedIds.has(f.feed_id))
      .map((f: { feed_id: string }) => f.feed_id);

    if (deletedFeedIds.length > 0) {
      await prisma.feed.updateMany({
        where: { feed_id: { in: deletedFeedIds } },
        data: { status: "deleted", deleted_at: new Date() },
      });
      feedsDeleted = deletedFeedIds.length;
    }
  }

  // Detect deleted comments: comments belonging to active feeds
  // where the comment is no longer returned by the API.
  // We check by looking at comment_count vs actual comment records.
  // Process in batches to avoid loading all mismatched feeds at once
  let batchOffset = 0;
  const BATCH_SIZE = 500;
  while (true) {
    const feedsWithMismatch = await prisma.$queryRaw<
      { feed_id: string; comment_count: number; actual_count: bigint }[]
    >`
      SELECT f.feed_id, f.comment_count, COUNT(c.id) as actual_count
      FROM feeds f
      LEFT JOIN comments c ON c.feed_id = f.feed_id AND c.status = 'active'
      WHERE f.status = 'active' AND f.comment_count > 0
      GROUP BY f.feed_id, f.comment_count
      HAVING COUNT(c.id) > f.comment_count
      LIMIT ${BATCH_SIZE} OFFSET ${batchOffset}
    `;

    if (feedsWithMismatch.length === 0) break;

  // For feeds where we have more comments in DB than the API reports,
  // the excess comments may have been deleted. We mark the oldest excess ones.
  for (const row of feedsWithMismatch) {
    const excess = Number(row.actual_count) - row.comment_count;
    if (excess <= 0) continue;

    const excessComments = await prisma.comment.findMany({
      where: { feed_id: row.feed_id, status: "active" },
      orderBy: { create_time: "asc" },
      take: excess,
      select: { comment_id: true },
    });

    if (excessComments.length > 0) {
      const ids = excessComments.map((c: { comment_id: string }) => c.comment_id);
      await prisma.comment.updateMany({
        where: { comment_id: { in: ids } },
        data: { status: "deleted", deleted_at: new Date() },
      });
      commentsDeleted += ids.length;
    }
  }

    batchOffset += BATCH_SIZE;
  }

  // Count members who have left (historical total, not just this crawl)
  const leftMembersTotal = await prisma.member.count({
    where: { status: "left" },
  });
  membersLeft = leftMembersTotal;

  console.log(
    `[Crawler] Deletion detection: ${feedsDeleted} feeds, ${commentsDeleted} comments, ${membersLeft} members left`
  );

  return { feedsDeleted, commentsDeleted, membersLeft };
}

// ─── JSON Import (Migration) ─────────────────────────────────────────

/**
 * Imports data from the existing JSON export files into PostgreSQL.
 *
 * Expected directory structure:
 *   <jsonDir>/82203161765285899_20260528_151950.json           (main: feeds + members)
 *   <jsonDir>/82203161765285899_20260528_151950_comments.json  (comments keyed by feed_id)
 *   <jsonDir>/82203161765285899_20260528_151950_detail.json    (detail keyed by feed_id)
 */
export async function importFromJson(jsonDir: string): Promise<void> {
  console.log(`[Import] Starting import from ${jsonDir}`);

  // Locate the JSON files
  const files = fs.readdirSync(jsonDir);
  const mainFile = files.find((f) => f.endsWith(".json") && !f.includes("_comments") && !f.includes("_detail"));
  const commentsFile = files.find((f) => f.includes("_comments.json"));
  const detailFile = files.find((f) => f.includes("_detail.json"));

  if (!mainFile) {
    throw new Error(`Main JSON file not found in ${jsonDir}`);
  }

  // ── Load main file ──
  console.log(`[Import] Loading main file: ${mainFile}`);
  const mainData = JSON.parse(
    fs.readFileSync(path.join(jsonDir, mainFile), "utf-8")
  );

  const feeds: any[] = mainData.feeds || [];
  const members: any[] = mainData.members || [];

  // ── Load comments file ──
  let commentsMap: Record<string, any[]> = {};
  if (commentsFile) {
    console.log(`[Import] Loading comments file: ${commentsFile}`);
    commentsMap = JSON.parse(
      fs.readFileSync(path.join(jsonDir, commentsFile), "utf-8")
    );
  }

  // ── Load detail file ──
  let detailMap: Record<string, any> = {};
  if (detailFile) {
    console.log(`[Import] Loading detail file: ${detailFile}`);
    detailMap = JSON.parse(
      fs.readFileSync(path.join(jsonDir, detailFile), "utf-8")
    );
  }

  // ── Import feeds (batch of 500) ──
  console.log(`[Import] Importing ${feeds.length} feeds...`);
  const BATCH = 500;
  let imported = 0;

  for (let i = 0; i < feeds.length; i += BATCH) {
    const chunk = feeds.slice(i, i + BATCH);
    const ops = chunk.map((feed) => {
      const detail = detailMap[feed.feed_id] || {};
      const createTime = parseDateTime(feed.create_time);
      const createTimeRaw = toBigInt(feed.create_time_raw);

      return prisma.feed.upsert({
        where: { feed_id: feed.feed_id },
        create: {
          feed_id: feed.feed_id,
          author: feed.author ?? null,
          author_id: feed.author_id ?? null,
          channel_name: feed.channel_name ?? null,
          title: feed.title ?? null,
          content: detail.content ?? null,
          content_snippet: feed.content_snippet ?? null,
          share_url: detail.share_url ?? null,
          images: feed.images ?? null,
          prefer_count: feed.prefer_count ?? 0,
          comment_count: feed.comment_count ?? 0,
          feed_type: detail.feed_type ?? null,
          create_time: createTime,
          create_time_raw: createTimeRaw,
          status: "active",
        },
        update: {
          content: detail.content ?? undefined,
          share_url: detail.share_url ?? undefined,
          feed_type: detail.feed_type ?? undefined,
          comment_count: feed.comment_count ?? undefined,
        },
      });
    });

    await prisma.$transaction(ops, { maxWait: 30000, timeout: 60000 });
    imported += chunk.length;
    console.log(`[Import] Feeds: ${imported}/${feeds.length}`);
  }

  // ── Import comments + replies ──
  const feedIds = Object.keys(commentsMap);
  let totalComments = 0;
  let totalReplies = 0;

  console.log(`[Import] Importing comments for ${feedIds.length} feeds...`);

  for (let i = 0; i < feedIds.length; i += BATCH) {
    const chunkFeedIds = feedIds.slice(i, i + BATCH);
    const commentOps: any[] = [];

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
              author: comment.author ?? null,
              author_id: comment.author_id ?? null,
              content: comment.content ?? null,
              content_text: contentText ?? comment.content_text ?? null,
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
            },
          })
        );
        totalComments++;

        // Process replies
        if (comment.replies_preview && Array.isArray(comment.replies_preview)) {
          for (const reply of comment.replies_preview) {
            const replyCreateTime = parseDateTime(reply.create_time);
            const replyCreateTimeRaw = toBigInt(reply.create_time_raw);
            const replyContentText = extractContentText(reply.content);

            commentOps.push(
              prisma.reply.upsert({
                where: { reply_id: reply.reply_id },
                create: {
                  reply_id: reply.reply_id,
                  comment_id: comment.comment_id,
                  feed_id: feedId,
                  author: reply.author ?? null,
                  author_id: reply.author_id ?? null,
                  content: reply.content ?? null,
                  content_text: replyContentText ?? null,
                  target_reply_id: reply.target_reply_id ?? null,
                  target_user: reply.target_user ?? null,
                  target_user_id: reply.target_user_id ?? null,
                  create_time: replyCreateTime,
                  create_time_raw: replyCreateTimeRaw,
                  status: "active",
                },
                update: {},
              })
            );
            totalReplies++;
          }
        }
      }
    }

    // Execute in sub-batches to avoid transaction limits
    for (let j = 0; j < commentOps.length; j += BATCH) {
      await prisma.$transaction(commentOps.slice(j, j + BATCH), {
        maxWait: 30000,
        timeout: 60000,
      });
    }

    console.log(
      `[Import] Comments: ${totalComments}, Replies: ${totalReplies} (processed ${Math.min(i + BATCH, feedIds.length)}/${feedIds.length} feeds)`
    );
  }

  // ── Import members ──
  console.log(`[Import] Importing ${members.length} members...`);
  imported = 0;

  for (let i = 0; i < members.length; i += BATCH) {
    const chunk = members.slice(i, i + BATCH);
    const ops = chunk.map((member) => {
      const userInfo = member._user_info || {};
      const joinTime = parseDateTime(member.joinTime);

      return prisma.member.upsert({
        where: { tinyid: member.tinyid },
        create: {
          tinyid: member.tinyid,
          nickname: member.nickname ?? null,
          global_nickname: userInfo.global_nickname ?? null,
          country: userInfo.country || null,
          city: userInfo.city || null,
          gender: userInfo.gender || null,
          join_time: joinTime,
          join_time_human: member.joinTime_human ?? null,
          status: "active",
        },
        update: {
          nickname: member.nickname ?? undefined,
          global_nickname: userInfo.global_nickname ?? undefined,
        },
      });
    });

    await prisma.$transaction(ops, { maxWait: 30000, timeout: 60000 });
    imported += chunk.length;
    console.log(`[Import] Members: ${imported}/${members.length}`);
  }

  console.log(
    `[Import] Import complete. Feeds: ${feeds.length}, Comments: ${totalComments}, Replies: ${totalReplies}, Members: ${members.length}`
  );
}
