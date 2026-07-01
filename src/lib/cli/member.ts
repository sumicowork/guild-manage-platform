import { executeCli } from "./executor";

/**
 * Result shape for paginated member listing.
 */
export interface MemberPage {
  members: any[];
  nextPos: string;
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
 * Fetches a page of guild members via member search (space keyword).
 *
 * CLI: `manage guild-member-search --json`
 * stdin: { guild_id, keyword: " ", num: 50, next_pos? }
 *
 * Python scraper reference:
 *   body = {"guild_id": gid, "keyword": " ", "num": 50}
 *   if next_pos: body["next_pos"] = next_pos
 *   run_cli(["manage", "guild-member-search"], stdin_data=body)
 */
export async function getGuildMembers(
  guildId: string,
  cursor: string = "",
  _count: number = 50,
  adminIdentityId?: bigint | number | null
): Promise<MemberPage> {
  const body: Record<string, any> = {
    guild_id: guildId,
    keyword: " ",
    num: 50,
  };
  if (cursor) body.next_pos = cursor;

  const data = await executeCli("manage", "guild-member-search", body, adminIdentityId);

  if (!data) {
    return { members: [], nextPos: "", hasMore: false };
  }

  const members: any[] = data.members || [];
  const nextPos: string = data.next_pos || "";
  const hasMore: boolean = data.has_more ?? (nextPos !== "");

  return { members, nextPos, hasMore };
}

/**
 * Search members by keyword.
 *
 * CLI: `manage guild-member-search --json`
 * stdin: { guild_id, keyword, next_pos? }
 */
export async function searchMembers(
  guildId: string,
  keyword: string,
  cursor: string = "",
  adminIdentityId?: bigint | number | null
): Promise<MemberSearchResult> {
  const body: Record<string, any> = {
    guild_id: guildId,
    keyword,
  };
  if (cursor) body.next_pos = cursor;

  const data = await executeCli("manage", "guild-member-search", body, adminIdentityId);

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
 * CLI: `manage get-user-info --json`
 * stdin: { tiny_id }
 *
 * Python scraper reference:
 *   body = {"tiny_id": tid}
 *   run_cli(["manage", "get-user-info"], stdin_data=body)
 */
export async function getUserInfo(
  tinyId: string,
  guildId?: string,
  adminIdentityId?: bigint | number | null
): Promise<any> {
  const body: Record<string, any> = {
    tiny_id: tinyId,
  };
  if (guildId) body.guild_id = guildId;

  return await executeCli("manage", "get-user-info", body, adminIdentityId);
}

/**
 * Mute a user until a specific timestamp.
 *
 * CLI: `manage modify-member-shut-up --json`
 * stdin: { guild_id, tiny_id, time_stamp }
 *
 * @param guildId   Guild ID
 * @param tinyId    Member tiny ID
 * @param timestamp Unix timestamp when mute expires (0 = unmute)
 */
export async function muteUser(
  guildId: string,
  tinyId: string,
  timestamp: string,
  adminIdentityId?: bigint | number | null
): Promise<boolean> {
  try {
    await executeCli("manage", "modify-member-shut-up", {
      guild_id: guildId,
      tiny_id: tinyId,
      time_stamp: timestamp,
    }, adminIdentityId);
    return true;
  } catch (err) {
    console.error(`[CLI] muteUser failed for ${tinyId}:`, err);
    return false;
  }
}

/**
 * Kick a user from the guild.
 *
 * CLI: `manage kick-guild-member --json`
 * stdin: { guild_id, tiny_id }
 */
export async function kickUser(
  guildId: string,
  tinyId: string,
  adminIdentityId?: bigint | number | null
): Promise<boolean> {
  try {
    await executeCli("manage", "kick-guild-member", {
      guild_id: guildId,
      tiny_id: tinyId,
    }, adminIdentityId);
    return true;
  } catch (err) {
    console.error(`[CLI] kickUser failed for ${tinyId}:`, err);
    return false;
  }
}

/**
 * Send a direct message to a user.
 *
 * CLI: `manage push-group-dm-msg --json`
 * stdin: { peer_tiny_id, source_guild_id, text }
 */
export async function sendDM(
  guildId: string,
  tinyId: string,
  content: string,
  adminIdentityId?: bigint | number | null
): Promise<boolean> {
  try {
    await executeCli("manage", "push-group-dm-msg", {
      peer_tiny_id: tinyId,
      source_guild_id: guildId,
      text: content,
    }, adminIdentityId);
    return true;
  } catch (err) {
    console.error(`[CLI] sendDM failed for ${tinyId}:`, err);
    return false;
  }
}

/**
 * Add a member to a role group.
 *
 * CLI: `manage add-role-members --json`
 * stdin: { guild_id, role_id, tiny_ids: [tinyId] }
 */
export async function addRoleMembers(
  guildId: string,
  roleId: string,
  tinyIds: string[],
  adminIdentityId?: bigint | number | null
): Promise<boolean> {
  try {
    await executeCli("manage", "add-role-members", {
      guild_id: guildId,
      role_id: roleId,
      tiny_ids: tinyIds,
    }, adminIdentityId);
    return true;
  } catch (err) {
    console.error(`[CLI] addRoleMembers failed for role=${roleId}:`, err);
    return false;
  }
}
