import { NextRequest } from "next/server";
import {
  getAuthUser,
  unauthorized,
  forbidden,
  success,
  error,
} from "@/lib/api-utils";
import {
  updateCrawlSchedule,
  updateMemberSchedule,
  getScheduleInfo,
} from "@/services/scheduler";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const info = getScheduleInfo();
    return success({
      updateCron: info.updateCron,
      memberCron: info.memberCron,
      runningTasks: info.runningTasks,
    });
  } catch (err) {
    console.error("Schedule GET error:", err);
    return error("获取调度配置失败", 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    if (auth.role !== "admin") {
      return forbidden();
    }

    const body = await req.json();
    const { updateCron, memberCron } = body;

    if (updateCron) {
      try {
        updateCrawlSchedule(updateCron);
      } catch (e) {
        return error(e instanceof Error ? e.message : "无效的 cron 表达式", 400);
      }
    }

    if (memberCron) {
      try {
        updateMemberSchedule(memberCron);
      } catch (e) {
        return error(e instanceof Error ? e.message : "无效的 cron 表达式", 400);
      }
    }

    const info = getScheduleInfo();
    return success({
      updateCron: info.updateCron,
      memberCron: info.memberCron,
    });
  } catch (err) {
    console.error("Schedule PUT error:", err);
    return error("更新调度配置失败", 500);
  }
}
