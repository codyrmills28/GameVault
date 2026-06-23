import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { stopLocalServer } from "@/lib/localRunner";
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

    // Handle Local Runner shutdown
    if (server.runnerType === "LOCAL") {
      try {
        await stopLocalServer(server.id);
        
        const updated = await prisma.server.findUnique({
          where: { id: serverId }
        });
        return NextResponse.json(updated);
      } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
    }

    // TODO: Future Docker/Kubernetes/Pterodactyl integration:
    // Here we would call the container API to gracefully stop/kill the container process.

    const updatedServer = await prisma.server.update({
      where: { id: serverId },
      data: {
        status: "STOPPED",
        cpuUsage: 0,
        memoryUsage: 0,
      },
    });

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: "STOP_SERVER",
        details: `Stopped game server '${server.name}' (${server.game}).`,
      },
    });

    return NextResponse.json(updatedServer);
  } catch (error) {
    console.error("POST /api/servers/[id]/stop error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
