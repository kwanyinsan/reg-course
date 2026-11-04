const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/db');

test('course publication and archiving preserve locks and commit their activity together', async function integration() {
    const schema = `course_state_test_${process.pid}_${Date.now()}`;
    pool.options.options = `-c search_path=${schema},public`;
    let server;
    let store;
    try {
        await pool.query(`CREATE SCHEMA "${schema}"`);
        await pool.query(fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8'));
        const { rows: [admin] } = await pool.query("INSERT INTO admin(username,password_hash) VALUES('QA','unused-test-hash') RETURNING id");
        const sessions = [{ id: 'session_1', starts_at: '2027-01-01T10:00:00+08:00', ends_at: '2027-01-01T12:00:00+08:00', topic: { en: 'Workshop' }, mode: 'in_person' }];
        const ids = [];
        for (let index = 0; index < 3; index++) {
            const { rows: [course] } = await pool.query(`INSERT INTO course
                (code,title,short_description,long_description,mode,sessions,fee,payment_deadline,attendance_requirement_percent,state)
                VALUES($1,'{"en":"Workshop"}','{"en":"Short"}','{"en":"Long"}','in_person',$2,0,NOW()+INTERVAL '7 days',100,'draft') RETURNING id`,
                [`STATE-${index}`, JSON.stringify(sessions)]);
            ids.push(course.id);
        }
        const express = require('express');
        const app = express();
        app.use(require('../src/security').requireTrustedRequest);
        app.use(express.json({ strict: false }));
        store = require('../src/session').sessionStore;
        app.use('/admin', function testSession(req, res, next) {
            req.session = { adminId: req.get('X-QA-Admin') === 'yes' ? admin.id : undefined,
                expiresAt: Date.now() + 60000, destroy(callback) { callback(); } };
            next();
        }, require('../src/auth'), require('../src/admin'));
        app.use('/courses', require('../src/courses').router);
        app.use(function error(error, req, res, next) { void error; void next; res.status(500).json({ code: 'request_failed' }); });
        server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        const base = `http://127.0.0.1:${server.address().port}`;
        async function call(id, body, authorised = true, headers = {}, method = 'POST') {
            const response = await fetch(`${base}/admin/courses/${id}/state`, {
                method, headers: { Origin: process.env.APP_ORIGIN, 'Content-Type': 'application/json',
                    'X-Requested-With': 'reg-course', ...(authorised ? { 'X-QA-Admin': 'yes' } : {}), ...headers },
                body: method === 'GET' ? undefined : JSON.stringify(body),
            });
            return { status: response.status, data: response.headers.get('Content-Type')?.includes('application/json') ? await response.json() : null };
        }
        async function state(id) { return (await pool.query('SELECT state,published_at FROM course WHERE id=$1', [id])).rows[0]; }
        const publish = { state: 'published', original_state: 'draft' };
        assert.equal((await call(ids[0], publish, false)).status, 401);
        assert.equal((await call(ids[0], publish, true, { Origin: 'https://untrusted.example' })).status, 403);
        assert.equal((await call(ids[0], publish, true, { 'X-Requested-With': '' })).status, 403);
        for (const body of [null, {}, [], { ...publish, extra: true }, { ...publish, state: 'draft' }, { ...publish, original_state: 'unknown' }]) {
            assert.equal((await call(ids[0], body)).status, 400);
        }
        assert.equal((await call('bad', publish)).status, 400);
        assert.equal((await call('2147483647', publish)).status, 404);
        assert.equal((await call(ids[0], publish, true, {}, 'GET')).status, 404);
        assert.equal((await state(ids[0])).state, 'draft');
        assert.equal((await call(ids[0], publish)).data.code, 'course_questions_required');
        await pool.query('INSERT INTO question(course_id,definition) VALUES($1,\'{"questions":[]}\')', [ids[0]]);
        const concurrent = await Promise.all([call(ids[0], publish), call(ids[0], publish)]);
        assert.equal(concurrent.every(result => result.status === 200), true);
        const firstPublished = await state(ids[0]);
        assert.equal(firstPublished.state, 'published');
        assert.ok(firstPublished.published_at);
        assert.equal((await pool.query("SELECT count(*)::int AS total FROM log WHERE course_id=$1 AND event='course.published'", [ids[0]])).rows[0].total, 1);
        const publicCourse = await fetch(`${base}/courses/${ids[0]}`);
        assert.equal(publicCourse.status, 200);
        assert.equal((await call(ids[0], { state: 'archived', original_state: 'draft' })).data.code, 'course_state_conflict');
        assert.equal((await call(ids[0], { state: 'archived', original_state: 'published' })).status, 200);
        assert.equal((await fetch(`${base}/courses/${ids[0]}`)).status, 404);
        assert.equal((await state(ids[0])).published_at.getTime(), firstPublished.published_at.getTime());
        const locked = await fetch(`${base}/admin/courses/${ids[0]}/questions`, { headers: { 'X-QA-Admin': 'yes' } });
        assert.equal((await locked.json()).editable, false);
        const lockedSave = await fetch(`${base}/admin/courses/${ids[0]}/questions`, {
            method: 'PUT', headers: { Origin: process.env.APP_ORIGIN, 'Content-Type': 'application/json', 'X-Requested-With': 'reg-course', 'X-QA-Admin': 'yes' },
            body: JSON.stringify({ definition: { questions: [] }, original_definition: { questions: [] } }),
        });
        assert.equal(lockedSave.status, 409);
        assert.equal((await call(ids[0], { state: 'published', original_state: 'archived' })).status, 200);
        assert.equal((await state(ids[0])).published_at.getTime(), firstPublished.published_at.getTime());
        assert.equal((await call(ids[1], { state: 'archived', original_state: 'draft' })).status, 200);
        assert.equal((await state(ids[1])).published_at, null);
        assert.equal((await call(ids[1], { state: 'archived', original_state: 'draft' })).status, 200);
        assert.equal((await pool.query("SELECT count(*)::int AS total FROM log WHERE course_id=$1 AND event='course.archived'", [ids[1]])).rows[0].total, 1);
        await pool.query(`CREATE FUNCTION reject_course_log() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
            IF NEW.event='course.archived' THEN RAISE EXCEPTION 'Controlled log failure'; END IF; RETURN NEW; END; $$;
            CREATE TRIGGER reject_course_log BEFORE INSERT ON log FOR EACH ROW EXECUTE FUNCTION reject_course_log()`);
        assert.equal((await call(ids[2], { state: 'archived', original_state: 'draft' })).status, 500);
        assert.equal((await state(ids[2])).state, 'draft');
        assert.equal((await pool.query('SELECT count(*)::int AS total FROM registration')).rows[0].total, 0);
        console.log('Verified protected requests, question prerequisite, concurrent retries, public visibility, permanent locks, stale states, draft archiving and transactional log rollback.');
    } finally {
        if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
        if (store) store.close();
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await pool.end();
    }
});
