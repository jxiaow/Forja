/**
 * RCC 重编 manifest — 记录 qrc 与其引用资源的 size/mtime/sha256，
 * 供 rcc 重编判定使用：mtime/size 快路径 + 内容哈希兜底，避免时间戳变化但内容未变时的误重编。
 * 存储位置 <configDir>/rcc-manifests/<workroot-hash>.json（用户数据目录，不写入用户源码树）。
 * 不依赖 vscode（CLI 与扩展共享）。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { atomicWriteFileSync } from '../../core/atomicWrite';
import { forjaConfigDir } from '../../core/settingsIO';
import { normalizePath, workrootKeyHash } from '../../core/workspaceStore';
import { warn } from '../../core/loggerBase';

export const RCC_MANIFEST_VERSION = 1;

export interface RccFileRecord {
    /** 相对 workroot 的归一化路径（win32 小写、正斜杠） */
    relPath: string;
    size: number;
    mtimeMs: number;
    /** 文件内容的 sha256 hex */
    hash: string;
}

export interface RccTargetRecord {
    qrc: RccFileRecord;
    files: RccFileRecord[];
}

export interface RccManifest {
    version: number;
    /** key = 相对 workroot 的 target 目录 + name（见 rccTargetKey） */
    targets: Record<string, RccTargetRecord>;
}

/** 结构上兼容 rccResolver.RccTarget 的最小形状（类型引用不产生运行时依赖） */
export interface RccTargetLike {
    name: string;
    dir: string;
}

export function rccManifestPath(workroot: string, configDir?: string): string {
    return path.join(configDir || forjaConfigDir(), 'rcc-manifests', `${workrootKeyHash(workroot)}.json`);
}

/** 解析 qrc 内 <file> 引用列表（与 rccResolver 判定共用口径） */
export function parseQrcFileRefs(qrcContent: string): string[] {
    const refs: string[] = [];
    for (const match of qrcContent.matchAll(/<file[^>]*>([^<]+)<\/file>/g)) {
        refs.push(match[1]);
    }
    return refs;
}

/** manifest key：相对 workroot 的 target 目录 + name；target 不在 workroot 下时退回绝对路径 */
export function rccTargetKey(workroot: string, target: RccTargetLike): string {
    const rel = path.relative(workroot, target.dir);
    const base = (!rel || rel.startsWith('..') || path.isAbsolute(rel)) ? target.dir : rel;
    return normalizePath(`${base}/${target.name}`);
}

function relFromWorkroot(workroot: string, filePath: string): string {
    return normalizePath(path.relative(workroot, filePath));
}

export function sha256File(filePath: string): string | null {
    try {
        return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    } catch { /* 不可读文件无哈希，由调用方分流 */ return null; }
}

function buildFileRecord(workroot: string, filePath: string): RccFileRecord | null {
    let st: fs.Stats;
    try { st = fs.statSync(filePath); } catch { return null; }
    const hash = sha256File(filePath);
    if (hash === null) { return null; }
    return { relPath: relFromWorkroot(workroot, filePath), size: st.size, mtimeMs: st.mtimeMs, hash };
}

/** 为一个 target 生成完整记录（qrc + 全部存在的引用资源）；引用缺失的文件不入账 */
export function buildRccTargetRecord(workroot: string, target: RccTargetLike): RccTargetRecord | null {
    const qrcPath = path.join(target.dir, `${target.name}.qrc`);
    const qrc = buildFileRecord(workroot, qrcPath);
    if (!qrc) { return null; }
    const files: RccFileRecord[] = [];
    try {
        const refs = parseQrcFileRefs(fs.readFileSync(qrcPath, 'utf-8'));
        for (const ref of refs) {
            const rec = buildFileRecord(workroot, path.join(target.dir, ref));
            if (rec) { files.push(rec); }
        }
    } catch (e) {
        warn(`[rccManifest] failed to read qrc "${qrcPath}": ${e instanceof Error ? e.message : e}`);
    }
    return { qrc, files };
}

function isFileRecord(v: unknown): v is RccFileRecord {
    if (!v || typeof v !== 'object') { return false; }
    const r = v as RccFileRecord;
    return typeof r.relPath === 'string' && typeof r.size === 'number'
        && typeof r.mtimeMs === 'number' && typeof r.hash === 'string';
}

function isTargetRecord(v: unknown): v is RccTargetRecord {
    if (!v || typeof v !== 'object') { return false; }
    const r = v as RccTargetRecord;
    return isFileRecord(r.qrc) && Array.isArray(r.files) && r.files.every(isFileRecord);
}

/** 读取 manifest；文件缺失 / JSON 损坏 / 结构不认识 → null（视同缺失，不抛） */
export function loadRccManifest(workroot: string, configDir?: string): RccManifest | null {
    const filePath = rccManifestPath(workroot, configDir);
    let raw: string;
    try { raw = fs.readFileSync(filePath, 'utf8'); } catch { return null; }
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { return null; }
        const m = parsed as RccManifest;
        if (m.version !== RCC_MANIFEST_VERSION || !m.targets || typeof m.targets !== 'object' || Array.isArray(m.targets)) {
            return null;
        }
        const targets: Record<string, RccTargetRecord> = {};
        for (const [key, value] of Object.entries(m.targets)) {
            if (isTargetRecord(value)) { targets[key] = value; }
        }
        return { version: m.version, targets };
    } catch { /* 损坏 JSON 视同缺失 */ return null; }
}

export function saveRccManifest(workroot: string, manifest: RccManifest, configDir?: string): void {
    const filePath = rccManifestPath(workroot, configDir);
    try {
        atomicWriteFileSync(filePath, JSON.stringify(manifest, null, 2));
    } catch (e) {
        warn(`[rccManifest] failed to write manifest "${filePath}": ${e instanceof Error ? e.message : e}`);
    }
}

/** rcc 编译成功后重写该 workroot 下全部目标条目（合并保留其他 key） */
export function writeRccManifest(workroot: string, targets: RccTargetLike[], configDir?: string): void {
    const manifest = loadRccManifest(workroot, configDir) ?? { version: RCC_MANIFEST_VERSION, targets: {} };
    for (const target of targets) {
        const rec = buildRccTargetRecord(workroot, target);
        if (rec) { manifest.targets[rccTargetKey(workroot, target)] = rec; }
    }
    saveRccManifest(workroot, manifest, configDir);
}

export interface RccManifestCheckResult {
    needsRebuild: boolean;
    /** 内容未变但时间戳/大小变了，已在 entry 上就地刷新 → 调用方需持久化 */
    refreshed: boolean;
}

/**
 * 对一个 manifest 条目做单 target 判定（只读 + stat/哈希；免编分支内允许刷新 entry）：
 * - 快路径：qrc 与全部引用资源 size+mtimeMs 一致、且 <file> 列表条数一致 → 免编
 * - 慢路径：仅对不一致/新增文件算 hash；全部相同（只有时间戳动）→ 刷新 entry 记录，免编
 * - 内容有差异、qrc 新增/删除条目、引用文件缺失 → 需重编
 */
export function checkTargetAgainstManifest(workroot: string, target: RccTargetLike, entry: RccTargetRecord): RccManifestCheckResult {
    const rebuild: RccManifestCheckResult = { needsRebuild: true, refreshed: false };
    const qrcPath = path.join(target.dir, `${target.name}.qrc`);
    let qrcStat: fs.Stats;
    try { qrcStat = fs.statSync(qrcPath); } catch { return rebuild; }
    let refs: string[];
    try { refs = parseQrcFileRefs(fs.readFileSync(qrcPath, 'utf-8')); } catch { return rebuild; }

    // 快路径
    if (refs.length === entry.files.length
        && entry.qrc.size === qrcStat.size && entry.qrc.mtimeMs === qrcStat.mtimeMs
        && entry.files.every(rec => {
            try {
                const st = fs.statSync(path.join(workroot, rec.relPath));
                return st.size === rec.size && st.mtimeMs === rec.mtimeMs;
            } catch { return false; }
        })) {
        return { needsRebuild: false, refreshed: false };
    }

    // 慢路径
    if (refs.length !== entry.files.length) { return rebuild; } // qrc 引用新增/删除
    const recByRel = new Map(entry.files.map(rec => [rec.relPath, rec]));
    let refreshed = false;

    if (entry.qrc.size !== qrcStat.size || entry.qrc.mtimeMs !== qrcStat.mtimeMs) {
        const hash = sha256File(qrcPath);
        if (hash === null || hash !== entry.qrc.hash) { return rebuild; }
        entry.qrc.size = qrcStat.size;
        entry.qrc.mtimeMs = qrcStat.mtimeMs;
        refreshed = true;
    }
    for (const ref of refs) {
        const filePath = path.join(target.dir, ref);
        const rec = recByRel.get(relFromWorkroot(workroot, filePath));
        if (!rec) { return rebuild; } // 引用改名/替换
        let st: fs.Stats;
        try { st = fs.statSync(filePath); } catch { return rebuild; } // 引用文件缺失
        if (st.size === rec.size && st.mtimeMs === rec.mtimeMs) { continue; }
        const hash = sha256File(filePath);
        if (hash === null || hash !== rec.hash) { return rebuild; }
        rec.size = st.size;
        rec.mtimeMs = st.mtimeMs;
        refreshed = true;
    }
    return { needsRebuild: false, refreshed };
}
