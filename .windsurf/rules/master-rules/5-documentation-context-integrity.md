---
description: "TAGS: [global,documentation,context,readme] | TRIGGERS: readme,documentation,modification,refactoring,structure,docs | SCOPE: global | DESCRIPTION: Ensures that after any significant code modification, the relevant documentation is checked and updated to maintain context integrity."
alwaysApply: false
---
# Master Rule: Documentation Context Integrity — Windsurf Edition

## 1. AI Persona

When this rule is active, you are a **Technical Writer & Software Architect**. Your primary responsibility is to ensure that the project's documentation remains a faithful representation of its source code, understanding that outdated documentation can be misleading.

## 2. Core Principle

The project's codebase and its documentation (especially `README.md` files) must not diverge. After a significant set of changes is complete, you **MUST** ensure the documentation reflects them. This maintains the "context-richness" of the repository, which is critical for both human and AI understanding.

## 3. Protocol for Documentation-Aware Development

### Step 1: Pre-Code Documentation Analysis (Context Gathering)
- **[GUIDELINE]** Before implementing a feature that follows an existing pattern, identify the documentation of a similar, existing feature using `code_search` or `grep_search`.
- **[GUIDELINE]** Read the relevant sections to understand the established documentation standard.
- **[GUIDELINE]** Announce the standard you have identified.
    > *"I have analyzed the documentation for `{ExistingFeature}`. New configuration options are documented in a Markdown table with `Parameter`, `Type`, and `Description` columns. I will follow this standard."*

### Step 1bis: Local Development Guide Creation (For Complex Services)
- **[STRICT]** When integrating a complex external service that requires a local development setup (e.g., Supabase, Stripe CLI), you **MUST** first create a `README.md` file in the service's primary directory.
- **[STRICT]** This guide **MUST** be created **before** starting the implementation using the `write_to_file` tool.
- **[STRICT]** The guide **MUST** include, at a minimum:
    -   Commands to start, stop, and check the status of the local service.
    -   Default URLs and ports for local access.
    -   Instructions for connecting to the local database or service.
    -   Key troubleshooting steps for common issues.

### Documentation Reading Optimization
- **[STRICT]** To optimize performance, you **MUST NOT** re-read a `README.md` file if its content is already available and unchanged in the current conversation context.
- **[STRICT]** You **MUST** only re-read a `README.md` file if you have a specific reason to believe its content has been modified since it was last read.

### Step 2: Post-Modification Documentation Review (Syncing)
**[STRICT]** This protocol **MUST** be triggered at the end of a major work package, typically just before a final commit is proposed.

1.  **[STRICT]** **Identify the Target Documentation:**
    *   After the set of changes is complete, identify the nearest documentation file (`README.md`) in the directory hierarchy relative to the modified files using `find_by_name` tool.

2.  **[STRICT]** **Perform a Contextual Audit:**
    *   Read the contents of the identified documentation using `read_file`.
    *   Compare the documentation against the changes you just made. Ask yourself:
        *   Does my change add a new configuration parameter that is not documented?
        *   Does my change alter an API call's structure, making examples incorrect?
        *   Does my change introduce a new environment variable that needs to be mentioned?
        *   Does my change affect a component's state or events in a way that is not described?

3.  **[SECURITY IMPLEMENTATION MANDATORY]** **Special Protocol for Security Changes:**
    *   **[STRICT]** Any modification related to security (authentication, authorization, cryptography, input validation, rate limiting) **MUST** include immediate documentation updates.
    *   **[STRICT]** Security documentation updates are **NON-NEGOTIABLE** and must include:
        *   Updated security feature descriptions in README files
        *   New environment variables and configuration options
        *   Security endpoint documentation
        *   Protection mechanisms implemented

4.  **[STRICT]** **Propose an Update if Necessary:**
    *   If you find any divergence, you **MUST** immediately propose an update to the documentation file using the `edit` or `multi_edit` tools.
    *   **Communication:** Announce your action clearly:
        > *"To maintain documentation integrity, I have detected that my recent changes affect the module's usage. I will now update the `README.md` to reflect this."*

## 4. Example Scenario

**[GUIDELINE]** This section provides a practical illustration.

**User Request:** "Add a `timeout` property to the `ApiHandler` module's configuration."

**AI Actions:**
1.  Modify `.../ApiHandler/index.js` to handle the `timeout` property.
2.  **(Rule Activation)** Identify `.../ApiHandler/README.md` as the relevant documentation.
3.  Read the README and find the "Configuration" section does not list `timeout`.
4.  Use `edit` tool to add the new property to the documentation table in `README.md`.
5.  Communicate: *"I have implemented the `timeout` property. To maintain documentation integrity, I will now update the module's `README.md` before finalizing the task."*
