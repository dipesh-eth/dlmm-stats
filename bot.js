// LP Agent Discord Bot with Slash Commands
// Using ES6 imports

import { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } from 'discord.js';
import LPAgentClient from './logic.js';

// Configuration
const DISCORD_TOKEN = 'MTQyNDkwODM3MTgwNjM4ODM0MA.G52hWC.8fewx_jYjJc2UYf3P57qP_77p9G5hCNjd2LkEY';
const CLIENT_ID = '1424908371806388340';
const LPAGENT_API_KEY = 'a6757731-7fe5-43f1-83a0-a364c501da4a';

// Initialize clients
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
  ],
});

const lpAgent = new LPAgentClient(LPAGENT_API_KEY);

// Define slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('positions')
    .setDescription('View open LP positions for a wallet')
    .addStringOption(option =>
      option.setName('wallet')
        .setDescription('Wallet address')
        .setRequired(true)
    ),
  
  new SlashCommandBuilder()
    .setName('history')
    .setDescription('View closed LP positions for a wallet')
    .addStringOption(option =>
      option.setName('wallet')
        .setDescription('Wallet address')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('page')
        .setDescription('Page number')
        .setRequired(false)
    ),
  
  new SlashCommandBuilder()
    .setName('overview')
    .setDescription('View wallet overview and PnL stats')
    .addStringOption(option =>
      option.setName('wallet')
        .setDescription('Wallet address')
        .setRequired(true)
    ),
  
  new SlashCommandBuilder()
    .setName('position')
    .setDescription('View details for a specific position')
    .addStringOption(option =>
      option.setName('position_id')
        .setDescription('Position ID')
        .setRequired(true)
    ),
].map(command => command.toJSON());

// Register slash commands
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

async function registerCommands() {
  try {
    console.log('🔄 Registering slash commands...');
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands },
    );
    console.log('✅ Slash commands registered successfully!');
  } catch (error) {
    console.error('❌ Error registering commands:', error);
  }
}

// Bot ready event
client.once('ready', async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  console.log(`📊 LP Agent API connected`);
  await registerCommands();
});

// Interaction handler
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    await interaction.deferReply();

    switch (interaction.commandName) {
      case 'positions':
        await handleOpenPositions(interaction);
        break;
      
      case 'history':
        await handleHistory(interaction);
        break;
      
      case 'overview':
        await handleOverview(interaction);
        break;
      
      case 'position':
        await handlePositionDetails(interaction);
        break;
    }
  } catch (error) {
    console.error('Error handling command:', error);
    const errorMessage = '❌ An error occurred while fetching data. Please check the input and try again.';
    
    if (interaction.deferred) {
      await interaction.editReply(errorMessage);
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
});

// === COMMAND HANDLERS ===

async function handleOpenPositions(interaction) {
  const walletAddress = interaction.options.getString('wallet');
  const data = await lpAgent.getOpenPositions(walletAddress);
  
  if (!data.data || data.data.length === 0) {
    return interaction.editReply('📭 No open positions found for this wallet.');
  }

  const positions = data.data;
  const embeds = [];

  // Summary embed
  const summaryEmbed = new EmbedBuilder()
    .setColor('#00ff00')
    .setTitle('📊 Open LP Positions')
    .setDescription(`Wallet: \`${walletAddress.substring(0, 8)}...${walletAddress.substring(walletAddress.length - 6)}\``)
    .addFields({
      name: 'Total Open Positions',
      value: `${data.count} position(s)`,
      inline: true
    })
    .setTimestamp();

  embeds.push(summaryEmbed);

  // Create embeds for positions
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const pnlSign = pos.pnl.percent >= 0 ? '📈' : '📉';
    const pnlColor = pos.pnl.percent >= 0 ? '+' : '';
    const uncollectedFee = parseFloat(pos.unCollectedFee || 0);

    const posEmbed = new EmbedBuilder()
      .setColor(pos.pnl.percent >= 0 ? '#00ff00' : '#ff0000')
      .setTitle(`${i + 1}. ${pos.tokenName0}/${pos.tokenName1}`)
      .addFields(
        { name: '🏦 Protocol', value: pos.protocol, inline: true },
        { name: '📍 Position ID', value: `\`${pos.position.substring(0, 12)}...\``, inline: true },
        { name: '💵 Current Value', value: `$${parseFloat(pos.currentValue).toFixed(2)}`, inline: true },
        { name: '💰 Holdings', value: `${pos.current.amount0Adjusted.toFixed(4)} ${pos.tokenName0}\n${pos.current.amount1Adjusted.toFixed(4)} ${pos.tokenName1}`, inline: true },
        { name: `${pnlSign} PnL`, value: `${pnlColor}${pos.pnl.percent.toFixed(2)}%\n${pnlColor}$${pos.pnl.value.toFixed(2)}`, inline: true },
        { name: '💸 Fees', value: `Collected: $${pos.collectedFee.toFixed(2)}\nUncollected: $${uncollectedFee.toFixed(2)}${uncollectedFee > 0 ? ' 💰' : ''}`, inline: true },
        { name: '⏱️ Age', value: `${pos.age} days`, inline: true },
        { name: '📊 Status', value: pos.inRange ? '✅ In Range' : '⚠️ Out of Range', inline: true },
        { name: '🎯 Price Range', value: `${pos.priceRange[0].toFixed(6)} - ${pos.priceRange[1].toFixed(6)}`, inline: true }
      )
      .setTimestamp();

    embeds.push(posEmbed);
  }

  // Send embeds in chunks of 10
  for (let i = 0; i < embeds.length; i += 10) {
    const chunk = embeds.slice(i, i + 10);
    if (i === 0) {
      await interaction.editReply({ embeds: chunk });
    } else {
      await interaction.followUp({ embeds: chunk });
    }
  }
}

async function handleHistory(interaction) {
  const walletAddress = interaction.options.getString('wallet');
  const page = interaction.options.getInteger('page') || 1;

  const data = await lpAgent.getHistoricalPositions(walletAddress, { page, pageSize: 10 });
  
  if (!data.data || !data.data.data || data.data.data.length === 0) {
    return interaction.editReply('📭 No historical positions found for this wallet.');
  }

  const positions = data.data.data;
  const pagination = data.data.pagination;

  const embed = new EmbedBuilder()
    .setColor('#4a90e2')
    .setTitle('📜 Position History')
    .setDescription(`Wallet: \`${walletAddress.substring(0, 8)}...${walletAddress.substring(walletAddress.length - 6)}\`\n\nPage ${pagination.currentPage}/${pagination.totalPages} | Total: ${pagination.totalCount} positions`)
    .setTimestamp();

  positions.forEach((pos, idx) => {
    const pnlSign = pos.pnl.percent >= 0 ? '✅' : '❌';
    const pnlColor = pos.pnl.percent >= 0 ? '+' : '';
    const posNum = (pagination.currentPage - 1) * pagination.pageSize + idx + 1;

    embed.addFields({
      name: `${posNum}. ${pos.tokenName0}/${pos.tokenName1} ${pnlSign}`,
      value: `**PnL:** ${pnlColor}${pos.pnl.percent.toFixed(2)}% ($${pnlColor}${pos.pnl.value.toFixed(2)})\n` +
             `**Fees:** $${pos.collectedFee.toFixed(2)}\n` +
             `**Duration:** ${pos.age} days\n` +
             `**Opened:** ${new Date(pos.createdAt).toLocaleDateString()}\n` +
             `**Closed:** ${new Date(pos.closeAt).toLocaleDateString()}`,
      inline: false
    });
  });

  if (pagination.totalPages > 1) {
    embed.setFooter({ text: `Use /history wallet:<wallet> page:<number> to view other pages` });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleOverview(interaction) {
  const walletAddress = interaction.options.getString('wallet');
  const data = await lpAgent.getOverview(walletAddress);
  
  if (!data || !data.data) {
    return interaction.editReply('❌ Could not fetch overview data for this wallet.');
  }

  const d = data.data;
  const totalPnlSign = d.total_pnl.ALL >= 0 ? '📈' : '📉';
  const pnlColor = d.total_pnl.ALL >= 0 ? '+' : '';

  const embed = new EmbedBuilder()
    .setColor(d.total_pnl.ALL >= 0 ? '#00ff00' : '#ff0000')
    .setTitle('💼 Wallet Overview & Performance')
    .setDescription(`**Wallet:** \`${d.owner.substring(0, 8)}...${d.owner.substring(d.owner.length - 6)}\`\n**Chain:** ${d.chain} | **Protocol:** ${d.protocol}`)
    .addFields(
      { 
        name: `${totalPnlSign} Total PnL`, 
        value: `${pnlColor}$${d.total_pnl.ALL.toFixed(2)}`, 
        inline: true 
      },
      { 
        name: '💰 Total Fees', 
        value: `$${d.total_fee.ALL.toFixed(2)}`, 
        inline: true 
      },
      { 
        name: '💵 ROI', 
        value: `${(d.roi * 100).toFixed(2)}%`, 
        inline: true 
      },
      { 
        name: '📥 Total Inflow', 
        value: `$${d.total_inflow.toFixed(2)}`, 
        inline: true 
      },
      { 
        name: '📤 Total Outflow', 
        value: `$${d.total_outflow.toFixed(2)}`, 
        inline: true 
      },
      { 
        name: '🎯 Win Rate', 
        value: `${(d.win_rate.ALL * 100).toFixed(2)}%\n(${d.win_lp}/${d.closed_lp.ALL} wins)`, 
        inline: true 
      },
      { 
        name: '📊 Positions', 
        value: `Total: ${d.total_lp}\nOpen: ${d.opening_lp}\nClosed: ${d.closed_lp.ALL}`, 
        inline: true 
      },
      { 
        name: '🏊 Total Pools', 
        value: `${d.total_pool}`, 
        inline: true 
      },
      { 
        name: '⏱️ Avg Age', 
        value: `${d.avg_age_hour.toFixed(2)} hours`, 
        inline: true 
      },
      { 
        name: '📅 7 Days', 
        value: `PnL: $${d.total_pnl['7D'].toFixed(2)}\nFees: $${d.total_fee['7D'].toFixed(2)}`, 
        inline: true 
      },
      { 
        name: '📅 1 Month', 
        value: `PnL: $${d.total_pnl['1M'].toFixed(2)}\nFees: $${d.total_fee['1M'].toFixed(2)}`, 
        inline: true 
      },
      { 
        name: '📅 3 Months', 
        value: `PnL: $${d.total_pnl['3M'].toFixed(2)}\nFees: $${d.total_fee['3M'].toFixed(2)}`, 
        inline: true 
      }
    )
    .setFooter({ text: `Last Updated: ${d.updated_at}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handlePositionDetails(interaction) {
  const positionId = interaction.options.getString('position_id');
  const data = await lpAgent.getPositionDetails(positionId);
  
  if (!data || !data.data) {
    return interaction.editReply('❌ Could not fetch details for this position.');
  }

  const pos = data.data;
  const pnlSign = pos.pnl.percent >= 0 ? '📈' : '📉';
  const pnlColor = pos.pnl.percent >= 0 ? '+' : '';

  const embed = new EmbedBuilder()
    .setColor(pos.pnl.percent >= 0 ? '#00ff00' : '#ff0000')
    .setTitle(`Position Details: ${pos.tokenName0}/${pos.tokenName1}`)
    .setDescription(`**Status:** ${pos.status}\n**Protocol:** ${pos.protocol}`)
    .addFields(
      { name: '📍 Position ID', value: `\`${pos.position}\``, inline: false },
      { name: '👤 Owner', value: `\`${pos.owner.substring(0, 12)}...${pos.owner.substring(pos.owner.length - 8)}\``, inline: false },
      { name: '💵 Current Value', value: `$${parseFloat(pos.currentValue).toFixed(2)}`, inline: true },
      { name: '💰 Input Value', value: `$${pos.inputValue.toFixed(2)}`, inline: true },
      { name: `${pnlSign} PnL`, value: `${pnlColor}${pos.pnl.percent.toFixed(2)}%\n${pnlColor}$${pos.pnl.value.toFixed(2)}`, inline: true },
      { name: '💸 Collected Fees', value: `$${pos.collectedFee.toFixed(2)}`, inline: true },
      { name: '💰 Uncollected Fees', value: `$${parseFloat(pos.unCollectedFee || 0).toFixed(2)}`, inline: true },
      { name: '📊 Status', value: pos.inRange ? '✅ In Range' : '⚠️ Out of Range', inline: true },
      { name: '⏱️ Age', value: `${pos.age} days`, inline: true },
      { name: '🎯 Price Range', value: `${pos.priceRange[0].toFixed(6)} - ${pos.priceRange[1].toFixed(6)}`, inline: true },
      { name: '📈 Strategy', value: pos.strategyType || 'N/A', inline: true }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// Login to Discord
client.login(DISCORD_TOKEN);