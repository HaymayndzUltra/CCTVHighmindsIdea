/**
 * CryptoService — AES-256-CBC encryption/decryption for face embeddings.
 *
 * Key derivation uses PBKDF2 with a machine-bound identifier
 * (os.hostname + app salt). The derived key hash is stored in
 * settings for validation on startup (detect if machine changed).
 */

import crypto from 'crypto';
import os from 'os';
import { getSetting, setSetting } from './DatabaseService';

const ALGORITHM = 'aes-256-cbc';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = 'sha512';
const APP_SALT = 'tapo-cctv-desktop-embedding-salt-v1';

let derivedKey: Buffer | null = null;

function getMachineIdentifier(): string {
  const hostname = os.hostname();
  return `${hostname}::${APP_SALT}`;
}

function deriveKey(machineId: string): Buffer {
  const salt = Buffer.from(APP_SALT, 'utf-8');
  return crypto.pbkdf2Sync(machineId, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
}

function hashKey(key: Buffer): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Initialize the CryptoService.
 *
 * Derives the encryption key from the machine identifier and validates
 * it against the stored key hash. If no hash is stored (first run),
 * stores the current key hash. If the hash mismatches (machine changed),
 * logs a warning — existing encrypted embeddings may be unreadable.
 */
export function initCrypto(): void {
  const machineId = getMachineIdentifier();
  derivedKey = deriveKey(machineId);

  const currentHash = hashKey(derivedKey);
  const storedHash = getSetting('encryption_key_hash');

  if (!storedHash) {
    setSetting('encryption_key_hash', currentHash);
    console.log('[CryptoService] Encryption key initialized (first run).');
    return;
  }

  if (storedHash !== currentHash) {
    console.warn(
      '[CryptoService] WARNING: Machine identifier changed. ' +
      'Existing encrypted embeddings may not be decryptable. ' +
      'Old hash: %s, New hash: %s',
      storedHash.substring(0, 8),
      currentHash.substring(0, 8)
    );
  } else {
    console.log('[CryptoService] Encryption key validated successfully.');
  }
}

function getKey(): Buffer {
  if (!derivedKey) {
    throw new Error('[CryptoService] Not initialized. Call initCrypto() first.');
  }
  return derivedKey;
}

/**
 * Encrypt data using AES-256-CBC.
 *
 * @param data - Buffer to encrypt.
 * @returns Object with encrypted Buffer and IV Buffer.
 */
export function encrypt(data: Buffer): { encrypted: Buffer; iv: Buffer } {
  if (!data || data.length === 0) {
    throw new Error('[CryptoService] Cannot encrypt empty data.');
  }

  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return { encrypted, iv };
}

/**
 * Decrypt data using AES-256-CBC.
 *
 * @param encrypted - Encrypted Buffer.
 * @param iv - Initialization vector Buffer.
 * @returns Decrypted Buffer.
 */
export function decrypt(encrypted: Buffer, iv: Buffer): Buffer {
  if (!encrypted || encrypted.length === 0) {
    throw new Error('[CryptoService] Cannot decrypt empty data.');
  }
  if (!iv || iv.length !== IV_LENGTH) {
    throw new Error(`[CryptoService] Invalid IV length: expected ${IV_LENGTH}, got ${iv?.length ?? 0}.`);
  }

  const key = getKey();

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[CryptoService] Decryption failed: ${message}`);
    throw new Error(`Decryption failed: ${message}`);
  }
}

/**
 * Encrypt a float32 embedding array for storage.
 *
 * @param embedding - Array of 512 floats.
 * @returns Object with encrypted Buffer and IV Buffer.
 */
export function encryptEmbedding(embedding: number[]): { encrypted: Buffer; iv: Buffer } {
  const buffer = Buffer.alloc(embedding.length * 4);
  for (let i = 0; i < embedding.length; i++) {
    buffer.writeFloatLE(embedding[i], i * 4);
  }
  return encrypt(buffer);
}

/**
 * Decrypt a stored embedding back to a float32 array.
 *
 * @param encrypted - Encrypted embedding Buffer.
 * @param iv - Initialization vector Buffer.
 * @returns Array of floats (512-dim).
 */
export function decryptEmbedding(encrypted: Buffer, iv: Buffer): number[] {
  const decrypted = decrypt(encrypted, iv);
  const floatCount = decrypted.length / 4;
  const embedding: number[] = new Array(floatCount);
  for (let i = 0; i < floatCount; i++) {
    embedding[i] = decrypted.readFloatLE(i * 4);
  }
  return embedding;
}
