/**
 * CLI types — v2 command consolidation.
 * No vscode dependency.
 */

// ── ActiveTarget ──

import type { TargetProfile } from '../../core/workspaceStore';
import type { CliDiagnostic } from '../../core/types';
import { UI_COMMON } from './dict/common';
import { UI_HELP } from './dict/help';
import { UI_MESSAGES } from './dict/messages';

/** @deprecated Use TargetProfile directly. Kept as alias for backward compat. */
export type ActiveTarget = TargetProfile;

// ── Diagnostic ──

export type DiagnosticLevel = 'info' | 'warning' | 'error';

export interface Diagnostic {
    level: DiagnosticLevel;
    message: string;
    hint?: string;
    fix?: string;
    params?: Record<string, string>;
}

export function diag(level: DiagnosticLevel, message: string, hint?: string): Diagnostic {
    return { level, message, hint };
}

/** Localize qt-layer diagnostics that carry a stable code; pass others through. */
export function mapQtDiagnostic(d: CliDiagnostic): Diagnostic {
    if (d.code === 'qtPathInvalid') {
        return { level: 'error', message: T('cmd.qtPathInvalid', d.params), hint: T('cmd.qtPathInvalidHint') };
    }
    if (d.code === 'rccMissing') {
        return { level: 'error', message: T('cmd.rccMissing'), hint: T('cmd.rccMissingHint') };
    }
    if (d.code === 'rccNoQrc') {
        return diag('warning', T('cmd.rccNoQrc'));
    }
    if (d.code === 'buildFailed') {
        return diag('error', T('cmd.buildFailed'));
    }
    return diag(d.level, d.message);
}

/** Localize CMake plan warnings that carry a stable code; pass others through. */
export function mapCppPlanDiagnostic(d: CliDiagnostic): Diagnostic | null {
    if (d.code === 'cpp.cmakePresetInvalidJson' || d.code === 'cpp.cmakePresetNoMatch') {
        return { level: 'warning', message: T(d.code, d.params) };
    }
    return null;
}

// ── Readiness ──

export type ReadinessState = 'ready' | 'configured' | 'blocked' | 'missing' | 'unknown' | 'not-selected';

export interface Readiness {
    target?: ReadinessState;
    toolchain?: ReadinessState;
    sync?: ReadinessState;
    remote?: ReadinessState;
    runtime?: ReadinessState;
}

// ── Candidates ──

export interface TargetCandidate {
    kind: 'qt' | 'cpp';
    project: string;
    label: string;
    current: boolean;
    configured: boolean;
    diagnostics: Diagnostic[];
}

// ── Runtime ──

export interface RuntimeState {
    running: boolean;
    pid?: number;
    executablePath?: string;
    logFile?: string;
}

// ── CommandPlan ──

export interface CommandPlan {
    mode: 'dryRun';
    commands?: string[];
    shellCommand?: string;
    willWrite?: string[];
    willRun?: string[];
}

// ── Server types ──

export interface ServerSummary {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    authMode: 'key' | 'password';
    selected?: boolean;
}

export interface ServerDetail extends ServerSummary {
    privateKeyPath?: string;
    strictHostKeyChecking?: boolean;
}

// ── JSON Envelope ──

export interface ForjaJsonResult {
    ok: boolean;
    action: string;
    workspace?: string;
    workroot?: string;
    activeTarget?: ActiveTarget;
    diagnostics?: Diagnostic[];
    nextAction?: string;
}

// ── Env summary (for `list env`) ──

export interface EnvSummary {
    qt?: Array<{ path: string; version?: string; configured?: boolean }>;
    vs?: Array<{ path: string; version?: string; edition?: string; configured?: boolean }>;
    jom?: string;
    make?: boolean;
}

// ── Sync types ──

export interface SyncPlan {
    mode: 'dryRun';
    server: string;
    remotePath: string;
    repos: string[];
    pending: string[];
    deleted: string[];
    skipped: string[];
    skippedDetails?: Array<{ file: string; reason: string }>;
}

// ── Question protocol (for --json needs-input) ──

export interface Question {
    id: string;
    label: string;
    required?: boolean;
    default?: string | number;
    choices?: string[];
    choicesBy?: {
        questionId: string;
        values: Record<string, string[]>;
    };
    when?: Record<string, string>;
}

// ── Locale ──

export type Locale = 'en' | 'zh';

export function resolveLocale(langFlag?: string, storedLang?: string): Locale {
    if (langFlag === 'zh' || langFlag === 'en') { return langFlag; }
    if (storedLang === 'zh' || storedLang === 'en') { return storedLang; }
    const envLang = process.env.FORJA_LANG;
    if (envLang === 'zh' || envLang === 'en') { return envLang; }
    const sysLocale = (process.env.LC_ALL || process.env.LANG || '').toLowerCase();
    if (sysLocale.includes('zh')) { return 'zh'; }
    try {
        const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
        if (intlLocale.startsWith('zh')) { return 'zh'; }
    } catch { /* ignore */ }
    return 'en';
}

// ── Readiness text mapping ──

const READINESS_TEXT: Record<ReadinessState, { en: string; zh: string }> = {
    ready: { en: 'Ready', zh: '就绪' },
    configured: { en: 'Configured', zh: '已配置' },
    blocked: { en: 'Blocked', zh: '阻塞' },
    missing: { en: 'Missing', zh: '缺失' },
    unknown: { en: 'Unknown', zh: '未知' },
    'not-selected': { en: 'Not selected', zh: '未选择' },
};

export function readinessText(state: ReadinessState, locale: Locale): string {
    return READINESS_TEXT[state][locale];
}

const READINESS_SYMBOLS: Record<ReadinessState, string> = {
    ready: '✓',
    configured: '✓',
    blocked: '✗',
    missing: '✗',
    unknown: '⚠',
    'not-selected': '-',
};

export function readinessSymbol(state: ReadinessState): string {
    return READINESS_SYMBOLS[state] ?? '?';
}

// ── UI text i18n ──

const UI: Record<string, { en: string; zh: string }> = {
    ...UI_COMMON,
    ...UI_HELP,
    ...UI_MESSAGES,
};

// Global locale state
let _globalLocale: Locale = 'en';

export function setGlobalLocale(locale: Locale): void {
    _globalLocale = locale;
}

export function getGlobalLocale(): Locale {
    return _globalLocale;
}

export function T(key: string, params?: string[]): string {
    const entry = UI[key];
    let text = entry ? entry[_globalLocale] : key;
    if (params) {
        for (let i = 0; i < params.length; i++) {
            text = text.replace(`{${i}}`, params[i]);
        }
    }
    return text;
}
