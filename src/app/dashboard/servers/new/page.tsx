import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import CreateServerView from "@/components/CreateServerView";

export const dynamic = "force-dynamic";

export default async function NewServerPage() {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect("/login");
  }

  return <CreateServerView user={user} />;
}
