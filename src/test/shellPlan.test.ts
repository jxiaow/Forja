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

    // target 已改为构建后重命名，不再注入 qmake 命令
    const lastCmd = plan.commands.at(-1) || '';
    assert.match(lastCmd, /DEFINES\+=FEATURE_X CONFIG\+=qml_debug$/);
    assert.ok(!lastCmd.includes('TARGET='), 'qmake command should not contain TARGET=');
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
