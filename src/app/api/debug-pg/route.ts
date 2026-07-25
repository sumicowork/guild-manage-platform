import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const pg = require("pg");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

    const today = new Date();
    const monthAgo = new Date(today.getTime() - 30 * 86400000);
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    const r = await pool.query(
      "SELECT COUNT(*) as cnt FROM feeds WHERE create_time >= $1",
      [fmt(monthAgo)]
    );

    await pool.end();

    return Response.json({
      DATABASE_URL_exists: !!process.env.DATABASE_URL,
      pg_version: require("pg/package.json").version,
      feed_count_30d: Number(r.rows[0].cnt),
      success: true,
    });
  } catch (e: any) {
    return Response.json({ error: e.message, success: false }, { status: 500 });
  }
}
