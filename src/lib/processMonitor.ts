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
const errorCounts = new Map<string, number>();

const MAX_HISTORY = 30; // ~5 minutes at 10s intervals
const SAMPLE_INTERVAL_MS = 10000;

interface ProcessStats {
  cpuPercent: number;
  memoryMB: number;
}

// Query real process stats from Windows using PowerShell.
//
// We aggregate over the ENTIRE process tree rooted at `pid`, not just `pid` itself.
// Several games (Palworld, ARK) launch via a thin launcher .exe that immediately
// spawns the real, heavy game-server process as a child (e.g. PalServer.exe spawns
// PalServer-Win64-Shipping-Cmd.exe). The tracked PID is the launcher's, so sampling
// it alone reports near-idle usage. Walking the descendant tree captures the real
// server. For single-process games the tree is just the one process, so behavior is
// unchanged. This does not affect liveness/crash detection, which is driven entirely
// by the parent process's "exit" event in localRunner (handleProcessExit).
function queryProcessStats(pid: number): Promise<ProcessStats> {
  return new Promise((resolve, reject) => {
    // One PowerShell call: build a ParentProcessId map of all processes, DFS from the
    // root PID, and sum WorkingSetSize (bytes) and CPU time (Kernel+User, 100ns units
    // -> seconds). Emits "<cpuSeconds>,<workingSetBytes>" or 'GONE' if the root is dead.
    const cmd = `powershell -NoProfile -Command "$ErrorActionPreference='SilentlyContinue'; $root=${pid}; $all=Get-CimInstance Win32_Process; $map=@{}; $kids=@{}; foreach($p in $all){ $id=[int]$p.ProcessId; $par=[int]$p.ParentProcessId; $map[$id]=$p; if(-not $kids.ContainsKey($par)){ $kids[$par]=New-Object System.Collections.ArrayList }; [void]$kids[$par].Add($id) }; if(-not $map.ContainsKey($root)){ Write-Output 'GONE'; exit }; $stack=New-Object System.Collections.Stack; [void]$stack.Push($root); $seen=@{}; $ws=0.0; $cpu=0.0; while($stack.Count -gt 0){ $cur=$stack.Pop(); if($seen.ContainsKey($cur)){ continue }; $seen[$cur]=$true; $proc=$map[$cur]; if($proc){ $ws+=[double]$proc.WorkingSetSize; $cpu+=([double]$proc.KernelModeTime+[double]$proc.UserModeTime)/10000000.0; if($kids.ContainsKey($cur)){ foreach($c in $kids[$cur]){ [void]$stack.Push($c) } } } }; Write-Output ([string]$cpu + ',' + [string]$ws)"`;
    exec(cmd, { timeout: 5000 }, (err, stdout) => {
      if (stdout && stdout.trim() === "GONE") {
        resolve({ cpuPercent: 0, memoryMB: 0 });
        return;
      }
      if (err) {
        reject(new Error(`PowerShell process stats failed: ${err.message}`));
        return;
      }
      if (!stdout) {
        resolve({ cpuPercent: 0, memoryMB: 0 });
        return;
      }
      const parts = stdout.trim().split(",");
      const cpuTimeSeconds = parseFloat(parts[0]) || 0;
      const workingSetBytes = parseInt(parts[1]) || 0;
      const memoryMB = parseFloat((workingSetBytes / (1024 * 1024)).toFixed(1));

      // Calculate CPU % from delta of aggregate CPU time
      const prevCpuTime = lastCpuTime.get(`${pid}`) || cpuTimeSeconds;
      const cpuDelta = cpuTimeSeconds - prevCpuTime;
      // Convert to rough % (delta seconds used / interval seconds * 100). Clamp to
      // [0, 100]: the tree total can dip when a transient child exits, which would
      // otherwise produce a spurious negative reading.
      const cpuPercent = parseFloat(Math.max(0, Math.min((cpuDelta / (SAMPLE_INTERVAL_MS / 1000)) * 100, 100)).toFixed(1));
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

      // Reset error count on success
      if ((errorCounts.get(serverId) || 0) > 0) {
        errorCounts.set(serverId, 0);
        await prisma.server.update({
          where: { id: serverId },
          data: { healthStatus: "OK" }
        }).catch(() => {});
      }

      // Update DB with latest values (convert memoryMB to GB for display)
      await prisma.server.update({
        where: { id: serverId },
        data: {
          cpuUsage: stats.cpuPercent,
          memoryUsage: parseFloat((stats.memoryMB / 1024).toFixed(2)),
        },
      }).catch(() => {}); // Silently fail if server was deleted
    } catch (e: any) {
      // Handle sampling errors
      const fails = (errorCounts.get(serverId) || 0) + 1;
      errorCounts.set(serverId, fails);

      if (fails === 3) { // After 3 consecutive failures (~30s), mark degraded and alert
        console.error(`[Process Monitor Error] Server ${serverId}:`, e.message);
        
        await prisma.server.update({
          where: { id: serverId },
          data: { healthStatus: "DEGRADED" }
        }).catch(() => {});

        const server = await prisma.server.findUnique({ where: { id: serverId } }).catch(() => null);
        if (server) {
          await prisma.activityLog.create({
            data: {
              userId: server.userId,
              action: "SYSTEM_ERROR",
              details: `Process monitoring failed for ${server.name} (DEGRADED). Error: ${e.message}`
            }
          }).catch(() => {});
        }
      }
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
