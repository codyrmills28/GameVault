import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { startLocalServer } from "@/lib/localRunner";
import { verifyServerAccess } from "@/lib/serverAuth";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const serverId = params.id;

    // Find and verify server access
    const access = await verifyServerAccess(serverId, user.id);
    if (!access) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }
    const { server } = access;

    // Handle Local Runner
    if (server.runnerType === "LOCAL") {
      try {
        await startLocalServer(server.id, server.game, server.ramAllocation);
        
        // Fetch the updated server record from DB
        const updated = await prisma.server.findUnique({
          where: { id: serverId }
        });
        return NextResponse.json(updated);
      } catch (err: any) {
        // The start failed (e.g. SteamCMD install error). startLocalServer may have set the
        // status to STARTING; reset it to STOPPED so the server isn't stuck and can be retried.
        await prisma.server.update({
          where: { id: serverId },
          data: { status: "STOPPED", pid: null, cpuUsage: 0, memoryUsage: 0 },
        }).catch(() => {});
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
    }

    // TODO: Future Docker/Kubernetes/Pterodactyl integration:
    // Here we would call the server orchestrator API (e.g. `POST /api/client/servers/{id}/power`)
    // to start the Docker container running the game process.
    
    // Simulate live CPU/RAM usage
    const cpuUsage = parseFloat((Math.random() * 15 + 5).toFixed(1)); // 5% - 20%
    const memoryUsage = parseFloat((server.ramAllocation * (0.4 + Math.random() * 0.3)).toFixed(1)); // 40%-70% of RAM

    const updatedServer = await prisma.server.update({
      where: { id: serverId },
      data: {
        status: "RUNNING",
        cpuUsage,
        memoryUsage,
      },
    });

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: "START_SERVER",
        details: `Started game server '${server.name}' (${server.game}).`,
      },
    });

    return NextResponse.json(updatedServer);
  } catch (error) {
    console.error("POST /api/servers/[id]/start error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
