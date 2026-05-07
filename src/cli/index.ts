#!/usr/bin/env node
import { parseCliArgs } from './args';
import { CliResult } from './types';
import { createActionPlan } from '../coreCli/qtCore';
import { runCliResult } from '../coreCli/commandRunner';

function textOutput(result: CliResult): string {
    const status = result.ok ? '成功' : '失败';
    const lines = [
        `Qt Pilot ${result.action} ${status}`,
        `模式: ${result.mode}`,
        `工作区: ${result.workspace}`
    ];
    if (result.project) {
        lines.push(`项目: ${result.project}`);
    }
    if (result.commands.length > 0) {
        lines.push('命令:');
        for (const cmd of result.commands) {
            lines.push(`  ${cmd}`);
        }
    }
    if (result.resolved) {
        lines.push(`构建配置: ${result.resolved.mode} / ${result.resolved.arch}`);
        if (result.resolved.qtPath) {
            lines.push(`Qt: ${result.resolved.qtPath}`);
        }
        if (result.resolved.vsDevShell) {
            lines.push(`VS Dev Shell: ${result.resolved.vsDevShell}`);
        }
    }
    if (result.candidates.length > 0) {
        lines.push('候选项目:');
        for (const candidate of result.candidates) {
            lines.push(`  ${candidate}`);
        }
    }
    for (const diagnostic of result.diagnostics) {
        lines.push(`${diagnostic.level}: ${diagnostic.message}`);
        if (diagnostic.hint) {
            lines.push(`hint: ${diagnostic.hint}`);
        }
    }
    if (result.nextActions.length > 0) {
        lines.push('下一步:');
        for (const action of result.nextActions) {
            lines.push(`  ${action}`);
        }
    }
    return lines.join('\n');
}

async function main(argv: string[]): Promise<void> {
    let wantsJson = argv.includes('--json');
    try {
        const options = parseCliArgs(argv);
        wantsJson = options.json;
        const planned = await createActionPlan(options);
        const result = await runCliResult(planned);
        if (wantsJson) {
            console.log(JSON.stringify(result, null, 2));
        } else {
            console.log(textOutput(result));
        }
        process.exitCode = result.ok ? 0 : 1;
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (wantsJson) {
            console.log(JSON.stringify({
                ok: false,
                diagnostics: [{ level: 'error', message }]
            }, null, 2));
        } else {
            console.error(message);
        }
        process.exitCode = 1;
    }
}

void main(process.argv.slice(2));
