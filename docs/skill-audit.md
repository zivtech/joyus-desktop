# Skill Audit for Cowork Plugin Compatibility

**Date**: 2026-03-10
**Source**: `zivtech-meta-skills` repository
**Auditor**: claude-opus (automated)

## Summary

| Metric | Count |
|--------|-------|
| Total skills in repo | 37 |
| README-listed skills | 29 |
| Expansion skills (post-README) | 8 |
| Compatible as-is | 15 |
| Needs minor adaptation (auto-adapted by build script) | 16 |
| Needs major adaptation (auto-adapted, CLI-recommended) | 3 |
| Not suitable for Cowork | 3 |
| **Cowork-distributable** | **34** |

**Note**: The build script (`scripts/build-cowork-plugins.ts`) automatically adapts CLI tool references (e.g., "Use Read to..." → "Review the provided..."). All 19 skills needing adaptation (minor + major) are handled automatically. The 3 "major adaptation" skills (drupal-planner, react-planner, data-planner) work after adaptation but with reduced output quality — users describe their project structure instead of Claude reading files directly. These are marked "CLI-recommended" in their respective bundles.

## Cowork Plugin Format Requirements

Cowork plugins are admin-assigned prompt packages. Each plugin needs:
- **name**: Unique identifier (kebab-case)
- **description**: Human-readable purpose (shown in UI)
- **content**: The prompt markdown (investigation protocol)
- **triggers**: Activation patterns (slash command or keyword matches)

The existing `SKILL.md` format (YAML frontmatter with `name` + `description`, plus markdown body) maps directly to Cowork plugins. The primary adaptation needed is for skills that reference **Claude Code CLI tools** (Read, Grep, Glob, Bash, Write, Edit) — these tools are unavailable in Cowork's web environment.

**Adaptation strategy**: Replace CLI tool instructions with Cowork-compatible alternatives:
- "Use the Read tool to examine..." → "Ask the user to provide..." or "Review the provided..."
- "Search the codebase with Grep..." → "Based on the code the user shares..."
- File path references → "the relevant section" or user-provided context

## Compatibility Categories

### Compatible As-Is (15 skills)

These skills operate entirely on user-provided content with no CLI tool references.

| # | Skill | Domain | Lines | Notes |
|---|-------|--------|------:|-------|
| 1 | brand-voice-guide | Content strategy | 399 | Reference template, no tools needed |
| 2 | chna-planner | Public health | 671 | IRS compliance planning, document-based |
| 3 | drupal-migration-planner | Development | 500 | Planning-only, no file reads |
| 4 | drupal-theme-critic | Development | 403 | Review protocol, works on pasted code |
| 5 | email-campaign-critic | Marketing | 392 | Content review, no file access needed |
| 6 | health-equity-analyzer | Public health | 207 | Standalone assessment module |
| 7 | impact-report-planner | Public health | 97 | Document planning, no tools |
| 8 | manuscript-critic | Research | 352 | CONSORT/STROBE review on pasted content |
| 9 | perf-critic | Development | 414 | Review protocol, evidence from user |
| 10 | policy-brief-critic | Policy | 384 | Evidence quality review |
| 11 | policy-brief-writer | Policy | 526 | Brief generation, 4 types |
| 12 | research-critic | Research | 358 | Study design review |
| 13 | seo-advisor | Marketing | 540 | SEO assessment, standalone |
| 14 | stakeholder-report-writer | Business | 81 | Report generation |
| 15 | dataviz-planner | Data viz | 83 | Chart type decision, specs |

### Needs Minor Adaptation (16 skills)

These skills reference CLI tools (Read, Grep, Glob) in their investigation protocols but the core review/planning logic works on user-provided content. Adaptation: replace tool instructions with "user provides content" patterns.

| # | Skill | Domain | Lines | CLI References | Adaptation |
|---|-------|--------|------:|----------------|------------|
| 1 | a11y-critic | Accessibility | 531 | Read tool, file paths | Replace file reads with "review provided code" |
| 2 | a11y-planner | Accessibility | 780 | Read tool, codebase scan | Replace scan with "based on provided architecture" |
| 3 | ai-readiness-assessor | Business | 735 | Repository/codebase refs | Replace with "based on provided information" |
| 4 | content-model-critic | Drupal | 658 | Source code reading | Replace with "review provided content model" |
| 5 | copy-critic | Content | 613 | File system refs | Replace with "review provided copy" |
| 6 | copy-planner | Content | 526 | Minor file refs | Replace with "based on provided brief" |
| 7 | dashboard-planner | Data viz | 630 | Codebase refs | Replace with "based on provided requirements" |
| 8 | dataviz-critic | Data viz | 582 | File/screenshot refs | Replace with "review provided visualization" |
| 9 | lit-review-planner | Research | 724 | Read tool refs | Replace with "based on provided literature" |
| 10 | proposal-critic | Plans/proposals | 226 | Minor tool refs | Replace with "review provided document" |
| 11 | research-comms-critic | Research | 668 | File reading refs | Replace with "review provided communication" |
| 12 | search-discovery-critic | Development | 750 | Read/codebase refs | Replace with "review provided search config" |
| 13 | taxonomy-critic | Content | 642 | Codebase tool refs | Replace with "review provided taxonomy" |
| 14 | taxonomy-planner | Content | 97 | Minor refs | Replace with "based on provided structure" |
| 15 | data-critic | Data | (sub) | Codebase/formula refs | Replace with "review provided data pipeline" |
| 16 | plan-writer | Business | (sub) | Source code refs | Replace with "based on provided context" |

### Needs Major Adaptation (3 skills)

These skills are deeply integrated with codebase navigation — their protocols assume direct file system access to generate implementation plans with specific file paths and code structures. Core protocol still works but output quality is reduced without codebase access.

| # | Skill | Domain | Lines | Issue | Adaptation |
|---|-------|--------|------:|-------|------------|
| 1 | drupal-planner | Drupal dev | 606 | Reads module files, config schemas, generates file-specific plans | Extract planning protocol; replace file reads with "describe your module structure" |
| 2 | react-planner | React dev | 666 | Scans component tree, reads package.json, generates component-level plans | Extract planning protocol; replace scans with "describe your component architecture" |
| 3 | data-planner | Data | (sub) | Pipeline analysis tied to codebase | Extract planning protocol; replace with requirements-based planning |

**Note**: These skills are most valuable in CLI (Claude Code) where they can read the actual codebase. In Cowork, they can still provide planning guidance but users must manually describe their project structure. Consider marking these as "CLI-recommended" in Cowork.

### Not Suitable for Cowork (3 skills)

Infrastructure/meta skills that are specific to the Claude Code CLI development workflow.

| # | Skill | Domain | Lines | Reason |
|---|-------|--------|------:|--------|
| 1 | spec-kitty-bridge | Infrastructure | (sub) | Routes spec-kitty SDD workflow — requires CLI toolchain |
| 2 | test-builder | Meta/eval | (sub) | Generates eval suites — requires file system write access |
| 3 | test-critic | Meta/eval | (sub) | Reviews eval suites — tied to eval infrastructure |

These skills serve the skill development and evaluation workflow, not end-user productivity. They require CLI tools and should remain CLI-only.

## Namespace Collision Check

Checked skill names against known Cowork built-in commands. No collisions detected. All skill names use domain-specific prefixes (e.g., `drupal-`, `a11y-`, `policy-brief-`) that are unlikely to conflict.

## Prompt Size Assessment

All skills are within reasonable prompt sizes for Cowork plugins:
- **Smallest**: stakeholder-report-writer (81 lines), dataviz-planner (83 lines)
- **Largest**: a11y-planner (780 lines), search-discovery-critic (750 lines)
- **Median**: ~526 lines

No skills exceed expected Cowork plugin size limits. If limits are discovered to be lower, the largest skills (>700 lines) could be split into core protocol + perspective modules.

## Expansion Skills (Not in README)

8 skills were added after the original README count of 29:

| Skill | Domain | Status |
|-------|--------|--------|
| content-model-critic | Drupal content modeling | Needs minor adaptation |
| drupal-migration-planner | Drupal migrations | Compatible as-is |
| drupal-theme-critic | Drupal theming | Compatible as-is |
| impact-report-planner | Public health | Compatible as-is |
| research-comms-critic | Research communications | Needs minor adaptation |
| search-discovery-critic | Search/discovery | Needs minor adaptation |
| taxonomy-critic | Content taxonomy | Needs minor adaptation |
| taxonomy-planner | Content taxonomy | Needs minor adaptation |

All 8 are distributable via Cowork.

## Recommendations

1. **Automate adaptation**: Use `scripts/build-cowork-plugins.ts` to transform skills rather than hand-editing 34 files
2. **Developer skills in Cowork**: Include drupal-planner and react-planner in Developer Bundle but mark as "best with CLI" — they still provide value with user-described context
3. **Phase 2 opportunity**: When desktop companion ships (WP07-WP08), the "needs major adaptation" skills can use local MCP tools via desktop, eliminating the need for adaptation
4. **Version tracking**: Bundle manifests reference skill names, not file paths — version pinning (WP04) handles which version of each skill is distributed
