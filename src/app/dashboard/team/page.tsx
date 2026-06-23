import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import TeamView from "@/components/TeamView";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch only servers owned by the user
  const servers = await prisma.server.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" }
  });

  return <TeamView servers={servers} user={user} />;
}
