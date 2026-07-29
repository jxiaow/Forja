import { TemplateData } from '../template';

function esc(v: string): string {
    return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildAdvancedPage(data: TemplateData): string {
    let h = '<div class="page-title">高级配置</div>';
    h += '<div class="page-desc">低频配置项</div>';
    h += '<div class="cs"><div class="cst">项目路径</div>';
    h += '<div class="ci"><div class="cii"><div class="cil">手动指定 .pro</div>';
    h += '<div class="cid">扫描不到时手动指定</div></div>';
    h += '<div class="cic"><div class="input-row">';
    h += `<input id="manualProPath" value="${esc(data.manualProPath)}"`;
    h += " onblur=\"if(this.value.trim())vscode.postMessage({command:'saveManualProPath',";
    h += "value:this.value.trim()})\"/>";
    h += '<button class="btn btn-sm" onclick="vscode.postMessage(';
    h += "{command:'browse',targetId:'manualProPath',isDir:false})\">浏览</button>";
    h += '</div></div></div>';
    h += '<div class="ci"><div class="cii"><div class="cil">RCC 项目路径</div>';
    h += '<div class="cid">留空自动扫描</div></div>';
    h += '<div class="cic"><div class="input-row">';
    h += `<input id="rccProjectPath" value="${esc(data.rccProjectPath)}"`;
    h += " onblur=\"vscode.postMessage({command:'saveRccProjectPath',";
    h += "value:this.value.trim()})\"/>";
    h += '<button class="btn btn-sm" onclick="vscode.postMessage(';
    h += "{command:'browse',targetId:'rccProjectPath',isDir:true})\">浏览</button>";
    h += '</div></div></div></div>';
    h += buildAdvancedPart2(data);
    return h;
}

function buildAdvancedPart2(data: TemplateData): string {
    let h = '<div class="cs"><div class="cst">扫描设置</div>';
    h += '<div class="ci"><div class="cii"><div class="cil">排除目录</div>';
    h += '<div class="cid">已内置排除 build*, debug, release</div></div>';
    h += '<div class="cic" style="min-width:280px">';
    h += '<div class="tag-input" id="edw">';
    h += '<input id="edi" placeholder="回车添加" onkeydown="onEK(event)"/>';
    h += '</div></div></div></div>';
    h += '<div class="cs"><div class="cst">提醒</div>';
    h += '<div class="ci"><div class="cii"><div class="cil">文件同步提醒</div>';
    h += '<div class="cid">新增/删除文件时提示同步 .pri/.pro</div></div>';
    h += '<div class="cic" style="min-width:auto">';
    h += `<input type="checkbox" ${data.fileSyncPromptEnabled ? 'checked' : ''}`;
    h += ' style="width:16px;height:16px"';
    h += " onchange=\"vscode.postMessage({command:'saveFileSyncPromptEnabled',";
    h += "value:this.checked})\"/></div></div>";
    h += '<div class="ci"><div class="cii"><div class="cil">QMake 提醒</div>';
    h += '<div class="cid">.pro/.pri 变更时提示重新运行 QMake</div></div>';
    h += '<div class="cic" style="min-width:auto">';
    h += `<input type="checkbox" ${data.qmakeReminderEnabled ? 'checked' : ''}`;
    h += ' style="width:16px;height:16px"';
    h += " onchange=\"vscode.postMessage({command:'saveQmakeReminderEnabled',";
    h += "value:this.checked})\"/></div></div></div>";
    h += '<script>(function(){';
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
    h += 'if(el){el.value=d.value;el.dispatchEvent(new Event("blur"))}}});';
    h += '</script>';
    return h;
}
