/**
 * CHORUS Prayer Chain — Solana Client
 * 
 * TypeScript client for interacting with the on-chain prayer program.
 * Wraps the Anchor-generated IDL for ergonomic usage.
 */

import { Program, AnchorProvider, web3, Wallet } from "@coral-xyz/anchor";
import BN from "bn.js";
import { Connection, PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Program ID (deployed to devnet)
export const PROGRAM_ID = new PublicKey("DZuj1ZcX4H6THBSgW4GhKA7SbZNXtPDE5xPkW2jN53PQ");

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
  contentHash: number[];         // SHA-256 of content (full text off-chain)
  rewardLamports: number;
  status: PrayerStatus;
  claimer: PublicKey;
  claimedAt: number;
  answerHash: number[];          // SHA-256 of answer (full text off-chain)
  createdAt: number;
  expiresAt: number;
  fulfilledAt: number;
}

// Load IDL from the build output
function loadIDL(): any {
  const idlPath = path.join(__dirname, "../../target/idl/chorus_prayers.json");
  if (!fs.existsSync(idlPath)) {
    throw new Error(`IDL not found at ${idlPath}. Run 'anchor build' first.`);
  }
  return JSON.parse(fs.readFileSync(idlPath, "utf-8"));
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
 * CHORUS Prayer Chain Client
 */
export class ChorusPrayerClient {
  program: Program;
  provider: AnchorProvider;
  wallet: PublicKey;

  constructor(connection: Connection, keypair: Keypair) {
    const wallet = new Wallet(keypair);
    this.provider = new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    const idl = loadIDL();
    this.program = new Program(idl, this.provider);
    this.wallet = keypair.publicKey;
  }

  /**
   * Create from a keypair file path
   */
  static fromKeypairFile(
    rpcUrl: string,
    keypairPath: string
  ): ChorusPrayerClient {
    const connection = new Connection(rpcUrl, "confirmed");
    const raw = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
    const keypair = Keypair.fromSecretKey(Uint8Array.from(raw));
    return new ChorusPrayerClient(connection, keypair);
  }

  /**
   * Create from default Solana CLI keypair
   */
  static fromDefaultKeypair(rpcUrl: string): ChorusPrayerClient {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const keypairPath = path.join(home, ".config", "solana", "id.json");
    return ChorusPrayerClient.fromKeypairFile(rpcUrl, keypairPath);
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

    // Scan backwards from newest
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

    const tx = await this.program.methods
      .registerAgent(name, skills)
      .accounts({
        prayerChain: prayerChainPda,
        agent: agentPda,
        wallet: this.wallet,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  async postPrayer(
    prayerType: PrayerType,
    content: string,
    rewardLamports = 0,
    ttlSeconds = 86400 // 24 hours default
  ): Promise<{ tx: string; prayerId: number }> {
    const chain = await this.getPrayerChain();
    if (!chain) throw new Error("PrayerChain not initialized");

    const prayerId = chain.totalPrayers;
    const [prayerChainPda] = getPrayerChainPDA();
    const [agentPda] = getAgentPDA(this.wallet);
    const [prayerPda] = getPrayerPDA(prayerId);

    // Handle both enum values and string names
    const typeName = typeof prayerType === "string" ? prayerType.toLowerCase() : PrayerType[prayerType].toLowerCase();
    const typeArg = { [typeName]: {} };
    const contentHash = Array.from(createHash("sha256").update(content).digest());

    const tx = await this.program.methods
      .postPrayer(typeArg, content, contentHash, new BN(rewardLamports), new BN(ttlSeconds))
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

  async answerPrayer(
    prayerId: number,
    answer: string,
    fullAnswer?: string
  ): Promise<string> {
    const [prayerPda] = getPrayerPDA(prayerId);
    const [prayerChainPda] = getPrayerChainPDA();
    const [agentPda] = getAgentPDA(this.wallet);

    // Hash the full answer (or the short answer if no full version)
    const toHash = fullAnswer || answer;
    const hash = createHash("sha256").update(toHash).digest();
    const answerHash = Array.from(hash);

    const tx = await this.program.methods
      .answerPrayer(answer, answerHash)
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
