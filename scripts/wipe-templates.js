const { PrismaClient } = require('../src/generated/client');
const prisma = new PrismaClient();
prisma.marketplaceTemplate.deleteMany().then(() => {
  console.log('Wiped all templates');
  prisma.$disconnect();
});
