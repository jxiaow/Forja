import { TemplateData } from '../template';

function esc(v: string): string {
    return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildSyncPage(data: TemplateData): string {
    // 如果 selectedServer 没匹配到，自动取第一个
    let srv = data.syncServers.find(s => s.id === data.syncSelectedServer);
    if (!srv && data.syncServers.length > 0) {
        srv = data.syncServers[0];
    }
    let h = '<div class="page-title">远程同步</div>';
    h += '<div class="page-desc">将变更文件同步到远程服务器</div>';

    // ── 同步开关 + 状态概览 ──
    h += '<div class="cs"><div class="cst">同步设置</div>';
    h += '<div class="ci"><div class="cii"><div class="cil">启用远程同步</div>';
    h += '<div class="cid">开启后，可手动或自动同步变更文件到远程服务器</div></div>';
    h += '<div class="cic" style="min-width:auto"><label class="toggle-switch">';
    h += `<input type="checkbox" id="syncToggle" ${data.syncEnabled ? 'checked' : ''}`;
    h += " onchange=\"toggleSyncContent(this.checked);vscode.postMessage({command:'saveSyncEnabled',value:this.checked})\"/>";
    h += '<span class="toggle-slider"></span></label></div></div></div>';

    // ── 同步内容区（开关关闭时隐藏） ──
    h += `<div id="syncContent" style="${data.syncEnabled ? '' : 'display:none'}">`;

    // ── 服务器 + 远程路径（整合为一个区块） ──
    h += '<div class="cs"><div class="cst">服务器</div>';
    if (srv) {
        // 服务器信息卡片
        h += '<div class="env-card"><div class="ech">';
        h += '<span class="sd dok"></span>';
        h += `<span class="ect">${esc(srv.name)}</span>`;
        const auth = srv.authMode === 'key' ? 'SSH 密钥' : '密码';
        h += `<span class="ecb bok">${esc(auth)}</span></div>`;
        h += `<div class="ecp">${esc(srv.username)}@${esc(srv.host)}:${srv.port}</div>`;
        const pending = data.syncPendingCount > 0
            ? data.syncPendingCount + ' 个文件待同步' : '已同步';
        const last = data.syncLastTime ? ' · 上次: ' + esc(data.syncLastTime) : '';
        h += `<div class="ecp" style="font-family:var(--vscode-font-family);margin-top:4px">${pending}${last}</div>`;
        // 远程路径（在卡片内，纯展示）
        h += `<div class="ecp" style="margin-top:6px">${esc(data.syncRemotePath || '未设置')}</div>`;
        h += '<div class="eca">';
        h += '<button class="btn btn-sm" onclick="vscode.postMessage({command:\'testSyncConnection\'})">测试连接</button>';
        h += `<button class="btn btn-sm" onclick="showServerForm('edit')">编辑</button>`;
        h += `<button class="btn btn-sm btn-danger" onclick="confirmRemoveServer(this,'${esc(srv.id)}')">删除</button>`;
        h += '</div></div>';
        // 多服务器时显示切换入口
        if (data.syncServers.length > 1) {
            h += '<div class="ci"><div class="cii"><div class="cil">切换服务器</div></div>';
            h += '<div class="cic"><div class="input-row">';
            h += `<div class="csel" id="syncServerSelect" style="flex:1;min-width:0"><div class="csel-trigger" data-value="${esc(srv.id)}">${esc(srv.name)} (${esc(srv.username)}@${esc(srv.host)})</div>`;
            h += '<div class="csel-list">';
            for (const s of data.syncServers) {
                const active = s.id === srv.id ? ' active' : '';
                h += `<div class="csel-item${active}" data-value="${esc(s.id)}">${esc(s.name)} (${esc(s.username)}@${esc(s.host)})</div>`;
            }
            h += '</div></div></div></div></div>';
        }
        // 添加新服务器入口
        h += '<div style="margin-top:8px"><button class="btn btn-sm" onclick="showServerForm(\'add\')">+ 添加新服务器</button></div>';
    } else {
        // 无服务器
        h += '<div class="env-card"><div class="ech">';
        h += '<span class="sd dwn"></span>';
        h += '<span class="ect">未配置服务器</span>';
        h += '<span class="ecb bwn">需要添加</span></div>';
        h += '<div class="ecp" style="font-family:var(--vscode-font-family)">请添加一个远程服务器以启用同步</div>';
        h += '<div class="eca"><button class="btn btn-sm btn-primary" onclick="showServerForm(\'add\')">添加服务器</button></div>';
        h += '</div>';
    }
    h += '</div>';

    // ── 服务器添加/编辑表单（默认隐藏） ──
    h += buildServerForm(data, srv);

    // ── 忽略列表 ──
    h += buildSyncIgnore(data);

    // 关闭 syncContent 容器
    h += '</div>';

    // ── 脚本 ──
    h += buildSyncScript(data, srv);

    return h;
}

function buildServerForm(_data: TemplateData, _srv: TemplateData['syncServers'][0] | undefined): string {
    let h = '<div id="serverFormSection" class="cs" style="display:none">';
    h += '<div class="cst" id="serverFormTitle">添加服务器</div>';
    h += '<div class="server-form">';

    // 名称
    h += '<div class="sf-row"><label class="sf-label">名称</label>';
    h += '<input id="sf-name" class="sf-input" placeholder="例如：开发服务器"/></div>';

    // 主机
    h += '<div class="sf-row"><label class="sf-label">主机地址</label>';
    h += '<input id="sf-host" class="sf-input" placeholder="例如：10.0.0.1 或 dev.example.com"/></div>';

    // 端口
    h += '<div class="sf-row"><label class="sf-label">端口</label>';
    h += '<input id="sf-port" class="sf-input" type="number" value="22" min="1" max="65535"/></div>';

    // 用户名
    h += '<div class="sf-row"><label class="sf-label">用户名</label>';
    h += '<input id="sf-username" class="sf-input" placeholder="SSH 登录用户名"/></div>';

    // 认证方式
    h += '<div class="sf-row"><label class="sf-label">认证方式</label>';
    h += '<div class="btn-group" id="sf-auth-group">';
    h += '<button class="bgi active" onclick="setAuthMode(\'key\')">SSH 密钥</button>';
    h += '<button class="bgi" onclick="setAuthMode(\'password\')">密码</button>';
    h += '</div></div>';

    // 密钥路径（默认显示）
    h += '<div id="sf-key-row" class="sf-row"><label class="sf-label">私钥路径</label>';
    h += '<div class="input-row">';
    h += '<input id="sf-privateKeyPath" class="sf-input" placeholder="~/.ssh/id_rsa"/>';
    h += '<button class="btn btn-sm" onclick="vscode.postMessage({command:\'browse\',targetId:\'sf-privateKeyPath\',isDir:false})">浏览</button>';
    h += '</div></div>';

    // 密码（默认隐藏）
    h += '<div id="sf-pwd-row" class="sf-row" style="display:none"><label class="sf-label">密码</label>';
    h += '<div class="input-row"><input id="sf-password" class="sf-input" type="password" placeholder="SSH 密码" style="flex:1"/>';
    h += '<button class="btn btn-sm" type="button" onclick="var p=document.getElementById(\'sf-password\');';
    h += 'if(p.type===\'password\'){p.type=\'text\';this.textContent=\'隐藏\'}';
    h += 'else{p.type=\'password\';this.textContent=\'显示\'}">显示</button></div></div>';

    // 远程路径
    h += '<div class="sf-row"><label class="sf-label">远程路径 <span style="color:#EF4444;font-size:11px">*必填</span></label>';
    h += '<input id="sf-remotePath" class="sf-input" placeholder="/home/user/project"/></div>';

    // 操作按钮
    h += '<div class="sf-actions">';
    h += '<button class="btn btn-primary" id="sf-submit" onclick="submitServerForm()">添加</button>';
    h += '<button class="btn" onclick="testFormConnection()">测试连接</button>';
    h += '<button class="btn" onclick="hideServerForm()">取消</button>';
    h += '</div>';

    h += '</div></div>';
    return h;
}

function buildSyncIgnore(_data: TemplateData): string {
    let h = '<div class="cs"><div class="cst">忽略列表</div>';
    h += '<div class="ci" style="flex-direction:column;align-items:stretch"><div class="cii"><div class="cil">忽略目录</div>';
    h += '<div class="cid">同步时跳过这些目录</div></div>';
    h += '<div style="margin-top:8px">';
    h += '<div class="tag-input" id="siw">';
    h += '<input id="sii" placeholder="回车添加" onkeydown="onSK(event)"/>';
    h += '</div></div></div></div>';
    return h;
}

function buildSyncScript(data: TemplateData, srv: TemplateData['syncServers'][0] | undefined): string {
    // Serialize server data for edit mode
    const srvJson = srv ? JSON.stringify({
        id: srv.id, name: srv.name, host: srv.host, port: srv.port,
        username: srv.username, authMode: srv.authMode,
        privateKeyPath: srv.privateKeyPath,
        password: srv.password || '',
        remotePath: data.syncRemotePath
    }).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/<\//g, '<\\/') : 'null';

    let h = '<script>(function(){';

    // ── 开关联动内容显隐 ──
    h += 'window.toggleSyncContent=function(enabled){';
    h += 'var el=document.getElementById("syncContent");';
    h += 'if(el){el.style.display=enabled?"":"none"}};';

    // ── 服务器下拉事件 ──
    h += 'var srvSel=document.getElementById("syncServerSelect");';
    h += 'if(srvSel)srvSel.addEventListener("csel-change",function(e){';
    h += 'vscode.postMessage({command:"saveSyncSelectedServer",value:e.detail.value})});';

    // ── 忽略列表 tag input ──
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

    // ── 服务器表单逻辑 ──
    h += 'var _editMode=false;var _editId="";';
    h += `var _currentServer=${srvJson};`;
    h += 'var _authMode="key";';

    h += 'window.showServerForm=function(mode){';
    h += 'var sec=document.getElementById("serverFormSection");';
    h += 'sec.style.display="";';
    h += 'var title=document.getElementById("serverFormTitle");';
    h += 'var submit=document.getElementById("sf-submit");';
    h += 'if(mode==="edit"&&_currentServer){';
    h += '_editMode=true;_editId=_currentServer.id;';
    h += 'title.textContent="编辑服务器";submit.textContent="保存";';
    h += 'document.getElementById("sf-name").value=_currentServer.name||"";';
    h += 'document.getElementById("sf-host").value=_currentServer.host||"";';
    h += 'document.getElementById("sf-port").value=_currentServer.port||22;';
    h += 'document.getElementById("sf-username").value=_currentServer.username||"";';
    h += 'setAuthMode(_currentServer.authMode||"key");';
    h += 'if(_currentServer.privateKeyPath)document.getElementById("sf-privateKeyPath").value=_currentServer.privateKeyPath;';
    h += 'var pwdEl=document.getElementById("sf-password");';
    h += 'if(pwdEl){pwdEl.value=_currentServer.password||""}';
    h += 'var rpEl=document.getElementById("sf-remotePath");';
    h += 'if(rpEl)rpEl.value=_currentServer.remotePath||"";';
    h += '}else{';
    h += '_editMode=false;_editId="";';
    h += 'title.textContent="添加服务器";submit.textContent="添加";';
    h += 'document.getElementById("sf-name").value="";';
    h += 'document.getElementById("sf-host").value="";';
    h += 'document.getElementById("sf-port").value="22";';
    h += 'document.getElementById("sf-username").value="";';
    h += 'document.getElementById("sf-privateKeyPath").value="";';
    h += 'document.getElementById("sf-password").value="";';
    h += 'document.getElementById("sf-remotePath").value="";';
    h += 'setAuthMode("key");';
    h += '}sec.scrollIntoView({behavior:"smooth"})};';

    h += 'window.hideServerForm=function(){';
    h += 'document.getElementById("serverFormSection").style.display="none"};';

    h += 'window.setAuthMode=function(mode){';
    h += '_authMode=mode;';
    h += 'var btns=document.querySelectorAll("#sf-auth-group .bgi");';
    h += 'btns.forEach(function(b){b.classList.remove("active")});';
    h += 'if(mode==="key"){btns[0].classList.add("active");';
    h += 'document.getElementById("sf-key-row").style.display="";';
    h += 'document.getElementById("sf-pwd-row").style.display="none"}';
    h += 'else{btns[1].classList.add("active");';
    h += 'document.getElementById("sf-key-row").style.display="none";';
    h += 'document.getElementById("sf-pwd-row").style.display=""}};';

    h += 'window.submitServerForm=function(){';
    h += 'var s={name:document.getElementById("sf-name").value.trim(),';
    h += 'host:document.getElementById("sf-host").value.trim(),';
    h += 'port:parseInt(document.getElementById("sf-port").value)||22,';
    h += 'username:document.getElementById("sf-username").value.trim(),';
    h += 'authMode:_authMode,';
    h += 'privateKeyPath:document.getElementById("sf-privateKeyPath").value.trim(),';
    h += 'password:document.getElementById("sf-password").value};';
    h += 'var remotePath=document.getElementById("sf-remotePath").value.trim();';
    h += 'var rpInput=document.getElementById("sf-remotePath");';
    h += 'if(!s.name||!s.host||!s.username){';
    h += 'document.getElementById("sf-name").style.borderColor=!s.name?"#EF4444":"";';
    h += 'document.getElementById("sf-host").style.borderColor=!s.host?"#EF4444":"";';
    h += 'document.getElementById("sf-username").style.borderColor=!s.username?"#EF4444":"";';
    h += 'return}';
    h += 'if(!remotePath){rpInput.style.borderColor="#EF4444";rpInput.placeholder="必填：远程目录路径";return}';
    h += 'rpInput.style.borderColor="";';
    h += 'if(_editMode){s.id=_editId;vscode.postMessage({command:"updateServer",server:s,remotePath:remotePath})}';
    h += 'else{vscode.postMessage({command:"addServer",server:s,remotePath:remotePath})}';
    h += 'hideServerForm()};';

    h += 'window.confirmRemoveServer=function(btn,id){';
    h += 'if(btn.dataset.confirmed){vscode.postMessage({command:"removeServer",id:id});return}';
    h += 'btn.dataset.confirmed="1";btn.textContent="确认删除？";';
    h += 'setTimeout(function(){delete btn.dataset.confirmed;btn.textContent="删除"},3000)};';

    h += 'window.testFormConnection=function(){';
    h += 'var s={host:document.getElementById("sf-host").value.trim(),';
    h += 'port:parseInt(document.getElementById("sf-port").value)||22,';
    h += 'username:document.getElementById("sf-username").value.trim(),';
    h += 'authMode:_authMode,';
    h += 'privateKeyPath:document.getElementById("sf-privateKeyPath").value.trim(),';
    h += 'password:document.getElementById("sf-password").value};';
    h += 'if(!s.host||!s.username){alert("请先填写主机地址和用户名");return}';
    h += 'vscode.postMessage({command:"testFormConnection",server:s})};';

    // ── 消息监听 ──
    h += 'window.addEventListener("message",function(e){var d=e.data;';
    h += 'if(d.command==="setPath"){var el=document.getElementById(d.targetId);';
    h += 'if(el){el.value=d.value}}';
    h += 'else if(d.command==="serversUpdated"){';
    // 服务器列表更新后刷新自定义下拉
    h += 'var sel=document.getElementById("syncServerSelect");';
    h += 'if(sel&&d.servers){';
    h += 'var list=sel.querySelector(".csel-list");';
    h += 'var trigger=sel.querySelector(".csel-trigger");';
    h += 'if(list&&trigger){list.innerHTML="";';
    h += 'if(d.servers.length===0){';
    h += 'list.innerHTML=\'<div class="csel-item" data-value="">— 无服务器 —</div>\';';
    h += 'trigger.textContent="— 无服务器 —";trigger.dataset.value=""}';
    h += 'else{d.servers.forEach(function(s){var item=document.createElement("div");';
    h += 'item.className="csel-item";item.dataset.value=s.id;';
    h += 'item.textContent=s.name+" ("+s.username+"@"+s.host+")";list.appendChild(item)})};';
    h += 'if(d.select){trigger.dataset.value=d.select;';
    h += 'var active=list.querySelector("[data-value=\\""+d.select+"\\"]");';
    h += 'if(active){trigger.textContent=active.textContent;active.classList.add("active")}';
    h += 'vscode.postMessage({command:"saveSyncSelectedServer",value:d.select})}';
    h += '}}';  // close if(list&&trigger) and if(sel&&d.servers)
    h += '}});';

    h += '})();</script>';
    return h;
}
