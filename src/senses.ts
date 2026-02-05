/**
 * CHORUS Senses System
 *
 * Input streams that feed the daemon's attention.
 * Each sense can poll periodically or watch for events.
 */

import { watch, existsSync, readdirSync, statSync, unlinkSync, mkdirSync } from "fs";
import { readFile } from "fs/promises";
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
const PURPOSES_FILE = join(CHORUS_DIR, "purposes.json");

// Ensure directories exist (sync for use in watch())
function ensureDirs() {
  try {
    mkdirSync(INBOX_DIR, { recursive: true });
  } catch {
    // Directory may already exist
  }
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
      try {
        for (const file of readdirSync(INBOX_DIR)) {
          const filePath = join(INBOX_DIR, file);
          const stat = statSync(filePath);
          if (stat.isFile()) {
            processInboxFile(filePath, file, callback);
          }
        }
      } catch {
        // Directory read failed, continue without processing existing files
      }
    }

    // Watch for new files
    let watcher: ReturnType<typeof watch> | null = null;
    try {
      watcher = watch(INBOX_DIR, async (event, filename) => {
        if (event === "rename" && filename) {
          const filePath = join(INBOX_DIR, filename);
          if (existsSync(filePath)) {
            processInboxFile(filePath, filename, callback);
          }
        }
      });
    } catch {
      // Watch failed (e.g., directory doesn't exist) - return no-op cleanup
      return () => {};
    }

    return () => watcher?.close();
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
 * Purposes Sense
 * Monitors ~/.chorus/purposes.json for approaching deadlines
 */
export const purposesSense: Sense = {
  id: "purposes",
  description: "Monitors purposes and deadlines",

  async poll() {
    const signals: Signal[] = [];

    try {
      if (!existsSync(PURPOSES_FILE)) return signals;
      
      const data = await readFile(PURPOSES_FILE, "utf-8");
      const purposes = JSON.parse(data);
      const now = Date.now();

      for (const purpose of purposes) {
        // Skip completed purposes
        if (purpose.progress >= 100) continue;

        // Deadline pressure
        if (purpose.deadline) {
          const deadline = typeof purpose.deadline === "string" 
            ? Date.parse(purpose.deadline) 
            : purpose.deadline;
          const msLeft = deadline - now;
          const daysLeft = msLeft / (1000 * 60 * 60 * 24);

          if (daysLeft <= 0) {
            // Overdue!
            signals.push({
              id: `purpose:${purpose.id}:overdue`,
              source: "purpose",
              content: `OVERDUE: "${purpose.name}" was due ${Math.abs(daysLeft).toFixed(0)} days ago! Progress: ${purpose.progress}%`,
              priority: 95,
              timestamp: new Date(),
              metadata: { purposeId: purpose.id, daysLeft, overdue: true },
            });
          } else if (daysLeft <= 1) {
            signals.push({
              id: `purpose:${purpose.id}:urgent`,
              source: "purpose",
              content: `URGENT: "${purpose.name}" due in ${(daysLeft * 24).toFixed(0)} hours. Progress: ${purpose.progress}%`,
              priority: 85,
              timestamp: new Date(),
              metadata: { purposeId: purpose.id, daysLeft },
            });
          } else if (daysLeft <= 3) {
            signals.push({
              id: `purpose:${purpose.id}:soon`,
              source: "purpose",
              content: `"${purpose.name}" due in ${daysLeft.toFixed(0)} days. Progress: ${purpose.progress}%`,
              priority: 70,
              timestamp: new Date(),
              metadata: { purposeId: purpose.id, daysLeft },
            });
          } else if (daysLeft <= 7) {
            signals.push({
              id: `purpose:${purpose.id}:upcoming`,
              source: "purpose",
              content: `"${purpose.name}" due in ${daysLeft.toFixed(0)} days. Progress: ${purpose.progress}%`,
              priority: 50,
              timestamp: new Date(),
              metadata: { purposeId: purpose.id, daysLeft },
            });
          }
        }

        // Stalled progress (no deadline but hasn't been worked on)
        if (purpose.lastWorkedOn) {
          const lastWorked = typeof purpose.lastWorkedOn === "string"
            ? Date.parse(purpose.lastWorkedOn)
            : purpose.lastWorkedOn;
          const daysSince = (now - lastWorked) / (1000 * 60 * 60 * 24);

          if (daysSince > 3 && purpose.progress < 100 && purpose.progress > 0) {
            signals.push({
              id: `purpose:${purpose.id}:stalled`,
              source: "purpose",
              content: `"${purpose.name}" stalled — no progress in ${daysSince.toFixed(0)} days (${purpose.progress}% complete)`,
              priority: 40,
              timestamp: new Date(),
              metadata: { purposeId: purpose.id, daysSince },
            });
          }
        }

        // Curiosity-driven (optional field)
        if (purpose.curiosity && purpose.curiosity > 60 && !purpose.deadline) {
          signals.push({
            id: `purpose:${purpose.id}:curiosity`,
            source: "curiosity",
            content: `Curious about: "${purpose.name}"`,
            priority: Math.min(40, purpose.curiosity * 0.5),
            timestamp: new Date(),
            metadata: { purposeId: purpose.id, curiosity: purpose.curiosity },
          });
        }
      }
    } catch (err) {
      // No purposes file or parse error — that's fine
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
export const ALL_SENSES: Sense[] = [inboxSense, purposesSense, timeSense];

// Utility to get purposes file path
export function getPurposesPath(): string {
  return PURPOSES_FILE;
}

export function getInboxPath(): string {
  return INBOX_DIR;
}
