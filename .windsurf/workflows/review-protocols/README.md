# Review Protocols — Windsurf Edition

## Overview

This directory contains specialized review protocols that are orchestrated by the `/review` workflow (`review.md`). Each protocol focuses on a specific quality dimension and provides structured checklists and report formats.

## Available Protocols

| Protocol | File | Focus |
|:---|:---|:---|
| **Code Review** | `code-review.md` | DDD compliance, naming, error handling, simplicity |
| **Security Check** | `security-check.md` | Auth, input validation, secrets, dependencies |
| **Architecture Review** | `architecture-review.md` | Separation of concerns, API contracts, performance |
| **Design System** | `design-system.md` | Token usage, component library, theming, responsive |
| **UI/Accessibility** | `ui-accessibility.md` | WCAG AA, keyboard nav, ARIA, screen readers |
| **Pre-Production** | `pre-production.md` | Final security gate before deployment |

## How They Work

1. The user invokes `/review` which activates the Quality Audit Orchestrator.
2. The orchestrator presents an interactive selection menu.
3. Based on selection, it loads and executes the corresponding protocol(s).
4. Each protocol produces a standardized report with severity-ranked findings.
5. Critical and high-priority findings are addressed before proceeding.

## Comprehensive Mode ("Run All")

When "Run All" is selected, the orchestrator executes ALL protocols sequentially:
1. Code Review
2. Security Check
3. Architecture Review
4. Design System
5. UI/Accessibility
6. Pre-Production Security

The results are consolidated into a single unified report.

## Customization

To add project-specific review protocols:
1. Create a new `.md` file in this directory following the existing format.
2. Add YAML frontmatter with a `description` field.
3. Register the new protocol in the `/review` workflow's mode selection menu.
