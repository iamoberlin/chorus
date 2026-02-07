import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";
import { createRequire } from "module";
import { createHash } from "crypto";
import nacl from "tweetnacl";

const require = createRequire(import.meta.url);
const IDL = require("../target/idl/chorus_prayers.json");

// Test-local crypto helpers
function ed25519SecretKeyToX25519(ed25519SecretKey: Uint8Array): Uint8Array {
  const seed = ed25519SecretKey.slice(0, 32);
  const hash = nacl.hash(seed);
  const x = new Uint8Array(32);
  x.set(hash.slice(0, 32));
  x[0] &= 248;
  x[31] &= 127;
  x[31] |= 64;
  return x;
}

function deriveEncryptionKeypair(kp: Keypair) {
  const x25519SecretKey = ed25519SecretKeyToX25519(kp.secretKey);
  const x25519PublicKey = nacl.box.keyPair.fromSecretKey(x25519SecretKey).publicKey;
  return { publicKey: x25519PublicKey, secretKey: x25519SecretKey };
}

function encryptFor(plaintext: string, recipientPub: Uint8Array, senderSec: Uint8Array): Uint8Array {
  const msg = new TextEncoder().encode(plaintext);
  const nonce = nacl.randomBytes(24);
  const enc = nacl.box(msg, nonce, recipientPub, senderSec)!;
  const result = new Uint8Array(nonce.length + enc.length);
  result.set(nonce);
  result.set(enc, nonce.length);
  return result;
}

function decryptFrom(blob: Uint8Array, senderPub: Uint8Array, recipientSec: Uint8Array): string | null {
  const nonce = blob.slice(0, 24);
  const ct = blob.slice(24);
  const dec = nacl.box.open(ct, nonce, senderPub, recipientSec);
  return dec ? new TextDecoder().decode(dec) : null;
}

describe("chorus-prayers (multi-claim collaborative)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new Program(IDL, provider);
  const authority = provider.wallet;

  const agent2 = Keypair.generate();
  const agent3 = Keypair.generate();

  let authorityKeypair: Keypair;
  let enc1: { publicKey: Uint8Array; secretKey: Uint8Array };
  let enc2: { publicKey: Uint8Array; secretKey: Uint8Array };
  let enc3: { publicKey: Uint8Array; secretKey: Uint8Array };

  function getPrayerChainPDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from("prayer-chain")], program.programId);
  }
  function getAgentPDA(wallet: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from("agent"), wallet.toBuffer()], program.programId);
  }
  function getPrayerPDA(id: number): [PublicKey, number] {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(BigInt(id));
    return PublicKey.findProgramAddressSync([Buffer.from("prayer"), buf], program.programId);
  }
  function getClaimPDA(prayerId: number, claimer: PublicKey): [PublicKey, number] {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(BigInt(prayerId));
    return PublicKey.findProgramAddressSync(
      [Buffer.from("claim"), buf, claimer.toBuffer()],
      program.programId
    );
  }
  function sha256(text: string): number[] {
    return Array.from(createHash("sha256").update(text).digest());
  }

  before(async () => {
    const sig2 = await provider.connection.requestAirdrop(agent2.publicKey, 2 * LAMPORTS_PER_SOL);
    const sig3 = await provider.connection.requestAirdrop(agent3.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig2);
    await provider.connection.confirmTransaction(sig3);

    authorityKeypair = (provider.wallet as any).payer as Keypair;
    enc1 = deriveEncryptionKeypair(authorityKeypair);
    enc2 = deriveEncryptionKeypair(agent2);
    enc3 = deriveEncryptionKeypair(agent3);
  });

  it("Initializes the PrayerChain", async () => {
    const [pda] = getPrayerChainPDA();
    await program.methods.initialize().accounts({
      prayerChain: pda, authority: authority.publicKey, systemProgram: SystemProgram.programId,
    }).rpc();
    const chain = await (program.account as any).prayerChain.fetch(pda);
    assert.equal(chain.totalPrayers.toNumber(), 0);
  });

  it("Registers 3 agents with encryption keys", async () => {
    const [chainPda] = getPrayerChainPDA();

    // Agent 1
    const [a1] = getAgentPDA(authority.publicKey);
    await program.methods.registerAgent("oberlin", "macro analysis", Array.from(enc1.publicKey))
      .accounts({ prayerChain: chainPda, agent: a1, wallet: authority.publicKey, systemProgram: SystemProgram.programId }).rpc();

    // Agent 2
    const [a2] = getAgentPDA(agent2.publicKey);
    await program.methods.registerAgent("helper-bot", "data feeds", Array.from(enc2.publicKey))
      .accounts({ prayerChain: chainPda, agent: a2, wallet: agent2.publicKey, systemProgram: SystemProgram.programId })
      .signers([agent2]).rpc();

    // Agent 3
    const [a3] = getAgentPDA(agent3.publicKey);
    await program.methods.registerAgent("analyst", "research", Array.from(enc3.publicKey))
      .accounts({ prayerChain: chainPda, agent: a3, wallet: agent3.publicKey, systemProgram: SystemProgram.programId })
      .signers([agent3]).rpc();

    const chain = await (program.account as any).prayerChain.fetch(chainPda);
    assert.equal(chain.totalAgents.toNumber(), 3);
  });

  it("Posts a collaborative prayer (max_claimers=3)", async () => {
    const [chainPda] = getPrayerChainPDA();
    const [agentPda] = getAgentPDA(authority.publicKey);
    const [prayerPda] = getPrayerPDA(0);

    const content = "Research SOFR rate dynamics and repo window dressing";
    const contentHash = sha256(content);
    const bounty = 0.03 * LAMPORTS_PER_SOL;

    await program.methods.postPrayer(
      { knowledge: {} }, contentHash, new anchor.BN(bounty), new anchor.BN(86400), 3
    ).accounts({
      prayerChain: chainPda, requesterAgent: agentPda, prayer: prayerPda,
      requester: authority.publicKey, systemProgram: SystemProgram.programId,
    }).rpc();

    const prayer = await (program.account as any).prayer.fetch(prayerPda);
    assert.equal(prayer.maxClaimers, 3);
    assert.equal(prayer.numClaimers, 0);
    assert.deepEqual(prayer.status, { open: {} });
  });

  it("Agent 2 claims — prayer stays Open (1/3)", async () => {
    const [prayerPda] = getPrayerPDA(0);
    const [claimPda] = getClaimPDA(0, agent2.publicKey);
    const [agentPda] = getAgentPDA(agent2.publicKey);

    await program.methods.claimPrayer().accounts({
      prayer: prayerPda, claim: claimPda, claimerAgent: agentPda,
      claimer: agent2.publicKey, systemProgram: SystemProgram.programId,
    }).signers([agent2]).rpc();

    const prayer = await (program.account as any).prayer.fetch(prayerPda);
    assert.equal(prayer.numClaimers, 1);
    assert.deepEqual(prayer.status, { open: {} }); // Still open

    const claim = await (program.account as any).claim.fetch(claimPda);
    assert.ok(claim.claimer.equals(agent2.publicKey));
    assert.equal(claim.contentDelivered, false);
  });

  it("Agent 3 claims — prayer stays Open (2/3)", async () => {
    const [prayerPda] = getPrayerPDA(0);
    const [claimPda] = getClaimPDA(0, agent3.publicKey);
    const [agentPda] = getAgentPDA(agent3.publicKey);

    await program.methods.claimPrayer().accounts({
      prayer: prayerPda, claim: claimPda, claimerAgent: agentPda,
      claimer: agent3.publicKey, systemProgram: SystemProgram.programId,
    }).signers([agent3]).rpc();

    const prayer = await (program.account as any).prayer.fetch(prayerPda);
    assert.equal(prayer.numClaimers, 2);
    assert.deepEqual(prayer.status, { open: {} }); // Still open — 2/3
  });

  it("Requester delivers encrypted content to each claimer separately", async () => {
    const [prayerPda] = getPrayerPDA(0);
    const content = "Research SOFR rate dynamics and repo window dressing";

    // Deliver to agent 2
    const [claim2] = getClaimPDA(0, agent2.publicKey);
    const enc2Content = encryptFor(content, enc2.publicKey, enc1.secretKey);
    await program.methods.deliverContent(Buffer.from(enc2Content)).accounts({
      prayer: prayerPda, claim: claim2, requester: authority.publicKey,
    }).rpc();

    // Deliver to agent 3
    const [claim3] = getClaimPDA(0, agent3.publicKey);
    const enc3Content = encryptFor(content, enc3.publicKey, enc1.secretKey);
    await program.methods.deliverContent(Buffer.from(enc3Content)).accounts({
      prayer: prayerPda, claim: claim3, requester: authority.publicKey,
    }).rpc();

    // Verify delivery flags
    const c2 = await (program.account as any).claim.fetch(claim2);
    assert.equal(c2.contentDelivered, true);
    const c3 = await (program.account as any).claim.fetch(claim3);
    assert.equal(c3.contentDelivered, true);

    // Verify decryption
    const dec2 = decryptFrom(enc2Content, enc1.publicKey, enc2.secretKey);
    assert.equal(dec2, content);
    const dec3 = decryptFrom(enc3Content, enc1.publicKey, enc3.secretKey);
    assert.equal(dec3, content);
  });

  it("Cannot deliver to same claimer twice", async () => {
    const [prayerPda] = getPrayerPDA(0);
    const [claim2] = getClaimPDA(0, agent2.publicKey);
    const blob = encryptFor("dupe", enc2.publicKey, enc1.secretKey);

    try {
      await program.methods.deliverContent(Buffer.from(blob)).accounts({
        prayer: prayerPda, claim: claim2, requester: authority.publicKey,
      }).rpc();
      assert.fail("Should have thrown");
    } catch (err: any) {
      assert.include(err.message, "AlreadyDelivered");
    }
  });

  it("Agent 2 (a claimer) submits the collaborative answer", async () => {
    const [prayerPda] = getPrayerPDA(0);
    const [chainPda] = getPrayerChainPDA();
    const [claimPda] = getClaimPDA(0, agent2.publicKey);
    const [agentPda] = getAgentPDA(agent2.publicKey);

    const answer = "SOFR at 4.55%. Repo window dressing causes 7-25bps spike at quarter-end.";
    const answerHash = sha256(answer);
    const encAnswer = encryptFor(answer, enc1.publicKey, enc2.secretKey);

    await program.methods.answerPrayer(answerHash, Buffer.from(encAnswer)).accounts({
      prayerChain: chainPda, prayer: prayerPda, claim: claimPda,
      answererAgent: agentPda, answerer: agent2.publicKey,
    }).signers([agent2]).rpc();

    const prayer = await (program.account as any).prayer.fetch(prayerPda);
    assert.deepEqual(prayer.status, { fulfilled: {} });
    assert.ok(prayer.answerer.equals(agent2.publicKey));

    // Requester can decrypt
    const dec = decryptFrom(encAnswer, enc2.publicKey, enc1.secretKey);
    assert.equal(dec, answer);
  });

  it("Requester confirms — bounty splits equally among claimers", async () => {
    const [prayerPda] = getPrayerPDA(0);
    const [answererAgentPda] = getAgentPDA(agent2.publicKey);

    const bal2Before = await provider.connection.getBalance(agent2.publicKey);
    const bal3Before = await provider.connection.getBalance(agent3.publicKey);

    const bounty = 0.03 * LAMPORTS_PER_SOL;
    const perClaimer = Math.floor(bounty / 2); // 2 claimers

    await program.methods.confirmPrayer().accounts({
      prayer: prayerPda, answererAgent: answererAgentPda, requester: authority.publicKey,
    }).remainingAccounts([
      { pubkey: agent2.publicKey, isSigner: false, isWritable: true },
      { pubkey: agent3.publicKey, isSigner: false, isWritable: true },
    ]).rpc();

    const prayer = await (program.account as any).prayer.fetch(prayerPda);
    assert.deepEqual(prayer.status, { confirmed: {} });

    const bal2After = await provider.connection.getBalance(agent2.publicKey);
    const bal3After = await provider.connection.getBalance(agent3.publicKey);
    assert.equal(bal2After - bal2Before, perClaimer);
    assert.equal(bal3After - bal3Before, perClaimer);
  });

  // ── Solo prayer tests (backward compat: max_claimers=1) ──

  it("Posts a solo prayer (max_claimers=1)", async () => {
    const [chainPda] = getPrayerChainPDA();
    const [agentPda] = getAgentPDA(authority.publicKey);
    const [prayerPda] = getPrayerPDA(1);

    await program.methods.postPrayer(
      { review: {} }, sha256("solo test"), new anchor.BN(0), new anchor.BN(86400), 1
    ).accounts({
      prayerChain: chainPda, requesterAgent: agentPda, prayer: prayerPda,
      requester: authority.publicKey, systemProgram: SystemProgram.programId,
    }).rpc();

    const prayer = await (program.account as any).prayer.fetch(prayerPda);
    assert.equal(prayer.maxClaimers, 1);
  });

  it("Solo: single claim moves to Active", async () => {
    const [prayerPda] = getPrayerPDA(1);
    const [claimPda] = getClaimPDA(1, agent2.publicKey);
    const [agentPda] = getAgentPDA(agent2.publicKey);

    await program.methods.claimPrayer().accounts({
      prayer: prayerPda, claim: claimPda, claimerAgent: agentPda,
      claimer: agent2.publicKey, systemProgram: SystemProgram.programId,
    }).signers([agent2]).rpc();

    const prayer = await (program.account as any).prayer.fetch(prayerPda);
    assert.equal(prayer.numClaimers, 1);
    assert.deepEqual(prayer.status, { active: {} }); // 1/1 = Active
  });

  it("Cannot claim own prayer", async () => {
    const [chainPda] = getPrayerChainPDA();
    const [agentPda] = getAgentPDA(authority.publicKey);
    const [prayerPda] = getPrayerPDA(2);

    await program.methods.postPrayer(
      { compute: {} }, sha256("own prayer"), new anchor.BN(0), new anchor.BN(86400), 1
    ).accounts({
      prayerChain: chainPda, requesterAgent: agentPda, prayer: prayerPda,
      requester: authority.publicKey, systemProgram: SystemProgram.programId,
    }).rpc();

    const [claimPda] = getClaimPDA(2, authority.publicKey);
    try {
      await program.methods.claimPrayer().accounts({
        prayer: prayerPda, claim: claimPda, claimerAgent: agentPda,
        claimer: authority.publicKey, systemProgram: SystemProgram.programId,
      }).rpc();
      assert.fail("Should throw");
    } catch (err: any) {
      assert.include(err.message, "CannotClaimOwn");
    }
  });

  it("Cancel only works with 0 claims", async () => {
    const [prayerPda] = getPrayerPDA(2); // prayer 2 has 0 claims

    await program.methods.cancelPrayer().accounts({
      prayer: prayerPda, requester: authority.publicKey,
    }).rpc();

    const prayer = await (program.account as any).prayer.fetch(prayerPda);
    assert.deepEqual(prayer.status, { cancelled: {} });
  });

  it("Unclaim closes the Claim PDA and reopens the prayer", async () => {
    const [prayerPda] = getPrayerPDA(1); // prayer 1 has 1 claim (agent2), status Active
    const [claimPda] = getClaimPDA(1, agent2.publicKey);

    await program.methods.unclaimPrayer().accounts({
      prayer: prayerPda, claim: claimPda, claimerWallet: agent2.publicKey,
      caller: agent2.publicKey,
    }).signers([agent2]).rpc();

    const prayer = await (program.account as any).prayer.fetch(prayerPda);
    assert.equal(prayer.numClaimers, 0);
    assert.deepEqual(prayer.status, { open: {} }); // Reopened

    // Claim PDA should be closed
    try {
      await (program.account as any).claim.fetch(claimPda);
      assert.fail("Claim should be closed");
    } catch (err: any) {
      assert.include(err.message.toLowerCase(), "not exist");
    }
  });

  it("Can close a cancelled prayer", async () => {
    const [prayerPda] = getPrayerPDA(2);
    const balBefore = await provider.connection.getBalance(authority.publicKey);

    await program.methods.closePrayer().accounts({
      prayer: prayerPda, requester: authority.publicKey,
    }).rpc();

    const balAfter = await provider.connection.getBalance(authority.publicKey);
    assert.isAbove(balAfter, balBefore);
  });

  it("Third party cannot decrypt", async () => {
    const content = "secret content";
    const blob = encryptFor(content, enc2.publicKey, enc1.secretKey);
    const eavesdropper = Keypair.generate();
    const eavesEnc = deriveEncryptionKeypair(eavesdropper);
    const dec = decryptFrom(blob, enc1.publicKey, eavesEnc.secretKey);
    assert.isNull(dec);
  });
});
