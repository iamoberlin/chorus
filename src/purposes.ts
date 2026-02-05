/**
 * CHORUS Purposes System
 *
 * Manage purposes that drive autonomous behavior.
 * Biblical framing: The choirs serve the Purposes.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { dirname } from "path";
import { getPurposesPath } from "./senses.js";

export interface PurposeResearchConfig {
  enabled: boolean;
  domains?: string[];
  frequency?: number;
  maxFrequency?: number;
  alertThreshold?: "low" | "medium" | "high";
  lastRun?: number;
  runCount?: number;
}

export interface Purpose {
  id: string;
  name: string;
  description?: string;
  deadline?: number | string;  // Unix ms or ISO string
  progress: number;            // 0-100
  criteria?: string[];         // Success criteria
  lastWorkedOn?: number | string;
  curiosity?: number;          // 0-100, for exploration purposes
  tags?: string[];
  notes?: string;
  research?: PurposeResearchConfig;
}

async function ensurePurposesFile(): Promise<boolean> {
  try {
    const path = getPurposesPath();
    if (!existsSync(path)) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "[]");
    }
    return true;
  } catch {
    return false;
  }
}

export async function loadPurposes(): Promise<Purpose[]> {
  await ensurePurposesFile();
  try {
    const data = await readFile(getPurposesPath(), "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export async function savePurposes(purposes: Purpose[]): Promise<void> {
  try {
    await ensurePurposesFile();
    await writeFile(getPurposesPath(), JSON.stringify(purposes, null, 2));
  } catch {
    // Silently fail - caller should handle missing saves
  }
}

export async function addPurpose(purpose: Partial<Purpose> & { id: string; name: string }): Promise<Purpose> {
  const purposes = await loadPurposes();
  
  // Check for duplicate id
  if (purposes.find(p => p.id === purpose.id)) {
    throw new Error(`Purpose with id "${purpose.id}" already exists`);
  }

  const newPurpose: Purpose = {
    id: purpose.id,
    name: purpose.name,
    description: purpose.description,
    deadline: purpose.deadline,
    progress: purpose.progress ?? 0,
    criteria: purpose.criteria,
    curiosity: purpose.curiosity,
    tags: purpose.tags,
    notes: purpose.notes,
    research: purpose.research,
  };

  purposes.push(newPurpose);
  await savePurposes(purposes);
  return newPurpose;
}

export async function updatePurpose(id: string, updates: Partial<Purpose>): Promise<Purpose | null> {
  const purposes = await loadPurposes();
  const index = purposes.findIndex(p => p.id === id);
  
  if (index === -1) return null;

  // Update lastWorkedOn if progress changed
  if (updates.progress !== undefined && updates.progress !== purposes[index].progress) {
    updates.lastWorkedOn = Date.now();
  }

  purposes[index] = { ...purposes[index], ...updates };
  await savePurposes(purposes);
  return purposes[index];
}

export async function removePurpose(id: string): Promise<boolean> {
  const purposes = await loadPurposes();
  const index = purposes.findIndex(p => p.id === id);
  
  if (index === -1) return false;

  purposes.splice(index, 1);
  await savePurposes(purposes);
  return true;
}

export async function getPurpose(id: string): Promise<Purpose | null> {
  const purposes = await loadPurposes();
  return purposes.find(p => p.id === id) || null;
}

export function formatPurpose(purpose: Purpose): string {
  const lines: string[] = [];
  
  // Progress bar
  const filled = Math.round(purpose.progress / 5);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  
  lines.push(`${purpose.name} [${bar}] ${purpose.progress}%`);
  
  if (purpose.deadline) {
    const deadline = typeof purpose.deadline === "string" 
      ? new Date(purpose.deadline) 
      : new Date(purpose.deadline);
    const daysLeft = (deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    
    if (daysLeft < 0) {
      lines.push(`  ⚠️  OVERDUE by ${Math.abs(daysLeft).toFixed(0)} days`);
    } else if (daysLeft < 1) {
      lines.push(`  ⏰ Due in ${(daysLeft * 24).toFixed(0)} hours`);
    } else {
      lines.push(`  📅 Due in ${daysLeft.toFixed(0)} days (${deadline.toLocaleDateString()})`);
    }
  }
  
  if (purpose.description) {
    lines.push(`  ${purpose.description}`);
  }
  
  if (purpose.criteria && purpose.criteria.length > 0) {
    lines.push("  Criteria:");
    for (const c of purpose.criteria) {
      lines.push(`    • ${c}`);
    }
  }
  
  return lines.join("\n");
}

export function formatPurposesList(purposes: Purpose[]): string {
  if (purposes.length === 0) {
    return "No purposes set. Use `openclaw chorus purpose add` to create one.";
  }

  // Sort by deadline (soonest first), then by progress (lowest first)
  const sorted = [...purposes].sort((a, b) => {
    const aDeadline = a.deadline ? (typeof a.deadline === "string" ? Date.parse(a.deadline) : a.deadline) : Infinity;
    const bDeadline = b.deadline ? (typeof b.deadline === "string" ? Date.parse(b.deadline) : b.deadline) : Infinity;
    
    if (aDeadline !== bDeadline) return aDeadline - bDeadline;
    return a.progress - b.progress;
  });

  const lines: string[] = ["✝️ Purposes", "═".repeat(50), ""];
  
  for (const purpose of sorted) {
    lines.push(formatPurpose(purpose));
    lines.push("");
  }

  return lines.join("\n");
}
