import * as fs from 'fs';
import * as path from 'path';
import type { CliArch, CliBuildMode } from '../cli/types';

export interface LocalConfig {
    version: 1;
    workspace: string;
    project: string;
    mode: CliBuildMode;
    arch: CliArch;
    qtPath: string;
    vsDevShell: string;
    qmakeTarget: string;
}

export interface LocalCache {
    version: 1;
    updatedAt: string;
    detected: {
        qt: { path: string; qmake: string } | null;
        vs: { devShellPath: string } | null;
        projects: string[];
    };
}

export function localRoot(workspace: string): string {
    return path.join(workspace, '.work', 'qt-pilot');
}

export function configPath(workspace: string): string {
    return path.join(localRoot(workspace), 'config.json');
}

export function cachePath(workspace: string): string {
    return path.join(localRoot(workspace), 'cache.json');
}

export function logsDir(workspace: string): string {
    return path.join(localRoot(workspace), 'logs');
}

export function ensureLocalStateDir(workspace: string): void {
    fs.mkdirSync(localRoot(workspace), { recursive: true });
    fs.mkdirSync(logsDir(workspace), { recursive: true });
}

export function readLocalConfig(workspace: string): LocalConfig | null {
    return readJson<LocalConfig>(configPath(workspace));
}

export function writeLocalConfig(workspace: string, config: LocalConfig): void {
    writeJson(configPath(workspace), config);
}

export function readLocalCache(workspace: string): LocalCache | null {
    return readJson<LocalCache>(cachePath(workspace));
}

export function writeLocalCache(workspace: string, cache: LocalCache): void {
    writeJson(cachePath(workspace), cache);
}

export function ensureWorkGitignored(workspace: string): void {
    const gitignorePath = path.join(workspace, '.gitignore');
    let lines: string[] = [];

    try {
        lines = fs.readFileSync(gitignorePath, 'utf8').split(/\r?\n/);
    } catch {}

    const otherLines = lines.filter(line => line.trim() !== '.work/' && line.length > 0);
    otherLines.push('.work/');
    fs.mkdirSync(path.dirname(gitignorePath), { recursive: true });
    fs.writeFileSync(gitignorePath, `${otherLines.join('\n')}\n`, 'utf8');
}

function readJson<T>(filePath: string): T | null {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
    } catch {
        return null;
    }
}

function writeJson(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
