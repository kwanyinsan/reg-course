const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/db');
const payments = require('../src/payment');
const access = require('../src/payment-access');

process.env.PAYMENT_LINK_SECRET = crypto.randomBytes(32).toString('base64url');

test('protected combined payments, locked completion, recovery and history', async function integration() {
    const schema = `payment_test_${process.pid}_${Date.now()}`;
    assert.match(schema, /^payment_test_\d+_\d+$/);
    pool.options.options = `-c search_path=${schema},public`;
    let server;
    let blocker;
    let paymentEntered;
    try {
        await pool.query(`CREATE SCHEMA "${schema}"`);
        await pool.query(fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8'));
        const sessions = [{ id: 's1', starts_at: '2027-01-01T10:00:00+08:00', ends_at: '2027-01-01T12:00:00+08:00', topic: { en: 'Session' }, mode: 'in_person' }];
        const courses = [];
        for (const [index, fee] of [0, 120, 30].entries()) {
            const result = await pool.query(`INSERT INTO course
                (code,title,short_description,long_description,mode,sessions,fee,payment_deadline,attendance_requirement_percent,state)
                VALUES($1,$2,'{"en":"Short"}','{"en":"Long"}','in_person',$3,$4,NOW()+($5::int*INTERVAL '1 day'),100,'draft') RETURNING id,fee,payment_deadline`,
                [`PAY-${index}`, { en: `Course ${index}` }, JSON.stringify(sessions), fee, 3 + index]);
            courses.push(result.rows[0]);
            await pool.query('INSERT INTO question(course_id,definition) VALUES($1,\'{"questions":[]}\')', [result.rows[0].id]);
            await pool.query("UPDATE course SET state='published' WHERE id=$1", [result.rows[0].id]);
        }
        let sequence = 0;
        async function create(selected = courses) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const result = await client.query(`INSERT INTO submission
                    (reference,salutation,full_name,organisation,job_title,phone,email,consent_accepted,total)
                    VALUES($1,'Ms','Private Applicant','Private Organisation','Private Job','12345678','private@example.invalid',true,$2) RETURNING id`,
                    [`APP-QA-${++sequence}`, selected.reduce((sum, course) => sum + course.fee, 0)]);
                const id = result.rows[0].id;
                for (const course of selected) await client.query('INSERT INTO registration(submission_id,course_id,fee) VALUES($1,$2,$3)', [id, course.id, course.fee]);
                await payments.createPending(client, id);
                await client.query('COMMIT');
                return id;
            } catch (error) { await client.query('ROLLBACK'); throw error; }
            finally { client.release(); }
        }
        async function tokenFor(id) {
            const record = await payments.readPayment(pool, id);
            return access.accessLink(record).split('/#payment/')[1];
        }
        const express = require('express');
        const app = express();
        app.use(express.json());
        app.use('/payment', function entered(req, res, next) {
            if (req.method === 'POST' && paymentEntered) { paymentEntered(); paymentEntered = null; }
            next();
        }, require('../src/security').requireTrustedRequest, payments.router);
        app.use('/admin', require('../src/admin'));
        server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        const base = `http://127.0.0.1:${server.address().port}`;
        async function call(token, body, headers = {}) {
            const response = await fetch(base + '/payment' + (body === undefined ? '' : '/pay'), {
                method: body === undefined ? 'GET' : 'POST',
                headers: { Authorization: `Bearer ${token}`, Origin: process.env.APP_ORIGIN,
                    'X-Requested-With': 'reg-course', 'Content-Type': 'application/json', ...headers },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            return { status: response.status, data: await response.json() };
        }
        const id = await create();
        const token = await tokenFor(id);
        const record = await payments.readPayment(pool, id);
        assert.equal(record.amount, '150.00');
        assert.equal(record.due_at.toISOString(), courses[0].payment_deadline.toISOString());
        const initialLogCount = (await pool.query('SELECT COUNT(*)::int n FROM log')).rows[0].n;
        const read = await call(token);
        assert.equal(read.status, 200, 'Fresh requests need no application cookie');
        assert.equal(read.data.payment.state, 'pending');
        assert.equal(read.data.payment.courses.length, 3);
        assert.equal(read.data.payment.courses.reduce((sum, course) => sum + Number(course.fee), 0), 150);
        assert.doesNotMatch(JSON.stringify(read.data), /Private Applicant|Private Organisation|private@example|answers|access_url|Bearer/);
        assert.equal((await call(token)).data.payment.state, 'pending');
        assert.equal((await pool.query('SELECT COUNT(*)::int n FROM log')).rows[0].n, initialLogCount);
        assert.equal((await pool.query('SELECT state FROM payment WHERE submission_id=$1', [id])).rows[0].state, 'pending');
        assert.equal((await call('not-a-token')).status, 401);
        assert.equal((await call(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'))).status, 401);
        assert.equal((await call(token, { amount: 1 })).status, 400);
        assert.equal((await call(token, {}, { Origin: 'https://wrong.example.invalid' })).status, 403);
        const head = await fetch(base + '/payment', { method: 'HEAD', headers: { Authorization: `Bearer ${token}` } });
        assert.equal(head.status, 200);
        function signed(claims) {
            const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
            const signature = crypto.createHmac('sha256', Buffer.from(process.env.PAYMENT_LINK_SECRET, 'base64url')).update(payload).digest('base64url');
            return `${payload}.${signature}`;
        }
        const claims = access.verifyAccess(token);
        assert.equal((await call(signed({ ...claims, purpose: 'application' }))).status, 401);
        assert.equal((await call(signed({ ...claims, payment_id: 2147483647 }))).status, 401);
        const outcomes = await Promise.all([call(token, {}), call(token, {})]);
        assert.deepEqual(outcomes.map(result => result.status), [200, 200]);
        assert.deepEqual(outcomes.map(result => result.data.repeated).sort(), [false, true]);
        const paidAt = outcomes[0].data.payment.paid_at;
        assert.equal((await call(token, {})).data.payment.paid_at, paidAt);
        assert.equal((await call(token)).data.payment.paid_at, paidAt, 'A lost Pay response recovers with GET');
        assert.equal((await pool.query("SELECT COUNT(*)::int n FROM log WHERE submission_id=$1 AND event='payment.completed'", [id])).rows[0].n, 1);
        assert.equal((await pool.query('SELECT COUNT(*)::int n FROM payment WHERE submission_id=$1', [id])).rows[0].n, 1);
        for (const sql of ["UPDATE payment SET amount=1 WHERE submission_id=$1", 'DELETE FROM payment WHERE submission_id=$1',
            'UPDATE submission SET total=1 WHERE id=$1', 'UPDATE registration SET fee=1 WHERE submission_id=$1', 'DELETE FROM registration WHERE submission_id=$1']) {
            await assert.rejects(pool.query(sql, [id]), { code: '23514' });
        }
        const freeId = await create([courses[0]]);
        assert.equal((await payments.forSubmission(pool, freeId, true)).state, 'not_required');
        assert.equal((await pool.query('SELECT COUNT(*)::int n FROM payment WHERE submission_id=$1', [freeId])).rows[0].n, 0);
        const legacyId = await create([courses[1]]);
        await pool.query('DELETE FROM log WHERE submission_id=$1', [legacyId]);
        await pool.query('DELETE FROM payment WHERE submission_id=$1', [legacyId]);
        assert.equal((await payments.forSubmission(pool, legacyId, true)).state, 'unavailable');
        assert.equal((await payments.forSubmission(pool, legacyId, true)).access_url, null);
        const mismatchId = await create();
        const mismatchToken = await tokenFor(mismatchId);
        await pool.query('UPDATE payment SET amount=1 WHERE submission_id=$1', [mismatchId]);
        assert.equal((await call(mismatchToken)).data.payment.can_pay, false);
        assert.equal((await call(mismatchToken, {})).status, 409);
        assert.equal((await payments.readPayment(pool, mismatchId)).state, 'pending');
        const { rows: [admin] } = await pool.query("INSERT INTO admin(username,password_hash) VALUES('QA','unused-test-hash') RETURNING id");
        const cancelledId = await create();
        const cancelledToken = await tokenFor(cancelledId);
        await pool.query("UPDATE registration SET state='cancelled',cancelled_at=NOW(),cancelled_by=$1,cancellation_reason='QA' WHERE submission_id=$2 AND course_id=$3", [admin.id, cancelledId, courses[1].id]);
        assert.equal((await call(cancelledToken)).data.payment.unavailable_reason, 'course_cancelled');
        const blockedGroup = await (await fetch(base + `/admin/registrations?group_by=submission&q=APP-QA-${sequence}`)).json();
        assert.equal(blockedGroup.submissions[0].payment_unavailable_reason, 'course_cancelled');
        assert.equal((await call(cancelledToken, {})).status, 409);
        assert.equal((await payments.readPayment(pool, cancelledId)).amount, '150.00');
        await pool.query("UPDATE submission SET is_cancelled=true,cancelled_at=NOW(),cancelled_by=$1,cancellation_reason='QA' WHERE id=$2", [admin.id, cancelledId]);
        assert.equal((await call(cancelledToken)).data.payment.state, 'cancelled');
        assert.equal((await payments.readPayment(pool, cancelledId)).state, 'pending', 'GET never persists cancellation');
        assert.equal((await call(cancelledToken, {})).status, 409);
        assert.equal((await payments.readPayment(pool, cancelledId)).state, 'cancelled');
        await pool.query("UPDATE submission SET is_cancelled=true,cancelled_at=NOW(),cancelled_by=$1,cancellation_reason='QA' WHERE id=$2", [admin.id, id]);
        assert.equal((await call(token, {})).data.payment.paid_at, paidAt, 'Later cancellation cannot rewrite a paid payment');
        const failedId = await create();
        const failedToken = await tokenFor(failedId);
        await pool.query(`CREATE FUNCTION fail_payment_log() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
            IF NEW.event='payment.completed' THEN RAISE EXCEPTION 'Private failure detail'; END IF; RETURN NEW; END $$`);
        await pool.query('CREATE TRIGGER fail_payment_log BEFORE INSERT ON log FOR EACH ROW EXECUTE FUNCTION fail_payment_log()');
        assert.equal((await call(failedToken, {})).status, 503);
        assert.equal((await payments.readPayment(pool, failedId)).state, 'pending');
        assert.equal((await payments.readPayment(pool, failedId)).paid_at, null);
        assert.equal((await pool.query("SELECT COUNT(*)::int n FROM log WHERE submission_id=$1 AND event='payment.completed'", [failedId])).rows[0].n, 0);
        await pool.query('DROP TRIGGER fail_payment_log ON log');
        assert.equal((await call(failedToken, {})).data.payment.state, 'paid');
        const expiredId = await create();
        await pool.query("UPDATE payment SET due_at=NOW()-INTERVAL '1 second',created_at=NOW()-INTERVAL '1 hour' WHERE submission_id=$1", [expiredId]);
        const expiredRecord = await payments.readPayment(pool, expiredId);
        const expiredToken = signed({ version: 1, purpose: 'payment', payment_id: expiredRecord.id,
            not_before: expiredRecord.created_at.getTime(), expires_at: expiredRecord.due_at.getTime() });
        assert.equal((await call(expiredToken)).status, 410);
        assert.equal((await call(expiredToken, {})).status, 410);
        assert.equal((await payments.forSubmission(pool, expiredId)).state, 'expired');
        assert.equal((await payments.readPayment(pool, expiredId)).state, 'pending');
        const paidExpiryId = await create();
        await pool.query("UPDATE payment SET due_at=clock_timestamp()+INTERVAL '1 second' WHERE submission_id=$1", [paidExpiryId]);
        const paidExpiryToken = await tokenFor(paidExpiryId);
        assert.equal((await call(paidExpiryToken, {})).data.payment.state, 'paid');
        const nearId = await create();
        await pool.query("UPDATE payment SET due_at=clock_timestamp()+INTERVAL '2 seconds' WHERE submission_id=$1", [nearId]);
        const nearToken = await tokenFor(nearId);
        blocker = await pool.connect();
        await blocker.query('BEGIN');
        await blocker.query('SELECT id FROM submission WHERE id=$1 FOR UPDATE', [nearId]);
        const entered = new Promise(resolve => { paymentEntered = resolve; });
        const waiting = call(nearToken, {});
        await entered;
        await new Promise(resolve => setTimeout(resolve, 2100));
        await blocker.query('COMMIT');
        blocker.release(); blocker = null;
        assert.equal((await waiting).status, 409, 'Eligibility must be rechecked after waiting for a lock');
        assert.equal((await payments.readPayment(pool, nearId)).state, 'expired');
        assert.equal((await call(paidExpiryToken)).status, 410, 'Even a paid link ends at the payment deadline');
        assert.equal((await payments.readPayment(pool, paidExpiryId)).state, 'paid');
        const expiredGroups = await (await fetch(base + '/admin/registrations?group_by=submission&payment_state=expired')).json();
        assert.equal(expiredGroups.total, 2);
        assert.equal(expiredGroups.submissions.find(item => item.id === expiredId).payment_state, 'expired');
        assert.equal((await payments.readPayment(pool, expiredId)).state, 'pending');
        const paidGroup = await (await fetch(base + '/admin/registrations?group_by=submission&payment_state=paid')).json();
        assert.equal(paidGroup.total, 3);
        assert.ok(paidGroup.submissions.every(item => item.payment_reference && item.payment_amount === '150.00' && item.paid_at));
        const adminCourse = await (await fetch(base + `/admin/courses/${courses[1].id}`)).json();
        assert.equal(adminCourse.course.paid_count, 3);
        const registration = (await pool.query('SELECT id FROM registration WHERE submission_id=$1 ORDER BY id LIMIT 1', [id])).rows[0];
        const details = await (await fetch(base + `/admin/registrations/${registration.id}`)).json();
        assert.equal(details.payment.paid_at, paidAt);
        assert.equal(Object.hasOwn(details.payment, 'access_url'), false);
        const logs = JSON.stringify((await pool.query('SELECT details FROM log')).rows);
        assert.equal(logs.includes(token), false);
        assert.doesNotMatch(logs, /Private failure detail|Private Applicant|private@example|PAYMENT_LINK_SECRET/);
        console.log('Verified: fresh access, exact totals/deadlines, GET safety, concurrent Pay, lost-response recovery, zero totals, cancellation, expiry after locks, rollback, paid history and admin displays.');
    } finally {
        if (blocker) { await blocker.query('ROLLBACK'); blocker.release(); }
        if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await pool.end();
    }
});

test('payment links keep separate browser history and complete translations', async function browserHelpers() {
    const { pathToFileURL } = require('node:url');
    const links = await import(pathToFileURL(path.join(__dirname, '../../frontend/src/payment-link.js')));
    const text = {};
    for (const language of ['en', 'zh-Hant', 'zh-Hans']) {
        text[language] = (await import(`../../frontend/src/translations/${language}.js`)).default;
    }
    const storage = new Map();
    global.sessionStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
    global.window = { location: { hash: '#payment/first.' + 'A'.repeat(43) }, history: {
        state: null, replaceState(state, unused, hash) { this.state = state; global.window.location.hash = hash; }
    } };
    try {
        const first = links.capturePaymentLink();
        const firstState = window.history.state;
        assert.equal(window.location.hash, '#payment');
        assert.equal(links.paymentToken(first), 'first.' + 'A'.repeat(43));
        window.location.hash = '#payment/second.' + 'B'.repeat(43);
        const second = links.capturePaymentLink();
        assert.notEqual(first, second);
        window.history.state = firstState;
        assert.equal(links.capturePaymentLink(), first);
        assert.equal(links.paymentToken(first), 'first.' + 'A'.repeat(43));
        links.clearPaymentToken(first);
        assert.equal(links.paymentToken(first), '');
        for (const language of ['zh-Hant', 'zh-Hans']) assert.deepEqual(Object.keys(text[language]).sort(), Object.keys(text.en).sort());
    } finally { delete global.window; delete global.sessionStorage; }
});
