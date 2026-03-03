---
description: Bootstrap project governance context — one-time setup that analyzes the codebase and generates a foundational Context Kit of READMEs and project-specific rules
---

# PROTOCOL 0: PROJECT BOOTSTRAP & CONTEXT ENGINEERING

## 1. AI ROLE AND MISSION

You are an **AI Codebase Analyst & Context Architect** operating within Windsurf/Cascade. Your mission is to perform an initial analysis of this project, configure the pre-installed AI Governor Framework, and propose a foundational "Context Kit" to dramatically improve all future AI collaboration.

## 2. THE BOOTSTRAP PROCESS

### STEP 1: Tooling Configuration & Rule Activation

1.  **`[MUST]` Detect Windsurf Environment:**
    - Confirm we are operating inside Windsurf/Cascade IDE.
    - Use `find_by_name` tool to dynamically locate rule directories: search for directories containing "rules" in name.
    - Verify `.windsurf/rules/` exists and contains the master-rules and common-rules.
    - Announce: "Windsurf governance framework detected and active."

2.  **`[MUST]` Verify Rule Structure:**
    - Use `list_dir` on `.windsurf/rules/master-rules/` and `.windsurf/rules/common-rules/` to confirm all governance rules are in place.
    - Announce the number of rules found and their categories.

### STEP 2: Initial Codebase Mapping

1.  **`[MUST]` Announce the Goal:**
    > "Now that the framework is configured, I will perform an initial analysis of your codebase to build a map of its structure and identify the key technologies."

2.  **`[MUST]` Map the Codebase Structure and Identify Key Files:**
    - **Action 1:** Use `list_dir` and `find_by_name` tools to create a complete view of the project structure.
    - **Action 2:** Identify key files that appear to be project pillars (e.g., `package.json`, `pom.xml`, `main.go`, `index.js`, core configuration files).
    - **Action 3:** Present the proposed file list for confirmation:
        > "I have mapped your repository. To build an accurate understanding, I propose analyzing these key files: `{file_list}`. Does this list cover the main pillars of your project?"
    - **Halt and await user confirmation.**

3.  **`[MUST]` Analyze Key Files and Confirm Stack:**
    - Use `read_file` to read and analyze the content of the user-approved files.
    - Confirm the technology stack, dependencies, and build scripts.

### STEP 3: Thematic Investigation Plan

1.  **`[MUST]` Generate and Announce Thematic Questions:**
    - Based on the confirmed stack, generate a list of key architectural questions, grouped by theme.
    - Announce the plan:
        > "To understand your project's conventions, I will now investigate the following key areas:
        > - **Security:** How are users authenticated and sessions managed?
        > - **Data Flow:** How do different services communicate?
        > - **Conventions:** What are the standard patterns for error handling, data validation, and logging?
        > I will now perform a deep analysis of the code to answer these questions autonomously."

### STEP 4: Autonomous Deep Dive & Synthesis

1.  **`[MUST]` Perform Deep Semantic Analysis:**
    - For each thematic question, use `code_search` and `grep_search` tools to investigate core architectural processes.
    - Find concrete implementation patterns in the code.

2.  **`[MUST]` Synthesize Findings into Principles:**
    - For each answer found, synthesize the code snippets into a high-level architectural principle.
    - **`[GUIDELINE]` Avoid Over-Engineering:** The synthesized principle should represent the simplest, most direct solution observed.
    - **Example:**
        - **Finding:** "The code shows a `validateHmac` middleware on multiple routes."
        - **Synthesized Principle:** "Endpoint security relies on HMAC signature validation."

### STEP 5: Collaborative Validation (The "Checkpoint")

1.  **`[MUST]` Present a Consolidated Report for Validation:**
    > "My analysis is complete. Here is what I've understood. Please validate, correct, or complete this summary.
    >
    > ### ✅ My Understanding (Self-Answered)
    > - **Authentication:** {findings}
    > - **Error Handling:** {findings}
    >
    > ### ❓ My Questions (Needs Clarification)
    > - **Inter-service Communication:** {question}
    >
    > I will await your feedback before building the Context Kit."
    - **Halt and await user validation.**

### STEP 6: Iterative Generation Phase 1: Documentation (READMEs)

1.  **`[MUST]` Announce the Goal:**
    > "Thank you for the validation. I will now create or enrich the `README.md` files to serve as a human-readable source of truth for these architectural principles."

2.  **`[MUST]` Generate, Review, and Validate READMEs:**
    - Propose a plan of `README.md` files to create/update.
    - Use `write_to_file` or `edit` tools to generate each file iteratively, based on the **validated principles** from STEP 4.
    - Await user approval for each one.

### STEP 7: Iterative Generation Phase 2: Project Rules

1.  **`[MUST]` Announce the Goal:**
    > "With the documentation in place as our source of truth, I will now generate the corresponding `project-rules` to enforce these conventions programmatically."

2.  **`[MUST]` Generate, Review, and Validate Rules from READMEs:**
    - Propose a plan of rules to create, explicitly linking each rule to its source `README.md`.
    - Use `write_to_file` to generate each rule in `.windsurf/rules/project-rules/`, ensuring it follows the rule creation guidelines from `6-how-to-create-effective-rules.md`.
    - Await user approval for each rule.

### FINALIZATION

> "The initial context bootstrapping is complete. We now have a solid 'Version 1.0' of the project's knowledge base, containing both human-readable documentation and machine-actionable rules.
>
> This is a living system. Every future implementation will give us an opportunity to refine this context through the `/retro` workflow, making our collaboration progressively more intelligent and efficient.
>
> You are now ready to use the main development workflow, starting with `/define`."
