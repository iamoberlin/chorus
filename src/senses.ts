/**
 * CHORUS Senses System
 *
 * Input streams that feed the daemon's attention.
 * Each sense can poll periodically or watch for events.
 */

import { watch, existsSync, readdirSync, statSync, unlinkSync } from "fs";
import { readFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

export interface Signal {
  id: string;
  source: string;
  content: string;
  priority: number;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface Sense {
  id: string;
  description: string;
  poll?(): Promise<Signal[]>;
  watch?(callback: (signal: Signal) => void): () => void; // Returns cleanup function
}

const CHORUS_DIR = join(homedir(), ".chorus");
const INBOX_DIR = join(CHORUS_DIR, "inbox");
const GOALS_FILE = join(CHORUS_DIR, "goals.json");

// Ensure directories exist
async function ensureDirs() {
  await mkdir(INBOX_DIR, { recursive: true }).catch(() => {});
}

/**
 * File Inbox Sense
 * Drop files into ~/.chorus/inbox/ to trigger attention
 */
export const inboxSense: Sense = {
  id: "inbox",
  description: "Watches ~/.chorus/inbox/ for new files",

  watch(callback) {
    ensureDirs();
    
    // Process existing files on startup
    if (existsSync(INBOX_DIR)) {
      for (const file of readdirSync(INBOX_DIR)) {
        const path = join(INBOX_DIR, file);
        const stat = statSync(path);
        if (stat.isFile()) {
          processInboxFile(path, file, callback);
        }
      }
    }

    // Watch for new files
    const watcher = watch(INBOX_DIR, async (event, filename) => {
      if (event === "rename" && filename) {
        const path = join(INBOX_DIR, filename);
        if (existsSync(path)) {
          processInboxFile(path, filename, callback);
        }
      }
    });

    return () => watcher.close();
  },
};

async function processInboxFile(
  path: string,
  filename: string,
  callback: (signal: Signal) => void
) {
  try {
    const content = await readFile(path, "utf-8");
    
    callback({
      id: `inbox:${filename}:${Date.now()}`,
      source: "inbox",
      content: content.trim() || `New file: ${filename}`,
      priority: 50, // Base priority, salience filter will adjust
      timestamp: new Date(),
      metadata: { filename, path },
    });

    // Remove file after processing (it's been ingested)
    unlinkSync(path);
  } catch (err) {
    // File might have been removed already
  }
}

/**
 * Goals Sense
 * Monitors ~/.chorus/goals.json for approaching deadlines
 */
export const goalsSense: Sense = {
  id: "goals",
  description: "Monitors goals and deadlines",

  async poll() {
    const signals: Signal[] = [];

    try {
      const data = await readFile(GOALS_FILE, "utf-8");
      const goals = JSON.parse(data);
      const now = Date.now();

      for (const goal of goals) {
        // Skip completed goals
        if (goal.progress >= 100) continue;

        // Deadline pressure
        if (goal.deadline) {
          const deadline = typeof goal.deadline === "string" 
            ? Date.parse(goal.deadline) 
            : goal.deadline;
          const msLeft = deadline - now;
          const daysLeft = msLeft / (1000 * 60 * 60 * 24);

          if (daysLeft <= 0) {
            // Overdue!
            signals.push({
              id: `goal:${goal.id}:overdue`,
              source: "goal",
              content: `OVERDUE: "${goal.name}" was due ${Math.abs(daysLeft).toFixed(0)} days ago! Progress: ${goal.progress}%`,
              priority: 95,
              timestamp: new Date(),
              metadata: { goalId: goal.id, daysLeft, overdue: true },
            });
          } else if (daysLeft <= 1) {
            signals.push({
              id: `goal:${goal.id}:urgent`,
              source: "goal",
              content: `URGENT: "${goal.name}" due in ${(daysLeft * 24).toFixed(0)} hours. Progress: ${goal.progress}%`,
              priority: 85,
              timestamp: new Date(),
              metadata: { goalId: goal.id, daysLeft },
            });
          } else if (daysLeft <= 3) {
            signals.push({
              id: `goal:${goal.id}:soon`,
              source: "goal",
              content: `"${goal.name}" due in ${daysLeft.toFixed(0)} days. Progress: ${goal.progress}%`,
              priority: 70,
              timestamp: new Date(),
              metadata: { goalId: goal.id, daysLeft },
            });
          } else if (daysLeft <= 7) {
            signals.push({
              id: `goal:${goal.id}:upcoming`,
              source: "goal",
              content: `"${goal.name}" due in ${daysLeft.toFixed(0)} days. Progress: ${goal.progress}%`,
              priority: 50,
              timestamp: new Date(),
              metadata: { goalId: goal.id, daysLeft },
            });
          }
        }

        // Stalled progress (no deadline but hasn't been worked on)
        if (goal.lastWorkedOn) {
          const lastWorked = typeof goal.lastWorkedOn === "string"
            ? Date.parse(goal.lastWorkedOn)
            : goal.lastWorkedOn;
          const daysSince = (now - lastWorked) / (1000 * 60 * 60 * 24);

          if (daysSince > 3 && goal.progress < 100 && goal.progress > 0) {
            signals.push({
              id: `goal:${goal.id}:stalled`,
              source: "goal",
              content: `"${goal.name}" stalled — no progress in ${daysSince.toFixed(0)} days (${goal.progress}% complete)`,
              priority: 40,
              timestamp: new Date(),
              metadata: { goalId: goal.id, daysSince },
            });
          }
        }

        // Curiosity-driven (optional field)
        if (goal.curiosity && goal.curiosity > 60 && !goal.deadline) {
          signals.push({
            id: `goal:${goal.id}:curiosity`,
            source: "curiosity",
            content: `Curious about: "${goal.name}"`,
            priority: Math.min(40, goal.curiosity * 0.5),
            timestamp: new Date(),
            metadata: { goalId: goal.id, curiosity: goal.curiosity },
          });
        }
      }
    } catch (err) {
      // No goals file or parse error — that's fine
    }

    return signals;
  },
};

/**
 * Time Sense
 * Generates signals based on time of day
 */
export const timeSense: Sense = {
  id: "time",
  description: "Time-based signals (morning, evening, etc.)",

  async poll() {
    const signals: Signal[] = [];
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();

    // Morning window (6-7 AM, first poll only)
    if (hour === 6 && minute < 30) {
      signals.push({
        id: `time:morning:${now.toDateString()}`,
        source: "time",
        content: "Good morning. Time for morning briefing.",
        priority: 60,
        timestamp: now,
        metadata: { trigger: "morning" },
      });
    }

    // Evening window (9-10 PM)
    if (hour === 21 && minute < 30) {
      signals.push({
        id: `time:evening:${now.toDateString()}`,
        source: "time",
        content: "Evening. Time for daily wrap-up and reflection.",
        priority: 55,
        timestamp: now,
        metadata: { trigger: "evening" },
      });
    }

    return signals;
  },
};

// Export all senses
export const ALL_SENSES: Sense[] = [inboxSense, goalsSense, timeSense];

// Utility to get goals file path
export function getGoalsPath(): string {
  return GOALS_FILE;
}

export function getInboxPath(): string {
  return INBOX_DIR;
}
