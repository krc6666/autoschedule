# HTML Report Format

Render the architecture review as one self-contained HTML file in the OS temp directory. Use Tailwind and Mermaid from CDNs only when network access is available; the report content must remain readable if those resources fail.

## Structure

- Header: repository name, date, and a compact diagram legend.
- Candidate cards: title, strength badge, files, before/after visual, one-sentence problem, one-sentence solution, and short wins.
- Top recommendation: candidate name and one sentence explaining why it comes first.

## Candidate visuals

Choose the smallest useful form:

- Mermaid flowchart for dependencies and call flow.
- Hand-built boxes for one deep module absorbing shallow modules.
- Cross-section for repeated pass-through stages.
- Mass diagram for a wide interface and thin implementation.
- Call-graph collapse for many exposed internal calls becoming one interface.

Keep before and after side by side where practical. Use red only for leakage, amber for warnings, and one restrained accent. Prefer a plain editorial layout over a dashboard.

## Language

Use exactly: module, interface, implementation, depth, deep, shallow, seam, adapter, leverage, locality.

Keep prose short. Describe concrete runtime or test friction, not generic claims such as "cleaner" or "easier to maintain".
