/**
 * useTarget module — shared types.
 */
import { TargetCandidate, Question, ForjaJsonResult } from '../types';
import type { TargetProfile } from '../../../core/workspaceStore';

// ── Detection context ──

export interface ToolchainInfo {
    qt: boolean;
    vs: boolean;
    jom: boolean;
    make: boolean;
    qtPath?: string;
    vsInstall?: string;
    jomPath?: string;
    qtVersion?: string;
    vsVersion?: string;
    qtCandidates: Array<{ path: string; version: string }>;
    vsCandidates: Array<{ installPath: string; version: string; edition: string }>;
}

export interface DetectContext {
    workspace: string;
    candidates: TargetCandidate[];
    qtCandidates: TargetCandidate[];
    cppCandidates: TargetCandidate[];
    toolchain: ToolchainInfo;
    existingTarget: TargetProfile | null;
    existingQt: {
        pinnedProject: { root: string; relative: string } | null;
        qtPath: string;
        vsInstall: string;
        jomPath: string;
        mode: string;
        arch: string;
        target: string;
    };
    existingCpp: {
        pinnedProject: string | null;
        vsInstall: string;
        mode: string;
        arch: string;
    };
    storedToolchains: Record<string, never>;
}

// ── Resolve options ──

export interface ResolveOptions {
    interactive: boolean;
    json: boolean;
    reset: boolean;
    project?: string;
    qtPath?: string;
    vsInstall?: string;
    jomPath?: string;
    qmakeTarget?: string;
    executableName?: string;
    buildScript?: string;
    mode?: string;
    arch?: string;
    answers?: Record<string, string>;
}

// ── Resolved config ──

export interface ResolvedConfig {
    kind: 'qt' | 'cpp';
    project: string;
    mode?: 'debug' | 'release';
    arch?: 'x86' | 'x64';
    qtPath?: string;
    qtVersion?: string;
    vsInstall?: string;
    vsVersion?: string;
    jomPath?: string;
    qmakeTarget?: string;
    executableName?: string;
    buildScript?: string;
}

// ── Result ──

export interface UseTargetResult extends ForjaJsonResult {
    action: 'use';
    useScope: 'target';
    status?: 'needs-input';
    questions?: Question[];
    config?: {
        qt?: { configured: boolean; project?: string; mode?: string; arch?: string; qtPath?: string; vsInstall?: string; qtVersion?: string; vsVersion?: string; qmakeTarget?: string; executableName?: string };
        cpp?: { configured: boolean; project?: string; mode?: string; arch?: string; vsInstall?: string; buildScript?: string };
    };
    changed?: string[];
}
