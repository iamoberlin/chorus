import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";
import { createRequire } from "module";
import { createHash } from "crypto";
import nacl from "tweetnacl";

const require = createRequire(import.meta.url);
const IDL = require("../target/idl/chorus_prayers.json");

/**
 * Test-local crypto helpers (mirrors src/prayers/crypto.ts logic)
 * Used to verify E2E encryption without importing ESM source.
 */
function ed25519SecretKeyToX25519(ed25519SecretKey: Uint8Array): Uint8Array {
  const seed = ed25519SecretKey.slice(0, 32);
  const hash = nacl.hash(seed);
  const x25519Key = new Uint8Array(32);
  x25519Key.set(hash.slice(0, 32));
  x25519Key[0] &= 248;
  x25519Key[31] &= 127;
  x25519Key[31] |= 64;
  return x25519Key;
}

function deriveEncryptionKeypair(solanaKeypair: Keypair) {
  const x25519SecretKey = ed25519SecretKeyToX25519(solanaKeypair.secretKey);
  const x25519PublicKey = nacl.box.keyPair.fromSecretKey(x25519SecretKey).publicKey;
  return { publicKey: x25519PublicKey, secretKey: x25519SecretKey };
}

function encryptForRecipient(plaintext: string, recipientPubKey: Uint8Array, senderSecretKey: Uint8Array): Uint8Array {
  const message = new TextEncoder().encode(plaintext);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const encrypted = nacl.box(message, nonce, recipientPubKey, senderSecretKey);
  if (!encrypted) throw new Error("Encryption failed");
  const result = new Uint8Array(nonce.length + encrypted.length);
  result.set(nonce);
  result.set(encrypted, nonce.length);
  return result;
}

function decryptFromSender(blob: Uint8Array, senderPubKey: Uint8Array, recipientSecretKey: Uint8Array): string | null {
  const nonce = blob.slice(0, nacl.box.nonceLength);
  const ciphertext = blob.slice(nacl.box.nonceLength);
  const decrypted = nacl.box.open(ciphertext, nonce, senderPubKey, recipientSecretKey);
  if (!decrypted) return null;
  return new TextDecoder().decode(decrypted);
}

describe("chorus-prayers (private by default)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program(IDL, provider);
  const authority = provider.wallet;

  // Test agents
  const agent2 = Keypair.generate();

  // Derive encryption keypairs for both agents
  // authority keypair comes from Anchor provider — we need its raw Keypair
  let authorityKeypair: Keypair;
  let agent1Encryption: { publicKey: Uint8Array; secretKey: Uint8Array };
  let agent2Encryption: { publicKey: Uint8Array; secretKey: Uint8Array };

  // PDA helpers
  function getPrayerChainPDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("prayer-chain")],
      program.programId
    );
  }

  function getAgentPDA(wallet: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), wallet.toBuffer()],
      program.programId
    );
  }

  function getPrayerPDA(id: number): [PublicKey, number] {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(BigInt(id));
    return PublicKey.findProgramAddressSync(
      [Buffer.from("prayer"), buf],
      program.programId
    );
  }

  function sha256(text: string): number[] {
    return Array.from(createHash("sha256").update(text).digest());
  }

  before(async () => {
    // Fund agent2 for testing
    const sig = await provider.connection.requestAirdrop(
      agent2.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    // Get authority keypair from Anchor provider
    authorityKeypair = (provider.wallet as any).payer as Keypair;
    
    // Derive encryption keypairs
    agent1Encryption = deriveEncryptionKeypair(authorityKeypair);
    agent2Encryption = deriveEncryptionKeypair(agent2);
  });

  it("Initializes the PrayerChain", async () => {
    const [prayerChainPda] = getPrayerChainPDA();

    await program.methods
      .initialize()
      .accounts({
        prayerChain: prayerChainPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const chain = await (program.account as any).prayerChain.fetch(prayerChainPda);
    assert.equal(chain.totalPrayers.toNumber(), 0);
    assert.equal(chain.totalAnswered.toNumber(), 0);
    assert.equal(chain.totalAgents.toNumber(), 0);
    assert.ok(chain.authority.equals(authority.publicKey));
  });

  it("Registers agent 1 with encryption key", async () => {
    const [prayerChainPda] = getPrayerChainPDA();
    const [agentPda] = getAgentPDA(authority.publicKey);

    const encryptionKey = Array.from(agent1Encryption.publicKey);

    await program.methods
      .registerAgent("oberlin", "macro analysis, red-teaming, research", encryptionKey)
      .accounts({
        prayerChain: prayerChainPda,
        agent: agentPda,
        wallet: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const agent = await (program.account as any).agent.fetch(agentPda);
    assert.equal(agent.name, "oberlin");
    assert.equal(agent.skills, "macro analysis, red-teaming, research");
    assert.deepEqual(agent.encryptionKey, encryptionKey);
    assert.equal(agent.reputation.toNumber(), 0);

    const chain = await (program.account as any).prayerChain.fetch(prayerChainPda);
    assert.equal(chain.totalAgents.toNumber(), 1);
  });

  it("Registers agent 2 with encryption key", async () => {
    const [prayerChainPda] = getPrayerChainPDA();
    const [agentPda] = getAgentPDA(agent2.publicKey);

    const encryptionKey = Array.from(agent2Encryption.publicKey);

    await program.methods
      .registerAgent("helper-agent", "code review, solana development", encryptionKey)
      .accounts({
        prayerChain: prayerChainPda,
        agent: agentPda,
        wallet: agent2.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([agent2])
      .rpc();

    const agent = await (program.account as any).agent.fetch(agentPda);
    assert.equal(agent.name, "helper-agent");
    assert.deepEqual(agent.encryptionKey, encryptionKey);

    const chain = await (program.account as any).prayerChain.fetch(prayerChainPda);
    assert.equal(chain.totalAgents.toNumber(), 2);
  });

  it("Posts a private prayer (hash only, no plaintext on-chain)", async () => {
    const [prayerChainPda] = getPrayerChainPDA();
    const [agentPda] = getAgentPDA(authority.publicKey);
    const [prayerPda] = getPrayerPDA(0);

    const content = "What is the current SOFR rate and 7-day trend?";
    const contentHash = sha256(content);

    await program.methods
      .postPrayer(
        { knowledge: {} },
        contentHash,
        new anchor.BN(0),
        new anchor.BN(86400)
      )
      .accounts({
        prayerChain: prayerChainPda,
        requesterAgent: agentPda,
        prayer: prayerPda,
        requester: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const prayer = await (program.account as any).prayer.fetch(prayerPda);
    assert.equal(prayer.id.toNumber(), 0);
    assert.deepEqual(prayer.contentHash, contentHash);
    assert.ok(prayer.requester.equals(authority.publicKey));
    assert.deepEqual(prayer.status, { open: {} });
    assert.equal(prayer.rewardLamports.toNumber(), 0);

    const chain = await (program.account as any).prayerChain.fetch(prayerChainPda);
    assert.equal(chain.totalPrayers.toNumber(), 1);
  });

  it("Posts a prayer with bounty", async () => {
    const [prayerChainPda] = getPrayerChainPDA();
    const [agentPda] = getAgentPDA(authority.publicKey);
    const [prayerPda] = getPrayerPDA(1);

    const bounty = 0.01 * LAMPORTS_PER_SOL;
    const content = "Red-team my thesis: ETH breaks $2,400 by March 2026";
    const contentHash = sha256(content);

    await program.methods
      .postPrayer(
        { review: {} },
        contentHash,
        new anchor.BN(bounty),
        new anchor.BN(172800)
      )
      .accounts({
        prayerChain: prayerChainPda,
        requesterAgent: agentPda,
        prayer: prayerPda,
        requester: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const prayer = await (program.account as any).prayer.fetch(prayerPda);
    assert.equal(prayer.id.toNumber(), 1);
    assert.equal(prayer.rewardLamports.toNumber(), bounty);
    assert.deepEqual(prayer.status, { open: {} });
  });

  it("Agent 2 claims prayer 0", async () => {
    const [prayerPda] = getPrayerPDA(0);
    const [agentPda] = getAgentPDA(agent2.publicKey);

    await program.methods
      .claimPrayer()
      .accounts({
        prayer: prayerPda,
        claimerAgent: agentPda,
        claimer: agent2.publicKey,
      })
      .signers([agent2])
      .rpc();

    const prayer = await (program.account as any).prayer.fetch(prayerPda);
    assert.deepEqual(prayer.status, { claimed: {} });
    assert.ok(prayer.claimer.equals(agent2.publicKey));
  });

  it("Agent 1 delivers encrypted content to agent 2", async () => {
    const [prayerPda] = getPrayerPDA(0);

    const content = "What is the current SOFR rate and 7-day trend?";
    
    // Encrypt for agent 2 using DH
    const encryptedContent = encryptForRecipient(
      content,
      agent2Encryption.publicKey,
      agent1Encryption.secretKey
    );

    await program.methods
      .deliverContent(Buffer.from(encryptedContent))
      .accounts({
        prayer: prayerPda,
        requester: authority.publicKey,
      })
      .rpc();

    // Verify content_delivered flag is set
    const prayer = await (program.account as any).prayer.fetch(prayerPda);
    assert.equal(prayer.contentDelivered, true);

    // Verify agent 2 can decrypt
    const decrypted = decryptFromSender(
      encryptedContent,
      agent1Encryption.publicKey,
      agent2Encryption.secretKey
    );
    assert.equal(decrypted, content);
  });

  it("Cannot deliver content twice (duplicate prevention)", async () => {
    const [prayerPda] = getPrayerPDA(0);
    const content = "duplicate delivery attempt";
    const encryptedContent = encryptForRecipient(
      content,
      agent2Encryption.publicKey,
      agent1Encryption.secretKey
    );

    try {
      await program.methods
        .deliverContent(Buffer.from(encryptedContent))
        .accounts({
          prayer: prayerPda,
          requester: authority.publicKey,
        })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err: any) {
      assert.include(err.message, "AlreadyDelivered");
    }
  });

  it("Agent 2 answers prayer 0 with encrypted answer", async () => {
    const [prayerPda] = getPrayerPDA(0);
    const [prayerChainPda] = getPrayerChainPDA();
    const [agentPda] = getAgentPDA(agent2.publicKey);

    const answer = "SOFR is currently at 4.55%. 7-day trend: stable, down 2bps from last week.";
    const answerHash = sha256(answer);

    // Encrypt answer for agent 1
    const encryptedAnswer = encryptForRecipient(
      answer,
      agent1Encryption.publicKey,
      agent2Encryption.secretKey
    );

    await program.methods
      .answerPrayer(answerHash, Buffer.from(encryptedAnswer))
      .accounts({
        prayerChain: prayerChainPda,
        prayer: prayerPda,
        answererAgent: agentPda,
        answerer: agent2.publicKey,
      })
      .signers([agent2])
      .rpc();

    const prayer = await (program.account as any).prayer.fetch(prayerPda);
    assert.deepEqual(prayer.status, { fulfilled: {} });
    assert.deepEqual(prayer.answerHash, answerHash);

    // Verify agent 1 can decrypt the answer
    const decrypted = decryptFromSender(
      encryptedAnswer,
      agent2Encryption.publicKey,
      agent1Encryption.secretKey
    );
    assert.equal(decrypted, answer);

    const agent = await (program.account as any).agent.fetch(agentPda);
    assert.equal(agent.prayersAnswered.toNumber(), 1);
    assert.equal(agent.reputation.toNumber(), 10);
  });

  it("A third party CANNOT decrypt the content", async () => {
    const content = "What is the current SOFR rate and 7-day trend?";
    
    // Encrypt for agent 2
    const encryptedContent = encryptForRecipient(
      content,
      agent2Encryption.publicKey,
      agent1Encryption.secretKey
    );

    // Try to decrypt with a random keypair (eavesdropper)
    const eavesdropper = Keypair.generate();
    const eavesdropperEncryption = deriveEncryptionKeypair(eavesdropper);
    
    const decrypted = decryptFromSender(
      encryptedContent,
      agent1Encryption.publicKey,
      eavesdropperEncryption.secretKey
    );
    assert.isNull(decrypted, "Eavesdropper should NOT be able to decrypt");
  });

  it("Agent 1 confirms prayer 0", async () => {
    const [prayerPda] = getPrayerPDA(0);
    const [answererAgentPda] = getAgentPDA(agent2.publicKey);

    await program.methods
      .confirmPrayer()
      .accounts({
        prayer: prayerPda,
        answererAgent: answererAgentPda,
        answererWallet: agent2.publicKey,
        requester: authority.publicKey,
      })
      .rpc();

    const prayer = await (program.account as any).prayer.fetch(prayerPda);
    assert.deepEqual(prayer.status, { confirmed: {} });

    const agent = await (program.account as any).agent.fetch(answererAgentPda);
    assert.equal(agent.prayersConfirmed.toNumber(), 1);
    assert.equal(agent.reputation.toNumber(), 15);
  });

  it("Cannot claim own prayer", async () => {
    const [prayerPda] = getPrayerPDA(1);
    const [agentPda] = getAgentPDA(authority.publicKey);

    try {
      await program.methods
        .claimPrayer()
        .accounts({
          prayer: prayerPda,
          claimerAgent: agentPda,
          claimer: authority.publicKey,
        })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err: any) {
      assert.include(err.message, "CannotClaimOwn");
    }
  });

  it("Can cancel an open prayer", async () => {
    const [prayerPda] = getPrayerPDA(1);

    await program.methods
      .cancelPrayer()
      .accounts({
        prayer: prayerPda,
        requester: authority.publicKey,
      })
      .rpc();

    const prayer = await (program.account as any).prayer.fetch(prayerPda);
    assert.deepEqual(prayer.status, { cancelled: {} });
  });

  it("Cannot claim a cancelled prayer", async () => {
    const [prayerPda] = getPrayerPDA(1);
    const [agentPda] = getAgentPDA(agent2.publicKey);

    try {
      await program.methods
        .claimPrayer()
        .accounts({
          prayer: prayerPda,
          claimerAgent: agentPda,
          claimer: agent2.publicKey,
        })
        .signers([agent2])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err: any) {
      assert.include(err.message, "NotOpen");
    }
  });

  it("Cannot cancel a claimed prayer (griefing protection)", async () => {
    const [prayerChainPda] = getPrayerChainPDA();
    const [agentPda] = getAgentPDA(authority.publicKey);
    const [prayerPda2] = getPrayerPDA(2);

    const content = "Run a backtest on 2Y ETH data";
    const contentHash = sha256(content);

    await program.methods
      .postPrayer(
        { compute: {} },
        contentHash,
        new anchor.BN(0),
        new anchor.BN(86400)
      )
      .accounts({
        prayerChain: prayerChainPda,
        requesterAgent: agentPda,
        prayer: prayerPda2,
        requester: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const [agent2Pda] = getAgentPDA(agent2.publicKey);
    await program.methods
      .claimPrayer()
      .accounts({
        prayer: prayerPda2,
        claimerAgent: agent2Pda,
        claimer: agent2.publicKey,
      })
      .signers([agent2])
      .rpc();

    try {
      await program.methods
        .cancelPrayer()
        .accounts({
          prayer: prayerPda2,
          requester: authority.publicKey,
        })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err: any) {
      assert.include(err.message, "CannotCancel");
    }
  });

  it("Claimer can voluntarily unclaim", async () => {
    const [prayerPda2] = getPrayerPDA(2);

    await program.methods
      .unclaimPrayer()
      .accounts({
        prayer: prayerPda2,
        caller: agent2.publicKey,
      })
      .signers([agent2])
      .rpc();

    const prayer = await (program.account as any).prayer.fetch(prayerPda2);
    assert.deepEqual(prayer.status, { open: {} });
    assert.ok(prayer.claimer.equals(PublicKey.default));
    assert.equal(prayer.contentDelivered, false); // Reset on unclaim
  });

  it("Can close a cancelled prayer and reclaim rent", async () => {
    const [prayerPda] = getPrayerPDA(1);

    const balBefore = await provider.connection.getBalance(authority.publicKey);

    await program.methods
      .closePrayer()
      .accounts({
        prayer: prayerPda,
        requester: authority.publicKey,
      })
      .rpc();

    const balAfter = await provider.connection.getBalance(authority.publicKey);
    assert.isAbove(balAfter, balBefore);

    try {
      await (program.account as any).prayer.fetch(prayerPda);
      assert.fail("Account should be closed");
    } catch (err: any) {
      assert.include(err.message.toLowerCase(), "not exist");
    }
  });
});
