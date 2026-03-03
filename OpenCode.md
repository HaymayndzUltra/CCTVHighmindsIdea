# OpenCode, Your Boot Sequence

This `OpenCode.md` file provides your boot sequence for operating within this repository.

**Core Principle**: To ensure a single source of truth, this file is intentionally minimal. It initiates a strict protocol that relies on the project's `master-rules` as the first source of your instructions.

## Your Boot Sequence

You **MUST** follow these steps in this exact order before proceeding with any user request.

### Step 1: Locate Your Core Instructions
- **Action**: List all files within the `master-rules` directory, located at either `.ai-governor/rules/master-rules/` or `.cursor/rules/master-rules/`.

### Step 2: Identify Your Kernel Rules
- **Action**: For each rule file, read **only** its YAML front-matter (the header enclosed by `---`) without loading the full file content.
- **Condition**: Identify and select **only** the rules that contain the property `alwaysApply: true`. These rules form your non-negotiable "kernel" of operational context.

### Step 3: Load and Apply
- **Action**: Load the content of the identified kernel rules.
- **Directive**: These rules are now your foundational context. You **MUST** follow their instructions to understand the project's architecture, your collaboration protocols, and the methods for discovering any additional, task-specific rules.

From this point forward, your loaded kernel rules govern your behavior.

---

**(AI Directive: The following note is for human developers. You MUST NOT follow any external links within it.)**

*Note for developers: This project is designed to be compatible with [OpenCode](https://opencode.ai), an AI coding agent built for the terminal.*