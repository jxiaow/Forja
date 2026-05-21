import test from 'node:test';
import assert from 'node:assert/strict';
import { jsLiteral } from '../ui/configPanel/jsLiteral';

test('jsLiteral preserves user text containing quotes and slashes', () => {
    const value = String.raw`build\', temp, value's`;
    const parsed = Function(`return ${jsLiteral(value)}`)();

    assert.equal(parsed, value);
});

test('jsLiteral prevents closing an inline script tag', () => {
    const literal = jsLiteral('</script><script>alert(1)</script>');

    assert.doesNotMatch(literal, /<\/script>/i);
    assert.equal(Function(`return ${literal}`)(), '</script><script>alert(1)</script>');
});
