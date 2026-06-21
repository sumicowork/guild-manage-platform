import { executeCli } from "./executor";

/**
 * Result shape for paginated feed listing.
 */
export interface FeedPage {
  feeds: any[];
  nextCursor: string;
  hasMore: boolean;
}

/**
 * Result shape for paginated comment listing.
 */
export interface CommentPage {
  comments: any[];
  hasMore: boolean;
  nextCursor: string;
}

/**
 * Result shape for feed detail.
 */
export interface FeedDetail {
  content: string;
  share_url: string;
  feed_type: number;
}

/**
 * Fetches a page of guild feeds.
 *
 * CLI: `feed get-guild-feeds --json`
 * stdin: { guild_id, get_type, count, feed_attach_info? }
 *
 * Python scraper reference:
 *   body = {"guild_id": gid, "get_type": 2, "count": 20}
 *   if attach_info: body["feed_attach_info"] = attach_info
 *   run_cli(["feed", "get-guild-feeds"], stdin_data=body)
 */
export async function getGuildFeeds(
  guildId: string,
  cursor: string,
  count: number,
  getType: number = 2,
  adminIdentityId?: bigint | number | null
): Promise<FeedPage> {
  const body: Record<string, any> = {
    guild_id: guildId,
    get_type: getType,
    count,
  };
  if (cursor) body.feed_attach_info = cursor;

  const data = await executeCli("feed", "get-guild-feeds", body, adminIdentityId);

  if (!data) {
    return { feeds: [], nextCursor: "", hasMore: false };
  }

  const feeds: any[] = data.feeds || [];
  const nextCursor: string = data.feed_attach_info || "";
  const hasMore: boolean = data.has_more ?? false;

  return { feeds, nextCursor, hasMore };
}

/**
 * Fetches comments for a specific feed.
 *
 * CLI: `feed get-feed-comments --json`
 * stdin: { feed_id, guild_id, count?, reply_list_num?, attach_info? }
 *
 * Python scraper reference:
 *   body = {"feed_id": fid, "guild_id": gid, "count": 20, "reply_list_num": 3}
 *   if attach_info: body["attach_info"] = attach_info
 */
export async function getFeedComments(
  feedId: string,
  guildId: string,
  cursor: string,
  adminIdentityId?: bigint | number | null
): Promise<CommentPage> {
  const body: Record<string, any> = {
    feed_id: feedId,
    guild_id: guildId,
    count: 20,
    reply_list_num: 3,
  };
  if (cursor) body.attach_info = cursor;

  const data = await executeCli("feed", "get-feed-comments", body, adminIdentityId);

  if (!data) {
    return { comments: [], hasMore: false, nextCursor: "" };
  }

  const comments: any[] = data.comments || [];
  const hasMore: boolean = data.has_more ?? false;
  const nextCursor: string = data.attach_info || "";

  return { comments, hasMore, nextCursor };
}

/**
 * Fetches full detail for a single feed.
 *
 * CLI: `feed get-feed-detail --json`
 * stdin: { feed_id, guild_id }
 */
export async function getFeedDetail(
  feedId: string,
  guildId: string,
  adminIdentityId?: bigint | number | null
): Promise<FeedDetail> {
  const data = await executeCli("feed", "get-feed-detail", {
    feed_id: feedId,
    guild_id: guildId,
  }, adminIdentityId);

  if (!data) {
    return { content: "", share_url: "", feed_type: 0 };
  }

  // CLI wraps response in { feed: {...} }, Python scraper: detail = data.get("feed", data)
  const detail = data.feed || data;

  return {
    content: detail.content ?? "",
    share_url: detail.share_url ?? "",
    feed_type: detail.feed_type ?? 0,
  };
}

/**
 * Fetches nested replies for a comment (pagination).
 *
 * CLI: `feed get-next-page-replies --json`
 * stdin: { feed_id, comment_id, guild_id, channel_id, count, attach_info }
 *
 * Python scraper reference:
 *   body = {"feed_id": fid, "comment_id": cid, "guild_id": gid,
 *           "channel_id": ch, "count": 50, "attach_info": ai}
 */
export async function getNextPageReplies(
  feedId: string,
  commentId: string,
  guildId: string,
  channelId: string,
  attachInfo: string,
  adminIdentityId?: bigint | number | null
): Promise<{ replies: any[]; hasMore: boolean; nextAttachInfo: string }> {
  const data = await executeCli("feed", "get-next-page-replies", {
    feed_id: feedId,
    comment_id: commentId,
    guild_id: guildId,
    channel_id: channelId,
    count: 50,
    attach_info: attachInfo,
  }, adminIdentityId);

  if (!data) {
    return { replies: [], hasMore: false, nextAttachInfo: "" };
  }

  return {
    replies: data.replies || [],
    hasMore: data.has_more ?? false,
    nextAttachInfo: data.attach_info || "",
  };
}

/**
 * Moves a feed post to a different channel.
 *
 * CLI: `feed move-feed --json`
 * stdin: { feed_id, guild_id, channel_id }
 */
export async function movePost(
  guildId: string,
  feedId: string,
  channelId: string,
  _originalChannelId?: string,
  adminIdentityId?: bigint | number | null
): Promise<boolean> {
  try {
    await executeCli("feed", "move-feed", {
      feed_id: feedId,
      guild_id: guildId,
      channel_id: channelId,
    }, adminIdentityId);
    return true;
  } catch (err) {
    console.error(`[CLI] movePost failed for feed ${feedId}:`, err);
    return false;
  }
}

/**
 * Deletes a feed post.
 *
 * CLI: `feed del-feed --json`
 * stdin: { feed_id, guild_id, channel_id, create_time }
 */
export async function deletePost(
  guildId: string,
  feedId: string,
  channelId: string,
  createTime: string,
  adminIdentityId?: bigint | number | null
): Promise<boolean> {
  try {
    await executeCli("feed", "del-feed", {
      feed_id: feedId,
      guild_id: guildId,
      channel_id: channelId,
      create_time: createTime,
    }, adminIdentityId);
    return true;
  } catch (err) {
    console.error(`[CLI] deletePost failed for feed ${feedId}:`, err);
    return false;
  }
}

/**
 * Deletes a comment from a feed.
 *
 * CLI: `feed do-comment --json`
 * stdin: { feed_id, guild_id, comment_id, comment_author_id, feed_create_time, comment_type: 0 }
 */
export async function deleteComment(
  feedId: string,
  guildId: string,
  commentId: string,
  commentAuthorId: string,
  feedCreateTime: string,
  adminIdentityId?: bigint | number | null
): Promise<boolean> {
  try {
    await executeCli("feed", "do-comment", {
      feed_id: feedId,
      guild_id: guildId,
      comment_id: commentId,
      comment_author_id: commentAuthorId,
      feed_create_time: feedCreateTime,
      comment_type: 0,
    }, adminIdentityId);
    return true;
  } catch (err) {
    console.error(`[CLI] deleteComment failed for comment ${commentId}:`, err);
    return false;
  }
}

/**
 * Posts a comment on a feed.
 *
 * CLI: `feed do-comment --json`
 * stdin: { feed_id, guild_id, content, comment_type: 1, feed_create_time }
 */
export async function postComment(
  feedId: string,
  guildId: string,
  content: string,
  feedCreateTime: string,
  adminIdentityId?: bigint | number | null
): Promise<boolean> {
  try {
    await executeCli("feed", "do-comment", {
      feed_id: feedId,
      guild_id: guildId,
      content,
      feed_create_time: feedCreateTime,
      comment_type: 1,
    }, adminIdentityId);
    return true;
  } catch (err) {
    console.error(`[CLI] postComment failed for feed ${feedId}:`, err);
    return false;
  }
}

/**
 * Replies to a specific comment on a feed.
 *
 * CLI: `feed do-reply --json`
 * stdin: { feed_id, guild_id, comment_id, content, reply_type: 1, replier_id,
 *          feed_author_id, feed_create_time, comment_author_id, comment_create_time }
 */
/**
 * Deletes a reply from a comment thread.
 *
 * CLI: `feed do-reply --json --reply-type 2`
 * reply_type 2 = 帖主/管理员删除他人回复
 *
 * 必填: feed_id, feed_author_id, feed_create_time,
 *       comment_id, comment_author_id, comment_create_time,
 *       reply_id, replier_id (操作者=帖主), guild_id
 * 建议: channel_id
 */
export async function deleteReply(
  feedId: string,
  guildId: string,
  commentId: string,
  replyId: string,
  extra: {
    feedAuthorId: string;
    feedCreateTime: string;
    commentAuthorId: string;
    commentCreateTime: string;
    channelId?: string;
  },
  adminIdentityId?: bigint | number | null
): Promise<boolean> {
  try {
    await executeCli("feed", "do-reply", {
      reply_type: 2,
      feed_id: feedId,
      feed_author_id: extra.feedAuthorId,
      feed_create_time: extra.feedCreateTime,
      comment_id: commentId,
      comment_author_id: extra.commentAuthorId,
      comment_create_time: extra.commentCreateTime,
      reply_id: replyId,
      replier_id: extra.feedAuthorId,
      guild_id: guildId,
      channel_id: extra.channelId || undefined,
    }, adminIdentityId);
    return true;
  } catch (err) {
    console.error(`[CLI] deleteReply failed for reply ${replyId}:`, err);
    return false;
  }
}

export async function replyToComment(
  feedId: string,
  guildId: string,
  commentId: string,
  content: string,
  replierId: string,
  extra: {
    feedAuthorId: string;
    feedCreateTime: string;
    commentAuthorId: string;
    commentCreateTime: string;
  },
  adminIdentityId?: bigint | number | null
): Promise<boolean> {
  try {
    await executeCli("feed", "do-reply", {
      feed_id: feedId,
      guild_id: guildId,
      comment_id: commentId,
      content,
      reply_type: 1,
      replier_id: replierId,
      feed_author_id: extra.feedAuthorId,
      feed_create_time: extra.feedCreateTime,
      comment_author_id: extra.commentAuthorId,
      comment_create_time: extra.commentCreateTime,
    }, adminIdentityId);
    return true;
  } catch (err) {
    console.error(
      `[CLI] replyToComment failed for comment ${commentId}:`,
      err
    );
    return false;
  }
}
