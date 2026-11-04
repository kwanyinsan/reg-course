const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const nodemailer = require('nodemailer');
const pool = require('../src/db');
const results = require('../src/attendance-result-mail');
const attendance = require('../src/attendance');
const mail = require('../src/mail');

test('session result snapshots, recipient rules, corrections, concurrent claims and SMTP recovery', async function integration() {
    const schema = `result_test_${process.pid}_${Date.now()}`;
    assert.match(schema, /^result_test_\d+_\d+$/);
    pool.options.options = `-c search_path=${schema},public`;
    let server;
    let store;
    let smtp;
    const sockets = new Set();
    const messages = [];
    const received = [];
    const originalSend = mail.sendMessage;
    let mode = 'accepted';
    try {
        await pool.query(`CREATE SCHEMA "${schema}"`);
        await pool.query(fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8'));
        const { rows: [admin] } = await pool.query("INSERT INTO admin(username,password_hash) VALUES('Result QA','unused') RETURNING id");
        const now = Date.now();
        const iso = offset => new Date(now + offset).toISOString();
        const sessions = [{ id: 's1', starts_at: iso(-7200000), ends_at: iso(-3600000), topic: { en: 'Session <&> {{participant_name}}' }, mode: 'virtual' },
            { id: 's2', starts_at: iso(-14400000), ends_at: iso(-10800000), topic: { en: 'Earlier session' }, mode: 'virtual' }];
        const courses = [];
        for (let index = 0; index < 4; index++) {
            const { rows: [course] } = await pool.query(`INSERT INTO course(code,title,short_description,long_description,mode,sessions,fee,payment_deadline,attendance_requirement_percent,state)
                VALUES($1,'{"en":"Course <&>"}','{"en":"Short"}','{"en":"Long"}','virtual',$2,$3,NOW(),50,'draft') RETURNING id`,
            [`RESULT-${index}`, JSON.stringify([sessions[1], index === 1 ? { ...sessions[0], ends_at: iso(3600000) } : sessions[0]]), index === 3 ? 0 : 10]);
            await pool.query('INSERT INTO question(course_id,definition) VALUES($1,\'{"questions":[]}\')', [course.id]);
            await pool.query('INSERT INTO certificate(course_id,template) VALUES($1,$2)', [course.id, require('../src/certificate-template').starter]);
            await pool.query("UPDATE course SET state='published' WHERE id=$1", [course.id]);
            if (index === 2) await pool.query("UPDATE course SET state='archived' WHERE id=$1", [course.id]);
            courses.push(course.id);
        }
        let sequence = 0;
        async function participant(courseId = courses[0], present = true, email) {
            const n = ++sequence;
            const address = email || `result-${n}@example.com`;
            const name = `Participant ${n} <&> {{course_code}}`;
            const { rows: [submission] } = await pool.query(`INSERT INTO submission(reference,salutation,full_name,organisation,job_title,phone,email,consent_accepted,total)
                VALUES($1,'Ms',$2,'QA','QA','12345678',$3,true,$4) RETURNING id`, [`APP-RESULT-${n}`, name, address, courseId === courses[3] ? 0 : 10]);
            const entries = { s2: { recorded_at: iso(-14300000), attended: true } };
            if (present) entries.s1 = { recorded_at: iso(-7100000), attended: true };
            const { rows: [registration] } = await pool.query('INSERT INTO registration(submission_id,course_id,fee,attendance) VALUES($1,$2,$3,$4) RETURNING id', [submission.id, courseId, courseId === courses[3] ? 0 : 10, entries]);
            return { id: registration.id, submission_id: submission.id, email: address, name, course_id: courseId };
        }
        const present = await participant();
        const missing = await participant(courses[0], false);
        const failed = await participant();
        const uncertain = await participant();
        const rollback = await participant();
        const lostOutcome = await participant();
        const reserved = await participant(courses[0], true, 'reserved@example.invalid');
        const cancelled = await participant();
        const cancelledSubmission = await participant();
        const future = await participant(courses[1]);
        const archived = await participant(courses[2]);
        const certificate = await participant();
        const free = await participant(courses[3]);
        await pool.query("UPDATE registration SET state='cancelled',cancelled_at=NOW(),cancelled_by=$2,cancellation_reason='QA' WHERE id=$1", [cancelled.id, admin.id]);
        await pool.query("UPDATE submission SET is_cancelled=true,cancelled_at=NOW(),cancelled_by=$2,cancellation_reason='QA' WHERE id=$1", [cancelledSubmission.submission_id, admin.id]);
        await require('../src/issued-certificate').issue(certificate.id, certificate.course_id, admin.id);
        await pool.query("INSERT INTO payment(submission_id,reference,amount,due_at,state) VALUES($1,'PAY-RESULT',10,NOW()+INTERVAL '1 day','pending')", [present.submission_id]);
        await pool.query("INSERT INTO email(course_id,event,subject,body) VALUES(NULL,'attendance.scanner','Preserve scanner','Preserve scanner'),(NULL,'application.acknowledgement','Preserve acknowledgement','Preserve acknowledgement')");
        assert.equal(await results.installTemplate(), 1);
        assert.equal(await results.installTemplate(), 0);

        smtp = net.createServer(socket => {
            sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
            socket.write('220 result-test ESMTP\r\n');
            let buffer = ''; let reading = false; let content = [];
            socket.on('data', chunk => {
                buffer += chunk.toString();
                while (buffer.includes('\r\n')) {
                    const position = buffer.indexOf('\r\n'); const line = buffer.slice(0, position); buffer = buffer.slice(position + 2);
                    if (reading) { if (line !== '.') { content.push(line); continue; } reading = false; received.push(content.join('\r\n')); content = []; socket.write('250 Accepted\r\n'); }
                    else if (/^EHLO|^HELO/.test(line)) socket.write('250-result-test\r\n250 8BITMIME\r\n');
                    else if (/^DATA/.test(line)) { reading = true; socket.write('354 End with dot\r\n'); }
                    else if (/^QUIT/.test(line)) socket.end('221 Goodbye\r\n');
                    else socket.write('250 OK\r\n');
                }
            });
        });
        smtp.listen(0, '127.0.0.1'); await new Promise(resolve => smtp.once('listening', resolve));
        const localMail = nodemailer.createTransport({ host: '127.0.0.1', port: smtp.address().port, secure: false, ignoreTLS: true, disableFileAccess: true, disableUrlAccess: true });
        mail.sendMessage = async function controlled(message) {
            messages.push(message);
            if (mode === 'failed') throw Object.assign(new Error('Private authentication diagnostic'), { code: 'EAUTH' });
            if (mode === 'uncertain') throw Object.assign(new Error('Private interrupted exchange'), { code: 'ETIMEDOUT' });
            if (mode === 'local') return localMail.sendMail({ ...message, from: 'result-test@example.com' });
            if (message.to === present.email) {
                const client = await pool.connect();
                try { await client.query('BEGIN'); await client.query("SET LOCAL lock_timeout='100ms'"); await client.query('SELECT id FROM submission WHERE id=$1 FOR UPDATE', [present.submission_id]); await client.query('ROLLBACK'); }
                finally { client.release(); }
            }
            return { accepted: [message.to], messageId: 'controlled-result' };
        };
        const express = require('express'); const app = express();
        app.use(require('../src/security').requireTrustedRequest); app.use(express.json());
        store = require('../src/session').sessionStore;
        app.use('/admin', (req, res, next) => { req.session = { adminId: req.get('X-QA-Admin') === 'yes' ? admin.id : undefined, expiresAt: Date.now() + 60000, destroy(done) { done(); } }; next(); }, require('../src/auth'), require('../src/admin'));
        server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
        const base = `http://127.0.0.1:${server.address().port}/admin`;
        const route = (course = courses[0], session = 's1') => `/courses/${course}/attendance/${session}`;
        async function call(url, method = 'GET', body, auth = true, headers = {}) {
            const response = await fetch(base + url, { method, headers: { Origin: process.env.APP_ORIGIN, 'X-Requested-With': 'reg-course', 'Content-Type': 'application/json', ...(auth ? { 'X-QA-Admin': 'yes' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
            return { status: response.status, data: response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text() };
        }
        async function request(row, confirm = false, session = 's1') {
            const data = (await call(route(row.course_id, session))).data;
            const found = data.participants.find(item => item.id === row.id);
            return { registration_id: row.id, original_entry: found.entry, previous_snapshot_id: found.result_mail.snapshot_id, confirm_changed: confirm };
        }
        const send = (row, body, auth = true, headers = {}) => call(route(row.course_id) + '/result-email', 'POST', body, auth, headers);
        assert.equal((await call(route(), 'GET', undefined, false)).status, 401);
        const initial = await request(present);
        assert.equal((await send(present, initial, false)).status, 401);
        assert.equal((await send(present, initial, true, { Origin: 'https://wrong.example.invalid' })).status, 403);
        assert.equal((await send(present, { ...initial, unexpected: true })).status, 400);
        assert.equal((await call(route() + '/result-email')).status, 404);
        assert.equal(messages.length, 0);
        for (const row of [reserved, cancelled, cancelledSubmission, future]) assert.equal((await send(row, await request(row))).status, 409);
        assert.equal((await call(route(courses[1]) + '/result-email', 'POST', initial)).status, 401);
        const boundary = (await attendance.courseSession(pool, courses[0], 's1'));
        assert.equal(results.available({ ...boundary.course, server_time: new Date(Date.parse(boundary.session.ends_at) - 1) }, boundary.session), false);
        assert.equal(results.available({ ...boundary.course, server_time: new Date(boundary.session.ends_at) }, boundary.session), true);
        const concurrent = await Promise.all([send(present, initial), send(present, initial)]);
        assert.ok(concurrent.every(item => item.status === 200)); assert.equal(messages.length, 1);
        assert.equal((await send(present, initial)).data.status, 'accepted'); assert.equal(messages.length, 1);
        const first = messages[0];
        assert.equal(first.to, present.email); assert.ok(first.text.includes(present.name)); assert.ok(first.text.includes('Attendance recorded'));
        assert.ok(first.html.includes('&lt;&amp;&gt;')); assert.ok(first.html.includes('{{course_code}}'));
        assert.equal(first.text.includes(missing.name), false); assert.equal(first.text.includes('#attendance/'), false); assert.equal(first.text.includes('#payment/'), false);
        mode = 'local'; assert.equal((await send(missing, await request(missing))).data.status, 'accepted');
        assert.equal(received.length, 1); assert.match(received[0], /To: result-2@example.com/);
        assert.ok(messages.at(-1).text.includes('No attendance recorded')); assert.equal(messages.at(-1).text.includes('Recorded time:'), false);
        mode = 'failed'; const unchanged = (await pool.query('SELECT attendance,certificate_data FROM registration WHERE id=$1', [failed.id])).rows[0];
        assert.equal((await send(failed, await request(failed))).data.status, 'failed');
        assert.deepEqual((await pool.query('SELECT attendance,certificate_data FROM registration WHERE id=$1', [failed.id])).rows[0], unchanged);
        const failedSnapshot = (await results.history(pool, courses[0], 's1', [failed.id])).get(failed.id);
        await pool.query("UPDATE submission SET full_name='Changed name',email='changed@example.com' WHERE id=$1", [failed.submission_id]);
        mode = 'accepted'; assert.equal((await send(failed, await request(failed))).data.status, 'accepted');
        assert.equal(messages.at(-1).to, failed.email); assert.ok(messages.at(-1).text.includes(failed.name));
        assert.equal((await results.history(pool, courses[0], 's1', [failed.id])).get(failed.id).id, failedSnapshot.id);
        mode = 'uncertain'; assert.equal((await send(uncertain, await request(uncertain))).data.status, 'uncertain');
        const count = messages.length; const uncertainEntry = (await request(uncertain)).original_entry;
        await attendance.correct(uncertain.id, courses[0], 's1', { original_entry: uncertainEntry, recorded_at: null, reason: 'QA correction' }, admin.id);
        assert.equal(messages.length, count); assert.equal((await send(uncertain, await request(uncertain, true))).data.status, 'uncertain'); assert.equal(messages.length, count);
        mode = 'accepted';
        const old = await request(present);
        await attendance.correct(present.id, courses[0], 's1', { original_entry: old.original_entry, recorded_at: null, reason: 'Correct missing scan' }, admin.id);
        assert.equal((await send(present, old)).data.code, 'result_conflict');
        assert.equal((await send(present, await request(present))).data.code, 'result_confirmation_required');
        const approved = await request(present, true);
        assert.equal((await send(present, approved)).data.status, 'accepted'); assert.ok(messages.at(-1).subject.startsWith('Updated attendance result'));
        const afterUpdate = messages.length; await send(present, approved); assert.equal(messages.length, afterUpdate);
        await attendance.correct(present.id, courses[0], 's1', { original_entry: null, recorded_at: old.original_entry.recorded_at, reason: 'Restore correct scan' }, admin.id);
        assert.equal((await send(present, await request(present, true))).data.status, 'accepted');
        assert.equal((await pool.query('SELECT attendance FROM registration WHERE id=$1', [present.id])).rows[0].attendance.s2.attended, true);
        assert.equal((await send(archived, await request(archived))).data.status, 'accepted');
        assert.equal((await send(free, await request(free))).data.status, 'accepted');
        const certificateBefore = (await pool.query('SELECT certificate_number,certificate_issued_at,md5(certificate_data::text) AS document_hash,attendance FROM registration WHERE id=$1', [certificate.id])).rows[0];
        mode = 'failed'; assert.equal((await send(certificate, await request(certificate))).data.status, 'failed');
        assert.deepEqual((await pool.query('SELECT certificate_number,certificate_issued_at,md5(certificate_data::text) AS document_hash,attendance FROM registration WHERE id=$1', [certificate.id])).rows[0], certificateBefore);
        mode = 'accepted';
        assert.equal((await send(certificate, await request(certificate))).data.status, 'accepted');
        await pool.query(`CREATE FUNCTION block_result_log() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='attendance.result.email.started' THEN RAISE EXCEPTION 'Private diagnostic'; END IF; RETURN NEW; END $$`);
        await pool.query('CREATE TRIGGER block_result_log BEFORE INSERT ON log FOR EACH ROW EXECUTE FUNCTION block_result_log()');
        const beforeRollback = messages.length;
        assert.equal((await send(rollback, await request(rollback))).status, 503); assert.equal(messages.length, beforeRollback);
        assert.equal((await results.history(pool, courses[0], 's1', [rollback.id])).size, 0);
        await pool.query('DROP TRIGGER block_result_log ON log');
        assert.equal((await send(rollback, await request(rollback))).data.status, 'accepted');
        await pool.query(`CREATE FUNCTION lose_result_outcome() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='attendance.result.email.accepted' THEN RAISE EXCEPTION 'Private diagnostic'; END IF; RETURN NEW; END $$`);
        await pool.query('CREATE TRIGGER lose_result_outcome BEFORE INSERT ON log FOR EACH ROW EXECUTE FUNCTION lose_result_outcome()');
        assert.equal((await send(lostOutcome, await request(lostOutcome))).data.status, 'uncertain');
        await pool.query('DROP TRIGGER lose_result_outcome ON log');
        const beforeResume = messages.length; await send(lostOutcome, await request(lostOutcome)); assert.equal(messages.length, beforeResume);
        const status = (await call(route())).data;
        assert.equal(status.participants.find(row => row.id === present.id).email_status, 'not_requested');
        assert.equal(status.participants.find(row => row.id === present.id).result_mail.status, 'accepted');
        assert.equal(status.participants.find(row => row.id === uncertain.id).result_mail.actionable, false);
        const activity = JSON.stringify((await call('/activity?group=email')).data);
        for (const privateValue of [present.email, present.name, 'snapshot', 'Private diagnostic', 'message_id']) assert.equal(activity.includes(privateValue), false);
        const outcomes = await pool.query("SELECT details FROM log WHERE event LIKE 'attendance.result.email.%' AND event<>'attendance.result.email.requested'");
        for (const row of outcomes.rows) for (const key of Object.keys(row.details)) assert.ok(['session_id', 'snapshot_id', 'attempt_id', 'status', 'message_id', 'code', 'command', 'responseCode'].includes(key));
        const text = {};
        for (const language of ['en', 'zh-Hant', 'zh-Hans']) {
            text[language] = (await import(`../../frontend/src/translations/${language}.js`)).default;
        }
        for (const language of ['en', 'zh-Hant', 'zh-Hans']) for (const value of Object.values(text[language]).flat()) assert.ok(typeof value === 'string' && value.trim());
        console.log('Verified result recipients, missing records, snapshots, A/B/A corrections, explicit updates, concurrent claims, local SMTP, failures, uncertainty, privacy and unchanged scanner states.');
    } finally {
        mail.sendMessage = originalSend;
        if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
        if (store) store.close();
        for (const socket of sockets) socket.destroy();
        if (smtp) await new Promise(resolve => smtp.close(resolve));
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await pool.end();
    }
});
