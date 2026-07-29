import * as vscode from 'vscode';
import { extractRemoteProblemLines, mapRemoteProblemPath, RemoteProblemSource } from './problemMatcher';

export function publishRemoteProblems(
    collection: vscode.DiagnosticCollection,
    workspace: string,
    remotePath: string,
    result: RemoteProblemSource
): number {
    const problems = extractRemoteProblemLines(result);
    const byFile = new Map<string, vscode.Diagnostic[]>();

    for (const problem of problems) {
        const localPath = mapRemoteProblemPath(workspace, remotePath, problem.file);
        if (!localPath) { continue; }
        const range = diagnosticRange(problem.line, problem.column);
        const severity = problem.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
        const diagnostic = new vscode.Diagnostic(range, problem.message, severity);
        diagnostic.source = 'forja remote';
        const current = byFile.get(localPath) || [];
        current.push(diagnostic);
        byFile.set(localPath, current);
    }

    collection.clear();
    for (const [filePath, diagnostics] of byFile.entries()) {
        collection.set(vscode.Uri.file(filePath), diagnostics);
    }
    return Array.from(byFile.values()).reduce((total, diagnostics) => total + diagnostics.length, 0);
}

function diagnosticRange(line: number, column: number): vscode.Range {
    const zeroLine = Math.max(0, line - 1);
    const zeroColumn = Math.max(0, column - 1);
    return new vscode.Range(zeroLine, zeroColumn, zeroLine, zeroColumn + 1);
}
