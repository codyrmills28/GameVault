import { prisma } from "./db";
import { createBackup } from "./backupService";

const globalForScheduler = globalThis as unknown as {
  schedulerInterval: NodeJS.Timeout | undefined;
};

// Periodic backup check
async function checkScheduledBackups() {
  try {
    // Find all running local servers with snapshotInterval enabled (> 0)
    const runningServers = await prisma.server.findMany({
      where: {
        status: "RUNNING",
        snapshotInterval: { gt: 0 }
      }
    });

    if (runningServers.length === 0) return;

    const now = new Date();

    for (const server of runningServers) {
      let shouldBackup = false;

      if (!server.lastSnapshotAt) {
        shouldBackup = true;
      } else {
        const lastBackupTime = new Date(server.lastSnapshotAt).getTime();
        const diffMs = now.getTime() - lastBackupTime;
        const diffHours = diffMs / (1000 * 60 * 60);

        if (diffHours >= server.snapshotInterval) {
          shouldBackup = true;
        }
      }

      if (shouldBackup) {
        console.log(`[Backup Scheduler] Triggering automated snapshot for '${server.name}' (${server.game})`);
        
        // Update database state first to prevent duplicate snapshots if zipping is slow
        await prisma.server.update({
          where: { id: server.id },
          data: { lastSnapshotAt: now }
        });

        try {
          await createBackup(server.id, "AUTOMATED");
        } catch (backupErr: any) {
          console.error(`[Backup Scheduler Error] Failed for server '${server.name}':`, backupErr.message);
        }
      }
    }
  } catch (err: any) {
    console.error("[Backup Scheduler Error] Failed checking schedules:", err.message);
  }
}

// Initializer
export function initBackupScheduler() {
  if (globalForScheduler.schedulerInterval) {
    return; // Already active
  }

  console.log("[Backup Scheduler] Initialized background local server snapshot polling loop (60s check).");
  
  // Run check immediately on start, then every 60s
  checkScheduledBackups().catch(err => console.error("Initial backup check failed:", err));
  
  globalForScheduler.schedulerInterval = setInterval(() => {
    checkScheduledBackups().catch(err => console.error("Periodic backup check failed:", err));
  }, 60000);
}
