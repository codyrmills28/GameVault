import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, description, gameSlug, tags, payload, customDefSpec } = body;

    if (!name || !description || !gameSlug || !payload) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (customDefSpec) {
      if (customDefSpec.install?.installScript) {
        return NextResponse.json({ error: "Marketplace definitions cannot contain 'installScript' for security reasons. Please use a data-only blueprint." }, { status: 400 });
      }
      if (customDefSpec.launch?.launchScript) {
        return NextResponse.json({ error: "Marketplace definitions cannot contain 'launchScript' for security reasons. Please use executable and args." }, { status: 400 });
      }
    }

    let strippedSecrets = false;
    if (payload.configOverrides && Array.isArray(payload.configOverrides)) {
      for (const override of payload.configOverrides) {
        if (override.content && typeof override.content === 'string') {
          const newContent = override.content.replace(/(password|token|key|secret)\s*[:=]\s*[^\s\n"']+/gi, '$1=***REMOVED***');
          if (newContent !== override.content) {
            strippedSecrets = true;
            override.content = newContent;
          }
        }
      }
    }

    const template = await prisma.marketplaceTemplate.create({
      data: {
        name,
        description,
        author: user.name,
        gameSlug,
        tags: tags || "",
        payload: JSON.stringify(payload),
        customDefSpec: customDefSpec ? JSON.stringify(customDefSpec) : null,
      },
    });

    return NextResponse.json({ ...template, strippedSecrets });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
