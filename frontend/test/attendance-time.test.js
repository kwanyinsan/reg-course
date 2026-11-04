import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hkInput, hkTimestamp } from '../src/attendance-api.js';

test('attendance correction accepts minute-only browser values with explicit Hong Kong time', () => {
    const value = hkTimestamp('2026-11-04T15:30');
    assert.equal(value, '2026-11-04T15:30:00+08:00');
    assert.equal(new Date(value).toISOString(), '2026-11-04T07:30:00.000Z');
    assert.equal(hkTimestamp('2026-11-04T15:30:12'), '2026-11-04T15:30:12+08:00');
    assert.equal(hkTimestamp('2026-11-04T15:30:12.500'), '2026-11-04T15:30:12.500+08:00');
    assert.equal(hkInput(value), '2026-11-04T15:30:00');
    assert.equal(hkTimestamp(hkInput(value)), value);
    for (const invalid of ['', null, '15:30', '2026-11-04', '2026-11-04T15:30Z']) assert.equal(hkTimestamp(invalid), '');
});
