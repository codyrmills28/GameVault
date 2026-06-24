import { NextRequest, NextResponse } from "next/server";
import { localProcesses } from "@/lib/localRunner";
import { getAuthenticatedUser } from "@/lib/auth";
import { verifyServerAccess } from "@/lib/serverAuth";

// Command input for a running local server. Log output is streamed separately
// by the file-tailing SSE route at /api/servers/[id]/logs/stream.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const serverId = params.id;

    // Writing to a server process's stdin requires an authenticated user with
    // access to this server.
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const access = await verifyServerAccess(serverId, user.id);
    if (!access) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }

    const body = await req.json();
    const { command } = body;

    if (!command || typeof command !== "string") {
      return NextResponse.json({ error: "Invalid command" }, { status: 400 });
    }

    const child = localProcesses.get(serverId);
    if (!child) {
      return NextResponse.json({ error: "Server is not running locally or process not found." }, { status: 400 });
    }

    if (!child.stdin) {
      return NextResponse.json({ error: "Server process does not accept stdin input." }, { status: 400 });
    }

    // Write command to process stdin with newline
    child.stdin.write(command + "\n");

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
