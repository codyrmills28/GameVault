import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
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

    // TODO: Future Docker/Kubernetes/Pterodactyl integration:
    // Here we would call the container orchestrator to restart the container,
    // e.g. sending a restart power signal to the container daemon.

    // Simulate restart state change
    const cpuUsage = parseFloat((Math.random() * 20 + 8).toFixed(1)); // 8% - 28%
    const memoryUsage = parseFloat((server.ramAllocation * (0.45 + Math.random() * 0.25)).toFixed(1));

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
        action: "RESTART_SERVER",
        details: `Restarted game server '${server.name}' (${server.game}).`,
      },
    });

    return NextResponse.json(updatedServer);
  } catch (error) {
    console.error("POST /api/servers/[id]/restart error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
