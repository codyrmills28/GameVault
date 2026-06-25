import { prisma } from "@/lib/db";
import { parseSpec, stringifyParamValues } from "@/lib/definitions/serialize";
import { dataRoot } from "@/lib/appPaths";
import { TemplatePayload } from "./types";
import path from "path";
import fs from "fs";

export async function deployTemplate(templateId: string, userId: string): Promise<string> {
  const template = await prisma.marketplaceTemplate.findUnique({
    where: { id: templateId }
  });

  if (!template) {
    throw new Error("Template not found");
  }

  const payload = JSON.parse(template.payload) as TemplatePayload;
  let defId: string;

  // 1. Handle Custom Game Definition
  if (template.customDefSpec) {
    const existingDef = await prisma.gameDefinition.findFirst({
      where: { slug: template.gameSlug }
    });
    
    if (existingDef) {
      defId = existingDef.id;
    } else {
      const customDefSpec = JSON.parse(template.customDefSpec);
      
      if (customDefSpec.install?.url) {
        const allowedDomains = ["github.com", "githubusercontent.com", "thunderstore.io", "curseforge.com", "steamcdn-a.akamaihd.net"];
        try {
          const parsedUrl = new URL(customDefSpec.install.url);
          const isAllowed = allowedDomains.some(d => parsedUrl.hostname === d || parsedUrl.hostname.endsWith("." + d));
          if (!isAllowed) {
            throw new Error(`Download URL origin not trusted: ${parsedUrl.hostname}`);
          }
        } catch(e: any) {
           throw new Error(`Invalid or untrusted download URL in definition: ${e.message}`);
        }
      }

      const newDef = await prisma.gameDefinition.create({
        data: {
          slug: template.gameSlug,
          displayName: customDefSpec.name || template.gameSlug,
          icon: "🎮", // default fallback
          installMethod: customDefSpec.install ? (customDefSpec.install.appId ? "STEAMCMD" : "DOWNLOAD") : "CUSTOM_SCRIPT",
          spec: template.customDefSpec,
          ownerId: userId,
        }
      });
      defId = newDef.id;
    }
  } else {
    const existingDef = await prisma.gameDefinition.findFirst({
      where: { slug: template.gameSlug }
    });
    if (!existingDef) throw new Error("Required game definition not found and no custom spec provided.");
    defId = existingDef.id;
  }

  // 2. Create the Server
  const def = await prisma.gameDefinition.findUniqueOrThrow({ where: { id: defId } });
  const spec = parseSpec(def.spec);

  const server = await prisma.server.create({
    data: {
      userId,
      name: `${template.name} - Deployed`,
      game: def.slug,
      definitionId: def.id,
      paramValues: stringifyParamValues(payload.startupParams || {}),
      ramAllocation: def.recommendedRamGB || 4,
      region: "LOCALHOST",
      status: "STOPPED",
      runnerType: "LOCAL",
      ipAddress: "127.0.0.1",
      port: spec.defaultPort,
      enableUpnp: false,
    }
  });

  // 3. Mod Installations
  if (payload.mods && payload.mods.length > 0) {
    const modPromises = payload.mods.map(mod => 
      prisma.modInstallation.create({
        data: {
          serverId: server.id,
          provider: mod.provider,
          packageId: mod.packageId,
          version: "latest",
          name: mod.name || mod.packageId,
        }
      })
    );
    await Promise.all(modPromises);
  }

  // 4. Config Overrides
  if (payload.configOverrides && payload.configOverrides.length > 0) {
    const root = dataRoot();
    for (const override of payload.configOverrides) {
      if (override.path.includes("..") || path.isAbsolute(override.path)) {
        console.warn(`Template deploy blocked malicious path: ${override.path}`);
        continue; // path traversal security check
      }
      
      const ext = path.extname(override.path).toLowerCase();
      const allowedExts = [".json", ".ini", ".cfg", ".txt", ".xml", ".yml", ".yaml", ".properties"];
      if (!allowedExts.includes(ext) && ext !== "") {
        console.warn(`Template deploy blocked malicious file extension: ${override.path}`);
        continue;
      }
      
      const configPath = path.join(root, "local-servers", server.id, override.path);
      const dir = path.dirname(configPath);
      
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // For now, simple write replacement
      fs.writeFileSync(configPath, override.content, "utf-8");
    }
  }

  // 5. Activity Log
  await prisma.activityLog.create({
    data: {
      userId,
      action: "CREATE_SERVER",
      details: `Deployed template '${template.name}' for ${def.slug}.`,
    }
  });

  // Increment download count
  await prisma.marketplaceTemplate.update({
    where: { id: templateId },
    data: { downloads: { increment: 1 } }
  });

  return server.id;
}
