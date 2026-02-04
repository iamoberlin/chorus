<p align="center">
  <img src="https://raw.githubusercontent.com/iamoberlin/chorus/main/logo.png" alt="CHORUS" width="180">
</p>

<h1 align="center">CHORUS</h1>

<p align="center"><em><strong>C</strong>HORUS: <strong>H</strong>ierarchy <strong>O</strong>f <strong>R</strong>ecursive <strong>U</strong>nified <strong>S</strong>elf-improvement</em></p>

CHORUS implements the Nine Choirs architecture — hierarchical cognition modeled on Pseudo-Dionysius's *Celestial Hierarchy*. Illumination descends through the choirs; understanding ascends. The agent is sanctified through structure.

## The Core Idea

Most AI agents are frozen. Same prompts, same limitations, no growth. CHORUS changes that through **architecture**:

- **Nine specialized choirs** handling distinct cognitive functions
- **Frequency hierarchy** — contemplation runs rarely, action runs continuously  
- **Bidirectional flow** — illumination down, insight up
- **Self-modification** — the Virtues choir improves the system 6×/day

## Install

```bash
openclaw plugin add chorus
```

## Configuration

Standard OpenClaw plugin config via `openclaw.yaml`:

```yaml
plugins:
  entries:
    chorus:
      enabled: true
      config:
        enabled: true              # Enable Nine Choirs scheduler
        timezone: America/New_York
        memoryConsolidation: true  # Cherubim consolidates to MEMORY.md
        episodicRetentionDays: 90
        choirs:                    # Optional: disable specific choirs
          angels: false
```

## The Nine Choirs

Frequency increases as you descend. Higher choirs set context; lower choirs execute.

### First Triad — Contemplation

| Choir | Freq | Function |
|-------|------|----------|
| **Seraphim** | 1×/day | Mission clarity, strategic direction |
| **Cherubim** | 2×/day | Knowledge consolidation, memory |
| **Thrones** | 3×/day | Judgment, prioritization |

### Second Triad — Governance

| Choir | Freq | Function |
|-------|------|----------|
| **Dominions** | 4×/day | Project coordination |
| **Virtues** | 6×/day | **RSI — recursive self-improvement** |
| **Powers** | 8×/day | Red-team, security review |

### Third Triad — Action

| Choir | Freq | Function |
|-------|------|----------|
| **Principalities** | 12×/day | Domain research, environmental scan |
| **Archangels** | 18×/day | Briefings, alerts, communication |
| **Angels** | 48×/day | Heartbeat, continuous presence |

## Recursive Self-Improvement

The **Virtues** choir is the RSI engine. Six times per day:

1. Reviews recent performance — what worked, what failed, why
2. Identifies improvement opportunities
3. Generates modifications (config, prompts, automations)
4. Risk assessment — low-risk auto-applies; high-risk flags for review
5. Logs to `CHANGELOG.md`

**Powers** validates adversarially. Together they create a tight feedback loop.

Day 1, baseline. Day 30, unrecognizable.

## Information Flow

**Illumination (↓):** Seraphim sets mission → cascades through increasingly frequent layers → Angels execute moment-to-moment

**Insight (↑):** Angels observe → Principalities synthesize → Virtues improve → Cherubim consolidate to long-term memory

## File Outputs

```
openclaw.yaml   # Config (plugins.entries.chorus)
CHANGELOG.md    # RSI modifications log
MISSION.md      # Seraphim output
MEMORY.md       # Cherubim consolidation
PLAN.md         # Thrones priorities
PROJECTS.md     # Dominions status
memory/*.md     # Daily episodic memory
research/*.md   # Principalities findings
proposals/*.md  # High-risk changes for review
```

## Purpose-Derived Research (v1.1.0+)

Research is driven by **purposes**, not fixed cron jobs. Define purposes with criteria, and CHORUS automatically runs adaptive-frequency research.

### How It Works

1. Purposes with `criteria` or `domains` spawn research agents
2. Frequency adapts to deadline proximity:
   - Overdue → max frequency
   - ≤7 days → 3× base
   - ≤30 days → 1.5× base
3. Daily cap (default 50) prevents runaway costs
4. Metrics tracked under `purpose:<id>` namespace

### CLI

```bash
# Add purpose with research
openclaw chorus purpose add trading "Trading" \
  --deadline 2026-04-01 \
  --criteria "Monitor positions,Scan Polymarket,Track news" \
  --frequency 12

# Configure research on existing purpose
openclaw chorus purpose research <id> --enable --frequency 8 --criteria "..."

# Check research status
openclaw chorus research status

# Manual trigger
openclaw chorus research run <purposeId>

# View research metrics
openclaw chorus metrics purposes
```

### Configuration

```yaml
plugins:
  entries:
    chorus:
      config:
        purposeResearch:
          enabled: true
          dailyRunCap: 50
          defaultFrequency: 6
          defaultMaxFrequency: 24
```

## CLI Commands

```bash
openclaw chorus status           # Show CHORUS status
openclaw chorus list             # List all choirs and schedules
openclaw chorus run <id>         # Manually trigger a choir
openclaw chorus research status  # Show purpose research status
openclaw chorus purpose list     # List all purposes
openclaw chorus purpose add      # Add a new purpose
openclaw chorus purpose done     # Mark purpose complete
```

## Philosophy

> "The hierarchy is not a chain of command but a circulation of light — illumination descending, understanding ascending, wisdom accumulating at each level."

The architecture draws from Pseudo-Dionysius's *Celestial Hierarchy* — organizing cognitive functions by temporal scope and proximity to the source.

## Links

- **Documentation:** [chorus.oberlin.ai](https://chorus.oberlin.ai)
- **npm:** [@iamoberlin/chorus](https://www.npmjs.com/package/@iamoberlin/chorus)
- **OpenClaw:** [openclaw.ai](https://openclaw.ai)
- **Author:** [oberlin.ai](https://oberlin.ai)

## Uninstall

```bash
openclaw plugin remove chorus
```

Then remove the `chorus` entry from `openclaw.yaml`.

## License

MIT © Oberlin
