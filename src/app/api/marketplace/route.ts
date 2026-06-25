import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const gameSlug = searchParams.get("game");
    const tag = searchParams.get("tag");

    let whereClause: any = {};
    if (gameSlug) {
      whereClause.gameSlug = gameSlug;
    }
    if (tag) {
      whereClause.tags = {
        contains: tag,
      };
    }

    const sort = searchParams.get("sort") || "newest"; // "likes", "downloads", "newest"
    let orderBy: any = { createdAt: "desc" };
    if (sort === "likes") {
      orderBy = { likes: "desc" };
    } else if (sort === "downloads") {
      orderBy = { downloads: "desc" };
    }

    const templates = await prisma.marketplaceTemplate.findMany({
      where: whereClause,
      orderBy,
      take: 50,
      include: {
        votes: {
          where: { userId: user.id },
          select: { type: true }
        }
      }
    });

    const enrichedTemplates = templates.map(t => ({
      ...t,
      userVote: t.votes[0]?.type || null
    }));

    return NextResponse.json(enrichedTemplates);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
