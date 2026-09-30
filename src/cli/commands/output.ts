/**
 * CLI result output — JSON envelope vs text rendering.
 * Extracted from index.ts; behavior unchanged.
 */
import { ForjaJsonResult, T } from './types';

export function outputResult<T extends ForjaJsonResult>(result: T, wantsJson: boolean, textFormatter?: (r: T) => string): void {
    // JSON callers must receive a directly reusable JSON continuation command.
    if (wantsJson && result.nextAction && !/\s--json(?:\s|$)/.test(result.nextAction)) {
        result = { ...result, nextAction: `${result.nextAction} --json` };
    }
    // When not in JSON mode, strip --json from nextAction for display
    if (!wantsJson && result.nextAction) {
        result = { ...result, nextAction: result.nextAction.replace(/\s+--json/g, '') };
    }
    if (wantsJson) {
        console.log(JSON.stringify(result, null, 2));
    } else if (textFormatter) {
        try {
            console.log(textFormatter(result));
        } catch (e) {
            // Fallback: show raw diagnostics
            console.error(T('formatError'), e instanceof Error ? e.message : String(e));
            if (result.diagnostics) {
                for (const d of result.diagnostics) {
                    if (d) { console.error(d.message); }
                }
            }
        }
    } else {
        const lines: string[] = [];
        if (!result.ok) {
            lines.push(T('error'));
        }
        if (result.diagnostics) {
            for (const d of result.diagnostics) {
                if (d) { lines.push(`  ${T(d.level)}: ${d.message}`); }
            }
        }
        if (result.nextAction) {
            lines.push('');
            lines.push(T('next'));
            const a = result.nextAction; lines.push(`  ${a}`);
        }
        console.log(lines.length > 0 ? lines.join('\n') : JSON.stringify(result, null, 2));
    }
    if (!result.ok) { process.exitCode = 1; }
}
