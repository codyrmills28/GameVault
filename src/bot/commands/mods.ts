import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { prisma } from "../../lib/db";

export default {
  data: new SlashCommandBuilder()
    .setName("mods")
    .setDescription("List all installed mods for a server")
    .addStringOption(option => option.setName("game").setDescription("Name of the game/server").setRequired(true)),

  async execute(interaction: ChatInputCommandInteraction) {
    const user = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
    if (!user) return interaction.reply({ content: `You don't have permission.`, ephemeral: true });

    const gameQuery = interaction.options.getString("game")?.toLowerCase();

    const servers = await prisma.server.findMany({
      where: { OR: [{ game: { equals: gameQuery } }, { name: { contains: gameQuery } }] }
    });

    if (servers.length === 0) return interaction.reply({ content: `Could not find server matching \`${gameQuery}\`.`, ephemeral: true });
    const server = servers[0];

    const mods = await prisma.modInstallation.findMany({
      where: { serverId: server.id },
      orderBy: { name: "asc" }
    });

    if (mods.length === 0) {
      return interaction.reply({ content: `No mods are currently installed on **${server.name}**.` });
    }

    const embed = new EmbedBuilder()
      .setColor(0x8B5CF6) // Purple
      .setTitle(`🧩 Installed Mods: ${server.name}`)
      .setDescription(`There are ${mods.length} mods installed.`);

    let activeList = mods.map(m => `**${m.name}** \`(v${m.version})\``).join("\n");
    if (activeList.length > 1024) activeList = activeList.substring(0, 1000) + "...";
    
    if (activeList) embed.addFields({ name: "Mods", value: activeList });

    await interaction.reply({ embeds: [embed] });
  },
};
