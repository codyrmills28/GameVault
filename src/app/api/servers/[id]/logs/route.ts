import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { getLocalServerLogs } from "@/lib/localRunner";
import { verifyServerAccess } from "@/lib/serverAuth";

export async function GET(
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

    if (server.runnerType === "LOCAL") {
      const logs = getLocalServerLogs(server.id);
      return NextResponse.json({ logs });
    } else {
      // Return high-fidelity mock cloud logs
      const isRunning = server.status === "RUNNING";
      const timestamp = new Date().toISOString().split("T")[1].slice(0, 8);
      
      const mockCloudLogs = isRunning ? [
        `[${timestamp} INFO]: Starting ${server.game.toLowerCase()} server version 1.20.4`,
        `[${timestamp} INFO]: Loading properties`,
        `[${timestamp} INFO]: Default game type: SURVIVAL`,
        `[${timestamp} INFO]: Generating keypair`,
        `[${timestamp} INFO]: Starting OpenJDK 64-Bit Server VM on Linux`,
        `[${timestamp} INFO]: Preparing level "${server.name}"`,
        `[${timestamp} INFO]: Preparing start region for dimension minecraft:overworld`,
        `[${timestamp} INFO]: Time elapsed: 1420 ms`,
        `[${timestamp} INFO]: Done (2.145s)! For help, type "help"`
      ].join("\n") : "Server is offline. Press Start to boot the server instance.";

      return NextResponse.json({ logs: mockCloudLogs });
    }
  } catch (error) {
    console.error("GET /api/servers/[id]/logs error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
