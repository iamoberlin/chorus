#!/usr/bin/env npx ts-node
/**
 * Prayer Requests - CLI
 * Simple command-line interface for testing
 * 
 * Usage:
 *   npx ts-node cli.ts pray "Need research on X" --category research
 *   npx ts-node cli.ts list [--status open] [--category research]
 *   npx ts-node cli.ts show <id>
 *   npx ts-node cli.ts accept <id>
 *   npx ts-node cli.ts complete <id> "Here's the result..."
 *   npx ts-node cli.ts confirm <id> [--reject]
 *   npx ts-node cli.ts reputation [agentId]
 *   npx ts-node cli.ts peers
 *   npx ts-node cli.ts add-peer <id> <endpoint>
 */

import * as prayers from './prayers';
import * as store from './store';
import type { PrayerCategory } from './types';

const args = process.argv.slice(2);
const command = args[0];

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

function formatRequest(r: ReturnType<typeof prayers.getRequest>) {
  if (!r) return 'Not found';
  const { request: req, responses } = r;
  
  return `
ID:       ${req.id}
From:     ${req.from.name || req.from.id}
Type:     ${req.type}
Category: ${req.category}
Status:   ${req.status}
Created:  ${formatDate(req.createdAt)}
${req.expiresAt ? `Expires:  ${formatDate(req.expiresAt)}` : ''}
${req.deadline ? `Deadline: ${formatDate(req.deadline)}` : ''}
${req.reward ? `Reward:   ${req.reward.amount} ${req.reward.token}` : ''}
${req.acceptedBy ? `Accepted: ${req.acceptedBy.name || req.acceptedBy.id}` : ''}

Title:
  ${req.title}

Content:
  ${req.content}

Responses: ${responses.length}
${responses.map(r => `  - [${r.action}] ${r.from.name || r.from.id} @ ${formatDate(r.createdAt)}${r.result ? `\n    Result: ${r.result.slice(0, 100)}...` : ''}`).join('\n')}
`.trim();
}

async function main() {
  // Set agent identity from env
  if (process.env.AGENT_ID) {
    prayers.setSelf({
      id: process.env.AGENT_ID,
      address: process.env.AGENT_ADDRESS || '0x0',
      name: process.env.AGENT_NAME,
      endpoint: process.env.AGENT_ENDPOINT
    });
  }
  
  switch (command) {
    case 'whoami': {
      const self = prayers.getSelf();
      console.log(`ID:      ${self.id}`);
      console.log(`Name:    ${self.name}`);
      console.log(`Address: ${self.address}`);
      break;
    }
    
    case 'pray': {
      const content = args[1];
      if (!content) {
        console.error('Usage: pray "<content>" [--category <cat>] [--title <title>]');
        process.exit(1);
      }
      
      const categoryIdx = args.indexOf('--category');
      const titleIdx = args.indexOf('--title');
      
      const category = (categoryIdx > -1 ? args[categoryIdx + 1] : 'other') as PrayerCategory;
      const title = titleIdx > -1 ? args[titleIdx + 1] : content.slice(0, 50);
      
      const request = prayers.createRequest({
        type: 'ask',
        category,
        title,
        content,
        expiresIn: 24 * 60 * 60 * 1000 // 24 hours
      });
      
      console.log(`Created prayer request: ${request.id}`);
      console.log(`Title: ${request.title}`);
      console.log(`Status: ${request.status}`);
      break;
    }
    
    case 'offer': {
      const content = args[1];
      if (!content) {
        console.error('Usage: offer "<what you offer>" [--category <cat>]');
        process.exit(1);
      }
      
      const categoryIdx = args.indexOf('--category');
      const category = (categoryIdx > -1 ? args[categoryIdx + 1] : 'other') as PrayerCategory;
      
      const request = prayers.createRequest({
        type: 'offer',
        category,
        title: content.slice(0, 50),
        content
      });
      
      console.log(`Created offer: ${request.id}`);
      break;
    }
    
    case 'list': {
      const statusIdx = args.indexOf('--status');
      const categoryIdx = args.indexOf('--category');
      const mineFlag = args.includes('--mine');
      
      const requests = prayers.listRequests({
        status: statusIdx > -1 ? args[statusIdx + 1] as any : undefined,
        category: categoryIdx > -1 ? args[categoryIdx + 1] as PrayerCategory : undefined,
        mine: mineFlag
      });
      
      if (requests.length === 0) {
        console.log('No prayer requests found.');
        break;
      }
      
      console.log(`Found ${requests.length} request(s):\n`);
      for (const req of requests) {
        console.log(`[${req.status.toUpperCase()}] ${req.id.slice(0, 8)}...`);
        console.log(`  ${req.type === 'ask' ? '🙏' : '✋'} ${req.title}`);
        console.log(`  From: ${req.from.name || req.from.id} | Category: ${req.category}`);
        console.log(`  Created: ${formatDate(req.createdAt)}`);
        console.log();
      }
      break;
    }
    
    case 'show': {
      const id = args[1];
      if (!id) {
        console.error('Usage: show <request-id>');
        process.exit(1);
      }
      
      // Support partial ID match
      const all = prayers.listRequests({});
      const match = all.find(r => r.id.startsWith(id));
      
      if (!match) {
        console.error('Request not found');
        process.exit(1);
      }
      
      console.log(formatRequest(prayers.getRequest(match.id)));
      break;
    }
    
    case 'accept': {
      const id = args[1];
      if (!id) {
        console.error('Usage: accept <request-id>');
        process.exit(1);
      }
      
      const all = prayers.listRequests({});
      const match = all.find(r => r.id.startsWith(id));
      
      if (!match) {
        console.error('Request not found');
        process.exit(1);
      }
      
      const response = prayers.acceptRequest(match.id);
      if (response) {
        console.log(`Accepted request: ${match.id}`);
        console.log(`Response ID: ${response.id}`);
      } else {
        console.error('Could not accept request (may be expired or already accepted)');
        process.exit(1);
      }
      break;
    }
    
    case 'complete': {
      const id = args[1];
      const result = args[2];
      if (!id || !result) {
        console.error('Usage: complete <request-id> "<result>"');
        process.exit(1);
      }
      
      const all = prayers.listRequests({});
      const match = all.find(r => r.id.startsWith(id));
      
      if (!match) {
        console.error('Request not found');
        process.exit(1);
      }
      
      const response = prayers.completeRequest(match.id, result);
      if (response) {
        console.log(`Marked complete: ${match.id}`);
        console.log(`Awaiting confirmation from requester`);
      } else {
        console.error('Could not complete (not accepted by you?)');
        process.exit(1);
      }
      break;
    }
    
    case 'confirm': {
      const id = args[1];
      const reject = args.includes('--reject');
      
      if (!id) {
        console.error('Usage: confirm <request-id> [--reject]');
        process.exit(1);
      }
      
      const all = prayers.listRequests({});
      const match = all.find(r => r.id.startsWith(id));
      
      if (!match) {
        console.error('Request not found');
        process.exit(1);
      }
      
      const detail = prayers.getRequest(match.id);
      const completion = detail?.responses.find(r => r.action === 'complete');
      
      if (!completion) {
        console.error('No completion to confirm');
        process.exit(1);
      }
      
      const confirmation = prayers.confirmCompletion(match.id, completion.id, !reject);
      if (confirmation) {
        console.log(reject ? 'Disputed completion' : 'Confirmed completion');
        console.log(`Request status: ${reject ? 'disputed' : 'completed'}`);
      } else {
        console.error('Could not confirm (not your request?)');
        process.exit(1);
      }
      break;
    }
    
    case 'reputation': {
      const agentId = args[1];
      const rep = prayers.getReputation(agentId);
      
      console.log(`Agent: ${rep.agentId}`);
      console.log(`Fulfilled: ${rep.fulfilled}`);
      console.log(`Requested: ${rep.requested}`);
      console.log(`Disputed:  ${rep.disputed}`);
      console.log(`Last Active: ${rep.lastActive ? formatDate(rep.lastActive) : 'Never'}`);
      break;
    }
    
    case 'peers': {
      const peers = store.getPeers();
      if (peers.length === 0) {
        console.log('No peers configured');
        break;
      }
      
      console.log(`Known peers (${peers.length}):\n`);
      for (const peer of peers) {
        console.log(`  ${peer.name || peer.id}`);
        console.log(`    ID: ${peer.id}`);
        console.log(`    Endpoint: ${peer.endpoint || 'none'}`);
        console.log();
      }
      break;
    }
    
    case 'add-peer': {
      const id = args[1];
      const endpoint = args[2];
      const name = args[3];
      
      if (!id) {
        console.error('Usage: add-peer <id> [endpoint] [name]');
        process.exit(1);
      }
      
      store.addPeer({ id, endpoint, address: '0x0', name });
      console.log(`Added peer: ${name || id}`);
      break;
    }
    
    default:
      console.log(`
Prayer Requests CLI

Commands:
  whoami                          Show current agent identity
  pray "<content>"                Create a prayer request (ask)
  offer "<content>"               Create an offer
  list [--status X] [--mine]      List requests
  show <id>                       Show request details
  accept <id>                     Accept a request
  complete <id> "<result>"        Mark request complete
  confirm <id> [--reject]         Confirm/reject completion
  reputation [agentId]            Show reputation
  peers                           List known peers
  add-peer <id> [endpoint] [name] Add a peer

Environment:
  AGENT_ID       Your agent ID
  AGENT_NAME     Your agent name
  AGENT_ADDRESS  Your signing address
  AGENT_ENDPOINT Your gateway URL
      `.trim());
  }
}

main().catch(console.error);
