/**
 * E2E tests — real project at C:\Code\workspace\260627
 *
 * Tests cover edge cases and validation with realistic inputs:
 * - Invalid flag values (wrong mode, arch, port, etc.)
 * - Missing required parameters
 * - Unknown flags
 * - Boundary values (port 0, 65536, -1)
 * - Conflicting flags
 * - Empty/whitespace values
 */
import test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const WORKSPACE = 'C:\\Code\\workspace\\260627';
const CLI = path.resolve(__dirname, '..', 'cli', 'index.js');

function run(args: string): { code: number; out: string; err: string } {
  try {
    const out = execSync(`node "${CLI}" ${args}`, {
      cwd: WORKSPACE,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    });
    return { code: 0, out, err: '' };
  } catch (e: any) {
    return { code: e.status || 1, out: e.stdout || '', err: e.stderr || '' };
  }
}

function json(args: string): any {
  const r = run(`${args} --json`);
  try {
    return JSON.parse(r.out);
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// 1. Invalid mode/arch values
// ═══════════════════════════════════════════════════════════════

test('use target with invalid mode value', () => {
  const j = json('use target --mode invalid-mode');
  assert.ok(j);
  assert.equal(j.ok, false);
  assert.ok(j.diagnostics?.length > 0);
});

test('use target with invalid arch value', () => {
  const j = json('use target --arch invalid-arch');
  assert.ok(j);
  assert.equal(j.ok, false);
  assert.ok(j.diagnostics?.length > 0);
});

test('use target with empty mode', () => {
  const j = json('use target --mode ""');
  assert.ok(j);
  assert.equal(j.ok, false);
});

test('use target with empty arch', () => {
  const j = json('use target --arch ""');
  assert.ok(j);
  assert.equal(j.ok, false);
});

// ═══════════════════════════════════════════════════════════════
// 2. Invalid port values (boundary testing)
// ═══════════════════════════════════════════════════════════════

test('server add with port 0', () => {
  const j = json('server add --name test-port-0 --host 192.168.1.100 --username testuser --port 0');
  assert.ok(j);
  assert.equal(j.ok, false);
  assert.ok(j.diagnostics?.length > 0);
});

test('server add with port 65536 (above max)', () => {
  const j = json('server add --name test-port-max --host 192.168.1.100 --username testuser --port 65536');
  assert.ok(j);
  assert.equal(j.ok, false);
  assert.ok(j.diagnostics?.length > 0);
});

test('server add with negative port', () => {
  const j = json('server add --name test-port-neg --host 192.168.1.100 --username testuser --port -1');
  assert.ok(j);
  assert.equal(j.ok, false);
  assert.ok(j.diagnostics?.length > 0);
});

test('server add with non-numeric port', () => {
  const j = json('server add --name test-port-str --host 192.168.1.100 --username testuser --port abc');
  assert.ok(j);
  assert.equal(j.ok, false);
  assert.ok(j.diagnostics?.length > 0);
});

test('server add with float port', () => {
  const j = json('server add --name test-port-float --host 192.168.1.100 --username testuser --port 22.5');
  assert.ok(j);
  assert.equal(j.ok, false);
});

// ═══════════════════════════════════════════════════════════════
// 3. Missing required parameters
// ═══════════════════════════════════════════════════════════════

test('server add without required name', () => {
  const j = json('server add --host 192.168.1.100 --username testuser --port 22');
  assert.ok(j);
  assert.equal(j.ok, false);
  assert.ok(j.diagnostics?.length > 0);
});

test('server add without required host', () => {
  const j = json('server add --name test-no-host --username testuser --port 22');
  assert.ok(j);
  assert.equal(j.ok, false);
  assert.ok(j.diagnostics?.length > 0);
});

test('server add without required username', () => {
  const j = json('server add --name test-no-user --host 192.168.1.100 --port 22');
  assert.ok(j);
  assert.equal(j.ok, false);
  assert.ok(j.diagnostics?.length > 0);
});

// ═══════════════════════════════════════════════════════════════
// 4. Unknown flags
// ═══════════════════════════════════════════════════════════════

test('status with unknown flag', () => {
  const j = json('status --unknown-flag');
  assert.ok(j);
  assert.equal(j.ok, false);
  assert.ok(j.diagnostics?.length > 0);
});

test('list with unknown flag', () => {
  const j = json('list targets --invalid-option');
  assert.ok(j);
  assert.equal(j.ok, false);
});

test('use target with unknown flag', () => {
  const j = json('use target --nonexistent-option');
  assert.ok(j);
  assert.equal(j.ok, false);
});

// ═══════════════════════════════════════════════════════════════
// 5. Invalid subcommands
// ═══════════════════════════════════════════════════════════════

test('list with invalid category', () => {
  const j = json('list invalid-category');
  assert.ok(j);
  assert.equal(j.ok, false);
  assert.ok(j.diagnostics?.length > 0);
});

test('use with invalid subcommand', () => {
  const j = json('use invalid-subcommand');
  assert.ok(j);
  assert.equal(j.ok, false);
});

test('server with invalid subcommand', () => {
  const j = json('server invalid-action');
  assert.ok(j);
  assert.equal(j.ok, false);
});

// ═══════════════════════════════════════════════════════════════
// 6. Invalid run-at values
// ═══════════════════════════════════════════════════════════════

test('use target with invalid run-at value', () => {
  const j = json('use target --run-at invalid-location');
  assert.ok(j);
  assert.equal(j.ok, false);
  assert.ok(j.diagnostics?.length > 0);
});

test('use target with empty run-at', () => {
  const j = json('use target --run-at ""');
  assert.ok(j);
  assert.equal(j.ok, false);
});

// ═══════════════════════════════════════════════════════════════
// 7. Invalid auth-mode values
// ═══════════════════════════════════════════════════════════════

test('server add with invalid auth-mode', () => {
  const j = json('server add --name test-auth --host 192.168.1.100 --username testuser --port 22 --auth-mode invalid-auth');
  assert.ok(j);
  assert.equal(j.ok, false);
  assert.ok(j.diagnostics?.length > 0);
});

test('server add with empty auth-mode', () => {
  const j = json('server add --name test-auth-empty --host 192.168.1.100 --username testuser --port 22 --auth-mode ""');
  assert.ok(j);
  assert.equal(j.ok, false);
});

// ═══════════════════════════════════════════════════════════════
// 8. Empty/whitespace values
// ═══════════════════════════════════════════════════════════════

test('server add with whitespace name', () => {
  const j = json('server add --name "   " --host 192.168.1.100 --username testuser --port 22');
  assert.ok(j);
  // Whitespace-only values should either be rejected or accepted
  // The key is that the command doesn't crash
  assert.ok(j.ok !== undefined);
});

test('server add with whitespace host', () => {
  const j = json('server add --name test-ws-host --host "   " --username testuser --port 22');
  assert.ok(j);
  assert.ok(j.ok !== undefined);
});

test('server add with whitespace username', () => {
  const j = json('server add --name test-ws-user --host 192.168.1.100 --username "   " --port 22');
  assert.ok(j);
  assert.ok(j.ok !== undefined);
});

// ═══════════════════════════════════════════════════════════════
// 9. Conflicting flags
// ═══════════════════════════════════════════════════════════════

test('sync with both --dry-run and --yes', () => {
  const j = json('sync --dry-run --yes');
  assert.ok(j);
  assert.equal(j.ok, false);
  assert.ok(j.diagnostics?.length > 0);
});

// ═══════════════════════════════════════════════════════════════
// 10. Invalid project paths
// ═══════════════════════════════════════════════════════════════

test('use target with nonexistent project', () => {
  const j = json('use target --project /nonexistent/path/to/project.pro');
  assert.ok(j);
  assert.equal(j.ok, false);
  assert.ok(j.diagnostics?.length > 0);
});

test('use target with empty project path', () => {
  const j = json('use target --project ""');
  assert.ok(j);
  assert.equal(j.ok, false);
});

// ═══════════════════════════════════════════════════════════════
// 11. Invalid workspace paths
// ═══════════════════════════════════════════════════════════════

test('init with nonexistent workspace', () => {
  const j = json('init --workspace /nonexistent/workspace/path');
  assert.ok(j);
  assert.equal(j.ok, false);
  assert.ok(j.diagnostics?.length > 0);
});

test('init with empty workspace', () => {
  const j = json('init --workspace ""');
  assert.ok(j);
  assert.equal(j.ok, false);
});

// ═══════════════════════════════════════════════════════════════
// 12. Invalid server IDs
// ═══════════════════════════════════════════════════════════════

test('server update with nonexistent ID', () => {
  const j = json('server update nonexistent-server-id --name new-name');
  assert.ok(j);
  assert.equal(j.ok, false);
  assert.ok(j.diagnostics?.length > 0);
});

test('server remove with nonexistent ID', () => {
  const j = json('server remove nonexistent-server-id --force');
  assert.ok(j);
  assert.equal(j.ok, false);
  assert.ok(j.diagnostics?.length > 0);
});

test('server update with empty ID', () => {
  const j = json('server update "" --name new-name');
  assert.ok(j);
  assert.equal(j.ok, false);
});

test('server remove with empty ID', () => {
  const j = json('server remove "" --force');
  assert.ok(j);
  assert.equal(j.ok, false);
});

// ═══════════════════════════════════════════════════════════════
// 13. Invalid lock IDs
// ═══════════════════════════════════════════════════════════════

test('doctor unlock with nonexistent lock ID', () => {
  const j = json('doctor unlock nonexistent-lock-id');
  assert.ok(j);
  assert.equal(j.ok, false);
  assert.ok(j.diagnostics?.length > 0);
});

test('doctor unlock with empty lock ID', () => {
  const j = json('doctor unlock ""');
  assert.ok(j);
  assert.equal(j.ok, false);
});

// ═══════════════════════════════════════════════════════════════
// 14. Invalid file paths
// ═══════════════════════════════════════════════════════════════

test('sync with nonexistent file', () => {
  const j = json('sync --file /nonexistent/file.txt');
  assert.ok(j);
  assert.equal(j.ok, false);
  assert.ok(j.diagnostics?.length > 0);
});

test('sync with empty file path', () => {
  const j = json('sync --file ""');
  assert.ok(j);
  assert.equal(j.ok, false);
});

// ═══════════════════════════════════════════════════════════════
// 15. Multiple unknown flags
// ═══════════════════════════════════════════════════════════════

test('status with multiple unknown flags', () => {
  const j = json('status --unknown1 --unknown2 --unknown3');
  assert.ok(j);
  assert.equal(j.ok, false);
});

test('list with multiple unknown flags', () => {
  const j = json('list targets --invalid1 --invalid2');
  assert.ok(j);
  assert.equal(j.ok, false);
});

// ═══════════════════════════════════════════════════════════════
// 16. Mixed valid and invalid flags
// ═══════════════════════════════════════════════════════════════

test('use target with valid mode and invalid flag', () => {
  const j = json('use target --mode debug --unknown-flag');
  assert.ok(j);
  assert.equal(j.ok, false);
});

test('server add with valid params and unknown flag', () => {
  const j = json('server add --name test-mixed --host 192.168.1.100 --username testuser --port 22 --invalid-option');
  assert.ok(j);
  assert.equal(j.ok, false);
});

// ═══════════════════════════════════════════════════════════════
// 17. Invalid remote paths
// ═══════════════════════════════════════════════════════════════

test('remote set with empty remote path', () => {
  const j = json('remote set --server test-server --remote-path ""');
  assert.ok(j);
  assert.equal(j.ok, false);
});

test('remote set with whitespace remote path', () => {
  const j = json('remote set --server test-server --remote-path "   "');
  assert.ok(j);
  assert.equal(j.ok, false);
});

// ═══════════════════════════════════════════════════════════════
// 18. Invalid ignore patterns
// ═══════════════════════════════════════════════════════════════

test('sync ignore with empty pattern', () => {
  const j = json('sync ignore --add ""');
  assert.ok(j);
  assert.equal(j.ok, false);
});

test('sync ignore with whitespace pattern', () => {
  const j = json('sync ignore --add "   "');
  assert.ok(j);
  assert.equal(j.ok, false);
});

test('sync ignore remove with nonexistent pattern', () => {
  const j = json('sync ignore --rm nonexistent-pattern-xyz');
  assert.ok(j);
  assert.equal(j.ok, false);
  assert.ok(j.diagnostics?.length > 0);
});

// ═══════════════════════════════════════════════════════════════
// 19. Invalid toolchain paths
// ═══════════════════════════════════════════════════════════════

test('use target with nonexistent Qt path', () => {
  const j = json('use target --qt /nonexistent/qt/path');
  assert.ok(j);
  assert.equal(j.ok, false);
  assert.ok(j.diagnostics?.length > 0);
});

test('use target with empty Qt path', () => {
  const j = json('use target --qt ""');
  assert.ok(j);
  assert.equal(j.ok, false);
});

test('use target with nonexistent VS path', () => {
  const j = json('use target --vs /nonexistent/vs/path');
  assert.ok(j);
  assert.equal(j.ok, false);
  assert.ok(j.diagnostics?.length > 0);
});

test('use target with empty VS path', () => {
  const j = json('use target --vs ""');
  assert.ok(j);
  assert.equal(j.ok, false);
});

// ═══════════════════════════════════════════════════════════════
// 20. Edge cases with special characters
// ═══════════════════════════════════════════════════════════════

test('server add with special characters in name', () => {
  const j = json('server add --name "test@server#1" --host 192.168.1.100 --username testuser --port 22');
  assert.ok(j);
  // Should either succeed or fail with clear error
  assert.ok(j.ok !== undefined);
});

test('server add with unicode in name', () => {
  const j = json('server add --name "测试服务器" --host 192.168.1.100 --username testuser --port 22');
  assert.ok(j);
  // Should either succeed or fail with clear error
  assert.ok(j.ok !== undefined);
});

test('use target with special characters in project path', () => {
  const j = json('use target --project "test@project#1.pro"');
  assert.ok(j);
  assert.equal(j.ok, false);
  assert.ok(j.diagnostics?.length > 0);
});
