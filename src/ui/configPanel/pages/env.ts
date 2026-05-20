import { TemplateData } from '../template';

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
    if (data.isWin) {
        h += '<div class="cs"><div class="cst">Visual Studio</div>';
        h += '<div class="env-card"><div class="ech">';
        h += `<span class="sd ${eds ? 'dok' : 'dwn'}"></span>`;
        h += '<span class="ect">';
        h += env?.vs ? esc('VS ' + env.vs.version + ' ' + env.vs.edition)
            : '未检测到';
        h += '</span>';
        h += `<span class="ecb ${eds ? 'bok' : 'bwn'}">${esc(dss)}</span>`;
        h += '</div>';
        h += `<div class="ecp">${esc(eds || '未配置')}</div>`;
        h += '<div class="eca"><button class="btn btn-sm"';
        h += " onclick=\"document.getElementById('vsO').style.display=''\">";
        h += '手动覆盖</button></div></div>';
        h += '<div id="vsO" style="display:none">';
        h += '<div class="ci"><div class="cii">';
        h += '<div class="cil">DevShell 路径</div></div>';
        h += '<div class="cic"><div class="input-row">';
        h += `<input id="vsDevShellPath" value="${esc(data.vsDevShellPath)}"`;
        h += ' placeholder="Launch-VsDevShell.ps1"';
        h += " onblur=\"vscode.postMessage({command:'saveVsPath',value:this.value})\"/>";
        h += '<button class="btn btn-sm" onclick="vscode.postMessage(';
        h += "{command:'browse',targetId:'vsDevShellPath',isDir:false})\">";
        h += '浏览</button></div></div></div></div></div>';
    }
    h += buildEnvPageQt(data, eqp, qts, jok);
    return h;
}

function buildEnvPageQt(
    data: TemplateData, eqp: string, qts: string, jok: boolean
): string {
    const env = data.env;
    let h = '<div class="cs"><div class="cst">Qt</div>';
    h += '<div class="env-card"><div class="ech">';
    h += `<span class="sd ${eqp ? 'dok' : 'dwn'}"></span>`;
    h += '<span class="ect">';
    h += env?.qt ? esc('Qt ' + env.qt.version + ' (' + env.qt.compiler + ')')
        : '未检测到';
    h += '</span>';
    h += `<span class="ecb ${eqp ? 'bok' : 'bwn'}">${esc(qts)}</span></div>`;
    h += `<div class="ecp">${esc(eqp || '未配置')}</div>`;
    h += '<div class="eca"><button class="btn btn-sm"';
    h += " onclick=\"document.getElementById('qtO').style.display=''\">";
    h += '修改路径</button></div></div>';
    h += '<div id="qtO" style="display:none">';
    h += '<div class="ci"><div class="cii"><div class="cil">Qt 路径</div></div>';
    h += '<div class="cic"><div class="input-row">';
    h += `<input id="qtPath" value="${esc(data.qtPath)}" placeholder="Qt 编译器目录"`;
    h += " onblur=\"vscode.postMessage({command:'saveQtPath',value:this.value})\"/>";
    h += '<button class="btn btn-sm" onclick="vscode.postMessage(';
    h += "{command:'browse',targetId:'qtPath',isDir:true})\">浏览</button>";
    h += '</div></div></div>';
    h += '<div class="ci"><div class="cii"><div class="cil">Designer</div>';
    h += '<div class="cid">可选</div></div><div class="cic"><div class="input-row">';
    h += `<input id="designerPath" value="${esc(data.designerPath)}"`;
    h += " onblur=\"vscode.postMessage({command:'saveDesignerPath',value:this.value})\"/>";
    h += '<button class="btn btn-sm" onclick="vscode.postMessage(';
    h += "{command:'browse',targetId:'designerPath',isDir:false})\">浏览</button>";
    h += '</div></div></div>';
    h += '<div class="ci"><div class="cii"><div class="cil">Qt 源码</div>';
    h += '<div class="cid">可选，调试用</div></div><div class="cic"><div class="input-row">';
    h += `<input id="qtSourcePath" value="${esc(data.qtSourcePath)}"`;
    h += " onblur=\"vscode.postMessage({command:'saveQtSourcePath',value:this.value})\"/>";
    h += '<button class="btn btn-sm" onclick="vscode.postMessage(';
    h += "{command:'browse',targetId:'qtSourcePath',isDir:true})\">浏览</button>";
    h += '</div></div></div></div></div>';
    // jom
    h += '<div class="cs"><div class="cst">构建工具</div>';
    h += '<div class="env-card"><div class="ech">';
    h += `<span class="sd ${jok ? 'dok' : 'dwn'}"></span>`;
    h += `<span class="ect">${data.isWin ? 'jom' : 'make'}</span>`;
    h += `<span class="ecb ${jok ? 'bok' : 'bwn'}">`;
    h += `${jok ? '自动检测' : '未找到'}</span></div>`;
    h += `<div class="ecp">${esc(env?.jom || '未检测到')}</div></div></div>`;
    h += '<div style="margin-top:8px"><button class="btn"';
    h += " onclick=\"vscode.postMessage({command:'refreshEnv'})\">";
    h += '刷新环境检测</button></div>';
    // 候选列表容器（多候选时由 envUpdated 消息填充）
    h += '<div id="vsCandidates" class="cs" style="display:none">';
    h += '<div class="cst">VS 候选版本</div>';
    h += '<div class="ci"><div class="cii"><div class="cil">选择版本</div></div>';
    h += '<div class="cic"><select id="vsSelect" onchange="';
    h += "vscode.postMessage({command:'saveVsPath',value:this.value})\">";
    h += '</select></div></div></div>';
    h += '<div id="qtCandidates" class="cs" style="display:none">';
    h += '<div class="cst">Qt 候选版本</div>';
    h += '<div class="ci"><div class="cii"><div class="cil">选择版本</div></div>';
    h += '<div class="cic"><select id="qtSelect" onchange="';
    h += "vscode.postMessage({command:'saveQtPath',value:this.value})\">";
    h += '</select></div></div></div>';
    h += '<script>';
    h += 'window.addEventListener("message",function(e){var d=e.data;';
    h += 'if(d.command==="setPath"){var el=document.getElementById(d.targetId);';
    h += 'if(el){el.value=d.value;el.dispatchEvent(new Event("blur"))}}';
    h += 'else if(d.command==="envUpdated"){';
    // 更新 VS badge 和路径
    h += 'var vsD=document.querySelector(".cs:first-of-type .sd");';
    h += 'if(vsD){vsD.className="sd "+(d.env.vs?"dok":"dwn")}';
    h += 'var vsT=document.querySelector(".cs:first-of-type .ect");';
    h += 'if(vsT){vsT.textContent=d.env.vs||"未检测到"}';
    // 更新 jom badge 和路径
    h += 'var jB=document.querySelectorAll(".sd");var jLast=jB[jB.length-1];';
    h += 'if(jLast){jLast.className="sd "+(d.env.jom?"dok":"dwn")}';
    // 候选列表
    h += 'var vsC=document.getElementById("vsCandidates");';
    h += 'var vsS=document.getElementById("vsSelect");';
    h += 'if(vsC&&vsS&&d.vsCandidates&&d.vsCandidates.length>1){';
    h += 'vsC.style.display="";vsS.innerHTML="";';
    h += 'd.vsCandidates.forEach(function(c){var o=document.createElement("option");';
    h += 'o.value=c.value;o.textContent=c.label;vsS.appendChild(o)});';
    h += '}else if(vsC){vsC.style.display="none"}';
    h += 'var qtC=document.getElementById("qtCandidates");';
    h += 'var qtS=document.getElementById("qtSelect");';
    h += 'if(qtC&&qtS&&d.qtCandidates&&d.qtCandidates.length>1){';
    h += 'qtC.style.display="";qtS.innerHTML="";';
    h += 'd.qtCandidates.forEach(function(c){var o=document.createElement("option");';
    h += 'o.value=c.value;o.textContent=c.label;qtS.appendChild(o)});';
    h += '}else if(qtC){qtC.style.display="none"}';
    h += '}});';
    h += '</script>';
    return h;
}
