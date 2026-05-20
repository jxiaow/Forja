import { Arch, BuildMode } from '../core/qtState';

export function getModeDisplayLabel(mode: BuildMode, arch: Arch, isWin: boolean): string {
    const modeLabel = mode === 'debug' ? 'Debug' : 'Release';
    if (!isWin) {
        return modeLabel;
    }
    return `${modeLabel} ${arch}`;
}
