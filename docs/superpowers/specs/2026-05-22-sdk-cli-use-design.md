# SDK CLI Use Flow Design

## Goal

Make SDK CLI configuration flow match the Qt CLI pattern: `status` is the first command, `init` only initializes automatically detectable values, `use` explicitly switches saved configuration, and execution commands only read saved configuration.

## Command Model

- `forja sdk status` checks current workspace SDK configuration, project selection, and build environment.
- `forja sdk init` writes only values that can be initialized automatically. It no longer accepts explicit configuration flags.
- `forja sdk use` updates only explicitly provided fields: `--project`, `--mode`, `--arch`, and `--vs-dev-cmd`.
- `forja sdk build`, `forja sdk rebuild`, and `forja sdk clean` accept only `--workspace`, `--json`, and `--plan`.

## Behavior

- `use --project` validates that the project file exists before saving it.
- `use` returns a structured response and points users back to `status`.
- Execution commands fail with `nextActions: ["forja sdk status --json"]` when there is no saved project or no saved SDK config.
- On non-Windows platforms, `x64` is the only accepted SDK arch.
- Existing single-project auto-detection remains limited to `status` and `init`; execution commands do not silently choose a project.

## Documentation

- Update the CLI README SDK section with the status/init/use/build flow.
- Update the CLI interface spec so SDK output examples match current JSON fields.

