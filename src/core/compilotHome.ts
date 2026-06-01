import * as os from 'os';
import * as path from 'path';

export function compilotHomeDir(): string {
    return process.env.COMPILOT_HOME || path.join(os.homedir(), '.compilot');
}
