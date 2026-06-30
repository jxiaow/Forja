/**
 * Candidate aggregation — scans workspace for Qt (.pro) and SDK (.sln/Makefile) projects.
 * No vscode dependency.
 */
import * as path from 'path';
import { scanProFiles } from '../../qt/shared/projectScanner';
import { scanSdkProjects } from '../../core/sdkProjectScanner';
import { loadActiveTarget, loadQtSettings, loadSdkSettings, QtSettings, SdkSettings } from '../../core/settingsIO';
import { ActiveTarget, TargetCandidate } from './types';

function normalizePath(p: string): string {
    return p.replace(/\\/g, '/');
}

/**
 * Pure aggregation — workspace + configs explicit, no config I/O.
 * Callers who already have configs loaded (e.g. status) use this directly.
 */
export function aggregateCandidates(
    workspace: string,
    activeTarget: ActiveTarget | null,
    qtConfig: QtSettings,
    sdkConfig: SdkSettings,
): TargetCandidate[] {
    const candidates: TargetCandidate[] = [];

    // Qt candidates
    const proFiles = scanProFiles(workspace);
    const qtPinned = qtConfig.pinnedProject?.relative || '';

    for (const pro of proFiles) {
        const isCurrent = activeTarget !== null
            && activeTarget.kind === 'qt'
            && normalizePath(activeTarget.project) === normalizePath(pro);
        const isConfigured = normalizePath(pro) === normalizePath(qtPinned);

        candidates.push({
            kind: 'qt',
            project: pro,
            label: path.basename(pro, '.pro'),
            current: isCurrent,
            configured: isConfigured,
            diagnostics: [],
        });
    }

    // SDK candidates — uses shared scanner (same rules as SDK module's ProjectScanner)
    const sdkFiles = scanSdkProjects({ workspace });
    const sdkPinned = sdkConfig.pinnedProject || '';

    for (const sln of sdkFiles) {
        const isCurrent = activeTarget !== null
            && activeTarget.kind === 'sdk'
            && normalizePath(activeTarget.project) === normalizePath(sln);
        const isConfigured = normalizePath(sln) === normalizePath(sdkPinned);

        candidates.push({
            kind: 'sdk',
            project: sln,
            label: path.basename(sln, path.extname(sln)),
            current: isCurrent,
            configured: isConfigured,
            diagnostics: [],
        });
    }

    return candidates;
}

/**
 * Convenience wrapper — loads configs then delegates to aggregateCandidates.
 */
export function collectTargetCandidates(workspace: string): TargetCandidate[] {
    const activeTarget = loadActiveTarget(workspace);
    const qtConfig = loadQtSettings(workspace);
    const sdkConfig = loadSdkSettings(workspace);
    return aggregateCandidates(workspace, activeTarget, qtConfig, sdkConfig);
}
