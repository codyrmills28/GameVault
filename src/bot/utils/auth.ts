import { prisma } from "../../lib/db";

export async function findAuthorizedServer(discordId: string, gameQuery: string | undefined) {
  if (!gameQuery) return { error: "No query provided." };

  const user = await prisma.user.findUnique({
    where: { discordId }
  });

  if (!user) return { error: "You don't have permission to use this command. Type `/link` to connect your GameVault account!" };

  const servers = await prisma.server.findMany({
    where: {
      AND: [
        { OR: [{ game: { equals: gameQuery.toLowerCase() } }, { name: { contains: gameQuery.toLowerCase() } }] },
        { OR: [{ userId: user.id }, { collaborators: { some: { userId: user.id } } }] }
      ]
    }
  });

  if (servers.length === 0) {
    return { error: `Could not find any server matching \`${gameQuery}\` that you have access to.` };
  }

  return { server: servers[0], user };
}
