import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import BackupsView from "@/components/BackupsView";

export const dynamic = "force-dynamic";

export default async function BackupsPage() {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect("/login");
  }

  // Pre-fetch all user servers to select targets from
  const servers = await prisma.server.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" }
  });

  return <BackupsView servers={servers} user={user} />;
}
