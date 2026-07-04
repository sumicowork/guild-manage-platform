import { prisma } from "@/lib/db";

/**
 * Periodically checks admin identity credential health and updates DB status.
 * Runs CLI `status` against each identity that has a stored token.
 */

/** Run a full identity health check cycle */
export async function runIdentityHealthCheck(): Promise<void> {
  console.log("[IdentityHealth] Starting identity health check...");
  const identities = await prisma.adminIdentity.findMany({
    select: { id: true, nickname: true, token: true },
  });

  const toCheck = identities.filter((i) => i.token && i.token.length > 0);
  if (toCheck.length === 0) {
    console.log("[IdentityHealth] No identities with tokens to check.");
    return;
  }

  const { switchToIdentity } = await import("@/lib/cli/credentials");
  const { spawn } = await import("child_process");
  const path = await import("path");

  const cliPath = process.env.CLI_PATH || "tencent-channel-cli";
  let updated = 0;

  for (const identity of toCheck) {
    try {
      // Switch to this identity to set up the credential env
      await switchToIdentity(identity.id);

      // Run CLI status
      const result = await new Promise<boolean>((resolve) => {
        const child = spawn(cliPath, ["login", "status", "--json"], {
          env: { ...process.env },
          timeout: 15000,
        });
        let out = "";
        child.stdout.on("data", (d: Buffer) => (out += d.toString()));
        child.on("close", (code: number) => {
          if (code !== 0) return resolve(false);
          try {
            const parsed = JSON.parse(out.trim());
            resolve(!!parsed?.data?.valid);
          } catch {
            resolve(false);
          }
        });
        child.on("error", () => resolve(false));
      });

      const newStatus = result ? "active" : "expired";
      await prisma.adminIdentity.update({
        where: { id: identity.id },
        data: { status: newStatus },
      });
      console.log(
        `[IdentityHealth] ${identity.nickname}: ${result ? "valid" : "expired"} → status=${newStatus}`
      );
      updated++;
    } catch (err) {
      console.error(
        `[IdentityHealth] Failed to check ${identity.nickname}:`,
        err
      );
    }
  }

  console.log(`[IdentityHealth] Done. Checked ${updated}/${toCheck.length} identities.`);
}
