// ============================================
// METEORA AUTO TP/SL BOT - MONITORING SERVICE
// ============================================
// Core logic refactored for integration with other apps (e.g., Discord Bot)
// ============================================

import * as fs from 'fs';
const { executePositionClose, handleExecutionError } = require('./execution');
const dotenv = require('dotenv');

dotenv.config();

// ============================================
// CONFIGURATION & TYPES
// ============================================

const TOKENS_FILE = './tokens.json';
const STATE_FILE = './bot-state.json';

// In-memory cache for token configurations and global settings
let monitoredTokens: TokenConfig[] = [];
let dryRun: boolean = process.env.DRY_RUN === 'true';

// --- Replicated Interfaces from monitor.ts ---
type TokenStatus = 'monitoring' | 'close_in_progress' | 'closed';

interface TokenConfig {
  tokenSymbol: string;
  tokenMintAddress: string;
  tpPrice: number;
  slPrice: number;
}

interface TokenState {
  status: TokenStatus;
  closedAt: string | null;
  closedPrice: number | null;
  triggerType: 'TP' | 'SL' | null;
  lastCheckedPrice: number | null;
  lastCheckedAt: string | null;
  checksPerformed: number;
}

interface TriggerResult {
    shouldTrigger: boolean;
    type: 'TP' | 'SL' | null;
    currentPrice: number;
    targetPrice: number;
}

interface StateFile {
  [tokenMintAddress: string]: TokenState;
}

interface TokensFile {
  tokens: TokenConfig[];
}


// ============================================
// PUBLIC API (for the Discord bot to call)
// ============================================

/**
 * Loads tokens from tokens.json into memory.
 * Should be called once when the bot starts.
 */
export function initializeMonitor(): string {
    if (!fs.existsSync(TOKENS_FILE)) {
        fs.writeFileSync(TOKENS_FILE, JSON.stringify({ tokens: [] }, null, 2));
    }
    const data = fs.readFileSync(TOKENS_FILE, 'utf-8');
    const tokensFile: TokensFile = JSON.parse(data);
    monitoredTokens = tokensFile.tokens;
    return `[Monitoring Service] Initialized. Monitoring ${monitoredTokens.length} token(s).`;
}

/**
 * Performs a single price check for all monitored tokens.
 * This should be called by a setInterval in your main bot file.
 * @returns {Promise<string[]>} An array of human-readable messages about triggered events.
 */
export async function checkAllTokens(): Promise<string[]> {
    const stateFile = loadState();
    const triggerMessages: string[] = [];

    for (const token of monitoredTokens) {
        const triggerMessage = await checkSingleToken(token, stateFile);
        if (triggerMessage) {
            triggerMessages.push(triggerMessage);
        }
    }

    saveState(stateFile);
    return triggerMessages;
}

/**
 * Gets a formatted status report of all monitored tokens.
 * @returns {string} A formatted status string ready to be sent to Discord.
 */
export function getMonitoringStatus(): string {
    if (monitoredTokens.length === 0) {
        return "Not currently monitoring any tokens. Use `/add` to start monitoring.";
    }

    const stateFile = loadState();
    let statusReport = "📈 **Monitoring Status** 📉\n";

    monitoredTokens.forEach(token => {
        const state = getTokenState(stateFile, token.tokenMintAddress);
        const currentPrice = state.lastCheckedPrice;

        statusReport += `\n**${token.tokenSymbol}** - Status: **${state.status.toUpperCase()}**\n`;
        statusReport += `> TP: \`$${formatPrice(token.tpPrice)}\` | SL: \`$${formatPrice(token.slPrice)}\`\n`;

        if (state.status === 'monitoring' && currentPrice !== null) {
            const tpDistance = ((token.tpPrice - currentPrice) / currentPrice * 100);
            const slDistance = ((currentPrice - token.slPrice) / currentPrice * 100);
            statusReport += `> Current: \`$${formatPrice(currentPrice)}\`\n`;
            statusReport += `> Dist to TP: \`${tpDistance.toFixed(2)}%\` | Dist to SL: \`${slDistance.toFixed(2)}%\`\n`;
        } else if (state.status === 'closed') {
            statusReport += `> Closed at \`$${formatPrice(state.closedPrice || 0)}\` (${state.triggerType})\n`;
        }
    });

    return statusReport;
}

/**
 * Adds a new token to be monitored and saves it to tokens.json.
 * @param {TokenConfig} newToken - The token configuration object.
 * @returns {string} A confirmation message.
 */
export function addTokenToMonitor(newToken: TokenConfig): string {
    const validationError = validateToken(newToken);
    if (validationError) {
        return `❌ Error: ${validationError}`;
    }

    const existingIndex = monitoredTokens.findIndex(t => t.tokenMintAddress === newToken.tokenMintAddress);
    if (existingIndex !== -1) {
        monitoredTokens[existingIndex] = newToken; // Update if exists
    } else {
        monitoredTokens.push(newToken); // Add if new
    }
    
    saveTokensToFile();
    return `✅ Successfully added/updated **${newToken.tokenSymbol}** to the monitor.`;
}

/**
 * Removes a token from the monitor.
 * @param {string} tokenSymbolOrMint - The symbol or mint address of the token to remove.
 * @returns {string} A confirmation or error message.
 */
export function removeTokenFromMonitor(tokenSymbolOrMint: string): string {
    const initialCount = monitoredTokens.length;
    monitoredTokens = monitoredTokens.filter(t => t.tokenSymbol !== tokenSymbolOrMint && t.tokenMintAddress !== tokenSymbolOrMint);

    if (monitoredTokens.length < initialCount) {
        saveTokensToFile();
        return `✅ Successfully removed **${tokenSymbolOrMint}** from the monitor.`;
    } else {
        return `❌ Could not find a token with symbol or mint **${tokenSymbolOrMint}**.`;
    }
}

// ============================================
// INTERNAL LOGIC (adapted from monitor.ts)
// ============================================

async function checkSingleToken(token: TokenConfig, stateFile: StateFile): Promise<string | null> {
    const state = getTokenState(stateFile, token.tokenMintAddress);

    if (state.status !== 'monitoring') {
        return null; // Skip if already closed or a close is in progress
    }

    const currentPrice = await fetchCurrentPrice(token);
    if (currentPrice === null) {
        return `⚠️ Failed to fetch price for **${token.tokenSymbol}**.`;
    }

    state.lastCheckedPrice = currentPrice;
    state.lastCheckedAt = new Date().toISOString();
    state.checksPerformed += 1;

    const trigger = checkTriggerConditions(currentPrice, token);

    if (trigger.shouldTrigger) {
        state.status = 'close_in_progress';
        saveState(stateFile); // Lock the state

        if (!dryRun) {
            try {
                const result = await executePositionClose(token.tokenSymbol, trigger.type!, currentPrice);
                if (result.success) {
                    state.status = 'closed';
                    state.closedAt = new Date().toISOString();
                    state.closedPrice = currentPrice;
                    state.triggerType = trigger.type;
                    return `✅ **${token.tokenSymbol} Position Closed!** (${trigger.type}) at \`$${formatPrice(currentPrice)}\`. Tx: \`${result.signature}\``;
                } else {
                    handleExecutionError(new Error(result.error), token.tokenSymbol, trigger.type!);
                    state.status = 'monitoring'; // Unlock on failure
                    return `❌ **${token.tokenSymbol} Close Failed!** Error: ${result.error}. Will retry.`;
                }
            } catch (error) {
                handleExecutionError(error as Error, token.tokenSymbol, trigger.type!);
                state.status = 'monitoring'; // Unlock on failure
                return `❌ **${token.tokenSymbol} Close Failed!** An unexpected error occurred. Will retry.`;
            }
        } else {
            // Dry Run simulation
            state.status = 'closed';
            state.closedAt = new Date().toISOString();
            state.closedPrice = currentPrice;
            state.triggerType = trigger.type;
            return `🧪 **[DRY RUN]** ${token.tokenSymbol} ${trigger.type} triggered at \`$${formatPrice(currentPrice)}\`.`;
        }
    }
    
    return null; // No trigger
}

// ============================================
// HELPER FUNCTIONS (adapted from monitor.ts)
// ============================================

function loadState(): StateFile {
  if (fs.existsSync(STATE_FILE)) {
    const data = fs.readFileSync(STATE_FILE, 'utf-8');
    try {
        return JSON.parse(data);
    } catch {
        return {}; // Handle corrupted state file
    }
  }
  return {};
}

function getTokenState(stateFile: StateFile, tokenMint: string): TokenState {
  if (!stateFile[tokenMint]) {
    stateFile[tokenMint] = {
      status: 'monitoring',
      closedAt: null,
      closedPrice: null,
      triggerType: null,
      lastCheckedPrice: null,
      lastCheckedAt: null,
      checksPerformed: 0,
    };
  }
  return stateFile[tokenMint];
}

function saveState(stateFile: StateFile): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(stateFile, null, 2));
}

function saveTokensToFile(): void {
    fs.writeFileSync(TOKENS_FILE, JSON.stringify({ tokens: monitoredTokens }, null, 2));
}

function validateToken(token: TokenConfig): string | null {
  if (!token.tpPrice || token.tpPrice <= 0) {
    return `tpPrice must be set and greater than 0`;
  }
  if (!token.slPrice || token.slPrice <= 0) {
    return `slPrice must be set and greater than 0`;
  }
  if (token.slPrice >= token.tpPrice) {
    return `slPrice must be less than tpPrice`;
  }
  if (!token.tokenMintAddress || token.tokenMintAddress === '') {
    return `tokenMintAddress is required`;
  }
  return null;
}

async function fetchCurrentPrice(token: TokenConfig): Promise<number | null> {
    const url = `https://lite-api.jup.ag/price/v3?ids=${token.tokenMintAddress}`;
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const data = await response.json();
        return data[token.tokenMintAddress]?.usdPrice || null;
    } catch (error) {
        return null;
    }
}

function checkTriggerConditions(currentPrice: number, token: TokenConfig): TriggerResult {
  if (currentPrice >= token.tpPrice) {
    return { shouldTrigger: true, type: 'TP', currentPrice, targetPrice: token.tpPrice };
  }
  if (currentPrice <= token.slPrice) {
    return { shouldTrigger: true, type: 'SL', currentPrice, targetPrice: token.slPrice };
  }
  return { shouldTrigger: false, type: null, currentPrice, targetPrice: 0 };
}

function formatPrice(price: number): string {
    if (!price) return '0.00';
    if (price < 0.0001) return price.toExponential(4);
    if (price < 1) return price.toFixed(6);
    return price.toFixed(4);
}

