import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posixQuote } from '../core/shellQuote';

test('posixQuote wraps plain paths in single quotes', () => {
    assert.equal(posixQuote('/home/user/proj'), "'/home/user/proj'");
});

test("posixQuote escapes embedded single quotes with '\\'' idiom", () => {
    assert.equal(posixQuote("it's"), "'it'\\''s'");
    assert.equal(posixQuote("'"), "''\\'''");
    assert.equal(posixQuote("a'b'c"), "'a'\\''b'\\''c'");
});

test('posixQuote keeps spaces literal', () => {
    assert.equal(posixQuote('path with spaces'), "'path with spaces'");
});

test('posixQuote neutralizes expansion and command substitution metacharacters', () => {
    assert.equal(posixQuote('$HOME'), "'$HOME'");
    assert.equal(posixQuote('`id`'), "'`id`'");
    assert.equal(posixQuote('$(id)'), "'$(id)'");
    assert.equal(posixQuote('a;rm -rf /'), "'a;rm -rf /'");
});
