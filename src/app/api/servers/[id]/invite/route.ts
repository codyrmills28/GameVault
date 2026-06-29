import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import crypto from "crypto";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthenticatedUser();
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    const server = await prisma.server.findUnique({
      where: { id: params.id, userId: session.id }
    });

    if (!server) return new NextResponse("Server not found", { status: 404 });

    // Generate a random 6-character alphanumeric code
    const inviteCode = crypto.randomBytes(3).toString("hex").toUpperCase();

    const updated = await prisma.server.update({
      where: { id: server.id },
      data: { inviteCode }
    });

    return NextResponse.json({ inviteCode: updated.inviteCode });
  } catch (err: any) {
    console.error(err);
    return new NextResponse(err.message, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthenticatedUser();
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    const server = await prisma.server.findUnique({
      where: { id: params.id, userId: session.id }
    });

    if (!server) return new NextResponse("Server not found", { status: 404 });

    await prisma.server.update({
      where: { id: server.id },
      data: { inviteCode: null }
    });

    return new NextResponse(null, { status: 204 });
  } catch (err: any) {
    console.error(err);
    return new NextResponse(err.message, { status: 500 });
  }
}
