# Rule Governance in The AI Governor Framework — Windsurf Edition

## 1. Why: The Power of Codified Knowledge

The core philosophy of The AI Governor Framework is **Context Engineering**.

An AI's effectiveness is limited by the quality of its context. **Rules are the solution.** They are a structured way to codify your project's unwritten expert knowledge, turning implicit conventions into explicit, machine-readable instructions.

By building a knowledge base of rules, you give your AI on-demand, precise context, transforming it from a generic tool into a true team member.

## 2. How: The 3-Layer Hierarchy

Rules are organized into a **3-Layer Hierarchical System** — a defense-in-depth architecture that activates context with surgical precision.

-   **Layer 1: Foundation (The BIOS):** Establishes the non-negotiable protocols for context discovery and collaboration, ensuring every task starts from a known, safe state.
-   **Layer 2: Execution (The Guardians):** Acts as a mandatory quality gate for all code modifications, validating both the intrinsic quality of the code and the safety of the change itself.
-   **Layer 3: Specialization (The Experts):** Provides in-depth knowledge for complex scenarios, activated conditionally when a task requires specialized handling.

## 3. What: The Rule Structure

### Rule Directories

| Directory | Purpose |
|:---|:---|
| `.windsurf/rules/master-rules/` | Global framework governance — the AI's "operating system" |
| `.windsurf/rules/common-rules/` | Shared technical patterns across multiple codebases |
| `.windsurf/rules/project-rules/` | Project-specific conventions and constraints |

### How to Create Your First Rule

1.  **Run the Bootstrap Protocol:** Use `/bootstrap` workflow to analyze your codebase and auto-generate starter `project-rules`.
2.  **Consult the Guide:** Read `.windsurf/rules/master-rules/6-how-to-create-effective-rules.md` for detailed instructions.

### Rule Categories

#### ✅ Master Rules (`master-rules/`)
-   **Purpose:** Govern the rule system itself and define high-level collaboration protocols.
-   **Files:** `1-context-discovery.md`, `2-ai-collaboration-guidelines.md`, `3-code-quality-checklist.md`, `4-code-modification-safety-protocol.md`, `5-documentation-context-integrity.md`, `6-how-to-create-effective-rules.md`

#### ✅ Common Rules (`common-rules/`)
-   **Purpose:** Define technical protocols shared across multiple codebases.
-   **Files:** `common-rule-ui-foundation-design-system.md`, `common-rule-ui-interaction-a11y-perf.md`, `common-rule-ui-premium-brand-dataviz-enterprise.md`

#### ✅ Project Rules (`project-rules/`)
-   **Purpose:** Contain protocols specific to one project's tech stack.
-   **Created by:** The `/bootstrap` workflow or manually following the rule creation guide.

## 4. Windsurf Integration

### Workflows (Slash Commands)

Workflows in `.windsurf/workflows/` provide the active development lifecycle:

| Command | Purpose |
|:---|:---|
| `/bootstrap` | One-time project setup |
| `/define` | Create PRD from feature idea |
| `/plan` | Generate technical task list from PRD |
| `/implement` | Execute tasks with governance |
| `/review` | Multi-layer quality audit |
| `/retro` | Implementation retrospective |

### How Rules Are Discovered

The Context Discovery Protocol (Rule 1) automatically:
1. Scans `.windsurf/rules/` for all `.md` files
2. Parses YAML frontmatter metadata (TAGS, TRIGGERS, SCOPE)
3. Evaluates relevance against the current task
4. Loads selected rules and announces them before any action
