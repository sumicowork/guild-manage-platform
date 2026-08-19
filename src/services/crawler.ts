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

/** Throttle SSE emissions: max 1 per task per second to avoid browser ERR_INSUFFICIENT_RESOURCES */
const _lastSseEmit = new Map<string, number>();

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
  // 13 位毫秒时间戳：直接 new Date(ms)
  if (typeof raw === "number") {
    return raw > 1e12 ? new Date(raw) : new Date(raw * 1000);
  }
  // 数字字符串：13 位毫秒 vs 10 位秒
  if (typeof raw === "string" && /^\d+$/.test(raw)) {
    const n = parseInt(raw, 10);
    return new Date(n > 1e12 ? n : n * 1000);
  }
  // 优先原生解析（兼容 ISO 带 Z/偏移）；仅对无时区标记的 "YYYY-MM-DD HH:mm:ss" 补 +08:00
  const hasTz = /[zZ]$/.test(raw) || /[+-]\d{2}:?\d{2}$/.test(raw);
  const candidate = hasTz ? new Date(raw) : new Date(raw.replace(" ", "T") + "+08:00");
  return isNaN(candidate.getTime()) ? null : candidate;
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

/** Update the crawl_task stats column in DB — 容错：进度写入失败不杀死爬虫 */
async function updateTaskStats(
  taskId: bigint,
  stats: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.crawlTask.update({
      where: { id: taskId },
      data: { stats: stats as any },
    });
  } catch (err) {
    console.error(`[Crawler] Failed to persist stats for task ${taskId}:`, err instanceof Error ? err.message : err);
    return; // 进度写入失败不致命，最终状态由 updateTaskStatus 兜底
  }
  // Throttle SSE emissions — rapid calls (e.g. per-member in member crawl)
  // would flood the browser with events → ERR_INSUFFICIENT_RESOURCES
  const key = String(taskId);
  const now = Date.now();
  const last = _lastSseEmit.get(key) || 0;
  if (now - last >= 1000) {
    _lastSseEmit.set(key, now);
    crawlEvents.emit("update", { taskId: key, stats });
  }
}

/** Update task status */
async function updateTaskStatus(
  taskId: bigint,
  status: string,
  errorLog?: string
): Promise<void> {
  // 终态守卫：completed/cancelled/failed/interrupted 后不再被覆盖
  // （防止 cancel 兜底被完成态覆盖、failed→cancelled 双重写入等状态漂移）
  const TERMINAL = ["completed", "cancelled", "failed", "interrupted"];
  if (TERMINAL.includes(status)) {
    const res = await prisma.crawlTask.updateMany({
      where: { id: taskId, status: { notIn: TERMINAL } },
      data: {
        status,
        finished_at: new Date(),
        error_log: errorLog,
      },
    });
    if (res.count === 1) {
      crawlEvents.emit("status", { taskId: String(taskId), status, errorLog });
    }
    return;
  }
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

/** Sanitize a value for PostgreSQL — strip null bytes which are invalid UTF-8 */
function sanitizeText(v: string | null | undefined): string | null | undefined {
  if (v == null) return v;
  return v.includes("\x00") ? v.replace(/\x00/g, "") : v;
}

/** Deep-clean an arbitrary CLI object: recursively strip null bytes from ALL string properties and nested objects.
 *  PostgreSQL rejects 0x00 in any text/JSON column, and the error message doesn't always identify the column. */
function sanitizeObject(obj: any): void {
  if (obj == null || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const item of obj) sanitizeObject(item);
    return;
  }
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (typeof v === "string") {
      if (v.includes("\x00")) obj[key] = v.replace(/\x00/g, "");
    } else if (typeof v === "object" && v !== null) {
      sanitizeObject(v);
    }
  }
}

/** 结构化比较 images：忽略数组顺序与对象键序（jsonb 规范化后的差异不应判定为变化） */
function imagesEqual(a: any, b: any): boolean {
  const normalize = (arr: any): string => {
    if (!Array.isArray(arr)) return JSON.stringify(arr ?? null);
    const items = arr.map((it) => {
      if (it && typeof it === "object") {
        return JSON.stringify(Object.keys(it).sort().reduce((acc: Record<string, any>, k) => { acc[k] = it[k]; return acc; }, {}));
      }
      return String(it);
    }).sort();
    return JSON.stringify(items);
  };
  return normalize(a) === normalize(b);
}

// ─── Upsert helpers (batch-safe) ──────────────────────────────────────

async function upsertFeed(feed: any, detail?: any, channelNameToId?: Map<string, string>): Promise<void> {
  sanitizeObject(feed);
  if (detail) sanitizeObject(detail);
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
  sanitizeObject(comment);
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
  sanitizeObject(reply);
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
      const page = await getGuildFeeds(gid, cursor, 1000, 2, adminIdentityId);
      if (!page.feeds || page.feeds.length === 0) break;

      // Sanitize immediately before any DB interaction
      for (const feed of page.feeds) sanitizeObject(feed);

      for (const feed of page.feeds) {
        try {
          await upsertFeed(feed, undefined, channelNameToId);
          allFeedIds.push(feed.feed_id);
          // 列表接口不返回 channel_id，用 channel_name 回退（深层回复分页依赖）
          const resolvedChId = feed.channel_id ?? channelNameToId.get(feed.channel_name);
          if (resolvedChId) {
            feedChannelMap[feed.feed_id] = String(resolvedChId);
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
            try {
              await upsertComment(comment, feedId);
              recordPhaseCall("comments", i + 1);
              stats.commentsTotal++;
            } catch (err) {
              // 单条评论失败不中断整条 feed（对齐 update crawl 的隔离策略）
              stats.errors++;
              console.error(`[Crawler] Failed to upsert comment ${comment.comment_id}:`, err);
              continue;
            }

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
          if (detail) {
            await prisma.feed.update({
              where: { feed_id: feedId },
              data: {
                content: detail.content || undefined,
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
    // 取消：不写 failed，直接上抛由 scheduler 标 cancelled（避免 failed→cancelled 双重写入）
    if (err instanceof CrawlCancelledError) throw err;
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
 * - Full-depth scan (no page cap or early termination) — stops only when API cursor ends.
 * - Fetches comments and details for changed feeds in parallel.
 * - Runs deletion detection after completion.
 *
 * @param options.mode "light"：只扫最新几页（默认 3），不启用 cursor workers，评论补拉上限小 —
 *   任务 20-30 秒完成，支持每分钟触发；"deep"（默认）：全深度 + workers + 大评论上限 — 深夜补欠账。
 */
export async function runUpdateCrawl(
  guildId: string,
  taskId: bigint,
  adminIdentityId?: number,
  signal?: AbortSignal,
  options?: { mode?: "light" | "deep" }
): Promise<void> {
  const gid = guildId || GUILD_ID;
  const mode = options?.mode ?? "deep";
  const LIGHT_MAX_PAGES = 3; // 轻量模式：只扫最新 3 页（约 3000 条）
  const LIGHT_COMMENTS_MAX = 200; // 轻量模式：单轮评论补拉上限
  const DEEP_COMMENTS_MAX = 5000; // 全量模式：深夜补欠账可处理更多
  const commentsBatchMax = mode === "light" ? LIGHT_COMMENTS_MAX : DEEP_COMMENTS_MAX;
  log(taskId, `Starting ${mode} update crawl for guild ${gid}`);

  await prisma.crawlTask.update({
    where: { id: taskId },
    data: { status: "running", started_at: new Date() },
  });

  const stats: Record<string, any> = {
    newFeeds: 0,
    updatedFeeds: 0,
    commentsAdded: 0,
    commentsProcessed: 0,
    errors: 0,
    autoActions: 0,
    mode,
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
    recordPhaseStart("scan");

    // ── Load cached cursors from previous completed scan ──
    let savedCursors: Array<{ page: number; cursor: string }> = [];
    try {
      const lastCompleted = await prisma.crawlTask.findFirst({
        where: { task_type: "update", status: "completed" },
        orderBy: { created_at: "desc" },
        select: { stats: true },
      });
      const lastStats = (lastCompleted?.stats || {}) as Record<string, any>;
      if (Array.isArray(lastStats.cursors) && lastStats.cursors.length > 0) {
        savedCursors = lastStats.cursors;
        log(taskId, `Found ${savedCursors.length} cached cursors from previous scan: ${savedCursors.map(c => `p${c.page}`).join(", ")}`);
      }
    } catch (e) {
      // If stats JSON is corrupted, just proceed without cached cursors
    }

    let cursor = "";
    let pageCount = 0;
    const changedFeedIds: string[] = [];
    const newFeedIds: string[] = [];
    const allSeenFeedIds = new Set<string>();
    const feedChannelMap: Record<string, string> = {};
    // feed_id → API 本轮实际返回的 comment_id 集合（detectDeletions 事实对比用）
    const refetchedComments = new Map<string, Set<string>>();
    // comment_id → API 本轮实际返回的 reply_id 集合（回复删除检测用，此前 detectDeletions 从不清理 reply → 造成泄漏）
    const refetchedReplies = new Map<string, Set<string>>();
    let oldestSeenTime: number | null = null;

    // Cursor snapshots for next scan — save every 10 pages
    const thisScanCursors: Array<{ page: number; cursor: string }> = [];

    // ── Shared per-page processing (used by main thread and cursor workers) ──
    async function processScanPage(
      feeds: any[],
      parallelFeedIds?: Set<string>
    ): Promise<void> {
      // Sanitize + track IDs
      for (const feed of feeds) {
        sanitizeObject(feed);
        const fid = feed.feed_id;
        if (!fid) continue; // guard: API 返回缺 feed_id 时跳过，避免污染集合
        allSeenFeedIds.add(fid);
        if (parallelFeedIds) parallelFeedIds.add(fid);
        // 列表接口不返回 channel_id，用 channel_name 回退（深层回复分页依赖）
        const resolvedChId = feed.channel_id ?? channelNameToId.get(feed.channel_name);
        if (resolvedChId) feedChannelMap[fid] = String(resolvedChId);
        const t = feed.create_time_raw;
        // 兼容 number/数字字符串（API 类型不稳定时删除检测不应整体失效）
        const tNum = typeof t === "number" ? t : typeof t === "string" && /^\d+$/.test(t) ? parseInt(t, 10) : NaN;
        if (!isNaN(tNum) && (oldestSeenTime === null || tNum < oldestSeenTime)) oldestSeenTime = tNum;
      }

      // Batch DB check
      const ids = feeds.map((f: any) => f.feed_id);
      const existingFeeds = await prisma.feed.findMany({
        where: { feed_id: { in: ids } },
        select: { feed_id: true, comment_count: true, status: true, channel_name: true, title: true, images: true },
      });
      const existingMap = new Map(existingFeeds.map((f) => [f.feed_id, f]));

      for (const feed of feeds) {
        const existing = existingMap.get(feed.feed_id);
        if (!existing) {
          await upsertFeed(feed, undefined, channelNameToId);
          stats.newFeeds++;
          newFeedIds.push(feed.feed_id);

          if (autoRules.length > 0 && feed.author_id) {
            const rule = autoRules.find((r) => r.target_author_id === feed.author_id);
            if (rule) {
              try {
                const fcId = feed.channel_id ? String(feed.channel_id) : channelNameToId.get(feed.channel_name) || "";
                const fcTime = feed.create_time_raw ? String(feed.create_time_raw) : "";
                let ok = false;
                if (rule.action === "delete") {
                  ok = await deletePost(gid, feed.feed_id, fcId, fcTime, adminIdentityId);
                  if (ok) await prisma.feed.update({ where: { feed_id: feed.feed_id }, data: { status: "deleted", deleted_at: new Date() } });
                } else if (rule.action === "move" && rule.target_channel_id) {
                  ok = await movePost(gid, feed.feed_id, rule.target_channel_id, fcId, adminIdentityId);
                  if (ok) await prisma.feed.update({ where: { feed_id: feed.feed_id }, data: { status: "moved" } });
                }
                if (ok) { stats.autoActions++; log(taskId, `[AutoRule] ${rule.name}: ${rule.action} feed ${feed.feed_id}`); continue; }
              } catch (err) { stats.errors++; }
            }
          }
          changedFeedIds.push(feed.feed_id);
        } else if (existing.status === "deleted") {
          await upsertFeed(feed, undefined, channelNameToId);
          stats.updatedFeeds++;
          changedFeedIds.push(feed.feed_id);
        } else {
          let hasChanges = false;
          const updateData: Record<string, any> = {};
          if (feed.comment_count !== undefined && feed.comment_count !== null && existing.comment_count !== Number(feed.comment_count)) { updateData.comment_count = Number(feed.comment_count); hasChanges = true; }
          if (feed.channel_name !== undefined && feed.channel_name !== null && existing.channel_name !== feed.channel_name) { updateData.channel_name = feed.channel_name; hasChanges = true; }
          if (feed.title !== undefined && feed.title !== null && existing.title !== feed.title) { updateData.title = feed.title; hasChanges = true; }
          // images：结构化比较（jsonb 键序/数组顺序差异不应触发"变化"，避免全量重拉）
          if (feed.images !== undefined && feed.images !== null && !imagesEqual(feed.images, existing.images)) { updateData.images = feed.images; hasChanges = true; }
          if (hasChanges) {
            await prisma.feed.update({ where: { feed_id: feed.feed_id }, data: updateData });
            stats.updatedFeeds++;
            changedFeedIds.push(feed.feed_id);
          }
        }
      }
    }

    // ── Parallel workers from cached cursors（light 模式不启用：只保证实时性）──
    // Use ALL saved cursors: each worker scans from its cursor until it hits territory
    // already covered by another worker or the main thread. With 4+ cursors and
    // 8-10 identities, each covers ~10 pages — achieving near-linear speedup.
    const parallelFeedIds = new Set<string>();
    const workerPromises: Promise<void>[] = [];
    if (savedCursors.length > 0 && mode !== "light") {
      for (const entry of savedCursors) {
        workerPromises.push((async () => {
          log(taskId, `[CursorWorker p${entry.page}] Starting from cached cursor...`);
          let wCursor = entry.cursor;
          let wPage = 0;
          try {
            while (true) {
              checkAbort(signal, taskId);
              const wPageObj = await getGuildFeeds(gid, wCursor, 1000, 2, adminIdentityId);
              if (!wPageObj.feeds || wPageObj.feeds.length === 0) break;

              // Overlap: if any feed was already seen by anyone (main or another worker) → stop
              if ((wPageObj.feeds as any[]).some((f: any) => allSeenFeedIds.has(f.feed_id))) {
                log(taskId, `[CursorWorker p${entry.page}] Overlapped — stopping`);
                break;
              }

              await processScanPage(wPageObj.feeds, parallelFeedIds);
            wPage++;
            if (!wPageObj.nextCursor) break;
            wCursor = wPageObj.nextCursor;
          }
        } catch (err) {
          log(taskId, `[CursorWorker p${entry.page}] Failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        log(taskId, `[CursorWorker p${entry.page}] Scanned ${wPage} extra pages`);
      })());
    }
    log(taskId, `Launched ${workerPromises.length} parallel cursor workers`);
  }

    // ── Main scan loop (newest feeds → older) ──
    while (true) {
      checkAbort(signal, taskId);
      // light 模式页数上限：只扫最新几页，保证任务在 1 分钟内完成
      if (mode === "light" && pageCount >= LIGHT_MAX_PAGES) {
        log(taskId, `[light] Page cap ${LIGHT_MAX_PAGES} reached — stopping scan`);
        break;
      }
      pageCount++;
      recordPhaseCall("scan", pageCount);
      recordPhaseTotal("scan", pageCount);
      // Throttle DB writes: only persist stats every 5 pages
      if (pageCount % 5 === 0) await updateTaskStats(taskId, { ...stats, phase: "scan" });
      const page = await getGuildFeeds(gid, cursor, 1000, 2, adminIdentityId);
      if (!page.feeds || page.feeds.length === 0) break;

      await processScanPage(page.feeds);

      // Save cursor snapshot every 10 pages for next scan's parallel worker
      if (pageCount % 10 === 0 && page.nextCursor) {
        thisScanCursors.push({ page: pageCount, cursor: page.nextCursor });
      }

      // Overlap detection: if parallel worker has already seen feeds on this page, it covered the rest
      if (parallelFeedIds.size > 0 && page.feeds.some((f: any) => parallelFeedIds.has(f.feed_id))) {
        log(taskId, `Main thread overlapped at page ${pageCount} — all feeds covered`);
        break;
      }

      log(
        taskId,
        `Feed scan (page ${pageCount}): ${stats.newFeeds} new, ${stats.updatedFeeds} updated`
      );

      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    // Wait for parallel workers to finish
    if (workerPromises.length > 0) {
      log(taskId, "Waiting for parallel cursor workers to finish...");
      await Promise.all(workerPromises);
    }

    // Save cursor snapshots for next scan
    stats.cursors = thisScanCursors;

    // ── 评论对账闸门升级：计数不一致（含回复）的帖也进入评论补拉 ──
    // 触发条件：(活跃评论数 + 活跃回复数) != 接口声明 comment_count
    // 双向 ID-diff：API 有 DB 无 → 补拉（<，评论归零主因）；DB 有 API 无 → 删除（>，回复删除泄漏）
    // 旧逻辑只在 comment_count 字段"变化"时才拉评论，导致字段已同步但实际缺评论的孤儿帖永不补拉。
    const commentFeedIds = new Set<string>(changedFeedIds);
    try {
      const seenIds = [...allSeenFeedIds];
      if (seenIds.length > 0) {
        const cmtGroups = await prisma.comment.groupBy({
          by: ["feed_id"],
          where: { feed_id: { in: seenIds }, status: "active" },
          _count: { _all: true },
        });
        const cmtByFeed = new Map<string, number>();
        for (const g of cmtGroups) cmtByFeed.set(g.feed_id, g._count._all);

        // 回复经 comment_id → feed_id 映射后按帖聚合
        const seenComments = await prisma.comment.findMany({
          where: { feed_id: { in: seenIds } },
          select: { comment_id: true, feed_id: true },
        });
        const commentIdToFeed = new Map<string, string>();
        const commentIdList: string[] = [];
        for (const c of seenComments) {
          commentIdToFeed.set(c.comment_id, c.feed_id);
          commentIdList.push(c.comment_id);
        }
        const repGroups =
          commentIdList.length > 0
            ? await prisma.reply.groupBy({
                by: ["comment_id"],
                where: { comment_id: { in: commentIdList }, status: "active" },
                _count: { _all: true },
              })
            : [];
        const repByFeed = new Map<string, number>();
        for (const g of repGroups) {
          const fid = commentIdToFeed.get(g.comment_id);
          if (fid) repByFeed.set(fid, (repByFeed.get(fid) ?? 0) + g._count._all);
        }

        // 这些 feed 的 DB 声明 comment_count（含 null，按 0 处理）
        const feedsWithCount = await prisma.feed.findMany({
          where: { feed_id: { in: seenIds } },
          select: { feed_id: true, comment_count: true },
        });
        let mismatchCount = 0;
        for (const f of feedsWithCount) {
          const declared = f.comment_count ?? 0;
          const actual = (cmtByFeed.get(f.feed_id) ?? 0) + (repByFeed.get(f.feed_id) ?? 0);
          if (actual !== declared) {
            commentFeedIds.add(f.feed_id);
            mismatchCount++;
          }
        }
        stats.reconcileFeeds = mismatchCount;
        log(taskId, `Comment reconcile gate: +${mismatchCount} feeds (count mismatch) added to comment fetch set (total ${commentFeedIds.size})`);
      }
    } catch (err) {
      console.error(`[Crawler] Failed comment-reconcile gate:`, err);
      stats.errors++;
    }

    log(
      taskId,
      `Phase 1 complete: ${stats.newFeeds} new feeds, ${stats.updatedFeeds} changed. Fetching comments for ${commentFeedIds.size} feeds.`
    );
    recordPhaseEnd("scan");
    // ── Phase 2+2.5: Comments and Details in parallel ──
    // Comments use a different CLI command than details → independent rate limits → safe to run in parallel.
    if (changedFeedIds.length > 0) {
      // Cap per-cycle comment refetch: deep history scans can flag thousands of stale feeds.
      // Process at most commentsBatchMax per cycle; the rest are picked up in later cycles.
      const COMMENTS_BATCH_MAX = commentsBatchMax;
      const commentsBatch = [...commentFeedIds].slice(0, COMMENTS_BATCH_MAX);
      if (commentFeedIds.size > COMMENTS_BATCH_MAX) {
        log(taskId, `Cap: ${commentFeedIds.size} feeds need comment reconcile → refetching first ${COMMENTS_BATCH_MAX} (rest in later cycles)`);
      }
      log(taskId, `Phase 2+2.5: Fetching comments for ${commentsBatch.length} feeds and details for ${changedFeedIds.length} feeds in parallel...`);

      await Promise.all([
        // ── Phase 2: Fetch comments (2 parallel workers, round-robin identities handle 153) ──
        (async () => {
          const COMMENT_WORKERS = 2;
          recordPhaseStart("comments");
          recordPhaseTotal("comments", commentsBatch.length);
          log(taskId, `Phase 2: Fetching comments with ${COMMENT_WORKERS} parallel workers...`);

          const commentChunks: string[][] = Array.from({ length: COMMENT_WORKERS }, () => []);
          commentsBatch.forEach((id, i) => commentChunks[i % COMMENT_WORKERS].push(id));

          await Promise.all(commentChunks.map((chunk) => (async () => {
            for (const feedId of chunk) {
              recordPhaseCall("comments", stats.commentsProcessed ?? 0);
              if (++stats.commentsProcessed % 5 === 0) await updateTaskStats(taskId, { ...stats, phase: "comments" });
              checkAbort(signal, taskId);
              // 记录本轮 API 真实返回的评论/回复集合（detectDeletions 事实对比用）
              const apiCommentIds = new Set<string>();
              const feedReplyIds = new Map<string, Set<string>>();
              let feedCommentsComplete = true;
              try {
                let commentCursor = "";
                while (true) {
                  checkAbort(signal, taskId);
                  const commentPage = await getFeedComments(feedId, gid, commentCursor, adminIdentityId);
                  if (!commentPage.comments || commentPage.comments.length === 0) break;

                  for (const comment of commentPage.comments) {
                    apiCommentIds.add(comment.comment_id);
                    const replyIds = new Set<string>();
                    try {
                      await upsertComment(comment, feedId);
                      stats.commentsAdded++;

                      if (comment.replies_preview && Array.isArray(comment.replies_preview)) {
                        for (const reply of comment.replies_preview) {
                          try {
                            await upsertReply(reply, comment.comment_id, feedId);
                            replyIds.add(reply.reply_id);
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
                              replyIds.add(reply.reply_id);
                              stats.commentsAdded++;
                            },
                            adminIdentityId
                          );
                        }
                      }
                      feedReplyIds.set(comment.comment_id, replyIds);
                    } catch {
                      stats.errors++;
                    }
                  }

                  if (!commentPage.hasMore || !commentPage.nextCursor) break;
                  commentCursor = commentPage.nextCursor;
                }
              } catch (err) {
                stats.errors++;
                feedCommentsComplete = false; // 异常中断：不参与评论/回复删除检测
                console.error(`[Crawler] Failed comments for ${feedId}:`, err);
              }
              // 拉取完整（无异常）才登记集合，否则跳过删除检测避免误删
              if (feedCommentsComplete) {
                refetchedComments.set(feedId, apiCommentIds);
                for (const [cid, rids] of feedReplyIds) refetchedReplies.set(cid, rids);
                // 用实际拉回的(评论+回复)数回写 comment_count，使声明数与实际一致，
                // 既能修正 API 列表 comment_count 偶发偏大，也避免该帖每轮被反复重拉。
                const actualCount = apiCommentIds.size + [...feedReplyIds.values()].reduce((a, s) => a + s.size, 0);
                try {
                  const cur = await prisma.feed.findUnique({ where: { feed_id: feedId }, select: { comment_count: true } });
                  if ((cur?.comment_count ?? null) !== actualCount) {
                    await prisma.feed.update({ where: { feed_id: feedId }, data: { comment_count: actualCount } });
                  }
                } catch { /* best-effort */ }
              }
            }
          })));

          log(taskId, `Phase 2 complete: ${stats.commentsAdded} comments added`);
          recordPhaseEnd("comments");
        })(),

        // ── Phase 2.5: Fetch details (3 parallel workers — details API never hits 153) ──
        (async () => {
          const DETAIL_WORKERS = 3;
          recordPhaseStart("details");
          recordPhaseTotal("details", changedFeedIds.length);
          log(taskId, `Phase 2.5: Fetching details with ${DETAIL_WORKERS} parallel workers...`);

          stats.detailsTotal = 0;
          const detailChunks: string[][] = Array.from({ length: DETAIL_WORKERS }, () => []);
          changedFeedIds.forEach((id, i) => detailChunks[i % DETAIL_WORKERS].push(id));

          await Promise.all(detailChunks.map((chunk) => (async () => {
            for (const feedId of chunk) {
              checkAbort(signal, taskId);
              try {
                const detail = await getFeedDetail(feedId, gid, adminIdentityId);
                if (detail) {
                  await prisma.feed.update({
                    where: { feed_id: feedId },
                    data: {
                      content: detail.content || undefined,
                      share_url: detail.share_url || undefined,
                      feed_type: detail.feed_type || undefined,
                    },
                  });
                  stats.detailsTotal++;
                  recordPhaseCall("details", stats.detailsTotal);
                }
              } catch (err) {
                console.error(`[Crawl] Failed to fetch detail for ${feedId}:`, err);
              }
            }
          })));

          await updateTaskStats(taskId, { ...stats, phase: "details" });
          recordPhaseEnd("details");
          log(taskId, `Phase 2.5 complete: ${stats.detailsTotal} details fetched/updated`);
        })(),
      ]);
    }

    // ── Phase 3: Deletion detection（仅限扫描范围内）──
    // 只检查 create_time_raw >= oldestSeenTime 的帖子，
    // 更老的帖子不在本次扫描范围，不做删除判断。
    if (oldestSeenTime !== null) {
      log(taskId, `Phase 3: Deletion detection (feeds after ${new Date(oldestSeenTime * 1000).toISOString()})...`);
      const deletions = await detectDeletions(gid, allSeenFeedIds, oldestSeenTime, refetchedComments, refetchedReplies);
      stats["deletions"] = deletions;
      log(taskId, `Deletions detected: ${JSON.stringify(deletions)}`);
    } else {
      log(taskId, "Phase 3: Skipped (no feeds scanned)");
    }

    log(taskId, `Update crawl completed. Stats: ${JSON.stringify(stats)}`);
    await updateTaskStats(taskId, { ...stats, phase: "completed", changedFeedIds, newFeedIds });
    await updateTaskStatus(taskId, "completed");
  } catch (err) {
    // 取消：不写 failed，直接上抛由 scheduler 标 cancelled（避免 failed→cancelled 双重写入）
    if (err instanceof CrawlCancelledError) throw err;
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

      // Batch check existing members (N+1 → 1 query per page)
      const tinyIds = page.members.map((m: any) => m.tinyid);
      const existingMembers = await prisma.member.findMany({
        where: { tinyid: { in: tinyIds } },
        select: { tinyid: true },
      });
      const existingSet = new Set(existingMembers.map((m) => m.tinyid));

      for (const member of page.members) {
        seenTinyIds.add(member.tinyid);
        try {
          await upsertMember(member);
          stats.membersTotal++;
          if (!existingSet.has(member.tinyid)) stats.newMembers++;
        } catch (err) {
          stats.errors++;
          console.error(`[Crawler] Failed to upsert member ${member.tinyid}:`, err);
        }
      }

      recordPhaseCall("members", stats.membersTotal);
      pageCount++;
      if (pageCount % 5 === 0) {
        await updateTaskStats(taskId, { ...stats, phase: "members" });
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
    // 取消：不写 failed，直接上抛由 scheduler 标 cancelled（避免 failed→cancelled 双重写入）
    if (err instanceof CrawlCancelledError) throw err;
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
 * @param refetchedComments Optional: feed_id → comment_id set returned by the
 *                        API during this cycle's Phase 2. Comment deletion is
 *                        ONLY checked against this ground truth; feeds not in
 *                        the map are skipped entirely (their data may be stale).
 * @param refetchedReplies  Optional: comment_id → reply_id set returned by the
 *                        API during Phase 2 (replies_preview + 分页). 回复删除
 *                        同样只以该事实集合为准；此前 detectDeletions 从不处理
 *                        reply 表，导致平台已删的回复永久残留（泄漏）。
 */
export async function detectDeletions(
  guildId: string,
  seenFeedIds?: Set<string>,
  oldestSeenTime?: number,
  refetchedComments?: Map<string, Set<string>>,
  refetchedReplies?: Map<string, Set<string>>
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

  // Detect deleted comments by comparing DB against the API's ACTUAL returned
  // comment list (ground truth captured during Phase 2). A comment is only
  // marked deleted if the API no longer returns it.
  // NOTE: the old logic inferred deletion from count mismatches
  // (COUNT(c.id) > feeds.comment_count) and blindly deleted the OLDEST excess
  // comments — this destroyed real comments whenever the count was stale
  // (verified incident 2026-08-15 01:44:30). It is intentionally removed.
  if (refetchedComments && refetchedComments.size > 0) {
    for (const [feedId, apiCommentIds] of refetchedComments) {
      const dbComments = await prisma.comment.findMany({
        where: { feed_id: feedId, status: "active" },
        select: { comment_id: true },
      });
      const toDelete = dbComments.filter((c: { comment_id: string }) => !apiCommentIds.has(c.comment_id));
      if (toDelete.length > 0) {
        await prisma.comment.updateMany({
          where: { comment_id: { in: toDelete.map((c) => c.comment_id) } },
          data: { status: "deleted", deleted_at: new Date() },
        });
        commentsDeleted += toDelete.length;
      }
    }
  }

  // Detect deleted replies by comparing DB against the API's ACTUAL returned
  // reply list (ground truth captured during Phase 2). A reply is only marked
  // deleted if the API no longer returns it. 此前 detectDeletions 完全不处理
  // reply 表 → 平台已删的回复永久留在 DB，造成 dbReal(评论+回复) > comment_count
  // 的泄漏（实测 152 帖 / 247 条）。现与评论一样做事实对比删除。
  if (refetchedReplies && refetchedReplies.size > 0) {
    for (const [commentId, apiReplyIds] of refetchedReplies) {
      const dbReplies = await prisma.reply.findMany({
        where: { comment_id: commentId, status: "active" },
        select: { reply_id: true },
      });
      const toDelete = dbReplies.filter((r: { reply_id: string }) => !apiReplyIds.has(r.reply_id));
      if (toDelete.length > 0) {
        await prisma.reply.updateMany({
          where: { reply_id: { in: toDelete.map((r) => r.reply_id) } },
          data: { status: "deleted", deleted_at: new Date() },
        });
        commentsDeleted += toDelete.length;
      }
    }
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
