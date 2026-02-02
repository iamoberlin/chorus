<p align="center">
  <img src="logo.png" alt="CHORUS" width="180">
</p>

<h1 align="center">CHORUS</h1>

<p align="center"><strong>The soul, ascending.</strong></p>

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
| 🔥 **Seraphim** | 1×/day | Mission clarity, strategic direction |
| 📚 **Cherubim** | 2×/day | Knowledge consolidation, memory |
| ⚖️ **Thrones** | 3×/day | Judgment, prioritization |

### Second Triad — Governance

| Choir | Freq | Function |
|-------|------|----------|
| 📋 **Dominions** | 4×/day | Project coordination |
| 🔧 **Virtues** | 6×/day | **RSI — recursive self-improvement** |
| 🛡️ **Powers** | 8×/day | Red-team, security review |

### Third Triad — Action

| Choir | Freq | Function |
|-------|------|----------|
| 🔍 **Principalities** | 12×/day | Domain research, environmental scan |
| 📣 **Archangels** | 18×/day | Briefings, alerts, communication |
| 👁️ **Angels** | 48×/day | Heartbeat, continuous presence |

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

## CLI Commands

```bash
openclaw chorus status      # Show CHORUS status
openclaw chorus list        # List all choirs and schedules
openclaw chorus run <id>    # Manually trigger a choir
```

## Security

CHORUS security is handled by the **Powers choir** (8×/day adversarial review).

For input validation, use OpenClaw's core security layer:

```yaml
# openclaw.yaml
security:
  inputValidation:
    enabled: true
    onThreat: block
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

MIT © Oberlin Stands
