import test from 'node:test';
import assert from 'node:assert/strict';
import { createShellPlanBuilder, BuildConfig } from '../qt/platform/shellPlan';
import { winConfig } from '../qt/platform/win/builder';

const cfg: BuildConfig = {
    vsDevShell: 'C:/VS/Common7/Tools/Launch-VsDevShell.ps1',
    qtPath: 'D:/Qt/5.15.2/msvc2019',
    projectDir: 'D:/demo',
    proFile: 'demo.pro',
    arch: 'x86',
    mode: 'debug',
    target: '',
    jomPath: ''
};

test('shell plan builder creates qmake command without vscode dependency', () => {
    const builder = createShellPlanBuilder(winConfig);
    const plan = builder.qmakeCommands(cfg);

    assert.equal(plan.matcher, '$msCompile');
    assert.deepEqual(plan.commands, [
        'call "C:/VS/Common7/Tools/VsDevCmd.bat" -arch=x86 -no_logo',
        'set "PATH=D:\\Qt\\5.15.2\\msvc2019\\bin;%PATH%"',
        'cd /d "D:/demo"',
        'qmake demo.pro -spec win32-msvc CONFIG+=debug CONFIG+=console CONFIG+=x86'
    ]);
});

test('shell plan builder exposes shell execution metadata', () => {
    const builder = createShellPlanBuilder(winConfig);
    const exec = builder.makeCommandLine(['one', 'two']);

    assert.equal(exec.commandLine, 'one && two');
    assert.equal(exec.shellExecutable, 'cmd.exe');
    assert.deepEqual(exec.shellArgs, ['/c']);
});
