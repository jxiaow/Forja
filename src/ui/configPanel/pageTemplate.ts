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
        + body + '<script>const vscode=acquireVsCodeApi();' + CSEL_JS + '</script>'
        + '</body></html>';
}

type B = (d: TemplateData) => string;
const BUILDERS: Record<ConfigPageId, B> = {
    project: buildProjectPage,
    env: buildEnvPage,
    sync: buildSyncPage,
    advanced: buildAdvancedPage,
};

/** Custom select component JS — initializes all .csel elements on the page */
const CSEL_JS = [
    '(function(){',
    'document.addEventListener("click",function(e){',
    'var all=document.querySelectorAll(".csel.open");',
    'all.forEach(function(el){if(!el.contains(e.target))el.classList.remove("open")})});',
    'window.initCsel=function(){',
    'document.querySelectorAll(".csel").forEach(function(el){',
    'var trigger=el.querySelector(".csel-trigger");',
    'var list=el.querySelector(".csel-list");',
    'if(!trigger||!list)return;',
    'trigger.addEventListener("click",function(ev){',
    'ev.stopPropagation();',
    'document.querySelectorAll(".csel.open").forEach(function(o){if(o!==el)o.classList.remove("open")});',
    'el.classList.toggle("open")});',
    'list.addEventListener("click",function(ev){',
    'var item=ev.target.closest(".csel-item");if(!item)return;',
    'var val=item.dataset.value;',
    'trigger.textContent=item.textContent;trigger.dataset.value=val;',
    'list.querySelectorAll(".csel-item").forEach(function(i){i.classList.remove("active")});',
    'item.classList.add("active");',
    'el.classList.remove("open");',
    'var evt=new CustomEvent("csel-change",{detail:{value:val}});el.dispatchEvent(evt)',
    '})})};',
    'window.initCsel();',
    '})();',
].join('');
