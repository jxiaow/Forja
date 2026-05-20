import { TemplateData } from '../template';
import type { EnvInfo } from '../../../qt/env/envDetector';

function esc(v: string): string {
    return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildEnvPage(data: TemplateData): string {
    const env = data.env;
    const eds = data.vsDevShellPath || data.autoDevShell;
    const dss = data.vsDevShellPath ? '手动配置'
        : (data.autoDevShell ? '自动检测' : '未配置');
    const eqp = data.qtPath || data.autoQtPath;
    const qts = data.qtPath ? '手动配置'
        : (data.autoQtPath ? '自动检测' : '未配置');
    const jok = !!env?.jom;

    let h = '<div class="page-title">环境配置</div>';
    h += '<div class="page-desc">管理构建工具链</div>';

    // ── Visual Studio ──
    if (data.isWin) {
        h += '<div class="cs"><div class="cst">Visual Studio</div>';
        h += '<div class="env-card"><div class="ech">';
        h += `<span class="sd ${eds ? 'dok' : 'dwn'}"></span>`;
        h += '<span class="ect" id="vsTitle">';
        h += env?.vs ? esc('VS ' + env.vs.version + ' ' + env.vs.edition) : '未检测到';
        h += '</span>';
        h += `<span class="ecb ${eds ? 'bok' : 'bwn'}" id="vsBadge">${esc(dss)}</span>`;
        h += '</div>';
        h += `<div class="ecp" id="vsPath">${esc(eds || '未配置')}</div>`;
        h += '<div class="eca"><button class="btn btn-sm env-toggle-btn"';
        h += " onclick=\"togglePanel('vsPanel',this)\">";
        h += '<span class="env-toggle-arrow">▾</span> 手动覆盖</button></div>';
        // 内嵌配置面板（默认折叠）
        h += '<div id="vsPanel" class="env-expand">';
        // 候选快速选择
        h += buildVsCandidateSelect(env, eds);
        // 手动路径输入
        h += '<div class="ef-row"><span class="ef-label">DevShell 路径</span>';
        h += '<div class="input-row">';
        h += `<input id="vsDevShellPath" class="ef-input" value="${esc(data.vsDevShellPath)}"`;
        h += ' placeholder="Launch-VsDevShell.ps1"';
        h += " onblur=\"vscode.postMessage({command:'saveVsPath',value:this.value})\"/>";
        h += '<button class="btn btn-sm" onclick="vscode.postMessage(';
        h += "{command:'browse',targetId:'vsDevShellPath',isDir:false})\">";
        h += '浏览</button></div></div>';
        h += '</div></div></div>';
    }

    // ── Qt ──
    h += '<div class="cs"><div class="cst">Qt</div>';
    h += '<div class="env-card"><div class="ech">';
    h += `<span class="sd ${eqp ? 'dok' : 'dwn'}"></span>`;
    h += '<span class="ect" id="qtTitle">';
    h += env?.qt ? esc('Qt ' + env.qt.version + ' (' + env.qt.compiler + ')') : '未检测到';
    h += '</span>';
    h += `<span class="ecb ${eqp ? 'bok' : 'bwn'}" id="qtBadge">${esc(qts)}</span></div>`;
    h += `<div class="ecp" id="qtPathDisplay">${esc(eqp || '未配置')}</div>`;
    h += '<div class="eca"><button class="btn btn-sm env-toggle-btn"';
    h += " onclick=\"togglePanel('qtPanel',this)\">";
    h += '<span class="env-toggle-arrow">▾</span> 修改路径</button></div>';
    // 内嵌配置面板（默认折叠）
    h += '<div id="qtPanel" class="env-expand">';
    // 候选快速选择
    h += buildQtCandidateSelect(env, eqp);
    // Qt 路径
    h += '<div class="ef-row"><span class="ef-label">Qt 路径</span>';
    h += '<div class="input-row">';
    h += `<input id="qtPath" class="ef-input" value="${esc(data.qtPath)}" placeholder="Qt 编译器目录"`;
    h += " onblur=\"vscode.postMessage({command:'saveQtPath',value:this.value})\"/>";
    h += '<button class="btn btn-sm" onclick="vscode.postMessage(';
    h += "{command:'browse',targetId:'qtPath',isDir:true})\">浏览</button>";
    h += '</div></div>';
    // Designer
    h += '<div class="ef-row"><span class="ef-label">Designer <span class="ef-opt">可选</span></span>';
    h += '<div class="input-row">';
    h += `<input id="designerPath" class="ef-input" value="${esc(data.designerPath)}"`;
    h += ' placeholder="designer.exe 路径"';
    h += " onblur=\"vscode.postMessage({command:'saveDesignerPath',value:this.value})\"/>";
    h += '<button class="btn btn-sm" onclick="vscode.postMessage(';
    h += "{command:'browse',targetId:'designerPath',isDir:false})\">浏览</button>";
    h += '</div></div>';
    // Qt 源码
    h += '<div class="ef-row"><span class="ef-label">Qt 源码 <span class="ef-opt">可选，调试用</span></span>';
    h += '<div class="input-row">';
    h += `<input id="qtSourcePath" class="ef-input" value="${esc(data.qtSourcePath)}"`;
    h += ' placeholder="Qt 源码目录"';
    h += " onblur=\"vscode.postMessage({command:'saveQtSourcePath',value:this.value})\"/>";
    h += '<button class="btn btn-sm" onclick="vscode.postMessage(';
    h += "{command:'browse',targetId:'qtSourcePath',isDir:true})\">浏览</button>";
    h += '</div></div>';
    h += '</div></div></div>';

    // ── 构建工具 ──
    h += '<div class="cs"><div class="cst">构建工具</div>';
    h += '<div class="env-card"><div class="ech">';
    h += `<span class="sd ${jok ? 'dok' : 'dwn'}"></span>`;
    h += `<span class="ect" id="jomTitle">${data.isWin ? 'jom' : 'make'}</span>`;
    h += `<span class="ecb ${jok ? 'bok' : 'bwn'}" id="jomBadge">`;
    h += `${jok ? '自动检测' : '未找到'}</span></div>`;
    h += `<div class="ecp" id="jomPath">${esc(env?.jom || '未检测到')}</div></div></div>`;

    // ── 刷新按钮 ──
    h += '<div style="margin-top:8px"><button class="btn"';
    h += " onclick=\"vscode.postMessage({command:'refreshEnv'})\">";
    h += '重新扫描工具链</button>';
    h += '<div style="margin-top:6px;font-size:12px;color:var(--vscode-descriptionForeground)">';
    h += '重新检测系统上可用的 VS、Qt、jom 版本，不会覆盖已配置的路径</div></div>';

    // ── 脚本 ──
    h += buildEnvScript();

    return h;
}

function buildVsCandidateSelect(env: EnvInfo | null, currentPath: string): string {
    const candidates = env?.vsCandidates ?? [];
    if (candidates.length <= 1) { return ''; }
    const cur = candidates.find(c => c.devShellPath === currentPath);
    const curLabel = cur ? `VS ${cur.version} ${cur.edition}` : '选择版本';
    let h = '<div class="ef-row" id="vsCandidateRow"><span class="ef-label">快速选择</span>';
    h += `<div class="csel" id="vsSelect"><div class="csel-trigger" data-value="${esc(currentPath)}">${esc(curLabel)}</div>`;
    h += '<div class="csel-list">';
    for (const c of candidates) {
        const active = c.devShellPath === currentPath ? ' active' : '';
        h += `<div class="csel-item${active}" data-value="${esc(c.devShellPath)}">VS ${esc(c.version)} ${esc(c.edition)}</div>`;
    }
    h += '</div></div></div>';
    return h;
}

function buildQtCandidateSelect(env: EnvInfo | null, currentPath: string): string {
    const candidates = env?.qtCandidates ?? [];
    if (candidates.length <= 1) { return ''; }
    const cur = candidates.find(c => c.path === currentPath);
    const curLabel = cur ? `Qt ${cur.version} (${cur.compiler})` : '选择版本';
    let h = '<div class="ef-row" id="qtCandidateRow"><span class="ef-label">快速选择</span>';
    h += `<div class="csel" id="qtSelect"><div class="csel-trigger" data-value="${esc(currentPath)}">${esc(curLabel)}</div>`;
    h += '<div class="csel-list">';
    for (const c of candidates) {
        const active = c.path === currentPath ? ' active' : '';
        h += `<div class="csel-item${active}" data-value="${esc(c.path)}">Qt ${esc(c.version)} (${esc(c.compiler)})</div>`;
    }
    h += '</div></div></div>';
    return h;
}

function buildEnvScript(): string {
    let h = '<script>(function(){';

    // 展开/折叠面板
    h += 'window.togglePanel=function(id,btn){';
    h += 'var el=document.getElementById(id);';
    h += 'if(el){var isOpen=el.classList.toggle("open");';
    h += 'if(btn){var arrow=btn.querySelector(".env-toggle-arrow");';
    h += 'if(arrow){arrow.textContent=isOpen?"▴":"▾"}';
    h += 'btn.classList.toggle("active",isOpen)}}};';

    // 自定义下拉事件绑定
    h += 'var vsS=document.getElementById("vsSelect");';
    h += 'if(vsS)vsS.addEventListener("csel-change",function(e){';
    h += 'vscode.postMessage({command:"saveVsPath",value:e.detail.value})});';
    h += 'var qtS=document.getElementById("qtSelect");';
    h += 'if(qtS)qtS.addEventListener("csel-change",function(e){';
    h += 'vscode.postMessage({command:"saveQtPath",value:e.detail.value})});';

    // 消息监听
    h += 'window.addEventListener("message",function(e){var d=e.data;';

    // 浏览器返回路径
    h += 'if(d.command==="setPath"){var el=document.getElementById(d.targetId);';
    h += 'if(el){el.value=d.value;el.dispatchEvent(new Event("blur"))}}';

    // 环境检测更新 — 只更新卡片状态文字，不重建候选列表
    h += 'else if(d.command==="envUpdated"){';
    // VS 标题和状态
    h += 'var vsT=document.getElementById("vsTitle");';
    h += 'if(vsT){vsT.textContent=d.env.vs||"未检测到"}';
    h += 'var vsD=vsT?vsT.previousElementSibling:null;';
    h += 'if(vsD&&vsD.classList.contains("sd")){vsD.className="sd "+(d.env.vs?"dok":"dwn")}';
    // Qt 标题和状态
    h += 'var qtT=document.getElementById("qtTitle");';
    h += 'if(qtT){qtT.textContent=d.env.qt||"未检测到"}';
    h += 'var qtD=qtT?qtT.previousElementSibling:null;';
    h += 'if(qtD&&qtD.classList.contains("sd")){qtD.className="sd "+(d.env.qt?"dok":"dwn")}';
    // jom 标题和状态
    h += 'var jT=document.getElementById("jomTitle");';
    h += 'var jD=jT?jT.previousElementSibling:null;';
    h += 'if(jD&&jD.classList.contains("sd")){jD.className="sd "+(d.env.jom?"dok":"dwn")}';
    h += 'var jP=document.getElementById("jomPath");';
    h += 'if(jP){jP.textContent=d.env.jom||"未检测到"}';
    h += 'var jB=document.getElementById("jomBadge");';
    h += 'if(jB){jB.textContent=d.env.jom?"自动检测":"未找到";';
    h += 'jB.className="ecb "+(d.env.jom?"bok":"bwn")}';
    h += '}});';

    h += '})();</script>';
    return h;
}
