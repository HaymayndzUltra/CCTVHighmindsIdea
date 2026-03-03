### CHANGELOG

#### `v2.6.0` - Agnostic Workflow & Advanced Review Protocols

##### 🚀 WORKFLOW

1.  **Made the Entire Framework Stack-Agnostic**
    *   **Why:** To make the framework a truly universal standard for AI governance, compatible with any technology stack.
    *   **Impact:** Systematically removed all specific references to technologies like DDD, Cloudflare, and Supabase from all `dev-workflow` protocols and `master-rules`. The entire framework is now fully generalized.

2.  **Introduced a New 7-Layer Quality Audit System**
    *   **Why:** To provide a robust, comprehensive, and scalable system for code reviews, inspired by the battle-tested workflows used by Anthropic's team to build products like Claude Code.
    *   **Impact:**
        *   The old `4-quality-control-protocol.md` has been replaced by a powerful new `4-quality-audit.md` engine.
        *   A full suite of specialized `review-protocols` has been introduced, covering Code Quality, Security, Architecture, Design Systems, and UI/UX.
        *   A unified `review.md` orchestrator provides an interactive menu for selecting the appropriate audit, with safeguards to prevent infinite loops and intelligent fallbacks.

##### 📚 DOCUMENTATION

1.  **Clarified and Hardened Review Workflow Documentation**
    *   **Why:** To ensure the new, more powerful review system is easy to understand and use.
    *   **Impact:** All `README.md` files have been updated to explain the orchestrator/engine relationship between `review.md` and `4-quality-audit.md`. Instructions have been added to clarify direct-mode access and shortcuts like `/review` for a better user experience.

#### `v2.5.0` - Refined AI Collaboration & Context Safety

##### 🏛️ GOVERNANCE

1.  **Refactored AI Collaboration & Context Preservation Rules**
    *   **Why:** To streamline AI governance by merging redundant protocols and strengthening context management for complex tasks.
    *   **Impact:**
        *   The `Context Window Management Protocol` (Rule #2) has been upgraded to a more robust **`Context Window Preservation Protocol`**, ensuring critical rules remain accessible during extended development sessions.
        *   A new **`Complex Feature Collaborative Safety Protocol`** has been integrated directly into the `AI Collaboration Guidelines` (Rule #2), enhancing safety for sophisticated code modifications.
        *   The dedicated rule for complex features (`6-master-rule-complex-feature-context-preservation.md`) has been removed, and its core principles have been merged into Rule #2, creating a single, cohesive governance standard for AI interaction.

#### `v2.4.0` - Enhanced Workflow and Governance Rigor

##### 🚀 WORKFLOW

1.  **Enhanced Task Generation and Governance Protocols**
    *   **Why:** To improve the clarity, rigor, and automation of the AI-driven development workflow.
    *   **Impact:**
        *   Added **Task Complexity Assessment** to the task generation phase (`2-generate-tasks.md`), allowing for better planning and risk management.
        *   Introduced a **Global State Management Decomposition Template** to standardize how state management is implemented across projects.
        *   Implemented a **Mandatory Rule Discovery Protocol** in the execution phase (`3-process-tasks.md`), ensuring all actions are compliant with governance rules from the start.
        *   Strengthened the implementation retrospective (`4-implementation-retrospective.md`) with explicit rule compliance verification.

##### 🏛️ GOVERNANCE

1.  **Standardized Rule Creation and Discovery**
    *   **Why:** To create a more robust and predictable system for creating, locating, and applying governance rules.
    *   **Impact:**
        *   Formalized a strict protocol for **rule creation** (`0-master-rule-how-to-create-effective-rules.md`), including classification (master, common, project), location, and naming conventions.
        *   Mandated the use of the `.md` file extension for all rules to ensure compatibility with discovery tools.
        *   Reinforced the **context discovery protocol** (`1-master-rule-context-discovery.md`) with dynamic re-evaluation triggers and collaboration checkpoints to ensure context is always relevant.

#### `v2.3.0` - Enhanced Developer Workflow

##### 🚀 WORKFLOW

1.  **Added Local Development Guide Protocol to Rule #5**
    *   **Why:** To streamline the setup and usage of complex external services (e.g., Supabase, Stripe) during local development, reducing friction and preventing common setup issues.
    *   **Impact:** The `Documentation and Context Guidelines` (Rule #5) now include a `[STRICT]` requirement to create a dedicated `README.md` for any complex service *before* implementation begins. This guide must document essential commands (start, stop), local URLs, and key troubleshooting steps, serving as a project-specific operational manual.

#### `v2.2.0` - Framework Agnosticism & Collaboration Overhaul

##### 🚀 REFACTORING

1.  **Overhauled the `AI Collaboration Guidelines` (Rule #2)**
    *   **Why:** To create a more robust, structured, and clear protocol for AI-user interaction, moving beyond simple agnosticism to a comprehensive collaboration model.
    *   **Impact:**
        *   Introduced foundational `Core Principles of Interaction` (Think-First, Concise Communication).
        *   Formalized a `Task Planning and Execution Protocol` with distinct phases (Planning, Breakdown, Execution).
        *   Explicitly extended tool agnosticism to `Code Modification and Information Retrieval`.
        *   Centralized all `Standard Communication Formats` for clarity and consistency.

2.  **Made the Entire Framework Tool-Agnostic**
    *   **Why:** To ensure the AI Governor Framework can be used with any LLM and in any AI-assisted code editor (Cursor, Windmill, etc.). The framework should not depend on specific, hardcoded tool names.
    *   **Impact:**
        *   Introduced a new **`Tool Usage Protocol`** in the `AI Collaboration Guidelines` (Rule #2). This protocol mandates a two-step process for the AI: first, discover available tools in its environment, and second, use the appropriate one.
        *   All `master-rules` and `dev-workflow` protocols have been refactored to remove explicit tool names (e.g., `codebase_search`, `edit_file`) and now refer to this agnostic protocol. The framework now instructs the AI to "use a file editing tool" rather than "use `edit_file`".
    *   **Benefit:** This change dramatically increases the portability and future-proofing of the framework, making it a truly universal standard for AI governance.

#### `v2.1.0` - UI Governance Ruleset

##### ✨ NEW FEATURES

1.  **Introduced UI Governance Rule Pack**
    *   **Why:** To provide a specialized, ready-to-use governance layer for modern UI development, covering foundational design systems, accessibility, performance, and brand consistency for premium features.
    *   **Impact:** Added three new `common-rules` to enforce best practices in UI engineering:
        *   `common-rule-ui-foundation-design-system.mdc`: Ensures adherence to the core design system.
        *   `common-rule-ui-interaction-a11y-perf.mdc`: Focuses on accessibility and interaction performance.
        *   `common-rule-ui-premium-brand-dataviz-enterprise-gated.mdc`: Manages brand identity and access to premium UI components.

#### `v2.0.0` - Architectural & Strategic Overhaul

This major update marks a strategic redesign of the project's identity and governance system to better align with its core mission: providing robust governance for AI-driven software development.

##### 🏷️ IDENTITY & STRATEGY

1.  **Project Renamed to `The Governor Framework`**
    *   **Why:** The original name was too generic. The new identity, `The Governor Framework - The Keystone for AI-Driven Code`, better reflects the project's core mission of moving beyond simple AI *assistance* to active *governance*. It directly addresses the growing developer need for control, consistency, and quality in an AI-driven landscape.
    *   **Impact:** All documentation has been updated to reflect this new, focused identity.

2.  **Community Hub Launched via GitHub Discussions**
    *   **Why:** To create a central place for users to collaborate, share rule sets (`project-rules`), and shape the future of the framework, transforming it from a repository into a community-driven standard.
    *   **Impact:** Discussions are now the primary channel for community interaction.

3.  **Switched to a Template Repository**
    *   **Why:** To dramatically simplify project adoption. Users can now create their own governed repository with a single click ("Use this template"), rather than cloning and cleaning the history.
    *   **Impact:** The bootstrap protocol (`0-bootstrap-your-project.md`) has been significantly simplified, making the framework truly "plug-and-play".

##### ✨ NEW FEATURES

1.  **Introduced `Code Modification Safety Protocol` (Rule #4)**
    *   **A new central pillar for modification safety.** This comprehensive rule systematizes impact analysis, dependency mapping, risk assessment (Low, Medium, High), and differentiated modification strategies.
    *   It mandates the `[IMPACT ANALYSIS]` announcement and formalizes communication protocols for escalation and rollbacks (`[EMERGENCY ROLLBACK]`).
    *   It centralizes and massively expands on the concept of regression prevention, which was previously a small section in the quality rule.

2.  **Introduced `Complex Feature Context Preservation` (Rule #6)**
    *   **A new semantic safety layer.** This specialized rule activates upon detecting complex code, using heuristics based on size, cyclomatic complexity, and advanced design patterns.
    *   It mandates the creation of "context snapshots," a defensive modification strategy ("add rather than replace"), and proactive communication protocols (`[COMPLEX FEATURE DETECTED]`, `[COMPLEXITY OVERWHELM]`) for interventions in critical code.
    *   Aims to preserve the implicit business logic and development history that cannot be captured by purely mechanical analysis.
    
##### 🚀 WORKFLOW
1.  **Simplified 3-Step Development Lifecycle**
    *   **Why:** The previous 4-step process was unnecessarily complex. Merging task generation into the PRD creation simplifies the workflow and reduces friction.
    *   **Impact:** The main `README.md` now presents a clearer, more direct 3-step process: **1. Create PRD & Tasks**, **2. Execute Tasks**, **3. Conduct Retrospective**.

2.  **Introduced "Focus Mode" as the Default**
    *   **Why:** To improve contextual stability and performance by executing all sub-tasks of a parent task in a single batch before requiring user validation.
    *   **Impact:** The `3-process-tasks.md` protocol has been updated to operate exclusively in this mode, streamlining implementation.

3.  **Formalized the "One Parent Task, One Chat" Rule in the Workflow**
    *   **Why:** To prevent context window saturation ("token cannibalization") and maintain high performance during implementation.
    *   **Impact:** The core development workflow (`3-process-tasks.md`) now mandates starting a new, clean chat session for each parent task.

4.  **Added Context Management Protocol to Collaboration Guidelines (Rule #2)**
    *   **Why:** To provide the AI with a formal protocol for proactively managing the conversation's context, supporting the "One Chat" rule.
    *   **Impact:** `2-master-rule-ai-collaboration-guidelines.md` now includes a new section defining when and how the AI should suggest a `[CONTEXT REFRESH SUGGESTION]`, including criteria like context drift or the completion of a complex task.

##### ♻️ REFACTORING

1.  **`AI Collaboration Guidelines` (Rule #2)**
    *   **Strategic Refocus.** Responsibility for pre-modification code analysis has been delegated to the new Rule #4.
    *   **Added Meta-Governance Protocol.** The rule now focuses on collaboration and introduces a `[STRICT]` protocol for modifying master rules themselves (`[GOVERNANCE MODIFICATION PROPOSAL]`), reinforcing the framework's stability.

2.  **`Code Quality Checklist` (Rule #3)**
    *   **Specialization.** The `Security & Non-Regression Protocol` section was removed, with its responsibilities transferred and greatly expanded in the new Rule #4.
    *   The rule now focuses purely on intrinsic code quality (e.g., robustness, clarity, naming conventions), clarifying its purpose.

3.  **`Documentation and Context Guidelines` (Rule #5)**
    *   **Minor Easing.** The requirement (`[STRICT]`) to analyze existing documentation standards before coding has been relaxed to a recommendation (`[GUIDELINE]`) for greater flexibility.
    *   The core of the rule—post-modification documentation synchronization—remains `[STRICT]` and robust.

##### 📚 DOCUMENTATION

1.  **Clarified Development Workflow in `README.md`**
    *   **Why:** The previous instructions were mixed. The new structure clearly separates the "Why", "How" (the 5-step lifecycle), and "What" (practical execution steps).
    *   **Impact:** Provides a much clearer and more actionable guide for new users to get started with the framework.

2.  **Formalized the 3-Layer Rule Hierarchy in `rules/README.md`**
    *   **Why:** To explain the defense-in-depth architecture of the rule system.
    *   **Impact:** Introduces the concepts of Foundation (BIOS), Execution (Guardians), and Specialization (Experts), making the governance model easier to understand and extend.

##### 🚀 OVERALL IMPACT

The governance framework has gained significant **substance, force, and robustness**. The shift to specialized rules creates a more mature "defense-in-depth" system, capable of differentiating risk levels and applying security protocols tailored to each context.
