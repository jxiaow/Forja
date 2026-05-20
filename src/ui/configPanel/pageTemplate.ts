/**
 * 标签页式配置面板 HTML 生成器。
 */
import { ConfigPageId } from './configNavTree';
import { TemplateData } from './template';
import { PAGE_CSS } from './pageCss';
import { buildProjectPage } from './pages/project';
import { buildEnvPage } from './pages/env';
import { buildSyncPage } from './pages/sync';
import { buildAdvancedPage } from './pages/advanced';

export function getPageHtml(pageId: ConfigPageId, data: TemplateData): string {
    const body = BUILDERS[pageId](data);
    return '<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8">'
        + '<style>' + PAGE_CSS + '</style></head><body>'
        + body + '<script>const vscode=acquireVsCodeApi();</script>'
        + '</body></html>';
}

type B = (d: TemplateData) => string;
const BUILDERS: Record<ConfigPageId, B> = {
    project: buildProjectPage,
    env: buildEnvPage,
    sync: buildSyncPage,
    advanced: buildAdvancedPage,
};
