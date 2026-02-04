/**
 * CHORUS Goals System
 *
 * Manage goals that drive autonomous behavior.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { dirname } from "path";
import { getGoalsPath } from "./senses.js";

export interface GoalResearchConfig {
  enabled: boolean;
  domains?: string[];
  frequency?: number;
  maxFrequency?: number;
  alertThreshold?: "low" | "medium" | "high";
  lastRun?: number;
  runCount?: number;
}

export interface Goal {
  id: string;
  name: string;
  description?: string;
  deadline?: number | string;  // Unix ms or ISO string
  progress: number;            // 0-100
  criteria?: string[];         // Success criteria
  lastWorkedOn?: number | string;
  curiosity?: number;          // 0-100, for exploration goals
  tags?: string[];
  notes?: string;
  research?: GoalResearchConfig;
}

async function ensureGoalsFile(): Promise<void> {
  const path = getGoalsPath();
  if (!existsSync(path)) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "[]");
  }
}

export async function loadGoals(): Promise<Goal[]> {
  await ensureGoalsFile();
  try {
    const data = await readFile(getGoalsPath(), "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export async function saveGoals(goals: Goal[]): Promise<void> {
  await ensureGoalsFile();
  await writeFile(getGoalsPath(), JSON.stringify(goals, null, 2));
}

export async function addGoal(goal: Partial<Goal> & { id: string; name: string }): Promise<Goal> {
  const goals = await loadGoals();
  
  // Check for duplicate id
  if (goals.find(g => g.id === goal.id)) {
    throw new Error(`Goal with id "${goal.id}" already exists`);
  }

  const newGoal: Goal = {
    id: goal.id,
    name: goal.name,
    description: goal.description,
    deadline: goal.deadline,
    progress: goal.progress ?? 0,
    criteria: goal.criteria,
    curiosity: goal.curiosity,
    tags: goal.tags,
    notes: goal.notes,
    research: goal.research,
  };

  goals.push(newGoal);
  await saveGoals(goals);
  return newGoal;
}

export async function updateGoal(id: string, updates: Partial<Goal>): Promise<Goal | null> {
  const goals = await loadGoals();
  const index = goals.findIndex(g => g.id === id);
  
  if (index === -1) return null;

  // Update lastWorkedOn if progress changed
  if (updates.progress !== undefined && updates.progress !== goals[index].progress) {
    updates.lastWorkedOn = Date.now();
  }

  goals[index] = { ...goals[index], ...updates };
  await saveGoals(goals);
  return goals[index];
}

export async function removeGoal(id: string): Promise<boolean> {
  const goals = await loadGoals();
  const index = goals.findIndex(g => g.id === id);
  
  if (index === -1) return false;

  goals.splice(index, 1);
  await saveGoals(goals);
  return true;
}

export async function getGoal(id: string): Promise<Goal | null> {
  const goals = await loadGoals();
  return goals.find(g => g.id === id) || null;
}

export function formatGoal(goal: Goal): string {
  const lines: string[] = [];
  
  // Progress bar
  const filled = Math.round(goal.progress / 5);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  
  lines.push(`${goal.name} [${bar}] ${goal.progress}%`);
  
  if (goal.deadline) {
    const deadline = typeof goal.deadline === "string" 
      ? new Date(goal.deadline) 
      : new Date(goal.deadline);
    const daysLeft = (deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    
    if (daysLeft < 0) {
      lines.push(`  ⚠️  OVERDUE by ${Math.abs(daysLeft).toFixed(0)} days`);
    } else if (daysLeft < 1) {
      lines.push(`  ⏰ Due in ${(daysLeft * 24).toFixed(0)} hours`);
    } else {
      lines.push(`  📅 Due in ${daysLeft.toFixed(0)} days (${deadline.toLocaleDateString()})`);
    }
  }
  
  if (goal.description) {
    lines.push(`  ${goal.description}`);
  }
  
  if (goal.criteria && goal.criteria.length > 0) {
    lines.push("  Criteria:");
    for (const c of goal.criteria) {
      lines.push(`    • ${c}`);
    }
  }
  
  return lines.join("\n");
}

export function formatGoalsList(goals: Goal[]): string {
  if (goals.length === 0) {
    return "No goals set. Use `openclaw chorus goal add` to create one.";
  }

  // Sort by deadline (soonest first), then by progress (lowest first)
  const sorted = [...goals].sort((a, b) => {
    const aDeadline = a.deadline ? (typeof a.deadline === "string" ? Date.parse(a.deadline) : a.deadline) : Infinity;
    const bDeadline = b.deadline ? (typeof b.deadline === "string" ? Date.parse(b.deadline) : b.deadline) : Infinity;
    
    if (aDeadline !== bDeadline) return aDeadline - bDeadline;
    return a.progress - b.progress;
  });

  const lines: string[] = ["📋 Goals", "═".repeat(50), ""];
  
  for (const goal of sorted) {
    lines.push(formatGoal(goal));
    lines.push("");
  }

  return lines.join("\n");
}
