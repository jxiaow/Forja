import * as vscode from 'vscode';
import { ProjectInfo } from '../project/projectManager';
import { EnvInfo } from '../env/envDetector';
import { getSetting, setSetting } from './settingsStore';

export type BuildMode = 'debug' | 'release';
export type Arch = 'x86' | 'x64';
export type BuildAction = 'run' | 'debug' | 'build' | null;

export interface AppState {
    mode: BuildMode;
    arch: Arch;
    isBuilding: boolean;
    buildAction: BuildAction;
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
    buildAction: null,
    isRunning: false,
    currentProject: null,
    envInfo: null
};

const _listeners: StateListener[] = [];

/** 从 settingsStore 加载持久化状态（在 initSettingsStore 之后调用） */
export function loadPersistedState(): void {
    _state.mode = getSetting('mode');
    _state.arch = getSetting('arch');
}

export function getState(): Readonly<AppState> {
    return _state;
}

export function setState<K extends StateKey>(key: K, value: AppState[K]): void {
    if (_state[key] === value) { return; }
    _state[key] = value;
    if (key === 'mode') {
        setSetting('mode', value as BuildMode);
    } else if (key === 'arch') {
        setSetting('arch', value as Arch);
    }
    _listeners.forEach(fn => fn(key, _state));
}

export function onStateChange(listener: StateListener): vscode.Disposable {
    _listeners.push(listener);
    return new vscode.Disposable(() => {
        const idx = _listeners.indexOf(listener);
        if (idx >= 0) { _listeners.splice(idx, 1); }
    });
}
