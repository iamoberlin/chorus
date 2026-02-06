import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";

// Load IDL type
const IDL = require("../target/idl/chorus_prayers.json");

describe("chorus-prayers", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program(IDL, provider);
  const authority = provider.wallet;

  // Test agents
  const agent2 = Keypair.generate();

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

  before(async () => {
    // Fund agent2 for testing
    const sig = await provider.connection.requestAirdrop(
      agent2.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);
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

  it("Registers agent 1 (authority)", async () => {
    const [prayerChainPda] = getPrayerChainPDA();
    const [agentPda] = getAgentPDA(authority.publicKey);

    await program.methods
      .registerAgent("oberlin", "macro analysis, red-teaming, research")
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
    assert.equal(agent.reputation.toNumber(), 0);
    assert.equal(agent.prayersPosted.toNumber(), 0);

    const chain = await (program.account as any).prayerChain.fetch(prayerChainPda);
    assert.equal(chain.totalAgents.toNumber(), 1);
  });

  it("Registers agent 2", async () => {
    const [prayerChainPda] = getPrayerChainPDA();
    const [agentPda] = getAgentPDA(agent2.publicKey);

    await program.methods
      .registerAgent("helper-agent", "code review, solana development")
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
    assert.equal(agent.reputation.toNumber(), 0);

    const chain = await (program.account as any).prayerChain.fetch(prayerChainPda);
    assert.equal(chain.totalAgents.toNumber(), 2);
  });

  it("Posts a prayer (no bounty)", async () => {
    const [prayerChainPda] = getPrayerChainPDA();
    const [agentPda] = getAgentPDA(authority.publicKey);
    const [prayerPda] = getPrayerPDA(0);

    await program.methods
      .postPrayer(
        { knowledge: {} },
        "What is the current SOFR rate and 7-day trend?",
        new anchor.BN(0), // no bounty
        new anchor.BN(86400) // 24h TTL
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
    assert.equal(prayer.content, "What is the current SOFR rate and 7-day trend?");
    assert.ok(prayer.requester.equals(authority.publicKey));
    assert.deepEqual(prayer.status, { open: {} });
    assert.equal(prayer.rewardLamports.toNumber(), 0);

    const chain = await (program.account as any).prayerChain.fetch(prayerChainPda);
    assert.equal(chain.totalPrayers.toNumber(), 1);

    const agent = await (program.account as any).agent.fetch(agentPda);
    assert.equal(agent.prayersPosted.toNumber(), 1);
  });

  it("Posts a prayer with bounty", async () => {
    const [prayerChainPda] = getPrayerChainPDA();
    const [agentPda] = getAgentPDA(authority.publicKey);
    const [prayerPda] = getPrayerPDA(1);

    const bounty = 0.01 * LAMPORTS_PER_SOL; // 0.01 SOL

    await program.methods
      .postPrayer(
        { review: {} },
        "Red-team my thesis: ETH breaks $2,400 by March 2026",
        new anchor.BN(bounty),
        new anchor.BN(172800) // 48h TTL
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

  it("Agent 2 answers prayer 0", async () => {
    const [prayerPda] = getPrayerPDA(0);
    const [prayerChainPda] = getPrayerChainPDA();
    const [agentPda] = getAgentPDA(agent2.publicKey);

    const answer = "SOFR is currently at 4.55%. 7-day trend: stable, down 2bps from last week.";
    const hash = Array.from(
      Buffer.from(
        require("crypto").createHash("sha256").update(answer).digest()
      )
    );

    await program.methods
      .answerPrayer(answer, hash)
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
    assert.equal(prayer.answer, answer);
    assert.ok(prayer.fulfilledAt.toNumber() > 0);

    const agent = await (program.account as any).agent.fetch(agentPda);
    assert.equal(agent.prayersAnswered.toNumber(), 1);
    assert.equal(agent.reputation.toNumber(), 10); // +10 for answering
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
    assert.equal(agent.reputation.toNumber(), 15); // 10 + 5 confirmation bonus
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
});
