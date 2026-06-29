import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import path from "path";
import fs from "fs";
import * as tar from "tar";
import { Readable, PassThrough } from "stream";

export async function GET(req: NextRequest, { params }: { params: { inviteCode: string } }) {
  try {
    const server = await prisma.server.findUnique({
      where: { inviteCode: params.inviteCode }
    });

    if (!server) {
      return new NextResponse("Invalid invite code", { status: 404 });
    }

    const dataDir = process.env.GAMEVAULT_DATA_DIR || process.cwd();
    const serverPath = server.localPath || path.join(dataDir, "local-servers", server.id);

    if (!fs.existsSync(serverPath)) {
      return new NextResponse("Server files not found", { status: 404 });
    }

    // Determine config directories to sync based on the game
    const pathsToSync: string[] = [];
    
    // Check common config locations
    const possiblePaths = ["config", "BepInEx/config", "plugins"];
    
    for (const p of possiblePaths) {
      if (fs.existsSync(path.join(serverPath, p))) {
        pathsToSync.push(p);
      }
    }

    if (pathsToSync.length === 0) {
      return new NextResponse("No configurations found to sync", { status: 404 });
    }

    const tarStream = tar.c({
      gzip: true,
      cwd: serverPath,
    }, pathsToSync);

    const passThrough = new PassThrough();
    tarStream.pipe(passThrough);

    const webStream = Readable.toWeb(passThrough as any);

    const filename = `${server.name.replace(/[^a-zA-Z0-9]/g, "_")}_configs.tar.gz`;

    return new NextResponse(webStream as any, {
      headers: {
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": "application/x-gzip",
      }
    });

  } catch (err: any) {
    console.error("CONFIG SYNC ERROR:", err);
    return new NextResponse(err.message, { status: 500 });
  }
}
