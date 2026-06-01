import test from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'os';
import * as path from 'path';
import { compilotHomeDir } from '../core/compilotHome';

test('compilotHomeDir uses COMPILOT_HOME when provided', () => {
    const oldHome = process.env.COMPILOT_HOME;
    const override = path.join(os.tmpdir(), 'compilot-home-override');
    process.env.COMPILOT_HOME = override;
    try {
        assert.equal(compilotHomeDir(), override);
    } finally {
        if (oldHome === undefined) { delete process.env.COMPILOT_HOME; }
        else { process.env.COMPILOT_HOME = oldHome; }
    }
});

test('compilotHomeDir defaults to user .compilot directory', () => {
    const oldHome = process.env.COMPILOT_HOME;
    delete process.env.COMPILOT_HOME;
    try {
        assert.equal(compilotHomeDir(), path.join(os.homedir(), '.compilot'));
    } finally {
        if (oldHome === undefined) { delete process.env.COMPILOT_HOME; }
        else { process.env.COMPILOT_HOME = oldHome; }
    }
});
