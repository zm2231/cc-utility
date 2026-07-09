import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const BETA_HEADER = "oauth-2025-04-20";

export interface QuotaWindow {
  utilization: number;
  resets_at: string | null;
}

export interface QuotaUsage {
  five_hour: QuotaWindow | null;
  seven_day: QuotaWindow | null;
}

async function readTokenFromMacKeychain(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-s",
      "Claude Code-credentials",
      "-w",
    ]);
    const parsed = JSON.parse(stdout.trim());
    return (
      parsed?.claudeAiOauth?.accessToken ??
      parsed?.accessToken ??
      parsed?.access_token ??
      null
    );
  } catch {
    return null;
  }
}

function readTokenFromCredentialsFile(): string | null {
  const path = join(homedir(), ".claude", ".credentials.json");
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return (
      parsed?.claudeAiOauth?.accessToken ??
      parsed?.accessToken ??
      parsed?.access_token ??
      parsed?.oauth_access_token ??
      null
    );
  } catch {
    return null;
  }
}

export async function readOAuthToken(): Promise<string | null> {
  const fromEnv = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (fromEnv) return fromEnv;

  if (platform() === "darwin") {
    const fromKeychain = await readTokenFromMacKeychain();
    if (fromKeychain) return fromKeychain;
  }

  return readTokenFromCredentialsFile();
}

function parseWindow(w: Record<string, unknown>): QuotaWindow {
  const utilRaw = Number(w.utilization);
  return {
    utilization: Number.isFinite(utilRaw) ? utilRaw : 0,
    resets_at: typeof w.resets_at === "string" ? w.resets_at : null,
  };
}

export async function fetchOfficialQuota(): Promise<QuotaUsage | null> {
  const token = await readOAuthToken();
  if (!token) return null;

  try {
    const res = await fetch(USAGE_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": BETA_HEADER,
        "User-Agent": `cc-utility/0.1.0`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;

    const fiveHour = data.five_hour as Record<string, unknown> | undefined;
    const sevenDay = data.seven_day as Record<string, unknown> | undefined;

    return {
      five_hour: fiveHour ? parseWindow(fiveHour) : null,
      seven_day: sevenDay ? parseWindow(sevenDay) : null,
    };
  } catch {
    return null;
  }
}
