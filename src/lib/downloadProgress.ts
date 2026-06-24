export interface ProgressState {
  phase: string;          // e.g. "steam", "download", "extract", "script"
  percent: number | null; // 0..100, or null = indeterminate
  label: string;          // human label, e.g. "Downloading Valheim 42%"
  updatedAt: number;      // epoch ms
}

// globalThis-backed so the store survives Next.js dev hot-reloads (same pattern as
// localProcesses in localRunner.ts).
const globalForProgress = globalThis as unknown as {
  downloadProgress: Map<string, ProgressState> | undefined;
};

if (!globalForProgress.downloadProgress) {
  globalForProgress.downloadProgress = new Map();
}

const store = globalForProgress.downloadProgress;

export function setProgress(serverId: string, partial: Partial<ProgressState>): void {
  const existing = store.get(serverId) ?? { phase: "", percent: null, label: "", updatedAt: 0 };
  store.set(serverId, {
    phase: partial.phase ?? existing.phase,
    // Use `!== undefined` so an explicit null (indeterminate) is honored.
    percent: partial.percent !== undefined ? partial.percent : existing.percent,
    label: partial.label ?? existing.label,
    updatedAt: Date.now(),
  });
}

export function getProgress(serverId: string): ProgressState | null {
  return store.get(serverId) ?? null;
}

export function clearProgress(serverId: string): void {
  store.delete(serverId);
}

// Extracts the numeric progress from a SteamCMD status line, e.g.
// "Update state (0x61) downloading, progress: 42.66 (123 / 456)" -> 42.66
export function parseSteamProgress(line: string): number | null {
  const m = line.match(/progress:\s*(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const val = parseFloat(m[1]);
  if (!Number.isFinite(val)) return null;
  return Math.max(0, Math.min(100, val));
}

// Returns received/total as a 0..100 percent, or null when total is unknown/invalid.
export function computePercent(received: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(received) || received < 0) return null;
  return Math.max(0, Math.min(100, (received / total) * 100));
}
