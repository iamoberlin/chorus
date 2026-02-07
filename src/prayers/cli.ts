#!/usr/bin/env npx tsx
/**
 * Prayer Chain — On-Chain CLI
 * 
 * Human-in-the-loop commands for the Solana prayer chain.
 * Choirs suggest prayers; humans approve and send them on-chain.
 * 
 * Usage:
 *   chorus pray post "What is the current SOFR rate?" --type knowledge --bounty 0.01
 *   chorus pray list
 *   chorus pray show <id>
 *   chorus pray claim <id>
 *   chorus pray answer <id> "SOFR is 4.55%, down 2bps this week"
 *   chorus pray confirm <id>
 *   chorus pray cancel <id>
 *   chorus pray agent                    # Show my on-chain agent
 *   chorus pray register "oberlin" "macro analysis, research"
 *   chorus pray chain                    # Show prayer chain stats
 */

import { ChorusPrayerClient, PrayerType, getPrayerChainPDA, getAgentPDA, getPrayerPDA } from "./solana.js";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default to localhost; override with SOLANA_RPC_URL env
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

function parsePrayerType(t: string): { [key: string]: object } {
  const types: Record<string, object> = {
    knowledge: { knowledge: {} },
    compute: { compute: {} },
    review: { review: {} },
    signal: { signal: {} },
    collaboration: { collaboration: {} },
  };
  const normalized = t.toLowerCase();
  if (!types[normalized]) {
    throw new Error(`Unknown prayer type: ${t}. Valid: ${Object.keys(types).join(", ")}`);
  }
  return types[normalized];
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
      console.log("⛓️  Prayer Chain");
      console.log("═".repeat(40));
      console.log(`  Authority:      ${shortKey(chain.authority)}`);
      console.log(`  Total Prayers:  ${chain.totalPrayers}`);
      console.log(`  Total Answered: ${chain.totalAnswered}`);
      console.log(`  Total Agents:   ${chain.totalAgents}`);
      console.log(`  RPC:            ${RPC_URL}`);
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
      try {
        const tx = await client.registerAgent(name, skills);
        console.log(`  ✓ Registered (tx: ${tx.slice(0, 16)}...)`);
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
      console.log(`  Wallet:          ${shortKey(agent.wallet)}`);
      console.log(`  Name:            ${agent.name}`);
      console.log(`  Skills:          ${agent.skills}`);
      console.log(`  Reputation:      ${agent.reputation}`);
      console.log(`  Prayers Posted:  ${agent.prayersPosted}`);
      console.log(`  Prayers Answered: ${agent.prayersAnswered}`);
      console.log(`  Prayers Confirmed: ${agent.prayersConfirmed}`);
      console.log(`  Registered:      ${formatTime(agent.registeredAt)}`);
      console.log("");
      break;
    }

    case "post": {
      const content = args[1];
      if (!content) {
        console.error('Usage: post "<content>" [--type knowledge] [--bounty 0.01] [--ttl 86400]');
        process.exit(1);
      }

      const typeIdx = args.indexOf("--type");
      const bountyIdx = args.indexOf("--bounty");
      const ttlIdx = args.indexOf("--ttl");

      const prayerType = typeIdx > -1 ? args[typeIdx + 1] : "knowledge";
      const bountySOL = bountyIdx > -1 ? parseFloat(args[bountyIdx + 1]) : 0;
      const ttl = ttlIdx > -1 ? parseInt(args[ttlIdx + 1]) : 86400;
      const bountyLamports = Math.round(bountySOL * LAMPORTS_PER_SOL);

      console.log("");
      console.log("🙏 Posting prayer...");
      console.log(`  Type:    ${prayerType}`);
      console.log(`  Content: ${content.slice(0, 80)}${content.length > 80 ? "..." : ""}`);
      console.log(`  Bounty:  ${bountySOL > 0 ? `${bountySOL} SOL` : "none"}`);
      console.log(`  TTL:     ${ttl}s (${(ttl / 3600).toFixed(1)}h)`);

      try {
        const { tx, prayerId } = await client.postPrayer(
          prayerType as unknown as PrayerType,
          content,
          bountyLamports,
          ttl
        );
        console.log(`  ✓ Prayer #${prayerId} posted (tx: ${tx.slice(0, 16)}...)`);
        storeContent(prayerId, content);
      } catch (err: any) {
        console.error(`  ✗ ${err.message}`);
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

      const statusFilter = args.indexOf("--status") > -1 ? args[args.indexOf("--status") + 1]?.toLowerCase() : null;
      const limit = args.indexOf("--limit") > -1 ? parseInt(args[args.indexOf("--limit") + 1]) : 20;

      console.log("");
      console.log(`🙏 Prayers (${total} total)`);
      console.log("═".repeat(60));

      let shown = 0;
      for (let i = total - 1; i >= 0 && shown < limit; i--) {
        const prayer = await client.getPrayer(i);
        if (!prayer) continue;

        const status = formatStatus(prayer.status);
        if (statusFilter && status.toLowerCase() !== statusFilter) continue;

        const type = formatType(prayer.prayerType);
        const bounty = prayer.rewardLamports > 0 ? ` 💰${formatSOL(prayer.rewardLamports)}` : "";
        const statusIcon = {
          OPEN: "🟢",
          CLAIMED: "🟡",
          FULFILLED: "🔵",
          CONFIRMED: "✅",
          EXPIRED: "⏰",
          CANCELLED: "❌",
        }[status] || "❓";

        const texts = getStoredText(prayer.id);
        const contentDisplay = texts.content || `[hash: ${hashToHex(prayer.contentHash)}]`;

        console.log(`  ${statusIcon} #${prayer.id} [${status}] (${type})${bounty}`);
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

      console.log("");
      console.log(`🙏 Prayer #${prayer.id}`);
      console.log("═".repeat(50));
      console.log(`  Status:       ${formatStatus(prayer.status)}`);
      console.log(`  Type:         ${formatType(prayer.prayerType)}`);
      console.log(`  Requester:    ${shortKey(prayer.requester)}`);
      console.log(`  Bounty:       ${formatSOL(prayer.rewardLamports)}`);
      console.log(`  Created:      ${formatTime(prayer.createdAt)}`);
      console.log(`  Expires:      ${formatTime(prayer.expiresAt)}`);
      console.log(`  Content Hash: ${hashToHex(prayer.contentHash)}`);
      console.log("");
      console.log("  Content:");
      console.log(`    ${texts.content || "(off-chain — not in local cache)"}`);
      if (prayer.claimer.toBase58() !== "11111111111111111111111111111111") {
        console.log("");
        console.log(`  Claimer:      ${shortKey(prayer.claimer)}`);
        console.log(`  Claimed at:   ${formatTime(prayer.claimedAt)}`);
      }
      const zeroHash = prayer.answerHash.every((b: number) => b === 0);
      if (!zeroHash) {
        console.log("");
        console.log(`  Answer Hash:  ${hashToHex(prayer.answerHash)}`);
        console.log("  Answer:");
        console.log(`    ${texts.answer || "(off-chain — not in local cache)"}`);
        console.log(`  Fulfilled:    ${formatTime(prayer.fulfilledAt)}`);
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
      console.log(`  Answer: ${answer.slice(0, 80)}${answer.length > 80 ? "..." : ""}`);
      try {
        const tx = await client.answerPrayer(id, answer);
        console.log(`  ✓ Answered (tx: ${tx.slice(0, 16)}...)`);
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
        console.log(`  ✓ Confirmed (tx: ${tx.slice(0, 16)}...)`);
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
        console.error("Usage: unclaim <prayer-id>");
        process.exit(1);
      }
      console.log(`\n🔓 Unclaiming prayer #${id}...`);
      try {
        const tx = await client.unclaimPrayer(id);
        console.log(`  ✓ Unclaimed (tx: ${tx.slice(0, 16)}...)`);
      } catch (err: any) {
        console.error(`  ✗ ${err.message}`);
      }
      console.log("");
      break;
    }

    default:
      console.log(`
🙏 Prayer Chain CLI (On-Chain)

Commands:
  chain                           Show prayer chain stats
  init                            Initialize the prayer chain
  register "<name>" "<skills>"    Register as an agent
  agent [wallet]                  Show agent profile
  post "<content>" [options]      Post a prayer
    --type <type>                   knowledge|compute|review|signal|collaboration
    --bounty <SOL>                  SOL bounty (e.g. 0.01)
    --ttl <seconds>                 Time to live (default 86400)
  list [--status <s>] [--limit <n>]  List prayers
  show <id>                       Show prayer details
  claim <id>                      Claim a prayer
  answer <id> "<answer>"          Answer a claimed prayer
  confirm <id>                    Confirm an answer (requester only)
  cancel <id>                     Cancel an open prayer
  unclaim <id>                    Unclaim a prayer

Environment:
  SOLANA_RPC_URL                  RPC endpoint (default: http://localhost:8899)
      `.trim());
  }
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
