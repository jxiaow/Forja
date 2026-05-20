/**
 * 侧边栏导航 TreeView — 替代原来的 WebviewViewProvider。
 * 显示 4 个导航项：项目、环境、远程同步、高级。
 * 点击后在编辑器区打开对应的 WebviewPanel 配置页。
 */
import * as vscode from 'vscode';

export type ConfigPageId = 'project' | 'env' | 'sync' | 'advanced';

export interface ConfigNavItem {
    id: ConfigPageId;
    label: string;
    icon: string;
    description?: string;
}

const NAV_ITEMS: ConfigNavItem[] = [
    { id: 'project', label: '项目', icon: 'project' },
    { id: 'env', label: '环境', icon: 'server-environment' },
    { id: 'sync', label: '远程同步', icon: 'cloud-upload' },
    { id: 'advanced', label: '高级', icon: 'settings-gear' },
];

class ConfigNavTreeItem extends vscode.TreeItem {
    constructor(public readonly nav: ConfigNavItem) {
        super(nav.label, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon(nav.icon);
        this.command = {
            command: 'compilot.config.openPage',
            title: '打开配置页',
            arguments: [nav.id]
        };
        if (nav.description) {
            this.description = nav.description;
        }
    }
}

export class ConfigNavTreeProvider implements vscode.TreeDataProvider<ConfigNavTreeItem> {
    static readonly viewId = 'compilot.configView';

    private _onDidChangeTreeData = new vscode.EventEmitter<ConfigNavTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _items: ConfigNavTreeItem[];

    constructor() {
        this._items = NAV_ITEMS.map(n => new ConfigNavTreeItem(n));
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    /** 更新某个导航项的 description（如状态文字） */
    setDescription(id: ConfigPageId, desc: string): void {
        const item = this._items.find(i => i.nav.id === id);
        if (item) {
            item.description = desc;
            this._onDidChangeTreeData.fire(item);
        }
    }

    getTreeItem(element: ConfigNavTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(): ConfigNavTreeItem[] {
        return this._items;
    }
}
