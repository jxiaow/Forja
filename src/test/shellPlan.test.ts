import test from 'node:test';
import assert from 'node:assert/strict';
import { createShellPlanBuilder, BuildConfig } from '../qt/platform/shellPlan';
import { winConfig } from '../qt/platform/win/builder';
import { linuxConfig } from '../qt/platform/linux/builder';

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
        'set "PATH=D:\\Qt\\5.15.2\\msvc2019\\bin;%PATH%"',
        'call "C:/VS/Common7/Tools/VsDevCmd.bat" -arch=x86 -no_logo',
        'cd /d "D:/demo"',
        '"D:/Qt/5.15.2/msvc2019/bin/qmake.exe" demo.pro -spec win32-msvc CONFIG+=debug CONFIG+=console CONFIG+=x86'
    ]);
});

test('shell plan builder exposes shell execution metadata', () => {
    const builder = createShellPlanBuilder(winConfig);
    const exec = builder.makeCommandLine(['one', 'two']);

    assert.equal(exec.commandLine, 'one && two');
    assert.equal(exec.shellExecutable, 'cmd.exe');
    assert.deepEqual(exec.shellArgs, ['/c']);
});

test('pre-run kill command fails when the target process is still alive', () => {
    const winKill = winConfig.killCommand('demo');
    const linuxKill = linuxConfig.killCommand('demo');

    assert.match(winKill, /taskkill \/F \/IM "demo\.exe"/);
    assert.match(winKill, /tasklist \/FI "IMAGENAME eq demo\.exe"/);
    assert.match(winKill, /exit \/b 1/);
    assert.doesNotMatch(winKill, /\|\| ver >nul\)$/);

    assert.match(linuxKill, /pkill -x "demo"/);
    assert.match(linuxKill, /pgrep -x "demo"/);
    assert.match(linuxKill, /exit 1/);
    assert.doesNotMatch(linuxKill, /; true$/);
});
