import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { initBackupScheduler } from "@/lib/backupScheduler";

// GET /api/servers
// Returns active servers, archived servers, subscription details, and logs
export async function GET(req: NextRequest) {
  try {
    initBackupScheduler();
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [servers, archives, logs] = await Promise.all([
      prisma.server.findMany({
        where: {
          OR: [
            { userId: user.id },
            { collaborators: { some: { userId: user.id } } }
          ]
        },
        include: {
          collaborators: {
            include: {
              user: {
                select: { name: true, email: true }
              }
            }
          }
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.archive.findMany({
        where: { userId: user.id },
        orderBy: { archivedAt: "desc" },
      }),
      prisma.activityLog.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 15,
      }),
    ]);

    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      servers,
      archives,
      activityLogs: logs,
    });
  } catch (error) {
    console.error("GET /api/servers error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/servers
// Creates a new active server, checking active slot limits
export async function POST(req: NextRequest) {
  try {
    initBackupScheduler();
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { name, game, ramAllocation, password, enableUpnp } = await req.json();

    if (!name || !game || !ramAllocation) {
      return NextResponse.json(
        { error: "Name, game, and RAM allocation are required" },
        { status: 400 }
      );
    }

    const runnerType = "LOCAL";
    const region = "LOCALHOST";

    // Validation for Valheim local servers (needs a password of at least 5 characters)
    if (game.toUpperCase() === "VALHEIM") {
      if (!password || password.length < 5) {
        return NextResponse.json(
          { error: "Valheim dedicated servers require a password of at least 5 characters" },
          { status: 400 }
        );
      }
    }

    // Generate IP and port for local server
    const ipAddress = "127.0.0.1";
    let port = 25565;
    if (game === "VALHEIM") port = 2456;
    if (game === "ZOMBOID") port = 16261;
    if (game === "ARK") port = 7777;
    if (game === "ENSHROUDED") port = 15637;
    if (game === "TERRARIA") port = 7777;
    if (game === "PALWORLD") port = 8211;
    if (game === "RUST") port = 28015;

    const newServer = await prisma.server.create({
      data: {
        userId: user.id,
        name,
        game: game.toUpperCase(),
        ramAllocation: parseFloat(ramAllocation),
        region,
        status: "STOPPED", // Server starts stopped, user can turn it on
        runnerType,
        ipAddress,
        port,
        password: password || null,
        enableUpnp: !!enableUpnp,
        cpuUsage: 0,
        memoryUsage: 0,
      },
    });

    // Create activity log
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: "CREATE_SERVER",
        details: `Deployed new local ${game} server '${name}' (${ramAllocation}GB RAM).`,
      },
    });

    return NextResponse.json(newServer, { status: 201 });
  } catch (error) {
    console.error("POST /api/servers error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
