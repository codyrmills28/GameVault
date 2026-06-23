import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const archiveId = params.id;

    // Find and verify archive ownership
    const archive = await prisma.archive.findUnique({
      where: { id: archiveId },
    });

    if (!archive || archive.userId !== user.id) {
      return NextResponse.json({ error: "Archive not found" }, { status: 404 });
    }

    // TODO: Future S3 integration:
    // Call S3 client delete object: s3.deleteObject({ Bucket: "...", Key: `archives/${id}.tar.gz` })

    await prisma.archive.delete({
      where: { id: archiveId },
    });

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: "DELETE_ARCHIVE",
        details: `Permanently deleted archived server '${archive.serverName}' (${archive.game}) from Vault.`,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/archives/[id] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
