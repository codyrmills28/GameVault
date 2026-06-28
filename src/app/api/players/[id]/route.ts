import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { logPlayerEvent } from "@/lib/players/applyDeps";

async function ownedPlayer(id: string, ownerId: string) {
  return prisma.player.findFirst({ where: { id, ownerId } });
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const player = await prisma.player.findFirst({
    where: { id: params.id, ownerId: user.id },
    include: {
      bans: { where: { active: true } },
      whitelists: true,
      events: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!player) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const enforcement = await prisma.playerEnforcement.findMany({ where: { playerId: player.id } });
  return NextResponse.json({ player, enforcement });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await ownedPlayer(params.id, user.id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json();
  const fields = ["displayName", "steamId", "xboxId", "minecraftUuid", "minecraftName", "discordId", "notes"] as const;
  const data: Record<string, string | null> = {};
  for (const f of fields) if (f in body) data[f] = body[f] || null;
  const player = await prisma.player.update({ where: { id: params.id }, data });
  await logPlayerEvent(player.id, user.id, "EDITED", `Edited ${player.displayName}`);
  return NextResponse.json({ player });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await ownedPlayer(params.id, user.id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.player.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
