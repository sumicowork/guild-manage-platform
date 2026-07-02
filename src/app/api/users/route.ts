import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import {
  getAuthUser,
  unauthorized,
  forbidden,
  success,
  error,
  serializeBigInt,
  toCamelCase,
} from "@/lib/api-utils";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    if (auth.role !== "admin") {
      return forbidden();
    }

    const users = await prisma.platformUser.findMany({
      orderBy: { created_at: "desc" },
      select: {
        id: true,
        username: true,
        display_name: true,
        role: true,
        status: true,
        created_at: true,
        updated_at: true,
      },
    });

    const rawUsers = serializeBigInt(users);
    return success(toCamelCase(rawUsers));
  } catch (err) {
    console.error("Users list error:", err);
    return error("获取用户列表失败", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    if (auth.role !== "admin") {
      return forbidden();
    }

    const body = await req.json();
    const { username, password, displayName, role } = body;

    if (!username || !password) {
      return error("用户名和密码不能为空", 400);
    }

    // Check uniqueness
    const existing = await prisma.platformUser.findUnique({
      where: { username },
    });
    if (existing) {
      return error("该用户名已存在", 409);
    }

    const hashedPassword = await hashPassword(password);

    const user = await prisma.platformUser.create({
      data: {
        username,
        password: hashedPassword,
        display_name: displayName || null,
        role: role || "operator",
      },
      select: {
        id: true,
        username: true,
        display_name: true,
        role: true,
        status: true,
        created_at: true,
      },
    });

    const rawUser = serializeBigInt(user);
    return success(toCamelCase(rawUser));
  } catch (err) {
    console.error("User create error:", err);
    return error("创建用户失败", 500);
  }
}
