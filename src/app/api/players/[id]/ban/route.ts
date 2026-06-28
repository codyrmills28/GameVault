import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { applyForOwner, logPlayerEvent } from "@/lib/players/applyDeps";
import { playerStatusAfterBan, playerStatusAfterUnban } from "./status";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const player = await prisma.player.findFirst({ where: { id: params.id, ownerId: user.id } });
  if (!player) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const reason: string = body?.reason || "No reason given";
  const expiresAt = body?.expiresAt ? new Date(body.expiresAt) : null;

  await prisma.playerBan.updateMany({ where: { playerId: player.id, active: true }, data: { active: false } });
  await prisma.playerBan.create({ data: { playerId: player.id, reason, expiresAt } });
  await prisma.player.update({ where: { id: player.id }, data: { status: playerStatusAfterBan() } });

  const results = await applyForOwner(user.id, player, { type: "BAN", op: "add", reason });
  await logPlayerEvent(player.id, user.id, "BANNED", `Banned: ${reason}`);
  return NextResponse.json({ success: true, results });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const player = await prisma.player.findFirst({ where: { id: params.id, ownerId: user.id }, include: { whitelists: true } });
  if (!player) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.playerBan.updateMany({ where: { playerId: player.id, active: true }, data: { active: false } });
  await prisma.player.update({ where: { id: player.id }, data: { status: playerStatusAfterUnban(player.whitelists.length > 0) } });

  const results = await applyForOwner(user.id, player, { type: "BAN", op: "remove" });
  await logPlayerEvent(player.id, user.id, "UNBANNED", "Ban lifted");
  return NextResponse.json({ success: true, results });
}
