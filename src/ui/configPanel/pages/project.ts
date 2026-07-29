import { TemplateData } from '../template';
import { getEffectiveProjectName } from '../../../qt/project/projectDisplay';

function esc(v: string): string {
    return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function sel(cur: string, val: string): string {
    return cur === val ? 'selected' : '';
}

export function buildProjectPage(data: TemplateData): string {
    const pn = getEffectiveProjectName(
        data.project, data.target, data.pinnedProject || '未选择');
    const et = data.target || data.project?.target || '';
    let h = '<div class="page-title">项目配置</div>';
    h += '<div class="page-desc">管理构建参数和 IntelliSense 设置</div>';
    // 当前项目
    h += '<div class="cs"><div class="cst">当前项目</div>';
    h += '<div class="ci"><div class="cii"><div class="cil">活动项目</div>';
    h += '<div class="cid">选择要构建的 .pro 项目</div></div>';
    h += '<div class="cic"><div class="input-row">';
    h += `<input value="${esc(pn)}" readonly style="opacity:.8"/>`;
    h += '<button class="btn btn-sm" onclick="vscode.postMessage(';
    h += "{command:'selectProject'})\">切换</button></div></div></div></div>";
    // 构建参数
    h += '<div class="cs"><div class="cst">构建参数</div>';
    h += '<div class="ci"><div class="cii"><div class="cil">构建模式</div>';
    h += '<div class="cid">Debug 含调试符号，Release 启用优化</div></div>';
    h += '<div class="cic"><div class="btn-group" id="mG">';
    h += "<button class=\"bgi active\" onclick=\"setM('debug')\">debug</button>";
    h += "<button class=\"bgi\" onclick=\"setM('release')\">release</button>";
    h += '</div></div></div>';
    h += '<div class="ci"><div class="cii"><div class="cil">目标架构</div></div>';
    h += '<div class="cic"><div class="btn-group" id="aG">';
    h += "<button class=\"bgi active\" onclick=\"setA('x86')\">x86</button>";
    h += "<button class=\"bgi\" onclick=\"setA('x64')\">x64</button>";
    h += '</div></div></div>';
    h += '<div class="ci"><div class="cii"><div class="cil">QMake TARGET</div>';
    h += '<div class="cid">覆盖 .pro 中的 TARGET</div></div>';
    h += `<div class="cic"><input id="target" value="${esc(et)}"`;
    h += ' placeholder="留空使用默认"';
    h += " onblur=\"vscode.postMessage({command:'saveQmakeTarget',";
    h += "value:this.value.trim()})\"/></div></div></div>";
    // 语言标准
    h += '<div class="cs"><div class="cst">语言标准</div>';
    h += '<div class="ci"><div class="cii"><div class="cil">C 标准</div></div>';
    h += '<div class="cic"><select id="cStd" onchange="savS()">';
    h += `<option value="c89" ${sel(data.cStandard, 'c89')}>C89</option>`;
    h += `<option value="c99" ${sel(data.cStandard, 'c99')}>C99</option>`;
    h += `<option value="c11" ${sel(data.cStandard, 'c11')}>C11</option>`;
    h += `<option value="c17" ${sel(data.cStandard, 'c17')}>C17</option>`;
    h += '</select></div></div>';
    return h + buildProjectPagePart2(data);
}

function buildProjectPagePart2(data: TemplateData): string {
    let h = '<div class="ci"><div class="cii"><div class="cil">C++ 标准</div></div>';
    h += '<div class="cic"><select id="cppStd" onchange="savS()">';
    h += `<option value="c++11" ${sel(data.cppStandard, 'c++11')}>C++11</option>`;
    h += `<option value="c++14" ${sel(data.cppStandard, 'c++14')}>C++14</option>`;
    h += `<option value="c++17" ${sel(data.cppStandard, 'c++17')}>C++17</option>`;
    h += `<option value="c++20" ${sel(data.cppStandard, 'c++20')}>C++20</option>`;
    h += `<option value="c++23" ${sel(data.cppStandard, 'c++23')}>C++23</option>`;
    h += '</select></div></div>';
    h += '<div style="margin-top:12px"><button class="btn btn-primary"';
    h += " onclick=\"vscode.postMessage({command:'generateIntelliSense',";
    h += "cStandard:document.getElementById('cStd').value,";
    h += "cppStandard:document.getElementById('cppStd').value})\">";
    h += '生成 IntelliSense 配置</button></div></div>';
    h += '<script>';
    h += 'function savS(){vscode.postMessage({command:"saveStandard",';
    h += 'cStandard:document.getElementById("cStd").value,';
    h += 'cppStandard:document.getElementById("cppStd").value})}';
    h += 'function setM(m){document.querySelectorAll("#mG .bgi")';
    h += '.forEach(b=>b.classList.remove("active"));';
    h += 'event.currentTarget.classList.add("active");';
    h += 'vscode.postMessage({command:"saveMode",value:m})}';
    h += 'function setA(a){document.querySelectorAll("#aG .bgi")';
    h += '.forEach(b=>b.classList.remove("active"));';
    h += 'event.currentTarget.classList.add("active");';
    h += 'vscode.postMessage({command:"saveArch",value:a})}';
    h += '</script>';
    return h;
}
