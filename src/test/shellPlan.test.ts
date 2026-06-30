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
    qmakeArgs: '',
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

test('shell plan builder appends custom qmake arguments', () => {
    const builder = createShellPlanBuilder(winConfig);
    const plan = builder.qmakeCommands({
        ...cfg,
        target: 'DemoApp',
        qmakeArgs: 'DEFINES+=FEATURE_X CONFIG+=qml_debug'
    });

    assert.match(
        plan.commands.at(-1) || '',
        /"TARGET=DemoApp" DEFINES\+=FEATURE_X CONFIG\+=qml_debug$/
    );
});

test('linux shell plan exposes Qt lib path for Qt helper binaries', () => {
    const builder = createShellPlanBuilder(linuxConfig);
    const plan = builder.qmakeCommands({
        ...cfg,
        qtPath: '/usr/local/qt5.13.2',
        projectDir: '/workspace/qt',
        proFile: 'qt_linux_pc_client.pro'
    });

    assert.deepEqual(plan.commands.slice(0, 2), [
        'export PATH="/usr/local/qt5.13.2/bin:$PATH"',
        'export LD_LIBRARY_PATH="/usr/local/qt5.13.2/lib:$HOME/.forja/compat/icu55/lib:$LD_LIBRARY_PATH"'
    ]);
});

test('shell plan builder exposes shell execution metadata', () => {
    const builder = createShellPlanBuilder(winConfig);
    const exec = builder.makeCommandLine(['one', 'two']);

    assert.equal(exec.commandLine, 'one && two');
    assert.equal(exec.shellExecutable, 'cmd.exe');
    assert.deepEqual(exec.shellArgs, ['/c']);
});

test('pre-run kill command is non-fatal and supports path-based matching', () => {
    const winKill = winConfig.killCommand('demo');
    const linuxKill = linuxConfig.killCommand('demo');
    const linuxKillWithPath = linuxConfig.killCommand('demo', '/usr/local/bin/demo');

    assert.match(winKill, /^\(taskkill \/F \/IM demo\.exe/);
    assert.match(winKill, /2>nul/);
    assert.match(winKill, /\|\| ver>nul\)$/);
    assert.doesNotMatch(winKill, /powershell/);
    assert.doesNotMatch(winKill, /projectDir/);
    assert.deepEqual(winConfig.stopCommands('demo'), [winKill]);

    // Without exePath: name-based, non-fatal
    assert.match(linuxKill, /pkill -x "demo"/);
    assert.doesNotMatch(linuxKill, /exit 1/, 'kill must not block the build');
    assert.match(linuxKill, /; true$/, 'kill must always succeed (fire-and-forget)');

    // With exePath: path-based matching via /proc/*/exe
    assert.match(linuxKillWithPath, /pgrep -x "demo"/);
    assert.match(linuxKillWithPath, /readlink \/proc\/\$_p\/exe/);
    assert.match(linuxKillWithPath, /\/usr\/local\/bin\/demo/);
    assert.doesNotMatch(linuxKillWithPath, /pkill/, 'path-based kill must not use pkill');
    assert.match(linuxKillWithPath, /; true$/, 'path-based kill must also be non-fatal');
});
