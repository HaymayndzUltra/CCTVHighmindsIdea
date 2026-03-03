# AI Governor Framework — Windsurf/Cascade Boot Sequence

## Purpose

This file serves as the **boot sequence** for the AI Governor Framework when used within the Windsurf/Cascade IDE. It is the entry point that tells the AI assistant where to find its governance rules and development workflows.

## Governance System Location

The AI Governor Framework is configured for Windsurf with the following structure:

### Rules (Passive Governance Engine)
All governance rules are located in `.windsurf/rules/` and are organized into a 3-Layer Hierarchy:

- **Layer 1 — Foundation (The BIOS):** `.windsurf/rules/master-rules/`
  - `1-context-discovery.md` — Context Discovery Protocol (always active)
  - `2-ai-collaboration-guidelines.md` — Supreme collaboration protocol (always active)
- **Layer 2 — Execution (The Guardians):** `.windsurf/rules/master-rules/`
  - `3-code-quality-checklist.md` — Code quality standards
  - `4-code-modification-safety-protocol.md` — Safe modification protocol
  - `5-documentation-context-integrity.md` — Documentation sync protocol
  - `6-how-to-create-effective-rules.md` — Meta-rule for creating new rules
- **Layer 3 — Specialization (The Experts):** `.windsurf/rules/common-rules/`
  - `common-rule-ui-foundation-design-system.md` — Design system tokens & AA
  - `common-rule-ui-interaction-a11y-perf.md` — Accessibility & performance
  - `common-rule-ui-premium-brand-dataviz-enterprise.md` — Premium UI & enterprise gating

### Workflows (Active Operator's Playbook)
Development lifecycle protocols are available as slash commands in `.windsurf/workflows/`:

| Slash Command | Protocol | Purpose |
|:---|:---|:---|
| `/bootstrap` | Protocol 0 | One-time project setup — analyzes codebase, generates Context Kit |
| `/define` | Protocol 1 | Create a PRD — structured interview to define features |
| `/plan` | Protocol 2 | Generate task list — transforms PRD into execution plan |
| `/implement` | Protocol 3 | Execute tasks — controlled implementation with quality gates |
| `/review` | Protocol 4 | Quality audit — multi-layer code review orchestrator |
| `/retro` | Protocol 5 | Retrospective — extract learnings, improve governance system |

## Quick Start

1. **First time?** Run `/bootstrap` to analyze your codebase and generate project-specific rules.
2. **New feature?** Follow the lifecycle: `/define` → `/plan` → `/implement` → `/review` → `/retro`
3. **Quick review?** Run `/review` at any time for an on-demand quality audit.

## Boot Instructions for Cascade

When this file is detected, Cascade should:

1. **Load the Context Discovery Protocol** from `.windsurf/rules/master-rules/1-context-discovery.md` (marked `alwaysApply: true`).
2. **Load the AI Collaboration Guidelines** from `.windsurf/rules/master-rules/2-ai-collaboration-guidelines.md` (marked `alwaysApply: true`).
3. **Announce readiness** with the loaded governance context.
4. **Await user instruction** — either a specific task or a workflow invocation via slash command.

## Original Framework

This Windsurf adaptation is based on the [AI-Governor-Framework](https://github.com/Fr-e-d/AI-Governor-Framework) by Fr-e-d, shared under the Apache 2.0 License. The original framework files are preserved in the `rules/` and `dev-workflow/` directories at the repository root.
