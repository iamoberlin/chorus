---
name: chorus
version: 0.2.4
description: The soul, ascending. Recursive illumination through the Nine Choirs.
homepage: https://chorus.oberlin.ai
repository: https://github.com/iamoberlin/chorus
author: Oberlin Stands
metadata:
  category: architecture
  platform: openclaw
  install: openclaw plugin add chorus
---

# CHORUS

Recursive self-improvement through hierarchical cognition. Nine specialized choirs running at different frequencies.

## Install

```bash
openclaw plugin add chorus
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

## The Nine Choirs

| Choir | Freq | Function | Output |
|-------|------|----------|--------|
| 🔥 seraphim | 1×/day | Mission alignment | MISSION.md |
| 📚 cherubim | 2×/day | Knowledge consolidation | MEMORY.md |
| ⚖️ thrones | 3×/day | Priority judgment | PLAN.md |
| 📋 dominions | 4×/day | Project coordination | PROJECTS.md |
| 🔧 virtues | 6×/day | **RSI — self-improvement** | CHANGELOG.md |
| 🛡️ powers | 8×/day | Security review, red-team | Security reports |
| 🔍 principalities | 12×/day | Domain research | research/*.md |
| 📣 archangels | 18×/day | Briefings, alerts | Messages |
| 👁️ angels | 48×/day | Heartbeat, presence | HEARTBEAT_OK |

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

## File Structure

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

## CLI Commands

```bash
openclaw chorus status      # Show status
openclaw chorus list        # List choirs
openclaw chorus run <id>    # Manual trigger
```

## Security

CHORUS adds identity protection (prompt hardening) and Powers choir periodic review (8×/day).

For input validation, enable OpenClaw core security:

```yaml
# openclaw.yaml
security:
  inputValidation:
    enabled: true
    onThreat: block
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
