/**
 * ActiveTarget read/write — thin wrapper over settingsIO for CLI.
 */
import { loadActiveTarget, saveActiveTarget } from '../../core/settingsIO';
import { ActiveTarget } from './types';

export function getActiveTarget(workspace: string): ActiveTarget | null {
    const raw = loadActiveTarget(workspace);
    if (!raw) { return null; }
    return raw;
}

export function setActiveTarget(workspace: string, target: ActiveTarget): void {
    saveActiveTarget(workspace, target);
}

export function requireActiveTarget(workspace: string): { target: ActiveTarget } | { error: string; nextAction?: string } {
    const target = getActiveTarget(workspace);
    if (!target) {
        return {
            error: 'No active target. Run `forja setup` or `forja use target --project <path>`.',
            nextAction: 'forja list targets',
        };
    }
    return { target };
}
