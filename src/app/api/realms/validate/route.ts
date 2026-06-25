import { NextRequest, NextResponse } from "next/server";
import { Readable } from "stream";
import fs from "fs";
import path from "path";
import os from "os";
import * as tar from "tar";
import crypto from "crypto";
import { getAuthenticatedUser } from "@/lib/auth";



export async function POST(req: NextRequest) {
  try {
    const session = await getAuthenticatedUser();
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `realmswap-${crypto.randomBytes(8).toString('hex')}.realm`);

    if (!req.body) return new NextResponse("No file provided", { status: 400 });
    
    const nodeStream = Readable.fromWeb(req.body as any);
    const writeStream = fs.createWriteStream(tempFile);
    
    await new Promise((resolve, reject) => {
      nodeStream.pipe(writeStream).on("finish", () => resolve(true)).on("error", reject);
    });

    let manifestData = "";
    
    await tar.t({
      file: tempFile,
      onentry: entry => {
        if (entry.path === "realm.json" || entry.path === "./realm.json") {
          entry.on("data", c => manifestData += c.toString());
        } else {
          entry.resume();
        }
      }
    });

    if (!manifestData) {
      fs.unlinkSync(tempFile);
      return new NextResponse("Invalid package: Missing realm.json", { status: 400 });
    }

    const manifest = JSON.parse(manifestData);

    // Get temp file size
    const stats = fs.statSync(tempFile);
    
    return NextResponse.json({
      manifest,
      tempFile,
      sizeBytes: stats.size
    });

  } catch (err: any) {
    console.error(err);
    return new NextResponse(err.message, { status: 500 });
  }
}
