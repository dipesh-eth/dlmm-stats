// ============================================
// DATABASE SERVICE
// ============================================
// Handles all interaction with the SQLite database.
// Creates the DB file and tables if they don't exist.
// ============================================

import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';

// Define the structure of our monitor objects, consistent with other files
interface Monitor {
    id?: number; // Optional because it's auto-incremented
    user_discord_id: string;
    pool_address: string;
    token_symbol: string;
    mint_address: string;
    tp_price: number;
    sl_price: number;
    status: 'monitoring' | 'closed'; // Simplified status for the DB
}

let db: Database;

/**
 * Initializes the database connection and creates tables if they don't exist.
 * This function must be called once when the bot starts up.
 */
export async function initializeDatabase(): Promise<void> {
    try {
        db = await open({
            filename: './bot-database.db', // The file where the data will be stored
            driver: sqlite3.Database
        });

        // Use 'IF NOT EXISTS' to prevent errors on subsequent startups
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                discord_id TEXT PRIMARY KEY,
                encrypted_private_key TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await db.exec(`
            CREATE TABLE IF NOT EXISTS monitors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_discord_id TEXT NOT NULL,
                pool_address TEXT NOT NULL,
                token_symbol TEXT NOT NULL,
                mint_address TEXT NOT NULL,
                tp_price REAL NOT NULL,
                sl_price REAL NOT NULL,
                status TEXT NOT NULL DEFAULT 'monitoring', 
                FOREIGN KEY (user_discord_id) REFERENCES users (discord_id)
            );
        `);

        await db.exec(`
            CREATE TABLE IF NOT EXISTS position_fee_snapshots (
                position_id TEXT NOT NULL,
                wallet TEXT NOT NULL,
                recorded_ms INTEGER NOT NULL,
                fee_native REAL NOT NULL,
                PRIMARY KEY (position_id, wallet, recorded_ms)
            );
            CREATE INDEX IF NOT EXISTS idx_fee_snapshots_lookup
                ON position_fee_snapshots (position_id, wallet, recorded_ms);
        `);
        
        console.log('[Database] Connection initialized and tables verified.');
    } catch (error) {
        console.error('[Database] Failed to initialize:', error);
        throw error; // Propagate the error to stop the bot if the DB can't start
    }
}

/**
 * Stores a compact fee checkpoint every five minutes. A 24-hour fee/TVL value
 * becomes available after the service has observed the open position for a day.
 */
export async function recordFeeSnapshotAndGet24hRate(
    positionId: string,
    wallet: string,
    earnedFeeNative: number,
    currentValueNative: number,
): Promise<number | null> {
    if (!db || !Number.isFinite(earnedFeeNative) || currentValueNative <= 0) return null;

    const now = Date.now();
    const cutoff = now - 24 * 60 * 60 * 1000;
    const latest = await db.get<{ recorded_ms: number }>(
        `SELECT recorded_ms FROM position_fee_snapshots
         WHERE position_id = ? AND wallet = ? ORDER BY recorded_ms DESC LIMIT 1`,
        positionId,
        wallet,
    );
    const baseline = await db.get<{ fee_native: number }>(
        `SELECT fee_native FROM position_fee_snapshots
         WHERE position_id = ? AND wallet = ? AND recorded_ms <= ?
         ORDER BY recorded_ms DESC LIMIT 1`,
        positionId,
        wallet,
        cutoff,
    );

    if (!latest || now - latest.recorded_ms >= 5 * 60 * 1000) {
        await db.run(
            'INSERT INTO position_fee_snapshots (position_id, wallet, recorded_ms, fee_native) VALUES (?, ?, ?, ?)',
            positionId,
            wallet,
            now,
            earnedFeeNative,
        );
    }
    await db.run('DELETE FROM position_fee_snapshots WHERE recorded_ms < ?', now - 48 * 60 * 60 * 1000);

    if (!baseline) return null;
    return Math.max(0, ((earnedFeeNative - baseline.fee_native) / currentValueNative) * 100);
}

/**
 * Saves or updates a user's encrypted private key.
 * @param discordId The user's unique Discord ID.
 * @param encryptedPrivateKey The private key, PRE-ENCRYPTED.
 */
export async function setupWallet(discordId: string, encryptedPrivateKey: string): Promise<void> {
    // "INSERT OR REPLACE" is a handy SQLite feature (UPSERT)
    await db.run(
        'INSERT OR REPLACE INTO users (discord_id, encrypted_private_key) VALUES (?, ?)',
        discordId,
        encryptedPrivateKey
    );
}

/**
 * Retrieves the encrypted private key for a user.
 * @param discordId The user's unique Discord ID.
 * @returns The encrypted key, or null if not found.
 */
export async function getEncryptedKey(discordId: string): Promise<string | null> {
    const result = await db.get('SELECT encrypted_private_key FROM users WHERE discord_id = ?', discordId);
    return result?.encrypted_private_key || null;
}

/**
 * Adds a new monitoring rule for a user.
 * @param monitor The monitor object to add.
 */
export async function addMonitor(monitor: Monitor): Promise<{ id: number }> {
    const result = await db.run(
        'INSERT INTO monitors (user_discord_id, pool_address, token_symbol, mint_address, tp_price, sl_price) VALUES (?, ?, ?, ?, ?, ?)',
        monitor.user_discord_id,
        monitor.pool_address,
        monitor.token_symbol,
        monitor.mint_address,
        monitor.tp_price,
        monitor.sl_price
    );
    return { id: result.lastID! };
}

/**
 * Fetches all active monitors for a specific user.
 * @param discordId The user's unique Discord ID.
 */
export async function getUserMonitors(discordId: string): Promise<Monitor[]> {
    return db.all('SELECT * FROM monitors WHERE user_discord_id = ? AND status = "monitoring"', discordId);
}

/**
 * Fetches ALL active monitors from ALL users. Used for the main checking loop.
 */
export async function getAllActiveMonitors(): Promise<Monitor[]> {
    return db.all('SELECT * FROM monitors WHERE status = "monitoring"');
}

/**
 * Updates the status of a monitor (e.g., to 'closed').
 * @param monitorId The ID of the monitor to update.
 * @param status The new status.
 */
export async function updateMonitorStatus(monitorId: number, status: 'monitoring' | 'closed'): Promise<void> {
    await db.run('UPDATE monitors SET status = ? WHERE id = ?', status, monitorId);
}

/**
 * Removes a monitor from the database.
 * @param monitorId The ID of the monitor to remove.
 * @param discordId The Discord ID of the user, for security.
 * @returns The number of rows deleted (0 or 1).
 */
export async function removeMonitor(monitorId: number, discordId: string): Promise<number> {
    // We include discordId in the WHERE clause to ensure users can only delete their own monitors
    const result = await db.run('DELETE FROM monitors WHERE id = ? AND user_discord_id = ?', monitorId, discordId);
    return result.changes!;
}
