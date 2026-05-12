import type { ProjectInfo } from '../project/projectManager';

export function getEffectiveProjectName(project: ProjectInfo | null, qmakeTarget: string, fallback = ''): string {
    if (!project) {
        return fallback;
    }
    return qmakeTarget || project.target || fallback;
}

export function getProjectSelectionLabel(project: ProjectInfo | null, relative: string, workspaceName = ''): string {
    const prefix = workspaceName ? `[${workspaceName}] ` : '';
    if (!project) {
        return `${prefix}${relative}`;
    }
    return `${prefix}${project.target} · ${relative}`;
}
