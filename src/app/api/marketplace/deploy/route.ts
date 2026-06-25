import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { deployTemplate } from "@/lib/templates/installer";

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { templateId } = await request.json();
    if (!templateId) {
      return NextResponse.json({ error: "Missing templateId" }, { status: 400 });
    }

    const serverId = await deployTemplate(templateId, user.id);

    return NextResponse.json({ success: true, serverId });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
