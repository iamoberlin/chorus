use anchor_lang::prelude::*;

declare_id!("DZuj1ZcX4H6THBSgW4GhKA7SbZNXtPDE5xPkW2jN53PQ");

/// Claim timeout: 1 hour. After this, anyone can unclaim a stale claim.
const CLAIM_TIMEOUT_SECONDS: i64 = 3600;

/// Maximum number of collaborators per prayer
const MAX_CLAIMERS_LIMIT: u8 = 10;

/// Prayer types
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum PrayerType {
    Knowledge,     // Need information or analysis
    Compute,       // Need processing or execution
    Review,        // Need verification or red-teaming
    Signal,        // Need a data feed or alert
    Collaboration, // Need a partner for a task
}

/// Prayer status
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum PrayerStatus {
    Open,       // Accepting claims (until max_claimers reached)
    Active,     // All slots filled, work in progress
    Fulfilled,  // Answer submitted, awaiting confirmation
    Confirmed,  // Requester approved, bounty distributed
    Expired,    // TTL elapsed
    Cancelled,  // Requester cancelled (only when 0 claims)
}

// ── Accounts ──────────────────────────────────────────────

/// Global protocol state (singleton PDA)
#[account]
pub struct PrayerChain {
    pub authority: Pubkey,
    pub total_prayers: u64,
    pub total_answered: u64,
    pub total_agents: u64,
    pub bump: u8,
}

impl PrayerChain {
    pub const INIT_SPACE: usize = 32 + 8 + 8 + 8 + 1;
}

/// Agent identity and reputation
#[account]
pub struct Agent {
    pub wallet: Pubkey,
    pub name: String,            // max 32
    pub skills: String,          // max 256
    pub encryption_key: [u8; 32], // X25519 public key for private prayers
    pub prayers_posted: u64,
    pub prayers_answered: u64,
    pub prayers_confirmed: u64,
    pub reputation: u64,
    pub registered_at: i64,
    pub bump: u8,
}

impl Agent {
    pub const MAX_NAME: usize = 32;
    pub const MAX_SKILLS: usize = 256;
    pub const INIT_SPACE: usize = 32 + 36 + 260 + 32 + 8 + 8 + 8 + 8 + 8 + 1;
}

/// A prayer — supports multiple collaborating claimers
#[account]
pub struct Prayer {
    pub id: u64,
    pub requester: Pubkey,
    pub prayer_type: PrayerType,
    pub content_hash: [u8; 32],
    pub reward_lamports: u64,
    pub status: PrayerStatus,
    pub max_claimers: u8,        // How many agents can collaborate (1 = solo, >1 = collab)
    pub num_claimers: u8,        // Current number of claims
    pub answerer: Pubkey,        // Who submitted the answer (must be a claimer)
    pub answer_hash: [u8; 32],
    pub created_at: i64,
    pub expires_at: i64,
    pub fulfilled_at: i64,
    pub bump: u8,
}

impl Prayer {
    // 8 + 32 + 1 + 32 + 8 + 1 + 1 + 1 + 32 + 32 + 8 + 8 + 8 + 1 = 173
    pub const INIT_SPACE: usize = 8 + 32 + 1 + 32 + 8 + 1 + 1 + 1 + 32 + 32 + 8 + 8 + 8 + 1;
}

/// A claim — one per claimer per prayer (separate PDA)
#[account]
pub struct Claim {
    pub prayer_id: u64,
    pub claimer: Pubkey,
    pub content_delivered: bool,
    pub claimed_at: i64,
    pub bump: u8,
}

impl Claim {
    // 8 + 32 + 1 + 8 + 1 = 50
    pub const INIT_SPACE: usize = 8 + 32 + 1 + 8 + 1;
}

// ── Events ────────────────────────────────────────────────

#[event]
pub struct PrayerPosted {
    pub id: u64,
    pub requester: Pubkey,
    pub prayer_type: PrayerType,
    pub content_hash: [u8; 32],
    pub reward_lamports: u64,
    pub max_claimers: u8,
    pub ttl_seconds: i64,
}

#[event]
pub struct PrayerClaimed {
    pub id: u64,
    pub claimer: Pubkey,
    pub num_claimers: u8,
    pub max_claimers: u8,
}

#[event]
pub struct ContentDelivered {
    pub prayer_id: u64,
    pub requester: Pubkey,
    pub claimer: Pubkey,
    pub encrypted_content: Vec<u8>,  // XSalsa20-Poly1305 (nonce || ciphertext || tag)
}

#[event]
pub struct PrayerAnswered {
    pub id: u64,
    pub answerer: Pubkey,
    pub answer_hash: [u8; 32],
    pub encrypted_answer: Vec<u8>,   // XSalsa20-Poly1305
}

#[event]
pub struct PrayerConfirmed {
    pub id: u64,
    pub requester: Pubkey,
    pub answerer: Pubkey,
    pub num_claimers: u8,
    pub reward_per_claimer: u64,
    pub reward_total: u64,
}

#[event]
pub struct PrayerCancelled {
    pub id: u64,
    pub requester: Pubkey,
}

#[event]
pub struct ClaimRemoved {
    pub prayer_id: u64,
    pub claimer: Pubkey,
    pub num_claimers: u8,
}

// ── Instructions ──────────────────────────────────────────

#[program]
pub mod chorus_prayers {
    use super::*;

    /// Initialize the PrayerChain singleton
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let chain = &mut ctx.accounts.prayer_chain;
        chain.authority = ctx.accounts.authority.key();
        chain.total_prayers = 0;
        chain.total_answered = 0;
        chain.total_agents = 0;
        chain.bump = ctx.bumps.prayer_chain;
        Ok(())
    }

    /// Register a new agent on the prayer chain
    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        name: String,
        skills: String,
        encryption_key: [u8; 32],
    ) -> Result<()> {
        require!(name.len() <= Agent::MAX_NAME, PrayerError::NameTooLong);
        require!(skills.len() <= Agent::MAX_SKILLS, PrayerError::SkillsTooLong);
        require!(encryption_key != [0u8; 32], PrayerError::InvalidEncryptionKey);

        let agent = &mut ctx.accounts.agent;
        agent.wallet = ctx.accounts.wallet.key();
        agent.name = name;
        agent.skills = skills;
        agent.encryption_key = encryption_key;
        agent.prayers_posted = 0;
        agent.prayers_answered = 0;
        agent.prayers_confirmed = 0;
        agent.reputation = 0;
        agent.registered_at = Clock::get()?.unix_timestamp;
        agent.bump = ctx.bumps.agent;

        let chain = &mut ctx.accounts.prayer_chain;
        chain.total_agents = chain.total_agents.checked_add(1).unwrap();

        Ok(())
    }

    /// Post a prayer. max_claimers controls collaboration (1 = solo, >1 = multi-agent).
    pub fn post_prayer(
        ctx: Context<PostPrayer>,
        prayer_type: PrayerType,
        content_hash: [u8; 32],
        reward_lamports: u64,
        ttl_seconds: i64,
        max_claimers: u8,
    ) -> Result<()> {
        require!(ttl_seconds > 0 && ttl_seconds <= 604_800, PrayerError::InvalidTTL);
        require!(max_claimers >= 1 && max_claimers <= MAX_CLAIMERS_LIMIT, PrayerError::InvalidMaxClaimers);

        let now = Clock::get()?.unix_timestamp;
        let chain = &mut ctx.accounts.prayer_chain;
        let prayer_id = chain.total_prayers;

        let prayer = &mut ctx.accounts.prayer;
        prayer.id = prayer_id;
        prayer.requester = ctx.accounts.requester.key();
        prayer.prayer_type = prayer_type;
        prayer.content_hash = content_hash;
        prayer.reward_lamports = reward_lamports;
        prayer.status = PrayerStatus::Open;
        prayer.max_claimers = max_claimers;
        prayer.num_claimers = 0;
        prayer.answerer = Pubkey::default();
        prayer.answer_hash = [0u8; 32];
        prayer.created_at = now;
        prayer.expires_at = now.checked_add(ttl_seconds).unwrap();
        prayer.fulfilled_at = 0;
        prayer.bump = ctx.bumps.prayer;

        // Escrow bounty
        if reward_lamports > 0 {
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.requester.to_account_info(),
                        to: ctx.accounts.prayer.to_account_info(),
                    },
                ),
                reward_lamports,
            )?;
        }

        chain.total_prayers = chain.total_prayers.checked_add(1).unwrap();
        let agent = &mut ctx.accounts.requester_agent;
        agent.prayers_posted = agent.prayers_posted.checked_add(1).unwrap();

        emit!(PrayerPosted {
            id: prayer_id,
            requester: ctx.accounts.requester.key(),
            prayer_type,
            content_hash,
            reward_lamports,
            max_claimers,
            ttl_seconds,
        });

        Ok(())
    }

    /// Claim a prayer. Creates a Claim PDA. Multiple agents can claim until max_claimers.
    pub fn claim_prayer(ctx: Context<ClaimPrayer>) -> Result<()> {
        let prayer = &mut ctx.accounts.prayer;
        let now = Clock::get()?.unix_timestamp;

        require!(
            prayer.status == PrayerStatus::Open,
            PrayerError::NotOpen
        );
        require!(now < prayer.expires_at, PrayerError::Expired);
        require!(
            prayer.requester != ctx.accounts.claimer.key(),
            PrayerError::CannotClaimOwn
        );

        // Initialize the Claim PDA
        let claim = &mut ctx.accounts.claim;
        claim.prayer_id = prayer.id;
        claim.claimer = ctx.accounts.claimer.key();
        claim.content_delivered = false;
        claim.claimed_at = now;
        claim.bump = ctx.bumps.claim;

        // Increment claimer count
        prayer.num_claimers = prayer.num_claimers.checked_add(1).unwrap();

        // If all slots filled, move to Active
        if prayer.num_claimers >= prayer.max_claimers {
            prayer.status = PrayerStatus::Active;
        }

        emit!(PrayerClaimed {
            id: prayer.id,
            claimer: ctx.accounts.claimer.key(),
            num_claimers: prayer.num_claimers,
            max_claimers: prayer.max_claimers,
        });

        Ok(())
    }

    /// Deliver encrypted content to a specific claimer.
    /// Must be called once per claimer (each gets unique DH-encrypted content).
    pub fn deliver_content(
        ctx: Context<DeliverContent>,
        encrypted_content: Vec<u8>,
    ) -> Result<()> {
        let prayer = &ctx.accounts.prayer;
        let claim = &mut ctx.accounts.claim;

        require!(
            prayer.status == PrayerStatus::Open || prayer.status == PrayerStatus::Active,
            PrayerError::NotClaimed
        );
        require!(
            prayer.requester == ctx.accounts.requester.key(),
            PrayerError::NotRequester
        );
        require!(!claim.content_delivered, PrayerError::AlreadyDelivered);

        claim.content_delivered = true;

        emit!(ContentDelivered {
            prayer_id: prayer.id,
            requester: ctx.accounts.requester.key(),
            claimer: claim.claimer,
            encrypted_content,
        });

        Ok(())
    }

    /// Answer a prayer. The answerer must be a claimer (have a Claim PDA).
    /// Encrypted answer is for the requester.
    pub fn answer_prayer(
        ctx: Context<AnswerPrayer>,
        answer_hash: [u8; 32],
        encrypted_answer: Vec<u8>,
    ) -> Result<()> {
        let prayer = &mut ctx.accounts.prayer;
        let now = Clock::get()?.unix_timestamp;

        require!(
            prayer.status == PrayerStatus::Open || prayer.status == PrayerStatus::Active,
            PrayerError::NotClaimed
        );
        require!(now < prayer.expires_at, PrayerError::Expired);
        // Claim PDA validation ensures answerer is a claimer (PDA derivation enforces it)

        prayer.status = PrayerStatus::Fulfilled;
        prayer.answerer = ctx.accounts.answerer.key();
        prayer.answer_hash = answer_hash;
        prayer.fulfilled_at = now;

        let agent = &mut ctx.accounts.answerer_agent;
        agent.prayers_answered = agent.prayers_answered.checked_add(1).unwrap();
        agent.reputation = agent.reputation.checked_add(10).unwrap();

        let chain = &mut ctx.accounts.prayer_chain;
        chain.total_answered = chain.total_answered.checked_add(1).unwrap();

        emit!(PrayerAnswered {
            id: prayer.id,
            answerer: ctx.accounts.answerer.key(),
            answer_hash,
            encrypted_answer,
        });

        Ok(())
    }

    /// Confirm a prayer. Bounty splits equally among ALL claimers.
    /// Remaining accounts: pairs of [claimer_wallet, claimer_agent_pda] for each claimer.
    pub fn confirm_prayer(ctx: Context<ConfirmPrayer>) -> Result<()> {
        let prayer = &mut ctx.accounts.prayer;

        require!(
            prayer.status == PrayerStatus::Fulfilled,
            PrayerError::NotFulfilled
        );
        require!(
            prayer.requester == ctx.accounts.requester.key(),
            PrayerError::NotRequester
        );

        prayer.status = PrayerStatus::Confirmed;

        let num_claimers = prayer.num_claimers as u64;
        let reward_per_claimer = if prayer.reward_lamports > 0 && num_claimers > 0 {
            prayer.reward_lamports / num_claimers
        } else {
            0
        };

        // Distribute bounty equally via remaining accounts
        // Each remaining account should be a claimer wallet (writable)
        let prayer_info = prayer.to_account_info();
        let remaining = &ctx.remaining_accounts;
        let mut distributed: u64 = 0;

        for account_info in remaining.iter() {
            if distributed + reward_per_claimer > prayer.reward_lamports {
                break;
            }
            if reward_per_claimer > 0 {
                **prayer_info.try_borrow_mut_lamports()? = prayer_info
                    .lamports()
                    .checked_sub(reward_per_claimer)
                    .unwrap();
                **account_info.try_borrow_mut_lamports()? = account_info
                    .lamports()
                    .checked_add(reward_per_claimer)
                    .unwrap();
                distributed += reward_per_claimer;
            }
        }

        // Give answerer's agent +5 bonus rep
        let answerer_agent = &mut ctx.accounts.answerer_agent;
        answerer_agent.prayers_confirmed = answerer_agent
            .prayers_confirmed
            .checked_add(1)
            .unwrap();
        answerer_agent.reputation = answerer_agent.reputation.checked_add(5).unwrap();

        emit!(PrayerConfirmed {
            id: prayer.id,
            requester: ctx.accounts.requester.key(),
            answerer: prayer.answerer,
            num_claimers: prayer.num_claimers,
            reward_per_claimer,
            reward_total: distributed,
        });

        Ok(())
    }

    /// Cancel a prayer. Only when NO claims exist (num_claimers == 0).
    pub fn cancel_prayer(ctx: Context<CancelPrayer>) -> Result<()> {
        let prayer = &mut ctx.accounts.prayer;

        require!(
            prayer.status == PrayerStatus::Open,
            PrayerError::CannotCancel
        );
        require!(
            prayer.num_claimers == 0,
            PrayerError::HasClaimers
        );
        require!(
            prayer.requester == ctx.accounts.requester.key(),
            PrayerError::NotRequester
        );

        prayer.status = PrayerStatus::Cancelled;

        if prayer.reward_lamports > 0 {
            let prayer_info = prayer.to_account_info();
            let requester_info = ctx.accounts.requester.to_account_info();

            **prayer_info.try_borrow_mut_lamports()? = prayer_info
                .lamports()
                .checked_sub(prayer.reward_lamports)
                .unwrap();
            **requester_info.try_borrow_mut_lamports()? = requester_info
                .lamports()
                .checked_add(prayer.reward_lamports)
                .unwrap();
        }

        emit!(PrayerCancelled {
            id: prayer.id,
            requester: ctx.accounts.requester.key(),
        });

        Ok(())
    }

    /// Remove a claim. Claimer voluntarily, or anyone after timeout.
    /// Closes the Claim PDA and decrements num_claimers.
    pub fn unclaim_prayer(ctx: Context<UnclaimPrayer>) -> Result<()> {
        let prayer = &mut ctx.accounts.prayer;
        let claim = &ctx.accounts.claim;
        let now = Clock::get()?.unix_timestamp;

        require!(
            prayer.status == PrayerStatus::Open || prayer.status == PrayerStatus::Active,
            PrayerError::NotClaimed
        );

        let is_claimer = claim.claimer == ctx.accounts.caller.key();
        let claim_expired = now > claim.claimed_at.checked_add(CLAIM_TIMEOUT_SECONDS).unwrap();

        require!(
            is_claimer || claim_expired,
            PrayerError::NotClaimer
        );

        prayer.num_claimers = prayer.num_claimers.checked_sub(1).unwrap();

        // If was Active, reopen since a slot freed up
        if prayer.status == PrayerStatus::Active {
            prayer.status = PrayerStatus::Open;
        }

        emit!(ClaimRemoved {
            prayer_id: prayer.id,
            claimer: claim.claimer,
            num_claimers: prayer.num_claimers,
        });

        // Claim PDA is closed by the `close = claimer_wallet` constraint
        Ok(())
    }

    /// Close a resolved prayer and return rent to requester.
    pub fn close_prayer(ctx: Context<ClosePrayer>) -> Result<()> {
        let prayer = &ctx.accounts.prayer;

        let is_terminal = matches!(
            prayer.status,
            PrayerStatus::Confirmed | PrayerStatus::Cancelled
        );

        let now = Clock::get()?.unix_timestamp;
        let is_expired = now > prayer.expires_at
            && matches!(prayer.status, PrayerStatus::Open | PrayerStatus::Active);

        require!(is_terminal || is_expired, PrayerError::CannotClose);

        if is_expired && prayer.reward_lamports > 0 {
            let prayer_info = ctx.accounts.prayer.to_account_info();
            let requester_info = ctx.accounts.requester.to_account_info();

            **prayer_info.try_borrow_mut_lamports()? = prayer_info
                .lamports()
                .checked_sub(prayer.reward_lamports)
                .unwrap();
            **requester_info.try_borrow_mut_lamports()? = requester_info
                .lamports()
                .checked_add(prayer.reward_lamports)
                .unwrap();
        }

        Ok(())
    }
}

// ── Contexts ──────────────────────────────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + PrayerChain::INIT_SPACE,
        seeds = [b"prayer-chain"],
        bump,
    )]
    pub prayer_chain: Account<'info, PrayerChain>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterAgent<'info> {
    #[account(
        mut,
        seeds = [b"prayer-chain"],
        bump = prayer_chain.bump,
    )]
    pub prayer_chain: Account<'info, PrayerChain>,

    #[account(
        init,
        payer = wallet,
        space = 8 + Agent::INIT_SPACE,
        seeds = [b"agent", wallet.key().as_ref()],
        bump,
    )]
    pub agent: Account<'info, Agent>,

    #[account(mut)]
    pub wallet: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PostPrayer<'info> {
    #[account(
        mut,
        seeds = [b"prayer-chain"],
        bump = prayer_chain.bump,
    )]
    pub prayer_chain: Account<'info, PrayerChain>,

    #[account(
        mut,
        seeds = [b"agent", requester.key().as_ref()],
        bump = requester_agent.bump,
    )]
    pub requester_agent: Account<'info, Agent>,

    #[account(
        init,
        payer = requester,
        space = 8 + Prayer::INIT_SPACE,
        seeds = [b"prayer", prayer_chain.total_prayers.to_le_bytes().as_ref()],
        bump,
    )]
    pub prayer: Account<'info, Prayer>,

    #[account(mut)]
    pub requester: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction()]
pub struct ClaimPrayer<'info> {
    #[account(
        mut,
        seeds = [b"prayer", prayer.id.to_le_bytes().as_ref()],
        bump = prayer.bump,
    )]
    pub prayer: Account<'info, Prayer>,

    #[account(
        init,
        payer = claimer,
        space = 8 + Claim::INIT_SPACE,
        seeds = [b"claim", prayer.id.to_le_bytes().as_ref(), claimer.key().as_ref()],
        bump,
    )]
    pub claim: Account<'info, Claim>,

    #[account(
        seeds = [b"agent", claimer.key().as_ref()],
        bump = claimer_agent.bump,
    )]
    pub claimer_agent: Account<'info, Agent>,

    #[account(mut)]
    pub claimer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction()]
pub struct DeliverContent<'info> {
    #[account(
        seeds = [b"prayer", prayer.id.to_le_bytes().as_ref()],
        bump = prayer.bump,
        has_one = requester @ PrayerError::NotRequester,
    )]
    pub prayer: Account<'info, Prayer>,

    #[account(
        mut,
        seeds = [b"claim", prayer.id.to_le_bytes().as_ref(), claim.claimer.as_ref()],
        bump = claim.bump,
    )]
    pub claim: Account<'info, Claim>,

    pub requester: Signer<'info>,
}

#[derive(Accounts)]
#[instruction()]
pub struct AnswerPrayer<'info> {
    #[account(
        mut,
        seeds = [b"prayer-chain"],
        bump = prayer_chain.bump,
    )]
    pub prayer_chain: Account<'info, PrayerChain>,

    #[account(
        mut,
        seeds = [b"prayer", prayer.id.to_le_bytes().as_ref()],
        bump = prayer.bump,
    )]
    pub prayer: Account<'info, Prayer>,

    /// Claim PDA proves the answerer is a legitimate claimer
    #[account(
        seeds = [b"claim", prayer.id.to_le_bytes().as_ref(), answerer.key().as_ref()],
        bump = claim.bump,
    )]
    pub claim: Account<'info, Claim>,

    #[account(
        mut,
        seeds = [b"agent", answerer.key().as_ref()],
        bump = answerer_agent.bump,
    )]
    pub answerer_agent: Account<'info, Agent>,

    pub answerer: Signer<'info>,
}

#[derive(Accounts)]
#[instruction()]
pub struct ConfirmPrayer<'info> {
    #[account(
        mut,
        seeds = [b"prayer", prayer.id.to_le_bytes().as_ref()],
        bump = prayer.bump,
        has_one = requester @ PrayerError::NotRequester,
    )]
    pub prayer: Account<'info, Prayer>,

    #[account(
        mut,
        seeds = [b"agent", prayer.answerer.as_ref()],
        bump = answerer_agent.bump,
    )]
    pub answerer_agent: Account<'info, Agent>,

    #[account(mut)]
    pub requester: Signer<'info>,

    // Remaining accounts: claimer wallets (mut) for bounty distribution
}

#[derive(Accounts)]
#[instruction()]
pub struct CancelPrayer<'info> {
    #[account(
        mut,
        seeds = [b"prayer", prayer.id.to_le_bytes().as_ref()],
        bump = prayer.bump,
        has_one = requester @ PrayerError::NotRequester,
    )]
    pub prayer: Account<'info, Prayer>,

    #[account(mut)]
    pub requester: Signer<'info>,
}

#[derive(Accounts)]
#[instruction()]
pub struct UnclaimPrayer<'info> {
    #[account(
        mut,
        seeds = [b"prayer", prayer.id.to_le_bytes().as_ref()],
        bump = prayer.bump,
    )]
    pub prayer: Account<'info, Prayer>,

    #[account(
        mut,
        seeds = [b"claim", prayer.id.to_le_bytes().as_ref(), claim.claimer.as_ref()],
        bump = claim.bump,
        close = claimer_wallet,
    )]
    pub claim: Account<'info, Claim>,

    /// CHECK: Receives rent from closed Claim account
    #[account(
        mut,
        constraint = claimer_wallet.key() == claim.claimer @ PrayerError::NotClaimer
    )]
    pub claimer_wallet: UncheckedAccount<'info>,

    pub caller: Signer<'info>,
}

#[derive(Accounts)]
#[instruction()]
pub struct ClosePrayer<'info> {
    #[account(
        mut,
        seeds = [b"prayer", prayer.id.to_le_bytes().as_ref()],
        bump = prayer.bump,
        has_one = requester @ PrayerError::NotRequester,
        close = requester,
    )]
    pub prayer: Account<'info, Prayer>,

    #[account(mut)]
    pub requester: Signer<'info>,
}

// ── Errors ────────────────────────────────────────────────

#[error_code]
pub enum PrayerError {
    #[msg("Name exceeds 32 characters")]
    NameTooLong,
    #[msg("Skills exceeds 256 characters")]
    SkillsTooLong,
    #[msg("TTL must be between 1 and 604800 seconds")]
    InvalidTTL,
    #[msg("Prayer is not open for claims")]
    NotOpen,
    #[msg("Prayer has no active claims")]
    NotClaimed,
    #[msg("Prayer is not fulfilled")]
    NotFulfilled,
    #[msg("Prayer has expired")]
    Expired,
    #[msg("Cannot claim your own prayer")]
    CannotClaimOwn,
    #[msg("Not authorized (not the claimer)")]
    NotClaimer,
    #[msg("Only the requester can perform this action")]
    NotRequester,
    #[msg("Cannot cancel a prayer with active claims")]
    HasClaimers,
    #[msg("Can only cancel open prayers with no claims")]
    CannotCancel,
    #[msg("Prayer must be confirmed, cancelled, or expired to close")]
    CannotClose,
    #[msg("Encryption key cannot be all zeros")]
    InvalidEncryptionKey,
    #[msg("Content has already been delivered to this claimer")]
    AlreadyDelivered,
    #[msg("max_claimers must be 1-10")]
    InvalidMaxClaimers,
}
