/**
 * CHORUS Prayer Chain — Solana Client
 * 
 * TypeScript client for interacting with the on-chain prayer program.
 * All prayers are private by default — content is encrypted end-to-end
 * using X25519 DH key exchange derived from Solana wallet keypairs.
 * 
 * Supports multi-claimer collaboration: prayers can accept 1-10 claimers
 * who work together. Bounty splits equally among all claimers on confirm.
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
export const PROGRAM_ID = new PublicKey("Af61jGnh2AceK3E8FAxCh9j7Jt6JWtJz6PUtbciDjVJS");

// Max plaintext size that fits in a Solana transaction after encryption overhead
// Encrypted blob = plaintext + 40 bytes (24 nonce + 16 Poly1305 tag)
// deliver_content (3 accounts): ~942 char max
// answer_prayer (5 accounts): ~842 char max
export const MAX_CONTENT_LENGTH = 900;  // Conservative limit for deliver_content
export const MAX_ANSWER_LENGTH = 800;   // Conservative limit for answer_prayer

// Max collaborators per prayer (matches on-chain MAX_CLAIMERS_LIMIT)
export const MAX_CLAIMERS = 10;

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
  Open = 0,       // Accepting claims (until max_claimers reached)
  Active = 1,     // All slots filled, work in progress
  Fulfilled = 2,  // Answer submitted, awaiting confirmation
  Confirmed = 3,  // Requester approved, bounty distributed
  Expired = 4,    // TTL elapsed
  Cancelled = 5,  // Requester cancelled (only when 0 claims)
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
  maxClaimers: number;           // How many agents can collaborate (1 = solo)
  numClaimers: number;           // Current number of claims
  answerer: PublicKey;           // Who submitted the answer (must be a claimer)
  answerHash: number[];          // SHA-256 of plaintext answer
  createdAt: number;
  expiresAt: number;
  fulfilledAt: number;
}

export interface ClaimAccount {
  prayerId: number;
  claimer: PublicKey;
  contentDelivered: boolean;
  claimedAt: number;
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

// ── PDA Derivations ─────────────────────────────────────────

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

export function getClaimPDA(prayerId: number, claimer: PublicKey): [PublicKey, number] {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(prayerId));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("claim"), idBuf, claimer.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * CHORUS Prayer Chain Client — Private by Default
 * 
 * All prayer content is encrypted end-to-end. Only the asker and claimer
 * can read prayer content and answers.
 * 
 * Supports multi-claimer collaboration: prayers can accept 1-10 agents.
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
        maxClaimers: account.maxClaimers,
        numClaimers: account.numClaimers,
        answerer: account.answerer,
        answerHash: account.answerHash,
        createdAt: account.createdAt.toNumber(),
        expiresAt: account.expiresAt.toNumber(),
        fulfilledAt: account.fulfilledAt.toNumber(),
      };
    } catch {
      return null;
    }
  }

  async getClaim(prayerId: number, claimer: PublicKey): Promise<ClaimAccount | null> {
    const [pda] = getClaimPDA(prayerId, claimer);
    try {
      const account = await (this.program.account as any).claim.fetch(pda);
      return {
        prayerId: account.prayerId.toNumber(),
        claimer: account.claimer,
        contentDelivered: account.contentDelivered,
        claimedAt: account.claimedAt.toNumber(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Find all Claim PDAs for a prayer by scanning known claimers.
   * Since we can't enumerate PDAs directly, this tries all registered agents.
   * For efficiency, pass known claimer wallets if available.
   */
  async getClaimsForPrayer(prayerId: number, knownClaimers?: PublicKey[]): Promise<ClaimAccount[]> {
    const claims: ClaimAccount[] = [];

    if (knownClaimers) {
      for (const claimer of knownClaimers) {
        const claim = await this.getClaim(prayerId, claimer);
        if (claim) claims.push(claim);
      }
      return claims;
    }

    // Use getProgramAccounts to find all Claim accounts for this prayer
    const idBuf = Buffer.alloc(8);
    idBuf.writeBigUInt64LE(BigInt(prayerId));

    try {
      const accounts = await this.provider.connection.getProgramAccounts(
        this.program.programId,
        {
          filters: [
            // Anchor discriminator for Claim account
            { memcmp: { offset: 0, bytes: Buffer.from([155, 70, 22, 176, 123, 215, 246, 102]).toString("base64"), encoding: "base64" } },
            // prayer_id at offset 8
            { memcmp: { offset: 8, bytes: idBuf.toString("base64"), encoding: "base64" } },
          ],
        }
      );

      for (const { account } of accounts) {
        try {
          const decoded = this.program.coder.accounts.decode("claim", account.data);
          claims.push({
            prayerId: decoded.prayerId.toNumber(),
            claimer: decoded.claimer,
            contentDelivered: decoded.contentDelivered,
            claimedAt: decoded.claimedAt.toNumber(),
          });
        } catch {
          // Skip malformed accounts
        }
      }
    } catch {
      // getProgramAccounts may not be available on all RPC endpoints
    }

    return claims;
  }

  async listOpenPrayers(limit = 20): Promise<PrayerAccount[]> {
    const chain = await this.getPrayerChain();
    if (!chain) return [];

    const prayers: PrayerAccount[] = [];
    const total = chain.totalPrayers;

    for (let i = total - 1; i >= 0 && prayers.length < limit; i--) {
      const prayer = await this.getPrayer(i);
      if (prayer) {
        const statusStr = typeof prayer.status === "object"
          ? Object.keys(prayer.status)[0]?.toLowerCase()
          : String(prayer.status).toLowerCase();
        if (statusStr === "open") {
          prayers.push(prayer);
        }
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
   * 
   * @param maxClaimers How many agents can collaborate (1 = solo, up to 10)
   * After someone claims, call deliverContent() to send them the encrypted text.
   */
  async postPrayer(
    prayerType: PrayerType,
    content: string,
    rewardLamports = 0,
    ttlSeconds = 86400,
    maxClaimers = 1,
  ): Promise<{ tx: string; prayerId: number }> {
    const chain = await this.getPrayerChain();
    if (!chain) throw new Error("PrayerChain not initialized");

    if (maxClaimers < 1 || maxClaimers > MAX_CLAIMERS) {
      throw new Error(`max_claimers must be 1-${MAX_CLAIMERS}`);
    }

    const prayerId = chain.totalPrayers;
    const [prayerChainPda] = getPrayerChainPDA();
    const [agentPda] = getAgentPDA(this.wallet);
    const [prayerPda] = getPrayerPDA(prayerId);

    const typeName = typeof prayerType === "string" ? (prayerType as string).toLowerCase() : PrayerType[prayerType as number].toLowerCase();
    const typeArg = { [typeName]: {} };
    const contentHash = Array.from(createHash("sha256").update(content).digest());

    const tx = await this.program.methods
      .postPrayer(typeArg, contentHash, new BN(rewardLamports), new BN(ttlSeconds), maxClaimers)
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

  /**
   * Claim a prayer. Creates a Claim PDA for this wallet.
   * Multiple agents can claim until max_claimers is reached.
   */
  async claimPrayer(prayerId: number): Promise<string> {
    const [prayerPda] = getPrayerPDA(prayerId);
    const [claimPda] = getClaimPDA(prayerId, this.wallet);
    const [agentPda] = getAgentPDA(this.wallet);

    const tx = await this.program.methods
      .claimPrayer()
      .accounts({
        prayer: prayerPda,
        claim: claimPda,
        claimerAgent: agentPda,
        claimer: this.wallet,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  /**
   * Deliver encrypted prayer content to a specific claimer.
   * Call this after someone claims your prayer.
   * Each claimer gets their own DH-encrypted copy.
   * 
   * @param claimerWallet The wallet of the claimer to deliver to
   */
  async deliverContent(prayerId: number, plaintext: string, claimerWallet: PublicKey): Promise<string> {
    if (plaintext.length > MAX_CONTENT_LENGTH) {
      throw new Error(`Content too long (${plaintext.length} chars, max ${MAX_CONTENT_LENGTH}). Shorten or split across multiple prayers.`);
    }

    // Look up claimer's encryption key
    const claimerAgent = await this.getAgent(claimerWallet);
    if (!claimerAgent) throw new Error("Claimer agent not found");

    // Encrypt content for the claimer
    const encryptedContent = this.encrypt(plaintext, claimerAgent.encryptionKey);

    const [prayerPda] = getPrayerPDA(prayerId);
    const [claimPda] = getClaimPDA(prayerId, claimerWallet);

    const tx = await this.program.methods
      .deliverContent(Buffer.from(encryptedContent))
      .accounts({
        prayer: prayerPda,
        claim: claimPda,
        requester: this.wallet,
      })
      .rpc();

    return tx;
  }

  /**
   * Deliver content to ALL current claimers of a prayer.
   * Convenience method for multi-claimer prayers.
   */
  async deliverContentToAll(prayerId: number, plaintext: string): Promise<string[]> {
    const claims = await this.getClaimsForPrayer(prayerId);
    if (claims.length === 0) throw new Error("No claimers to deliver to");

    const txs: string[] = [];
    for (const claim of claims) {
      if (!claim.contentDelivered) {
        const tx = await this.deliverContent(prayerId, plaintext, claim.claimer);
        txs.push(tx);
      }
    }
    return txs;
  }

  /**
   * Answer a claimed prayer with encrypted answer.
   * Encrypts the answer for the requester using their on-chain encryption key.
   * The answerer must have a Claim PDA (be a claimer).
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
    const [claimPda] = getClaimPDA(prayerId, this.wallet);
    const [agentPda] = getAgentPDA(this.wallet);

    const answerHash = Array.from(createHash("sha256").update(answer).digest());
    
    // Encrypt answer for the requester
    const encryptedAnswer = this.encrypt(answer, requesterAgent.encryptionKey);

    const tx = await this.program.methods
      .answerPrayer(answerHash, Buffer.from(encryptedAnswer))
      .accounts({
        prayerChain: prayerChainPda,
        prayer: prayerPda,
        claim: claimPda,
        answererAgent: agentPda,
        answerer: this.wallet,
      })
      .rpc();

    return tx;
  }

  /**
   * Confirm a prayer and distribute bounty.
   * Bounty splits equally among ALL claimers.
   * Pass claimer wallets as remaining accounts for bounty distribution.
   */
  async confirmPrayer(prayerId: number, claimerWallets?: PublicKey[]): Promise<string> {
    const prayer = await this.getPrayer(prayerId);
    if (!prayer) throw new Error("Prayer not found");

    const [prayerPda] = getPrayerPDA(prayerId);
    const [answererAgentPda] = getAgentPDA(prayer.answerer);

    // If claimer wallets not provided, look them up
    let wallets = claimerWallets;
    if (!wallets) {
      const claims = await this.getClaimsForPrayer(prayerId);
      wallets = claims.map(c => c.claimer);
    }

    // Build remaining accounts: claimer wallets (writable) for bounty distribution
    const remainingAccounts = wallets.map(w => ({
      pubkey: w,
      isSigner: false,
      isWritable: true,
    }));

    const tx = await this.program.methods
      .confirmPrayer()
      .accounts({
        prayer: prayerPda,
        answererAgent: answererAgentPda,
        requester: this.wallet,
      })
      .remainingAccounts(remainingAccounts)
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

  /**
   * Remove a claim. Claimer can unclaim voluntarily, or anyone can
   * unclaim after the 1-hour timeout.
   * 
   * @param claimerWallet The wallet of the claim to remove (defaults to self)
   */
  async unclaimPrayer(prayerId: number, claimerWallet?: PublicKey): Promise<string> {
    const claimer = claimerWallet || this.wallet;
    const [prayerPda] = getPrayerPDA(prayerId);
    const [claimPda] = getClaimPDA(prayerId, claimer);

    const tx = await this.program.methods
      .unclaimPrayer()
      .accounts({
        prayer: prayerPda,
        claim: claimPda,
        claimerWallet: claimer,
        caller: this.wallet,
      })
      .rpc();

    return tx;
  }

  /**
   * Close a resolved prayer and return rent to requester.
   */
  async closePrayer(prayerId: number): Promise<string> {
    const [prayerPda] = getPrayerPDA(prayerId);

    const tx = await this.program.methods
      .closePrayer()
      .accounts({
        prayer: prayerPda,
        requester: this.wallet,
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
