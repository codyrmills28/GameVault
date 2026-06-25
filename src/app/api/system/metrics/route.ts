import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import os from "os";

export async function GET() {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    
    // Return memory in GB
    return NextResponse.json({
      memory: {
        totalGB: totalMemory / (1024 * 1024 * 1024),
        freeGB: freeMemory / (1024 * 1024 * 1024)
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
