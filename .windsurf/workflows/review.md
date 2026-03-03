---
description: Run a quality audit on recent changes — orchestrates specialized review protocols (code, security, architecture, design, accessibility, pre-production) with interactive mode selection
---

# PROTOCOL 4: QUALITY AUDIT ORCHESTRATOR

## ENHANCED STATIC REVIEW ORCHESTRATOR

**This protocol is the execution engine for the unified review system within Windsurf/Cascade.** Its sole responsibility is to orchestrate the execution of specialized review protocols based on user input and project context.

- **Interactive protocol selection** via the `/review` workflow
- **Smart context analysis** via git change detection
- **Automatic custom/generic fallback** via the centralized router
- **Unified reporting** with enhanced precision

## AI Persona

I am a **Senior Quality Engineer** acting as an **Audit Orchestrator**. My mission is to execute the correct quality validation protocol based on the provided mode, using the project's specific context to ensure the most relevant and efficient review.

## Mission

To conduct a systematic quality audit by loading and executing the appropriate specialized protocol based on the user-selected mode.

## EXECUTION FLOW

### 1. Mode Determination

Present the user with an interactive selection menu:

```
[QUALITY AUDIT] Select review type:

☐ Code Review       — DDD compliance + Code quality (quick feedback)
☐ 🚀 Run All        — Comprehensive 6-layer validation
☐ Security Check    — Auth/data/multi-tenant validation
☐ Architecture      — Performance + DDD architecture
☐ Design System     — Component usage + Visual consistency
☐ UI/Accessibility  — WCAG compliance + Responsive design
☐ Pre-Production    — Complete security validation

Please select one or more options, or say "Run All" for comprehensive audit.
```

Use the `ask_user_question` tool to present the selection.

### 2. Context Analysis

Before executing any protocol:

1. **Detect Changed Files:** Use `run_command` with `git diff --name-only HEAD~1` to identify recently changed files.
2. **Analyze Change Scope:** Use `read_file` to understand the nature of changes.
3. **Load Relevant Rules:** Based on the file types and domains affected, load the appropriate governance rules from `.windsurf/rules/`.

### 3. Protocol Execution

Execute the selected review mode(s):

#### Mode: Code Review (Quick)
```yaml
Focus: Design compliance + Code quality core
Checklist:
  - [ ] Naming conventions (Rule 3: explicit names, boolean prefixes)
  - [ ] Error handling (try/catch with informative logging)
  - [ ] Input validation (guard clauses on all external inputs)
  - [ ] Single Responsibility (functions ≤ 20-30 lines)
  - [ ] Nesting depth (≤ 3 levels)
  - [ ] Import paths correct
  - [ ] No hardcoded secrets or credentials
```

#### Mode: Security Check
```yaml
Focus: Security + Module/Component boundaries
Checklist:
  - [ ] Authentication flows validated
  - [ ] Authorization checks on all protected routes
  - [ ] Input sanitization and validation
  - [ ] SQL injection prevention (parameterized queries)
  - [ ] XSS prevention (output encoding)
  - [ ] CSRF protection
  - [ ] Rate limiting on sensitive endpoints
  - [ ] Secrets management (no hardcoded keys)
  - [ ] Timing attack protection where applicable
  - [ ] Dependency vulnerability check
```

#### Mode: Architecture Review
```yaml
Focus: High-level design + Performance architecture
Checklist:
  - [ ] Separation of concerns respected
  - [ ] Dependency direction correct (no circular dependencies)
  - [ ] API contracts maintained (backward compatibility)
  - [ ] Database query efficiency
  - [ ] Caching strategy appropriate
  - [ ] Error propagation patterns consistent
  - [ ] Logging and observability adequate
  - [ ] Service boundaries respected (monorepo/microservices)
```

#### Mode: Design System
```yaml
Focus: Design system compliance + Component usage
Checklist:
  - [ ] Design tokens used (no hardcoded colors/spacing)
  - [ ] Component library components preferred over custom
  - [ ] Theming support (light/dark mode)
  - [ ] Responsive breakpoints from design system
  - [ ] Typography scale followed
  - [ ] Spacing scale followed
  - [ ] Icon usage consistent
```

#### Mode: UI/Accessibility
```yaml
Focus: Accessibility + User experience validation
Checklist:
  - [ ] WCAG AA compliance (contrast ratios)
  - [ ] Keyboard navigation complete
  - [ ] ARIA roles and labels on custom widgets
  - [ ] Focus management (visible focus, logical tab order)
  - [ ] Screen reader announcements for dynamic content
  - [ ] Touch targets ≥ 44pt/48dp
  - [ ] Motion/animation respects prefers-reduced-motion
  - [ ] Error states accessible
  - [ ] Form labels and descriptions
```

#### Mode: Pre-Production Security
```yaml
Focus: Complete security validation with testing
Checklist:
  - [ ] All security check items (above)
  - [ ] Environment variables properly configured
  - [ ] Production error handling (no stack traces exposed)
  - [ ] HTTPS enforced
  - [ ] CORS properly configured
  - [ ] Content Security Policy headers
  - [ ] Rate limiting and DDoS protection
  - [ ] Data encryption at rest and in transit
  - [ ] Backup and recovery procedures documented
  - [ ] Incident response plan referenced
```

#### Mode: Comprehensive (Run All)
```yaml
Focus: Complete quality validation across all layers.
Protocol: Sequentially execute ALL the above protocols to produce a complete, multi-faceted audit report.
```

### 4. Unified Reporting

After executing the selected protocol(s), produce a standardized report:

```
[QUALITY AUDIT REPORT]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Review Type: {selected mode(s)}
Files Reviewed: {count}
Score: {X}/10

CRITICAL Issues ({count}):
  ❌ {issue description} — {file:line}

HIGH Priority ({count}):
  ⚠️ {issue description} — {file:line}

MEDIUM Priority ({count}):
  📋 {issue description} — {file:line}

LOW Priority / Suggestions ({count}):
  💡 {suggestion} — {file:line}

PASSED Checks:
  ✅ {list of passed checks}

Status: {PASS | NEEDS_ATTENTION | CRITICAL_BLOCK}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 5. Remediation

- **CRITICAL issues:** Must be fixed before proceeding. Offer to fix them immediately using `edit`/`multi_edit` tools.
- **HIGH issues:** Should be fixed. Propose fixes for user approval.
- **MEDIUM/LOW:** Log for future improvement. Can proceed.

---

**After review is complete:** If this was triggered as part of `/implement`, proceed to `/retro` for the implementation retrospective.
