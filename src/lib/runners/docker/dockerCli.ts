import type { PortPlan } from "../../definitions/plan";
import type { ProcessStats } from "../types";

/** Quote a single shell token for a `bash -lc` command line. Safe tokens
 *  (letters, digits, and a small set of punctuation) are returned as-is. */
export function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_./:=+\-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** Convert a Docker memory token (e.g. "123MiB", "2GiB") to megabytes. */
export function parseMemToMB(token: string): number {
  const m = token.trim().match(/^([\d.]+)\s*([KMGT]?i?B)?$/i);
  if (!m) return 0;
  const value = parseFloat(m[1]);
  if (isNaN(value)) return 0;
  const unit = (m[2] || "MiB").toLowerCase();
  if (unit.startsWith("k")) return value / 1024;
  if (unit.startsWith("g")) return value * 1024;
  if (unit.startsWith("t")) return value * 1024 * 1024;
  if (unit === "b") return value / (1024 * 1024);
  return value; // MiB / MB
}

/** Parse `docker stats --no-stream --format "{{.CPUPerc}},{{.MemUsage}}"`. */
export function parseDockerStats(output: string): ProcessStats {
  const trimmed = output.trim();
  if (!trimmed) return { cpuPercent: 0, memoryMB: 0 };
  const [cpuStr = "", memPart = ""] = trimmed.split(",");
  const cpuPercent = parseFloat(cpuStr.replace("%", "")) || 0;
  const memUsed = memPart.split("/")[0]?.trim() ?? "";
  return { cpuPercent, memoryMB: parseMemToMB(memUsed) };
}

/** Shell command run as the container entrypoint: SteamCMD install/validate,
 *  then exec the server binary from the install dir. */
export function buildStartEntrypoint(
  appId: string,
  installSubDir: string,
  executable: string,
  args: string[],
): string {
  const quoted = args.map(shellQuote).join(" ");
  const execLine = quoted ? `exec ./${executable} ${quoted}` : `exec ./${executable}`;
  return (
    `steamcmd +force_install_dir /data/${installSubDir} +login anonymous` +
    ` +app_update ${appId} validate +quit` +
    ` && cd /data/${installSubDir} && ${execLine}`
  );
}

export interface DockerRunOptions {
  containerName: string;
  image: string;
  hostDataDir: string;
  ports: PortPlan[];
  entrypoint: string;
  env?: Record<string, string>;
}

/** Build the argv for `docker run -d ...` (consumed by execFile, no shell). */
export function buildRunArgs(o: DockerRunOptions): string[] {
  const args = ["run", "-d", "--name", o.containerName, "-v", `${o.hostDataDir}:/data`];
  for (const p of o.ports) {
    args.push("-p", `${p.port}:${p.port}/${p.protocol.toLowerCase()}`);
  }
  if (o.env) {
    for (const [k, v] of Object.entries(o.env)) args.push("-e", `${k}=${v}`);
  }
  args.push(o.image, "bash", "-lc", o.entrypoint);
  return args;
}
