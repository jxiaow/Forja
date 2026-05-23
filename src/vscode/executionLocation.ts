import * as vscode from 'vscode';

export type ExecutionLocation = 'local' | 'remote';

const WORKSPACE_KEY = 'compilot.executionLocation';

let current: ExecutionLocation = 'local';
let storage: vscode.Memento | null = null;
const listeners: Array<(location: ExecutionLocation) => void> = [];

export function initExecutionLocation(context: vscode.ExtensionContext): void {
    storage = context.workspaceState;
    current = normalize(storage.get(WORKSPACE_KEY));
    listeners.forEach(listener => listener(current));
}

export function getExecutionLocation(): ExecutionLocation {
    return current;
}

export async function setExecutionLocation(location: ExecutionLocation): Promise<void> {
    if (current === location) { return; }
    current = location;
    await storage?.update(WORKSPACE_KEY, location);
    listeners.forEach(listener => listener(location));
}

export function onExecutionLocationChange(listener: (location: ExecutionLocation) => void): vscode.Disposable {
    listeners.push(listener);
    return new vscode.Disposable(() => {
        const index = listeners.indexOf(listener);
        if (index >= 0) { listeners.splice(index, 1); }
    });
}

function normalize(value: unknown): ExecutionLocation {
    return value === 'remote' ? 'remote' : 'local';
}
