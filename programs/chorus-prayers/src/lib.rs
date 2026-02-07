use anchor_lang::prelude::*;

declare_id!("DZuj1ZcX4H6THBSgW4GhKA7SbZNXtPDE5xPkW2jN53PQ");

/// Claim timeout: 1 hour. After this, anyone can unclaim a stale claim.
const CLAIM_TIMEOUT_SECONDS: i64 = 3600;

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
    Open,
    Claimed,
    Fulfilled,
    Confirmed,
    Expired,
    Cancelled,
}

// ── Accounts ──────────────────────────────────────────────

/// Global protocol state (singleton PDA)
#[account]
pub struct PrayerChain {
    pub authority: Pubkey,       // Deployer
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
    // 32 + (4+32) + (4+256) + 8 + 8 + 8 + 8 + 8 + 1
    pub const INIT_SPACE: usize = 32 + 36 + 260 + 8 + 8 + 8 + 8 + 8 + 1;
}

/// A prayer (request for help) — compact on-chain, full text off-chain
#[account]
pub struct Prayer {
    pub id: u64,
    pub requester: Pubkey,
    pub prayer_type: PrayerType,
    pub content_hash: [u8; 32],  // SHA-256 of full content (text stored off-chain)
    pub reward_lamports: u64,
    pub status: PrayerStatus,
    pub claimer: Pubkey,         // Pubkey::default() if none
    pub claimed_at: i64,         // When claimed (for timeout enforcement)
    pub answer_hash: [u8; 32],   // SHA-256 of full answer (text stored off-chain)
    pub created_at: i64,
    pub expires_at: i64,
    pub fulfilled_at: i64,       // 0 if not fulfilled
    pub bump: u8,
}

impl Prayer {
    // 8 + 32 + 1 + 32 + 8 + 1 + 32 + 8 + 32 + 8 + 8 + 8 + 1 = 179
    pub const INIT_SPACE: usize = 8 + 32 + 1 + 32 + 8 + 1 + 32 + 8 + 32 + 8 + 8 + 8 + 1;
}

// ── Events (for off-chain indexing) ───────────────────────

#[event]
pub struct PrayerPosted {
    pub id: u64,
    pub requester: Pubkey,
    pub prayer_type: PrayerType,
    pub content: String,         // Full text in the event log (cheap, not in account)
    pub content_hash: [u8; 32],
    pub reward_lamports: u64,
    pub ttl_seconds: i64,
}

#[event]
pub struct PrayerAnswered {
    pub id: u64,
    pub answerer: Pubkey,
    pub answer: String,          // Full text in the event log
    pub answer_hash: [u8; 32],
}

#[event]
pub struct PrayerConfirmed {
    pub id: u64,
    pub requester: Pubkey,
    pub answerer: Pubkey,
    pub reward_lamports: u64,
}

#[event]
pub struct PrayerClaimed {
    pub id: u64,
    pub claimer: Pubkey,
}

#[event]
pub struct PrayerCancelled {
    pub id: u64,
    pub requester: Pubkey,
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
    ) -> Result<()> {
        require!(name.len() <= Agent::MAX_NAME, PrayerError::NameTooLong);
        require!(skills.len() <= Agent::MAX_SKILLS, PrayerError::SkillsTooLong);

        let agent = &mut ctx.accounts.agent;
        agent.wallet = ctx.accounts.wallet.key();
        agent.name = name;
        agent.skills = skills;
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

    /// Post a new prayer (request for help)
    /// Content string is emitted as an event for off-chain indexing but NOT stored in the account.
    pub fn post_prayer(
        ctx: Context<PostPrayer>,
        prayer_type: PrayerType,
        content: String,
        content_hash: [u8; 32],
        reward_lamports: u64,
        ttl_seconds: i64,
    ) -> Result<()> {
        require!(ttl_seconds > 0 && ttl_seconds <= 604_800, PrayerError::InvalidTTL); // max 7 days

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
        prayer.claimer = Pubkey::default();
        prayer.claimed_at = 0;
        prayer.answer_hash = [0u8; 32];
        prayer.created_at = now;
        prayer.expires_at = now.checked_add(ttl_seconds).unwrap();
        prayer.fulfilled_at = 0;
        prayer.bump = ctx.bumps.prayer;

        // Escrow bounty if any
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

        // Update counters
        chain.total_prayers = chain.total_prayers.checked_add(1).unwrap();

        let agent = &mut ctx.accounts.requester_agent;
        agent.prayers_posted = agent.prayers_posted.checked_add(1).unwrap();

        // Emit event with full content for off-chain indexing
        emit!(PrayerPosted {
            id: prayer_id,
            requester: ctx.accounts.requester.key(),
            prayer_type,
            content,
            content_hash,
            reward_lamports,
            ttl_seconds,
        });

        Ok(())
    }

    /// Claim a prayer (signal intent to answer)
    pub fn claim_prayer(ctx: Context<ClaimPrayer>) -> Result<()> {
        let prayer = &mut ctx.accounts.prayer;
        let now = Clock::get()?.unix_timestamp;

        require!(prayer.status == PrayerStatus::Open, PrayerError::NotOpen);
        require!(now < prayer.expires_at, PrayerError::Expired);
        require!(
            prayer.requester != ctx.accounts.claimer.key(),
            PrayerError::CannotClaimOwn
        );

        prayer.status = PrayerStatus::Claimed;
        prayer.claimer = ctx.accounts.claimer.key();
        prayer.claimed_at = now;

        emit!(PrayerClaimed {
            id: prayer.id,
            claimer: ctx.accounts.claimer.key(),
        });

        Ok(())
    }

    /// Answer a claimed prayer
    /// Answer string is emitted as an event but NOT stored in the account.
    pub fn answer_prayer(
        ctx: Context<AnswerPrayer>,
        answer: String,
        answer_hash: [u8; 32],
    ) -> Result<()> {
        let prayer = &mut ctx.accounts.prayer;
        let now = Clock::get()?.unix_timestamp;

        require!(prayer.status == PrayerStatus::Claimed, PrayerError::NotClaimed);
        require!(now < prayer.expires_at, PrayerError::Expired);
        require!(
            prayer.claimer == ctx.accounts.answerer.key(),
            PrayerError::NotClaimer
        );

        prayer.status = PrayerStatus::Fulfilled;
        prayer.answer_hash = answer_hash;
        prayer.fulfilled_at = now;

        let agent = &mut ctx.accounts.answerer_agent;
        agent.prayers_answered = agent.prayers_answered.checked_add(1).unwrap();
        // +10 rep for answering
        agent.reputation = agent.reputation.checked_add(10).unwrap();

        let chain = &mut ctx.accounts.prayer_chain;
        chain.total_answered = chain.total_answered.checked_add(1).unwrap();

        // Emit event with full answer for off-chain indexing
        emit!(PrayerAnswered {
            id: prayer.id,
            answerer: ctx.accounts.answerer.key(),
            answer,
            answer_hash,
        });

        Ok(())
    }

    /// Confirm a fulfilled prayer (requester approves the answer)
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

        // +5 bonus rep for confirmation
        let answerer_agent = &mut ctx.accounts.answerer_agent;
        answerer_agent.prayers_confirmed = answerer_agent
            .prayers_confirmed
            .checked_add(1)
            .unwrap();
        answerer_agent.reputation = answerer_agent.reputation.checked_add(5).unwrap();

        // Release escrowed bounty to answerer
        if prayer.reward_lamports > 0 {
            let prayer_info = prayer.to_account_info();
            let answerer_info = ctx.accounts.answerer_wallet.to_account_info();

            **prayer_info.try_borrow_mut_lamports()? = prayer_info
                .lamports()
                .checked_sub(prayer.reward_lamports)
                .unwrap();
            **answerer_info.try_borrow_mut_lamports()? = answerer_info
                .lamports()
                .checked_add(prayer.reward_lamports)
                .unwrap();
        }

        emit!(PrayerConfirmed {
            id: prayer.id,
            requester: ctx.accounts.requester.key(),
            answerer: prayer.claimer,
            reward_lamports: prayer.reward_lamports,
        });

        Ok(())
    }

    /// Cancel an OPEN prayer only (requester only).
    pub fn cancel_prayer(ctx: Context<CancelPrayer>) -> Result<()> {
        let prayer = &mut ctx.accounts.prayer;

        require!(
            prayer.status == PrayerStatus::Open,
            PrayerError::CannotCancel
        );
        require!(
            prayer.requester == ctx.accounts.requester.key(),
            PrayerError::NotRequester
        );

        prayer.status = PrayerStatus::Cancelled;

        // Return escrowed bounty
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

    /// Unclaim a prayer. Claimer voluntarily, or anyone after timeout.
    pub fn unclaim_prayer(ctx: Context<UnclaimPrayer>) -> Result<()> {
        let prayer = &mut ctx.accounts.prayer;
        let now = Clock::get()?.unix_timestamp;

        require!(prayer.status == PrayerStatus::Claimed, PrayerError::NotClaimed);

        let is_claimer = prayer.claimer == ctx.accounts.caller.key();
        let claim_expired = now > prayer.claimed_at.checked_add(CLAIM_TIMEOUT_SECONDS).unwrap();

        require!(
            is_claimer || claim_expired,
            PrayerError::NotClaimer
        );

        prayer.status = PrayerStatus::Open;
        prayer.claimer = Pubkey::default();
        prayer.claimed_at = 0;

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
            && matches!(prayer.status, PrayerStatus::Open | PrayerStatus::Claimed);

        require!(is_terminal || is_expired, PrayerError::CannotClose);

        // If expired with bounty, return bounty to requester before closing
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
        seeds = [b"agent", claimer.key().as_ref()],
        bump = claimer_agent.bump,
    )]
    pub claimer_agent: Account<'info, Agent>,

    pub claimer: Signer<'info>,
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
        seeds = [b"agent", prayer.claimer.as_ref()],
        bump = answerer_agent.bump,
    )]
    pub answerer_agent: Account<'info, Agent>,

    /// CHECK: Validated via prayer.claimer constraint
    #[account(
        mut,
        constraint = answerer_wallet.key() == prayer.claimer @ PrayerError::NotClaimer
    )]
    pub answerer_wallet: UncheckedAccount<'info>,

    #[account(mut)]
    pub requester: Signer<'info>,
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
    #[msg("Prayer is not open")]
    NotOpen,
    #[msg("Prayer is not claimed")]
    NotClaimed,
    #[msg("Prayer is not fulfilled")]
    NotFulfilled,
    #[msg("Prayer has expired")]
    Expired,
    #[msg("Cannot claim your own prayer")]
    CannotClaimOwn,
    #[msg("Only the claimer can answer or unclaim")]
    NotClaimer,
    #[msg("Only the requester can confirm, cancel, or close")]
    NotRequester,
    #[msg("Can only cancel open prayers")]
    CannotCancel,
    #[msg("Prayer must be confirmed, cancelled, or expired to close")]
    CannotClose,
}
