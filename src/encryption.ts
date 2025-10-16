// ============================================
// ENCRYPTION SERVICE
// ============================================
// Handles AES-256 encryption and decryption for user private keys.
// Requires a 32-byte secret key to be set in the .env file.
// ============================================

import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16; // For AES, this is always 16

// Load and validate the secret key from environment variables
const secretKeyFromEnv = process.env.ENCRYPTION_SECRET_KEY;
if (!secretKeyFromEnv || secretKeyFromEnv.length !== 32) {
    throw new Error('ENCRYPTION_SECRET_KEY is not set in the .env file or is not 32 characters long.');
}
const secretKey = Buffer.from(secretKeyFromEnv);

/**
 * Encrypts a plain text string (e.g., a private key).
 * @param text The plain text to encrypt.
 * @returns A string containing the iv and encrypted data, separated by a colon.
 */
export function encrypt(text: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, secretKey, iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    // Prepend the IV to the encrypted data for use in decryption
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

/**
 * Decrypts an encrypted string.
 * @param text The encrypted text (iv:encryptedData).
 * @returns The original plain text.
 */
export function decrypt(text: string): string {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift()!, 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, secretKey, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}
