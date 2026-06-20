import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error } from "@/lib/api-utils";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    // Get distinct channel names from feeds
    const feeds = await prisma.feed.findMany({
      where: { status: "active" },
      select: { channel_name: true },
      distinct: ["channel_name"],
      orderBy: { channel_name: "asc" },
    });

    const channels = feeds
      .filter((f) => f.channel_name)
      .map((f) => ({
        id: f.channel_name!,
        name: f.channel_name!,
      }));

    return success(channels);
  } catch (err) {
    console.error("Channels list error:", err);
    return error("获取频道列表失败", 500);
  }
}
