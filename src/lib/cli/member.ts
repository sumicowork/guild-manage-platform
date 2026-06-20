import { executeCli } from "./executor";

/**
 * Result shape for paginated member listing.
 */
export interface MemberPage {
  members: any[];
  nextCursor: string;
}

/**
 * Fetches a page of guild members.
 *
 * CLI command: `member get-guild-members --guild-id X --cursor X --count N`
 *
 * @param guildId  Guild ID
 * @param cursor   Pagination cursor (empty string for the first page)
 * @param count    Number of members per page
 */
export async function getGuildMembers(
  guildId: string,
  cursor: string,
  count: number
): Promise<MemberPage> {
  const result = await executeCli("member", "get-guild-members", {
    "guild-id": guildId,
    cursor,
    count,
  });

  if (!result) {
    return { members: [], nextCursor: "" };
  }

  const members: any[] = Array.isArray(result)
    ? result
    : result.members || [];
  const nextCursor: string = result.next_cursor ?? result.nextCursor ?? "";

  return { members, nextCursor };
}

/**
 * Searches guild members by keyword (nickname match).
 *
 * CLI command: `member search-members --guild-id X --keyword X --cursor X`
 *
 * @param guildId  Guild ID
 * @param keyword  Search keyword (matches against nickname)
 * @param cursor   Pagination cursor
 */
export async function searchMembers(
  guildId: string,
  keyword: string,
  cursor: string
): Promise<MemberPage> {
  const result = await executeCli("member", "search-members", {
    "guild-id": guildId,
    keyword,
    cursor,
  });

  if (!result) {
    return { members: [], nextCursor: "" };
  }

  const members: any[] = Array.isArray(result)
    ? result
    : result.members || [];
  const nextCursor: string = result.next_cursor ?? result.nextCursor ?? "";

  return { members, nextCursor };
}

/**
 * Fetches detailed user info by tiny ID.
 *
 * CLI command: `member get-user-info --tiny-id X`
 *
 * @param tinyId  The user's tiny ID
 */
export async function getUserInfo(tinyId: string): Promise<any> {
  const result = await executeCli("member", "get-user-info", {
    "tiny-id": tinyId,
  });

  return result || null;
}

/**
 * Mutes a user in the guild for a specified duration.
 *
 * CLI command: `member mute-user --guild-id X --tiny-id X --duration N`
 *
 * @param guildId   Guild ID
 * @param tinyId    User's tiny ID
 * @param duration  Mute duration in seconds
 * @returns true on success
 */
export async function muteUser(
  guildId: string,
  tinyId: string,
  duration: number
): Promise<boolean> {
  try {
    await executeCli("member", "mute-user", {
      "guild-id": guildId,
      "tiny-id": tinyId,
      duration,
    });
    return true;
  } catch (err) {
    console.error(`[CLI] muteUser failed for ${tinyId}:`, err);
    return false;
  }
}

/**
 * Kicks a user from the guild.
 *
 * CLI command: `member kick-user --guild-id X --tiny-id X --yes`
 *
 * @param guildId  Guild ID
 * @param tinyId   User's tiny ID
 * @returns true on success
 */
export async function kickUser(
  guildId: string,
  tinyId: string
): Promise<boolean> {
  try {
    await executeCli("member", "kick-user", {
      "guild-id": guildId,
      "tiny-id": tinyId,
      yes: true,
    });
    return true;
  } catch (err) {
    console.error(`[CLI] kickUser failed for ${tinyId}:`, err);
    return false;
  }
}

/**
 * Sends a direct message to a guild member.
 *
 * CLI command: `member send-dm --guild-id X --tiny-id X --content X`
 *
 * @param guildId  Guild ID
 * @param tinyId   Recipient's tiny ID
 * @param content  Message content
 * @returns true on success
 */
export async function sendDM(
  guildId: string,
  tinyId: string,
  content: string
): Promise<boolean> {
  try {
    await executeCli("member", "send-dm", {
      "guild-id": guildId,
      "tiny-id": tinyId,
      content,
    });
    return true;
  } catch (err) {
    console.error(`[CLI] sendDM failed for ${tinyId}:`, err);
    return false;
  }
}
