const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// This script is copied into backend/test; it exercises the actual router and SQL guards.
const pool = require('../src/db');
const { validateApplication } = require('../src/application-validation');
const acknowledgement = require('../src/acknowledgement');
const mail = require('../src/mail');
process.env.PAYMENT_LINK_SECRET = require('node:crypto').randomBytes(32).toString('base64url');

test('public application transactions, validation and private recovery', async function integration() {
    const schema = `registration_test_${process.pid}_${Date.now()}`;
    assert.match(schema, /^registration_test_\d+_\d+$/);
    pool.options.options = `-c search_path=${schema},public`;
    let server;
    let store;
    let sent = 0;
    let failMail = false;
    const emailLinks = [];
    try {
        await pool.query(`CREATE SCHEMA "${schema}"`);
        await pool.query(fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8'));
        await pool.query('CREATE TABLE session (sid varchar PRIMARY KEY, sess json NOT NULL, expire timestamp NOT NULL)');
        await acknowledgement.installTemplate();
        // Never contact a real SMTP service from application tests.
        mail.sendMessage = async function controlledMessage(message) {
            sent++;
            const reference = message.subject.split(' — ')[1];
            const visible = await pool.query('SELECT id FROM submission WHERE reference=$1', [reference]);
            assert.equal(visible.rowCount, 1, 'SMTP must run after the submission is visible outside its transaction');
            emailLinks.push(message.text.match(/http[^\s]+\/#payment\/[^\s]+/)?.[0] || null);
            if (failMail) throw Object.assign(new Error('Do not log this private SMTP diagnostic.'), { code: 'EAUTH' });
            return { accepted: [message.to], messageId: 'application-test-message' };
        };
        const sessions = [{ id: 'session_1', starts_at: '2027-01-01T10:00:00+08:00', ends_at: '2027-01-01T12:00:00+08:00', topic: { en: 'Session' }, mode: 'in_person' }];
        const questions = { questions: [
            { id: 'goal', label: { en: 'Your goal' }, type: 'text', required: true },
            { id: 'level', label: { en: 'Level' }, type: 'single_choice', required: true, options: [{ id: 'a', label: { en: 'A' } }, { id: 'b', label: { en: 'B' } }] },
            { id: 'topics', label: { en: 'Topics' }, type: 'multiple_choice', required: true, options: [{ id: 'a', label: { en: 'A' } }, { id: 'b', label: { en: 'B' } }] },
        ] };
        const ids = [];
        for (let index = 0; index < 2; index++) {
            const result = await pool.query(`INSERT INTO course (code,title,short_description,long_description,mode,sessions,fee,registration_opens_at,registration_closes_at,payment_deadline,attendance_requirement_percent,state)
                VALUES ($1,'{"en":"Test course"}','{"en":"Short"}','{"en":"Long"}','in_person',$2,$3,NOW()-INTERVAL '1 day',NOW()+INTERVAL '1 day',NOW()+($4::int * INTERVAL '1 day'),100,'draft') RETURNING id`, [`TEST-${index}`, JSON.stringify(sessions), index * 100, 3 + index]);
            const id = result.rows[0].id;
            ids.push(id);
            await pool.query('INSERT INTO question (course_id,definition) VALUES ($1,$2)', [id, questions]);
            await pool.query("UPDATE course SET state='published' WHERE id=$1", [id]);
        }
        // The store bootstrap is unrelated to router atomicity. Supply it in the isolated schema.
        store = require('../src/session').sessionStore;
        store.get = function isolatedTableReady(sid, callback) { callback(null, undefined); };
        const express = require('express');
        const app = express();
        app.use(express.json({ limit: '256kb' }));
        app.use('/application', require('../src/security').requireTrustedRequest, require('../src/application'));
        app.use(function errorHandler(error, req, res, next) { void next; res.status(500).json({ code: 'failed' }); });
        server = app.listen(0, '127.0.0.1');
        await new Promise(function listening(resolve) { server.once('listening', resolve); });
        const base = `http://127.0.0.1:${server.address().port}/application`;
        async function call(route, body, cookie = '', headers = {}) {
            const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST',
                headers: { Origin: process.env.APP_ORIGIN, 'X-Requested-With': 'reg-course', 'Content-Type': 'application/json', Cookie: cookie, ...headers },
                body: body === undefined ? undefined : JSON.stringify(body) });
            return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie };
        }
        async function prepare(course_ids = ids) { const result = await call('/definition', { course_ids }); assert.equal(result.status, 200); return result; }
        function payload(prepared) {
            return { review_token: prepared.data.review_token, personal: { salutation: 'Ms', full_name: 'Synthetic Test', organisation: 'Isolated QA', job_title: 'Tester', phone: '00001234', email: 'qa@example.invalid', comments: '', consent_accepted: true },
                answers: Object.fromEntries(prepared.data.definition.courses.map(function answer(course) { return [course.id, { goal: `Goal for ${course.id}`, level: 'a', topics: ['b', 'a'] }]; })) };
        }
        assert.equal((await call('/definition', { course_ids: ids }, '', { Origin: 'https://wrong.invalid' })).status, 403);
        assert.equal((await call('/definition', { course_ids: [ids[0], ids[0]] })).status, 400);
        assert.equal((await call('/definition', { course_ids: [999999] })).status, 409);
        assert.equal((await call('/result')).status, 401);
        const prepared = await prepare();
        const body = payload(prepared);
        assert.equal((await call('', { ...body, total: 1 }, prepared.cookie)).status, 400);
        assert.equal((await call('', { ...body, personal: { ...body.personal, phone: '123' } }, prepared.cookie)).status, 400);
        const missing = structuredClone(body);
        delete missing.answers[ids[0]].goal;
        assert.equal((await call('', missing, prepared.cookie)).status, 400);
        const invalid = structuredClone(body);
        invalid.answers[ids[0]].topics = ['a', 'a'];
        assert.equal((await call('', invalid, prepared.cookie)).status, 400);
        invalid.answers[ids[0]].topics = ['a'];
        invalid.answers[ids[0]].unknown = 'hidden';
        assert.equal((await call('', invalid, prepared.cookie)).status, 400);
        assert.throws(function missingConsent() { validateApplication({ ...body, personal: { ...body.personal, consent_accepted: false } }, prepared.data.definition); });
        const results = await Promise.all([call('', body, prepared.cookie), call('', body, prepared.cookie)]);
        assert.deepEqual(results.map(function status(result) { return result.status; }).sort(), [200, 201]);
        assert.equal(results[0].data.receipt.submission.reference, results[1].data.receipt.submission.reference);
        assert.equal(Number(results[0].data.receipt.submission.total), 100);
        assert.equal((await pool.query('SELECT COUNT(*)::int n FROM submission')).rows[0].n, 1);
        assert.equal((await pool.query('SELECT COUNT(*)::int n FROM registration')).rows[0].n, 2);
        assert.equal((await pool.query('SELECT COUNT(*)::int n FROM payment')).rows[0].n, 1);
        assert.equal((await pool.query('SELECT COUNT(*)::int n FROM log')).rows[0].n, 7);
        const payment = results[0].data.receipt.payment;
        assert.equal(Number(payment.amount), 100);
        assert.equal(payment.state, 'pending');
        assert.equal(payment.due_at, prepared.data.definition.payment_deadline);
        assert.equal(payment.due_at, prepared.data.definition.courses[0].payment_deadline, 'Free courses also participate in the earliest deadline');
        assert.equal(payment.access_url, emailLinks[0], 'Acknowledgement and email must use the same protected URL');
        assert.equal(sent, 1);
        assert.equal((await call('/result', undefined, prepared.cookie)).data.receipt.acknowledgement_email.status, 'accepted');
        const reordered = structuredClone(body);
        reordered.answers[ids[0]].topics.reverse();
        assert.equal((await call('', reordered, prepared.cookie)).status, 200);
        const storedSession = await pool.query('SELECT sess FROM session WHERE sid=$1', ['application:' + prepared.cookie.split('=')[1]]);
        assert.equal(JSON.stringify(storedSession.rows[0].sess).includes('Synthetic Test'), false);
        assert.equal((await call('/result', undefined, prepared.cookie)).status, 200);
        assert.equal((await call('/result?reference=known', undefined, prepared.cookie)).status, 400);
        assert.equal((await call('/result', undefined, 'reg_course.application=' + 'x'.repeat(43))).status, 401);
        assert.equal((await call('', { ...body, personal: { ...body.personal, full_name: 'Changed' } }, prepared.cookie)).status, 409);
        const expired = await prepare();
        const sid = 'application:' + expired.cookie.split('=')[1];
        await pool.query("UPDATE session SET expire=NOW()-INTERVAL '1 hour' WHERE sid=$1", [sid]);
        assert.equal((await call('', payload(expired), expired.cookie)).status, 401);
        const stale = await prepare();
        // A valid structural snapshot difference tests re-review without mutating a published form.
        await pool.query("UPDATE session SET sess=jsonb_set(sess::jsonb,'{definition,total}','999'::jsonb)::json WHERE sid=$1", ['application:' + stale.cookie.split('=')[1]]);
        assert.equal((await call('', payload(stale), stale.cookie)).data.code, 'definition_changed');
        const deadlineChanged = await prepare();
        await pool.query("UPDATE session SET sess=jsonb_set(sess::jsonb,'{definition,payment_deadline}',to_jsonb('2028-01-01T00:00:00.000Z'::text))::json WHERE sid=$1", ['application:' + deadlineChanged.cookie.split('=')[1]]);
        assert.equal((await call('', payload(deadlineChanged), deadlineChanged.cookie)).data.code, 'definition_changed');
        const unavailable = await prepare();
        await pool.query("UPDATE course SET state='archived' WHERE id=$1", [ids[1]]);
        assert.equal((await call('', payload(unavailable), unavailable.cookie)).data.code, 'course_unavailable');
        await pool.query("UPDATE course SET state='published' WHERE id=$1", [ids[1]]);
        const failed = await prepare();
        await pool.query(`CREATE FUNCTION fail_test_log() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Isolated log failure'; END $$`);
        await pool.query('CREATE TRIGGER fail_test_log BEFORE INSERT ON log FOR EACH ROW EXECUTE FUNCTION fail_test_log()');
        assert.equal((await call('', payload(failed), failed.cookie)).status, 500);
        assert.equal((await pool.query('SELECT COUNT(*)::int n FROM submission')).rows[0].n, 1);
        assert.equal((await pool.query('SELECT COUNT(*)::int n FROM payment')).rows[0].n, 1, 'Failed application must roll its payment back');
        assert.equal((await call('/result', undefined, failed.cookie)).status, 404);
        assert.equal(sent, 1, 'Rolled-back and invalid applications must not send mail');
        await pool.query('DROP TRIGGER fail_test_log ON log');
        const free = await prepare([ids[0]]);
        assert.equal((await call('', payload(free), free.cookie)).status, 201);
        assert.equal(Number((await call('/result', undefined, free.cookie)).data.receipt.submission.total), 0);
        assert.equal((await pool.query('SELECT COUNT(*)::int n FROM payment')).rows[0].n, 1);
        assert.equal((await call('/result', undefined, free.cookie)).data.receipt.payment.state, 'not_required');
        assert.equal(emailLinks[1], null);
        await call('/new', {}, free.cookie);
        assert.equal((await call('/result', undefined, free.cookie)).status, 401);
        assert.equal(sent, 2, 'Repeated submissions and acknowledgement recovery must not send again');
        failMail = true;
        const emailFailure = await prepare();
        const savedDespiteMail = await call('', payload(emailFailure), emailFailure.cookie);
        assert.equal(savedDespiteMail.status, 201);
        assert.equal(savedDespiteMail.data.receipt.acknowledgement_email.status, 'failed');
        assert.equal((await call('/result', undefined, emailFailure.cookie)).data.receipt.acknowledgement_email.status, 'failed');
        assert.equal((await call('', payload(emailFailure), emailFailure.cookie)).status, 200);
        assert.equal(sent, 3);
        assert.equal((await pool.query('SELECT COUNT(*)::int n FROM submission')).rows[0].n, 3);
        assert.equal((await pool.query('SELECT COUNT(*)::int n FROM payment')).rows[0].n, 2);
        console.log('Verified: transactional combined payments, earliest reviewed deadline, zero totals, matching acknowledgement/email links, retry recovery and post-commit SMTP failure handling.');
    } finally {
        if (server) await new Promise(function close(resolve) { server.close(resolve); });
        if (store) store.close();
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await pool.end();
    }
});
