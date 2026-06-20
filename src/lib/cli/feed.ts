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
 * 从 CLI JSON 响应中提取 data 字段。
 * CLI 统一返回 { data: {...}, success: true } 格式。
 */
function extractData(result: any): any {
  if (!result) return null;
  // CLI 返回 { data: {...}, success: true }
  if (result.data !== undefined) return result.data;
  // 兼容直接返回数据的情况
  return result;
}

/**
 * Fetches a page of guild feeds.
 *
 * CLI: `feed get-guild-feeds --guild-id X [--feed-attach-info X] --count N --get-type N`
 */
export async function getGuildFeeds(
  guildId: string,
  cursor: string,
  count: number,
  getType: number = 2
): Promise<FeedPage> {
  const flags: Record<string, string | number | boolean> = {
    "guild-id": guildId,
    count,
    "get-type": getType,
  };
  // 翻页令牌只在非空时传入
  if (cursor) flags["feed-attach-info"] = cursor;

  const result = await executeCli("feed", "get-guild-feeds", flags);
  const data = extractData(result);

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
 * CLI: `feed get-feed-comments --feed-id X --guild-id X [--attach-info X]`
 */
export async function getFeedComments(
  feedId: string,
  guildId: string,
  cursor: string
): Promise<CommentPage> {
  const flags: Record<string, string | number | boolean> = {
    "feed-id": feedId,
    "guild-id": guildId,
  };
  if (cursor) flags["attach-info"] = cursor;

  const result = await executeCli("feed", "get-feed-comments", flags);
  const data = extractData(result);

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
 * CLI: `feed get-feed-detail --feed-id X --guild-id X`
 */
export async function getFeedDetail(
  feedId: string,
  guildId: string
): Promise<FeedDetail> {
  const result = await executeCli("feed", "get-feed-detail", {
    "feed-id": feedId,
    "guild-id": guildId,
  });
  const data = extractData(result);

  if (!data) {
    return { content: "", share_url: "", feed_type: 0 };
  }

  return {
    content: data.content ?? "",
    share_url: data.share_url ?? "",
    feed_type: data.feed_type ?? 0,
  };
}

/**
 * Moves a feed post to a different channel.
 *
 * CLI: `feed move-feed --guild-id X --feed-id X --channel-id X --original-channel-id X`
 *
 * @param guildId           Guild ID
 * @param feedId            Feed ID
 * @param channelId         Target channel ID
 * @param originalChannelId Current channel ID of the feed
 */
export async function movePost(
  guildId: string,
  feedId: string,
  channelId: string,
  originalChannelId: string
): Promise<boolean> {
  try {
    await executeCli("feed", "move-feed", {
      "feed-id": feedId,
      "guild-id": guildId,
      "channel-id": channelId,
      "original-channel-id": originalChannelId,
    });
    return true;
  } catch (err) {
    console.error(`[CLI] movePost failed for feed ${feedId}:`, err);
    return false;
  }
}

/**
 * Deletes a feed post.
 *
 * CLI: `feed del-feed --feed-id X --guild-id X --channel-id X --create-time X --yes`
 *
 * @param guildId    Guild ID
 * @param feedId     Feed ID
 * @param channelId  Channel ID the feed belongs to
 * @param createTime Feed creation timestamp (Unix seconds)
 */
export async function deletePost(
  guildId: string,
  feedId: string,
  channelId: string,
  createTime: string
): Promise<boolean> {
  try {
    await executeCli("feed", "del-feed", {
      "feed-id": feedId,
      "guild-id": guildId,
      "channel-id": channelId,
      "create-time": createTime,
      yes: true,
    });
    return true;
  } catch (err) {
    console.error(`[CLI] deletePost failed for feed ${feedId}:`, err);
    return false;
  }
}

/**
 * Deletes a comment from a feed.
 *
 * CLI: `feed do-comment --comment-type 0 --feed-id X --comment-id X --comment-author-id X --feed-create-time X --guild-id X --yes`
 *
 * @param feedId          Feed ID
 * @param guildId         Guild ID
 * @param commentId       Comment ID to delete
 * @param commentAuthorId Author tinyid of the comment
 * @param feedCreateTime  Feed creation timestamp (Unix seconds)
 */
export async function deleteComment(
  feedId: string,
  guildId: string,
  commentId: string,
  commentAuthorId: string,
  feedCreateTime: string
): Promise<boolean> {
  try {
    await executeCli("feed", "do-comment", {
      "feed-id": feedId,
      "guild-id": guildId,
      "comment-id": commentId,
      "comment-author-id": commentAuthorId,
      "feed-create-time": feedCreateTime,
      "comment-type": 0,
      yes: true,
    });
    return true;
  } catch (err) {
    console.error(`[CLI] deleteComment failed for comment ${commentId}:`, err);
    return false;
  }
}

/**
 * Posts a comment on a feed.
 *
 * CLI: `feed do-comment --feed-id X --guild-id X --content X --comment-type 1 --feed-create-time X`
 *
 * @param feedId         Feed ID
 * @param guildId        Guild ID
 * @param content        Comment text
 * @param feedCreateTime Feed creation timestamp (Unix seconds)
 */
export async function postComment(
  feedId: string,
  guildId: string,
  content: string,
  feedCreateTime: string
): Promise<boolean> {
  try {
    await executeCli("feed", "do-comment", {
      "feed-id": feedId,
      "guild-id": guildId,
      content,
      "feed-create-time": feedCreateTime,
      "comment-type": 1,
    });
    return true;
  } catch (err) {
    console.error(`[CLI] postComment failed for feed ${feedId}:`, err);
    return false;
  }
}

/**
 * Replies to a specific comment on a feed.
 *
 * CLI: `feed do-reply --feed-id X --guild-id X --comment-id X --content X --reply-type 1 --replier-id X ...`
 */
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
  }
): Promise<boolean> {
  try {
    await executeCli("feed", "do-reply", {
      "feed-id": feedId,
      "guild-id": guildId,
      "comment-id": commentId,
      content,
      "reply-type": 1,
      "replier-id": replierId,
      "feed-author-id": extra.feedAuthorId,
      "feed-create-time": extra.feedCreateTime,
      "comment-author-id": extra.commentAuthorId,
      "comment-create-time": extra.commentCreateTime,
    });
    return true;
  } catch (err) {
    console.error(
      `[CLI] replyToComment failed for comment ${commentId}:`,
      err
    );
    return false;
  }
}
