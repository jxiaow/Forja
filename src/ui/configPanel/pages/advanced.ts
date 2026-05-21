import { TemplateData } from '../template';

export function buildAdvancedPage(data: TemplateData): string {
    let h = '<div class="page-title">高级配置</div>';
    h += '<div class="page-desc">低频配置项</div>';

    if (!data.qtActive) {
        h += '<div class="section-inactive">';
        h += '<div class="section-inactive-hint">未检测到 Qt 项目，高级配置不可用</div>';
        h += '</div>';
        return h;
    }

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
    return h;
}
