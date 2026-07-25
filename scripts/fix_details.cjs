const { execSync } = require("child_process");
const path = require("path");

const ROOT = "/opt/guild-manage-platform";
const { Client } = require(path.join(ROOT, "node_modules", "pg"));

const DATABASE_URL = "postgresql://sumicowork:cKj46Xyw8tfT5znQ@127.0.0.1:5432/guild_platform";
const GID = "82203161765285899";
const CREDENTIAL_ENV = "/root/.qqcli/credentials/1/credentials.env";
const CLI = "tencent-channel-cli";

function fetchDetail(feedId) {
  const args = [
    CLI, "feed", "get-feed-detail", "--json", "--yes",
    "--feed-id", feedId, "--guild-id", GID
  ];
  try {
    const out = execSync(args.join(" "), {
      timeout: 15000, encoding: "utf-8", maxBuffer: 5 * 1024 * 1024,
      env: { ...process.env, QQ_AI_CONNECT_DOTENV: CREDENTIAL_ENV },
    });
    const d = JSON.parse(out);
    if (d.success && d.data) {
      const detail = d.data.feed || d.data;
      return {
        content: detail.content ?? null,
        share_url: detail.share_url ?? null,
        feed_type: detail.feed_type ?? null,
      };
    }
    console.error("API fail:", feedId, JSON.stringify(d.error).slice(0, 100));
  } catch (e) {
    console.error("CLI fail:", feedId, e.message?.slice(0, 80));
  }
  return null;
}

(async () => {
  const c = new Client({ connectionString: DATABASE_URL });
  await c.connect();

  const { rows } = await c.query(
    "SELECT feed_id FROM feeds WHERE status = 'active' AND content IS NULL ORDER BY create_time_raw DESC"
  );
  console.log("Total missing:", rows.length);

  let done = 0, failed = 0;
  for (const r of rows) {
    const detail = fetchDetail(r.feed_id);
    if (detail) {
      await c.query(
        "UPDATE feeds SET content = $1, share_url = $2, feed_type = $3 WHERE feed_id = $4",
        [detail.content, detail.share_url, detail.feed_type, r.feed_id]
      );
      done++;
    } else {
      failed++;
    }
    if ((done + failed) % 50 === 0 || (done + failed) <= 3) {
      console.log(done + failed, "/", rows.length, "(" + done + " ok, " + failed + " fail)");
    }
  }

  console.log("Done:", done, "updated,", failed, "failed");
  await c.end();
})();
