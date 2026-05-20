import { TemplateData } from '../template';

function esc(v: string): string {
    return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildSyncPage(data: TemplateData): string {
    const opts = data.syncServers.length > 0
        ? data.syncServers.map(s => {
            const selected = s.id === data.syncSelectedServer ? 'selected' : '';
            return `<option value="${esc(s.id)}" ${selected}>${esc(s.name)} (${esc(s.username)}@${esc(s.host)})</option>`;
        }).join('')
        : '<option value="">— 无服务器 —</option>';
    const srv = data.syncServers.find(s => s.id === data.syncSelectedServer);
    let h = '<div class="page-title">远程同步</div>';
    h += '<div class="page-desc">将变更文件同步到远程服务器</div>';
    h += '<div class="cs"><div class="cst">同步设置</div>';
    h += '<div class="ci"><div class="cii"><div class="cil">启用远程同步</div></div>';
    h += '<div class="cic" style="min-width:auto"><label class="toggle-switch">';
    h += `<input type="checkbox" ${data.syncEnabled ? 'checked' : ''}`;
    h += " onchange=\"vscode.postMessage({command:'saveSyncEnabled',value:this.checked})\"/>";
    h += '<span class="toggle-slider"></span></label></div></div>';
    h += '<div class="ci"><div class="cii"><div class="cil">服务器</div></div>';
    h += '<div class="cic"><div class="input-row">';
    h += `<select onchange="vscode.postMessage({command:'saveSyncSelectedServer',value:this.value})">${opts}</select>`;
    h += '<button class="btn btn-sm">+</button></div></div></div>';
    h += '<div class="ci"><div class="cii"><div class="cil">远程路径</div></div>';
    h += `<div class="cic"><input value="${esc(data.syncRemotePath)}"`;
    h += ' placeholder="/home/user/project"';
    h += " onblur=\"vscode.postMessage({command:'saveSyncRemotePath',";
    h += "value:this.value.trim()})\"/></div></div></div>";
    if (srv) {
        h += '<div class="cs"><div class="cst">连接状态</div>';
        h += '<div class="env-card"><div class="ech">';
        h += '<span class="sd dok"></span>';
        h += `<span class="ect">${esc(srv.username)}@${esc(srv.host)}:${srv.port}</span>`;
        const auth = srv.authMode === 'key' ? 'SSH 密钥' : '密码';
        h += `<span class="ecb bok">${auth}</span></div>`;
        const pending = data.syncPendingCount > 0
            ? data.syncPendingCount + ' 个文件待同步' : '已同步';
        const last = data.syncLastTime
            ? ' · 上次: ' + esc(data.syncLastTime) : '';
        h += `<div class="ecp" style="font-family:var(--vscode-font-family)">`;
        h += `${pending}${last}</div>`;
        h += '<div class="eca"><button class="btn btn-sm"';
        h += " onclick=\"vscode.postMessage({command:'testSyncConnection'})\">";
        h += '测试连接</button></div></div></div>';
    }
    h += buildSyncIgnore(data);
    return h;
}

function buildSyncIgnore(data: TemplateData): string {
    let h = '<div class="cs"><div class="cst">忽略列表</div>';
    h += '<div class="ci"><div class="cii"><div class="cil">忽略目录</div></div>';
    h += '<div class="cic" style="min-width:280px">';
    h += '<div class="tag-input" id="siw">';
    h += '<input id="sii" placeholder="回车添加" onkeydown="onSK(event)"/>';
    h += '</div></div></div></div>';
    h += '<script>(function(){';
    h += `var d='${esc(data.syncIgnore)}'.split(', ').filter(function(s){return s.length>0});`;
    h += 'var w=document.getElementById("siw");var i=w.querySelector("input");';
    h += 'd.forEach(aT);';
    h += 'function aT(v){var t=document.createElement("span");t.className="tag-item";';
    h += 't.dataset.value=v;t.textContent=v;t.onclick=function(){t.remove();sT()};';
    h += 'w.insertBefore(t,i)}';
    h += 'window.onSK=function(e){';
    h += 'if(e.key==="Enter"||e.key===","){e.preventDefault();';
    h += 'var v=e.target.value.trim().replace(/,/g,"");';
    h += 'if(v){aT(v);e.target.value="";sT()}}';
    h += 'else if(e.key==="Backspace"&&!e.target.value){';
    h += 'var ts=w.querySelectorAll(".tag-item");';
    h += 'if(ts.length){ts[ts.length-1].remove();sT()}}};';
    h += 'function sT(){var ts=Array.from(w.querySelectorAll(".tag-item"))';
    h += '.map(function(el){return el.dataset.value});';
    h += 'vscode.postMessage({command:"saveSyncIgnore",value:ts})}';
    h += '})();</script>';
    return h;
}
