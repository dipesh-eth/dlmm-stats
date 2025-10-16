import { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes, AttachmentBuilder } from 'discord.js';
import { createCanvas, loadImage } from 'canvas';
import LPAgentClient from './logic.js';
import { getPositionIdFromTx } from './helius.js';
import { initializeDatabase, setupWallet, addMonitor, getUserMonitors, removeMonitor, getAllActiveMonitors, getEncryptedKey, updateMonitorStatus } from './src/database.js';
import { encrypt } from './src/encryption.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Placeholder for utility functions
const utils = {
  getTimeElapsed: (ageHour) => {
    const hours = parseFloat(ageHour);
    if (typeof hours !== 'number' || isNaN(hours)) return 'N/A';
  
    const totalHours = Math.floor(hours);
    const days = Math.floor(totalHours / 24);
    const remainingHours = totalHours % 24;
    const minutes = Math.floor((ageHour % 1) * 60);
    const seconds = Math.floor(((ageHour % 1) * 60 - minutes) * 60);
  
    // Format each unit to ensure 2 digits
    const formattedDays = String(days).padStart(2, '0');
    const formattedHours = String(remainingHours).padStart(2, '0');
    const formattedMinutes = String(minutes).padStart(2, '0');
    const formattedSeconds = String(seconds).padStart(2, '0');
  
    return `${formattedDays}:${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
  },
  formatCurrency: (value) => {
    if (typeof value !== 'number') value = 0;
    return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Sol`;
  },
  formatPercentage: (value) => {
    if (typeof value !== 'number') value = 0;
    return `${(value * 100).toFixed(2)}%`;
  }
};

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
    .setName('monitor')
    .setDescription('Manage TP/SL monitors for your DLMM positions.')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Create a new TP/SL monitor.')
        .addStringOption(opt => opt.setName('symbol').setDescription('Token symbol for tracking (e.g., GUAC)').setRequired(true))
        .addStringOption(opt => opt.setName('mint_address').setDescription('The mint address of the token to monitor.').setRequired(true))
        .addStringOption(opt => opt.setName('pool_address').setDescription('The address of the Meteora DLMM pool.').setRequired(true))
        .addNumberOption(opt => opt.setName('tp_price').setDescription('The take-profit price.').setRequired(true))
        .addNumberOption(opt => opt.setName('sl_price').setDescription('The stop-loss price.').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('status')
        .setDescription('View all your active monitors.')
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a monitor.')
        .addIntegerOption(opt => opt.setName('monitor_id').setDescription('The ID of the monitor to remove (from /monitor status).').setRequired(true))
    ),
  new SlashCommandBuilder()
    .setName('wallet')
    .setDescription('Manage your secure wallet for the TP/SL bot.')
    .addSubcommand(sub =>
      sub.setName('setup')
        .setDescription('Securely save your wallet private key. USE IN DMs ONLY.')
        .addStringOption(opt =>
          opt.setName('private_key')
            .setDescription('Your wallet private key (BS58 format). This is encrypted and stored securely.')
            .setRequired(true)
        )
    ),
  new SlashCommandBuilder()
    .setName('register_wallet')
    .setDescription('Register your default wallet address for PnL tracking')
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
  
  new SlashCommandBuilder()
    .setName('pnl')
    .setDescription('Generate a PnL card from a Solscan transaction link')
    .addStringOption(option =>
      option.setName('solscan_link')
        .setDescription('The Solscan transaction link for the position')
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

import { decrypt } from './encryption.js';
import { executePositionClose } from './src/execution.js';

const CHECK_INTERVAL = 30 * 1000; // 30 seconds

// ============================================
// BACKGROUND MONITORING LOOP
// ============================================

async function fetchCurrentPrice(mintAddress) {
  // Using Jupiter's v4 price API
  const url = `https://price.jup.ag/v4/price?ids=${mintAddress}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[Price Fetch] Failed to fetch price for ${mintAddress}: HTTP ${response.status}`);
      return null;
    }
    const data = await response.json();
    if (data.data && data.data[mintAddress]) {
      return data.data[mintAddress].price;
    }
    return null;
  } catch (error) {
    console.error(`[Price Fetch] Error fetching price for ${mintAddress}:`, error);
    return null;
  }
}

function checkTrigger(currentPrice, tpPrice, slPrice) {
  if (currentPrice >= tpPrice) return 'TP';
  if (currentPrice <= slPrice) return 'SL';
  return null;
}

async function startMonitoringLoop(client) {
  console.log(`[Monitor] Starting background monitoring loop (Interval: ${CHECK_INTERVAL / 1000}s)`);

  setInterval(async () => {
    const monitors = await getAllActiveMonitors();
    if (monitors.length === 0) return;

    console.log(`[Monitor] Checking ${monitors.length} active position(s)...`);

    for (const monitor of monitors) {
      const currentPrice = await fetchCurrentPrice(monitor.mint_address);
      if (currentPrice === null) {
        continue; // Skip if price fetch fails
      }

      const triggerType = checkTrigger(currentPrice, monitor.tp_price, monitor.sl_price);

      if (triggerType) {
        console.log(`[Monitor] TRIGGER! User: ${monitor.user_discord_id}, Pool: ${monitor.pool_address}, Type: ${triggerType}`);

        const encryptedKey = await getEncryptedKey(monitor.user_discord_id);
        if (!encryptedKey) {
          console.error(`[Monitor] Critical: Trigger for user ${monitor.user_discord_id} but no key found.`);
          continue;
        }

        let user;
        try {
          user = await client.users.fetch(monitor.user_discord_id);
        } catch {
          console.error(`[Monitor] Could not fetch user ${monitor.user_discord_id}. Cannot send DM.`);
        }

        try {
          const privateKey = decrypt(encryptedKey);

          const result = await executePositionClose(
            monitor,
            triggerType,
            currentPrice,
            privateKey,
            process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com'
          );

          if (result.success) {
            await updateMonitorStatus(monitor.id, 'closed');
            console.log(`[Monitor] Successfully closed position for ${monitor.user_discord_id}. DB status updated.`);
            if (user) {
              user.send(`✅ **Position Closed!**\nYour monitor for **${monitor.token_symbol}** was triggered as a **${triggerType}** at price **$${currentPrice.toFixed(6)}**.\n\nTransaction: \`${result.signature}\``).catch(e => console.error("Failed to send success DM."));
            }
          } else {
            console.error(`[Monitor] Execution failed for ${monitor.user_discord_id}:`, result.error);
            if (user) {
              user.send(`❌ **Execution Failed!**\nYour monitor for **${monitor.token_symbol}** was triggered, but the transaction failed to execute.\n\nError: \`${result.error}\`\n\nThe bot will not try again. Please check your position manually.`).catch(e => console.error("Failed to send failure DM."));
              // We close it even on failure to prevent spamming the user on every loop
              await updateMonitorStatus(monitor.id, 'closed');
            }
          }
        } catch (e) {
          const error = e;
          console.error(`[Monitor] CRITICAL FAILURE during execution for ${monitor.user_discord_id}:`, error.message);
          if (user) {
            user.send(`❌ **Critical Bot Error!**\nYour monitor for **${monitor.token_symbol}** was triggered, but a critical error occurred (e.g., key decryption failed).\n\nPlease check your position manually. The monitor has been disabled.`).catch(e => console.error("Failed to send critical failure DM."));
            await updateMonitorStatus(monitor.id, 'closed');
          }
        }
      }
    }
  }, CHECK_INTERVAL);
}

// Bot ready event
client.once('ready', async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  
  try {
    // Initialize backend services
    await initializeDatabase();
    console.log('✅ Database connected successfully.');
    
    // Initialize wallet storage and register commands
    initWalletStorage();
    await registerCommands();
    
    // Start the main monitoring loop
    startMonitoringLoop(client);
    
    console.log('🚀 Bot is fully initialized and ready.');

  } catch (error) {
    console.error('❌ Bot failed to start due to a backend error:', error);
    process.exit(1); // Exit if critical services fail
  }
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
      
      case 'pnl':
        await handlePnlCard(interaction);
        break;
      
      case 'wallet':
        if (interaction.options.getSubcommand() === 'setup') {
          await handleWalletSetup(interaction);
        }
        break;

      case 'monitor':
        switch (interaction.options.getSubcommand()) {
          case 'add':
            await handleAddMonitor(interaction);
            break;
          case 'status':
            await handleMonitorStatus(interaction);
            break;
          case 'remove':
            await handleRemoveMonitor(interaction);
            break;
        }
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

// === TP/SL COMMAND HANDLERS ===

async function handleAddMonitor(interaction) {
  const monitor = {
    user_discord_id: interaction.user.id,
    pool_address: interaction.options.getString('pool_address'),
    token_symbol: interaction.options.getString('symbol'),
    mint_address: interaction.options.getString('mint_address'),
    tp_price: interaction.options.getNumber('tp_price'),
    sl_price: interaction.options.getNumber('sl_price'),
  };

  try {
    const key = await getEncryptedKey(interaction.user.id);
    if (!key) {
      await interaction.editReply({ content: '❌ You must set up a wallet first using `/wallet setup` in DMs.', ephemeral: true });
      return;
    }

    if (monitor.sl_price >= monitor.tp_price) {
        await interaction.editReply({ content: '❌ Stop-loss price must be less than the take-profit price.', ephemeral: true });
        return;
    }

    const result = await addMonitor(monitor);
    await interaction.editReply({ content: `✅ **Monitor created!**\nYour new monitor for **${monitor.token_symbol}** has been created with ID: \`${result.id}\`.`, ephemeral: true });
  } catch (error) {
    console.error('Failed to add monitor:', error);
    await interaction.editReply({ content: '❌ An error occurred while adding the monitor.', ephemeral: true });
  }
}

async function handleMonitorStatus(interaction) {
  try {
    const monitors = await getUserMonitors(interaction.user.id);
    if (monitors.length === 0) {
      await interaction.editReply({ content: 'ℹ️ You have no active monitors. Use `/monitor add` to create one.', ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor('#4a90e2')
      .setTitle('📊 Your Active Monitors')
      .setTimestamp();

    let description = '';
    monitors.forEach(m => {
      description += `**ID: ${m.id}** - **${m.token_symbol}**\n` +
                     `> Pool: \`${m.pool_address.substring(0, 12)}...\`\n` +
                     `> TP Price: \`$${m.tp_price}\`\n` +
                     `> SL Price: \`$${m.sl_price}\`\n\n`;
    });
    embed.setDescription(description);

    await interaction.editReply({ embeds: [embed], ephemeral: true });
  } catch (error) {
    console.error('Failed to get monitor status:', error);
    await interaction.editReply({ content: '❌ An error occurred while fetching your monitors.', ephemeral: true });
  }
}

async function handleRemoveMonitor(interaction) {
  const monitorId = interaction.options.getInteger('monitor_id');
  try {
    const changes = await removeMonitor(monitorId, interaction.user.id);
    if (changes > 0) {
      await interaction.editReply({ content: `✅ Monitor with ID \`${monitorId}\` has been successfully removed.`, ephemeral: true });
    } else {
      await interaction.editReply({ content: `❌ No active monitor found with ID \`${monitorId}\` under your account. Check your \`/monitor status\`.`, ephemeral: true });
    }
  } catch (error) {
    console.error('Failed to remove monitor:', error);
    await interaction.editReply({ content: '❌ An error occurred while removing the monitor.', ephemeral: true });
  }
}


// === COMMAND HANDLERS ===

async function handleWalletSetup(interaction) {
  // 1. Enforce DM-only for security
  if (interaction.inGuild()) {
    await interaction.editReply({
      content: '⚠️ For your security, the `/wallet setup` command can only be used in a Direct Message with me.',
      ephemeral: true,
    });
    return;
  }

  const privateKey = interaction.options.getString('private_key');
  const discordId = interaction.user.id;

  try {
    // 2. Encrypt the key immediately
    const encryptedKey = encrypt(privateKey);

    // 3. Save to the database
    await setupWallet(discordId, encryptedKey);

    // 4. Send a secure, ephemeral confirmation
    await interaction.editReply({
      content: '✅ Your wallet has been securely encrypted and saved. You can now use the `/monitor` commands in the server to manage your positions.',
      ephemeral: true,
    });
  } catch (error) {
    console.error(`Failed to setup wallet for user ${discordId}:`, error);
    await interaction.editReply({
      content: '❌ An error occurred while saving your wallet. Please ensure you have provided a valid private key and try again.',
      ephemeral: true,
    });
  }
}


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

// === UPDATED EMBED FUNCTIONS ===

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
    .setColor('#4a90e2')
    .setTitle('💼 Open LP Positions')
    .setDescription(`**👛 Wallet:** \`${walletAddress.substring(0, 8)}...${walletAddress.substring(walletAddress.length - 6)}\`\n\n**📊 Total Open Positions:** ${data.count}`)
    .setTimestamp();

  embeds.push(summaryEmbed);

  // Create embeds for positions
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const pnlSign = pos.pnl.percentNative >= 0 ? '📈' : '📉';
    const pnlColor = pos.pnl.percentNative >= 0 ? '+' : '';
    const uncollectedFeeNative = parseFloat(pos.unCollectedFeeNative || 0);
    const uncollectedFee = parseFloat(pos.unCollectedFee || 0);
    const shortPositionId = pos.position.substring(0, 8) + '...' + pos.position.substring(pos.position.length - 8);
    const calculatedValue = (pos.current.amount0Adjusted * pos.price0) + (pos.current.amount1Adjusted * pos.price1);
    const totalFees = parseFloat(pos.collectedFee + uncollectedFee).toFixed(2);
    const totalFeesNative = parseFloat(pos.collectedFeeNative + uncollectedFeeNative).toFixed(3);
    console.log('inRange:', pos.inRange);

    const posEmbed = new EmbedBuilder()
      .setColor(pos.inRange ? '#00ff00' : '#ff0000')
      .setTitle(`💧 ${pos.protocol.charAt(0).toUpperCase() + pos.protocol.slice(1)} | ${pos.tokenName0}/${pos.tokenName1}`)
      .setDescription(
        `**💼 Position ID:** \`${shortPositionId}\`\n` +
        `**📊 Status:** ${pos.inRange ? '✅ *In Range*' : '⚠️ *Out of Range*'} — *Active for ${pos.age} days*\n\n` +
        `**💰 Current Value:** \`$${calculatedValue.toFixed(4)}\`\n` +
        `**${pnlSign} PnL:** \`${pnlColor}${pos.pnl.percentNative.toFixed(2)}%\` (*${pnlColor}${pos.pnl.valueNative.toFixed(3)} Sol*)\n` +
        `**💵 Fees:** \`Collected: ${pos.collectedFeeNative.toFixed(3)}Sol($${pos.collectedFee.toFixed(2)}) | Uncollected: ${uncollectedFeeNative.toFixed(3)} SOl($${uncollectedFee.toFixed(2)}) | Total: ${totalFeesNative}sol($${totalFees}) \`${uncollectedFee > 0 ? ' 💰' : ''}\n\n` +
        `**🪙 Holdings**\n` +
        `• **${pos.tokenName0}:** ${pos.current.amount0Adjusted.toFixed(4)}\n` +
        `• **${pos.tokenName1}:** ${pos.current.amount1Adjusted.toFixed(4)}\n\n` +
        `**📉 Price Range**\n` +
        `• **Min:** \`${pos.priceRange[0].toFixed(6)}\`\n` +
        `• **Max:** \`${pos.priceRange[1].toFixed(6)}\``
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

async function handlePositionDetails(interaction) {
  const positionId = interaction.options.getString('position_id');
  const data = await lpAgent.getPositionDetails(positionId);
  
  if (!data || !data.data) {
    return interaction.editReply('❌ Could not fetch details for this position.');
  }

  const pos = data.data;
  const pnlSign = pos.pnl.percentNative >= 0 ? '📈' : '📉';
  const pnlColor = pos.pnl.percentNative >= 0 ? '+' : '';
  const shortPositionId = pos.position.substring(0, 8) + '...' + pos.position.substring(pos.position.length - 8);
  const shortOwner = pos.owner.substring(0, 8) + '...' + pos.owner.substring(pos.owner.length - 8);

  const embed = new EmbedBuilder()
    .setColor(pos.inRange ? '#00ff00' : '#ff0000')
    .setTitle(`💧 ${pos.protocol.charAt(0).toUpperCase() + pos.protocol.slice(1)} | ${pos.tokenName0}/${pos.tokenName1}`)
    .setDescription(
      `**💼 Position ID:** \`${shortPositionId}\`\n` +
      `**👤 Owner:** \`${shortOwner}\`\n` +
      `**📊 Status:** ${pos.inRange ? '✅ *In Range*' : '⚠️ *Out of Range*'} — *${pos.status} for ${pos.age} days*\n\n` +
      `**💰 Current Value:** \`$${parseFloat(pos.currentValue).toFixed(2)}\`\n` +
      `**💵 Input Value:** \`$${pos.inputValue.toFixed(2)}\`\n` +
      `**${pnlSign} PnL:** \`${pnlColor}${pos.pnl.percentNative.toFixed(2)}%\` (*${pnlColor}${pos.pnl.valueNative.toFixed(2)} Sol*)\n` +
      `**💸 Fees:** \`Collected: $${pos.collectedFeeNative.toFixed(2)} Sol | Uncollected: ${parseFloat(pos.unCollectedFeeNative || 0).toFixed(2)} Sol\`\n\n` +
      `**📉 Price Range**\n` +
      `• **Min:** \`${pos.priceRange[0].toFixed(6)}\`\n` +
      `• **Max:** \`${pos.priceRange[1].toFixed(6)}\`\n` +
      `• **Strategy:** ${pos.strategyType || 'N/A'}`
    )
    .setTimestamp();

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
  const shortWallet = d.owner.substring(0, 8) + '...' + d.owner.substring(d.owner.length - 8);

  const embed = new EmbedBuilder()
    .setColor(d.total_pnl.ALL >= 0 ? '#00ff00' : '#ff0000')
    .setTitle('💼 Wallet Overview & Performance')
    .setDescription(
      `**👛 Wallet:** \`${shortWallet}\`\n` +
      `**⛓️ Chain:** ${d.chain} | **🏦 Protocol:** ${d.protocol}\n\n` +
      `**${totalPnlSign} Total PnL:** \`${pnlColor}$${d.total_pnl.ALL.toFixed(2)}\`\n` +
      `**💰 Total Fees:** \`$${d.total_fee.ALL.toFixed(2)}\`\n` +
      `**💵 ROI:** \`${(d.roi * 100).toFixed(2)}%\`\n\n` +
      `**📊 Positions Overview**\n` +
      `• **Total:** ${d.total_lp}\n` +
      `• **Open:** ${d.opening_lp}\n` +
      `• **Closed:** ${d.closed_lp.ALL}\n` +
      `• **Win Rate:** ${(d.win_rate.ALL * 100).toFixed(2)}% (${d.win_lp}/${d.closed_lp.ALL} wins)\n\n` +
      `**💸 Flow Analysis**\n` +
      `• **Total Inflow:** $${d.total_inflow.toFixed(2)}\n` +
      `• **Total Outflow:** $${d.total_outflow.toFixed(2)}\n\n` +
      `**📊 Statistics**\n` +
      `• **Total Pools:** ${d.total_pool}\n` +
      `• **Avg Age:** ${d.avg_age_hour.toFixed(2)} hours\n\n` +
      `**📅 Performance Breakdown**\n` +
      `• **7 Days:** PnL $${d.total_pnl['7D'].toFixed(2)} | Fees $${d.total_fee['7D'].toFixed(2)}\n` +
      `• **1 Month:** PnL $${d.total_pnl['1M'].toFixed(2)} | Fees $${d.total_fee['1M'].toFixed(2)}\n` +
      `• **3 Months:** PnL $${d.total_pnl['3M'].toFixed(2)} | Fees $${d.total_fee['3M'].toFixed(2)}`
    )
    .setFooter({ text: `Last Updated: ${d.updated_at}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
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
  const shortWallet = walletAddress.substring(0, 8) + '...' + walletAddress.substring(walletAddress.length - 8);

  let description = `**👛 Wallet:** \`${shortWallet}\`\n\n` +
                   `**📄 Page ${pagination.currentPage}/${pagination.totalPages}** | **📊 Total:** ${pagination.totalCount} positions\n\n`;

  positions.forEach((pos, idx) => {
    const pnlSign = pos.pnl.percentNative >= 0 ? '✅' : '❌';
    const pnlColor = pos.pnl.percentNative >= 0 ? '+' : '';
    const posNum = (pagination.currentPage - 1) * pagination.pageSize + idx + 1;
    
    description += `**${posNum}. ${pos.tokenName0}/${pos.tokenName1} ${pnlSign}**\n` +
                   `• **PnL:** ${pnlColor}${pos.pnl.percentNative.toFixed(2)}% (${pnlColor}$${pos.pnl.value.toFixed(2)})\n` +
                   `• **Fees:** ${pos.collectedFeeNative.toFixed(2)} Sol\n` +
                   `• **Duration:** ${pos.age} days\n` +
                   `• **Opened:** ${new Date(pos.createdAt).toLocaleDateString()}\n` +
                   `• **Closed:** ${new Date(pos.closeAt).toLocaleDateString()}\n\n`;
  });

  const embed = new EmbedBuilder()
    .setColor('#4a90e2')
    .setTitle('📜 Position History')
    .setDescription(description)
    .setTimestamp();

  if (pagination.totalPages > 1) {
    embed.setFooter({ text: `Use /history wallet:<wallet> page:<number> to view other pages` });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handlePnlCard(interaction) {
  const solscanLink = interaction.options.getString('solscan_link');
  
  // Extract the transaction signature from the URL
  let signature;
  try {
    const url = new URL(solscanLink);
    const pathParts = url.pathname.split('/');
    // Find the 'tx' or 'transaction' part and get the next part as the signature
    const txIndex = pathParts.findIndex(part => part === 'tx' || part === 'transaction');
    if (txIndex !== -1 && pathParts.length > txIndex + 1) {
      signature = pathParts[txIndex + 1];
    } else {
      throw new Error('Invalid URL format');
    }
  } catch (error) {
    return interaction.editReply('❌ Invalid Solscan URL. Please provide a valid transaction link.');
  }

  if (!signature) {
    return interaction.editReply('❌ Could not extract transaction signature from the link.');
  }

  // Get the position ID from the transaction
  const positionId = await getPositionIdFromTx(signature);

  if (!positionId) {
    return interaction.editReply('❌ Could not find a valid position ID in that transaction. Please make sure it is the correct transaction.');
  }

  const data = await lpAgent.getPositionDetails(positionId);

  if (!data || !data.data) {
    return interaction.editReply('❌ Could not fetch position details from the API using the found ID.');
  }

  const positionData = data.data;

  try {
    const imageBuffer = await createPnLCard(positionData);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'pnl-card.png' });

    await interaction.editReply({ files: [attachment] });
  } catch (error) {
    console.error('Error generating PnL card:', error);
    await interaction.editReply('❌ An error occurred while generating the PnL card.');
  }
}

// Enhanced PnL card creation
async function createPnLCard(positionData) {
    const width = 878;
    const height = 449;
    
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Load and draw the background image
    const backgroundImagePath = path.join(__dirname, 'assets', 'background.png');
    try {
        const background = await loadImage(backgroundImagePath);
        ctx.drawImage(background, 0, 0, width, height);
    } catch (error) {
        console.error('Error loading background image:', error);
        // Fallback to a solid color if the image fails to load
        ctx.fillStyle = '#0F0B2F';
        ctx.fillRect(0, 0, width, height);
    }

    // Load and draw the meteor image
    const meteorImagePath = path.join(__dirname, 'assets', 'meteor.png');
    try {
        const meteor = await loadImage(meteorImagePath);
        // Adjust the position (x, y) and size (width, height) as needed
        ctx.drawImage(meteor, 400, 45, 500, 390); 
    } catch (error) {
        console.error('Could not load meteor.png:', error);
        // Continue without the meteor if the image is not found
    }

    // Add decorative grid pattern
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x <= width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }
    for (let y = 0; y <= height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }

    // TIME section
    ctx.font = 'bold 18px "DejaVu Sans Mono", "Liberation Mono", monospace';
    ctx.fillStyle = '#E5E7EB';
    ctx.textAlign = 'left';
    ctx.fillText('TIME', 40, 45);

    // Time elapsed
    const timeElapsed = utils.getTimeElapsed(positionData.ageHour);
    console.log('Time Elapsed:', timeElapsed);
    ctx.font = 'bold 42px "Courier New", "DejaVu Sans Mono", "Liberation Mono", monospace';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(timeElapsed, 40, 95);

    // DLMM label
    ctx.font = 'bold 16px "DejaVu Sans Mono", "Liberation Mono", monospace';
    ctx.fillStyle = '#9CA3AF';
    ctx.fillText('DLMM', 40, 120);

    // Token pair name
    const pairName = `${positionData.tokenName0}-${positionData.tokenName1}`;
    ctx.font = 'bold 52px "DejaVu Sans Mono", "Liberation Mono", monospace';
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.5)';
    ctx.lineWidth = 2;
    ctx.strokeText(pairName, 40, 170);
    ctx.fillText(pairName, 40, 170);

    // PROFIT label
    ctx.font = 'bold 18px "DejaVu Sans Mono", "Liberation Mono", monospace';
    ctx.fillStyle = '#E5E7EB';
    ctx.fillText('PROFIT', 40, 205);

    // PnL value
    const pnlValue = positionData.pnl?.valueNative || 0;
    const pnlColor = pnlValue >= 0 ? '#10B981' : '#EF4444';
    const pnlBgColor = pnlValue >= 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)';
    
    // PnL background
    ctx.fillStyle = pnlBgColor;
    ctx.fillRect(35, 230, 400, 60);
    
    // PnL text
    ctx.font = 'bold 76px "DejaVu Sans Mono", "Liberation Mono", monospace';
    ctx.fillStyle = pnlColor;
    ctx.fillText(utils.formatCurrency(pnlValue), 40, 275);

    // Status indicator
    const statusColor = positionData.status === 'Open' ? '#10B981' : '#6B7280';
    ctx.fillStyle = statusColor;
    ctx.beginPath();
    ctx.arc(500, 50, 8, 0, 2 * Math.PI);
    ctx.fill();
    
    ctx.font = '16px "DejaVu Sans Mono", "Liberation Mono", monospace';
    ctx.fillStyle = '#E5E7EB';
    ctx.fillText(positionData.status || 'Unknown', 520, 55);

    // Bottom metrics
    const bottomY = 410;
    ctx.font = '18px "DejaVu Sans Mono", "Liberation Mono", monospace';
    ctx.fillStyle = '#D1D5DB';

    // TVL
    ctx.textAlign = 'left';
    ctx.fillText(`TVL ${utils.formatCurrency(positionData.inputNative)}`, 40, bottomY);

    // BIN STEP
    const binStep = positionData.poolInfo?.tickSpacing || 100;
    ctx.textAlign = 'center';
    ctx.fillText(`BIN STEP ${binStep}`, width / 2 - 100, bottomY);

    // BASE FEE
    const baseFee = positionData.poolInfo?.fee ? (positionData.poolInfo.fee / 100) : 1;
    ctx.fillText(`BASE FEE ${utils.formatPercentage(baseFee / 100)}`, width / 2 + 100, bottomY);

    // PNL percentage
    ctx.textAlign = 'right';
    const pnlPercent = positionData.pnl?.percentNative || 0;
    const pnlPercentColor = pnlPercent >= 0 ? '#10B981' : '#EF4444';
    ctx.fillStyle = pnlPercentColor;
    ctx.font = 'bold 20px "DejaVu Sans Mono", "Liberation Mono", monospace';
    ctx.fillText(`PNL ${utils.formatPercentage(pnlPercent/100)}`, width - 40, bottomY);

    // Designer credit
    ctx.font = '12px "DejaVu Sans Mono", "Liberation Mono", "DejaVu Sans Mono", "Liberation Mono", monospace';
    ctx.fillStyle = '#6B7280';
    ctx.textAlign = 'center';
    ctx.fillText('Broke DAO', width / 2, height - 15);

    

    return canvas.toBuffer();
}

// Login to Discord
client.login(DISCORD_TOKEN);
