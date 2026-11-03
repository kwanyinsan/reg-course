const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/db');
const access = require('../src/attendance-access');
const attendance = require('../src/attendance');
const attendanceMail = require('../src/attendance-mail');
const { updateAttendance } = require('../src/update-attendance');

process.env.ATTENDANCE_LINK_SECRET = crypto.randomBytes(32).toString('base64url');

test('attendance tokens require purpose, signature, expiry and exact bindings', function tokens() {
    const now = Date.now();
    const round = { id: 1, course_id: 2, session_id: 's1', closes_at: new Date(now + 600000) };
    const token = access.sign('attendance_student', round, 3, now);
    assert.equal(access.verify(token, 'attendance_student', now).registration_id, 3);
    assert.throws(() => access.verify(token, 'attendance_qr', now), { code: 'attendance_link_invalid' });
    assert.throws(() => access.verify(token, 'attendance_student', now + 600000), { code: 'attendance_link_expired' });
    const [payload, signature] = token.split('.');
    assert.throws(() => access.verify(payload + '.' + (signature[0] === 'a' ? 'b' : 'a') + signature.slice(1), 'attendance_student'), { code: 'attendance_link_invalid' });
    const altered = Buffer.from(JSON.stringify({ ...access.verify(token, 'attendance_student'), registration_id: 4 })).toString('base64url');
    assert.throws(() => access.verify(altered + '.' + signature, 'attendance_student'), { code: 'attendance_link_invalid' });
    assert.throws(() => access.verify(access.sign('payment', round, 3), 'attendance_student'), { code: 'attendance_link_invalid' });
    assert.equal(attendance.validEntry({ recorded_at: new Date(now).toISOString(), attended: true }), true);
    assert.equal(attendance.validEntry({ recorded_at: new Date(now).toISOString(), attended: false }), false);
});

test('single-scan migration, guarded attendance, corrections, SMTP outcomes and compatibility', async function integration() {
    const schema = `attendance_test_${process.pid}_${Date.now()}`;
    assert.match(schema, /^attendance_test_\d+_\d+$/);
    pool.options.options = `-c search_path=${schema},public`;
    let server;
    let store;
    let blocker;
    const messages = [];
    let mailMode = 'accepted';
    try {
        await pool.query(`CREATE SCHEMA "${schema}"`);
        const source = fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8');
        const currentLoop = source.match(/    FOR attendance_entry IN SELECT \* FROM jsonb_each\(NEW.attendance\) LOOP[\s\S]*?    END LOOP;/)[0];
        const oldLoop = `    FOR attendance_entry IN SELECT * FROM jsonb_each(NEW.attendance) LOOP
        SELECT item INTO session FROM jsonb_array_elements(course_sessions) AS item WHERE item->>'id'=attendance_entry.key;
        IF NOT FOUND OR NOT attendance_entry.value ?& ARRAY['check_in_at','check_out_at','attended'] THEN
            RAISE EXCEPTION 'Invalid old attendance' USING ERRCODE='23514';
        END IF;
        IF (attendance_entry.value->>'attended')::boolean IS DISTINCT FROM COALESCE(
            (attendance_entry.value->>'check_in_at')::timestamptz <= (session->>'starts_at')::timestamptz AND
            (attendance_entry.value->>'check_out_at')::timestamptz >= (session->>'ends_at')::timestamptz,FALSE) THEN
            RAISE EXCEPTION 'Invalid old attendance result' USING ERRCODE='23514';
        END IF;
    END LOOP;`;
        await pool.query(source.replace(currentLoop, oldLoop));
        const { rows: [admin] } = await pool.query("INSERT INTO admin(username,password_hash) VALUES('attendance QA','unused') RETURNING id");
        const now = Date.now();
        const iso = offset => new Date(now + offset).toISOString();
        const sessions = [
            { id: 's2', starts_at: iso(-14400000), ends_at: iso(-7200000), topic: { en: 'Earlier session' }, mode: 'virtual' },
            { id: 's1', starts_at: iso(-60000), ends_at: iso(5400000), topic: { en: 'Current session <&>' }, mode: 'in_person' },
        ];
        const courses = [];
        for (let index = 0; index < 2; index++) {
            const chosen = index ? sessions.map(session => ({ ...session, mode: 'virtual' })) : sessions;
            const { rows: [course] } = await pool.query(`INSERT INTO course(code,title,short_description,long_description,mode,sessions,fee,payment_deadline,attendance_requirement_percent,state)
                VALUES($1,$2,'{"en":"Short"}','{"en":"Long"}',$3,$4,$5,NOW()+INTERVAL '1 day',50,'draft') RETURNING id`,
                [`ATT-${index}`, { en: 'Course <&> {{participant_name}}' }, index ? 'virtual' : 'hybrid', JSON.stringify(chosen), index ? 0 : 120]);
            courses.push(course.id);
            await pool.query('INSERT INTO question(course_id,definition) VALUES($1,\'{"questions":[]}\')', [course.id]);
            await pool.query("UPDATE course SET state='published' WHERE id=$1", [course.id]);
        }
        const registrations = [];
        for (let index = 0; index < 9; index++) {
            const free = index === 8;
            const { rows: [submission] } = await pool.query(`INSERT INTO submission(reference,salutation,full_name,organisation,job_title,phone,email,consent_accepted,total)
                VALUES($1,'Ms',$2,'QA','QA','12345678',$3,true,$4) RETURNING id`,
                [`ATT-APP-${index}`, index === 0 ? 'Name <b>& " {{course_code}}' : `Participant ${index}`, index === 7 ? 'reserved@example.invalid' : `attendance-qa-${index}@example.com`, free ? 0 : 120]);
            const { rows: [registration] } = await pool.query('INSERT INTO registration(submission_id,course_id,fee) VALUES($1,$2,$3) RETURNING id', [submission.id, courses[free ? 1 : 0], free ? 0 : 120]);
            registrations.push({ ...registration, submission_id: submission.id });
            if ([2, 3, 4].includes(index)) await pool.query(`INSERT INTO payment(submission_id,reference,amount,due_at,state,paid_at)
                VALUES($1,$2,120,NOW()+INTERVAL '1 day',$3,CASE WHEN $3='paid' THEN NOW() ELSE NULL END)`, [submission.id, `ATT-PAY-${index}`, { 2: 'pending', 3: 'paid', 4: 'expired' }[index]]);
        }
        const oldEntry = { check_in_at: iso(-14500000), check_out_at: iso(-7100000), attended: true };
        await pool.query('UPDATE registration SET attendance=$2 WHERE id=$1', [registrations[0].id, { s2: oldEntry }]);
        await pool.query('UPDATE registration SET attendance=$2 WHERE id=$1', [registrations[1].id, { s2: { check_in_at: null, check_out_at: null, attended: false } }]);
        await assert.rejects(updateAttendance(), /Unexpected attendance history/);
        await pool.query("UPDATE registration SET attendance='{}' WHERE id=$1", [registrations[1].id]);
        await pool.query(`CREATE FUNCTION fail_attendance_log() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
            IF NEW.event IN ('attendance.format_updated','attendance.recorded','attendance.corrected') THEN RAISE EXCEPTION 'Private diagnostic'; END IF; RETURN NEW; END $$`);
        await pool.query('CREATE TRIGGER fail_attendance_log BEFORE INSERT ON log FOR EACH ROW EXECUTE FUNCTION fail_attendance_log()');
        await assert.rejects(updateAttendance(), /Private diagnostic/);
        assert.deepEqual((await pool.query('SELECT attendance FROM registration WHERE id=$1', [registrations[0].id])).rows[0].attendance, { s2: oldEntry });
        await pool.query('DROP TRIGGER fail_attendance_log ON log');
        assert.equal(await updateAttendance(), 1);
        assert.equal(await updateAttendance(), 0);
        const savedEarlier = { recorded_at: oldEntry.check_in_at, attended: true };
        assert.deepEqual((await pool.query('SELECT attendance FROM registration WHERE id=$1', [registrations[0].id])).rows[0].attendance, { s2: savedEarlier });
        assert.equal((await pool.query("SELECT COUNT(*)::int n FROM log WHERE event='attendance.format_updated'")).rows[0].n, 1);
        await assert.rejects(pool.query('UPDATE registration SET attendance=$2 WHERE id=$1', [registrations[1].id, { s1: oldEntry }]), { code: '23514' });
        await assert.rejects(pool.query('UPDATE registration SET attendance=$2 WHERE id=$1', [registrations[1].id, { unknown: { recorded_at: iso(-1000), attended: true } }]), { code: '23514' });
        await assert.rejects(pool.query('UPDATE registration SET attendance=$2 WHERE id=$1', [registrations[1].id, { s1: { recorded_at: iso(100000), attended: true } }]), { code: '23514' });
        await assert.rejects(pool.query('UPDATE registration SET attendance=$2 WHERE id=$1', [registrations[1].id, { s1: { recorded_at: iso(-3600000), attended: true } }]), { code: '23514' });
        await pool.query("UPDATE registration SET state='cancelled',cancelled_at=NOW(),cancelled_by=$2,cancellation_reason='QA' WHERE id=$1", [registrations[5].id, admin.id]);
        await pool.query("UPDATE submission SET is_cancelled=true,cancelled_at=NOW(),cancelled_by=$2,cancellation_reason='QA' WHERE id=$1", [registrations[6].submission_id, admin.id]);
        await pool.query("INSERT INTO email(course_id,event,subject,body) VALUES(NULL,'application.acknowledgement','Preserve','Preserve acknowledgement')");
        assert.equal(await attendanceMail.installTemplate(), 1);
        assert.equal(await attendanceMail.installTemplate(), 0);
        require('../src/mail').sendMessage = async function controlledMail(message) {
            messages.push(message);
            if (mailMode === 'failed') throw Object.assign(new Error('Private authentication diagnostic'), { code: 'EAUTH' });
            if (mailMode === 'uncertain') throw Object.assign(new Error('Private socket diagnostic'), { code: 'ETIMEDOUT' });
            return { accepted: [message.to], messageId: 'controlled-message-id' };
        };
        const express = require('express');
        const app = express();
        app.use(require('../src/security').requireTrustedRequest);
        app.use(express.json());
        app.use('/attendance', attendance.router);
        store = require('../src/session').sessionStore;
        app.use('/admin', function session(req, res, next) {
            req.session = { adminId: req.get('X-QA-Admin') === 'yes' ? admin.id : undefined, expiresAt: Date.now() + 60000, destroy(callback) { callback(); } };
            next();
        }, require('../src/auth'), require('../src/admin'));
        app.use(function failed(error, req, res, next) { void next; res.status(error.status || 500).json({ code: 'request_failed' }); });
        server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        const base = `http://127.0.0.1:${server.address().port}`;
        async function call(route, method = 'GET', body, token, authorised = true, extra = {}) {
            const response = await fetch(base + route, { method, headers: { Origin: process.env.APP_ORIGIN, 'X-Requested-With': 'reg-course', 'Content-Type': 'application/json',
                ...(authorised ? { 'X-QA-Admin': 'yes' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
            return { status: response.status, data: await response.json() };
        }
        const route = `/admin/courses/${courses[0]}/attendance/s1`;
        for (const [suffix, method, body] of [['', 'GET'], ['/start', 'POST', {}], ['/qr', 'GET'], ['/email', 'POST', { registration_id: registrations[0].id, retry: false }]]) assert.equal((await call(route + suffix, method, body, undefined, false)).status, 401);
        assert.equal((await call(route + '/start', 'POST', {}, undefined, true, { Origin: 'https://wrong.example.invalid' })).status, 403);
        assert.equal((await call('/attendance')).status, 401);
        assert.equal((await call(`/admin/courses/${courses[0]}/attendance/s2/start`, 'POST', {})).data.code, 'attendance_start_window');
        const opened = await Promise.all([call(route + '/start', 'POST', {}), call(route + '/start', 'POST', {})]);
        assert.deepEqual(opened.map(result => result.data.repeated).sort(), [false, true]);
        const round = opened[0].data.round;
        assert.equal(round.registration_ids.includes(registrations[5].id), false);
        assert.equal(round.registration_ids.includes(registrations[6].id), false);
        assert.equal(messages.length, 0);
        const student = index => access.sign('attendance_student', round, registrations[index].id);
        const qr = () => access.sign('attendance_qr', round, null);
        assert.equal((await call(route + '/qr')).data.image.startsWith('data:image/png;base64,'), true);
        assert.equal((await call('/attendance', 'GET', undefined, student(0), false)).data.participant_name, 'Name <b>& " {{course_code}}');
        assert.equal((await call('/attendance', 'GET', undefined, student(0), false)).data.entry, null);
        const badQr = access.sign('attendance_qr', { ...round, course_id: courses[1] }, null);
        assert.equal((await call('/attendance/record', 'POST', { qr_token: badQr }, student(0), false)).data.code, 'attendance_wrong_session');
        assert.equal((await call('/attendance/record', 'POST', { qr_token: student(0) }, student(0), false)).status, 401);
        assert.equal((await call('/attendance/record', 'POST', { qr_token: qr(), registration_id: registrations[1].id }, student(0), false)).status, 400);
        await pool.query('CREATE TRIGGER fail_attendance_log BEFORE INSERT ON log FOR EACH ROW EXECUTE FUNCTION fail_attendance_log()');
        assert.equal((await call('/attendance/record', 'POST', { qr_token: qr() }, student(0), false)).status, 503);
        assert.equal((await call('/attendance', 'GET', undefined, student(0), false)).data.entry, null);
        await pool.query('DROP TRIGGER fail_attendance_log ON log');
        blocker = await pool.connect();
        await blocker.query('BEGIN');
        await blocker.query('SELECT id FROM submission WHERE id=$1 FOR UPDATE', [registrations[0].submission_id]);
        const pending = [call('/attendance/record', 'POST', { qr_token: qr() }, student(0), false), call('/attendance/record', 'POST', { qr_token: qr() }, student(0), false)];
        await blocker.query('COMMIT'); blocker.release(); blocker = null;
        const records = await Promise.all(pending);
        assert.deepEqual(records.map(result => result.data.repeated).sort(), [false, true]);
        assert.deepEqual(records[0].data.entry, records[1].data.entry);
        const recovery = await call('/attendance', 'GET', undefined, student(0), false);
        assert.deepEqual(recovery.data.entry, records[0].data.entry);
        const after = (await pool.query('SELECT attendance FROM registration WHERE id=$1', [registrations[0].id])).rows[0].attendance;
        assert.deepEqual(after.s2, savedEarlier);
        assert.equal((await pool.query("SELECT COUNT(*)::int n FROM log WHERE event='attendance.recorded'")).rows[0].n, 1);
        for (const index of [2, 3, 4]) assert.equal((await call('/attendance/record', 'POST', { qr_token: qr() }, student(index), false)).status, 200);
        assert.equal((await call('/attendance', 'GET', undefined, student(5), false)).status, 409);
        assert.equal((await call('/attendance', 'GET', undefined, student(6), false)).status, 409);
        const freeRoute = `/admin/courses/${courses[1]}/attendance/s1`;
        const freeRound = (await call(freeRoute + '/start', 'POST', {})).data.round;
        const freeStudent = access.sign('attendance_student', freeRound, registrations[8].id);
        assert.equal((await call('/attendance/record', 'POST', { qr_token: access.sign('attendance_qr', freeRound, null) }, freeStudent, false)).status, 200);
        assert.equal((await call(freeRoute)).data.participants[0].payment_state, 'not_required');
        const correctionRoute = `/admin/registrations/${registrations[1].id}/attendance/s1`;
        const correction = { recorded_at: iso(-30000), original_entry: null, reason: 'Teacher confirmed attendance after camera failure.' };
        assert.equal((await call(correctionRoute, 'PUT', correction, undefined, false)).status, 401);
        assert.equal((await call(correctionRoute, 'PUT', { ...correction, reason: ' ' })).status, 400);
        assert.equal((await call(correctionRoute, 'PUT', { ...correction, recorded_at: iso(60000) })).status, 400);
        assert.equal((await call(correctionRoute, 'PUT', { ...correction, recorded_at: '2026-02-31T10:00:00+08:00' })).status, 400);
        await pool.query('CREATE TRIGGER fail_attendance_log BEFORE INSERT ON log FOR EACH ROW EXECUTE FUNCTION fail_attendance_log()');
        assert.equal((await call(correctionRoute, 'PUT', correction)).status, 503);
        assert.equal((await call('/attendance', 'GET', undefined, student(1), false)).data.entry, null);
        await pool.query('DROP TRIGGER fail_attendance_log ON log');
        const corrected = await call(correctionRoute, 'PUT', correction);
        assert.equal(corrected.status, 200);
        assert.equal((await call(correctionRoute, 'PUT', { ...correction, recorded_at: iso(-20000) })).data.code, 'attendance_conflict');
        assert.equal((await call(correctionRoute, 'PUT', { recorded_at: null, original_entry: corrected.data.entry, reason: 'Wrong participant selected.' })).status, 200);
        const beforeMail = messages.length;
        const send = (index, retry = false) => call(route + '/email', 'POST', { registration_id: registrations[index].id, retry });
        const mailed = await Promise.all([send(0), send(0)]);
        assert.equal(mailed.some(result => result.data.status === 'accepted'), true);
        assert.equal(mailed.every(result => ['accepted', 'uncertain'].includes(result.data.status)), true);
        assert.equal(messages.length, beforeMail + 1);
        assert.ok(messages[0].html.includes('Name &lt;b&gt;&amp; &quot; {{course_code}}'));
        assert.ok(messages[0].html.includes('Course &lt;&amp;&gt; {{participant_name}}'));
        assert.equal(messages[0].html.includes('check-out'), false);
        const emailedToken = messages[0].text.match(/#attendance\/([A-Za-z0-9_.-]+)/)[1];
        assert.equal((await call('/attendance', 'GET', undefined, emailedToken, false)).status, 200);
        mailMode = 'failed';
        assert.equal((await send(1)).data.status, 'failed');
        const failedCount = messages.length;
        assert.equal((await send(1)).data.status, 'failed');
        assert.equal(messages.length, failedCount);
        mailMode = 'accepted';
        assert.equal((await send(1, true)).data.status, 'accepted');
        mailMode = 'uncertain';
        assert.equal((await send(2)).data.status, 'uncertain');
        const uncertainCount = messages.length;
        assert.equal((await send(2, true)).data.status, 'uncertain');
        assert.equal(messages.length, uncertainCount);
        mailMode = 'accepted';
        await pool.query(`CREATE FUNCTION fail_attendance_outcome() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
            IF NEW.event='attendance.email.accepted' THEN RAISE EXCEPTION 'Private outcome diagnostic'; END IF; RETURN NEW; END $$`);
        await pool.query('CREATE TRIGGER fail_attendance_outcome BEFORE INSERT ON log FOR EACH ROW EXECUTE FUNCTION fail_attendance_outcome()');
        assert.equal((await send(3)).data.status, 'uncertain');
        const outcomeCount = messages.length;
        assert.equal((await send(3, true)).data.status, 'uncertain');
        assert.equal(messages.length, outcomeCount);
        await pool.query('DROP TRIGGER fail_attendance_outcome ON log');
        assert.equal((await send(7)).data.code, 'attendance_email_excluded');
        assert.equal((await send(5)).status, 409);
        assert.equal((await call(route)).data.participants.find(row => row.id === registrations[0].id).percentage.percent, 100);
        assert.equal((await call(`/admin/courses/${courses[0]}`)).status, 200);
        assert.equal((await call(`/admin/courses/${courses[0]}/questions`)).status, 200);
        assert.equal((await call('/admin/registrations')).status, 200);
        assert.equal((await call(`/admin/registrations/${registrations[0].id}`)).status, 200);
        assert.equal((await pool.query("SELECT body FROM email WHERE event='application.acknowledgement'")).rows[0].body, 'Preserve acknowledgement');
        await pool.query("UPDATE registration SET certificate_number='QA-CERT',certificate_issued_at=NOW(),certificate_data='{}' WHERE id=$1", [registrations[4].id]);
        assert.equal((await call(`/admin/registrations/${registrations[4].id}/attendance/s1`, 'PUT', { ...correction, original_entry: records[0].data.entry })).data.code, 'attendance_certificate_locked');
        assert.equal((await call('/attendance', 'GET', undefined, student(4), false)).data.code, 'attendance_certificate_locked');
        await assert.rejects(pool.query('UPDATE payment SET amount=1 WHERE submission_id=$1', [registrations[3].submission_id]), { code: '23514' });
        const logs = JSON.stringify((await pool.query('SELECT event,details FROM log')).rows);
        assert.equal(logs.includes(student(0)), false);
        assert.equal(logs.includes(process.env.ATTENDANCE_LINK_SECRET), false);
        assert.equal(logs.includes('Private authentication diagnostic'), false);
        assert.equal(logs.includes('Name <b>'), false);
        const expiredStudent = access.sign('attendance_student', { ...round, closes_at: new Date(Date.now() - 1000) }, registrations[0].id);
        assert.equal((await call('/attendance', 'GET', undefined, expiredStudent, false)).status, 410);
        const wrongRound = access.sign('attendance_student', { ...round, id: round.id + 999 }, registrations[0].id);
        assert.equal((await call('/attendance', 'GET', undefined, wrongRound, false)).status, 401);
        const expiredQr = access.sign('attendance_qr', round, null, Date.now() - 100000);
        assert.equal((await call('/attendance/record', 'POST', { qr_token: expiredQr }, student(0), false)).status, 410);
        await pool.query("UPDATE course SET state='archived' WHERE id=$1", [courses[0]]);
        assert.equal((await call('/attendance', 'GET', undefined, student(0), false)).status, 409);
        assert.equal((await call(route + '/qr')).status, 410);
    } finally {
        if (blocker) { await blocker.query('ROLLBACK'); blocker.release(); }
        if (server) await new Promise(resolve => server.close(resolve));
        if (store) store.close();
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await pool.end();
    }
});

test('attendance website languages have matching keys and the active UI has no departure fields', async function languageCoverage() {
    const text = (await import('../../frontend/src/attendance-text.js')).default;
    for (const language of ['zh-Hant', 'zh-Hans']) {
        assert.deepEqual(Object.keys(text[language]).sort(), Object.keys(text.en).sort());
        assert.equal(Object.values(text[language]).every(value => typeof value === 'string' && value.trim()), true);
    }
    const ui = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/AdminRegistrationDetails.jsx'), 'utf8');
    assert.equal(/checkOut|checkIn|check_out_at|check_in_at/.test(ui), false);
});
