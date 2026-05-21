import { TemplateData } from '../template';
import { getEffectiveProjectName } from '../../../qt/project/projectDisplay';

function esc(v: string): string {
    return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function csel(id: string, options: { value: string; label: string }[], current: string): string {
    const cur = options.find(o => o.value === current);
    const label = cur ? cur.label : options[0]?.label || '';
    let h = `<div class="csel" id="${id}">`;
    h += `<div class="csel-trigger" data-value="${esc(current)}">${esc(label)}</div>`;
    h += '<div class="csel-list">';
    for (const o of options) {
        const active = o.value === current ? ' active' : '';
        h += `<div class="csel-item${active}" data-value="${esc(o.value)}">${esc(o.label)}</div>`;
    }
    h += '</div></div>';
    return h;
}

export function buildProjectPage(data: TemplateData): string {
    const pn = getEffectiveProjectName(
        data.project, data.target, data.pinnedProject || '未选择');
    const et = data.target || data.project?.target || '';
    let h = '<div class="page-title">项目配置</div>';
    h += '<div class="page-desc">管理构建参数和 IntelliSense 设置</div>';

    // ── Qt 折叠 section ──
    h += '<details class="section-collapse" open>';
    h += '<summary class="section-header">Qt 项目</summary>';

    if (!data.qtActive) {
        h += '<div class="section-disabled-hint">未检测到 Qt 项目（.pro 文件），请先选择或创建项目</div>';
    }

    // 当前项目
    h += '<div class="cs"><div class="cst">当前项目</div>';
    h += '<div class="ci"><div class="cii"><div class="cil">活动项目</div>';
    h += '<div class="cid">选择要构建的 .pro 项目</div></div>';
    h += '<div class="cic"><div class="input-row" style="align-items:center;justify-content:flex-end">';
    h += `<span style="font-size:14px;font-weight:600;color:var(--vscode-foreground)">${esc(pn)}</span>`;
    h += '<button class="btn btn-sm" onclick="vscode.postMessage(';
    h += "{command:'selectProject'})\">切换</button>";
    h += '<button class="btn btn-sm" onclick="vscode.postMessage(';
    h += "{command:'browse',targetId:'manualProPath',isDir:false})\">手动指定</button>";
    h += '</div></div></div>';
    h += '<input id="manualProPath" type="hidden" value=""/>';
    h += '<div class="ci"><div class="cii"><div class="cil">输出名称</div>';
    h += '<div class="cid">覆盖 .pro 中的 TARGET，留空使用默认值</div></div>';
    h += `<div class="cic"><input id="target" value="${esc(et)}"`;
    h += ' placeholder="留空使用默认"';
    h += " onblur=\"vscode.postMessage({command:'saveQmakeTarget',";
    h += "value:this.value.trim()})\"/></div></div>";
    h += '<div class="ci"><div class="cii"><div class="cil">RCC 项目</div>';
    h += '<div class="cid">资源编译器项目路径，留空自动扫描</div></div>';
    h += '<div class="cic"><div class="input-row">';
    h += `<input id="rccProjectPath" value="${esc(data.rccProjectPath)}"`;
    h += ' placeholder="留空自动扫描"';
    h += " onblur=\"vscode.postMessage({command:'saveRccProjectPath',";
    h += "value:this.value.trim()})\"/>";
    h += '<button class="btn btn-sm" onclick="vscode.postMessage(';
    h += "{command:'browse',targetId:'rccProjectPath',isDir:true})\">浏览</button>";
    h += '</div></div></div></div>';
    // 构建参数
    const qtDisabled = !data.qtActive ? ' disabled' : '';
    h += `<div class="cs"${qtDisabled}><div class="cst">构建参数</div>`;
    h += '<div class="ci"><div class="cii"><div class="cil">构建模式</div>';
    h += '<div class="cid">Debug 含调试符号，Release 启用优化</div></div>';
    h += '<div class="cic"><div class="btn-group" id="mG">';
    const mDebug = data.mode !== 'release' ? ' active' : '';
    const mRelease = data.mode === 'release' ? ' active' : '';
    h += `<button class="bgi${mDebug}" onclick="setM('debug')">debug</button>`;
    h += `<button class="bgi${mRelease}" onclick="setM('release')">release</button>`;
    h += '</div></div></div>';
    if (data.isWin) {
        h += '<div class="ci"><div class="cii"><div class="cil">目标架构</div></div>';
        h += '<div class="cic"><div class="btn-group" id="aG">';
        const aX86 = data.arch !== 'x64' ? ' active' : '';
        const aX64 = data.arch === 'x64' ? ' active' : '';
        h += `<button class="bgi${aX86}" onclick="setA('x86')">x86</button>`;
        h += `<button class="bgi${aX64}" onclick="setA('x64')">x64</button>`;
        h += '</div></div></div>';
    }
    // 语言标准
    h += `<div class="cs"${qtDisabled}><div class="cst">语言标准</div>`;
    h += '<div class="ci"><div class="cii"><div class="cil">C 标准</div></div>';
    h += '<div class="cic">';
    h += csel('cStd', [
        { value: 'c89', label: 'C89' }, { value: 'c99', label: 'C99' },
        { value: 'c11', label: 'C11' }, { value: 'c17', label: 'C17' }
    ], data.cStandard);
    h += '</div></div>';

    h += buildProjectPagePart2(data);

    h += '</details>'; // end Qt section

    // ── SDK 折叠 section ──
    h += buildSdkSection(data);

    return h;
}

function buildProjectPagePart2(data: TemplateData): string {
    let h = '<div class="ci"><div class="cii"><div class="cil">C++ 标准</div></div>';
    h += '<div class="cic">';
    h += csel('cppStd', [
        { value: 'c++11', label: 'C++11' }, { value: 'c++14', label: 'C++14' },
        { value: 'c++17', label: 'C++17' }, { value: 'c++20', label: 'C++20' },
        { value: 'c++23', label: 'C++23' }
    ], data.cppStandard);
    h += '</div></div>';
    h += '<div class="ci" style="flex-direction:column;align-items:stretch"><div class="cii"><div class="cil">排除目录</div>';
    h += '<div class="cid">IntelliSense 扫描时跳过，已内置 build*, debug, release</div></div>';
    h += '<div style="margin-top:8px">';
    h += '<div class="tag-input" id="edw">';
    h += '<input id="edi" placeholder="回车添加" onkeydown="onEK(event)"/>';
    h += '</div></div></div>';
    h += '<div style="margin-top:12px"><button class="btn btn-primary"';
    h += " onclick=\"vscode.postMessage({command:'generateIntelliSense',";
    h += "cStandard:document.querySelector('#cStd .csel-trigger').dataset.value,";
    h += "cppStandard:document.querySelector('#cppStd .csel-trigger').dataset.value})\">";
    h += '生成 IntelliSense 配置</button></div></div>';
    h += '<script>';
    h += 'function savS(){vscode.postMessage({command:"saveStandard",';
    h += 'cStandard:document.querySelector("#cStd .csel-trigger").dataset.value,';
    h += 'cppStandard:document.querySelector("#cppStd .csel-trigger").dataset.value})}';
    h += 'var cStdEl=document.getElementById("cStd");';
    h += 'if(cStdEl)cStdEl.addEventListener("csel-change",savS);';
    h += 'var cppStdEl=document.getElementById("cppStd");';
    h += 'if(cppStdEl)cppStdEl.addEventListener("csel-change",savS);';
    h += 'function setM(m){document.querySelectorAll("#mG .bgi")';
    h += '.forEach(b=>b.classList.remove("active"));';
    h += 'event.currentTarget.classList.add("active");';
    h += 'vscode.postMessage({command:"saveMode",value:m})}';
    h += 'function setA(a){document.querySelectorAll("#aG .bgi")';
    h += '.forEach(b=>b.classList.remove("active"));';
    h += 'event.currentTarget.classList.add("active");';
    h += 'vscode.postMessage({command:"saveArch",value:a})}';
    // tag input for exclude dirs
    h += '(function(){';
    h += `var d='${esc(data.scanExcludeDirs)}'.split(', ').filter(function(s){return s.length>0});`;
    h += 'var w=document.getElementById("edw");var i=w.querySelector("input");';
    h += 'd.forEach(aT);';
    h += 'function aT(v){var t=document.createElement("span");t.className="tag-item";';
    h += 't.dataset.value=v;t.textContent=v;t.onclick=function(){t.remove();sT()};';
    h += 'w.insertBefore(t,i)}';
    h += 'window.onEK=function(e){';
    h += 'if(e.key==="Enter"||e.key===","){e.preventDefault();';
    h += 'var v=e.target.value.trim().replace(/,/g,"");';
    h += 'if(v){aT(v);e.target.value="";sT()}}';
    h += 'else if(e.key==="Backspace"&&!e.target.value){';
    h += 'var ts=w.querySelectorAll(".tag-item");';
    h += 'if(ts.length){ts[ts.length-1].remove();sT()}}};';
    h += 'function sT(){var ts=Array.from(w.querySelectorAll(".tag-item"))';
    h += '.map(function(el){return el.dataset.value});';
    h += 'vscode.postMessage({command:"saveExcludeDirs",dirs:ts})}';
    h += '})();';
    h += 'window.addEventListener("message",function(e){var d=e.data;';
    h += 'if(d.command==="setPath"){var el=document.getElementById(d.targetId);';
    h += 'if(el){el.value=d.value;';
    h += 'if(d.targetId==="manualProPath"){vscode.postMessage({command:"saveManualProPath",value:d.value})}';
    h += 'else{el.dispatchEvent(new Event("blur"))}}}';
    h += 'else if(d.command==="settingsUpdated"){';
    h += 'if(d.mode!==undefined){var mBtns=document.querySelectorAll("#mG .bgi");';
    h += 'mBtns.forEach(function(b){b.classList.remove("active")});';
    h += 'var mIdx=d.mode==="release"?1:0;if(mBtns[mIdx])mBtns[mIdx].classList.add("active")}';
    h += 'if(d.arch!==undefined){var aBtns=document.querySelectorAll("#aG .bgi");';
    h += 'aBtns.forEach(function(b){b.classList.remove("active")});';
    h += 'var aIdx=d.arch==="x64"?1:0;if(aBtns[aIdx])aBtns[aIdx].classList.add("active")}';
    h += '}';
    h += 'else if(d.command==="sdkSettingsUpdated"){';
    h += 'if(d.sdkMode!==undefined){var sBtns=document.querySelectorAll("#sdkMG .bgi");';
    h += 'sBtns.forEach(function(b){b.classList.remove("active")});';
    h += 'var sIdx=d.sdkMode==="release"?1:0;if(sBtns[sIdx])sBtns[sIdx].classList.add("active")}';
    h += 'if(d.sdkArch!==undefined){var saBtns=document.querySelectorAll("#sdkAG .bgi");';
    h += 'saBtns.forEach(function(b){b.classList.remove("active")});';
    h += 'var saIdx=d.sdkArch==="x64"?1:0;if(saBtns[saIdx])saBtns[saIdx].classList.add("active")}';
    h += '}});';
    h += '</script>';
    return h;
}

function buildSdkSection(data: TemplateData): string {
    let h = '<details class="section-collapse" open>';
    h += '<summary class="section-header">SDK 项目</summary>';

    if (!data.sdkActive) {
        h += '<div class="section-disabled-hint">未检测到 SDK 项目（.sln / Makefile），请先选择或创建项目</div>';
    }

    // 当前项目
    h += '<div class="cs"><div class="cst">当前项目</div>';
    h += '<div class="ci"><div class="cii"><div class="cil">活动项目</div>';
    h += '<div class="cid">选择要构建的 .sln 项目</div></div>';
    h += '<div class="cic"><div class="input-row" style="align-items:center;justify-content:flex-end">';
    h += `<span style="font-size:14px;font-weight:600;color:var(--vscode-foreground)">${esc(data.sdkProjectName)}</span>`;
    h += '<button class="btn btn-sm" onclick="vscode.postMessage(';
    h += "{command:'selectSdkProject'})\">切换</button>";
    h += '</div></div></div></div>';

    // 构建参数
    const sdkDisabled = !data.sdkActive ? ' disabled' : '';
    h += `<div class="cs"${sdkDisabled}><div class="cst">构建参数</div>`;
    h += '<div class="ci"><div class="cii"><div class="cil">构建模式</div>';
    h += '<div class="cid">Debug 含调试符号，Release 启用优化</div></div>';
    h += '<div class="cic"><div class="btn-group" id="sdkMG">';
    const mDebug = data.sdkMode !== 'release' ? ' active' : '';
    const mRelease = data.sdkMode === 'release' ? ' active' : '';
    h += `<button class="bgi${mDebug}" onclick="setSdkM('debug')">debug</button>`;
    h += `<button class="bgi${mRelease}" onclick="setSdkM('release')">release</button>`;
    h += '</div></div></div>';
    if (data.isWin) {
        h += '<div class="ci"><div class="cii"><div class="cil">目标架构</div></div>';
        h += '<div class="cic"><div class="btn-group" id="sdkAG">';
        const aX86 = data.sdkArch !== 'x64' ? ' active' : '';
        const aX64 = data.sdkArch === 'x64' ? ' active' : '';
        h += `<button class="bgi${aX86}" onclick="setSdkA('x86')">x86</button>`;
        h += `<button class="bgi${aX64}" onclick="setSdkA('x64')">x64</button>`;
        h += '</div></div></div>';
    }
    h += '</div>'; // end 构建参数 cs

    // VS 环境
    h += `<div class="cs"${sdkDisabled}><div class="cst">VS 环境</div>`;
    h += '<div class="ci"><div class="cii"><div class="cil">Visual Studio 路径</div>';
    h += '<div class="cid">VsDevCmd.bat 或安装目录</div></div>';
    h += '<div class="cic"><div class="input-row">';
    h += `<input id="sdkVsInstall" value="${esc(data.sdkVsInstall)}"`;
    h += ' placeholder="留空使用自动检测"';
    h += " onblur=\"vscode.postMessage({command:'saveSdkVsInstall',";
    h += "value:this.value.trim()})\"/>";
    h += '<button class="btn btn-sm" onclick="vscode.postMessage(';
    h += "{command:'browse',targetId:'sdkVsInstall',isDir:true})\">浏览</button>";
    h += '</div></div></div></div>';

    // SDK section JS
    h += '<script>';
    h += 'function setSdkM(m){document.querySelectorAll("#sdkMG .bgi")';
    h += '.forEach(b=>b.classList.remove("active"));';
    h += 'event.currentTarget.classList.add("active");';
    h += 'vscode.postMessage({command:"saveSdkMode",value:m})}';
    h += 'function setSdkA(a){document.querySelectorAll("#sdkAG .bgi")';
    h += '.forEach(b=>b.classList.remove("active"));';
    h += 'event.currentTarget.classList.add("active");';
    h += 'vscode.postMessage({command:"saveSdkArch",value:a})}';
    h += '</script>';

    h += '</details>'; // end SDK section
    return h;
}
