/**
 * CMakePresets.json resolution for build planning — pure functions over the
 * filesystem, no vscode / CLI dependencies (shared by CLI and extension plans).
 *
 * Kept deliberately small (scope control): only configure presets are used,
 * matched by a case-insensitive `debug`/`release` substring on name/binaryDir.
 * generator / toolchainFile / environment / cacheVariables are NOT re-encoded
 * into the command line — the emitted `cmake --preset <name>` lets CMake itself
 * apply them from the preset file (transparent passthrough).
 */
import * as fs from 'fs';
import * as path from 'path';

export type CMakePresetWarningCode = 'cpp.cmakePresetInvalidJson' | 'cpp.cmakePresetNoMatch';

export interface CMakePresetWarning {
    /** Stable code; CLI localizes via dict entry with the same key. */
    code: CMakePresetWarningCode;
    /** Interpolation params for the localized message ({0}...). */
    params: string[];
    /** English fallback message for consumers without i18n (logs, Qt runner). */
    message: string;
}

export interface ResolvedCMakePreset {
    /** Configure preset name, safe for `cmake --preset "<name>"`. */
    name: string;
    /** Source directory to configure (absolute). */
    sourceDir: string;
    /** Binary directory from the preset, placeholders expanded (absolute). */
    binaryDir: string;
}

export interface CMakePresetResolution {
    preset: ResolvedCMakePreset | null;
    warnings: CMakePresetWarning[];
}

const PRESET_FILE_NAME = 'CMakePresets.json';

/** Preset names are interpolated into a shell command; reject unsafe tokens. */
const SAFE_PRESET_NAME = /^[\w.\-+]+$/;

/**
 * Locate a CMakePresets.json: the project directory itself or one level up
 * in its parent. Returns the file path, or null when no file exists.
 */
export function findPresetFile(projectDir: string): string | null {
    for (const dir of [projectDir, path.dirname(projectDir)]) {
        const file = path.join(dir, PRESET_FILE_NAME);
        try {
            if (fs.statSync(file).isFile()) { return file; }
        } catch { /* not present — keep looking */ }
    }
    return null;
}

function expandPlaceholders(value: string, sourceDir: string, presetDir: string): string {
    return value
        .replace(/\$\{sourceDir\}/g, sourceDir)
        .replace(/\$\{sourceDirRelative\}/g, path.relative(presetDir, sourceDir) || '.')
        .replace(/\$\{fileDir\}/g, presetDir);
}

/**
 * Choose the configure preset matching the requested build mode.
 * - No preset file at all → no preset, no warnings (legacy -DCMAKE_BUILD_TYPE path).
 * - Invalid JSON or no matching preset → no preset + one warning (fallback, never crash).
 */
export function resolveConfigurePreset(projectDir: string, mode: 'debug' | 'release'): CMakePresetResolution {
    const file = findPresetFile(projectDir);
    if (!file) { return { preset: null, warnings: [] }; }

    const presetDir = path.dirname(file);
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        return {
            preset: null,
            warnings: [{
                code: 'cpp.cmakePresetInvalidJson',
                params: [detail],
                message: `${PRESET_FILE_NAME} is not valid JSON, falling back to -DCMAKE_BUILD_TYPE: ${detail}`,
            }],
        };
    }

    const entries = (raw && typeof raw === 'object' && Array.isArray((raw as { configurePresets?: unknown }).configurePresets))
        ? (raw as { configurePresets: unknown[] }).configurePresets
        : [];

    const keyword = mode.toLowerCase();
    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') { continue; }
        const p = entry as Record<string, unknown>;
        const name = typeof p.name === 'string' ? p.name : '';
        const binaryDirRaw = typeof p.binaryDir === 'string' ? p.binaryDir : '';
        if (!name) { continue; }
        if (!(name.toLowerCase().includes(keyword) || binaryDirRaw.toLowerCase().includes(keyword))) { continue; }
        if (!SAFE_PRESET_NAME.test(name)) { continue; } // shell-safety: treat as non-matching

        const sourceDirRaw = typeof p.sourceDir === 'string' ? p.sourceDir : '';
        const sourceDir = sourceDirRaw
            ? path.resolve(presetDir, expandPlaceholders(sourceDirRaw, projectDir, presetDir))
            : projectDir;
        const binaryDir = binaryDirRaw
            ? path.resolve(sourceDir, expandPlaceholders(binaryDirRaw, sourceDir, presetDir))
            : path.join(sourceDir, 'build');

        return { preset: { name, sourceDir, binaryDir }, warnings: [] };
    }

    return {
        preset: null,
        warnings: [{
            code: 'cpp.cmakePresetNoMatch',
            params: [mode],
            message: `No ${PRESET_FILE_NAME} configure preset matches mode "${mode}", falling back to -DCMAKE_BUILD_TYPE`,
        }],
    };
}
