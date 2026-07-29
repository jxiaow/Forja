/**
 * Candidate aggregation — scans workspace for project files and auto-detects type.
 * Reads from workspaceStore. No vscode dependency.
 */
import * as path from 'path';
import { scanProFiles } from '../../qt/shared/projectScanner';
import { scanCppProjects } from '../../core/cppProjectScanner';
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
    const proFiles = scanProFiles(workspace, [], ['build', '.worktrees']);

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

    // C++ candidates — uses shared scanner, then auto-detect type
    const cppFiles = scanCppProjects({ workspace });

    for (const cppFile of cppFiles) {
        const fullPath = path.join(workspace, cppFile);
        const typeInfo = detectProjectType(fullPath);
        const kind = typeInfo.usesQt ? 'qt' : 'cpp';

        const isCurrent = activeProfile !== null
            && normalizePath(activeProfile.project) === normalizePath(cppFile);
        const isConfigured = savedProjectSet.has(normalizePath(cppFile));

        const fileName = path.basename(cppFile).toLowerCase();
        const dirName = path.basename(path.dirname(cppFile));
        const isConventionName = fileName === 'cmakelists.txt' || fileName === 'makefile';
        const label = isConventionName
            ? (dirName && dirName !== '.' ? dirName : path.basename(workspace))
            : path.basename(cppFile, path.extname(cppFile));

        candidates.push({
            kind,
            project: cppFile,
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
