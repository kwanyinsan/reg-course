const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/db');

test('admin registration groups preserve submissions across filters and page boundaries', async function integration() {
    const schema = `admin_test_${process.pid}_${Date.now()}`;
    assert.match(schema, /^admin_test_\d+_\d+$/);
    pool.options.options = `-c search_path=${schema},public`;
    let server;
    try {
        await pool.query(`CREATE SCHEMA "${schema}"`);
        await pool.query(fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8'));
        const sessions = [{ id: 's1', starts_at: '2027-01-01T10:00:00+08:00', ends_at: '2027-01-01T12:00:00+08:00', topic: { en: 'Session' }, mode: 'in_person' }];
        const ids = [];
        for (let index = 0; index < 26; index++) {
            const { rows: [course] } = await pool.query(`INSERT INTO course
                (code,title,short_description,long_description,mode,sessions,fee,registration_opens_at,registration_closes_at,payment_deadline,attendance_requirement_percent,state)
                VALUES ($1,$2,'{"en":"Short"}','{"en":"Long"}','in_person',$3,10,NOW()-INTERVAL '1 day',NOW()+INTERVAL '1 day',NOW()+INTERVAL '7 days',100,'draft') RETURNING id`,
                [`TEST-${index}`, { en: `Course ${index}` }, JSON.stringify(sessions)]);
            ids.push(course.id);
            await pool.query('INSERT INTO question(course_id,definition) VALUES($1,\'{"questions":[]}\')', [course.id]);
            await pool.query("UPDATE course SET state='published' WHERE id=$1", [course.id]);
        }
        async function submission(reference, courseIds) {
            const { rows: [record] } = await pool.query(`INSERT INTO submission
                (reference,salutation,full_name,organisation,job_title,phone,email,consent_accepted,total)
                VALUES ($1,'Ms','Same participant','QA','Tester','12345678','qa@example.test',true,$2) RETURNING id`, [reference, courseIds.length * 10]);
            for (const courseId of courseIds) await pool.query('INSERT INTO registration(submission_id,course_id,fee) VALUES($1,$2,10)', [record.id, courseId]);
            return record.id;
        }
        const singleIds = [];
        for (let index = 0; index < 25; index++) singleIds.push(await submission(`SINGLE-${index}`, [ids[0]]));
        const largeId = await submission('MULTI-26', ids);
        // Distinct submissions for the same participant must never be merged.
        const express = require('express');
        const app = express();
        app.use('/admin', function testAuthorization(req, res, next) {
            if (req.get('X-QA-Admin') !== 'yes') return res.status(401).json({ message: 'Login required' });
            next();
        }, require('../src/admin'));
        app.use(function error(error, req, res, next) { void next; console.error(error); res.status(500).json({ message: 'failed' }); });
        server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        const base = `http://127.0.0.1:${server.address().port}/admin/registrations`;
        async function read(query = '', authorized = true) {
            const response = await fetch(base + query, { headers: authorized ? { 'X-QA-Admin': 'yes' } : {} });
            return { status: response.status, data: await response.json() };
        }
        assert.equal((await read('?group_by=submission', false)).status, 401);
        const first = await read('?group_by=submission');
        assert.equal(first.status, 200);
        assert.equal(first.data.total, 26);
        assert.equal(first.data.submissions.length, 25);
        assert.equal(first.data.submissions[0].id, largeId);
        assert.equal(first.data.submissions[0].registrations.length, 26);
        assert.equal(first.data.submissions[0].total, '260.00');
        assert.equal(first.data.submissions[0].registrations.every(record => record.matches_filters), true);
        const second = await read('?group_by=submission&page=2');
        assert.equal(second.data.submissions.length, 1);
        assert.equal(new Set([...first.data.submissions, ...second.data.submissions].map(record => record.id)).size, 26);
        assert.equal(second.data.submissions.some(record => record.id === largeId), false);
        const filtered = await read('?group_by=submission&q=TEST-25');
        assert.equal(filtered.data.total, 1);
        assert.equal(filtered.data.submissions[0].registrations.length, 26);
        assert.equal(filtered.data.submissions[0].registrations.filter(record => record.matches_filters).length, 1);
        const scoped = await read(`?group_by=submission&course_id=${ids[25]}`);
        assert.equal(scoped.data.total, 1);
        assert.equal(scoped.data.submissions[0].registrations.length, 26);
        const flat = await read('?group_by=registration');
        assert.equal(flat.data.total, 51);
        assert.equal(flat.data.registrations.length, 25);
        assert.equal((await read('?group_by=submission&payment_state=none')).data.total, 26);
        assert.equal((await read('?group_by=submission&state=cancelled')).data.total, 0);
        assert.equal((await read('?group_by=submission&q=%25')).data.total, 0);
        assert.equal((await read('?group_by=submission&q=missing')).data.submissions.length, 0);
        for (const query of ['?group_by=unknown', '?group_by=submission&group_by=registration', '?page=0', '?course_id=invalid']) {
            assert.equal((await read(query)).status, 400);
        }
        // Count real payment states per registration, including courses in a shared submission.
        for (const [submissionId, state] of [[largeId, 'paid'], [singleIds[0], 'paid'], [singleIds[1], 'pending'], [singleIds[2], 'expired'], [singleIds[3], 'cancelled']]) {
            await pool.query(`INSERT INTO payment(submission_id,reference,amount,due_at,state,paid_at)
                SELECT id,'PAY-' || id,total,NOW()+INTERVAL '7 days',$2,
                    CASE WHEN $2='paid' THEN NOW() ELSE NULL END FROM submission WHERE id=$1`, [submissionId, state]);
        }
        const { rows: [admin] } = await pool.query("INSERT INTO admin(username,password_hash) VALUES('QA','test-only-unused-hash') RETURNING id");
        await pool.query(`UPDATE registration SET state='cancelled',cancelled_at=NOW(),cancelled_by=$1,cancellation_reason='QA'
            WHERE submission_id=$2`, [admin.id, singleIds[0]]);
        const courseBase = base.replace(/\/registrations$/, '/courses');
        async function courseData(route = '') {
            const response = await fetch(courseBase + route, { headers: { 'X-QA-Admin': 'yes' } });
            assert.equal(response.status, 200);
            return response.json();
        }
        const list = await courseData('?q=TEST-0');
        assert.equal(list.courses.length, 1);
        assert.equal(list.courses[0].paid_count, 2);
        assert.equal(list.courses[0].total_registrations, 26);
        assert.equal(list.courses[0].registered_count, 25);
        const detail = await courseData(`/${ids[0]}`);
        assert.equal(detail.course.paid_count, 2);
        assert.equal(detail.course.total_registrations, 26);
        assert.equal((await courseData(`/${ids[25]}`)).course.paid_count, 1);
        console.log('Verified: complete submission groups, pagination, filters, protected mounting, paid counts across payment states, cancelled registrations and combined payments.');
    } finally {
        if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await pool.end();
    }
});
