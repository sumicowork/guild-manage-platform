export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { getAuthUser, unauthorized, success, error } from "@/lib/api-utils";

const execFileP = promisify(execFile);
const GUILD_ID = "82203161765285899";

interface CliChannel {
  channel_id: string;
  channel_name: string;
  guild_id: string;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    // Use CLI for authoritative channel list (DB data is stale from moved feeds)
    const { stdout } = await execFileP("tencent-channel-cli", [
      "manage", "get-guild-channel-list",
      "--guild-id", GUILD_ID,
      "--json", "--yes",
    ], { timeout: 15000, maxBuffer: 1024 * 1024 });

    const result = JSON.parse(stdout);
    const cliChannels: CliChannel[] = result?.data?.channels ?? [];

    const channels = cliChannels.map((ch) => ({
      id: ch.channel_name,
      name: ch.channel_name,
      channel_id: ch.channel_id,
    }));

    return success(channels);
  } catch (err) {
    console.error("Channels list error:", err);
    return error("获取频道列表失败", 500);
  }
}
