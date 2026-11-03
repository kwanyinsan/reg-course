const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const pool = require('../src/db');

test('protected activity projection, filters, stable cursors and read-only requests', async function integration() {
    const schema = `activity_test_${process.pid}_${Date.now()}`;
    assert.match(schema, /^activity_test_\d+_\d+$/);
    pool.options.options = `-c search_path=${schema},public`;
    let server;
    let store;
    try {
        await pool.query(`CREATE SCHEMA "${schema}"`);
        await pool.query(fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8'));
        const { rows: [admin] } = await pool.query("INSERT INTO admin(username,password_hash) VALUES('Activity QA','unused') RETURNING id");
        const { rows: [course] } = await pool.query(`INSERT INTO course(code,title,short_description,long_description,mode,sessions,fee,payment_deadline,attendance_requirement_percent,state)
            VALUES('ACT-1','{"en":"Activity course"}','{"en":"Short"}','{"en":"Long"}','virtual',$1,0,NOW(),100,'draft') RETURNING id`,
        [JSON.stringify([{ id: 's1', starts_at: '2026-01-01T10:00:00+08:00', ends_at: '2026-01-01T11:00:00+08:00', topic: { en: 'Session' }, mode: 'virtual' }])]);
        await pool.query('INSERT INTO question(course_id,definition) VALUES($1,\'{"questions":[]}\')', [course.id]);
        const { rows: [submission] } = await pool.query(`INSERT INTO submission(reference,salutation,full_name,organisation,job_title,phone,email,consent_accepted,total)
            VALUES('APP-ACT','Ms','Private participant','QA','QA','12345678','private@example.com',true,0) RETURNING id`);
        const { rows: [registration] } = await pool.query('INSERT INTO registration(submission_id,course_id,fee) VALUES($1,$2,0) RETURNING id', [submission.id, course.id]);
        const secret = 'PRIVATE_CANARY_DO_NOT_EXPOSE';
        for (let index = 0; index < 32; index++) await pool.query(`INSERT INTO log(actor_type,admin_id,event,course_id,submission_id,registration_id,details,created_at)
            VALUES('admin',$1,$2,$3,$4,$5,$6,'2026-01-01T16:00:00.123456Z')`,
        [admin.id, index === 0 ? 'future.unknown' : index === 1 ? 'attendance.corrected' : 'course.questions_saved', course.id, submission.id, registration.id,
            { question_count: 2, session_id: 's1', registrations: [registration.id], before: { recorded_at: '2026-01-01T10:00:00+08:00', private: secret },
                after: { recorded_at: '2026-01-01T10:01:00+08:00' }, token: secret, body: secret, pdf_base64: secret, reason: secret, snapshot: { recipient: 'private@example.com' } }]);
        await pool.query("INSERT INTO log(actor_type,event,details,created_at) VALUES('system','acknowledgement.accepted',$1,'2025-12-31T15:59:59Z')", [{ message_id: secret, command: secret }]);
        const express = require('express');
        const app = express();
        store = require('../src/session').sessionStore;
        app.use('/admin', (req, res, next) => { req.session = { adminId: req.get('X-QA-Admin') === 'yes' ? admin.id : undefined, expiresAt: Date.now() + 60000, destroy(done) { done(); } }; next(); }, require('../src/auth'), require('../src/admin'));
        server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        const base = `http://127.0.0.1:${server.address().port}/admin/activity`;
        async function read(query = '', auth = true) {
            const response = await fetch(base + query, { headers: auth ? { 'X-QA-Admin': 'yes' } : {} });
            return { status: response.status, data: await response.json() };
        }
        assert.equal((await read('', false)).status, 401);
        const before = (await pool.query('SELECT count(*) AS count FROM log')).rows[0].count;
        const originalQuery = pool.query.bind(pool);
        pool.query = function readOnly(sql, ...args) { assert.match(typeof sql === 'string' ? sql : sql.text, /^SELECT\s/i); return originalQuery(sql, ...args); };
        let first;
        try { first = await read(); assert.equal(first.status, 200); } finally { pool.query = originalQuery; }
        assert.equal(first.data.records.length, 25);
        assert.equal(first.data.records[0].actor.username, 'Activity QA');
        assert.equal(first.data.records[0].summary.question_count, 2);
        assert.equal(first.data.records[0].summary.registration_count, 1);
        assert.equal(first.data.records[0].related.course_code, 'ACT-1');
        await pool.query("INSERT INTO log(actor_type,event) VALUES('system','admin.login_failed')");
        const second = await read('?cursor=' + first.data.next_cursor);
        assert.equal(second.data.records.length, 8);
        assert.equal(new Set([...first.data.records, ...second.data.records].map(row => row.id)).size, 33);
        assert.equal(second.data.records.find(row => row.action === 'other').outcome, 'recorded');
        assert.equal(second.data.records.find(row => row.action === 'attendance_corrected').summary.before_at, '2026-01-01T10:00:00+08:00');
        const payload = JSON.stringify([first.data, second.data]);
        for (const hidden of [secret, 'private@example.com', 'Private participant', 'future.unknown', 'details', 'snapshot', 'pdf_base64']) assert.equal(payload.includes(hidden), false, hidden);
        assert.equal((await read('?group=email')).data.records.length, 1);
        assert.equal((await read('?group=other')).data.records.length, 1);
        assert.equal((await read('?actor=participant')).data.records.length, 0);
        assert.equal((await read('?q=APP-ACT')).data.records.length, 25);
        assert.equal((await read('?q=%25')).data.records.length, 0);
        assert.equal((await read('?from=2026-01-02&to=2026-01-02')).data.records.length, 25);
        assert.equal((await read('?from=2026-01-01&to=2026-01-01')).data.records.length, 0);
        for (const query of ['?group=invalid', '?actor=admin&actor=system', '?from=2026-02-30', '?from=2026-02-01&to=2026-01-01', '?cursor=bad', '?page=1', '?q=' + 'x'.repeat(101)]) assert.equal((await read(query)).status, 400, query);
        assert.equal((await pool.query('SELECT count(*) AS count FROM log')).rows[0].count, String(Number(before) + 1));
        const text = (await import(pathToFileURL(path.join(__dirname, '../../frontend/src/activity-text.js')))).default;
        for (const language of ['en', 'zh-Hant', 'zh-Hans']) {
            for (const value of Object.values(text[language])) assert.ok(typeof value === 'string' && value.trim());
            for (const item of Object.values(require('../src/activity').actions)) if (item.group !== 'email') assert.ok(text[language]['act_' + item.action], item.action);
        }
        console.log('Verified activity access, microsecond cursor boundaries, HK dates, references, safe summaries, unknown events and three-language labels.');
    } finally {
        if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
        if (store) store.close();
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await pool.end();
    }
});
