# AgentHarness

AgentHarness is a portable process layer for AI coding agents. It makes agents state requirements, choose a design, implement within project rules, verify the result, and deliver a clear closeout instead of jumping straight into edits.

It is for teams using tools like Codex, Claude Code, Gemini CLI, or custom coding agents inside real repositories where "just change the code" often turns into skipped context, half-finished refactors, vague verification, or messy docs.

中文说明：[README.zh-CN.md](README.zh-CN.md)

## Why It Exists

AI coding agents are useful, but they fail in predictable ways:

- They start coding before the requirement boundary is clear.
- They make local fixes that violate project architecture.
- They call one small work package "done" while the larger migration is still open.
- They mix stable docs, transition plans, and execution checklists in the same place.
- They say something is verified without showing what was actually run.

AgentHarness turns those failure modes into a small, repeatable workflow:

```text
Requirement -> Design -> Implementation -> Verification -> Delivery
```

The point is not more ceremony. The point is to make agent work reviewable, resumable, and harder to derail.

## What You Get

- **Task templates** for bug fixes, features, refactors, UI changes, and cross-module work.
- **Stage gates** that force the agent to record scope, design, implementation, verification, and delivery.
- **Autopilot rules** so gates are process records, not approval pauses.
- **Project adapters** for repo-specific facts, high-risk paths, and local rules.
- **Operations docs** for long-running migrations and remediation work.
- **Lightweight process checks** to catch broken Markdown structure and known harness rule issues.

## 30-Second Example

Without a process layer:

```text
User: Fix the deployment page bug.
Agent: I changed three files. It should work now.
```

With AgentHarness:

```text
Task type
Bug

Requirement gate
- Symptom: deployment page fails when the selected host is missing.
- Boundary: keep API shape and routing unchanged.
- Expected behavior: show an actionable empty state.
- Verification: targeted unit test and smoke path.

Design gate
- Fix point: normalize missing host state in the store, not inside the component.
- Risk: host selection is shared by deployment and branch flows.
- Rules: preserve Pinia state path and existing router entry.

Verification gate
- `npm run test:unit -- deploy-host-selection`: pass
- Manual smoke: deployment page empty state renders
- Not covered: real SSH connection
```

The agent still moves quickly, but reviewers can see what it believed, what it touched, and what it did not verify.

More examples:

- [Bug fix gate output](examples/bug-fix-gate-output.md)
- [Long-running remediation board](examples/long-running-remediation.md)

## Quick Start

Copy this directory into your repository:

```text
your-repo/
└── harness/
    └── process/
```

Create or update `AGENTS.md` at the repo root. You can start from:

```text
harness/process/AGENTS.template.md
```

Generate a project adapter:

```bash
node harness/process/project/create-adapter.js --target harness/process/project/local --name "Local Project Adapter"
```

Fill in the adapter with your repo facts:

- `harness/process/project/local/local.md`
- `harness/process/project/local/rules/`
- optional `harness/process/project/local/automation/`

Ask the agent to follow the harness. A minimal root `AGENTS.md` should say:

```md
# AGENTS.md

Use `harness/process/` as the development workflow.

Before editing code:
- classify the task
- output Requirement gate
- output Design gate
- read the relevant rules

After editing:
- output Implementation gate
- run necessary verification
- output Verification and Delivery gates
```

## Optional npm Scripts

`npm run ...` only works after you add wrappers to your own `package.json`.

```json
{
  "scripts": {
    "process:check": "node harness/process/automation/check-process.js",
    "harness:ops:init": "node harness/process/operations/create-operation-docs.js",
    "harness:create-adapter": "node harness/process/project/create-adapter.js"
  }
}
```

Then you can run:

```bash
npm run process:check
npm run harness:ops:init -- desktop-restructure
npm run harness:create-adapter -- --target harness/process/project/local --name "Local Project Adapter"
```

## Core Model

AgentHarness has two layers:

- **Core**: templates, gates, rules, operations workflow, and checks that are portable across repositories.
- **Project adapter**: repository-specific facts such as module boundaries, high-risk files, local commands, and domain rules.

Keep business facts out of the core. Put them in `project/local/` so the harness can be copied to another repo without carrying the previous repo's architecture.

## Repository Layout

```text
harness/process/
├── AGENTS.template.md
├── README.md
├── README.zh-CN.md
├── automation/
├── docs/
├── examples/
├── gates/
├── operations/
├── project/
├── rules/
└── templates/
```

## More Documentation

- [Workflow reference](docs/workflow-reference.md)
- [Maintaining AgentHarness](docs/maintaining.md)
- [中文工作流参考](docs/workflow-reference.zh-CN.md)
- [中文维护说明](docs/maintaining.zh-CN.md)

The workflow reference defines the closeout target types: `single-task`, `staged/ongoing`, `continuation`, and `explicit-closeout`.

## License

MIT. See [LICENSE](LICENSE).
