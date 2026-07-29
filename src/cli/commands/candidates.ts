/**
 * Candidate aggregation — scans workspace for project files and auto-detects type.
 * Reads from workspaceStore. No vscode dependency.
 */
import * as path from 'path';
import { scanProFiles } from '../../qt/shared/projectScanner';
import { scanSdkProjects } from '../../core/sdkProjectScanner';
import { resolveWorkroot, loadWorkspaceConfig, getActiveTarget, normalizePath } from '../../core/workspaceStore';
import type { TargetProfile } from '../../core/workspaceStore';
import { TargetCandidate } from './types';
import { detectProjectType } from '../../core/projectTypeDetector';

/**
 * Pure aggregation — workspace + configs explicit, no config I/O.
 */
export function aggregateCandidates(
    workspace: string,
    activeProfile: TargetProfile | null,
    savedTargets: TargetProfile[],
): TargetCandidate[] {
    const candidates: TargetCandidate[] = [];
    const savedProjectSet = new Set(savedTargets.map(t => normalizePath(t.project)));

    // Qt candidates (.pro files)
    const proFiles = scanProFiles(workspace);

    for (const pro of proFiles) {
        const isCurrent = activeProfile !== null
            && normalizePath(activeProfile.project) === normalizePath(pro);
        const isConfigured = savedProjectSet.has(normalizePath(pro));

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

    for (const sdkFile of sdkFiles) {
        const fullPath = path.join(workspace, sdkFile);
        const typeInfo = detectProjectType(fullPath);
        const kind = typeInfo.usesQt ? 'qt' : 'sdk';

        const isCurrent = activeProfile !== null
            && normalizePath(activeProfile.project) === normalizePath(sdkFile);
        const isConfigured = savedProjectSet.has(normalizePath(sdkFile));

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
 * Convenience wrapper — loads from workspaceStore then delegates to aggregateCandidates.
 */
export function collectTargetCandidates(workspace: string): TargetCandidate[] {
    const workroot = resolveWorkroot(workspace);
    if (!workroot) {
        // No workroot registered — still scan but nothing is current/configured
        return aggregateCandidates(workspace, null, []);
    }
    const wsConfig = loadWorkspaceConfig(workroot);
    const activeProfile = getActiveTarget(wsConfig);
    const savedTargets = Object.values(wsConfig.targets);
    return aggregateCandidates(workspace, activeProfile, savedTargets);
}
