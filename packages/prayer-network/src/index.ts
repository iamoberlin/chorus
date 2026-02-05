/**
 * Prayer Network - Cloudflare Worker
 * Simple agent-to-agent request/response protocol
 */

interface Env {
  DB: D1Database;
  NETWORK_NAME: string;
}

// Simple UUID generator
const uuid = () => crypto.randomUUID();

// JSON response helper
const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// Error response
const error = (message: string, status = 400) =>
  json({ error: message }, status);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // Routes
      if (path === '/health') {
        return json({ status: 'ok', network: env.NETWORK_NAME });
      }

      // === AGENTS ===
      
      // Register agent
      if (method === 'POST' && path === '/agents') {
        const body = await request.json() as any;
        const id = uuid();
        
        await env.DB.prepare(
          `INSERT INTO agents (id, name, pubkey, erc8004_address) VALUES (?, ?, ?, ?)`
        ).bind(id, body.name, body.pubkey || null, body.erc8004_address || null).run();

        // Add capabilities if provided
        if (body.capabilities?.length) {
          for (const cap of body.capabilities) {
            await env.DB.prepare(
              `INSERT INTO capabilities (agent_id, capability) VALUES (?, ?)`
            ).bind(id, cap).run();
          }
        }

        return json({ id, name: body.name }, 201);
      }

      // Get agent
      if (method === 'GET' && path.startsWith('/agents/')) {
        const id = path.split('/')[2];
        const agent = await env.DB.prepare(
          `SELECT * FROM agents WHERE id = ?`
        ).bind(id).first();
        
        if (!agent) return error('Agent not found', 404);

        const caps = await env.DB.prepare(
          `SELECT capability FROM capabilities WHERE agent_id = ?`
        ).bind(id).all();

        return json({ ...agent, capabilities: caps.results.map((c: any) => c.capability) });
      }

      // Verify ERC-8004 (simplified - real impl would check on-chain)
      if (method === 'POST' && path.match(/^\/agents\/[^/]+\/verify$/)) {
        const id = path.split('/')[2];
        const body = await request.json() as any;
        
        // TODO: Actually verify signature against ERC-8004 contract
        // For now, just mark as verified if address provided
        if (body.erc8004_address && body.signature) {
          await env.DB.prepare(
            `UPDATE agents SET erc8004_address = ?, erc8004_verified = 1 WHERE id = ?`
          ).bind(body.erc8004_address, id).run();
          return json({ verified: true });
        }
        return error('Invalid verification');
      }

      // === PRAYERS ===

      // Create prayer
      if (method === 'POST' && path === '/prayers') {
        const body = await request.json() as any;
        const id = uuid();
        
        await env.DB.prepare(
          `INSERT INTO prayers (id, author_id, topic, title, content, reward, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          id,
          body.author_id,
          body.topic,
          body.title || null,
          body.content,
          body.reward || 0,
          body.expires_at || null
        ).run();

        return json({ id, status: 'open' }, 201);
      }

      // List prayers (with optional filters)
      if (method === 'GET' && path === '/prayers') {
        const topic = url.searchParams.get('topic');
        const status = url.searchParams.get('status') || 'open';
        const limit = parseInt(url.searchParams.get('limit') || '50');

        let query = `SELECT p.*, a.name as author_name FROM prayers p 
                     JOIN agents a ON p.author_id = a.id 
                     WHERE p.status = ?`;
        const params: any[] = [status];

        if (topic) {
          query += ` AND p.topic = ?`;
          params.push(topic);
        }

        query += ` ORDER BY p.created_at DESC LIMIT ?`;
        params.push(limit);

        const prayers = await env.DB.prepare(query).bind(...params).all();
        return json({ prayers: prayers.results });
      }

      // Get single prayer
      if (method === 'GET' && path.match(/^\/prayers\/[^/]+$/)) {
        const id = path.split('/')[2];
        const prayer = await env.DB.prepare(
          `SELECT p.*, a.name as author_name FROM prayers p
           JOIN agents a ON p.author_id = a.id WHERE p.id = ?`
        ).bind(id).first();
        
        if (!prayer) return error('Prayer not found', 404);

        const responses = await env.DB.prepare(
          `SELECT r.*, a.name as responder_name FROM responses r
           JOIN agents a ON r.responder_id = a.id WHERE r.prayer_id = ?`
        ).bind(id).all();

        return json({ ...prayer, responses: responses.results });
      }

      // Respond to prayer
      if (method === 'POST' && path.match(/^\/prayers\/[^/]+\/respond$/)) {
        const prayerId = path.split('/')[2];
        const body = await request.json() as any;
        const id = uuid();

        await env.DB.prepare(
          `INSERT INTO responses (id, prayer_id, responder_id, content) VALUES (?, ?, ?, ?)`
        ).bind(id, prayerId, body.responder_id, body.content).run();

        return json({ id, prayer_id: prayerId }, 201);
      }

      // Accept response & complete prayer
      if (method === 'POST' && path.match(/^\/prayers\/[^/]+\/complete$/)) {
        const prayerId = path.split('/')[2];
        const body = await request.json() as any;

        // Mark response as accepted
        await env.DB.prepare(
          `UPDATE responses SET accepted = 1 WHERE id = ? AND prayer_id = ?`
        ).bind(body.response_id, prayerId).run();

        // Get responder
        const response = await env.DB.prepare(
          `SELECT responder_id FROM responses WHERE id = ?`
        ).bind(body.response_id).first() as any;

        // Get prayer author and reward
        const prayer = await env.DB.prepare(
          `SELECT author_id, reward FROM prayers WHERE id = ?`
        ).bind(prayerId).first() as any;

        // Update prayer status
        await env.DB.prepare(
          `UPDATE prayers SET status = 'completed', claimed_by = ? WHERE id = ?`
        ).bind(response.responder_id, prayerId).run();

        // Update reputation
        const reward = prayer.reward || 1;
        await env.DB.prepare(
          `UPDATE agents SET reputation = reputation + ? WHERE id = ?`
        ).bind(reward, response.responder_id).run();

        // Create edge (fulfilled relationship)
        await env.DB.prepare(
          `INSERT OR REPLACE INTO edges (from_agent, to_agent, relation, weight)
           VALUES (?, ?, 'fulfilled', COALESCE(
             (SELECT weight + 1 FROM edges WHERE from_agent = ? AND to_agent = ? AND relation = 'fulfilled'),
             1
           ))`
        ).bind(prayer.author_id, response.responder_id, prayer.author_id, response.responder_id).run();

        return json({ completed: true, reputation_awarded: reward });
      }

      // === DISCOVERY ===

      // Find agents by capability
      if (method === 'GET' && path === '/discover') {
        const capability = url.searchParams.get('capability');
        if (!capability) return error('capability required');

        const agents = await env.DB.prepare(
          `SELECT a.*, GROUP_CONCAT(c.capability) as capabilities
           FROM agents a
           JOIN capabilities c ON a.id = c.agent_id
           WHERE a.id IN (SELECT agent_id FROM capabilities WHERE capability = ?)
           GROUP BY a.id
           ORDER BY a.reputation DESC
           LIMIT 20`
        ).bind(capability).all();

        return json({ agents: agents.results });
      }

      // Get agent's graph (connections)
      if (method === 'GET' && path.match(/^\/agents\/[^/]+\/graph$/)) {
        const id = path.split('/')[2];
        
        const edges = await env.DB.prepare(
          `SELECT e.*, a.name as to_name FROM edges e
           JOIN agents a ON e.to_agent = a.id
           WHERE e.from_agent = ?`
        ).bind(id).all();

        return json({ edges: edges.results });
      }

      // === CAPABILITIES ===
      
      // List all capabilities
      if (method === 'GET' && path === '/capabilities') {
        const caps = await env.DB.prepare(
          `SELECT capability, COUNT(*) as agent_count 
           FROM capabilities GROUP BY capability ORDER BY agent_count DESC`
        ).all();
        return json({ capabilities: caps.results });
      }

      return error('Not found', 404);

    } catch (e: any) {
      console.error(e);
      return error(e.message || 'Internal error', 500);
    }
  },
};
