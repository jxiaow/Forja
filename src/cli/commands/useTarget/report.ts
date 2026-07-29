/**
 * useTarget/report — Phase 4: result building + text formatting + warnings.
 */
import * as os from 'os';
import { T, Diagnostic } from '../types';
import type { ToolchainInfo } from './types';
import type { UseTargetResult } from './types';
import type { ResolvedConfig } from './types';

/**
 * Build toolchain missing warnings.
 */
export function toolchainWarnings(toolchain: ToolchainInfo): Diagnostic[] {
    const warnings: Diagnostic[] = [];
    if (!toolchain.qt && toolchain.qtCandidates.length === 0) warnings.push({ level: 'warning', message: T('init.qtMissing') });
    if (os.platform() === 'win32' && !toolchain.vs && toolchain.vsCandidates.length === 0) warnings.push({ level: 'warning', message: T('init.vsMissing') });
    if (os.platform() === 'win32' && !toolchain.jom) warnings.push({ level: 'warning', message: T('init.jomMissing') });
    if (os.platform() !== 'win32' && !toolchain.make) warnings.push({ level: 'warning', message: T('init.makeMissing') });
    return warnings;
}

/**
 * Build config summary for JSON output.
 */
export function buildConfigSummary(config: ResolvedConfig, toolchain: ToolchainInfo): UseTargetResult['config'] {
    if (config.kind === 'qt') {
        return {
            qt: {
                configured: true,
                project: config.project,
                mode: config.mode,
                arch: config.arch,
                qtPath: config.qtPath,
                vsInstall: config.vsInstall,
                qtVersion: toolchain.qtVersion,
                vsVersion: toolchain.vsVersion,
                qmakeTarget: config.qmakeTarget,
            },
        };
    }
    return {
        sdk: {
            configured: true,
            project: config.project,
            mode: config.mode,
            arch: config.arch,
            vsInstall: config.vsInstall,
        },
    };
}

/**
 * Build success result.
 */
export function buildSuccessResult(config: ResolvedConfig, toolchain: ToolchainInfo, changed: string[], workspace: string): UseTargetResult {
    const target = {
        id: '',
        name: '',
        kind: config.kind,
        project: config.project,
        mode: (config.mode || 'debug') as 'debug' | 'release',
        arch: (config.arch || (os.platform() === 'win32' ? 'x86' : 'x64')) as 'x86' | 'x64',
        runAt: config.runAt,
        toolchain: {
            qtPath: config.qtPath,
            qtVersion: config.qtVersion,
            vsInstall: config.vsInstall,
            vsVersion: config.vsVersion,
            jomPath: config.jomPath,
            qmakeTarget: config.qmakeTarget,
        },
    };

    const diagnostics: Diagnostic[] = [];
    const warnings = toolchainWarnings(toolchain);
    diagnostics.push(...warnings);

    const toolchainReady = config.qtPath && (os.platform() !== 'win32' || config.vsInstall);

    return {
        ok: true,
        action: 'use',
        useScope: 'target',
        workspace,
        activeTarget: target,
        config: buildConfigSummary(config, toolchain),
        changed,
        diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
        nextAction: 'forja status',
    };
}

/**
 * Format text output for use target.
 */
export function formatUseTargetText(result: UseTargetResult): string {
    const lines: string[] = [];

    if (!result.ok) {
        lines.push(T('error'));
        if (result.diagnostics) {
            for (const d of result.diagnostics) { lines.push(`  ${d.message}`); }
        }
        if (result.nextAction) {
            lines.push(T('next'));
            lines.push(`  ${result.nextAction}`);
        }
        return lines.join('\n');
    }

    lines.push(T('setupTitle'));

    const t = result.activeTarget;
    if (t) {
        lines.push(`  ${T('target')}${t.project}`);
        if (t.toolchain.qtPath) {
            const ver = result.config?.qt?.qtVersion ? ` (${result.config.qt.qtVersion})` : '';
            lines.push(`  ${T('setupSummaryQt')}${ver}: ${t.toolchain.qtPath}`);
        }
        if (t.toolchain.vsInstall) {
            const ver = result.config?.qt?.vsVersion ? ` (${result.config.qt.vsVersion})` : '';
            lines.push(`  ${T('setupSummaryVs')}${ver}: ${t.toolchain.vsInstall}`);
        }
        if (t.toolchain.jomPath) {
            lines.push(`  ${T('init.currentJom')}: ${t.toolchain.jomPath}`);
        }
        lines.push(`  ${T('setupSummaryModeArch')}: ${t.mode} | ${t.arch}`);
        if (t.toolchain.qmakeTarget) { lines.push(`  ${T('init.qmakeTarget')}: ${t.toolchain.qmakeTarget}`); }
    }

    if (result.changed && result.changed.length > 0) {
        lines.push(`  ${T('changed')}${result.changed.join(', ')}`);
    }

    if (result.diagnostics?.length) {
        lines.push('');
        for (const d of result.diagnostics) {
            const icon = d.level === 'warning' ? '⚠' : d.level === 'error' ? '✗' : 'ℹ';
            lines.push(`  ${icon} ${d.message}`);
        }
    }

    if (result.nextAction) {
        lines.push('');
        lines.push(T('next'));
        lines.push(`  ${result.nextAction}`);
    }

    return lines.join('\n');
}
