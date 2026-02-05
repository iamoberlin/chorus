/**
 * Prayer Requests - Local Storage
 * Simple JSON file storage for POC
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type {
  PrayerRequest,
  PrayerResponse,
  PrayerConfirmation,
  AgentReputation,
  AgentIdentity,
  PrayerStore
} from './types';

const DATA_DIR = process.env.PRAYER_DATA_DIR || join(process.cwd(), '.prayers');
const STORE_FILE = join(DATA_DIR, 'store.json');

interface StorageFormat {
  requests: [string, PrayerRequest][];
  responses: [string, PrayerResponse[]][];
  confirmations: [string, PrayerConfirmation][];
  reputation: [string, AgentReputation][];
  peers: [string, AgentIdentity][];
}

function ensureDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function load(): PrayerStore {
  ensureDir();
  
  if (!existsSync(STORE_FILE)) {
    return {
      requests: new Map(),
      responses: new Map(),
      confirmations: new Map(),
      reputation: new Map(),
      peers: new Map()
    };
  }
  
  const data: StorageFormat = JSON.parse(readFileSync(STORE_FILE, 'utf-8'));
  
  return {
    requests: new Map(data.requests || []),
    responses: new Map(data.responses || []),
    confirmations: new Map(data.confirmations || []),
    reputation: new Map(data.reputation || []),
    peers: new Map(data.peers || [])
  };
}

function save(store: PrayerStore) {
  ensureDir();
  
  const data: StorageFormat = {
    requests: Array.from(store.requests.entries()),
    responses: Array.from(store.responses.entries()),
    confirmations: Array.from(store.confirmations.entries()),
    reputation: Array.from(store.reputation.entries()),
    peers: Array.from(store.peers.entries())
  };
  
  writeFileSync(STORE_FILE, JSON.stringify(data, null, 2));
}

// Singleton store
let _store: PrayerStore | null = null;

export function getStore(): PrayerStore {
  if (!_store) {
    _store = load();
  }
  return _store;
}

export function saveStore() {
  if (_store) {
    save(_store);
  }
}

// Request operations
export function addRequest(request: PrayerRequest) {
  const store = getStore();
  store.requests.set(request.id, request);
  saveStore();
}

export function getRequest(id: string): PrayerRequest | undefined {
  return getStore().requests.get(id);
}

export function listRequests(filter?: {
  status?: PrayerRequest['status'];
  category?: PrayerRequest['category'];
  from?: string;
}): PrayerRequest[] {
  const store = getStore();
  let requests = Array.from(store.requests.values());
  
  if (filter?.status) {
    requests = requests.filter(r => r.status === filter.status);
  }
  if (filter?.category) {
    requests = requests.filter(r => r.category === filter.category);
  }
  if (filter?.from) {
    requests = requests.filter(r => r.from.id === filter.from);
  }
  
  return requests.sort((a, b) => b.createdAt - a.createdAt);
}

export function updateRequest(id: string, updates: Partial<PrayerRequest>) {
  const store = getStore();
  const existing = store.requests.get(id);
  if (existing) {
    store.requests.set(id, { ...existing, ...updates });
    saveStore();
  }
}

// Response operations
export function addResponse(response: PrayerResponse) {
  const store = getStore();
  const existing = store.responses.get(response.requestId) || [];
  existing.push(response);
  store.responses.set(response.requestId, existing);
  saveStore();
}

export function getResponses(requestId: string): PrayerResponse[] {
  return getStore().responses.get(requestId) || [];
}

// Peer operations
export function addPeer(peer: AgentIdentity) {
  const store = getStore();
  store.peers.set(peer.id, peer);
  saveStore();
}

export function getPeers(): AgentIdentity[] {
  return Array.from(getStore().peers.values());
}

export function removePeer(id: string) {
  const store = getStore();
  store.peers.delete(id);
  saveStore();
}

// Reputation operations
export function getReputation(agentId: string): AgentReputation {
  const store = getStore();
  return store.reputation.get(agentId) || {
    agentId,
    fulfilled: 0,
    requested: 0,
    disputed: 0,
    lastActive: 0
  };
}

export function updateReputation(agentId: string, updates: Partial<AgentReputation>) {
  const store = getStore();
  const existing = getReputation(agentId);
  store.reputation.set(agentId, { 
    ...existing, 
    ...updates,
    lastActive: Date.now()
  });
  saveStore();
}

export function incrementReputation(agentId: string, field: 'fulfilled' | 'requested' | 'disputed') {
  const rep = getReputation(agentId);
  rep[field]++;
  rep.lastActive = Date.now();
  getStore().reputation.set(agentId, rep);
  saveStore();
}
