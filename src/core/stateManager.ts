import * as vscode from 'vscode';
import { ProjectInfo } from '../project/projectManager';
import { EnvInfo } from '../env/envDetector';

export type BuildMode = 'debug' | 'release';
export type Arch = 'x86' | 'x64';

export interface AppState {
    mode: BuildMode;
    arch: Arch;
    isBuilding: boolean;
    isRunning: boolean;
    currentProject: ProjectInfo | null;
    envInfo: EnvInfo | null;
}

type StateKey = keyof AppState;
type StateListener = (key: StateKey, state: AppState) => void;

const _state: AppState = {
    mode: 'debug',
    arch: 'x86',
    isBuilding: false,
    isRunning: false,
    currentProject: null,
    envInfo: null
};

const _listeners: StateListener[] = [];

export function getState(): Readonly<AppState> {
    return _state;
}

export function setState<K extends StateKey>(key: K, value: AppState[K]): void {
    if (_state[key] === value) { return; }
    _state[key] = value;
    _listeners.forEach(fn => fn(key, _state));
}

export function onStateChange(listener: StateListener): vscode.Disposable {
    _listeners.push(listener);
    return new vscode.Disposable(() => {
        const idx = _listeners.indexOf(listener);
        if (idx >= 0) { _listeners.splice(idx, 1); }
    });
}
