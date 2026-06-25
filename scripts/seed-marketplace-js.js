const { PrismaClient } = require('../src/generated/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.marketplaceTemplate.create({
    data: {
      name: 'Valheim Modded Starter (Jotunn)',
      description: 'A solid base for Valheim modding featuring BepInEx and Jotunn library. Perfect for building custom modpacks.',
      author: 'RealmSwap Community',
      gameSlug: 'VALHEIM',
      tags: 'Starter, Modded, Jotunn',
      payload: JSON.stringify({ version: '1.0.0', mods: [], configOverrides: [], startupParams: {} }),
      downloads: 0,
      likes: 0,
      dislikes: 0
    }
  });
  console.log('Done');
}

main().catch(console.error).finally(() => prisma.$disconnect());
