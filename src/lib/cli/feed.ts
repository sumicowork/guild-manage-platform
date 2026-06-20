import { executeCli } from "./executor";

/**
 * Result shape for paginated feed listing.
 */
export interface FeedPage {
  feeds: any[];
  nextCursor: string;
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
 * CLI command: `feed get-guild-feeds --guild-id X --cursor X --count N --get-type N`
 *
 * @param guildId  Guild (channel) ID
 * @param cursor   Pagination cursor (empty string for the first page)
 * @param count    Number of feeds to fetch per page
 * @param getType  Feed type filter (1 = all, 2 = images, etc.)
 */
export async function getGuildFeeds(
  guildId: string,
  cursor: string,
  count: number,
  getType: number
): Promise<FeedPage> {
  const result = await executeCli("feed", "get-guild-feeds", {
    "guild-id": guildId,
    cursor: cursor,
    count,
    "get-type": getType,
  });

  if (!result) {
    return { feeds: [], nextCursor: "" };
  }

  // The CLI returns { feeds: [...], next_cursor: "..." } or an array directly
  const feeds: any[] = Array.isArray(result) ? result : result.feeds || [];
  const nextCursor: string = result.next_cursor ?? result.nextCursor ?? "";

  return { feeds, nextCursor };
}

/**
 * Fetches comments for a specific feed.
 *
 * CLI command: `feed get-feed-comments --feed-id X --guild-id X --cursor X`
 *
 * @param feedId   Feed ID
 * @param guildId  Guild ID
 * @param cursor   Pagination cursor (empty string for the first page)
 */
export async function getFeedComments(
  feedId: string,
  guildId: string,
  cursor: string
): Promise<CommentPage> {
  const result = await executeCli("feed", "get-feed-comments", {
    "feed-id": feedId,
    "guild-id": guildId,
    cursor,
  });

  if (!result) {
    return { comments: [], hasMore: false, nextCursor: "" };
  }

  const comments: any[] = Array.isArray(result)
    ? result
    : result.comments || [];
  const hasMore: boolean = result.has_more ?? result.hasMore ?? false;
  const nextCursor: string = result.next_cursor ?? result.nextCursor ?? "";

  return { comments, hasMore, nextCursor };
}

/**
 * Fetches full detail for a single feed (content, share URL, type).
 *
 * CLI command: `feed get-feed-detail --feed-id X --guild-id X`
 *
 * @param feedId   Feed ID
 * @param guildId  Guild ID
 */
export async function getFeedDetail(
  feedId: string,
  guildId: string
): Promise<FeedDetail> {
  const result = await executeCli("feed", "get-feed-detail", {
    "feed-id": feedId,
    "guild-id": guildId,
  });

  if (!result) {
    return { content: "", share_url: "", feed_type: 0 };
  }

  return {
    content: result.content ?? "",
    share_url: result.share_url ?? "",
    feed_type: result.feed_type ?? 0,
  };
}

/**
 * Moves a feed post to a different channel.
 *
 * CLI command: `feed move-feed --feed-id X --guild-id X --channel-id X --yes`
 *
 * @returns true on success
 */
export async function movePost(
  guildId: string,
  feedId: string,
  channelId: string
): Promise<boolean> {
  try {
    await executeCli("feed", "move-feed", {
      "feed-id": feedId,
      "guild-id": guildId,
      "channel-id": channelId,
      yes: true,
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
 * CLI command: `feed del-feed --feed-id X --guild-id X --yes`
 *
 * @returns true on success
 */
export async function deletePost(
  guildId: string,
  feedId: string
): Promise<boolean> {
  try {
    await executeCli("feed", "del-feed", {
      "feed-id": feedId,
      "guild-id": guildId,
      yes: true,
    });
    return true;
  } catch (err) {
    console.error(`[CLI] deletePost failed for feed ${feedId}:`, err);
    return false;
  }
}

/**
 * Posts a comment on a feed.
 *
 * CLI command: `feed do-comment --feed-id X --guild-id X --content X --type 1`
 *
 * @param feedId   Feed ID to comment on
 * @param guildId  Guild ID
 * @param content  Comment text content
 * @returns true on success
 */
export async function postComment(
  feedId: string,
  guildId: string,
  content: string
): Promise<boolean> {
  try {
    await executeCli("feed", "do-comment", {
      "feed-id": feedId,
      "guild-id": guildId,
      content,
      type: 1,
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
 * CLI command: `feed do-reply --feed-id X --guild-id X --comment-id X --content X --type 1`
 *
 * @param feedId    Feed ID
 * @param guildId   Guild ID
 * @param commentId Comment ID to reply to
 * @param content   Reply text content
 * @returns true on success
 */
export async function replyToComment(
  feedId: string,
  guildId: string,
  commentId: string,
  content: string
): Promise<boolean> {
  try {
    await executeCli("feed", "do-reply", {
      "feed-id": feedId,
      "guild-id": guildId,
      "comment-id": commentId,
      content,
      type: 1,
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
