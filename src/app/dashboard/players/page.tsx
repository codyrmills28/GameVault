import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import PlayersView from "@/components/PlayersView";

export const dynamic = "force-dynamic";

export default async function PlayersPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/start");

  const [players, servers] = await Promise.all([
    prisma.player.findMany({
      where: { ownerId: user.id },
      orderBy: { displayName: "asc" },
      include: { bans: { where: { active: true } }, whitelists: true },
    }),
    prisma.server.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, game: true },
    }),
  ]);

  return (
    <PlayersView
      initialPlayers={JSON.parse(JSON.stringify(players))}
      servers={servers}
      userName={user.name}
    />
  );
}
