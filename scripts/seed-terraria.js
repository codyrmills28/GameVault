const { PrismaClient } = require('../src/generated/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.marketplaceTemplate.create({
    data: {
      name: 'Vanilla Terraria - Small World',
      description: 'A standard, vanilla Terraria server configured for a small, classic difficulty world. Great for a quick playthrough with a few friends.',
      author: 'RealmSwap Official',
      gameSlug: 'TERRARIA',
      tags: 'Vanilla, Starter',
      payload: JSON.stringify({ 
        version: '1.0.0', 
        mods: [], 
        configOverrides: [], 
        startupParams: {
          "-world": "Worlds/world1.wld",
          "-autocreate": "1",
          "-difficulty": "0", // 0=Classic, 1=Expert, 2=Master, 3=Journey
          "-maxplayers": "8"
        } 
      }),
      downloads: 0,
      likes: 0,
      dislikes: 0
    }
  });
  console.log('Done');
}

main().catch(console.error).finally(() => prisma.$disconnect());
