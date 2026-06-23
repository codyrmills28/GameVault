import { prisma } from "@/lib/db";

export async function verifyServerAccess(serverId: string, userId: string) {
  const server = await prisma.server.findUnique({
    where: { id: serverId }
  });

  if (!server) return null;

  if (server.userId === userId) {
    return { server, isOwner: true, isCollaborator: false };
  }

  const collaborator = await prisma.collaborator.findFirst({
    where: { serverId, userId }
  });

  if (collaborator) {
    return { server, isOwner: false, isCollaborator: true };
  }

  return null;
}
