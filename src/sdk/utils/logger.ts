/**
 * SDK 模块日志 — 委托给 core/logger。
 * 保持与已有调用方的 API 兼容（initLogger、log、logError、getOutputChannel）。
 */
import type * as vscode from 'vscode';
import { initLogger as _coreInit, createLogger } from '../../core/logger';

const sdkLogger = createLogger('SDK');

/**
 * 初始化日志通道。返回共享的 OutputChannel（由 core/logger 管理）。
 * SDK 模块调用此函数以确保 channel 已创建。
 */
export function initLogger(): vscode.OutputChannel {
    const channel = _coreInit();
    // core/logger 在 CLI 环境下可能返回 null，此处为类型兼容做 fallback
    return channel as unknown as vscode.OutputChannel;
}

export function log(message: string): void {
    sdkLogger.info(message);
}

export function logError(message: string, error?: unknown): void {
    const errStr = error instanceof Error ? error.message : String(error ?? '');
    sdkLogger.error(`${message}${errStr ? ' - ' + errStr : ''}`);
}

export function getOutputChannel(): vscode.OutputChannel | undefined {
    const channel = _coreInit();
    return channel ?? undefined;
}
