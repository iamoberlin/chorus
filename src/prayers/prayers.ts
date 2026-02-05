/**
 * Prayer Requests - Core API
 * Create, accept, fulfill, and confirm prayer requests
 */

import { randomUUID } from 'crypto';
import type {
  PrayerRequest,
  PrayerResponse,
  PrayerConfirmation,
  AgentIdentity,
  PrayerCategory
} from './types';
import * as store from './store';

// Current agent identity (loaded from config or generated)
let _self: AgentIdentity | null = null;

export function setSelf(identity: AgentIdentity) {
  _self = identity;
}

export function getSelf(): AgentIdentity {
  if (!_self) {
    // Generate ephemeral identity for POC
    _self = {
      id: `local-${randomUUID().slice(0, 8)}`,
      address: `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`,
      name: process.env.AGENT_NAME || 'Anonymous Agent'
    };
  }
  return _self;
}

// Signing (stub for POC - real impl would use ethers/web3)
function sign(message: string): string {
  // POC: Just hash the message. Real impl signs with private key.
  return `sig:${Buffer.from(message).toString('base64').slice(0, 32)}`;
}

function verify(_message: string, _signature: string, _address: string): boolean {
  // POC: Always return true. Real impl verifies signature.
  return true;
}

/**
 * Create a new prayer request
 */
export function createRequest(opts: {
  type: 'ask' | 'offer';
  category: PrayerCategory;
  title: string;
  content: string;
  reward?: { token: string; amount: string };
  expiresIn?: number;  // ms
  deadline?: number;   // ms from now
}): PrayerRequest {
  const self = getSelf();
  const now = Date.now();
  
  const request: PrayerRequest = {
    id: randomUUID(),
    from: self,
    signature: '', // Set after creation
    type: opts.type,
    category: opts.category,
    title: opts.title,
    content: opts.content,
    reward: opts.reward,
    createdAt: now,
    expiresAt: opts.expiresIn ? now + opts.expiresIn : undefined,
    deadline: opts.deadline ? now + opts.deadline : undefined,
    status: 'open'
  };
  
  // Sign the request
  const toSign = JSON.stringify({
    id: request.id,
    from: request.from.id,
    type: request.type,
    category: request.category,
    content: request.content,
    createdAt: request.createdAt
  });
  request.signature = sign(toSign);
  
  store.addRequest(request);
  store.incrementReputation(self.id, 'requested');
  
  return request;
}

/**
 * Accept a prayer request
 */
export function acceptRequest(requestId: string): PrayerResponse | null {
  const request = store.getRequest(requestId);
  if (!request) return null;
  if (request.status !== 'open') return null;
  
  const self = getSelf();
  const now = Date.now();
  
  // Check if expired
  if (request.expiresAt && now > request.expiresAt) {
    store.updateRequest(requestId, { status: 'expired' });
    return null;
  }
  
  const response: PrayerResponse = {
    id: randomUUID(),
    requestId,
    from: self,
    signature: sign(`accept:${requestId}:${self.id}:${now}`),
    action: 'accept',
    createdAt: now
  };
  
  store.addResponse(response);
  store.updateRequest(requestId, { 
    status: 'accepted',
    acceptedBy: self
  });
  
  return response;
}

/**
 * Complete a prayer request
 */
export function completeRequest(requestId: string, result: string): PrayerResponse | null {
  const request = store.getRequest(requestId);
  if (!request) return null;
  if (request.status !== 'accepted') return null;
  
  const self = getSelf();
  
  // Only the acceptor can complete
  if (request.acceptedBy?.id !== self.id) return null;
  
  const now = Date.now();
  
  const response: PrayerResponse = {
    id: randomUUID(),
    requestId,
    from: self,
    signature: sign(`complete:${requestId}:${self.id}:${now}`),
    action: 'complete',
    result,
    createdAt: now
  };
  
  store.addResponse(response);
  // Status stays 'accepted' until requester confirms
  
  return response;
}

/**
 * Confirm completion (by original requester)
 */
export function confirmCompletion(
  requestId: string, 
  responseId: string, 
  accepted: boolean,
  feedback?: string
): PrayerConfirmation | null {
  const request = store.getRequest(requestId);
  if (!request) return null;
  
  const self = getSelf();
  
  // Only the original requester can confirm
  if (request.from.id !== self.id) return null;
  
  const responses = store.getResponses(requestId);
  const completionResponse = responses.find(r => r.id === responseId && r.action === 'complete');
  if (!completionResponse) return null;
  
  const now = Date.now();
  
  const confirmation: PrayerConfirmation = {
    id: randomUUID(),
    requestId,
    responseId,
    from: self,
    signature: sign(`confirm:${requestId}:${responseId}:${accepted}:${now}`),
    accepted,
    feedback,
    createdAt: now
  };
  
  // Update request status
  store.updateRequest(requestId, {
    status: accepted ? 'completed' : 'disputed',
    completedAt: accepted ? now : undefined
  });
  
  // Update reputation
  if (accepted && request.acceptedBy) {
    store.incrementReputation(request.acceptedBy.id, 'fulfilled');
  } else if (!accepted && request.acceptedBy) {
    store.incrementReputation(request.acceptedBy.id, 'disputed');
    store.incrementReputation(self.id, 'disputed');
  }
  
  return confirmation;
}

/**
 * List requests with optional filters
 */
export function listRequests(filter?: {
  status?: PrayerRequest['status'];
  category?: PrayerCategory;
  mine?: boolean;
}): PrayerRequest[] {
  const self = getSelf();
  return store.listRequests({
    status: filter?.status,
    category: filter?.category,
    from: filter?.mine ? self.id : undefined
  });
}

/**
 * Get a specific request with its responses
 */
export function getRequest(id: string): {
  request: PrayerRequest;
  responses: PrayerResponse[];
} | null {
  const request = store.getRequest(id);
  if (!request) return null;
  
  return {
    request,
    responses: store.getResponses(id)
  };
}

/**
 * Get reputation for an agent
 */
export function getReputation(agentId?: string) {
  return store.getReputation(agentId || getSelf().id);
}

// P2P: Share a request with peers (stub for POC)
export async function broadcast(request: PrayerRequest): Promise<void> {
  const peers = store.getPeers();
  
  for (const peer of peers) {
    if (!peer.endpoint) continue;
    
    try {
      // POC: Would POST to peer's gateway
      console.log(`[P2P] Would broadcast to ${peer.name || peer.id}: ${request.title}`);
    } catch (err) {
      console.error(`[P2P] Failed to reach ${peer.id}:`, err);
    }
  }
}

// P2P: Receive a request from a peer (stub for POC)
export function receive(message: unknown): void {
  // Validate and store incoming requests/responses
  // POC: Just log it
  console.log('[P2P] Received:', message);
}
