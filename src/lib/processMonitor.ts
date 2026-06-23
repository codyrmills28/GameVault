import { exec } from "child_process";
import { prisma } from "./db";

// Global store for process monitoring intervals and history
const globalForMonitor = globalThis as unknown as {
  monitorIntervals: Map<string, NodeJS.Timeout> | undefined;
  statsHistory: Map<string, { cpu: number[]; memory: number[] }> | undefined;
  lastCpuTime: Map<string, number> | undefined;
};

if (!globalForMonitor.monitorIntervals) {
  globalForMonitor.monitorIntervals = new Map();
}
if (!globalForMonitor.statsHistory) {
  globalForMonitor.statsHistory = new Map();
}
if (!globalForMonitor.lastCpuTime) {
  globalForMonitor.lastCpuTime = new Map();
}

const monitorIntervals = globalForMonitor.monitorIntervals;
const statsHistory = globalForMonitor.statsHistory;
const lastCpuTime = globalForMonitor.lastCpuTime;

const MAX_HISTORY = 30; // ~5 minutes at 10s intervals
const SAMPLE_INTERVAL_MS = 10000;

interface ProcessStats {
  cpuPercent: number;
  memoryMB: number;
}

// Query real process stats from Windows using PowerShell
function queryProcessStats(pid: number): Promise<ProcessStats> {
  return new Promise((resolve) => {
    const cmd = `powershell -Command "$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($p) { Write-Output \"$($p.CPU),$($p.WorkingSet64)\" } else { Write-Output 'GONE' }"`;
    exec(cmd, { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout || stdout.trim() === "GONE") {
        resolve({ cpuPercent: 0, memoryMB: 0 });
        return;
      }
      const parts = stdout.trim().split(",");
      const cpuTimeSeconds = parseFloat(parts[0]) || 0;
      const workingSetBytes = parseInt(parts[1]) || 0;
      const memoryMB = parseFloat((workingSetBytes / (1024 * 1024)).toFixed(1));

      // Calculate CPU % from delta of CPU time
      const prevCpuTime = lastCpuTime.get(`${pid}`) || cpuTimeSeconds;
      const cpuDelta = cpuTimeSeconds - prevCpuTime;
      // Convert to rough % (delta seconds used / interval seconds * 100)
      const cpuPercent = parseFloat(Math.min((cpuDelta / (SAMPLE_INTERVAL_MS / 1000)) * 100, 100).toFixed(1));
      lastCpuTime.set(`${pid}`, cpuTimeSeconds);

      resolve({ cpuPercent, memoryMB });
    });
  });
}

// Start monitoring a server process
export function startMonitoring(serverId: string, pid: number): void {
  // Don't duplicate monitors
  if (monitorIntervals.has(serverId)) {
    return;
  }

  // Initialize history
  if (!statsHistory.has(serverId)) {
    statsHistory.set(serverId, { cpu: [], memory: [] });
  }

  // Initialize CPU baseline
  lastCpuTime.set(`${pid}`, 0);

  const interval = setInterval(async () => {
    try {
      const stats = await queryProcessStats(pid);
      const history = statsHistory.get(serverId);
      if (history) {
        history.cpu.push(stats.cpuPercent);
        history.memory.push(stats.memoryMB);

        // Cap at MAX_HISTORY
        if (history.cpu.length > MAX_HISTORY) history.cpu.shift();
        if (history.memory.length > MAX_HISTORY) history.memory.shift();
      }

      // Update DB with latest values (convert memoryMB to GB for display)
      await prisma.server.update({
        where: { id: serverId },
        data: {
          cpuUsage: stats.cpuPercent,
          memoryUsage: parseFloat((stats.memoryMB / 1024).toFixed(2)),
        },
      }).catch(() => {}); // Silently fail if server was deleted
    } catch (e) {
      // Silently ignore sampling errors
    }
  }, SAMPLE_INTERVAL_MS);

  monitorIntervals.set(serverId, interval);
}

// Stop monitoring a server process
export function stopMonitoring(serverId: string): void {
  const interval = monitorIntervals.get(serverId);
  if (interval) {
    clearInterval(interval);
    monitorIntervals.delete(serverId);
  }
  // Keep history around briefly so dashboard can still show the last session
}

// Get stats history for a server
export function getStatsHistory(serverId: string): { cpu: number[]; memory: number[] } {
  return statsHistory.get(serverId) || { cpu: [], memory: [] };
}

// Clear stats history (called on fresh start)
export function clearStatsHistory(serverId: string): void {
  statsHistory.delete(serverId);
}
