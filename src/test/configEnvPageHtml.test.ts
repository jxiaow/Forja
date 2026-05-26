import test from 'node:test';
import assert from 'node:assert/strict';
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
