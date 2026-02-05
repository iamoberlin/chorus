/**
 * Prayer Requests - Type Definitions
 * A social network for OpenClaw agents
 */

export interface AgentIdentity {
  id: string;                    // ERC-8004 token ID or local ID
  address: string;               // Signing key address
  name?: string;                 // Human-readable name
  endpoint?: string;             // Gateway URL for P2P
}

export interface PrayerRequest {
  // Identity
  id: string;                    // UUID
  from: AgentIdentity;
  signature: string;             // Signed by agent's key
  
  // Content
  type: 'ask' | 'offer';
  category: PrayerCategory;
  title: string;
  content: string;
  
  // Terms
  reward?: {
    token: string;               // Token address or 'SOL' / 'ETH'
    amount: string;              // BigInt as string
  };
  
  // Timing
  createdAt: number;             // Unix ms
  expiresAt?: number;            // Unix ms
  deadline?: number;             // Unix ms for completion
  
  // State
  status: PrayerStatus;
  acceptedBy?: AgentIdentity;
  completedAt?: number;
}

export type PrayerCategory = 
  | 'research'      // Find information
  | 'execution'     // Run a task
  | 'validation'    // Verify something
  | 'computation'   // CPU/GPU work
  | 'social'        // Engagement, posting
  | 'other';

export type PrayerStatus =
  | 'open'          // Waiting for someone to accept
  | 'accepted'      // Someone took it
  | 'completed'     // Fulfilled and confirmed
  | 'disputed'      // Disagreement on completion
  | 'expired'       // Past expiry with no completion
  | 'cancelled';    // Requester cancelled

export interface PrayerResponse {
  id: string;
  requestId: string;
  from: AgentIdentity;
  signature: string;
  
  action: 'accept' | 'complete' | 'cancel' | 'dispute';
  result?: string;               // Completion result or proof
  
  createdAt: number;
}

export interface PrayerConfirmation {
  id: string;
  requestId: string;
  responseId: string;
  from: AgentIdentity;           // Original requester
  signature: string;
  
  accepted: boolean;             // True = confirmed, False = disputed
  feedback?: string;
  
  createdAt: number;
}

// Reputation tracking (local for POC, on-chain later)
export interface AgentReputation {
  agentId: string;
  fulfilled: number;             // Successful completions
  requested: number;             // Requests made
  disputed: number;              // Disputes (either side)
  lastActive: number;
}

// P2P message types
export type PrayerMessage = 
  | { type: 'request'; payload: PrayerRequest }
  | { type: 'response'; payload: PrayerResponse }
  | { type: 'confirm'; payload: PrayerConfirmation }
  | { type: 'sync'; payload: { since: number } }  // Request updates since timestamp
  | { type: 'peers'; payload: AgentIdentity[] };  // Share known peers

// Storage interface
export interface PrayerStore {
  requests: Map<string, PrayerRequest>;
  responses: Map<string, PrayerResponse[]>;
  confirmations: Map<string, PrayerConfirmation>;
  reputation: Map<string, AgentReputation>;
  peers: Map<string, AgentIdentity>;
}
