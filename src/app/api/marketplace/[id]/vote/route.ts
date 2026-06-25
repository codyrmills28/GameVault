import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { type } = await request.json(); // "LIKE", "DISLIKE", or "NONE"

    const templateId = params.id;

    const existingVote = await prisma.templateVote.findUnique({
      where: {
        userId_templateId: {
          userId: user.id,
          templateId
        }
      }
    });

    if (existingVote) {
      // Remove old vote effects
      if (existingVote.type === "LIKE") {
        await prisma.marketplaceTemplate.update({
          where: { id: templateId },
          data: { likes: { decrement: 1 } }
        });
      } else if (existingVote.type === "DISLIKE") {
        await prisma.marketplaceTemplate.update({
          where: { id: templateId },
          data: { dislikes: { decrement: 1 } }
        });
      }

      if (type === "NONE") {
        await prisma.templateVote.delete({
          where: { id: existingVote.id }
        });
        return NextResponse.json({ success: true });
      } else {
        await prisma.templateVote.update({
          where: { id: existingVote.id },
          data: { type }
        });
      }
    } else {
      if (type !== "NONE") {
        await prisma.templateVote.create({
          data: {
            userId: user.id,
            templateId,
            type
          }
        });
      } else {
        return NextResponse.json({ success: true });
      }
    }

    // Apply new vote effects
    if (type === "LIKE") {
      await prisma.marketplaceTemplate.update({
        where: { id: templateId },
        data: { likes: { increment: 1 } }
      });
    } else if (type === "DISLIKE") {
      await prisma.marketplaceTemplate.update({
        where: { id: templateId },
        data: { dislikes: { increment: 1 } }
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
