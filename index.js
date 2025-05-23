
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");
const noblox = require("noblox.js");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const ROBLOX_GROUP_ID = process.env.ROBLOX_GROUP_ID;
const ROBLOX_COOKIE = process.env.ROBLOX_COOKIE;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

let isMaintenanceMode = false;

// Define slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Shows all available commands and their descriptions'),
  new SlashCommandBuilder()
    .setName('promote')
    .setDescription('Promotes a user up one rank')
    .addStringOption(option =>
      option.setName('username')
        .setDescription('Roblox username')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('demote')
    .setDescription('Demotes a user one rank below')
    .addStringOption(option =>
      option.setName('username')
        .setDescription('Roblox username')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('setrank')
    .setDescription('Sets rank of the user')
    .addStringOption(option =>
      option.setName('username')
        .setDescription('Roblox username')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('rankid')
        .setDescription('Rank ID')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('ranklist')
    .setDescription('Shows all rank IDs'),
  new SlashCommandBuilder()
    .setName('exile')
    .setDescription('Exiles a user from the group')
    .addStringOption(option =>
      option.setName('username')
        .setDescription('Roblox username')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('maintenance')
    .setDescription('Puts the bot into maintenance mode'),
  new SlashCommandBuilder()
    .setName('maintenanceover')
    .setDescription('Takes the bot out of maintenance mode')
];

// Roblox login
async function robloxLogin() {
  try {
    const currentUser = await noblox.setCookie(ROBLOX_COOKIE);
    console.log(`Logged in to Roblox as ${currentUser.UserName}`);
  } catch (error) {
    console.error("Failed to login to Roblox:", error);
  }
}

// Helper to log commands
async function logCommand(interaction, commandName, targetUser, rankName) {
  try {
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (!logChannel) return;

    const executor = `${interaction.user} (${interaction.user.tag})`;
    const target = targetUser || "N/A";
    const rank = rankName || "N/A";

    const logEmbed = {
      color: 0x00ff00,
      title: commandName.toUpperCase(),
      fields: [
        { name: 'Executed by', value: executor, inline: true },
        { name: 'Target User', value: target, inline: true },
        { name: 'Rank', value: rank, inline: true }
      ],
      timestamp: new Date()
    };

    logChannel.send({ embeds: [logEmbed] });
  } catch (err) {
    console.error("Failed to send log message:", err);
  }
}

// Check for ranking permission
function hasRankingPermission(member) {
  const allowedRoleName = 'Ranking Permission';
  return member && (member.roles.cache.some(role => role.name === allowedRoleName) || 
         member.permissions.has(PermissionsBitField.Flags.Administrator));
}

client.once("ready", async () => {
  console.log(`${client.user.tag} is online!`);
  await robloxLogin();
  
  // Register slash commands
  const rest = new REST().setToken(DISCORD_TOKEN);
  try {
    console.log('Started refreshing application (/) commands.');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands },
    );
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  if (!hasRankingPermission(interaction.member) && 
      !['maintenance', 'maintenanceover'].includes(interaction.commandName)) {
    return interaction.reply({ 
      content: "You need the 'Ranking Permission' role to use ranking commands.",
      ephemeral: true 
    });
  }

  if (isMaintenanceMode && interaction.user.id !== '942051843306049576' &&
      !['maintenance', 'maintenanceover'].includes(interaction.commandName)) {
    const embed = new EmbedBuilder()
      .setColor('#FF0000')
      .setTitle('**Bot Unavailable**')
      .setDescription('❌ The bot is currently in maintenance mode.\nPlease try again later.')
      .setFooter({ text: 'We apologize for the inconvenience.' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  try {
    switch (interaction.commandName) {
      case 'help': {
        const helpEmbed = new EmbedBuilder()
          .setColor('#2F3136')
          .setTitle('📚 Available Commands')
          .setDescription('Here are all the available commands:')
          .addFields(
            { name: '/help', value: 'Shows this help message' },
            { name: '/promote <username>', value: 'Promotes a user up one rank in the group' },
            { name: '/demote <username>', value: 'Demotes a user one rank down in the group' },
            { name: '/setrank <username> <rankid>', value: 'Sets a user\'s rank to the specified rank ID' },
            { name: '/ranklist', value: 'Shows all available ranks and their IDs' },
            { name: '/exile <username>', value: 'Exiles a user from the group (Admin only)' },
            { name: '/maintenance', value: 'Puts the bot into maintenance mode (Owner only)' },
            { name: '/maintenanceover', value: 'Takes the bot out of maintenance mode (Owner only)' }
          )
          .setFooter({ text: 'Use these commands responsibly!', iconURL: client.user.displayAvatarURL() })
          .setTimestamp();

        await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
        break;
      }
      case 'promote': {
        const username = interaction.options.getString('username');
        const userId = await noblox.getIdFromUsername(username);
        if (!userId) {
          return interaction.reply(`Could not find Roblox user ${username}`);
        }

        const roles = await noblox.getRoles(ROBLOX_GROUP_ID);
        const currentRank = await noblox.getRankInGroup(ROBLOX_GROUP_ID, userId);
        const currentRoleIndex = roles.findIndex((r) => r.rank === currentRank);

        if (currentRoleIndex === roles.length - 1) {
          return interaction.reply(
            `${username} is already at the highest rank (${roles[currentRoleIndex].name})`
          );
        }

        const newRank = roles[currentRoleIndex + 1];
        await noblox.setRank(ROBLOX_GROUP_ID, userId, newRank.rank);
        await interaction.reply(
          `Successfully promoted ${username} to **${newRank.name}**`
        );
        await logCommand(interaction, "promote", username, newRank.name);
        break;
      }

      case 'demote': {
        const username = interaction.options.getString('username');
        const userId = await noblox.getIdFromUsername(username);
        if (!userId) {
          return interaction.reply(`Could not find Roblox user ${username}`);
        }

        const roles = await noblox.getRoles(ROBLOX_GROUP_ID);
        const currentRank = await noblox.getRankInGroup(ROBLOX_GROUP_ID, userId);
        const currentRoleIndex = roles.findIndex((r) => r.rank === currentRank);

        if (currentRoleIndex === 0) {
          return interaction.reply(
            `${username} is already at the lowest rank (${roles[currentRoleIndex].name})`
          );
        }

        const newRank = roles[currentRoleIndex - 1];
        await noblox.setRank(ROBLOX_GROUP_ID, userId, newRank.rank);
        await interaction.reply(
          `Successfully demoted ${username} to **${newRank.name}**`
        );
        await logCommand(interaction, "demote", username, newRank.name);
        break;
      }

      case 'setrank': {
        const username = interaction.options.getString('username');
        const rankId = interaction.options.getInteger('rankid');
        
        const userId = await noblox.getIdFromUsername(username);
        if (!userId) {
          return interaction.reply(`Could not find user ${username} on Roblox.`);
        }

        await noblox.setRank(ROBLOX_GROUP_ID, userId, rankId);
        const roles = await noblox.getRoles(ROBLOX_GROUP_ID);
        const role = roles.find((r) => r.rank === rankId);
        const rankName = role ? role.name : "Unknown Rank";

        await interaction.reply(
          `Successfully set ${username}'s rank to **${rankName}**`
        );
        await logCommand(interaction, "setrank", username, `${rankName} (ID: ${rankId})`);
        break;
      }

      case 'ranklist': {
        const roles = await noblox.getRoles(ROBLOX_GROUP_ID);
        const ranksPerPage = 10;
        const totalPages = Math.ceil(roles.length / ranksPerPage);
        let currentPage = 1;

        function getRankListPage(page) {
          const filteredRoles = roles.filter(role => role.rank !== 0);
          const start = (page - 1) * ranksPerPage;
          const end = start + ranksPerPage;
          const pageRoles = filteredRoles.slice(start, end);
          return pageRoles.map(role => `${role.rank} • **${role.name}**`).join('\n');
        }

        const rankEmbed = {
          color: 0x2F3136,
          title: '📋 Group Rank List',
          description: `Below are all available ranks in the group.\n\n**Page ${currentPage} of ${totalPages}**\n\n${getRankListPage(currentPage)}`,
          footer: { 
            text: `Total Ranks: ${roles.length} • Page ${currentPage}/${totalPages}`,
            icon_url: interaction.guild.iconURL()
          },
          timestamp: new Date()
        };

        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('previous')
              .setLabel('Previous')
              .setStyle(ButtonStyle.Primary)
              .setDisabled(currentPage === 1),
            new ButtonBuilder()
              .setCustomId('next')
              .setLabel('Next')
              .setStyle(ButtonStyle.Primary)
              .setDisabled(currentPage === totalPages)
          );

        const response = await interaction.reply({ 
          embeds: [rankEmbed], 
          components: [row],
          fetchReply: true 
        });

        const collector = response.createMessageComponentCollector({ 
          filter: i => i.user.id === interaction.user.id,
          time: 60000 
        });

        collector.on('collect', async i => {
          if (i.customId === 'previous' && currentPage > 1) {
            currentPage--;
          } else if (i.customId === 'next' && currentPage < totalPages) {
            currentPage++;
          }

          rankEmbed.description = `Available ranks and their IDs (Page ${currentPage}/${totalPages}):\n\n${getRankListPage(currentPage)}`;
          row.components[0].setDisabled(currentPage === 1);
          row.components[1].setDisabled(currentPage === totalPages);

          await i.update({ embeds: [rankEmbed], components: [row] });
        });

        collector.on('end', () => {
          row.components.forEach(button => button.setDisabled(true));
          response.edit({ components: [row] }).catch(console.error);
        });
        break;
      }

      case 'exile': {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({ 
            content: "Only administrators can use the exile command.",
            ephemeral: true 
          });
        }

        const username = interaction.options.getString('username');
        const userId = await noblox.getIdFromUsername(username);
        if (!userId) {
          return interaction.reply(`Could not find user ${username} on Roblox.`);
        }

        await noblox.exile(ROBLOX_GROUP_ID, userId);
        await interaction.reply(`Successfully exiled ${username} from the group.`);
        await logCommand(interaction, "exile", username, "Exiled from group");
        break;
      }

      case 'maintenance': {
        if (interaction.user.id !== '942051843306049576') {
          return interaction.reply({ 
            content: "Only the owner can use this command.",
            ephemeral: true 
          });
        }

        isMaintenanceMode = true;
        const embed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('**Maintenance Mode Activated**')
          .setDescription('The bot is currently undergoing maintenance.\nPlease stand by — we\'ll be back shortly!')
          .setThumbnail('https://cdn-icons-png.flaticon.com/512/189/189792.png')
          .addFields(
            { name: 'Status', value: 'Under Maintenance', inline: true },
            { name: 'ETA', value: 'Soon', inline: true }
          )
          .setFooter({ text: 'Thank you for your patience!', iconURL: client.user.displayAvatarURL() })
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
        break;
      }

      case 'maintenanceover': {
        if (interaction.user.id !== '942051843306049576') {
          return interaction.reply({ 
            content: "Only the owner can use this command.",
            ephemeral: true 
          });
        }

        isMaintenanceMode = false;
        const embed = new EmbedBuilder()
          .setColor('#00FF00')
          .setTitle('**Maintenance Complete**')
          .setDescription('The bot is back online and ready to serve you!')
          .setThumbnail('https://cdn-icons-png.flaticon.com/512/190/190411.png')
          .addFields(
            { name: 'Status', value: 'Online', inline: true },
            { name: 'All Systems', value: 'Operational', inline: true }
          )
          .setFooter({ text: 'Thank you for your patience!', iconURL: client.user.displayAvatarURL() })
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
        break;
      }
    }
  } catch (error) {
    console.error(error);
    await interaction.reply({ 
      content: 'There was an error executing this command.',
      ephemeral: true 
    });
  }
});

client.login(DISCORD_TOKEN);
