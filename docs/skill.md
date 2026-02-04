---
name: chorus
version: 0.4.0
description: CHORUS: Hierarchy Of Recursive Unified Self-improvement
homepage: https://chorus.oberlin.ai
repository: https://github.com/iamoberlin/chorus
author: Oberlin
metadata:
  category: architecture
  platform: openclaw
  install: openclaw plugin add chorus
---

# CHORUS

*Hierarchy Of Recursive Unified Self-improvement*

## Install

```bash
openclaw plugin add chorus
```

## Configuration

Standard OpenClaw config in `openclaw.yaml`:

```yaml
plugins:
  entries:
    chorus:
      enabled: true
      config:
        enabled: true              # Nine Choirs scheduler
        timezone: America/New_York
        memoryConsolidation: true
        episodicRetentionDays: 90
        choirs:                    # Optional overrides
          angels: false
```

## The Nine Choirs

| Choir | Freq | Function | Output |
|-------|------|----------|--------|
| seraphim | 1×/day | Mission alignment | MISSION.md |
| cherubim | 2×/day | Knowledge consolidation | MEMORY.md |
| thrones | 3×/day | Priority judgment | PLAN.md |
| dominions | 4×/day | Project coordination | PROJECTS.md |
| virtues | 6×/day | **RSI — self-improvement** | CHANGELOG.md |
| powers | 8×/day | Security review, red-team | Security reports |
| principalities | 12×/day | Domain research | research/*.md |
| archangels | 18×/day | Briefings, alerts | Messages |
| angels | 48×/day | Heartbeat, presence | HEARTBEAT_OK |

Frequency increases descending. Higher choirs set context; lower choirs execute.

## Information Flow

**Illumination (down):** seraphim → cherubim → thrones → dominions → virtues → powers → principalities → archangels → angels

**Insight (up):** Observations flow upward through memory files. cherubim consolidates to MEMORY.md.

## RSI Protocol (virtues)

1. Analyze recent memory, identify patterns
2. Propose modification (config, prompt, automation)
3. Assess risk: low (auto-apply) | high (flag for approval)
4. Log to CHANGELOG.md
5. powers choir validates adversarially

## CLI Commands

```bash
openclaw chorus status      # Show status
openclaw chorus list        # List choirs
openclaw chorus run <id>    # Manual trigger
```

## Uninstall

```bash
openclaw plugin remove chorus
```

## Links

- [Documentation](https://chorus.oberlin.ai)
- [GitHub](https://github.com/iamoberlin/chorus)
- [npm](https://www.npmjs.com/package/@iamoberlin/chorus)
- [OpenClaw](https://openclaw.ai)
