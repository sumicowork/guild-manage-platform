import { NextRequest } from "next/server";
import { getAuthUser, unauthorized, forbidden, success, error } from "@/lib/api-utils";
import { switchToIdentity, buildCliEnv } from "@/lib/cli/credentials";

/**
 * POST /api/cli/switch-identity — Switch the active CLI credential.
 *
 * Before running CLI operations as a different admin, call this endpoint
 * to set up the credential environment for the specified identity.
 *
 * This writes the decrypted token to a per-identity credentials file and
 * updates the QQ_AI_CONNECT_DOTENV environment for subsequent CLI calls.
 *
 * Body: { identityId: number | string }
 *
 * Response: { success: true, data: { identityId, nickname } }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();
    if (auth.role !== "admin") return forbidden();

    const body = await req.json();
    const { identityId } = body;

    if (!identityId) {
      return error("缺少参数：identityId", 400);
    }

    await switchToIdentity(BigInt(identityId));

    // Verify the credential file was created
    const cliEnv = buildCliEnv(BigInt(identityId));
    const dotenvPath = cliEnv.QQ_AI_CONNECT_DOTENV;

    return success({
      identityId: Number(identityId),
      dotenvPath: dotenvPath || null,
      message: "凭证已切换",
    });
  } catch (err) {
    console.error("Switch identity error:", err);
    return error(
      err instanceof Error ? err.message : "切换凭证失败",
      500
    );
  }
}

/**
 * GET /api/cli/switch-identity — Get current credential status.
 *
 * Returns which identity's credentials are currently set up.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();
    if (auth.role !== "admin") return forbidden();

    // Check the credential directories for available identities
    const fs = await import("fs");
    const path = await import("path");
    const os = await import("os");

    const base = process.env.CLI_CREDENTIALS_DIR || path.join(os.homedir(), ".qqcli");
    const credDir = path.join(base, "credentials");

    const available: Array<{ identityId: string; hasCredentials: boolean }> = [];

    try {
      if (fs.existsSync(credDir)) {
        const dirs = fs.readdirSync(credDir, { withFileTypes: true });
        for (const dir of dirs) {
          if (dir.isDirectory()) {
            const envFile = path.join(credDir, dir.name, "credentials.env");
            available.push({
              identityId: dir.name,
              hasCredentials: fs.existsSync(envFile),
            });
          }
        }
      }
    } catch {
      // Ignore read errors
    }

    return success({
      credentialDir: credDir,
      available,
    });
  } catch (err) {
    console.error("Switch identity status error:", err);
    return error("获取凭证状态失败", 500);
  }
}
