import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { applyForOwner, logPlayerEvent } from "@/lib/players/applyDeps";
import { validateBulkRequest } from "./validate";
import { resolveTargetServerIds } from "../[id]/whitelist/targets";

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = validateBulkRequest(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { playerIds, action, reason, serverIds, all } = parsed.value;

  const players = await prisma.player.findMany({
    where: { id: { in: playerIds }, ownerId: user.id },
  });

  const results: Record<string, any> = {};

  // Hoist owned-server fetch outside the loop (only needed once per user, not per player)
  const owned = (
    await prisma.server.findMany({
      where: { userId: user.id },
      select: { id: true },
    })
  ).map((s) => s.id);

  for (const player of players) {
    if (action === "delete") {
      await prisma.player.delete({ where: { id: player.id } });
      results[player.id] = "deleted";
      continue;
    }

    if (action === "ban") {
      await prisma.playerBan.updateMany({
        where: { playerId: player.id, active: true },
        data: { active: false },
      });
      await prisma.playerBan.create({
        data: { playerId: player.id, reason: reason || "Bulk ban" },
      });
      await prisma.player.update({
        where: { id: player.id },
        data: { status: "BANNED" },
      });
      results[player.id] = await applyForOwner(user.id, player, {
        type: "BAN",
        op: "add",
        reason,
      });
      await logPlayerEvent(
        player.id,
        user.id,
        "BANNED",
        `Bulk ban: ${reason || "Bulk ban"}`,
      );
    }

    if (action === "whitelist") {
      const targets = resolveTargetServerIds({ serverIds, all }, owned);
      for (const sid of targets) {
        await prisma.playerWhitelist.upsert({
          where: { playerId_serverId: { playerId: player.id, serverId: sid } },
          update: {},
          create: { playerId: player.id, serverId: sid },
        });
      }
      results[player.id] = await applyForOwner(
        user.id,
        player,
        { type: "WHITELIST", op: "add" },
        { serverIds: targets },
      );
      await logPlayerEvent(
        player.id,
        user.id,
        "WHITELISTED",
        `Bulk whitelist on ${targets.length} server(s)`,
      );
    }
  }

  return NextResponse.json({ success: true, results });
}
