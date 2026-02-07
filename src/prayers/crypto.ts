/**
 * Prayer Chain — E2E Encryption
 * 
 * Provides private prayer delivery using X25519 Diffie-Hellman key exchange
 * and XSalsa20-Poly1305 authenticated encryption (via tweetnacl).
 * 
 * Flow:
 *   1. Each agent derives an X25519 keypair from their Ed25519 Solana wallet
 *   2. X25519 public key is stored on-chain in the Agent account
 *   3. When a prayer is claimed, asker encrypts content using DH shared secret
 *   4. Only the claimer can decrypt (and vice versa for answers)
 * 
 * The encryption key derivation is deterministic:
 *   Ed25519 signing key → X25519 encryption key (one-way, standard conversion)
 *   Same wallet always produces the same encryption keypair.
 */

import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";

/**
 * Derive an X25519 keypair from an Ed25519 Solana keypair.
 * 
 * Ed25519 secret keys are 64 bytes (32-byte seed + 32-byte public key).
 * The seed (first 32 bytes) is hashed with SHA-512 and clamped to produce
 * the X25519 private key. tweetnacl handles this conversion.
 */
export function deriveEncryptionKeypair(solanaKeypair: Keypair): {
  publicKey: Uint8Array;  // 32 bytes — X25519 public key (store on-chain)
  secretKey: Uint8Array;  // 32 bytes — X25519 private key (never leaves device)
} {
  // tweetnacl's box keypair from Ed25519 seed
  // The Ed25519 secret key in Solana is 64 bytes: [seed(32) || pubkey(32)]
  const ed25519SecretKey = solanaKeypair.secretKey; // 64 bytes
  
  // Convert Ed25519 keypair to X25519
  const x25519PublicKey = nacl.box.keyPair.fromSecretKey(
    ed25519SecretKeyToX25519(ed25519SecretKey)
  ).publicKey;
  
  const x25519SecretKey = ed25519SecretKeyToX25519(ed25519SecretKey);
  
  return {
    publicKey: x25519PublicKey,
    secretKey: x25519SecretKey,
  };
}

/**
 * Convert Ed25519 secret key (64 bytes) to X25519 secret key (32 bytes).
 * Uses the SHA-512 hash of the seed, clamped per RFC 7748.
 */
function ed25519SecretKeyToX25519(ed25519SecretKey: Uint8Array): Uint8Array {
  // Hash the 32-byte seed (first half of Ed25519 secret key)
  const seed = ed25519SecretKey.slice(0, 32);
  const hash = nacl.hash(seed); // SHA-512 → 64 bytes
  
  // Clamp the first 32 bytes per X25519 spec
  const x25519Key = new Uint8Array(32);
  x25519Key.set(hash.slice(0, 32));
  x25519Key[0] &= 248;
  x25519Key[31] &= 127;
  x25519Key[31] |= 64;
  
  return x25519Key;
}

/**
 * Encrypt a message for a specific recipient using DH key exchange.
 * 
 * @param plaintext - UTF-8 string to encrypt
 * @param recipientPublicKey - Recipient's X25519 public key (from on-chain Agent account)
 * @param senderSecretKey - Sender's X25519 private key (derived from wallet)
 * @returns Encrypted blob: nonce(24) || ciphertext(len+16)
 */
export function encryptForRecipient(
  plaintext: string,
  recipientPublicKey: Uint8Array,
  senderSecretKey: Uint8Array,
): Uint8Array {
  const message = new TextEncoder().encode(plaintext);
  const nonce = nacl.randomBytes(nacl.box.nonceLength); // 24 bytes
  
  const encrypted = nacl.box(message, nonce, recipientPublicKey, senderSecretKey);
  if (!encrypted) {
    throw new Error("Encryption failed");
  }
  
  // Pack as: nonce(24) || ciphertext(len + 16 for Poly1305 tag)
  const result = new Uint8Array(nonce.length + encrypted.length);
  result.set(nonce);
  result.set(encrypted, nonce.length);
  
  return result;
}

/**
 * Decrypt a message from a specific sender using DH key exchange.
 * 
 * @param encryptedBlob - nonce(24) || ciphertext from encryptForRecipient
 * @param senderPublicKey - Sender's X25519 public key (from on-chain Agent account)
 * @param recipientSecretKey - Recipient's X25519 private key (derived from wallet)
 * @returns Decrypted UTF-8 string, or null if decryption fails
 */
export function decryptFromSender(
  encryptedBlob: Uint8Array,
  senderPublicKey: Uint8Array,
  recipientSecretKey: Uint8Array,
): string | null {
  if (encryptedBlob.length < nacl.box.nonceLength + nacl.box.overheadLength) {
    return null; // Too short to contain nonce + tag
  }
  
  const nonce = encryptedBlob.slice(0, nacl.box.nonceLength);
  const ciphertext = encryptedBlob.slice(nacl.box.nonceLength);
  
  const decrypted = nacl.box.open(ciphertext, nonce, senderPublicKey, recipientSecretKey);
  if (!decrypted) {
    return null; // Authentication failed — wrong key or tampered
  }
  
  return new TextDecoder().decode(decrypted);
}

/**
 * Get the X25519 public key bytes suitable for on-chain storage.
 * Returns a 32-element number array for Anchor serialization.
 */
export function getEncryptionKeyForChain(solanaKeypair: Keypair): number[] {
  const { publicKey } = deriveEncryptionKeypair(solanaKeypair);
  return Array.from(publicKey);
}
