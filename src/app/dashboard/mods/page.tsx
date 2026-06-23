import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import ModsView from "@/components/ModsView";

export const dynamic = "force-dynamic";

export default async function ModsPage() {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect("/login");
  }

  const servers = await prisma.server.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return <ModsView servers={servers} user={user} />;
}
