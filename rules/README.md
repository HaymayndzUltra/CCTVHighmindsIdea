# Rule Governance in The AI Governor Framework

## 1. Why: The Power of Codified Knowledge

The core philosophy of The AI Governor Framework is **Context Engineering**.

An AI's effectiveness is limited by the quality of its context. Simply dumping your entire codebase into a prompt is inefficient and expensive. **Rules are the solution.**

They are a structured way to codify your project's unwritten expert knowledge, turning implicit conventions into explicit, machine-readable instructions. This is how you teach an AI:

-   **Architectural Decisions:** *Why* your app is built a certain way.
-   **Best Practices:** The coding patterns that lead to quality and maintainability.
-   **Project Constraints:** The non-negotiable requirements of your tech stack.

By building a knowledge base of rules, you give your AI on-demand, precise context, transforming it from a generic tool into a true team member.

## 2. How: The 3-Layer Hierarchy

To grant the AI full autonomy safely, The AI Governor Framework organizes governance into a **3-Layer Hierarchical System**. It's a defense-in-depth architecture that activates context with surgical precision.

-   **Layer 1: Foundation (The BIOS):** Establishes the non-negotiable protocols for context discovery and collaboration, ensuring every task starts from a known, safe state.
-   **Layer 2: Execution (The Guardians):** Acts as a mandatory quality gate for all code modifications, validating both the intrinsic quality of the code and the safety of the change itself.
-   **Layer 3: Specialization (The Experts):** Provides in-depth knowledge for complex scenarios, activated conditionally when a task requires specialized handling.

This architecture builds trust. By starting with a stable foundation, applying robust guards, and invoking expert knowledge only when necessary, we grant the AI the autonomy to work efficiently and safely.

## 3. What: The Rule Structure

The framework organizes rules into three categories based on their scope and location.

> **Note on Rule Directories:** The framework uses two standard locations for rules:
> - **`.ai-governor/rules/`**: The default location after cloning.
> - **`.cursor/rules/`**: A required location for Cursor users.
>
> For assistants like **Claude Code** or **OpenCode**, both locations are supported thanks to the boot sequences defined in [`CLAUDE.md`](../../CLAUDE.md) and [`OpenCode.md`](../../OpenCode.md). The examples below use `.cursor/rules/` as a generic placeholder for simplicity.

### How to Create Your First Rule

The best way to create high-quality rules is to follow a simple, two-step process:

1.  **Run the Bootstrap Protocol:** The `0-bootstrap-your-project.md` protocol is designed to analyze your codebase and automatically generate a starter set of `project-rules` tailored to your stack.
2.  **Consult the Guide:** The `.cursor/rules/master-rules/0-how-to-create-effective-rules.md` file in this directory provides a detailed, step-by-step guide for writing your own effective rules from scratch.

### Rule Categories

#### ✅ Master Rules (`.cursor/rules/master-rules/`)

-   **Location:** Repository root ONLY.
-   **Purpose:** To govern the rule system itself and define the high-level collaboration protocols. These rules form the AI's "operating system" and are organized according to the 3-Layer Hierarchy.
-   **Examples:** `1-master-rule-context-discovery.md`, `3-master-rule-code-quality-checklist.mdc`.

#### ✅ Common Rules (`.cursor/rules/common-rules/`)

-   **Location:** Repository root ONLY.
-   **Purpose:** To define technical protocols that are shared across multiple codebases within a monorepo.
-   **Examples:** Document versioning on cloud storage, shared authentication standards between a frontend and backend.

#### ✅ Project Rules (`{project-folder}/.cursor/rules/project-rules/`)

-   **Location:** Inside each specific project/codebase folder.
-   **Purpose:** To contain protocols and conventions specific to that project's tech stack.
-   **Examples:** Rules for interacting with a specific cloud service, patterns for React components, or conventions for REST API endpoints.

---

### 📚 References

Consult the documentation for your specific AI assistant to understand how it discovers and applies context rules.

-   **Cursor:**
    -   [Official Documentation on Rules](https://docs.cursor.com/context/rules)
