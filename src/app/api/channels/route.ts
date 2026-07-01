import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error } from "@/lib/api-utils";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    // Get channels: prefer numeric channel_id, fallback to name-based
    const feedsWithId = await prisma.feed.findMany({
      where: { channel_id: { not: null } },
      select: { channel_id: true, channel_name: true },
      distinct: ["channel_id"],
      orderBy: { channel_name: "asc" },
    });

    const feedsWithoutId = await prisma.feed.findMany({
      where: { channel_id: null, channel_name: { not: null } },
      select: { channel_name: true },
      distinct: ["channel_name"],
      orderBy: { channel_name: "asc" },
    });

    const channels: { id: string; name: string }[] = [];
    const seenNames = new Set<string>();

    for (const f of feedsWithId) {
      if (f.channel_id) {
        const name = f.channel_name ?? f.channel_id;
        channels.push({ id: f.channel_id, name });
        seenNames.add(name);
      }
    }

    for (const f of feedsWithoutId) {
      if (f.channel_name && !seenNames.has(f.channel_name)) {
        channels.push({ id: f.channel_name, name: f.channel_name });
      }
    }

    return success(channels);
  } catch (err) {
    console.error("Channels list error:", err);
    return error("获取频道列表失败", 500);
  }
}
