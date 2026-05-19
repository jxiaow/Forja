# Requirements Document

## Introduction

将两个独立的 VSCode 扩展项目（xy-qt-tools 和 sdk-pilot）合并为一个统一的 "Compilot" 项目。合并后的项目以单一 .vsix 输出，提供 Qt/C++ 开发（qmake 项目）和通用 SDK/库编译（.sln/Makefile 项目）两大功能域，并通过统一的 CLI 入口（`compilot qt ...` / `compilot sdk ...`）和 MCP Server 对外暴露能力。

## Glossary

- **Compilot**: 合并后的统一 VSCode 扩展，包含 Qt 和 SDK 两个功能域
- **Qt_Module**: Compilot 中负责 Qt/C++ 项目管理的功能模块（原 xy-qt-tools）
- **SDK_Module**: Compilot 中负责通用 SDK/库项目编译的功能模块（原 sdk-pilot）
- **Extension_Host**: VSCode 扩展运行时入口（extension.ts），负责激活和命令注册
- **CLI_Dispatcher**: CLI 入口模块，根据子命令（qt/sdk）分发到对应模块逻辑
- **Core_Layer**: 共享基础设施层，包含日志、配置、状态管理、平台检测等
- **MCP_Server**: Model Context Protocol 服务端，为 AI 工具提供项目操作接口
- **Build_Config**: 编译配置对象，包含模式（debug/release）、架构（x86/x64）、工具链路径等
- **Project_Entry**: 项目入口文件（.pro 文件用于 Qt，.sln/Makefile 用于 SDK）
- **VS_DevShell**: Visual Studio Developer Command Prompt 环境，提供 MSVC 编译工具链

## Requirements

### Requirement 1: Unified Extension Entry Point

**User Story:** As a developer, I want a single VSCode extension that activates for both Qt (.pro) and SDK (.sln/Makefile) projects, so that I only need to install one extension for all native C++ build workflows.

#### Acceptance Criteria

1. WHEN a workspace contains at least one .pro file at any directory depth, THE Extension_Host SHALL activate the Qt_Module by registering all Qt commands and displaying Qt-related status bar items
2. WHEN a workspace contains at least one .sln file or Makefile at any directory depth, THE Extension_Host SHALL activate the SDK_Module by registering all SDK commands and displaying SDK-related status bar items
3. WHEN a workspace contains both .pro files and .sln or Makefile files, THE Extension_Host SHALL activate both the Qt_Module and the SDK_Module independently
4. IF a workspace contains no .pro, .sln, or Makefile files, THEN THE Extension_Host SHALL not activate either module and SHALL not register any module commands or display any status bar items
5. THE Extension_Host SHALL register all Qt operation commands under the `compilot.qt.*` prefix
6. THE Extension_Host SHALL register all SDK operation commands under the `compilot.sdk.*` prefix
7. THE Extension_Host SHALL use "compilot" as the extension identifier name in package.json
8. THE Extension_Host SHALL use "Compilot" as the displayName in package.json
9. THE Extension_Host SHALL complete module activation within 5 seconds of workspace open

### Requirement 2: Command Namespace Migration

**User Story:** As a developer, I want all commands to use a consistent `compilot.*` prefix, so that the extension feels unified and discoverable in the command palette.

#### Acceptance Criteria

1. THE Extension_Host SHALL register Qt commands exclusively with the prefix `compilot.qt.` and SHALL NOT register any commands with the previous `qtPilot.` prefix
2. THE Extension_Host SHALL register SDK commands exclusively with the prefix `compilot.sdk.` and SHALL NOT register any commands with the previous `sdkPilot.` prefix
3. WHEN the user invokes any `compilot.qt.*` command, THE Qt_Module SHALL execute the same handler function that was previously bound to the corresponding `qtPilot.*` command, producing identical observable behavior (same task execution, same terminal output, same user notifications)
4. WHEN the user invokes any `compilot.sdk.*` command, THE SDK_Module SHALL execute the same handler function that was previously bound to the corresponding `sdkPilot.*` command, producing identical observable behavior (same task execution, same terminal output, same user notifications)
5. THE Extension_Host SHALL register the following Qt commands under `compilot.qt.`: selectProject, showActions, qmake, build, clean, run, stop, debug, openWithQtDesigner, syncTestConnection, syncChangedFiles (11 commands total)
6. THE Extension_Host SHALL register the following SDK commands under `compilot.sdk.`: build, rebuild, clean, showActions (4 commands total)
7. WHEN the user searches "compilot" in the command palette, THE Extension_Host SHALL display all 15 registered commands (11 Qt + 4 SDK) as matching results

### Requirement 3: Shared Core Infrastructure

**User Story:** As a maintainer, I want shared infrastructure (logging, configuration, platform detection) extracted into a common core layer, so that both modules reuse the same patterns and reduce code duplication.

#### Acceptance Criteria

1. THE Core_Layer SHALL provide a logging service exposing info, warn, and error level functions and a createLogger factory that returns a scoped logger instance prefixed with a caller-supplied scope name, usable by both Qt_Module and SDK_Module for output channel logging
2. THE Core_Layer SHALL provide platform detection utilities that return the current OS as one of "windows" or "linux" and the current architecture as one of "x86" or "x64", shared across modules
3. THE Core_Layer SHALL provide a VS_DevShell detection service that resolves the DevShell script path by querying vswhere or accepting a manual override path, returning the path as a string or null if not found
4. THE Core_Layer SHALL provide a state management interface supporting get, set, and change-subscription operations that each module instantiates independently so that state mutations in one module do not affect the other module's instance
5. THE Core_Layer SHALL NOT contain import statements referencing the `vscode` namespace in any module unless that module's file path resides under a directory named "vscode-integrated"
6. WHEN the Core_Layer successfully resolves a VS_DevShell path, THE Core_Layer SHALL cache the result in memory for the lifetime of the host process so that subsequent lookups by either module return the cached value without re-detection
7. IF the VS_DevShell detection service cannot locate a valid DevShell path and no manual override is provided, THEN THE Core_Layer SHALL return null without throwing an error

### Requirement 4: Directory Structure Reorganization

**User Story:** As a maintainer, I want the source code organized into clear domain directories (core/, qt/, sdk/, ui/, mcp/, cli/), so that module boundaries are explicit and navigation is intuitive.

#### Acceptance Criteria

1. THE Compilot project SHALL organize source code under `src/core/` for shared infrastructure including state management, configuration services, settings IO, workspace resolution, and logging
2. THE Compilot project SHALL organize Qt-specific logic under `src/qt/` including build/, project/, env/, sync/, and shared/ subdirectories
3. THE Compilot project SHALL organize SDK-specific logic under `src/sdk/` including build/, project/, and platform/ subdirectories
4. THE Compilot project SHALL organize UI components under `src/ui/` including status bar modules and a configPanel/ subdirectory for webview configuration panels
5. THE Compilot project SHALL organize MCP server code under `src/mcp/`
6. THE Compilot project SHALL organize CLI entry and dispatch code under `src/cli/` including the entry point, argument parsing, and type definitions
7. THE Compilot project SHALL maintain a single `src/extension.ts` as the unified entry point that activates modules and registers commands without containing business logic
8. THE Compilot project SHALL place unit tests under `src/test/` at the top level of the src/ directory
9. THE Compilot project SHALL enforce that `src/qt/` modules do not import from `src/sdk/` and `src/sdk/` modules do not import from `src/qt/`
10. THE Compilot project SHALL enforce that `src/core/`, `src/cli/`, and `src/mcp/` do not import from the `vscode` namespace, except for modules explicitly marked as vscode-integrated

### Requirement 5: Unified CLI with Subcommand Dispatch

**User Story:** As a CLI user (human or AI agent), I want a single CLI binary that dispatches to Qt or SDK operations via subcommands (`compilot qt build`, `compilot sdk build`), so that I have one tool for all native build operations.

#### Acceptance Criteria

1. THE CLI_Dispatcher SHALL accept `qt` as the first subcommand and forward all remaining arguments to Qt_Module CLI logic
2. THE CLI_Dispatcher SHALL accept `sdk` as the first subcommand and forward all remaining arguments to SDK_Module CLI logic
3. WHEN no subcommand is provided, THE CLI_Dispatcher SHALL display a help message listing the available subcommands (`qt`, `sdk`) and exit with code 0
4. WHEN an unknown subcommand is provided (any first argument that is not `qt`, `sdk`, `--help`, or `-h`), THE CLI_Dispatcher SHALL output an error message indicating the unrecognized subcommand, list the available subcommands, and exit with code 1
5. THE CLI_Dispatcher SHALL support a `--json` flag that, when present, causes all output (success and error) from both subcommands to be emitted as a single JSON object to stdout
6. THE CLI_Dispatcher SHALL NOT depend on the `vscode` namespace
7. WHEN `compilot qt build` is invoked, THE Qt_Module SHALL execute the same build logic as the existing `qt-pilot build` CLI command, accepting the same options (`--workspace`, `--project`, `--mode`, `--execute`, `--json`)
8. WHEN `compilot sdk build` is invoked, THE SDK_Module SHALL execute a build operation for the detected .sln or Makefile project in the current workspace
9. IF `compilot sdk build` is invoked and no .sln file or Makefile is detected in the workspace, THEN THE SDK_Module SHALL output an error message indicating no supported project was found and exit with code 1
10. THE CLI_Dispatcher SHALL exit with the same exit code returned by the dispatched submodule (0 for success, non-zero for failure)

### Requirement 6: Configuration Namespace Migration

**User Story:** As a developer, I want extension settings organized under `compilot.qt.*` and `compilot.sdk.*` namespaces, so that configuration is consistent with the unified extension identity.

#### Acceptance Criteria

1. THE Extension_Host SHALL register Qt configuration properties under the `compilot.qt` section in the VS Code `contributes.configuration` manifest
2. THE Extension_Host SHALL register SDK configuration properties under the `compilot.sdk` section in the VS Code `contributes.configuration` manifest
3. THE Extension_Host SHALL preserve all existing Qt configuration keys (qtPath, vsDevShellPath, manualProPath, designerPath, mode, arch) under the new `compilot.qt.*` namespace with their original types, defaults, and scope unchanged
4. THE Extension_Host SHALL preserve all existing SDK configuration keys (pinnedProject, mode, arch, vsDevCmdPath, scanDepth) under the new `compilot.sdk.*` namespace with their original types, defaults, and scope unchanged
5. WHEN the extension reads or writes configuration at runtime, THE Extension_Host SHALL use the `compilot.qt` or `compilot.sdk` namespace prefix exclusively
6. IF a user has existing settings stored under a previous namespace, THEN THE Extension_Host SHALL read the previous namespace value as a fallback when the new namespace key has no user-defined value
7. THE Extension_Host SHALL NOT register configuration properties under the previous `sdkPilot` or `qtPilot` namespace sections

### Requirement 7: TypeScript Compilation Unification

**User Story:** As a maintainer, I want a single tsconfig.json that compiles all source code (extension + CLI + MCP) in one pass, so that the build process is simple and consistent.

#### Acceptance Criteria

1. THE Compilot project SHALL use exactly one tsconfig.json located in the repository root directory, with no additional tsconfig files in subdirectories
2. THE Compilot project SHALL target ES2021 as the compilation target
3. THE Compilot project SHALL use commonjs module format
4. THE Compilot project SHALL enable strict mode
5. THE Compilot project SHALL output compiled files to the `out/` directory, preserving the directory structure relative to `src/`
6. WHEN `tsc -p ./` is invoked from the repository root, THE Compilot project SHALL compile all TypeScript files under `src/` (including extension, CLI, and MCP server code) and complete with zero errors
7. THE Compilot project SHALL enable source maps so that compiled output can be mapped back to TypeScript source during debugging

### Requirement 8: Package.json Consolidation

**User Story:** As a maintainer, I want a single package.json that declares all extension contributions (commands, views, configuration), CLI binaries, and build scripts, so that the project is managed as one cohesive unit.

#### Acceptance Criteria

1. THE package.json SHALL declare the extension name as "compilot"
2. THE package.json SHALL declare the displayName as "Compilot"
3. THE package.json SHALL declare activation events using the `workspaceContains` pattern for `**/*.pro`, `**/*.sln`, and `**/Makefile` file globs
4. THE package.json SHALL declare all Qt-related commands using the `compilot.qt.` command prefix, including at minimum: selectProject, showActions, qmake, build, clean, run, stop, debug, and openWithQtDesigner
5. THE package.json SHALL declare all SDK-related commands using the `compilot.sdk.` command prefix, including at minimum: build, rebuild, clean, and showActions
6. THE package.json SHALL declare CLI binaries: `compilot` pointing to `./out/cli/index.js`
7. THE package.json SHALL declare the MCP server binary: `compilot-mcp` pointing to `./out/mcp/server.js`
8. THE package.json SHALL declare Qt configuration properties under the `compilot.qt` section and SDK configuration properties under the `compilot.sdk` section, each containing at minimum mode selection (debug/release) and project path settings
9. THE package.json SHALL declare build scripts including at minimum: `compile` (TypeScript compilation), `watch` (incremental compilation), `test` (compile and run tests), and `package` (produce distributable .vsix)
10. THE package.json SHALL declare a `main` entry point of `./out/extension.js`

### Requirement 9: MCP Server Extension

**User Story:** As an AI agent, I want the MCP server to expose both Qt and SDK operations as tools, so that I can build any native project through a single MCP endpoint.

#### Acceptance Criteria

1. THE MCP_Server SHALL expose Qt build operations (init, qmake, build, clean, run, stop, status) as individual MCP tools, each accepting at minimum a workspace path parameter and returning a structured result containing ok (boolean), commands (string array), diagnostics (array), and exitCode (number or null)
2. THE MCP_Server SHALL expose SDK build operations (build, rebuild, clean, status) as individual MCP tools, each accepting at minimum a workspace path and project path parameter and returning a structured result containing ok (boolean), commands (string array), diagnostics (array), and exitCode (number or null)
3. THE MCP_Server SHALL use the `compilot_qt_` prefix for Qt tool names (e.g., `compilot_qt_build`, `compilot_qt_qmake`)
4. THE MCP_Server SHALL use the `compilot_sdk_` prefix for SDK tool names (e.g., `compilot_sdk_build`, `compilot_sdk_clean`)
5. WHEN an SDK build tool is invoked, THE MCP_Server SHALL delegate to SDK_Module shared logic that does not import or depend on the `vscode` namespace
6. IF a tool is invoked with missing or invalid required parameters, THEN THE MCP_Server SHALL return a result with ok set to false and a diagnostics entry indicating which parameter is missing or invalid
7. WHEN any build tool is invoked with an optional mode parameter, THE MCP_Server SHALL accept "debug" or "release" as valid values and default to "debug" if not provided

### Requirement 10: UI Layer Consolidation

**User Story:** As a developer, I want a unified status bar and activity bar presence that shows the active module context (Qt or SDK), so that I can see build status at a glance regardless of project type.

#### Acceptance Criteria

1. THE UI layer SHALL display a status bar item showing the current build mode (debug/release) and architecture for the active module, formatted as "[ProjectName] · [Mode] [Arch]"
2. THE UI layer SHALL display the currently selected project name in the status bar, truncated to a maximum of 30 characters with an ellipsis if the name exceeds that length
3. WHILE a Qt project is active, THE UI layer SHALL show Qt-specific status indicators for qmake state (idle, running, or failed) and run state (idle, running, or stopped)
4. WHILE an SDK project is active, THE UI layer SHALL show SDK-specific status indicators for build state (idle, building, or failed)
5. THE UI layer SHALL register a single activity bar container with id "compilot"
6. THE UI layer SHALL provide a webview configuration panel registered as a view within the "compilot" activity bar container
7. IF no project is detected in the workspace, THEN THE UI layer SHALL display the status bar item with a placeholder label indicating no project is selected and hide module-specific status indicators
8. WHEN the user opens a workspace containing both .pro files and .sln or Makefile files, THE UI layer SHALL determine the active module based on the most recently selected project type and display the corresponding module-specific status indicators

### Requirement 11: CLI Distribution Package Preservation

**User Story:** As a maintainer, I want to keep the existing `cli/` directory as an independent npm package for CLI-only distribution, so that users can install the CLI without the VSCode extension.

#### Acceptance Criteria

1. THE project SHALL maintain a `cli/` directory at the project root containing its own package.json with `name`, `version`, `bin`, `files`, and `engines` fields
2. WHEN the CLI build script is executed, THE build script SHALL copy all compiled JS files required by the CLI from the main project's `out/` directory into `cli/out/`, including shebang lines on entry points
3. THE cli/ package.json SHALL declare the `compilot` binary name pointing to the CLI entry point JS file
4. WHEN `npm pack` is run inside the `cli/` directory after the CLI build script has completed, THE command SHALL succeed and produce a tarball containing only the files listed in the package.json `files` field
5. WHEN the main project's CLI build script has been run, THE cli/ package SHALL be executable via its declared binary without additional compilation or build steps
6. THE cli/ package SHALL not import any module that depends on the `vscode` namespace, so that it runs in a standalone Node.js environment (version 18 or above) without VSCode installed

### Requirement 12: Functional Parity

**User Story:** As a user of the existing extensions, I want all features from both xy-qt-tools and sdk-pilot to work identically after the merge, so that the refactor does not break my workflow.

#### Acceptance Criteria

1. THE Qt_Module SHALL register and execute all existing commands: selectProject, qmake, build, clean, run, stop, debug, openWithQtDesigner, syncTestConnection, syncChangedFiles, each producing the same observable output (task execution, status bar updates, user notifications) as the original xy-qt-tools extension
2. THE SDK_Module SHALL register and execute all existing commands: build, rebuild, clean, showActions, each producing the same observable output (task execution, status bar updates, user notifications) as the original sdk-pilot extension
3. THE Qt_Module SHALL watch for .cpp, .h, and .ui file deletions and prompt the user to remove the reference from the nearest .pri/.pro file when the deleted file is listed in that file
4. WHEN a .pro or .pri file changes, THE Qt_Module SHALL display a warning suggesting the user re-run QMake, with options to run QMake immediately or dismiss
5. THE Qt_Module SHALL preserve remote sync (SFTP) functionality including connection testing, changed-file synchronization via git diff, per-workspace-folder remote path mapping, and progress notification during upload
6. THE SDK_Module SHALL scan workspace folders for project entry files (*.sln on Windows, Makefile on Linux) up to a configurable depth (default: 4 levels), excluding standard non-project directories
7. WHEN multiple project entry files are detected, THE SDK_Module SHALL present a QuickPick dialog allowing the user to select the active project
8. WHEN a build task completes with exit code 0, THE Extension_Host SHALL reset the building state to false for the corresponding module
9. IF a build task completes with a non-zero exit code or is terminated, THEN THE Extension_Host SHALL reset the building state to false and display a warning message indicating the failure
