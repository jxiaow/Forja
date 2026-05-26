import { TemplateData } from '../template';
import type { EnvInfo } from '../../../qt/env/envDetector';
import { jsLiteral } from '../jsLiteral';

function esc(v: string): string {
    return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildEnvPage(data: TemplateData): string {
    let h = '<div class="page-title">环境配置</div>';
    h += '<div class="page-desc">管理构建工具链</div>';

    h += buildQtEnvSection(data);
    if (data.isWin) { h += buildSdkEnvSection(data); }

    // 刷新按钮
    h += '<div style="margin-top:12px"><button class="btn"';
    h += " onclick=\"vscode.postMessage({command:'refreshEnv'})\">";
    h += '重新扫描工具链</button>';
    h += '<div style="margin-top:6px;font-size:12px;color:var(--vscode-descriptionForeground)">';
    h += '重新检测系统上可用的 VS、Qt、jom 版本</div></div>';

    h += buildEnvScript(data);
    return h;
}

// ── Qt 工具链 ──

function buildQtEnvSection(data: TemplateData): string {
    const env = data.env;
    const open = data.qtActive ? ' open' : '';
    const summary = data.qtActive ? 'Qt 工具链' : 'Qt 工具链 <span class="section-badge">未检测到</span>';

    let h = `<details class="section-collapse"${open}>`;
    h += `<summary class="section-header">${summary}</summary>`;

    if (!data.qtActive) {
        h += '<div class="section-inactive">';
        h += '<div class="section-inactive-hint">未检测到 Qt 项目，环境配置不可用</div>';
        h += '</div></details>';
        return h;
    }

    // Visual Studio (Qt)
    if (data.isWin) {
        const eds = data.vsDevShellPath || data.autoDevShell;
        const dss = data.vsDevShellPath ? '手动配置'
            : (data.autoDevShell ? '自动检测' : '未配置');
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
        h += '<div id="vsPanel" class="env-expand">';
        h += buildVsCandidateSelect(env, eds);
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

    // Qt
    const eqp = data.qtPath || data.autoQtPath;
    const qts = data.qtPath ? '手动配置'
        : (data.autoQtPath ? '自动检测' : '未配置');
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
    h += '<div id="qtPanel" class="env-expand">';
    h += buildQtCandidateSelect(env, eqp);
    h += '<div class="ef-row"><span class="ef-label">Qt 路径</span>';
    h += '<div class="input-row">';
    h += `<input id="qtPath" class="ef-input" value="${esc(data.qtPath)}" placeholder="Qt 编译器目录"`;
    h += " onblur=\"vscode.postMessage({command:'saveQtPath',value:this.value})\"/>";
    h += '<button class="btn btn-sm" onclick="vscode.postMessage(';
    h += "{command:'browse',targetId:'qtPath',isDir:true})\">浏览</button>";
    h += '</div></div>';
    h += '<div class="ef-row"><span class="ef-label">Designer <span class="ef-opt">可选</span></span>';
    h += '<div class="input-row">';
    h += `<input id="designerPath" class="ef-input" value="${esc(data.designerPath)}"`;
    h += ' placeholder="designer.exe 路径"';
    h += " onblur=\"vscode.postMessage({command:'saveDesignerPath',value:this.value})\"/>";
    h += '<button class="btn btn-sm" onclick="vscode.postMessage(';
    h += "{command:'browse',targetId:'designerPath',isDir:false})\">浏览</button>";
    h += '</div></div>';
    h += '<div class="ef-row"><span class="ef-label">Qt 源码 <span class="ef-opt">可选，调试用</span></span>';
    h += '<div class="input-row">';
    h += `<input id="qtSourcePath" class="ef-input" value="${esc(data.qtSourcePath)}"`;
    h += ' placeholder="Qt 源码目录"';
    h += " onblur=\"vscode.postMessage({command:'saveQtSourcePath',value:this.value})\"/>";
    h += '<button class="btn btn-sm" onclick="vscode.postMessage(';
    h += "{command:'browse',targetId:'qtSourcePath',isDir:true})\">浏览</button>";
    h += '</div></div>';
    h += '</div></div></div>';

    // 构建工具 (jom/make)
    const jok = !!env?.jom;
    h += '<div class="cs"><div class="cst">构建工具</div>';
    h += '<div class="env-card"><div class="ech">';
    h += `<span class="sd ${jok ? 'dok' : 'dwn'}"></span>`;
    h += `<span class="ect" id="jomTitle">${data.isWin ? 'jom' : 'make'}</span>`;
    h += `<span class="ecb ${jok ? 'bok' : 'bwn'}" id="jomBadge">`;
    h += `${jok ? '自动检测' : '未找到'}</span></div>`;
    h += `<div class="ecp" id="jomPath">${esc(env?.jom || '未检测到')}</div></div></div>`;

    h += '</details>';
    return h;
}

// ── SDK 工具链 ──

function buildSdkEnvSection(data: TemplateData): string {
    const env = data.env;
    const open = data.sdkActive ? ' open' : '';
    const summary = data.sdkActive ? 'SDK 工具链' : 'SDK 工具链 <span class="section-badge">未检测到</span>';

    let h = `<details class="section-collapse"${open}>`;
    h += `<summary class="section-header">${summary}</summary>`;

    if (!data.sdkActive) {
        h += '<div class="section-inactive">';
        h += '<div class="section-inactive-hint">未检测到 SDK 项目，SDK 环境配置不可用</div>';
        h += '</div></details>';
        return h;
    }

    const detectedVs = env?.vs ? `VS ${env.vs.version} ${env.vs.edition}` : '';
    const sdkVsEffective = data.sdkVsInstall || env?.vs?.installPath || '';
    const sdkVsBadge = data.sdkVsInstall ? '已配置' : (env?.vs ? '自动检测' : '未配置');
    const sdkVsTitle = detectedVs || (data.sdkVsInstall ? 'Visual Studio' : '未检测到');

    h += '<div class="cs"><div class="cst">Visual Studio (SDK)</div>';
    h += '<div class="env-card"><div class="ech">';
    h += `<span class="sd ${sdkVsEffective ? 'dok' : 'dwn'}"></span>`;
    h += `<span class="ect" id="sdkVsTitle">${esc(sdkVsTitle)}</span>`;
    h += `<span class="ecb ${sdkVsEffective ? 'bok' : 'bwn'}" id="sdkVsBadge">${esc(sdkVsBadge)}</span>`;
    h += '</div>';
    h += `<div class="ecp" id="sdkVsPath">${esc(sdkVsEffective || '未配置')}</div>`;
    h += '<div class="eca"><button class="btn btn-sm env-toggle-btn"';
    h += " onclick=\"togglePanel('sdkVsPanel',this)\">";
    h += '<span class="env-toggle-arrow">▾</span> 选择版本</button></div>';
    h += '<div id="sdkVsPanel" class="env-expand">';
    h += buildSdkVsCandidateSelect(env, data.sdkVsInstall);
    h += '<div class="ef-row"><span class="ef-label">VS 安装目录或 VsDevCmd</span>';
    h += '<div class="input-row">';
    h += `<input id="sdkVsInstall" class="ef-input" value="${esc(data.sdkVsInstall)}"`;
    h += ' placeholder="留空使用自动检测；可填 VS 安装目录或 VsDevCmd.bat"';
    h += " onblur=\"vscode.postMessage({command:'saveSdkVsInstall',value:this.value.trim()})\"/>";
    h += '<button class="btn btn-sm" onclick="vscode.postMessage(';
    h += "{command:'browse',targetId:'sdkVsInstall',isDir:true})\">浏览</button>";
    h += '</div></div>';
    h += '</div></div></div>';

    h += '</details>';
    return h;
}

// ── 辅助函数 ──

function buildVsCandidateSelect(env: EnvInfo | null, currentPath: string): string {
    const candidates = env?.vsCandidates ?? [];
    if (candidates.length === 0) { return ''; }
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

function buildSdkVsCandidateSelect(env: EnvInfo | null, currentPath: string): string {
    const candidates = env?.vsCandidates ?? [];
    if (candidates.length === 0) { return ''; }
    const cur = candidates.find(c => c.installPath === currentPath || c.devShellPath === currentPath);
    const curLabel = cur ? `VS ${cur.version} ${cur.edition}` : '选择版本';
    let h = '<div class="ef-row" id="sdkVsCandidateRow"><span class="ef-label">快速选择</span>';
    h += `<div class="csel" id="sdkVsSelect"><div class="csel-trigger" data-value="${esc(currentPath)}">${esc(curLabel)}</div>`;
    h += '<div class="csel-list">';
    for (const c of candidates) {
        const active = c.installPath === currentPath || c.devShellPath === currentPath ? ' active' : '';
        h += `<div class="csel-item${active}" data-value="${esc(c.installPath)}">VS ${esc(c.version)} ${esc(c.edition)}</div>`;
    }
    h += '</div></div></div>';
    return h;
}

function buildQtCandidateSelect(env: EnvInfo | null, currentPath: string): string {
    const candidates = env?.qtCandidates ?? [];
    if (candidates.length === 0) { return ''; }
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

function buildEnvScript(data: TemplateData): string {
    const vsCandidateLabels: Record<string, string> = {};
    const vsCandidateInstalls: Record<string, string> = {};
    for (const c of data.env?.vsCandidates ?? []) {
        const label = `VS ${c.version} ${c.edition}`;
        vsCandidateLabels[c.devShellPath] = label;
        vsCandidateLabels[c.installPath] = label;
        vsCandidateInstalls[c.devShellPath] = c.installPath;
        vsCandidateInstalls[c.installPath] = c.installPath;
    }
    const qtCandidateLabels: Record<string, string> = {};
    for (const c of data.env?.qtCandidates ?? []) {
        qtCandidateLabels[c.path] = `Qt ${c.version} (${c.compiler})`;
    }
    let h = '<script>(function(){';
    h += `var vsCandidateLabels=${jsLiteral(JSON.stringify(vsCandidateLabels))};`;
    h += 'vsCandidateLabels=JSON.parse(vsCandidateLabels);';
    h += `var vsCandidateInstalls=${jsLiteral(JSON.stringify(vsCandidateInstalls))};`;
    h += 'vsCandidateInstalls=JSON.parse(vsCandidateInstalls);';
    h += `var qtCandidateLabels=${jsLiteral(JSON.stringify(qtCandidateLabels))};`;
    h += 'qtCandidateLabels=JSON.parse(qtCandidateLabels);';
    h += 'function currentValue(id){var el=document.getElementById(id);var v=el?el.value||"":"";if(v){return v}';
    h += 'var map={vsDevShellPath:"vsPath",sdkVsInstall:"sdkVsPath",qtPath:"qtPathDisplay"};';
    h += 'var d=document.getElementById(map[id]);var t=d?d.textContent||"":"";return t==="未配置"?"":t}';
    h += 'function updateVsDisplayFromPath(path,label){';
    h += 'label=vsCandidateLabels[path]||label;';
    h += 'var input=document.getElementById("vsDevShellPath");if(input){input.value=path||""}';
    h += 'var vsP=document.getElementById("vsPath");if(vsP){vsP.textContent=path||"未配置"}';
    h += 'var vsB=document.getElementById("vsBadge");if(vsB){vsB.textContent=path?"手动配置":"未配置";vsB.className="ecb "+(path?"bok":"bwn")}';
    h += 'var vsT=document.getElementById("vsTitle");if(vsT&&label){vsT.textContent=label}';
    h += 'var vsD=vsT?vsT.previousElementSibling:null;if(vsD&&vsD.classList.contains("sd")){vsD.className="sd "+(path?"dok":"dwn")}';
    h += 'var trigger=document.querySelector("#vsSelect .csel-trigger");if(trigger){trigger.dataset.value=path||"";if(label){trigger.textContent=label}}';
    h += '}';
    h += 'function updateSdkVsDisplayFromPath(path,label){';
    h += 'label=vsCandidateLabels[path]||label;';
    h += 'var install=vsCandidateInstalls[path]||path||"";';
    h += 'var input=document.getElementById("sdkVsInstall");if(input){input.value=install}';
    h += 'var sdkVsP=document.getElementById("sdkVsPath");if(sdkVsP){sdkVsP.textContent=install||"未配置"}';
    h += 'var sdkVsB=document.getElementById("sdkVsBadge");if(sdkVsB){sdkVsB.textContent=install?"已配置":"未配置";sdkVsB.className="ecb "+(install?"bok":"bwn")}';
    h += 'var sdkVsT=document.getElementById("sdkVsTitle");if(sdkVsT&&label){sdkVsT.textContent=label}';
    h += 'var sdkVsD=sdkVsT?sdkVsT.previousElementSibling:null;if(sdkVsD&&sdkVsD.classList.contains("sd")){sdkVsD.className="sd "+(install?"dok":"dwn")}';
    h += 'var trigger=document.querySelector("#sdkVsSelect .csel-trigger");if(trigger){trigger.dataset.value=install;if(label){trigger.textContent=label}}';
    h += '}';
    h += 'function updateQtDisplayFromPath(path,label){';
    h += 'label=qtCandidateLabels[path]||label;';
    h += 'var input=document.getElementById("qtPath");if(input){input.value=path||""}';
    h += 'var qtP=document.getElementById("qtPathDisplay");if(qtP){qtP.textContent=path||"未配置"}';
    h += 'var qtB=document.getElementById("qtBadge");if(qtB){qtB.textContent=path?"手动配置":"未配置";qtB.className="ecb "+(path?"bok":"bwn")}';
    h += 'var qtT=document.getElementById("qtTitle");if(qtT&&label){qtT.textContent=label}';
    h += 'var qtD=qtT?qtT.previousElementSibling:null;if(qtD&&qtD.classList.contains("sd")){qtD.className="sd "+(path?"dok":"dwn")}';
    h += 'var trigger=document.querySelector("#qtSelect .csel-trigger");if(trigger){trigger.dataset.value=path||"";if(label){trigger.textContent=label}}';
    h += '}';
    h += 'window.togglePanel=function(id,btn){';
    h += 'var el=document.getElementById(id);';
    h += 'if(el){var isOpen=el.classList.toggle("open");';
    h += 'if(btn){var arrow=btn.querySelector(".env-toggle-arrow");';
    h += 'if(arrow){arrow.textContent=isOpen?"▴":"▾"}';
    h += 'btn.classList.toggle("active",isOpen)}}};';
    h += 'var vsS=document.getElementById("vsSelect");';
    h += 'if(vsS)vsS.addEventListener("csel-change",function(e){';
    h += 'updateVsDisplayFromPath(e.detail.value);';
    h += 'vscode.postMessage({command:"saveVsPath",value:e.detail.value})});';
    h += 'var sdkVsS=document.getElementById("sdkVsSelect");';
    h += 'if(sdkVsS)sdkVsS.addEventListener("csel-change",function(e){';
    h += 'updateSdkVsDisplayFromPath(e.detail.value);';
    h += 'vscode.postMessage({command:"saveSdkVsInstall",value:e.detail.value})});';
    h += 'var qtS=document.getElementById("qtSelect");';
    h += 'if(qtS)qtS.addEventListener("csel-change",function(e){';
    h += 'updateQtDisplayFromPath(e.detail.value);';
    h += 'vscode.postMessage({command:"saveQtPath",value:e.detail.value})});';
    h += 'window.addEventListener("message",function(e){var d=e.data;';
    h += 'if(d.command==="setPath"){var el=document.getElementById(d.targetId);';
    h += 'if(el){el.value=d.value;el.dispatchEvent(new Event("blur"))}}';
    h += 'else if(d.command==="devShellUpdated"){updateVsDisplayFromPath(d.effective,d.label)}';
    h += 'else if(d.command==="qtPathUpdated"){updateQtDisplayFromPath(d.effective,d.label)}';
    h += 'else if(d.command==="envUpdated"){';
    h += 'if(d.vsCandidates){vsCandidateLabels={};vsCandidateInstalls={};d.vsCandidates.forEach(function(c){var install=c.installPath||c.value;vsCandidateLabels[c.value]=c.label;vsCandidateLabels[install]=c.label;vsCandidateInstalls[c.value]=install;vsCandidateInstalls[install]=install})}';
    h += 'if(d.qtCandidates){qtCandidateLabels={};d.qtCandidates.forEach(function(c){qtCandidateLabels[c.value]=c.label})}';
    h += 'updateVsDisplayFromPath(currentValue("vsDevShellPath"),d.env.vs);';
    h += 'updateSdkVsDisplayFromPath(currentValue("sdkVsInstall"),d.env.vs);';
    h += 'updateQtDisplayFromPath(currentValue("qtPath"),d.env.qt);';
    h += 'var vsT=document.getElementById("vsTitle");';
    h += 'var vsD=vsT?vsT.previousElementSibling:null;';
    h += 'if(vsD&&vsD.classList.contains("sd")){vsD.className="sd "+(d.env.vs?"dok":"dwn")}';
    h += 'var sdkVsT=document.getElementById("sdkVsTitle");';
    h += 'var sdkVsD=sdkVsT?sdkVsT.previousElementSibling:null;';
    h += 'if(sdkVsD&&sdkVsD.classList.contains("sd")){sdkVsD.className="sd "+(d.env.vs?"dok":"dwn")}';
    h += 'var qtT=document.getElementById("qtTitle");';
    h += 'var qtD=qtT?qtT.previousElementSibling:null;';
    h += 'if(qtD&&qtD.classList.contains("sd")){qtD.className="sd "+(d.env.qt?"dok":"dwn")}';
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
