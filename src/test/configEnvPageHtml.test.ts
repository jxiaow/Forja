import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { getPageHtml } from '../ui/configPanel/pageTemplate';
import type { TemplateData } from '../ui/configPanel/template';

function createTemplateData(): TemplateData {
    return {
        env: {
            vs: {
                version: '2022',
                edition: 'Community',
                installPath: 'C:/VS/2022/Community',
                devShellPath: 'C:/VS/2022/Community/Common7/Tools/Launch-VsDevShell.ps1'
            },
            qt: { version: '5.12.0', path: 'C:/Qt/5.12/msvc2019', compiler: 'msvc2019' },
            jom: 'C:/Qt/Tools/jom/jom.exe',
            vsCandidates: [
                {
                    version: '2019',
                    edition: 'Community',
                    installPath: 'C:/VS/2019/Community',
                    devShellPath: 'C:/VS/2019/Community/Common7/Tools/Launch-VsDevShell.ps1'
                },
                {
                    version: '2022',
                    edition: 'Community',
                    installPath: 'C:/VS/2022/Community',
                    devShellPath: 'C:/VS/2022/Community/Common7/Tools/Launch-VsDevShell.ps1'
                }
            ],
            qtCandidates: [
                { version: '5.12.0', path: 'C:/Qt/5.12/msvc2019', compiler: 'msvc2019' },
                { version: '5.15.2', path: 'C:/Qt/5.15.2/msvc2019', compiler: 'msvc2019' }
            ]
        },
        project: null,
        vsDevShellPath: '',
        pinnedProject: '',
        mode: 'debug',
        arch: 'x86',
        cStandard: 'c11',
        cppStandard: 'c++17',
        scanExcludeDirs: '',
        target: '',
        runtimeProcessName: '',
        isWin: true,
        autoDevShell: '',
        autoQtPath: 'C:/Qt/5.12/msvc2019',
        qtPath: '',
        designerPath: '',
        qtSourcePath: '',
        manualProPath: '',
        fileSyncPromptEnabled: true,
        qmakeReminderEnabled: true,
        rccProjectPath: '',
        version: 'test',
        syncEnabled: false,
        syncSelectedServer: '',
        syncServers: [],
        syncIgnore: '.git',
        syncRemotePath: '',
        syncPendingCount: 0,
        syncLastTime: '',
        sdkProjectName: '',
        sdkMode: 'debug',
        sdkArch: 'x86',
        sdkVsInstall: '',
        qtActive: true,
        sdkActive: false
    };
}

test('environment page updates Qt title immediately after selecting a candidate version', () => {
    const html = getPageHtml('env', createTemplateData());

    assert.match(html, /qtCandidateLabels/);
    assert.match(html, /function updateQtDisplayFromPath\(path/);
    assert.match(html, /qtT\.textContent=label/);
    assert.match(html, /updateQtDisplayFromPath\(e\.detail\.value/);
    assert.match(html, /d\.command==="qtPathUpdated"/);
});

test('environment page updates Visual Studio and SDK titles from detected candidates', () => {
    const data = createTemplateData();
    data.sdkActive = true;
    const html = getPageHtml('env', data);

    assert.match(html, /vsCandidateLabels/);
    assert.match(html, /function updateVsDisplayFromPath\(path/);
    assert.match(html, /vsT\.textContent=label/);
    assert.match(html, /function updateSdkVsDisplayFromPath\(path/);
    assert.match(html, /sdkVsT\.textContent=label/);
    assert.match(html, /id="sdkVsSelect"/);
    assert.match(html, /saveSdkVsInstall/);
});

test('environment page keeps selected toolchain titles after env refresh', () => {
    const data = createTemplateData();
    data.sdkActive = true;
    const html = getPageHtml('env', data);

    assert.match(html, /function currentValue\(id\)/);
    assert.match(html, /updateVsDisplayFromPath\(currentValue\("vsDevShellPath"\),d\.env\.vs/);
    assert.match(html, /updateSdkVsDisplayFromPath\(currentValue\("sdkVsInstall"\),d\.env\.vs/);
    assert.match(html, /updateQtDisplayFromPath\(currentValue\("qtPath"\),d\.env\.qt/);
    assert.match(html, /label=vsCandidateLabels\[path\]\|\|label/);
    assert.match(html, /label=qtCandidateLabels\[path\]\|\|label/);
    assert.doesNotMatch(html, /vsT\)\{vsT\.textContent=d\.env\.vs/);
    assert.doesNotMatch(html, /sdkVsT\)\{sdkVsT\.textContent=d\.env\.vs/);
    assert.doesNotMatch(html, /qtT\)\{qtT\.textContent=d\.env\.qt/);
});

test('environment page shows toolchain selectors when one candidate is available', () => {
    const data = createTemplateData();
    data.sdkActive = true;
    data.env!.vsCandidates = [data.env!.vsCandidates[0]];
    data.env!.qtCandidates = [data.env!.qtCandidates[0]];
    const html = getPageHtml('env', data);

    assert.match(html, /id="vsSelect"/);
    assert.match(html, /id="sdkVsSelect"/);
    assert.match(html, /id="qtSelect"/);
    assert.doesNotMatch(html, /candidates\.length <= 1/);
});

test('environment page is rerendered after async environment detection', () => {
    const managerSource = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'configPanel', 'configPagePanel.ts'), 'utf8');
    const messageSource = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'configPanel', 'messageHandler.ts'), 'utf8');

    assert.match(managerSource, /setState\('envInfo', env\);\s*this\._updatePageHtml\(pageId\);/);
    assert.match(messageSource, /case 'refreshEnv':[\s\S]*setState\('envInfo', env\);[\s\S]*updateHtml\(\);/);
    assert.match(messageSource, /case 'saveVsPath':[\s\S]*setState\('envInfo', env\);[\s\S]*updateHtml\(\);/);
    assert.match(messageSource, /case 'saveQtPath':[\s\S]*setState\('envInfo', env2\);[\s\S]*updateHtml\(\);/);
});
