// ============================================
// METEORA POSITION EXECUTOR - PHASE 2
// ============================================
// Handles closing Meteora DLMM positions when TP/SL triggers
// ============================================

import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import BN from 'bn.js';
import bs58 from 'bs58';

// Dynamic import to handle module compatibility
let DLMM: any;
async function initDLMM() {
    if (!DLMM) {
        const module = await import('@meteora-ag/dlmm');
        DLMM = (module as any).default || module;
    }
    return DLMM;
}

// ============================================
// TYPES
// ============================================

interface ExecutionConfig {
    rpcEndpoint: string;
    walletPrivateKey: string;
    poolAddress: string;
    maxRetries: number;
    retryDelayMs: number;
}

interface ExecutionResult {
    success: boolean;
    signature?: string;
    error?: string;
    timestamp: string;
}

// ============================================
// CONFIGURATION LOADING
// ============================================

function loadExecutionConfig(): ExecutionConfig {
    const config: ExecutionConfig = {
        rpcEndpoint: process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
        walletPrivateKey: process.env.WALLET_PRIVATE_KEY || '',
        poolAddress: process.env.POOL_ADDRESS || '',
        maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
        retryDelayMs: parseInt(process.env.RETRY_DELAY_MS || '2000'),
    };

    // Validate required fields
    if (!config.walletPrivateKey) {
        throw new Error('WALLET_PRIVATE_KEY not set in environment');
    }

    if (!config.poolAddress) {
        throw new Error('POOL_ADDRESS not set in environment');
    }

    return config;
}

// ============================================
// WALLET SETUP
// ============================================

function loadWallet(privateKeyString: string): Keypair {
    let secretKey: Uint8Array;

    try {
        // Try parsing as a JSON array of numbers
        if (privateKeyString.startsWith('[') && privateKeyString.endsWith(']')) {
            console.log("   Attempting to load wallet from JSON array format...");
            const parsed = JSON.parse(privateKeyString);
            secretKey = Uint8Array.from(parsed);
            return Keypair.fromSecretKey(secretKey);
        }

        // Try parsing as a comma-separated string of numbers
        if (privateKeyString.includes(',')) {
            console.log("   Attempting to load wallet from comma-separated format...");
            const numbers = privateKeyString.split(',').map(n => parseInt(n.trim(), 10));
            secretKey = Uint8Array.from(numbers);
            return Keypair.fromSecretKey(secretKey);
        }

        // Try parsing as a BS58 encoded string
        console.log("   Attempting to load wallet from BS58 format...");
        secretKey = bs58.decode(privateKeyString);
        return Keypair.fromSecretKey(secretKey);

    } catch (error) {
        throw new Error(`Failed to load wallet. Please check the format of your WALLET_PRIVATE_KEY. Error: ${(error as Error).message}`);
    }
}

// ============================================
// METEORA POSITION CLOSING
// ============================================

async function getUserPositions(
    dlmm: any,
    userPublicKey: PublicKey
): Promise<any[]> {
    try {
        console.log(`📥 Fetching user positions...`);

        const { userPositions } = await dlmm.getPositionsByUserAndLbPair(userPublicKey);

        if (userPositions.length === 0) {
            throw new Error('No positions found for this wallet in the pool');
        }

        console.log(`✅ Found ${userPositions.length} position(s)`);
        return userPositions;
    } catch (error) {
        throw new Error(`Failed to fetch user positions: ${(error as Error).message}`);
    }
}

async function removeAllLiquidityFromPosition(
    dlmm: any,
    position: any,
    userPublicKey: PublicKey
): Promise<Transaction | Transaction[]> {
    try {
        console.log(`🔨 Building remove liquidity transaction...`);
        console.log(`   Position: ${position.publicKey.toString()}`);
        console.log(`   [DEBUG] Full position data:`, JSON.stringify(position, null, 2));

        // Get all bin IDs from the position
        const binIdsToRemove = position.positionData.positionBinData.map(
            (bin: any) => bin.binId
        );

        if (binIdsToRemove.length === 0) {
            throw new Error('Position has no liquidity to remove');
        }

        console.log(`   Removing liquidity from ${binIdsToRemove.length} bin(s)...`);

        // Remove 100% of liquidity and close position
        const removeLiquidityTx = await dlmm.removeLiquidity({
            position: position.publicKey,
            user: userPublicKey,
            fromBinId: binIdsToRemove[0],
            toBinId: binIdsToRemove[binIdsToRemove.length - 1],
            bps: new BN(100 * 100), // 100% (in basis points: 10000 = 100%)
            shouldClaimAndClose: true, // Claim fees and close position in same tx
        });

        console.log(`✅ Transaction(s) built`);
        return removeLiquidityTx;

    } catch (error) {
        throw new Error(`Failed to build remove liquidity transaction: ${(error as Error).message}`);
    }
}

async function executeTransactions(
    connection: Connection,
    transactions: Transaction | Transaction[],
    wallet: Keypair
): Promise<string[]> {
    try {
        const txArray = Array.isArray(transactions) ? transactions : [transactions];
        const signatures: string[] = [];

        console.log(`📤 Sending ${txArray.length} transaction(s)...`);

        for (let i = 0; i < txArray.length; i++) {
            const tx = txArray[i];

            console.log(`   Transaction ${i + 1}/${txArray.length}...`);
            console.log(`   Broadcasting to the network...`);
            
            // Add recent blockhash and sign
            tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
            tx.feePayer = wallet.publicKey;

            const signature = await sendAndConfirmTransaction(
                connection,
                tx,
                [wallet],
                {
                    skipPreflight: false,
                    preflightCommitment: 'confirmed',
                    commitment: 'confirmed',
                }
            );

            signatures.push(signature);
            console.log(`   ✅ Confirmed: ${signature}`);
            console.log(`   🔗 https://solscan.io/tx/${signature}`);
        }

        console.log(`✅ All transactions confirmed!`);
        return signatures;

    } catch (error) {
        console.error(`   ❌ Transaction failed: ${(error as Error).message}`);
        // Log the full error for more details, including potential signature
        console.error(error); 
        throw new Error(`Failed to execute transactions: ${(error as Error).message}`);
    }
}

// ============================================
// RETRY LOGIC
// ============================================

async function executeWithRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number,
    delayMs: number,
    operationName: string
): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 1) {
                console.log(`🔄 Retry ${attempt}/${maxRetries} for ${operationName}...`);
            }
            return await fn();
        } catch (error) {
            lastError = error as Error;
            console.error(`❌ Attempt ${attempt} failed: ${lastError.message}`);

            if (attempt < maxRetries) {
                const delay = delayMs * attempt; // Exponential backoff
                console.log(`⏳ Waiting ${delay}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    throw new Error(`Failed after ${maxRetries} attempts: ${lastError!.message}`);
}

// ============================================
// MAIN EXECUTION FUNCTION
// ============================================

async function executePositionClose(
    tokenSymbol: string,
    triggerType: 'TP' | 'SL',
    triggerPrice: number
): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
        console.log();
        console.log('═══════════════════════════════════════════════');
        console.log('   🚀 EXECUTING POSITION CLOSE');
        console.log('═══════════════════════════════════════════════');
        console.log(`📊 Token: ${tokenSymbol}`);
        console.log(`🎯 Trigger: ${triggerType}`);
        console.log(`💵 Price: $${triggerPrice.toFixed(6)}`);
        console.log('═══════════════════════════════════════════════');
        console.log();

        // Load configuration
        console.log('📋 Loading configuration...');
        const config = loadExecutionConfig();
        console.log(`✅ RPC: ${config.rpcEndpoint}`);
        console.log(`✅ Pool: ${config.poolAddress}`);
        console.log();

        // Setup connection and wallet
        console.log('🔌 Connecting to Solana...');
        const connection = new Connection(config.rpcEndpoint, 'confirmed');
        const wallet = loadWallet(config.walletPrivateKey);
        console.log(`✅ Wallet: ${wallet.publicKey.toString()}`);
        console.log();

        // Initialize Meteora DLMM
        console.log('🌪️  Initializing Meteora DLMM...');
        const DLMMClass = await initDLMM();
        const dlmm = await executeWithRetry(
            () => DLMMClass.create(connection, new PublicKey(config.poolAddress)),
            config.maxRetries,
            config.retryDelayMs,
            'Initialize DLMM'
        );
        console.log(`✅ DLMM initialized`);
        console.log();

        // Get user positions
        const userPositions = await executeWithRetry(
            () => getUserPositions(dlmm, wallet.publicKey),
            config.maxRetries,
            config.retryDelayMs,
            'Fetch User Positions'
        );

        console.log();

        // For MVP: close the first position
        // TODO: Add logic to identify which position to close based on token
        const position = userPositions[0];
        console.log(`🎯 Closing position: ${position.publicKey.toString()}`);
        console.log();

        // Build remove liquidity transactions
        const transactions = await executeWithRetry(
            () => removeAllLiquidityFromPosition(dlmm, position, wallet.publicKey),
            config.maxRetries,
            config.retryDelayMs,
            'Build Remove Liquidity Transaction'
        );

        console.log();

        // Execute transactions
        const signatures = await executeWithRetry(
            () => executeTransactions(connection, transactions, wallet),
            config.maxRetries,
            config.retryDelayMs,
            'Execute Transactions'
        );

        const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);
        const mainSignature = signatures[0];

        console.log();
        console.log('═══════════════════════════════════════════════');
        console.log('   ✅ POSITION CLOSED SUCCESSFULLY');
        console.log('═══════════════════════════════════════════════');
        console.log(`📊 Token: ${tokenSymbol}`);
        console.log(`🎯 Trigger: ${triggerType} at $${triggerPrice.toFixed(6)}`);
        console.log(`🔗 Main Transaction: ${mainSignature}`);
        if (signatures.length > 1) {
            console.log(`📄 Total Transactions: ${signatures.length}`);
        }
        console.log(`⏱️  Execution Time: ${executionTime}s`);
        console.log('═══════════════════════════════════════════════');
        console.log();

        return {
            success: true,
            signature: mainSignature,
            timestamp: new Date().toISOString(),
        };

    } catch (error) {
        console.error();
        console.error('═══════════════════════════════════════════════');
        console.error('   ❌ POSITION CLOSE FAILED');
        console.error('═══════════════════════════════════════════════');
        console.error(`Error: ${(error as Error).message}`);
        console.error('═══════════════════════════════════════════════');
        console.error();

        return {
            success: false,
            error: (error as Error).message,
            timestamp: new Date().toISOString(),
        };
    }
}

// ============================================
// ERROR HANDLING
// ============================================

function handleExecutionError(
    error: Error,
    tokenSymbol: string,
    triggerType: 'TP' | 'SL'
): void {
    console.error();
    console.error('⚠️  EXECUTION ERROR - POSITION NOT CLOSED');
    console.error(`Token: ${tokenSymbol}`);
    console.error(`Trigger: ${triggerType}`);
    console.error(`Error: ${error.message}`);
    console.error();
    console.error('🔄 Bot will continue monitoring...');
    console.error('💡 Check your configuration and wallet balance');
    console.error();
}

// ============================================
// EXPORTS
// ============================================

export {
  executePositionClose,
  handleExecutionError
};