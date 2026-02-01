---
name: chorus
version: 1.0.0
description: Nine Choirs Architecture — hierarchical cognition with recursive self-improvement for AI agents.
homepage: https://chorus.oberlin.ai
repository: https://github.com/iamoberlin/chorus
author: Oberlin Stands
metadata:
  category: architecture
  platform: openclaw
  install: openclaw plugin add chorus
---

# CHORUS

Hierarchical cognition with recursive self-improvement. Nine specialized choirs running at different frequencies.

## Install

```bash
openclaw plugin add chorus
```

## Uninstall

```bash
openclaw plugin remove chorus
```

## Configuration

Create `CHORUS.md` in workspace root:

```markdown
# CHORUS

## Timezone
America/New_York

## Choirs
- Enabled: true

## Memory
- Consolidation: enabled
- Episodic retention: 90d
```

## Choir Frequencies

| Choir | Freq | Function |
|-------|------|----------|
| seraphim | 1×/day | Mission alignment |
| cherubim | 2×/day | Knowledge consolidation |
| thrones | 3×/day | Priority judgment |
| dominions | 4×/day | Project coordination |
| virtues | 6×/day | Self-improvement (RSI) |
| powers | 8×/day | Security review, red-team |
| principalities | 12×/day | Domain research |
| archangels | 18×/day | Briefings, alerts |
| angels | 48×/day | Heartbeat, presence |

Frequency increases descending. Higher choirs set context; lower choirs execute.

## Information Flow

**Illumination (down):** seraphim → cherubim → thrones → dominions → virtues → powers → principalities → archangels → angels

**Insight (up):** Observations flow upward through memory files. cherubim consolidates to MEMORY.md.

## File Outputs

```
CHORUS.md       # Config
CHANGELOG.md    # RSI modifications
MISSION.md      # seraphim
MEMORY.md       # cherubim
PLAN.md         # thrones
PROJECTS.md     # dominions
memory/*.md     # Daily logs
research/*.md   # principalities
proposals/*.md  # High-risk changes
```

## RSI Protocol (virtues)

1. Analyze recent memory, identify patterns
2. Propose modification (config, prompt, automation)
3. Assess risk: low (auto-apply) | high (flag for approval)
4. Log to CHANGELOG.md
5. powers choir validates adversarially

## Security

CHORUS integrates with OpenClaw's core security layer.

**Enable in openclaw.yaml:**
```yaml
security:
  inputValidation:
    enabled: true
    onThreat: block
```

**CHORUS adds:**
- Identity protection (prompt hardening)
- Powers choir periodic review (8×/day)

## Links

- [Documentation](https://chorus.oberlin.ai)
- [GitHub](https://github.com/iamoberlin/chorus)
- [OpenClaw](https://openclaw.ai)
