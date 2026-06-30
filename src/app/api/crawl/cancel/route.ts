import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  getAuthUser,
  unauthorized,
  forbidden,
  success,
  error,
} from "@/lib/api-utils";
import { cancelCrawl } from "@/services/scheduler";

/**
 * POST /api/crawl/cancel
 * 取消正在运行的爬虫任务（admin only）
 *
 * Body:
 *   taskId  string  要取消的任务 ID（必填）
 *
 * 返回：
 *   - 200 { cancelled: true, taskId } — 已发出取消信号
 *   - 200 { cancelled: false, reason: "not running" } — 任务不在运行中（可能已完成/失败）
 *   - 404 — 任务不存在
 */
export async function POST(req: NextRequest) {
  const auth = await getAuthUser(req);
  if (!auth) return unauthorized();
  if (auth.role !== "admin") return forbidden();

  let body: { taskId?: string };
  try {
    body = await req.json();
  } catch {
    return error("请求体不是合法 JSON", 400);
  }

  const { taskId: taskIdRaw } = body;
  if (!taskIdRaw) return error("缺少 taskId 字段", 400);

  let taskId: bigint;
  try {
    taskId = BigInt(taskIdRaw);
  } catch {
    return error("taskId 不是合法整数", 400);
  }

  // 确认任务存在
  const task = await prisma.crawlTask.findUnique({
    where: { id: taskId },
    select: { id: true, status: true },
  });
  if (!task) return error("爬取任务不存在", 404);

  // 只能取消运行中或挂起的任务
  if (task.status !== "running" && task.status !== "pending") {
    return success({
      cancelled: false,
      reason: "not running",
      status: task.status,
      message: `任务当前状态为 ${task.status}，无需取消`,
    });
  }

  const aborted = cancelCrawl(taskId);
  if (!aborted) {
    // 任务记录是 running/pending，但没有对应的 controller
    // 可能是服务器重启后的僵尸任务 — 直接在 DB 标记为 cancelled
    await prisma.crawlTask.update({
      where: { id: taskId },
      data: {
        status: "cancelled",
        finished_at: new Date(),
        error_log: "Marked as cancelled (no running controller — likely zombie task)",
      },
    });
    return success({
      cancelled: true,
      taskId: String(taskId),
      note: "任务无运行中的 controller，已直接标记为 cancelled",
    });
  }

  return success({
    cancelled: true,
    taskId: String(taskId),
    message: "已发出取消信号，爬虫将在下一个循环检查点停止",
  });
}
