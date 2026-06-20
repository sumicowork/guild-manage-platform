import { executeCli } from "./executor";

/**
 * Result shape for paginated member listing.
 */
export interface MemberPage {
  members: any[];
  nextPageToken: string;
  hasMore: boolean;
}

/**
 * Result shape for member search.
 */
export interface MemberSearchResult {
  members: any[];
  nextPos: string;
}

/**
 * 从 CLI JSON 响应中提取 data 字段。
 */
function extractData(result: any): any {
  if (!result) return null;
  if (result.data !== undefined) return result.data;
  return result;
}

/**
 * Fetches a page of guild members.
 *
 * CLI: `manage get-guild-member-list --guild-id X [--next-page-token X]`
 *
 * 返回的 member 对象包含: role, tinyid, 加入时间, 昵称
 */
export async function getGuildMembers(
  guildId: string,
  cursor: string = "",
  _count: number = 100 // CLI 不支持自定义数量，由服务端决定
): Promise<MemberPage> {
  const flags: Record<string, string | number | boolean> = {
    "guild-id": guildId,
  };
  if (cursor) flags["next-page-token"] = cursor;

  const result = await executeCli("manage", "get-guild-member-list", flags);
  const data = extractData(result);

  if (!data) {
    return { members: [], nextPageToken: "", hasMore: false };
  }

  const members: any[] = data.members || [];
  const nextPageToken: string = data.next_page_token || "";
  const hasMore: boolean = data.has_more ?? (nextPageToken !== "");

  return { members, nextPageToken, hasMore };
}

/**
 * Search members by nickname.
 *
 * CLI: `manage guild-member-search --guild-id X --keyword X [--num N] [--next-pos X]`
 */
export async function searchMembers(
  guildId: string,
  keyword: string,
  cursor: string = ""
): Promise<MemberSearchResult> {
  const flags: Record<string, string | number | boolean> = {
    "guild-id": guildId,
    keyword,
  };
  if (cursor) flags["next-pos"] = cursor;

  const result = await executeCli("manage", "guild-member-search", flags);
  const data = extractData(result);

  if (!data) {
    return { members: [], nextPos: "" };
  }

  const members: any[] = data.members || data.results || [];
  const nextPos: string = data.next_pos || "";

  return { members, nextPos };
}

/**
 * Get detailed user info.
 *
 * CLI: `manage get-user-info [--guild-id X] [--tiny-id X]`
 */
export async function getUserInfo(
  tinyId: string,
  guildId?: string
): Promise<any> {
  const flags: Record<string, string | number | boolean> = {
    "tiny-id": tinyId,
  };
  if (guildId) flags["guild-id"] = guildId;

  const result = await executeCli("manage", "get-user-info", flags);
  return extractData(result);
}

/**
 * Mute a user until a specific timestamp.
 *
 * CLI: `manage modify-member-shut-up --guild-id X --tiny-id X --time-stamp X`
 *
 * @param guildId   Guild ID
 * @param tinyId    Member tiny ID
 * @param timestamp Unix timestamp when mute expires (0 = unmute)
 */
export async function muteUser(
  guildId: string,
  tinyId: string,
  timestamp: string
): Promise<boolean> {
  try {
    await executeCli("manage", "modify-member-shut-up", {
      "guild-id": guildId,
      "tiny-id": tinyId,
      "time-stamp": timestamp,
    });
    return true;
  } catch (err) {
    console.error(`[CLI] muteUser failed for ${tinyId}:`, err);
    return false;
  }
}

/**
 * Kick a user from the guild.
 *
 * CLI: `manage kick-guild-member --guild-id X --tiny-id X --yes`
 */
export async function kickUser(
  guildId: string,
  tinyId: string
): Promise<boolean> {
  try {
    await executeCli("manage", "kick-guild-member", {
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
 * Send a direct message to a user.
 *
 * CLI: `manage push-group-dm-msg --peer-tiny-id X --source-guild-id X --text X`
 */
export async function sendDM(
  guildId: string,
  tinyId: string,
  content: string
): Promise<boolean> {
  try {
    await executeCli("manage", "push-group-dm-msg", {
      "peer-tiny-id": tinyId,
      "source-guild-id": guildId,
      text: content,
    });
    return true;
  } catch (err) {
    console.error(`[CLI] sendDM failed for ${tinyId}:`, err);
    return false;
  }
}
