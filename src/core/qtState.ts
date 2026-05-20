import type { ProjectInfo, EnvInfo } from './types';
import { getQtSetting, setQtSetting, onSettingsChange } from './settingsStore';

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
    _state.mode = getQtSetting('mode') || 'debug';
    _state.arch = getQtSetting('arch') || 'x86';

    // 监听 settingsStore 变化，保持 _state 同步
    onSettingsChange((section, key) => {
        if (section !== 'qt') { return; }
        if (key === 'mode') {
            const newMode = (getQtSetting('mode') || 'debug') as BuildMode;
            if (_state.mode !== newMode) {
                _state.mode = newMode;
                _listeners.forEach(fn => fn('mode', _state));
            }
        } else if (key === 'arch') {
            const newArch = (getQtSetting('arch') || 'x86') as Arch;
            if (_state.arch !== newArch) {
                _state.arch = newArch;
                _listeners.forEach(fn => fn('arch', _state));
            }
        }
    });
}

export function getState(): Readonly<AppState> {
    return _state;
}

export function setState<K extends StateKey>(key: K, value: AppState[K]): void {
    if (_state[key] === value) { return; }
    _state[key] = value;
    if (key === 'mode') {
        setQtSetting('mode', value as BuildMode);
    } else if (key === 'arch') {
        setQtSetting('arch', value as Arch);
    }
    _listeners.forEach(fn => fn(key, _state));
}

export function onStateChange(listener: StateListener): () => void {
    _listeners.push(listener);
    return () => {
        const idx = _listeners.indexOf(listener);
        if (idx >= 0) { _listeners.splice(idx, 1); }
    };
}
