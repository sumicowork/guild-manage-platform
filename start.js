/**
 * 容器/平台统一启动入口
 *
 * 在只允许填写一个启动命令的容器环境中使用：
 *   node start.js
 *
 * 它会依次执行：db push → 数据迁移检查 → next start（前台）
 */
const { execSync, spawn } = require("child_process");
const path = require("path");

const ROOT = __dirname;

async function main() {
  console.log("================================================");
  console.log("  频道管理平台 — 启动入口");
  console.log("================================================");

  // 1. Prisma 生成 + 数据库结构更新
  console.log("[1/4] 更新数据库结构...");
  try {
    execSync("npx prisma generate", { cwd: ROOT, stdio: "pipe" });
    console.log("  ✓ Prisma Client 已生成");
  } catch (e) {
    console.log("  ⚠ generate warning:", e.stderr?.toString().slice(0, 200));
  }
  try {
    execSync("npx prisma db push --accept-data-loss", {
      cwd: ROOT,
      stdio: "pipe",
    });
    console.log("  ✓ 数据库结构已更新");
  } catch (e) {
    console.error("  ✗ 数据库结构更新失败:", e.stderr?.toString().slice(0, 300));
    console.log("  → 继续尝试启动...");
  }

  // 2. 检查并导入初始数据
  console.log("[2/4] 检查数据状态...");
  try {
    const { PrismaClient } = require("./src/generated/prisma/client");
    const prisma = new PrismaClient();
    const count = await prisma.feed.count();
    await prisma.$disconnect();

    if (count === 0) {
      console.log("  → 数据库为空");
      const jsonDir = process.env.JSON_DATA_DIR || ROOT;
      const fs = require("fs");
      const jsonFile = path.join(
        jsonDir,
        "82203161765285899_20260528_151950.json"
      );
      if (fs.existsSync(jsonFile)) {
        console.log("[3/4] 从 JSON 导入历史数据...");
        // 将 JSON 目录中的所有 .json 文件复制到 output/ 目录
        // 会自动匹配伴生文件: *_comments.json, *_detail.json
        const outputDir = path.join(ROOT, "output");
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
        const jsonFiles = fs.readdirSync(jsonDir).filter(f => f.endsWith(".json"));
        for (const f of jsonFiles) {
          fs.copyFileSync(path.join(jsonDir, f), path.join(outputDir, f));
        }
        console.log(`  来源: ${jsonDir}, 共 ${jsonFiles.length} 个文件`);
        try {
          execSync(`npx tsx scripts/migrate-data.ts`, {
            cwd: ROOT,
            stdio: "inherit",
            timeout: 300000, // 5min
          });
          console.log("  ✓ 历史数据导入完成");
        } catch (e) {
          console.log("  ⚠ 数据导入失败:", e.message);
          console.log("  → 跳过导入，可以后续手动执行");
        }
      } else {
        console.log("  → 未找到 JSON 数据文件，跳过导入");
      }
    } else {
      console.log(`  → 数据库已有 ${count} 条帖子，跳过导入`);
    }
  } catch (e) {
    console.log("  ⚠ 数据检查失败:", e.message);
    console.log("  → 跳过导入步骤");
  }

  // 4. 启动 Next.js 服务
  console.log("================================================");
  console.log("  启动服务：端口 " + (process.env.PORT || "3000"));
  console.log("================================================");

  // 必须用 spawn + stdio:inherit 保持前台进程
  const next = spawn("npx", ["next", "start"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env },
  });

  next.on("exit", (code) => {
    console.log(`Next.js 进程退出，code=${code}`);
    process.exit(code || 1);
  });
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
