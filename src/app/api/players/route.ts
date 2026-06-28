import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { logPlayerEvent } from "@/lib/players/applyDeps";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const players = await prisma.player.findMany({
    where: { ownerId: user.id },
    orderBy: { displayName: "asc" },
    include: { bans: { where: { active: true } }, whitelists: true },
  });
  return NextResponse.json({ players });
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  if (!body?.displayName || typeof body.displayName !== "string") {
    return NextResponse.json({ error: "displayName is required" }, { status: 400 });
  }
  const player = await prisma.player.create({
    data: {
      ownerId: user.id,
      displayName: body.displayName,
      steamId: body.steamId || null,
      xboxId: body.xboxId || null,
      minecraftUuid: body.minecraftUuid || null,
      minecraftName: body.minecraftName || null,
      discordId: body.discordId || null,
      notes: body.notes || null,
    },
  });
  await logPlayerEvent(player.id, user.id, "PLAYER_CREATED", `Created ${player.displayName}`);
  return NextResponse.json({ player }, { status: 201 });
}
