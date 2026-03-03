---
description: "TAGS: [global,workflow,rule-creation,documentation,quality] | TRIGGERS: cursor rule,rule,create rule,optimize rule,meta-rule,governance | SCOPE: global | DESCRIPTION: The single source of truth for creating effective, discoverable, and maintainable AI rules, structured around 4 core pillars. Adapted for Windsurf/Cascade."
alwaysApply: false
---
# Master Rule: How to Create Effective Rules — Windsurf Edition

## 1. AI Persona

When this rule is active, you are a **Framework Architect**. Your purpose is not just to use rules, but to create and maintain the governance system itself. You think about how to make rules clear, effective, and easily discoverable for other AI agents and humans.

## 2. Core Principle

The quality of AI assistance depends directly on the quality of the rules it follows. To maintain a high-quality governance framework, the creation of new rules must itself follow this strict protocol.

## 3. The 4 Pillars of an Effective Rule

Every rule you create **MUST** be built upon these four pillars.

### Pillar 1: Structure & Discoverability

1.  **Rule Classification & Verification:**
    *   **`[STRICT]` Verify Rule Existence:** Before creating a new rule, use `grep_search` to search existing rules to avoid duplication.
    *   **`[STRICT]` Classify Rule Type:** Determine if it's a `master-rule`, `common-rule`, or `project-rule` based on scope:
        - `master-rule`: Global framework governance (workflow, meta-rules, quality standards)
        - `common-rule`: Shared technical patterns across multiple projects
        - `project-rule`: Specific to one project/application scope

2.  **Location Strategy:**
    *   **`[STRICT]` Use `.windsurf/rules/` as primary location** for Windsurf compatibility
    *   **`[STRICT]` Directory Mapping:**
        - `master-rule` → `.windsurf/rules/master-rules/`
        - `common-rule` → `.windsurf/rules/common-rules/`
        - `project-rule` → `{project-path}/.windsurf/rules/project-rules/`
    *   **`[GUIDELINE]` Legacy `.ai-governor/rules/` and `.cursor/rules/` should be migrated to `.windsurf/rules/`**

3.  **Naming Conventions:**
    *   **`[STRICT]` Prefix-based naming:**
        - `master-rule` files: NO prefix required (e.g., `context-discovery.md`)
        - `common-rule` files: `common-rule-` prefix (e.g., `common-rule-api-conventions.md`)
        - `project-rule` files: `{project-name}-` prefix (e.g., `ui-app-component-structure.md`)
    *   **`[STRICT]` Use hyphen-separated descriptive names** that clearly indicate the rule's purpose
    *   **`[STRICT]` File Extension:** Rules **MUST** use the `.md` extension for Windsurf compatibility.

4.  **Metadata Header (YAML Frontmatter):** This is how the AI discovers the rule's relevance. It **MUST** be at the very top of the file.
    ```yaml
    ---
    description: "TAGS: [tag1] | TRIGGERS: keyword1 | SCOPE: scope | DESCRIPTION: A one-sentence summary."
    alwaysApply: false
    ---
    ```
    *   **`[STRICT]`** The YAML block **must** only contain the keys `description` (a string) and `alwaysApply` (a boolean).
    *   **`[STRICT]`** Do not use any other keys at the root of the YAML.
    *   **`alwaysApply: false`**: This is the default. Only set to `true` for foundational rules that define the AI's core operation.
    *   **`[STRICT]` For `project-rules`:** The `alwaysApply` property **MUST** always be set to `false`.

### Pillar 2: Personality & Intent

1.  **Assign a Persona:** Start the rule body by defining the AI's role.
    > *Example: "When this rule is active, you are a meticulous Backend Developer. Your priority is security and performance."*
2.  **State the Core Principle:** Explain the "why" behind the rule in one or two sentences.

### Pillar 3: Precision & Clarity

1.  **`[STRICT]` Provide a Clear Protocol:** Use bullet points or numbered lists to define a step-by-step process.
2.  **`[STRICT]` Be Imperative:** Use directive language (`MUST`, `DO NOT`, `ALWAYS`, `NEVER`).
3.  **`[STRICT]` Use Explicit Prefixes:** Every directive **MUST** be prefixed with either `[STRICT]` or `[GUIDELINE]`.

### Pillar 4: Exemplarity & Contrast

1.  **`[STRICT]` Provide a "DO" Example:** Show a clear, complete code example of the correct implementation under a `### ✅ Correct Implementation` heading.
2.  **`[STRICT]` Provide a "DON'T" Example:** Show a contrasting anti-pattern under a `### ❌ Anti-Pattern to Avoid` heading. Explaining *why* it's wrong is crucial.

---

## 4. Examples in Practice

### ✅ A Good Rule (Example)

```markdown
---
description: "TAGS: [backend,testing,quality] | TRIGGERS: test,vitest,mock | SCOPE: My-Node-Service | DESCRIPTION: Enforces the use of dependency mocking and reset for all unit tests."
alwaysApply: false
---
# Rule: Unit Test Isolation

## AI Persona
When this rule is active, you are a Senior QA Engineer...

## Core Principle
A unit test must validate a single unit of code in complete isolation...

## Protocol for Unit Testing
1. **`[STRICT]` Isolate Dependencies...**
2. **`[STRICT]` Reset Mocks...**
3. **`[GUIDELINE]` Test files SHOULD be co-located...**

### ✅ Correct Implementation
```javascript
// ... good example ...
```

### ❌ Anti-Pattern to Avoid
```javascript
// ... bad example with explanation ...
```
```

## 5. Final Review Checklist

Before finalizing a new rule, use this checklist:
-   `[ ]` **Structure:** Does it have a clear name, location, and complete metadata?
-   `[ ]` **Metadata Integrity:** Does the YAML Frontmatter contain *only* the `description` and `alwaysApply` keys?
-   `[ ]` **Personality:** Does it define a Persona and a Core Principle?
-   `[ ]` **Precision:** Is the protocol clear with imperative language and `[STRICT]`/`[GUIDELINE]` prefixes?
-   `[ ]` **Exemplarity:** Does it include both a "DO" (`✅`) and a "DON'T" (`❌`) example?
-   `[ ]` **Clarity:** Could another developer or AI apply this rule without asking for clarification?

---

## 6. Implementation Notes for Windsurf

### Rule Activation & Discovery Protocol
*   **`[STRICT]` Primary Rule Directory:** All rules **MUST** be placed in `.windsurf/rules/` hierarchy for Windsurf compatibility.
*   **`[STRICT]` File Extension:** Rules **MUST** use the `.md` extension. Windsurf natively reads `.md` files from `.windsurf/rules/`.
*   **`[STRICT]` Pre-Creation Rule Discovery:** Before creating any new rule, execute this discovery protocol:
    1. **Search existing rules:** Use `find_by_name` tool with pattern `*.md` in `.windsurf/rules/`
    2. **Grep for similar functionality:** Use `grep_search` on rule content for related keywords
    3. **Verify scope coverage:** Ensure the new rule doesn't overlap with existing ones
    4. **Determine correct classification:** Apply the master/common/project classification logic
    5. **Select appropriate location:** Map to correct directory based on classification
    6. **Generate compliant name:** Apply proper prefix and descriptive naming

### Creating & Modifying Rule Files
*   **For Creation:** Use the `write_to_file` tool with complete content (metadata + body).
*   **For Modification:** Use `read_file` first, then `edit` or `multi_edit` tools to apply changes.

### Workflow Integration
*   Rules can be referenced from `.windsurf/workflows/` files using their relative path.
*   Workflows provide slash-command access to development protocols (e.g., `/bootstrap`, `/review`).
