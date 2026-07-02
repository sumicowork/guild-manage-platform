import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { success, error } from "@/lib/api-utils";
import { hashPassword } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return error("用户名和密码为必填项", 400);
    }
    if (typeof username !== "string" || username.trim().length < 2) {
      return error("用户名至少需要 2 个字符", 400);
    }
    if (typeof password !== "string" || password.length < 6) {
      return error("密码至少需要 6 个字符", 400);
    }

    const trimmed = username.trim();

    // Check uniqueness
    const existing = await prisma.platformUser.findUnique({
      where: { username: trimmed },
    });
    if (existing) {
      return error("该用户名已被注册", 409);
    }

    const hashed = await hashPassword(password);
    await prisma.platformUser.create({
      data: {
        username: trimmed,
        password: hashed,
        role: "operator",
        status: "pending",
      },
    });

    return success(null, { message: "注册申请已提交，请等待管理员审批" });
  } catch (err) {
    console.error("Register error:", err);
    return error("注册失败", 500);
  }
}
