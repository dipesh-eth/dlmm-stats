import { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } from 'discord.js';
import LPAgentClient from './logic.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration from environment variables
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const LPAGENT_API_KEY = process.env.LPAGENT_API_KEY;

// Validate environment variables
if (!DISCORD_TOKEN || !CLIENT_ID || !LPAGENT_API_KEY) {
  console.error('❌ Missing required environment variables!');
  console.error('Please set: DISCORD_TOKEN, CLIENT_ID, LPAGENT_API_KEY');
  process.exit(1);
}

// Wallet storage file path
const WALLETS_FILE = path.join(__dirname, 'wallets.json');

// Initialize wallet storage
function initWalletStorage() {
  if (!fs.existsSync(WALLETS_FILE)) {
    fs.writeFileSync(WALLETS_FILE, JSON.stringify({}, null, 2));
    console.log('✅ Created wallets.json file');
  }
}

// Read wallets from file
function getWallets() {
  try {
    const data = fs.readFileSync(WALLETS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading wallets file:', error);
    return {};
  }
}

// Save wallets to file
function saveWallets(wallets) {
  try {
    fs.writeFileSync(WALLETS_FILE, JSON.stringify(wallets, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving wallets file:', error);
    return false;
  }
}

// Get wallet for a user
function getUserWallet(userId) {
  const wallets = getWallets();
  return wallets[userId] || null;
}

// Register wallet for a user
function registerUserWallet(userId, walletAddress) {
  const wallets = getWallets();
  wallets[userId] = walletAddress;
  return saveWallets(wallets);
}

// Unregister wallet for a user
function unregisterUserWallet(userId) {
  const wallets = getWallets();
  if (wallets[userId]) {
    delete wallets[userId];
    return saveWallets(wallets);
  }
  return false;
}

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
    .setName('register_wallet')
    .setDescription('Register your default wallet address')
    .addStringOption(option =>
      option.setName('wallet')
        .setDescription('Your wallet address')
        .setRequired(true)
    ),
  
  new SlashCommandBuilder()
    .setName('unregister_wallet')
    .setDescription('Remove your registered wallet address'),
  
  new SlashCommandBuilder()
    .setName('my_wallet')
    .setDescription('View your registered wallet address'),
  
  new SlashCommandBuilder()
    .setName('positions')
    .setDescription('View open LP positions for a wallet')
    .addStringOption(option =>
      option.setName('wallet')
        .setDescription('Wallet address (optional if you have registered)')
        .setRequired(false)
    ),
  
  new SlashCommandBuilder()
    .setName('history')
    .setDescription('View closed LP positions for a wallet')
    .addStringOption(option =>
      option.setName('wallet')
        .setDescription('Wallet address (optional if you have registered)')
        .setRequired(false)
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
        .setDescription('Wallet address (optional if you have registered)')
        .setRequired(false)
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
  initWalletStorage();
  await registerCommands();
});

// Interaction handler
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    await interaction.deferReply();

    switch (interaction.commandName) {
      case 'register_wallet':
        await handleRegisterWallet(interaction);
        break;
      
      case 'unregister_wallet':
        await handleUnregisterWallet(interaction);
        break;
      
      case 'my_wallet':
        await handleMyWallet(interaction);
        break;
      
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

// Wallet management handlers
async function handleRegisterWallet(interaction) {
  const walletAddress = interaction.options.getString('wallet');
  const userId = interaction.user.id;

  if (registerUserWallet(userId, walletAddress)) {
    const embed = new EmbedBuilder()
      .setColor('#00ff00')
      .setTitle('✅ Wallet Registered')
      .setDescription(`Your wallet has been registered successfully!`)
      .addFields({
        name: '📍 Wallet Address',
        value: `\`${walletAddress}\``,
        inline: false
      })
      .setFooter({ text: 'You can now use commands without specifying a wallet address' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } else {
    await interaction.editReply('❌ Failed to register wallet. Please try again.');
  }
}

async function handleUnregisterWallet(interaction) {
  const userId = interaction.user.id;
  const existingWallet = getUserWallet(userId);

  if (!existingWallet) {
    return interaction.editReply('❌ You don\'t have a registered wallet.');
  }

  if (unregisterUserWallet(userId)) {
    const embed = new EmbedBuilder()
      .setColor('#ff9900')
      .setTitle('🗑️ Wallet Unregistered')
      .setDescription('Your wallet has been removed successfully!')
      .addFields({
        name: '📍 Removed Wallet',
        value: `\`${existingWallet}\``,
        inline: false
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } else {
    await interaction.editReply('❌ Failed to unregister wallet. Please try again.');
  }
}

async function handleMyWallet(interaction) {
  const userId = interaction.user.id;
  const walletAddress = getUserWallet(userId);

  if (!walletAddress) {
    return interaction.editReply('❌ You don\'t have a registered wallet. Use `/register_wallet` to register one.');
  }

  const embed = new EmbedBuilder()
    .setColor('#4a90e2')
    .setTitle('👛 Your Registered Wallet')
    .addFields({
      name: '📍 Wallet Address',
      value: `\`${walletAddress}\``,
      inline: false
    })
    .setFooter({ text: 'Use /unregister_wallet to remove it' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// Helper function to get wallet address (from option or registered)
function getWalletAddress(interaction) {
  const providedWallet = interaction.options.getString('wallet');
  if (providedWallet) {
    return providedWallet;
  }

  const userId = interaction.user.id;
  const registeredWallet = getUserWallet(userId);
  
  if (!registeredWallet) {
    throw new Error('NO_WALLET');
  }

  return registeredWallet;
}

async function handleOpenPositions(interaction) {
  let walletAddress;
  try {
    walletAddress = getWalletAddress(interaction);
  } catch (error) {
    if (error.message === 'NO_WALLET') {
      return interaction.editReply('❌ No wallet address provided. Either:\n• Provide a wallet: `/positions wallet:<address>`\n• Register your wallet: `/register_wallet wallet:<address>`');
    }
    throw error;
  }
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
        { name: '📍 Position ID', value: `\`${pos.position}\``, inline: true },
        { name: '💵 Current Value', value: `${parseFloat(pos.currentValue).toFixed(2)}`, inline: true },
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
  let walletAddress;
  try {
    walletAddress = getWalletAddress(interaction);
  } catch (error) {
    if (error.message === 'NO_WALLET') {
      return interaction.editReply('❌ No wallet address provided. Either:\n• Provide a wallet: `/history wallet:<address>`\n• Register your wallet: `/register_wallet wallet:<address>`');
    }
    throw error;
  }
  
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
  let walletAddress;
  try {
    walletAddress = getWalletAddress(interaction);
  } catch (error) {
    if (error.message === 'NO_WALLET') {
      return interaction.editReply('❌ No wallet address provided. Either:\n• Provide a wallet: `/overview wallet:<address>`\n• Register your wallet: `/register_wallet wallet:<address>`');
    }
    throw error;
  }
  
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