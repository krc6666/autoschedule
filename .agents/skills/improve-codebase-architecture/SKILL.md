---
name: improve-codebase-architecture
description: Scan a codebase for deepening opportunities, present them as a visual HTML report, then grill through whichever one the owner picks. Use for performance model growth, module coupling, responsibility splits, test seams, and deep-module refactors in autoschedule.
---

# Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities**: refactors that turn shallow modules into deep ones. Aim for testability and AI-navigability.

Use the project's `autoschedule-dev` skill as the development gate. Use the shared `codebase-design` skill for the exact vocabulary **module**, **interface**, **depth**, **seam**, **adapter**, **leverage**, and **locality**. Never use an architecture refactor to bypass `AGENTS.md`, `spec.md`, the central rule contract, or owner confirmation.

## 1. Scope and explore

Follow YAGNI. If the owner names a subsystem or pain point, scan that area. Otherwise inspect a useful stretch of Git history and focus on recurring hot spots.

Read `CONTEXT.md` and relevant ADRs when they exist. Explore organically and record:

- concepts that require bouncing across many shallow modules;
- interfaces nearly as complex as their implementations;
- business logic that leaks across a seam;
- tests that must reach past the current interface;
- duplicated or repeated work that increases model size or runtime.

Apply the deletion test: deleting a useful deep module should spread complexity back across callers. For performance work, establish measurements before refactoring and preserve observable business results.

## 2. Present candidates

Write a self-contained HTML report to `%TEMP%\architecture-review-<timestamp>.html`; do not add it to the repository. Follow [HTML-REPORT.md](HTML-REPORT.md), open it for the owner, and provide its absolute path.

For each candidate include:

- files and modules involved;
- the current friction;
- the proposed deepening in plain language;
- benefits stated as locality, leverage, and test improvement;
- a before/after diagram;
- recommendation strength: `Strong`, `Worth exploring`, or `Speculative`.

End with one top recommendation. Do not propose implementation interfaces until the owner has selected a candidate, unless the owner already selected a concrete candidate and explicitly authorized direct development.

## 3. Develop the selected change

Use the `grilling` skill when the owner asks to stress-test alternatives or when material choices remain. Use `domain-modeling` when naming or changing domain concepts. When the owner has already selected a concrete, behavior-preserving refactor and authorized direct development, proceed through `autoschedule-dev` without repeating resolved questions.

For behavior-preserving performance work:

1. Create a red-capable timing or model-size baseline at the real scheduling interface.
2. State at least three falsifiable hypotheses.
3. Change one performance factor at a time.
4. Compare assignments, vacancies, hours, fatigue, explanations, decisions, feedback, and the full quality vector before and after.
5. Keep architecture refactors separate from business rule changes.
6. Complete all repository validation required by `AGENTS.md`.

Do not create compatibility wrappers, transitional aliases, speculative ports with one adapter, or extra modules that fail the deletion test.
