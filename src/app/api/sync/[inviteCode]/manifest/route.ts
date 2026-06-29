import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: { inviteCode: string } }) {
  try {
    const server = await prisma.server.findUnique({
      where: { inviteCode: params.inviteCode },
      include: {
        mods: true,
        definition: true,
      }
    });

    if (!server) {
      return new NextResponse("Invalid invite code", { status: 404 });
    }

    // Determine public address to connect to
    const address = `${server.ipAddress}:${server.port}`;

    const manifest = {
      serverName: server.name,
      game: server.game,
      gameVersion: "latest", // We could potentially pull this from snapshots or definition
      address,
      mods: server.mods.map(m => ({
        provider: m.provider,
        packageId: m.packageId,
        version: m.version,
        name: m.name,
        dependencies: m.dependencies ? JSON.parse(m.dependencies) : []
      })),
      configDownloadUrl: `/api/sync/${params.inviteCode}/configs`
    };

    return NextResponse.json(manifest);
  } catch (err: any) {
    console.error(err);
    return new NextResponse(err.message, { status: 500 });
  }
}
