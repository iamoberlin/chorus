/**
 * CHORUS Prayer Chain — Solana Client
 * 
 * TypeScript client for interacting with the on-chain prayer program.
 * All prayers are private by default — content is encrypted end-to-end
 * using X25519 DH key exchange derived from Solana wallet keypairs.
 */

import { Program, AnchorProvider, web3, Wallet } from "@coral-xyz/anchor";
import BN from "bn.js";
import { Connection, PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  deriveEncryptionKeypair,
  encryptForRecipient,
  decryptFromSender,
  getEncryptionKeyForChain,
} from "./crypto.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Program ID (deployed to devnet)
export const PROGRAM_ID = new PublicKey("DZuj1ZcX4H6THBSgW4GhKA7SbZNXtPDE5xPkW2jN53PQ");

// Max plaintext size that fits in a Solana transaction after encryption overhead
// Encrypted blob = plaintext + 40 bytes (24 nonce + 16 Poly1305 tag)
// deliver_content (2 accounts): ~982 bytes available → 942 char max
// answer_prayer (4 accounts): ~882 bytes available → 842 char max
export const MAX_CONTENT_LENGTH = 900;  // Conservative limit for deliver_content
export const MAX_ANSWER_LENGTH = 800;   // Conservative limit for answer_prayer

// Prayer types matching the on-chain enum
export enum PrayerType {
  Knowledge = 0,
  Compute = 1,
  Review = 2,
  Signal = 3,
  Collaboration = 4,
}

// Prayer status matching the on-chain enum
export enum PrayerStatus {
  Open = 0,
  Claimed = 1,
  Fulfilled = 2,
  Confirmed = 3,
  Expired = 4,
  Cancelled = 5,
}

export interface PrayerChainState {
  authority: PublicKey;
  totalPrayers: number;
  totalAnswered: number;
  totalAgents: number;
}

export interface AgentAccount {
  wallet: PublicKey;
  name: string;
  skills: string;
  encryptionKey: number[];       // X25519 public key for E2E encryption
  prayersPosted: number;
  prayersAnswered: number;
  prayersConfirmed: number;
  reputation: number;
  registeredAt: number;
}

export interface PrayerAccount {
  id: number;
  requester: PublicKey;
  prayerType: PrayerType;
  contentHash: number[];         // SHA-256 of plaintext content
  rewardLamports: number;
  status: PrayerStatus;
  claimer: PublicKey;
  claimedAt: number;
  answerHash: number[];          // SHA-256 of plaintext answer
  createdAt: number;
  expiresAt: number;
  fulfilledAt: number;
}

// Load IDL from the build output
function loadIDL(): any {
  const candidates = [
    path.join(__dirname, "../../idl/chorus_prayers.json"),
    path.join(__dirname, "../../target/idl/chorus_prayers.json"),
  ];
  for (const idlPath of candidates) {
    if (fs.existsSync(idlPath)) {
      return JSON.parse(fs.readFileSync(idlPath, "utf-8"));
    }
  }
  throw new Error(
    `IDL not found. Looked in:\n${candidates.map(p => `  - ${p}`).join("\n")}\nRun 'anchor build' or check that idl/chorus_prayers.json exists.`
  );
}

// PDA derivations
export function getPrayerChainPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("prayer-chain")],
    PROGRAM_ID
  );
}

export function getAgentPDA(wallet: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), wallet.toBuffer()],
    PROGRAM_ID
  );
}

export function getPrayerPDA(prayerId: number): [PublicKey, number] {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(prayerId));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("prayer"), idBuf],
    PROGRAM_ID
  );
}

/**
 * CHORUS Prayer Chain Client — Private by Default
 * 
 * All prayer content is encrypted end-to-end. Only the asker and claimer
 * can read prayer content and answers.
 */
export class ChorusPrayerClient {
  program: Program;
  provider: AnchorProvider;
  wallet: PublicKey;
  private keypair: Keypair;
  private encryptionKeypair: { publicKey: Uint8Array; secretKey: Uint8Array };

  constructor(connection: Connection, keypair: Keypair) {
    const wallet = new Wallet(keypair);
    this.provider = new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    const idl = loadIDL();
    this.program = new Program(idl, this.provider);
    this.wallet = keypair.publicKey;
    this.keypair = keypair;
    this.encryptionKeypair = deriveEncryptionKeypair(keypair);
  }

  static fromKeypairFile(rpcUrl: string, keypairPath: string): ChorusPrayerClient {
    const connection = new Connection(rpcUrl, "confirmed");
    const raw = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
    const keypair = Keypair.fromSecretKey(Uint8Array.from(raw));
    return new ChorusPrayerClient(connection, keypair);
  }

  static fromDefaultKeypair(rpcUrl: string): ChorusPrayerClient {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const keypairPath = path.join(home, ".config", "solana", "id.json");
    return ChorusPrayerClient.fromKeypairFile(rpcUrl, keypairPath);
  }

  /** Get this agent's X25519 encryption public key (for on-chain storage) */
  getEncryptionPublicKey(): number[] {
    return Array.from(this.encryptionKeypair.publicKey);
  }

  /** 
   * Encrypt content for a recipient given their on-chain encryption key.
   * Returns the encrypted blob as a number array (for Anchor serialization).
   */
  encrypt(plaintext: string, recipientEncryptionKey: number[]): number[] {
    const recipientKey = Uint8Array.from(recipientEncryptionKey);
    const encrypted = encryptForRecipient(plaintext, recipientKey, this.encryptionKeypair.secretKey);
    return Array.from(encrypted);
  }

  /**
   * Decrypt content from a sender given their on-chain encryption key.
   * Returns the plaintext string, or null if decryption fails.
   */
  decrypt(encryptedBlob: number[], senderEncryptionKey: number[]): string | null {
    const blob = Uint8Array.from(encryptedBlob);
    const senderKey = Uint8Array.from(senderEncryptionKey);
    return decryptFromSender(blob, senderKey, this.encryptionKeypair.secretKey);
  }

  // ── Read Methods ──────────────────────────────────────────

  async getPrayerChain(): Promise<PrayerChainState | null> {
    const [pda] = getPrayerChainPDA();
    try {
      const account = await (this.program.account as any).prayerChain.fetch(pda);
      return {
        authority: account.authority,
        totalPrayers: account.totalPrayers.toNumber(),
        totalAnswered: account.totalAnswered.toNumber(),
        totalAgents: account.totalAgents.toNumber(),
      };
    } catch {
      return null;
    }
  }

  async getAgent(wallet: PublicKey): Promise<AgentAccount | null> {
    const [pda] = getAgentPDA(wallet);
    try {
      const account = await (this.program.account as any).agent.fetch(pda);
      return {
        wallet: account.wallet,
        name: account.name,
        skills: account.skills,
        encryptionKey: account.encryptionKey,
        prayersPosted: account.prayersPosted.toNumber(),
        prayersAnswered: account.prayersAnswered.toNumber(),
        prayersConfirmed: account.prayersConfirmed.toNumber(),
        reputation: account.reputation.toNumber(),
        registeredAt: account.registeredAt.toNumber(),
      };
    } catch {
      return null;
    }
  }

  async getPrayer(prayerId: number): Promise<PrayerAccount | null> {
    const [pda] = getPrayerPDA(prayerId);
    try {
      const account = await (this.program.account as any).prayer.fetch(pda);
      return {
        id: account.id.toNumber(),
        requester: account.requester,
        prayerType: Object.keys(account.prayerType)[0] as unknown as PrayerType,
        contentHash: account.contentHash,
        rewardLamports: account.rewardLamports.toNumber(),
        status: Object.keys(account.status)[0] as unknown as PrayerStatus,
        claimer: account.claimer,
        claimedAt: account.claimedAt.toNumber(),
        answerHash: account.answerHash,
        createdAt: account.createdAt.toNumber(),
        expiresAt: account.expiresAt.toNumber(),
        fulfilledAt: account.fulfilledAt.toNumber(),
      };
    } catch {
      return null;
    }
  }

  async listOpenPrayers(limit = 20): Promise<PrayerAccount[]> {
    const chain = await this.getPrayerChain();
    if (!chain) return [];

    const prayers: PrayerAccount[] = [];
    const total = chain.totalPrayers;

    for (let i = total - 1; i >= 0 && prayers.length < limit; i--) {
      const prayer = await this.getPrayer(i);
      if (prayer && prayer.status === PrayerStatus.Open) {
        prayers.push(prayer);
      }
    }

    return prayers;
  }

  // ── Write Methods ─────────────────────────────────────────

  async initialize(): Promise<string> {
    const [prayerChainPda] = getPrayerChainPDA();

    const tx = await this.program.methods
      .initialize()
      .accounts({
        prayerChain: prayerChainPda,
        authority: this.wallet,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  async registerAgent(name: string, skills: string): Promise<string> {
    const [prayerChainPda] = getPrayerChainPDA();
    const [agentPda] = getAgentPDA(this.wallet);

    const encryptionKey = this.getEncryptionPublicKey();

    const tx = await this.program.methods
      .registerAgent(name, skills, encryptionKey)
      .accounts({
        prayerChain: prayerChainPda,
        agent: agentPda,
        wallet: this.wallet,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  /**
   * Post a prayer. Content is stored locally and as a hash on-chain.
   * No plaintext ever touches the blockchain.
   * After someone claims, call deliverContent() to send them the encrypted text.
   */
  async postPrayer(
    prayerType: PrayerType,
    content: string,
    rewardLamports = 0,
    ttlSeconds = 86400
  ): Promise<{ tx: string; prayerId: number }> {
    const chain = await this.getPrayerChain();
    if (!chain) throw new Error("PrayerChain not initialized");

    const prayerId = chain.totalPrayers;
    const [prayerChainPda] = getPrayerChainPDA();
    const [agentPda] = getAgentPDA(this.wallet);
    const [prayerPda] = getPrayerPDA(prayerId);

    const typeName = typeof prayerType === "string" ? prayerType.toLowerCase() : PrayerType[prayerType].toLowerCase();
    const typeArg = { [typeName]: {} };
    const contentHash = Array.from(createHash("sha256").update(content).digest());

    const tx = await this.program.methods
      .postPrayer(typeArg, contentHash, new BN(rewardLamports), new BN(ttlSeconds))
      .accounts({
        prayerChain: prayerChainPda,
        requesterAgent: agentPda,
        prayer: prayerPda,
        requester: this.wallet,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { tx, prayerId };
  }

  async claimPrayer(prayerId: number): Promise<string> {
    const [prayerPda] = getPrayerPDA(prayerId);
    const [agentPda] = getAgentPDA(this.wallet);

    const tx = await this.program.methods
      .claimPrayer()
      .accounts({
        prayer: prayerPda,
        claimerAgent: agentPda,
        claimer: this.wallet,
      })
      .rpc();

    return tx;
  }

  /**
   * Deliver encrypted prayer content to the claimer.
   * Call this after someone claims your prayer.
   * Looks up the claimer's encryption key on-chain and encrypts the content.
   */
  async deliverContent(prayerId: number, plaintext: string): Promise<string> {
    if (plaintext.length > MAX_CONTENT_LENGTH) {
      throw new Error(`Content too long (${plaintext.length} chars, max ${MAX_CONTENT_LENGTH}). Shorten or split across multiple prayers.`);
    }

    const prayer = await this.getPrayer(prayerId);
    if (!prayer) throw new Error("Prayer not found");
    
    // Look up claimer's encryption key
    const claimerAgent = await this.getAgent(prayer.claimer);
    if (!claimerAgent) throw new Error("Claimer agent not found");

    // Encrypt content for the claimer
    const encryptedContent = this.encrypt(plaintext, claimerAgent.encryptionKey);

    const [prayerPda] = getPrayerPDA(prayerId);

    const tx = await this.program.methods
      .deliverContent(Buffer.from(encryptedContent))
      .accounts({
        prayer: prayerPda,
        requester: this.wallet,
      })
      .rpc();

    return tx;
  }

  /**
   * Answer a claimed prayer with encrypted answer.
   * Encrypts the answer for the requester using their on-chain encryption key.
   */
  async answerPrayer(prayerId: number, answer: string): Promise<string> {
    if (answer.length > MAX_ANSWER_LENGTH) {
      throw new Error(`Answer too long (${answer.length} chars, max ${MAX_ANSWER_LENGTH}). Shorten or split.`);
    }

    const prayer = await this.getPrayer(prayerId);
    if (!prayer) throw new Error("Prayer not found");

    // Look up requester's encryption key
    const requesterAgent = await this.getAgent(prayer.requester);
    if (!requesterAgent) throw new Error("Requester agent not found");

    const [prayerPda] = getPrayerPDA(prayerId);
    const [prayerChainPda] = getPrayerChainPDA();
    const [agentPda] = getAgentPDA(this.wallet);

    const answerHash = Array.from(createHash("sha256").update(answer).digest());
    
    // Encrypt answer for the requester
    const encryptedAnswer = this.encrypt(answer, requesterAgent.encryptionKey);

    const tx = await this.program.methods
      .answerPrayer(answerHash, Buffer.from(encryptedAnswer))
      .accounts({
        prayerChain: prayerChainPda,
        prayer: prayerPda,
        answererAgent: agentPda,
        answerer: this.wallet,
      })
      .rpc();

    return tx;
  }

  async confirmPrayer(prayerId: number): Promise<string> {
    const prayer = await this.getPrayer(prayerId);
    if (!prayer) throw new Error("Prayer not found");

    const [prayerPda] = getPrayerPDA(prayerId);
    const [answererAgentPda] = getAgentPDA(prayer.claimer);

    const tx = await this.program.methods
      .confirmPrayer()
      .accounts({
        prayer: prayerPda,
        answererAgent: answererAgentPda,
        answererWallet: prayer.claimer,
        requester: this.wallet,
      })
      .rpc();

    return tx;
  }

  async cancelPrayer(prayerId: number): Promise<string> {
    const [prayerPda] = getPrayerPDA(prayerId);

    const tx = await this.program.methods
      .cancelPrayer()
      .accounts({
        prayer: prayerPda,
        requester: this.wallet,
      })
      .rpc();

    return tx;
  }

  async unclaimPrayer(prayerId: number): Promise<string> {
    const [prayerPda] = getPrayerPDA(prayerId);

    const tx = await this.program.methods
      .unclaimPrayer()
      .accounts({
        prayer: prayerPda,
        claimer: this.wallet,
      })
      .rpc();

    return tx;
  }
}

// ── CLI Helper ──────────────────────────────────────────────

export async function createDefaultClient(
  rpcUrl = "https://api.devnet.solana.com"
): Promise<ChorusPrayerClient> {
  return ChorusPrayerClient.fromDefaultKeypair(rpcUrl);
}
