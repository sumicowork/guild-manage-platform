import { NextRequest } from "next/server";
import { getAuthUser, unauthorized, success, error } from "@/lib/api-utils";
import { executeCli } from "@/lib/cli/executor";

const GUILD_ID = process.env.GUILD_ID || "";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const data = await executeCli("manage", "get-guild-info", {
      guild_id: GUILD_ID,
    }, null);

    // Try to extract role groups — the response key may vary
    const rawRoleGroups: any[] =
      data?.role_groups ||
      data?.roleGroups ||
      data?.roles ||
      [];

    const roleGroups = rawRoleGroups.map((rg: any) => ({
      id: String(rg.role_id ?? rg.roleId ?? rg.id ?? ""),
      name: rg.role_name ?? rg.roleName ?? rg.name ?? rg.id ?? "",
    })).filter((rg: any) => rg.id);

    return success(roleGroups);
  } catch (err) {
    console.error("Role groups list error:", err);
    return error("获取身份组列表失败", 500);
  }
}
