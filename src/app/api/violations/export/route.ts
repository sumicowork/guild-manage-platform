import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, error } from "@/lib/api-utils";
import type { Prisma } from "@/generated/prisma/client";
import * as XLSX from "xlsx";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const { searchParams } = new URL(req.url);
    const targetType = searchParams.get("target_type") || undefined;
    const violationReason = searchParams.get("reason") || undefined;
    const actionType = searchParams.get("actionType") || undefined;
    const dateFrom = searchParams.get("dateFrom") || undefined;
    const dateTo = searchParams.get("dateTo") || undefined;
    const operator = searchParams.get("operator")?.trim() || undefined;
    const targetAuthorId = searchParams.get("target_author_id") || undefined;

    const where: Prisma.ViolationWhereInput = {};

    if (targetType) where.target_type = targetType;
    if (violationReason) where.violation_reason = violationReason;
    if (actionType) where.action_type = actionType;
    if (targetAuthorId) where.target_author_id = targetAuthorId;

    if (operator) {
      const opUser = await prisma.platformUser.findFirst({
        where: { username: operator },
        select: { id: true },
      });
      if (opUser) {
        where.operator_user_id = opUser.id;
      }
    }

    if (dateFrom || dateTo) {
      where.created_at = {};
      if (dateFrom) where.created_at.gte = new Date(dateFrom);
      if (dateTo) where.created_at.lte = new Date(dateTo + "T23:59:59.999Z");
    }

    const violations = await prisma.violation.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: 10000, // Safety limit to prevent OOM on very large datasets
      include: {
        user: {
          select: { username: true, display_name: true },
        },
        feed: {
          select: { title: true },
        },
        comment: {
          select: { content_text: true },
        },
        reply: {
          select: { content_text: true },
        },
      },
    });

    // Build export rows
    const rows = violations.map((v) => {
      let contentSnippet = "";
      if (v.target_type === "feed" && v.feed) {
        contentSnippet = v.feed.title || "";
      } else if (v.target_type === "comment" && v.comment) {
        contentSnippet = v.comment.content_text || "";
      } else if (v.target_type === "reply" && v.reply) {
        contentSnippet = v.reply.content_text || "";
      }

      const actionDetail = v.action_detail as Record<string, unknown> | null;

      return {
        ID: Number(v.id),
        目标类型: v.target_type,
        目标ID: v.target_id,
        目标作者: v.target_author || "",
        目标作者ID: v.target_author_id || "",
        违规原因: v.violation_reason,
        违规详情: v.violation_detail || "",
        处置类型: v.action_type,
        转移到频道: actionDetail?.movedToChannel || "",
        "禁言时长(小时)": actionDetail?.muteDurationHours || "",
        通知已发送: v.notification_sent ? "是" : "否",
        通知类型: v.notification_type || "",
        通知内容: v.notification_text || "",
        内容摘要: contentSnippet,
        操作人: v.user?.display_name || v.user?.username || "",
        创建时间: v.created_at.toISOString(),
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "违规记录");

    // Auto-width columns
    const colWidths = Object.keys(rows[0] || {}).map((key) => ({
      wch: Math.max(key.length * 2, 12),
    }));
    ws["!cols"] = colWidths;

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="violations-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    });
  } catch (err) {
    console.error("Violations export error:", err);
    return error("导出违规记录失败", 500);
  }
}
