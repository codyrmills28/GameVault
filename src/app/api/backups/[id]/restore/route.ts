import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { restoreBackup } from "@/lib/backupService";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const backupId = params.id;

    // Verify ownership
    const backup = await prisma.backup.findUnique({
      where: { id: backupId }
    });

    if (!backup || backup.userId !== user.id) {
      return NextResponse.json({ error: "Backup snapshot not found" }, { status: 404 });
    }

    // Call restore logic
    await restoreBackup(backupId);

    return NextResponse.json({ success: true, message: "Backup snapshot restored successfully" });
  } catch (error: any) {
    console.error("POST /api/backups/[id]/restore error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
