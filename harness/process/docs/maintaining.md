# Maintaining AgentHarness

This document is for maintainers of the harness itself. It does not need to be read by most users who only copy the harness into a repository.

## Responsibility Split

Keep rules in the narrowest stable place:

- `AGENTS.md`: repo-level hard constraints, trigger rules, red lines, and navigation.
- `README.md`: high-level project introduction and quick start.
- `docs/workflow-reference.md`: general execution model, task sizing, and long-running workflow.
- `templates/`: minimal analysis fields for each task type.
- `gates/`: stage closeout fields, examples, and anti-patterns.
- `rules/`: portable implementation and verification rules.
- `automation/`: generic process checks.
- `project/`: repository facts, business chains, high-risk paths, and replaceable adapter content.

## Maintenance Checklist

When maintaining the harness, check that:

- template triggers, gate order, and workflow defaults agree
- repository-specific facts stay in `project/` or project-specific rules
- automation mapping tables render correctly
- regex values containing `|` are escaped in Markdown tables
- new rules have either a human judgment point or a candidate automated check

## Export Checklist

Before publishing an open-source export:

1. Run targeted process checks.
2. Run harness tests.
3. Export with `node harness/process/export-open-source.js --target <dir>`.
4. Confirm project-local adapter content is not included.
5. Confirm examples and localized README files are included.
