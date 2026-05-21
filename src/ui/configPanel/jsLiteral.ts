export function jsLiteral(value: unknown): string {
    return JSON.stringify(value).replace(/<\//gi, '<\\/');
}
