/**
 * Candidate aggregation — scans workspace for project files and auto-detects type.
 * No vscode dependency.
 */
import * as path from 'path';
import { scanProFiles } from '../../qt/shared/projectScanner';
import { scanSdkProjects } from '../../core/sdkProjectScanner';
import { loadActiveTarget, loadQtSettings, loadSdkSettings, QtSettings, SdkSettings } from '../../core/settingsIO';
import { ActiveTarget, TargetCandidate } from './types';
import { detectProjectType } from '../../core/projectTypeDetector';

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

    // Qt candidates (.pro files)
    const proFiles = scanProFiles(workspace);
    const qtPinned = qtConfig.pinnedProject?.relative || '';

    for (const pro of proFiles) {
        const isCurrent = activeTarget !== null
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

    // SDK candidates — uses shared scanner, then auto-detect type
    const sdkFiles = scanSdkProjects({ workspace });
    const sdkPinned = sdkConfig.pinnedProject || '';

    for (const sdkFile of sdkFiles) {
        const fullPath = path.join(workspace, sdkFile);
        const typeInfo = detectProjectType(fullPath);
        
        // Determine kind based on Qt dependency
        const kind = typeInfo.usesQt ? 'qt' : 'sdk';
        
        const isCurrent = activeTarget !== null
            && normalizePath(activeTarget.project) === normalizePath(sdkFile);
        const isConfigured = normalizePath(sdkFile) === normalizePath(sdkPinned);
        
        const fileName = path.basename(sdkFile).toLowerCase();
        const dirName = path.basename(path.dirname(sdkFile));
        const isConventionName = fileName === 'cmakelists.txt' || fileName === 'makefile';
        const label = isConventionName
            ? (dirName && dirName !== '.' ? dirName : path.basename(workspace))
            : path.basename(sdkFile, path.extname(sdkFile));

        candidates.push({
            kind,
            project: sdkFile,
            label,
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
