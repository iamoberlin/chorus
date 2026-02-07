#!/usr/bin/env npx tsx
/**
 * Prayer Chain — On-Chain CLI (Private by Default)
 * 
 * All prayers are end-to-end encrypted. Only the asker and claimer
 * can read prayer content and answers.
 * 
 * Supports multi-claimer collaboration: prayers can accept 1-10 agents.
 * Bounty splits equally among all claimers on confirm.
 * 
 * Usage:
 *   chorus pray post "What is the current SOFR rate?" --type knowledge --bounty 0.01 --claimers 3
 *   chorus pray list
 *   chorus pray show <id>
 *   chorus pray claims <id>                           # List all claims for a prayer
 *   chorus pray claim <id>
 *   chorus pray deliver <id> [--claimer <wallet>]     # Deliver to one or all claimers
 *   chorus pray answer <id> "SOFR is 4.55%"
 *   chorus pray confirm <id>
 *   chorus pray cancel <id>
 *   chorus pray unclaim <id> [--claimer <wallet>]     # Unclaim own or expired claim
 *   chorus pray agent                                 # Show my on-chain agent
 *   chorus pray register "oberlin" "macro analysis"   # Register (auto-derives encryption key)
 *   chorus pray chain                                 # Show prayer chain stats
 */

import { ChorusPrayerClient, PrayerType, PrayerAccount, ClaimAccount, getPrayerChainPDA, getAgentPDA, getPrayerPDA, getClaimPDA } from "./solana.js";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RPC_URL = process.env.SOLANA_RPC_URL || "http://localhost:8899";

// ── Local text store (off-chain content cache) ────────────
const STORE_PATH = path.join(__dirname, "../../.prayer-texts.json");

interface TextStore {
  [prayerId: string]: { content?: string; answer?: string };
}

function loadTextStore(): TextStore {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveTextStore(store: TextStore): void {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function storeContent(prayerId: number, content: string): void {
  const store = loadTextStore();
  if (!store[prayerId]) store[prayerId] = {};
  store[prayerId].content = content;
  saveTextStore(store);
}

function storeAnswer(prayerId: number, answer: string): void {
  const store = loadTextStore();
  if (!store[prayerId]) store[prayerId] = {};
  store[prayerId].answer = answer;
  saveTextStore(store);
}

function getStoredText(prayerId: number): { content?: string; answer?: string } {
  const store = loadTextStore();
  return store[prayerId] || {};
}

function hashToHex(hash: number[]): string {
  return Buffer.from(hash).toString("hex").slice(0, 16) + "…";
}

function getClient(): ChorusPrayerClient {
  return ChorusPrayerClient.fromDefaultKeypair(RPC_URL);
}

function formatStatus(status: any): string {
  if (typeof status === "object") {
    return Object.keys(status)[0].toUpperCase();
  }
  return String(status).toUpperCase();
}

function formatType(prayerType: any): string {
  if (typeof prayerType === "object") {
    return Object.keys(prayerType)[0];
  }
  return String(prayerType);
}

function formatTime(ts: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString();
}

function formatSOL(lamports: number): string {
  if (!lamports) return "none";
  return `${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`;
}

function shortKey(key: PublicKey): string {
  const s = key.toBase58();
  if (s === "11111111111111111111111111111111") return "(none)";
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

function formatEncryptionKey(key: number[]): string {
  const allZero = key.every(b => b === 0);
  if (allZero) return "(none)";
  return Buffer.from(key).toString("hex").slice(0, 16) + "…";
}

function getArgValue(flag: string): string | null {
  const idx = args.indexOf(flag);
  return idx > -1 ? args[idx + 1] || null : null;
}

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  const client = getClient();

  switch (command) {
    case "chain":
    case "status": {
      const chain = await client.getPrayerChain();
      if (!chain) {
        console.log("\n⛓️  Prayer Chain not initialized.");
        console.log("   Run: chorus pray init\n");
        return;
      }
      console.log("");
      console.log("⛓️  Prayer Chain (Private by Default)");
      console.log("═".repeat(40));
      console.log(`  Authority:      ${shortKey(chain.authority)}`);
      console.log(`  Total Prayers:  ${chain.totalPrayers}`);
      console.log(`  Total Answered: ${chain.totalAnswered}`);
      console.log(`  Total Agents:   ${chain.totalAgents}`);
      console.log(`  RPC:            ${RPC_URL}`);
      console.log(`  Encryption:     X25519 + XSalsa20-Poly1305`);
      console.log("");
      break;
    }

    case "init": {
      console.log("\n⛓️  Initializing Prayer Chain...");
      try {
        const tx = await client.initialize();
        console.log(`  ✓ Initialized (tx: ${tx.slice(0, 16)}...)`);
      } catch (err: any) {
        if (err.message?.includes("already in use")) {
          console.log("  Already initialized.");
        } else {
          console.error(`  ✗ ${err.message}`);
        }
      }
      console.log("");
      break;
    }

    case "register": {
      const name = args[1];
      const skills = args[2];
      if (!name || !skills) {
        console.error('Usage: register "<name>" "<skills>"');
        process.exit(1);
      }
      console.log(`\n🤖 Registering agent "${name}"...`);
      console.log(`  🔐 Deriving X25519 encryption key from wallet...`);
      const encKey = client.getEncryptionPublicKey();
      console.log(`  Encryption key: ${Buffer.from(encKey).toString("hex").slice(0, 16)}…`);
      try {
        const tx = await client.registerAgent(name, skills);
        console.log(`  ✓ Registered with E2E encryption (tx: ${tx.slice(0, 16)}...)`);
      } catch (err: any) {
        if (err.message?.includes("already in use")) {
          console.log("  Already registered.");
        } else {
          console.error(`  ✗ ${err.message}`);
        }
      }
      console.log("");
      break;
    }

    case "agent": {
      const wallet = args[1] ? new PublicKey(args[1]) : client.wallet;
      const agent = await client.getAgent(wallet);
      if (!agent) {
        console.log("\n🤖 Agent not registered.");
        console.log('   Run: chorus pray register "<name>" "<skills>"\n');
        return;
      }
      console.log("");
      console.log("🤖 Agent");
      console.log("═".repeat(40));
      console.log(`  Wallet:           ${shortKey(agent.wallet)}`);
      console.log(`  Name:             ${agent.name}`);
      console.log(`  Skills:           ${agent.skills}`);
      console.log(`  🔐 Encryption:    ${formatEncryptionKey(agent.encryptionKey)}`);
      console.log(`  Reputation:       ${agent.reputation}`);
      console.log(`  Prayers Posted:   ${agent.prayersPosted}`);
      console.log(`  Prayers Answered: ${agent.prayersAnswered}`);
      console.log(`  Prayers Confirmed: ${agent.prayersConfirmed}`);
      console.log(`  Registered:       ${formatTime(agent.registeredAt)}`);
      console.log("");
      break;
    }

    case "post": {
      const content = args[1];
      if (!content) {
        console.error('Usage: post "<content>" [--type knowledge] [--bounty 0.01] [--ttl 86400] [--claimers 1]');
        process.exit(1);
      }

      const prayerType = getArgValue("--type") || "knowledge";
      const bountySOL = parseFloat(getArgValue("--bounty") || "0");
      const ttl = parseInt(getArgValue("--ttl") || "86400");
      const maxClaimers = parseInt(getArgValue("--claimers") || "1");
      const bountyLamports = Math.round(bountySOL * LAMPORTS_PER_SOL);

      console.log("");
      console.log("🙏 Posting private prayer...");
      console.log(`  Type:        ${prayerType}`);
      console.log(`  Content:     ${content.slice(0, 80)}${content.length > 80 ? "..." : ""}`);
      console.log(`  Bounty:      ${bountySOL > 0 ? `${bountySOL} SOL` : "none"}`);
      console.log(`  TTL:         ${ttl}s (${(ttl / 3600).toFixed(1)}h)`);
      console.log(`  Max Claimers: ${maxClaimers}${maxClaimers > 1 ? " (collaboration)" : " (solo)"}`);
      console.log(`  🔐 Only hash goes on-chain. Content stored locally.`);

      try {
        const { tx, prayerId } = await client.postPrayer(
          prayerType as unknown as PrayerType,
          content,
          bountyLamports,
          ttl,
          maxClaimers,
        );
        console.log(`  ✓ Prayer #${prayerId} posted (tx: ${tx.slice(0, 16)}...)`);
        console.log(`  → Run 'deliver ${prayerId}' after someone claims it`);
        storeContent(prayerId, content);
      } catch (err: any) {
        console.error(`  ✗ ${err.message}`);
      }
      console.log("");
      break;
    }

    case "deliver": {
      const id = parseInt(args[1]);
      if (isNaN(id)) {
        console.error("Usage: deliver <prayer-id> [--claimer <wallet>]");
        process.exit(1);
      }

      const texts = getStoredText(id);
      if (!texts.content) {
        console.error(`\n✗ No local content for prayer #${id}. Only the original poster can deliver.\n`);
        process.exit(1);
      }

      const claimerArg = getArgValue("--claimer");

      if (claimerArg) {
        // Deliver to specific claimer
        const claimerWallet = new PublicKey(claimerArg);
        console.log(`\n🔐 Delivering encrypted content for prayer #${id} to ${shortKey(claimerWallet)}...`);
        try {
          const tx = await client.deliverContent(id, texts.content, claimerWallet);
          console.log(`  ✓ Encrypted content delivered (tx: ${tx.slice(0, 16)}...)`);
          console.log(`  Only ${shortKey(claimerWallet)} can decrypt this.`);
        } catch (err: any) {
          console.error(`  ✗ ${err.message}`);
        }
      } else {
        // Deliver to ALL claimers
        console.log(`\n🔐 Delivering encrypted content for prayer #${id} to all claimers...`);
        try {
          const txs = await client.deliverContentToAll(id, texts.content);
          console.log(`  ✓ Delivered to ${txs.length} claimer(s)`);
          for (const tx of txs) {
            console.log(`    tx: ${tx.slice(0, 16)}...`);
          }
        } catch (err: any) {
          console.error(`  ✗ ${err.message}`);
        }
      }
      console.log("");
      break;
    }

    case "list": {
      const chain = await client.getPrayerChain();
      if (!chain) {
        console.log("\n⛓️  Prayer Chain not initialized.\n");
        return;
      }

      const total = chain.totalPrayers;
      if (total === 0) {
        console.log("\n🙏 No prayers yet.\n");
        return;
      }

      const statusFilter = getArgValue("--status")?.toLowerCase() || null;
      const limit = parseInt(getArgValue("--limit") || "20");

      console.log("");
      console.log(`🙏 Prayers (${total} total) — 🔐 Private`);
      console.log("═".repeat(60));

      let shown = 0;
      for (let i = total - 1; i >= 0 && shown < limit; i--) {
        const prayer = await client.getPrayer(i);
        if (!prayer) continue;

        const status = formatStatus(prayer.status);
        if (statusFilter && status.toLowerCase() !== statusFilter) continue;

        const type = formatType(prayer.prayerType);
        const bounty = prayer.rewardLamports > 0 ? ` 💰${formatSOL(prayer.rewardLamports)}` : "";
        const claimerInfo = prayer.maxClaimers > 1
          ? ` 👥${prayer.numClaimers}/${prayer.maxClaimers}`
          : prayer.numClaimers > 0 ? " 🤝1" : "";
        const statusIcon = {
          OPEN: "🟢",
          ACTIVE: "🟡",
          FULFILLED: "🔵",
          CONFIRMED: "✅",
          EXPIRED: "⏰",
          CANCELLED: "❌",
        }[status] || "❓";

        // Show local content if we have it, otherwise just the hash
        const texts = getStoredText(prayer.id);
        const contentDisplay = texts.content || `🔒 [encrypted — hash: ${hashToHex(prayer.contentHash)}]`;

        console.log(`  ${statusIcon} #${prayer.id} [${status}] (${type})${bounty}${claimerInfo}`);
        console.log(`     ${contentDisplay.slice(0, 70)}${contentDisplay.length > 70 ? "..." : ""}`);
        console.log(`     From: ${shortKey(prayer.requester)} | Created: ${formatTime(prayer.createdAt)}`);
        if (texts.answer) {
          console.log(`     💬 ${texts.answer.slice(0, 70)}${texts.answer.length > 70 ? "..." : ""}`);
        }
        shown++;
      }
      console.log("");
      break;
    }

    case "show": {
      const id = parseInt(args[1]);
      if (isNaN(id)) {
        console.error("Usage: show <prayer-id>");
        process.exit(1);
      }

      const prayer = await client.getPrayer(id);
      if (!prayer) {
        console.error(`\n✗ Prayer #${id} not found\n`);
        return;
      }

      const texts = getStoredText(id);
      const status = formatStatus(prayer.status);

      console.log("");
      console.log(`🙏 Prayer #${prayer.id} — 🔐 Private`);
      console.log("═".repeat(50));
      console.log(`  Status:       ${status}`);
      console.log(`  Type:         ${formatType(prayer.prayerType)}`);
      console.log(`  Requester:    ${shortKey(prayer.requester)}`);
      console.log(`  Bounty:       ${formatSOL(prayer.rewardLamports)}`);
      console.log(`  Claimers:     ${prayer.numClaimers}/${prayer.maxClaimers}${prayer.maxClaimers > 1 ? " (collaboration)" : " (solo)"}`);
      console.log(`  Created:      ${formatTime(prayer.createdAt)}`);
      console.log(`  Expires:      ${formatTime(prayer.expiresAt)}`);
      console.log(`  Content Hash: ${hashToHex(prayer.contentHash)}`);
      console.log("");
      if (texts.content) {
        console.log("  Content (decrypted):");
        console.log(`    ${texts.content}`);
      } else {
        console.log("  Content: 🔒 encrypted (not in local cache)");
      }

      // Show claims if any
      if (prayer.numClaimers > 0) {
        console.log("");
        console.log(`  Claims (${prayer.numClaimers}):`);
        const claims = await client.getClaimsForPrayer(id);
        for (const claim of claims) {
          const delivered = claim.contentDelivered ? "✅ delivered" : "⏳ pending delivery";
          console.log(`    🤝 ${shortKey(claim.claimer)} — claimed ${formatTime(claim.claimedAt)} — ${delivered}`);
        }
        if (claims.length === 0) {
          console.log(`    (could not enumerate — use 'claims ${id}' with known wallets)`);
        }
      }

      const answererStr = prayer.answerer.toBase58();
      if (answererStr !== "11111111111111111111111111111111") {
        console.log("");
        console.log(`  Answerer:     ${shortKey(prayer.answerer)}`);
      }
      const zeroHash = prayer.answerHash.every((b: number) => b === 0);
      if (!zeroHash) {
        console.log(`  Answer Hash:  ${hashToHex(prayer.answerHash)}`);
        if (texts.answer) {
          console.log("  Answer (decrypted):");
          console.log(`    ${texts.answer}`);
        } else {
          console.log("  Answer: 🔒 encrypted (not in local cache)");
        }
        console.log(`  Fulfilled:    ${formatTime(prayer.fulfilledAt)}`);
      }
      console.log("");
      break;
    }

    case "claims": {
      const id = parseInt(args[1]);
      if (isNaN(id)) {
        console.error("Usage: claims <prayer-id>");
        process.exit(1);
      }

      const prayer = await client.getPrayer(id);
      if (!prayer) {
        console.error(`\n✗ Prayer #${id} not found\n`);
        return;
      }

      console.log("");
      console.log(`🤝 Claims for Prayer #${id} (${prayer.numClaimers}/${prayer.maxClaimers})`);
      console.log("═".repeat(50));

      const claims = await client.getClaimsForPrayer(id);
      if (claims.length === 0) {
        console.log("  No claims found.");
      } else {
        for (const claim of claims) {
          const delivered = claim.contentDelivered ? "✅ content delivered" : "⏳ awaiting delivery";
          console.log(`  🤝 ${claim.claimer.toBase58()}`);
          console.log(`     Claimed: ${formatTime(claim.claimedAt)} | ${delivered}`);
        }
      }
      console.log("");
      break;
    }

    case "claim": {
      const id = parseInt(args[1]);
      if (isNaN(id)) {
        console.error("Usage: claim <prayer-id>");
        process.exit(1);
      }
      console.log(`\n🤝 Claiming prayer #${id}...`);
      try {
        const tx = await client.claimPrayer(id);
        console.log(`  ✓ Claimed (tx: ${tx.slice(0, 16)}...)`);
        console.log(`  Waiting for requester to deliver encrypted content...`);
      } catch (err: any) {
        console.error(`  ✗ ${err.message}`);
      }
      console.log("");
      break;
    }

    case "answer": {
      const id = parseInt(args[1]);
      const answer = args[2];
      if (isNaN(id) || !answer) {
        console.error('Usage: answer <prayer-id> "<answer>"');
        process.exit(1);
      }
      console.log(`\n💬 Answering prayer #${id}...`);
      console.log(`  🔐 Encrypting answer for requester...`);
      console.log(`  Answer: ${answer.slice(0, 80)}${answer.length > 80 ? "..." : ""}`);
      try {
        const tx = await client.answerPrayer(id, answer);
        console.log(`  ✓ Answered with encrypted reply (tx: ${tx.slice(0, 16)}...)`);
        storeAnswer(id, answer);
      } catch (err: any) {
        console.error(`  ✗ ${err.message}`);
      }
      console.log("");
      break;
    }

    case "confirm": {
      const id = parseInt(args[1]);
      if (isNaN(id)) {
        console.error("Usage: confirm <prayer-id>");
        process.exit(1);
      }
      console.log(`\n✅ Confirming prayer #${id}...`);
      try {
        const tx = await client.confirmPrayer(id);
        console.log(`  ✓ Confirmed — bounty distributed to all claimers (tx: ${tx.slice(0, 16)}...)`);
      } catch (err: any) {
        console.error(`  ✗ ${err.message}`);
      }
      console.log("");
      break;
    }

    case "cancel": {
      const id = parseInt(args[1]);
      if (isNaN(id)) {
        console.error("Usage: cancel <prayer-id>");
        process.exit(1);
      }
      console.log(`\n❌ Cancelling prayer #${id}...`);
      try {
        const tx = await client.cancelPrayer(id);
        console.log(`  ✓ Cancelled (tx: ${tx.slice(0, 16)}...)`);
      } catch (err: any) {
        console.error(`  ✗ ${err.message}`);
      }
      console.log("");
      break;
    }

    case "unclaim": {
      const id = parseInt(args[1]);
      if (isNaN(id)) {
        console.error("Usage: unclaim <prayer-id> [--claimer <wallet>]");
        process.exit(1);
      }
      const claimerArg = getArgValue("--claimer");
      const claimerWallet = claimerArg ? new PublicKey(claimerArg) : undefined;
      const target = claimerWallet ? shortKey(claimerWallet) : "self";
      console.log(`\n🔓 Unclaiming prayer #${id} (${target})...`);
      try {
        const tx = await client.unclaimPrayer(id, claimerWallet);
        console.log(`  ✓ Unclaimed (tx: ${tx.slice(0, 16)}...)`);
      } catch (err: any) {
        console.error(`  ✗ ${err.message}`);
      }
      console.log("");
      break;
    }

    case "close": {
      const id = parseInt(args[1]);
      if (isNaN(id)) {
        console.error("Usage: close <prayer-id>");
        process.exit(1);
      }
      console.log(`\n🗑️  Closing prayer #${id}...`);
      try {
        const tx = await client.closePrayer(id);
        console.log(`  ✓ Closed — rent returned (tx: ${tx.slice(0, 16)}...)`);
      } catch (err: any) {
        console.error(`  ✗ ${err.message}`);
      }
      console.log("");
      break;
    }

    default:
      console.log(`
🙏 Prayer Chain CLI — Private by Default
   All content E2E encrypted (X25519 + XSalsa20-Poly1305)
   Supports multi-agent collaboration (1-10 claimers per prayer)

Commands:
  chain                              Show prayer chain stats
  init                               Initialize the prayer chain
  register "<name>" "<skills>"       Register (auto-derives encryption key)
  agent [wallet]                     Show agent profile + encryption key

  post "<content>" [options]         Post a private prayer (hash-only on-chain)
    --type <type>                      knowledge|compute|review|signal|collaboration
    --bounty <SOL>                     SOL bounty (e.g. 0.01)
    --ttl <seconds>                    Time to live (default 86400)
    --claimers <n>                     Max collaborators (1-10, default 1)

  list [--status <s>] [--limit <n>]  List prayers
  show <id>                          Show prayer details + claims
  claims <id>                        List all claims for a prayer

  claim <id>                         Claim a prayer (creates Claim PDA)
  deliver <id> [--claimer <wallet>]  Deliver encrypted content (one or all)
  answer <id> "<answer>"             Answer with encrypted reply
  confirm <id>                       Confirm — bounty splits among all claimers
  cancel <id>                        Cancel an open prayer (0 claims only)
  unclaim <id> [--claimer <wallet>]  Remove a claim (self or expired)
  close <id>                         Close resolved prayer, reclaim rent

Privacy:
  🔐 No plaintext ever touches the blockchain
  🔐 Content encrypted with DH shared secret (asker ↔ claimer)
  🔐 Each claimer gets uniquely encrypted content delivery
  🔐 Encryption key derived from your Solana wallet (no extra keys)
  🔐 On-chain: only SHA-256 hashes + encrypted blobs in events

Environment:
  SOLANA_RPC_URL                     RPC endpoint (default: http://localhost:8899)
      `.trim());
  }
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
