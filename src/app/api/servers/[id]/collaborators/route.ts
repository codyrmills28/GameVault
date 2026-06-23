import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";

// GET /api/servers/[id]/collaborators
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

    // Verify server ownership
    const server = await prisma.server.findUnique({
      where: { id: serverId }
    });

    if (!server || server.userId !== user.id) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }

    const collaborators = await prisma.collaborator.findMany({
      where: { serverId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    return NextResponse.json(collaborators);
  } catch (error: any) {
    console.error("GET /api/servers/[id]/collaborators error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

// POST /api/servers/[id]/collaborators
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
    const { email, role } = await req.json();

    if (!email || !role) {
      return NextResponse.json({ error: "Email and role are required" }, { status: 400 });
    }

    const cleanRole = role.toUpperCase();
    if (!["ADMIN", "CO_HOST"].includes(cleanRole)) {
      return NextResponse.json({ error: "Invalid role value" }, { status: 400 });
    }

    // Verify server ownership
    const server = await prisma.server.findUnique({
      where: { id: serverId }
    });

    if (!server || server.userId !== user.id) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }

    // Find the invitee by email
    const invitee = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() }
    });

    if (!invitee) {
      return NextResponse.json(
        { error: "No user registered with this email on this GameVault instance." },
        { status: 404 }
      );
    }

    if (invitee.id === user.id) {
      return NextResponse.json(
        { error: "You cannot invite yourself as a collaborator." },
        { status: 400 }
      );
    }

    // Check if already a collaborator
    const existing = await prisma.collaborator.findUnique({
      where: {
        serverId_userId: {
          serverId,
          userId: invitee.id
        }
      }
    });

    if (existing) {
      return NextResponse.json(
        { error: "This user is already a collaborator on this server." },
        { status: 400 }
      );
    }

    // Create collaborator
    const collaborator = await prisma.collaborator.create({
      data: {
        serverId,
        userId: invitee.id,
        role: cleanRole
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    // Write Activity Log
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: "RESTORE_SERVER",
        details: `Invited user '${invitee.name}' (${invitee.email}) to co-manage server '${server.name}' as ${cleanRole}.`
      }
    });

    return NextResponse.json(collaborator, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/servers/[id]/collaborators error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/servers/[id]/collaborators
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const serverId = params.id;
    const { userId } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    // Verify server ownership
    const server = await prisma.server.findUnique({
      where: { id: serverId }
    });

    if (!server || server.userId !== user.id) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }

    // Delete collaborator
    await prisma.collaborator.delete({
      where: {
        serverId_userId: {
          serverId,
          userId
        }
      }
    });

    // Write Activity Log
    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: "RESTORE_SERVER",
        details: `Revoked collaborator access for '${targetUser?.name || userId}' on server '${server.name}'.`
      }
    });

    return NextResponse.json({ success: true, message: "Collaborator access revoked" });
  } catch (error: any) {
    console.error("DELETE /api/servers/[id]/collaborators error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
