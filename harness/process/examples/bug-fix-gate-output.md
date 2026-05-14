# Bug Fix Gate Output Example

This example shows the shape of a compact bug-fix interaction. The exact fields can vary by project, but the important behavior is stable: the agent records scope and design before editing, then records verification after editing.

## User Request

```text
Fix the deployment page crash when no host is selected.
```

## Agent Output Before Editing

```text
Task type
Bug

Requirement gate
- Symptom: deployment page crashes when selected host is missing.
- Expected behavior: render an empty state and keep the deploy action disabled.
- Boundary: do not change route names, API shape, or persisted host data.
- Verification: targeted component/store test and manual page smoke.

Design gate
- Fix point: normalize missing host state in the store selector.
- UI behavior: component consumes the normalized state and renders the existing empty state component.
- Risk: host selection is shared by deploy and branch workflows.
- Rules: preserve router entry and Pinia state path.
```

## Agent Output After Editing

```text
Implementation gate
- Changed: host selection selector and deployment empty-state branch.
- Kept: route names, API shape, persisted data format.

Verification gate
- `npm run test:unit -- deployment-host-selection`: pass
- Manual smoke: deployment page loads with no selected host.
- Not covered: real SSH connection to a remote host.

Delivery gate
- Completed: missing-host crash fixed and covered by targeted verification.
- Remaining risk: real host deployment path was not exercised.
```

## Why This Helps

The reviewer can quickly answer:

- What bug did the agent think it was fixing?
- What did it explicitly avoid changing?
- Where did it choose to fix the behavior?
- What evidence supports the delivery claim?
- What is still unverified?
