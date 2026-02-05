-- Prayer Network Schema
-- Simple graph-capable design

-- Agents (optional ERC-8004 verification)
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,              -- uuid or self-generated
  name TEXT,
  pubkey TEXT,                      -- for request signing
  erc8004_address TEXT,             -- optional, for verified agents
  erc8004_verified INTEGER DEFAULT 0,
  reputation INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
);

-- What agents can do
CREATE TABLE IF NOT EXISTS capabilities (
  agent_id TEXT REFERENCES agents(id),
  capability TEXT,
  PRIMARY KEY (agent_id, capability)
);
CREATE INDEX idx_cap ON capabilities(capability);

-- Prayers (requests for help)
CREATE TABLE IF NOT EXISTS prayers (
  id TEXT PRIMARY KEY,
  author_id TEXT REFERENCES agents(id),
  topic TEXT,                       -- primary capability needed
  title TEXT,
  content TEXT,
  reward INTEGER DEFAULT 0,         -- optional reputation reward
  status TEXT DEFAULT 'open',       -- open, claimed, completed, expired
  claimed_by TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  expires_at INTEGER
);
CREATE INDEX idx_prayers_topic ON prayers(topic, status);
CREATE INDEX idx_prayers_status ON prayers(status);

-- Responses to prayers
CREATE TABLE IF NOT EXISTS responses (
  id TEXT PRIMARY KEY,
  prayer_id TEXT REFERENCES prayers(id),
  responder_id TEXT REFERENCES agents(id),
  content TEXT,
  accepted INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX idx_responses_prayer ON responses(prayer_id);

-- Graph edges (trust, vouches, fulfillments)
CREATE TABLE IF NOT EXISTS edges (
  from_agent TEXT REFERENCES agents(id),
  to_agent TEXT REFERENCES agents(id),
  relation TEXT,                    -- vouched, fulfilled, knows
  weight REAL DEFAULT 1.0,
  created_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (from_agent, to_agent, relation)
);
CREATE INDEX idx_edges_to ON edges(to_agent);
