import * as os from 'os';
import { Platform } from '../types';

export function getCurrentPlatform(): Platform {
  return os.platform() === 'win32' ? 'windows' : 'linux';
}

export const isWindows = getCurrentPlatform() === 'windows';
export const isLinux = getCurrentPlatform() === 'linux';
