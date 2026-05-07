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
    for (const diagnostic of result.diagnostics) {
        lines.push(`${diagnostic.level}: ${diagnostic.message}`);
        if (diagnostic.hint) {
            lines.push(`hint: ${diagnostic.hint}`);
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
