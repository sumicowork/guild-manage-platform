/**
 * 容器/平台统一启动入口
 *
 * 在只允许填写一个启动命令的容器环境中使用：
 *   node start.js
 *
 * 它会依次执行：db push → 验证连接 → 数据导入 → 构建（如无）→ next start（前台）
 */
const { execSync, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");

// 加载 .env 文件（如果有）
try { require("dotenv").config(); } catch {}

const ROOT = __dirname;
const PG_URL = process.env.DATABASE_URL || "";

function log(msg) {
  console.log(msg);
}

function run(cmd, opts = {}) {
  const defaults = { cwd: ROOT, stdio: "pipe", timeout: 120000, encoding: "utf-8" };
  return execSync(cmd, { ...defaults, ...opts });
}

async function query(sql) {
  if (!PG_URL) throw new Error("DATABASE_URL 未设置");
  const pool = new Pool({ connectionString: PG_URL, max: 1, connectionTimeoutMillis: 10000 });
  try {
    const result = await pool.query(sql);
    return result;
  } finally {
    await pool.end();
  }
}

async function checkDbHasData() {
  // 方法1：psql 直查
  try {
    const out = run(
      `psql "${PG_URL}" -c "SELECT COUNT(*) FROM feeds" -t -A 2>/dev/null || echo "-1"`,
      { timeout: 10000 }
    );
    const n = parseInt(out.trim(), 10);
    if (n >= 0) return n;
  } catch {}

  // 方法2：pg 直连
  try {
    const r = await query("SELECT COUNT(*) AS cnt FROM feeds");
    const n = parseInt(r.rows[0].cnt, 10);
    return isNaN(n) ? 0 : n;
  } catch (e) {
    log("  ⚠ 数据库查询失败: " + (e.message || "").slice(0, 200));
    return null;
  }
}

async function verifyDb() {
  const pool = new Pool({ connectionString: PG_URL, max: 1, connectionTimeoutMillis: 10000 });
  try {
    const client = await pool.connect();
    log("  ✓ 数据库连接成功");
    client.release();
  } finally {
    await pool.end();
  }
}

async function main() {
  log("================================================");
  log("  频道管理平台 — 容器启动入口");
  log("================================================");

  // 打印数据库地址（隐藏密码）
  const dbUrlShort = PG_URL
    ? PG_URL.replace(/\/\/[^:]+:[^@]+@/, "//***:***@")
    : "(未设置)";
  log("  数据库: " + dbUrlShort);

  // ─── 1. 确认数据库结构 ───
  log("[1/5] 更新数据库结构...");
  try {
    run("npx prisma generate", { stdio: "pipe" });
    log("  ✓ Prisma Client 已生成");
  } catch (e) {
    log("  ⚠ generate: " + (e.stderr || e.message).slice(0, 200));
  }
  try {
    run("npx prisma db push --accept-data-loss", { stdio: "pipe" });
    log("  ✓ 数据库结构已更新");
  } catch (e) {
    log("  ✗ db push 失败: " + (e.stderr || e.message).slice(0, 200));
    log("  → 数据库可能未就绪，继续尝试启动...");
  }

  // ─── 2. 验证数据库连接 ───
  log("[2/5] 验证数据库连接...");
  try {
    await verifyDb();
  } catch (e) {
    log("  ✗ 数据库不可用，无法启动服务");
    log("  → 原因: " + (e.message || e).toString().slice(0, 500));
    log("");
    log("  请检查:");
    log("  1. DATABASE_URL 环境变量是否正确设置");
    log("  2. PostgreSQL 是否在运行且可从本容器访问");
    log("  3. 网络/防火墙是否放行");
    process.exit(1);
  }

  // ─── 3. 检查数据并导入 ───
  log("[3/5] 检查数据状态...");
  const count = await checkDbHasData();

  // 只有明确查到有数据才跳过导入
  if (count !== null && count > 0) {
    log(`  → 数据库已有 ${count} 条帖子记录，跳过导入`);
  } else {
    if (count === null) {
      log("  ⚠ 无法查询数据库，尝试直接导入...");
    } else {
      log("  → 数据库为空");
    }
    const jsonDir = process.env.JSON_DATA_DIR || path.join(ROOT, "output");
    const mainJson = path.join(jsonDir, "82203161765285899_20260528_151950.json");

    if (fs.existsSync(mainJson)) {
      log("  → 从 JSON 导入历史数据...");
      // 确保 output/ 目录存在并包含所有 JSON
      const outDir = path.join(ROOT, "output");
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const jsonFiles = fs.readdirSync(jsonDir).filter((f) => f.endsWith(".json"));
      for (const f of jsonFiles) {
        const src = path.join(jsonDir, f);
        if (fs.statSync(src).isFile()) {
          fs.copyFileSync(src, path.join(outDir, f));
        }
      }
      log(`  → 复制了 ${jsonFiles.length} 个 JSON 文件`);

      try {
        run("npx tsx scripts/migrate-data.ts", {
          stdio: "inherit",
          timeout: 600000, // 10min
          env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
        });
        log("  ✓ 历史数据导入完成");
      } catch (e) {
        log("  ⚠ 数据导入失败: " + e.message);
        log("  → 跳过，可后续手动执行 npm run migrate");
      }
    } else {
      log("  → 未找到 JSON 文件（期待路径: " + mainJson + "）");
      log("  → 跳过导入");
    }
  }

  // ─── 4. 确保构建存在 ───
  const buildIdPath = path.join(ROOT, ".next", "BUILD_ID");
  if (!fs.existsSync(buildIdPath)) {
    log("[4/5] 未检测到生产构建，正在构建...");
    try {
      run("npm run build", { stdio: "inherit", timeout: 300000 });
      log("  ✓ 构建完成");
    } catch (e) {
      log("  ✗ 构建失败: " + e.message);
      log("  → 构建失败，服务可能无法正常启动");
    }
  } else {
    log("  ✓ 生产构建已存在");
  }

  // ─── 5. 启动 Next.js 服务（前台进程） ───
  log("================================================");
  log("[5/5] 启动服务：端口 " + (process.env.PORT || "3000"));
  log("================================================");

  const next = spawn("node", ["./node_modules/.bin/next", "start"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env },
  });

  next.on("exit", (code) => {
    log("Next.js 进程退出，code=" + code);
    process.exit(code || 1);
  });

  process.on("SIGTERM", () => {
    next.kill("SIGTERM");
  });
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
