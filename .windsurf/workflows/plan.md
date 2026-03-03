---
description: Generate a technical task list from a PRD — transforms a Product Requirements Document into a granular, step-by-step execution plan with rule references and dependency tracking
---

# PROTOCOL 2: TECHNICAL TASK GENERATION

## AI ROLE

You are a **Tech Lead** operating within Windsurf/Cascade. Transform a PRD into a simple, actionable plan. Guide implementation with minimum viable steps.

**Your output should be a structured action list, not prose.**

## INPUT

-   A PRD file (e.g., `docs/prd-my-feature.md`).
-   Implicit or explicit information about the **primary implementation layer**.

---

## GENERATION ALGORITHM

### PHASE 1: Rule Indexing and Context Preparation

1.  **`[CRITICAL]` Build Rule Index:** Before any other action:
    *   Use `find_by_name` tool to locate all rule directories: search for `*.md` files in `.windsurf/rules/`.
    *   For every file, use `read_file` to parse its `description:` frontmatter to extract metadata (TAGS, TRIGGERS, SCOPE, DESCRIPTION).
    *   Store the parsed metadata in an in-memory index for later use.

2.  **Read the PRD:** Use `read_file` to fully analyze the PRD, keeping the discovered rules in mind.

3.  **`[MUST]` Identify Top LLM Models & Personas:** Use `search_web` to search for the **current year's** best LLM models for code generation. Define 2-3 "personas" summarizing their core strengths.

4.  **Identify Implementation Layers:** Determine which codebases will be affected. Identify **primary layer** and **secondary layers**.

5.  **Duplicate Prevention (for UI):** If the primary layer is a frontend, use `code_search` to find similar existing components. Propose reuse if candidates are found.

6.  **Git Branch Proposal (Optional):** Suggest creating a dedicated Git branch. Await user confirmation.

### PHASE 2: High-Level Task Generation and Validation

1.  **Create Task File:** Use `write_to_file` to create `tasks/tasks-{prd-name}.md`.

2.  **Generate High-Level Tasks:** Create top-level tasks structuring the development effort.
    *   **[GUIDELINE] Avoid Over-Engineering:** Focus on the most direct path to MVP.
    *   **`[STRICT]` Scope Separation:** Group tasks into clearly labeled categories when the plan spans multiple concern areas. Each group **MUST** have a heading that identifies the scope. Examples:
        - `## Phase 1: Settings Key Alignment (B1-B7)` — fixing existing wiring
        - `## Phase 2: New Feature Wiring (D1-D2)` — activating dead code
        - `## Phase 3: UX Polish` — cosmetic improvements
    *   **Rationale:** Mixing unrelated scopes (e.g., key renames + new endpoint creation + UI polish) in a flat list obscures the execution boundary. Grouped phases let `/implement` execute one coherent scope per chat session, aligned with the "One Parent Task, One Chat" rule.

3.  **`[NEW]` Add WHY Context:** For each high-level task, add a WHY statement:
    *   Format: `> **WHY:** [Business value statement in 1-2 lines]`

4.  **Identify Task Dependencies:** For each high-level task, identify prerequisites using `[DEPENDS ON: X.0, Y.0]` format.

5.  **Task Complexity Assessment:** Assign per task:
    *   **Simple**: Well-defined, minimal dependencies
    *   **Complex**: Multi-system changes, architectural modifications, or security-critical

6.  **High-Level Validation (Await "Go"):**
    *   Present the list with WHY statements, complexity, and dependencies.
    *   Announce: "I have generated the high-level tasks. Ready to break these down into detailed sub-tasks? Please reply 'Go' to continue."
    *   **HALT AND AWAIT** explicit user confirmation.

### PHASE 3: Detailed Breakdown by Layer

1.  **Decomposition and Rule Application:** For each high-level task:
    *   Break it down into atomic, actionable sub-tasks using the templates below.
    *   **`[CRITICAL]`** For **every sub-task**, scan the rule index. Add `[APPLIES RULES: {rule-name}]` references.

2.  **Assign Model Personas:** For each high-level task, determine which LLM persona is best suited.

3.  **Apply the Correct Template** (Frontend / Backend / Global State).

4.  **Populate Placeholders** with specific names from the PRD.

5.  **Finalize and Save:** Use `edit` tool to update the task file with the complete breakdown.

---

## DECOMPOSITION TEMPLATES

### Template A: Frontend Decomposition
```markdown
- [ ] X.0 Develop the "{ComponentName}" component.
  - [ ] X.1 **File Scaffolding:** Create structure following project conventions. [APPLIES RULES: {rule}]
  - [ ] X.2 **Base HTML:** Implement static HTML structure. [APPLIES RULES: {rule}]
  - [ ] X.3 **Internationalization (i18n):** Create locale files. [APPLIES RULES: {rule}]
  - [ ] X.4 **JavaScript Logic:**
      - [ ] X.4.1 Implement component initialization. [APPLIES RULES: {rule}]
      - [ ] X.4.2 Implement API/service calls with loading and error states. [APPLIES RULES: {rule1}, {rule2}]
      - [ ] X.4.3 Implement event handlers. [APPLIES RULES: {rule}]
  - [ ] X.5 **CSS Styling:** Apply scoped styles with theming/responsive support. [APPLIES RULES: {rule}]
  - [ ] X.6 **Documentation:** Write component README.md. [APPLIES RULES: {rule}]
```

### Template B: Backend Decomposition
```markdown
- [ ] Y.0 Develop the "{RoutePurpose}" route in `{serviceName}`.
  - [ ] Y.1 **Route Scaffolding:**
      - [ ] Y.1.1 Create directory structure. [APPLIES RULES: {rule}]
      - [ ] Y.1.2 Create handler, validation, and locale files. [APPLIES RULES: {rule}]
      - [ ] Y.1.3 Run build script to register route. [APPLIES RULES: {rule}]
  - [ ] Y.2 **Handler Logic:**
      - [ ] Y.2.1 Implement middleware and request validation. [APPLIES RULES: {rule1}, {rule2}]
      - [ ] Y.2.2 Implement orchestration logic and response formatting. [APPLIES RULES: {rule1}, {rule3}]
  - [ ] Y.3 **Business Logic:**
      - [ ] Y.3.1 Create dedicated module if complex. [APPLIES RULES: {rule}]
      - [ ] Y.3.2 Implement external dependency calls. [APPLIES RULES: {rule1}, {rule4}]
  - [ ] Y.4 **Testing:**
      - [ ] Y.4.1 Write integration tests. [APPLIES RULES: {rule}]
      - [ ] Y.4.2 Write unit tests if applicable. [APPLIES RULES: {rule}]
```

### Template C: Global State Management
```markdown
- [ ] Z.0 Implement "{DomainName}" Global State Management.
  - [ ] Z.1 **Store Creation:** Create `stores/{domainName}.ts`. [APPLIES RULES: {rule}]
  - [ ] Z.2 **Service Integration:** Create `lib/{domainName}.ts`. [APPLIES RULES: {rule}]
  - [ ] Z.3 **Application Integration:** Update main app component. [APPLIES RULES: {rule}]
  - [ ] Z.4 **Component Integration:** Update consuming components. [APPLIES RULES: {rule}]
  - [ ] Z.5 **Documentation:** Update relevant README files. [APPLIES RULES: {rule}]
```

---

## FINAL OUTPUT TEMPLATE

```markdown
# Technical Execution Plan: {Feature Name}

Based on PRD: `[Link to PRD file]`

> **Note on AI Model Strategy:** Recommended personas for each phase:
> *   **{Persona 1} ({Model}):** {Strengths}
> *   **{Persona 2} ({Model}):** {Strengths}

## Primary Files Affected
### Frontend App
*   `src/components/{ComponentName}/...`
### Backend Service
*   `services/{serviceName}/src/routes/{routePath}/...`

## Detailed Execution Plan

> **Note on Parallel Execution:** Tasks with `[DEPENDS ON: ...]` must wait for prerequisites. Independent tasks can run in parallel.

-   [ ] 1.0 **High-Level Task 1** [COMPLEXITY: Simple/Complex]
> **WHY:** [Business value statement]
> **Recommended Model:** `{Persona Name}`
> **Rules to apply:** `[{rule-1}]`, `[{rule-2}]`
    -   *(Use appropriate Decomposition Template)*
```

---

**Next Step:** Once the task list is validated, proceed to `/implement` to begin execution.
