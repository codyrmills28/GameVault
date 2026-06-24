import fs from "fs";
import path from "path";
import net from "net";
import { dataRoot } from "./appPaths";

/**
 * Checks if a TCP port is currently available on all interfaces.
 */
export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.once('error', (err: any) => {
      resolve(false);
    });

    server.once('listening', () => {
      server.close();
      resolve(true);
    });

    server.listen(port);
  });
}

/**
 * Gets the free disk space in GB on the drive containing the specified directory.
 * Falls back to 9999 (bypassing the check) if the OS does not support statfs or permission is denied.
 */
export async function getFreeDiskSpaceGB(dir: string): Promise<number> {
  try {
    // If the exact directory doesn't exist, check its parent (or dataRoot)
    let checkDir = dir;
    while (!fs.existsSync(checkDir) && checkDir !== path.parse(checkDir).root) {
      checkDir = path.dirname(checkDir);
    }

    const stats = await fs.promises.statfs(checkDir);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    return freeBytes / (1024 * 1024 * 1024);
  } catch (err) {
    console.error(`Failed to check disk space for ${dir}:`, err);
    return 9999; // Fallback so we don't accidentally brick deployments on unsupported platforms
  }
}

/**
 * Checks if SteamCMD is currently downloaded and configured in the data root.
 */
export function isSteamCmdInstalled(): boolean {
  const exePath = path.join(dataRoot(), "steamcmd", "steamcmd.exe");
  return fs.existsSync(exePath);
}
