import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error } from "@/lib/api-utils";

const CONFIG_KEY = "violation_notification_template";
const DEFAULT_TEMPLATE =
  "老师您好，您的帖子涉及【{违规原因}】。按照频道规则，这边已对您的帖子作隐藏处理。{禁言处理}还请老师发帖前留意频道规则，避免再次出现类似情况，感谢老师的理解与配合。";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const row = await prisma.appConfig.findUnique({
      where: { key: CONFIG_KEY },
      select: { value: true },
    });

    return success({ template: row?.value || DEFAULT_TEMPLATE });
  } catch (err) {
    console.error("Get template error:", err);
    return error("获取通知模板失败", 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const { template } = await req.json();
    if (!template || typeof template !== "string" || !template.trim()) {
      return error("模板内容不能为空", 400);
    }

    await prisma.appConfig.upsert({
      where: { key: CONFIG_KEY },
      update: { value: template.trim() },
      create: { key: CONFIG_KEY, value: template.trim() },
    });

    return success({ template: template.trim() });
  } catch (err) {
    console.error("Update template error:", err);
    return error("更新通知模板失败", 500);
  }
}
