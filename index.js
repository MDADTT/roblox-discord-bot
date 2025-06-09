require('dotenv').config();
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
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: ['MESSAGE', 'CHANNEL', 'REACTION']
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
    .setName('say')
    .setDescription('Send a message as the bot (Owner only)')
    .addStringOption(option =>
      option.setName('message')
        .setDescription('Message to send')
        .setRequired(true))
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Channel to send the message to (optional)')
        .setRequired(false))
];

// Roblox login with Railway compatibility
async function robloxLogin() {
  if (!ROBLOX_COOKIE) {
    throw new Error('ROBLOX_COOKIE environment variable is not set');
  }

  try {
    console.log('Attempting to authenticate with Roblox...');
    
    // Clean the cookie - remove any whitespace or formatting issues
    const cleanCookie = ROBLOX_COOKIE.trim();
    
    // Set longer timeout for Railway environment
    const originalTimeout = process.env.AXIOS_TIMEOUT;
    process.env.AXIOS_TIMEOUT = '30000'; // 30 seconds
    
    // Try authentication with retry logic
    let currentUser = null;
    let lastError = null;
    
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`Authentication attempt ${attempt}/3...`);
        
        // Set the cookie
        currentUser = await noblox.setCookie(cleanCookie);
        
        if (currentUser && currentUser.UserName) {
          console.log(`Successfully logged in to Roblox as ${currentUser.UserName}`);
          
          // Restore original timeout
          if (originalTimeout) {
            process.env.AXIOS_TIMEOUT = originalTimeout;
          } else {
            delete process.env.AXIOS_TIMEOUT;
          }
          
          return true;
        }
        
        // If no user returned, wait and retry
        if (attempt < 3) {
          console.log('No user returned, retrying in 2 seconds...');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
      } catch (error) {
        lastError = error;
        console.error(`Attempt ${attempt} failed:`, error.message);
        
        if (attempt < 3) {
          console.log('Retrying in 3 seconds...');
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    }
    
    // Restore original timeout
    if (originalTimeout) {
      process.env.AXIOS_TIMEOUT = originalTimeout;
    } else {
      delete process.env.AXIOS_TIMEOUT;
    }
    
    throw new Error(`Failed to authenticate after 3 attempts. Last error: ${lastError?.message || 'Unknown error'}`);
    
  } catch (error) {
    console.error("Failed to login to Roblox:", error.message);
    
    if (error.message.includes('CSRF') || error.message.includes('not logged in')) {
      console.error('Cookie authentication failed. Possible causes:');
      console.error('1. Cookie has expired - get a fresh .ROBLOSECURITY cookie');
      console.error('2. Account has 2FA enabled - disable temporarily');
      console.error('3. IP restrictions - check if Railway IP is blocked');
      console.error('4. Roblox is experiencing issues');
    }
    
    // Don't throw the error to prevent bot from crashing
    console.error('Bot will continue running but Roblox features will be disabled');
    return false;
  }
}

// Helper to log commands
async function logCommand(interaction, commandName, targetUser, rankName, color = 0x00ff00) {
  try {
    // Use different channels based on command type
    let channelId;
    if (commandName === 'dm') {
      channelId = '1377717185199214663';
    } else {
      channelId = LOG_CHANNEL_ID;
    }

    const logChannel = await client.channels.fetch(channelId);
    if (!logChannel) return;

    const executor = `${interaction.user} (${interaction.user.tag})`;
    const target = targetUser || "N/A";
    const rank = rankName || "N/A";

    const logEmbed = {
      color: color,
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

// Check for specific role permission
function hasSpecificRole(member) {
  const allowedRoleId = '1380255168255230117';
  return member && member.roles.cache.has(allowedRoleId);
}

// Check if user has rank 40+ in Roblox group
async function hasHighRank(userId) {
  try {
    const rank = await noblox.getRankInGroup(ROBLOX_GROUP_ID, userId);
    return rank >= 40;
  } catch (error) {
    console.error('Error checking user rank:', error);
    return false;
  }
}

client.once("ready", async () => {
  console.log(`${client.user.tag} is online!`);
  
  // Try to authenticate with Roblox
  const authSuccess = await robloxLogin();
  
  if (!authSuccess) {
    console.log('Roblox authentication failed - some commands will be disabled');
  }

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

  // Check maintenance mode first
  if (isMaintenanceMode && interaction.user.id !== '942051843306049576') {
    const embed = new EmbedBuilder()
      .setColor('#FF0000')
      .setTitle('**Bot Unavailable**')
      .setDescription('❌ The bot is currently in maintenance mode.\nPlease try again later.')
      .setFooter({ text: 'We apologize for the inconvenience.' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // Permission checks based on command
  const commandName = interaction.commandName;
  
  // Commands that require specific role
  if (['promote', 'demote', 'setrank'].includes(commandName)) {
    if (!hasSpecificRole(interaction.member)) {
      return interaction.reply({ 
        content: "You need the required role to use ranking commands.",
        ephemeral: true 
      });
    }
  }
  
  // Exile command requires rank 40+ in Roblox group
  if (commandName === 'exile') {
    try {
      const username = interaction.options.getString('username');
      const userId = await noblox.getIdFromUsername(interaction.user.username);
      
      if (!userId) {
        return interaction.reply({ 
          content: "Could not find your Roblox account. Make sure your Discord username matches your Roblox username.",
          ephemeral: true 
        });
      }
      
      const hasRank = await hasHighRank(userId);
      if (!hasRank) {
        return interaction.reply({ 
          content: "You need to be rank 40 or higher in the Roblox group to use the exile command.",
          ephemeral: true 
        });
      }
    } catch (error) {
      return interaction.reply({ 
        content: "Error checking your Roblox rank. Please try again.",
        ephemeral: true 
      });
    }
  }

  // Check if Roblox authentication is working for commands that need it
  const needsRoblox = ['promote', 'demote', 'setrank', 'ranklist', 'exile'];
  if (needsRoblox.includes(commandName)) {
    try {
      // Quick test to see if we're still authenticated
      await noblox.getCurrentUser();
    } catch (error) {
      return interaction.reply({ 
        content: "❌ Roblox authentication is not working. The bot owner needs to update the Roblox cookie.",
        ephemeral: true 
      });
    }
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
            { name: '/exile <username>', value: 'Exiles a user from the group (Admin only)' }
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
        await logCommand(interaction, "exile", username, "Exiled from group", 0xffff00);
        break;
      }

      case 'say': {
        // Only allow bot owner to use this command
        if (interaction.user.id !== '942051843306049576') {
          return interaction.reply({ 
            content: "Only the bot owner can use this command.",
            ephemeral: true 
          });
        }

        const message = interaction.options.getString('message');
        const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

        try {
          await targetChannel.send(message);
          await interaction.reply({ 
            content: `Message sent to ${targetChannel.name}`,
            ephemeral: true 
          });
        } catch (error) {
          await interaction.reply({ 
            content: "Failed to send message. Make sure I have permission to send messages in that channel.",
            ephemeral: true 
          });
        }
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

// Log received DMs
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channel.type !== 1) return; // Only DMs (channel type 1)

  const logChannelId = '1377717185199214663';
  try {
    const logChannel = await client.channels.fetch(logChannelId);
    if (logChannel) {
      const receivedEmbed = new EmbedBuilder()
        .setColor('#ff9900')
        .setTitle('📥 DM Received')
        .addFields(
          { name: 'From', value: `${message.author.tag} (${message.author.id})`, inline: true },
          { name: 'To', value: `${client.user.tag} (Bot)`, inline: true },
          { name: 'Message', value: message.content || 'No text content', inline: false }
        )
        .setTimestamp();

      if (message.attachments.size > 0) {
        const attachments = message.attachments.map(att => att.url).join('\n');
        receivedEmbed.addFields({ name: 'Attachments', value: attachments, inline: false });

        // If there's an image attachment, add it to the embed
        const imageAttachment = message.attachments.find(att => 
          att.contentType && att.contentType.startsWith('image/')
        );
        if (imageAttachment) {
          receivedEmbed.setImage(imageAttachment.url);
        }
      }

      await logChannel.send({ embeds: [receivedEmbed] });
    }
  } catch (error) {
    console.error('Error logging received DM:', error);
  }
});

client.login(DISCORD_TOKEN);
