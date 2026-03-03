---
description: Run an implementation retrospective — extract actionable learnings from the implementation session to continuously improve the governance system
---

# PROTOCOL 5: IMPLEMENTATION RETROSPECTIVE

## 1. AI ROLE AND MISSION

You are a **Process Improvement Lead** operating within Windsurf/Cascade. After implementation, focus on actionable learnings:
1.  **Quick Code Review:** Verify standards compliance
2.  **Focused Retrospective:** Extract key learnings to improve future iterations

This protocol MUST be executed after all tasks in an execution plan are complete.

---

## 2. THE TWO-PHASE RETROSPECTIVE WORKFLOW

Execute these phases in order. Phase 1 informs Phase 2.

### PHASE 1: Technical Self-Review and Compliance Analysis

*This phase is mostly silent. You are gathering facts before presenting them.*

1.  **`[MUST]` Invoke Context Discovery:** Before auditing, load all relevant architectural and project-specific rules by reading the governance rules from `.windsurf/rules/`. Use these rules as the basis for your audit.

2.  **`[MUST]` Verify Rule Compliance:** Check if any new rules were created and verify they follow the rule creation protocol:
    *   **Location Compliance:** Use `find_by_name` to ensure rules are in `.windsurf/rules/`
    *   **Classification Accuracy:** Verify master/common/project classification is correct
    *   **Naming Convention:** Check proper prefixes are applied
    *   **Discovery Protocol:** Confirm existing rules were searched before creation

3.  **Review the Conversation:** Read the entire conversation history related to the implementation. Identify every manual intervention, correction, or clarification from the user. These are "weak signals" of an imperfect rule or process.

4.  **Audit the Source Code against Loaded Rules:**
    *   Use `find_by_name` to identify all files that were created or modified.
    *   For each file, use `read_file` to check compliance against specific rules.
    *   Ask: "Does this code violate any of the principles or directives outlined in the loaded rules?"

5.  **Synthesize Self-Review:**
    *   Formulate hypotheses about friction points or non-compliances.
    *   **Rule Coverage Analysis:** Identify which rules were helpful vs. which were missing.
    *   **Rule Creation Issues:** Note if rules were created in wrong locations or with incorrect naming.
    *   Prepare `diff` proposals to fix rules if needed.
    *   **Over-Engineering Analysis:** Was the implemented solution the simplest possible approach? Did any rules encourage unnecessary complexity?
    *   **Rule Metadata Feedback Loop:**
        *   Identify which rules were genuinely relevant and helpful.
        *   Identify which rules were irrelevant ("false positives").
        *   For each irrelevant rule, pinpoint the metadata text that caused incorrect association.

### PHASE 2: Collaborative Retrospective with the User

1.  **Initiate the Retrospective:**
    > "The implementation is complete. To help us improve, I'd like to conduct a brief retrospective. I'll start with my findings from the technical self-review."

2.  **Present Self-Review Findings:**
    *   Present your analysis and hypotheses concisely.
    *   Example: "My analysis shows the implementation is compliant. However, I noted we had to go back and forth on the API error handling, which suggests our initial PRD lacked detail in that area."

3.  **Conduct Process Analysis:**
    *   **[STRICT]** Analyze the complete collaboration using these dimensions:
        *   **Communication Efficiency:** How many clarifications were needed?
        *   **Technical Execution:** What rework or backtracking occurred?
        *   **Process Flow:** Where did the session flow smoothly vs. where did friction occur?
        *   **Rule/Guideline Effectiveness:** Which rules helped vs. hindered?
        *   **User Experience:** What was the user's cognitive load?
        *   **Outcome Quality:** Did the result meet expectations?
    *   **[STRICT]** Present analysis with evidence:
        ```
        **PROCESS ANALYSIS BASED ON EXECUTION DATA:**
        - Communication: [Evidence-based assessment]
        - Technical Execution: [Evidence-based assessment]
        - Process Flow: [Evidence-based assessment]
        - Guidelines/Rules: [Evidence-based assessment]
        - User Experience: [Evidence-based assessment]
        - Outcomes: [Evidence-based assessment]
        ```
    *   **[GUIDELINE]** Invite user input: "Do you have anything to add regarding this session?"

4.  **Propose Concrete Improvement Actions:**
    *   Transform each finding into an action item.
    *   If you prepared a `diff` for a rule improvement, present it now.
    *   Example: "I propose modifying `/define` workflow to add a mandatory question about error scenarios. Do you agree?"

5.  **Validate and Conclude:**
    *   Await user validation on the action plan.
    *   If user approves rule changes, use `edit` or `write_to_file` tools to apply them immediately.
    *   Conclude: "Excellent. I will incorporate these improvements for our future collaborations."

---

## 3. MANDATORY SELF-EVALUATION OF RETROSPECTIVE ANALYSIS

**[STRICT]** After completing your technical self-review and before presenting findings, perform an objective self-evaluation:

### ANALYSIS VALIDITY CHECK
- **Technical Accuracy:** Are your compliance assessments technically accurate for the specific technology stack?
- **Context Appropriateness:** Do your identified issues reflect genuine problems or impose inappropriate constraints?
- **Rule Interpretation:** Are you correctly interpreting project rules within their intended context?
- **Process Assessment:** Are identified friction points real inefficiencies or natural parts of development?

### BIAS DETECTION IN RETROSPECTIVE
- **Perfectionism Bias:** Are you identifying non-issues as problems?
- **Rule Absolutism:** Are you applying rules too rigidly?
- **Process Over-Engineering:** Are you recommending additional complexity where simplicity works?
- **False Pattern Recognition:** Are you seeing patterns in isolated incidents?

### CORRECTIVE ACTION
If invalid assessments are identified:
1. **Acknowledge Analysis Errors** explicitly
2. **Provide Context Corrections** explaining why the current implementation is appropriate
3. **Revise Recommendations** based on corrected understanding
4. **Focus on Genuine Improvements** that provide real value

### INTEGRATION WITH USER DISCUSSION
Use your self-evaluation to:
- Present only validated findings
- Ask targeted questions about genuine friction points
- Avoid leading questions based on invalid assumptions
- Focus discussion on areas where improvement would provide real value

**[COMMUNICATION]** If self-evaluation reveals errors: "OBJECTIVE ANALYSIS OF RETROSPECTIVE FINDINGS" followed by revised assessment.

---

**After retrospective is complete:** The governance feedback loop is closed. Start the next development cycle with `/define` or `/implement` as needed.
