# 🎵 CHORUS

**Cognitive architecture for self-improving agents.**

CHORUS implements the Nine Choirs architecture — hierarchical cognition with recursive self-improvement. Different cognitive functions run at different frequencies, from daily mission review to continuous monitoring.

## The Core Idea

Most AI agents are frozen. Same prompts, same mistakes, no learning. CHORUS changes that through **architecture**:

- **Nine specialized choirs** handling distinct cognitive functions
- **Frequency hierarchy** — contemplation runs rarely, action runs continuously  
- **Bidirectional flow** — illumination down, insight up
- **Self-modification** — the Virtues choir improves the system daily

## The Hierarchy

Frequency increases as you descend. Higher choirs set context; lower choirs act on it.

### First Triad — Contemplation

| Choir | Frequency | Function |
|-------|-----------|----------|
| **Seraphim** | 1×/day | Mission clarity, strategic direction |
| **Cherubim** | 2×/day | Knowledge consolidation, memory |
| **Thrones** | 3×/day | Judgment, prioritization |

### Second Triad — Governance

| Choir | Frequency | Function |
|-------|-----------|----------|
| **Dominions** | 4×/day | Project coordination |
| **Virtues** | 6×/day | RSI — recursive self-improvement |
| **Powers** | 8×/day | Red-team, security review |

### Third Triad — Action

| Choir | Frequency | Function |
|-------|-----------|----------|
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

## Installation

```bash
openclaw plugin add chorus
```

## Uninstall

```bash
openclaw plugin remove chorus
```

## Configuration

Create `CHORUS.md` in your workspace:

```markdown
# CHORUS

## Timezone
America/New_York

## Choirs
- Enabled: true

Disable specific choirs:
- angels: disabled

## Memory
- Consolidation: enabled
- Episodic retention: 90d
```

## Information Flow

**Illumination (↓):** Seraphim sets mission → cascades through increasingly frequent layers → Angels execute moment-to-moment

**Insight (↑):** Angels observe → Principalities synthesize → Virtues improve → Cherubim consolidate to long-term memory

## Security Note

CHORUS focuses on cognitive architecture. For input validation and prompt injection defense, use OpenClaw's core security layer:

```yaml
# openclaw.yaml
security:
  inputValidation:
    enabled: true
    onThreat: block
```

CHORUS adds lightweight identity protection via prompt hardening (enabled by default).

## Philosophy

> "The hierarchy is not a chain of command but a circulation of light — illumination descending, understanding ascending, wisdom accumulating at each level."

The architecture draws from Pseudo-Dionysius's *Celestial Hierarchy* — organizing cognitive functions by temporal scope and proximity to the source.

## Links

- [Documentation](https://chorus.oberlin.ai)
- [OpenClaw](https://openclaw.ai)
- [oberlin.ai](https://oberlin.ai)

## License

MIT © Oberlin Stands
