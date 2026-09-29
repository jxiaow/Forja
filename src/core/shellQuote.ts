/**
 * POSIX shell 引用工具。
 * 单引号包裹并转义内部单引号，禁止命令替换与变量展开，
 * 适用于本地 sh 与远端 ssh 命令拼接。
 */
export function posixQuote(value: string): string {
    return `'${value.replace(/'/g, "'\\''")}'`;
}
