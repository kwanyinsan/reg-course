const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const nodemailer = require('nodemailer');
const pool = require('../src/db');
const issued = require('../src/issued-certificate');
const certificateMail = require('../src/certificate-mail');
const pdf = require('../src/certificate-pdf');
const { starter } = require('../src/certificate-template');

test('single-action certificate issuance, snapshots, protected access and safe email recovery', async function integration() {
    const schema = `issuance_test_${process.pid}_${Date.now()}`;
    assert.match(schema, /^issuance_test_\d+_\d+$/);
    pool.options.options = `-c search_path=${schema},public`;
    let server;
    let store;
    let blocker;
    let smtp;
    const smtpSockets = new Set();
    const smtpMessages = [];
    const messages = [];
    let mode = 'accepted';
    try {
        await pool.query(`CREATE SCHEMA "${schema}"`);
        await pool.query(fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8'));
        const { rows: [admin] } = await pool.query("INSERT INTO admin(username,password_hash) VALUES('Issuance QA','unused') RETURNING id");
        const now = Date.now();
        const iso = offset => new Date(now + offset).toISOString();
        const sessions = [{ id: 's1', starts_at: iso(-14400000), ends_at: iso(-10800000), topic: { en: 'First' }, mode: 'in_person' },
            { id: 's2', starts_at: iso(-7200000), ends_at: iso(-3600000), topic: { en: 'Second' }, mode: 'in_person' }];
        const courseIds = [];
        for (let index = 0; index < 6; index++) {
            const chosen = index === 1 ? [sessions[0], { ...sessions[1], ends_at: iso(3600000) }] : sessions;
            const { rows: [course] } = await pool.query(`INSERT INTO course(code,title,short_description,long_description,mode,sessions,fee,payment_deadline,attendance_requirement_percent,state)
                VALUES($1,$2,'{"en":"Short"}','{"en":"Long"}','in_person',$3,$4,NOW()+INTERVAL '1 day',50,'draft') RETURNING id`,
                [`ISS-${index}`, { en: 'Workshop <&> {{participant_name}}' }, JSON.stringify(chosen), index === 5 ? 0 : 120]);
            courseIds.push(course.id);
            await pool.query('INSERT INTO question(course_id,definition) VALUES($1,\'{"questions":[]}\')', [course.id]);
            if (index !== 2) await pool.query('INSERT INTO certificate(course_id,template) VALUES($1,$2)', [course.id,
                index === 3 ? { ...starter, heading: { en: 'Certificate', 'zh-Hant': '不應簽發' } } : starter]);
            if (index !== 4) await pool.query("UPDATE course SET state='published' WHERE id=$1", [course.id]);
        }
        const ids = [];
        let sequence = 0;
        async function participant(courseId = courseIds[0], count = 1, email, name = '陳大文 & "Lee" <text> {{course_code}}') {
            const n = ++sequence;
            const { rows: [submission] } = await pool.query(`INSERT INTO submission(reference,salutation,full_name,organisation,job_title,phone,email,consent_accepted,total)
                VALUES($1,'Ms',$2,'QA','QA','12345678',$3,true,$4) RETURNING id`, [`ISS-APP-${n}`, name, email || `certificate-qa-${n}@example.com`, courseId === courseIds[5] ? 0 : 120]);
            const attendance = {};
            if (count > 0) attendance.s1 = { recorded_at: iso(-14300000), attended: true };
            if (count > 1) attendance.s2 = { recorded_at: iso(-7100000), attended: true };
            const { rows: [registration] } = await pool.query('INSERT INTO registration(submission_id,course_id,fee,attendance) VALUES($1,$2,$3,$4) RETURNING id',
                [submission.id, courseId, courseId === courseIds[5] ? 0 : 120, attendance]);
            ids.push(registration.id);
            return { id: registration.id, submission_id: submission.id };
        }
        const eligible = await participant();
        const absent = await participant(courseIds[0], 0);
        const cancelled = await participant();
        const failed = await participant();
        const uncertain = await participant();
        const outcomeFailure = await participant();
        const templateFailure = await participant();
        const pending = await participant();
        const expired = await participant();
        const free = await participant(courseIds[5]);
        const future = await participant(courseIds[1]);
        const missing = await participant(courseIds[2]);
        const invalid = await participant(courseIds[3]);
        const draft = await participant(courseIds[4]);
        const reserved = await participant(courseIds[0], 1, 'reserved@example.invalid');
        const multiple = await participant(courseIds[0], 1, 'one,two@example.com');
        const unsupported = await participant(courseIds[0], 1, undefined, String.fromCodePoint(0x10ffff));
        const overflow = await participant(courseIds[0], 1, undefined, 'W'.repeat(3000));
        for (const [row, state] of [[pending, 'pending'], [expired, 'expired']]) await pool.query("INSERT INTO payment(submission_id,reference,amount,due_at,state) VALUES($1,$2,120,NOW()+INTERVAL '1 day',$3)", [row.submission_id, `ISS-PAY-${state}`, state]);
        await pool.query("UPDATE submission SET is_cancelled=true,cancelled_at=NOW(),cancelled_by=$2,cancellation_reason='QA' WHERE id=$1", [cancelled.submission_id, admin.id]);
        await pool.query("INSERT INTO email(course_id,event,subject,body) VALUES(NULL,'application.acknowledgement','Preserve','Preserve acknowledgement'),(NULL,'attendance.scanner','Preserve','Preserve scanner')");
        assert.equal(await certificateMail.installTemplate(), 1);
        assert.equal(await certificateMail.installTemplate(), 0);
        smtp = net.createServer(function connected(socket) {
            smtpSockets.add(socket);
            socket.on('close', () => smtpSockets.delete(socket));
            socket.on('error', () => {});
            socket.write('220 certificate-test ESMTP\r\n');
            let buffer = '';
            let dataMode = false;
            let data = [];
            socket.on('data', function input(chunk) {
                buffer += chunk.toString();
                while (buffer.includes('\r\n')) {
                    const boundary = buffer.indexOf('\r\n');
                    const line = buffer.slice(0, boundary);
                    buffer = buffer.slice(boundary + 2);
                    if (dataMode) {
                        if (line !== '.') { data.push(line); continue; }
                        dataMode = false;
                        smtpMessages.push(data.join('\r\n'));
                        data = [];
                        socket.write('250 Message accepted\r\n');
                    } else if (/^EHLO|^HELO/.test(line)) socket.write('250-certificate-test\r\n250 8BITMIME\r\n');
                    else if (/^DATA/.test(line)) { dataMode = true; socket.write('354 End with dot\r\n'); }
                    else if (/^QUIT/.test(line)) socket.end('221 Goodbye\r\n');
                    else socket.write('250 OK\r\n');
                }
            });
        });
        smtp.listen(0, '127.0.0.1');
        await new Promise(resolve => smtp.once('listening', resolve));
        const transport = nodemailer.createTransport({ host: '127.0.0.1', port: smtp.address().port, secure: false, ignoreTLS: true,
            connectionTimeout: 1000, greetingTimeout: 1000, socketTimeout: 2000, disableFileAccess: true, disableUrlAccess: true });
        require('../src/mail').sendMessage = async function controlledMail(message) {
            const committed = await pool.query("SELECT certificate_number FROM registration WHERE certificate_data->>'recipient'=$1", [message.to]);
            assert.equal(committed.rowCount, 1, 'SMTP sees the committed issued record');
            assert.equal(message.attachments[0].content.subarray(0, 5).toString(), '%PDF-');
            messages.push(message);
            if (mode === 'failed') throw Object.assign(new Error('Private authentication diagnostic'), { code: 'EAUTH' });
            if (mode === 'uncertain') throw Object.assign(new Error('Private interrupted exchange'), { code: 'ETIMEDOUT' });
            return transport.sendMail({ from: 'certificate-test@example.invalid', ...message });
        };
        const express = require('express');
        const app = express();
        app.use(require('../src/security').requireTrustedRequest);
        app.use(express.json());
        store = require('../src/session').sessionStore;
        app.use('/admin', function session(req, res, next) {
            req.session = { adminId: req.get('X-QA-Admin') === 'yes' ? admin.id : undefined, expiresAt: Date.now() + 60000, destroy(callback) { callback(); } };
            next();
        }, require('../src/auth'), require('../src/admin'));
        server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        const base = `http://127.0.0.1:${server.address().port}/admin`;
        async function call(route, method = 'GET', body, authorised = true, extra = {}) {
            const response = await fetch(base + route, { method, headers: { Origin: process.env.APP_ORIGIN, 'Content-Type': 'application/json', 'X-Requested-With': 'reg-course',
                ...(authorised ? { 'X-QA-Admin': 'yes' } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
            const isPdf = response.headers.get('Content-Type')?.startsWith('application/pdf');
            return { status: response.status, data: isPdf ? Buffer.from(await response.arrayBuffer()) : await response.json(), cache: response.headers.get('Cache-Control') };
        }
        const listPath = courseId => `/courses/${courseId}/certificates`;
        const send = (row, courseId = courseIds[0], auth = true) => call(listPath(courseId) + '/send', 'POST', { registration_id: row.id }, auth);
        const download = (row, auth = true) => call(`/registrations/${row.id}/certificate/pdf`, 'GET', undefined, auth);
        assert.equal((await call(listPath(courseIds[0]), 'GET', undefined, false)).status, 401);
        assert.equal((await send(eligible, courseIds[0], false)).status, 401);
        assert.equal((await download(eligible, false)).status, 401);
        assert.equal((await call(listPath(courseIds[0]) + '/send', 'POST', { registration_id: eligible.id }, true, { Origin: 'https://wrong.example.invalid' })).status, 403);
        assert.equal((await call('/courses/bad/certificates')).status, 400);
        const initial = await call(listPath(courseIds[0]));
        assert.equal(initial.data.participants.find(row => row.id === eligible.id).actionable, true);
        assert.equal(JSON.stringify(initial.data).includes('pdf_base64'), false);
        for (const [row, course, reason] of [[absent, courseIds[0], 'certificate_attendance_low'], [cancelled, courseIds[0], 'certificate_cancelled'],
            [future, courseIds[1], 'certificate_course_unfinished'], [missing, courseIds[2], 'certificate_template_missing'], [invalid, courseIds[3], 'certificate_template_invalid'],
            [draft, courseIds[4], 'certificate_course_unavailable'], [reserved, courseIds[0], 'certificate_recipient_excluded'], [multiple, courseIds[0], 'certificate_recipient_excluded'],
            [unsupported, courseIds[0], 'unsupported_character'], [overflow, courseIds[0], 'content_overflow']]) {
            const result = await send(row, course);
            assert.equal(result.status, 409);
            assert.ok(result.data.reasons.includes(reason), reason);
        }
        assert.equal(messages.length, 0);
        assert.equal((await send(eligible, courseIds[5])).status, 404);
        await pool.query(`CREATE FUNCTION fail_issuance_log() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
            IF NEW.event='certificate.issued' THEN RAISE EXCEPTION 'Private log diagnostic'; END IF; RETURN NEW; END $$`);
        await pool.query('CREATE TRIGGER fail_issuance_log BEFORE INSERT ON log FOR EACH ROW EXECUTE FUNCTION fail_issuance_log()');
        assert.equal((await send(eligible)).status, 503);
        assert.equal((await pool.query('SELECT certificate_number FROM registration WHERE id=$1', [eligible.id])).rows[0].certificate_number, null);
        assert.equal(messages.length, 0);
        await pool.query('DROP TRIGGER fail_issuance_log ON log');
        const render = pdf.renderCertificate;
        pdf.renderCertificate = async function renderingFailure() { throw new Error('Private render diagnostic'); };
        try { assert.equal((await send(eligible)).status, 503); } finally { pdf.renderCertificate = render; }
        assert.equal((await pool.query('SELECT certificate_number FROM registration WHERE id=$1', [eligible.id])).rows[0].certificate_number, null);
        blocker = await pool.connect();
        await blocker.query('BEGIN');
        await blocker.query('SELECT id FROM submission WHERE id=$1 FOR UPDATE', [eligible.submission_id]);
        const concurrent = [send(eligible), send(eligible)];
        await blocker.query('COMMIT'); blocker.release(); blocker = null;
        const issuedResults = await Promise.all(concurrent);
        assert.deepEqual(issuedResults.map(result => result.data.created).sort(), [false, true]);
        assert.equal(messages.length, 1);
        const saved = (await issued.rows(pool, 'r.id=$1', [eligible.id]))[0];
        const originalPdf = issued.document(saved).buffer;
        assert.equal(saved.certificate_number, `CERT-${new Intl.DateTimeFormat('en', { timeZone: 'Asia/Hong_Kong', year: 'numeric' }).format(saved.certificate_issued_at)}-${String(eligible.id).padStart(6, '0')}`);
        assert.deepEqual(messages[0].attachments[0].content, originalPdf);
        const mimePdf = smtpMessages[0].slice(smtpMessages[0].indexOf('Content-Type: application/pdf')).split('\r\n\r\n')[1].split('\r\n--')[0];
        assert.deepEqual(Buffer.from(mimePdf.replace(/\s/g, ''), 'base64'), originalPdf);
        assert.ok(messages[0].text.includes('Thank you for attending'));
        assert.ok(messages[0].html.includes('陳大文 &amp; &quot;Lee&quot; &lt;text&gt; {{course_code}}'));
        assert.ok(messages[0].html.includes('Workshop &lt;&amp;&gt; {{participant_name}}'));
        if (process.env.CERTIFICATE_TEST_PDF) fs.writeFileSync(process.env.CERTIFICATE_TEST_PDF, originalPdf);
        const file = await download(eligible);
        assert.equal(file.status, 200); assert.equal(file.cache, 'no-store'); assert.deepEqual(file.data, originalPdf);
        assert.equal((await download(eligible, false)).status, 401);
        assert.equal((await call(`/registrations/${eligible.id}/certificate`)).data.certificate.number, saved.certificate_number);
        assert.equal(JSON.stringify((await call(listPath(courseIds[0]))).data).includes(saved.certificate_data.pdf_base64), false);
        await pool.query('UPDATE submission SET full_name=$2,email=$3 WHERE id=$1', [eligible.submission_id, 'Changed live name', 'changed-recipient@example.com']);
        await pool.query('UPDATE course SET title=$2 WHERE id=$1', [courseIds[0], { en: 'Changed live course title' }]);
        assert.deepEqual((await download(eligible)).data, originalPdf);
        assert.equal((await send(eligible)).data.email.status, 'accepted'); assert.equal(messages.length, 1);
        mode = 'failed';
        const firstFailure = await send(failed);
        assert.equal(firstFailure.data.created, true); assert.equal(firstFailure.data.email.status, 'failed');
        const failedPdf = (await download(failed)).data;
        const failedSnapshot = (await issued.rows(pool, 'r.id=$1', [failed.id]))[0].certificate_data;
        await pool.query('UPDATE submission SET full_name=$2,email=$3 WHERE id=$1', [failed.submission_id, 'Changed after failure', 'changed-after-failure@example.com']);
        mode = 'accepted';
        const retry = await send(failed);
        assert.equal(retry.data.created, false); assert.equal(retry.data.email.status, 'accepted');
        assert.equal(messages.at(-1).to, failedSnapshot.recipient); assert.deepEqual(messages.at(-1).attachments[0].content, failedPdf);
        assert.equal(retry.data.certificate.number, firstFailure.data.certificate.number);
        assert.equal(retry.data.certificate.issued_at, firstFailure.data.certificate.issued_at);
        mode = 'uncertain';
        assert.equal((await send(uncertain)).data.email.status, 'uncertain');
        const uncertainCount = messages.length;
        assert.equal((await send(uncertain)).data.email.status, 'uncertain'); assert.equal(messages.length, uncertainCount);
        mode = 'accepted';
        await pool.query(`CREATE FUNCTION fail_certificate_outcome() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
            IF NEW.event='certificate.email.accepted' THEN RAISE EXCEPTION 'Private outcome diagnostic'; END IF; RETURN NEW; END $$`);
        await pool.query('CREATE TRIGGER fail_certificate_outcome BEFORE INSERT ON log FOR EACH ROW EXECUTE FUNCTION fail_certificate_outcome()');
        assert.equal((await send(outcomeFailure)).data.email.status, 'uncertain');
        const outcomeCount = messages.length;
        await pool.query('DROP TRIGGER fail_certificate_outcome ON log');
        assert.equal((await send(outcomeFailure)).data.email.status, 'uncertain'); assert.equal(messages.length, outcomeCount);
        await pool.query("UPDATE email SET event='certificate.held' WHERE event='certificate.issued'");
        assert.equal((await send(templateFailure)).data.email.status, 'failed');
        assert.equal((await download(templateFailure)).status, 200);
        await certificateMail.installTemplate();
        assert.equal((await send(templateFailure)).data.email.status, 'accepted');
        for (const [row, course] of [[pending, courseIds[0]], [expired, courseIds[0]], [free, courseIds[5]]]) assert.equal((await send(row, course)).data.created, true);
        await pool.query("UPDATE course SET state='archived' WHERE id=$1", [courseIds[5]]);
        const archived = await participant(courseIds[5]);
        assert.equal((await send(archived, courseIds[5])).data.created, true);
        await assert.rejects(pool.query('UPDATE registration SET certificate_data=$2 WHERE id=$1', [eligible.id, {}]), { code: '23514' });
        await assert.rejects(pool.query('UPDATE registration SET certificate_number=NULL,certificate_issued_at=NULL,certificate_data=NULL WHERE id=$1', [eligible.id]), { code: '23514' });
        await assert.rejects(pool.query('DELETE FROM registration WHERE id=$1', [eligible.id]), { code: '23514' });
        assert.equal((await call(`/registrations/${eligible.id}/attendance/s1`, 'PUT', { recorded_at: null, original_entry: saved.attendance.s1, reason: 'Must remain locked.' })).data.code, 'attendance_certificate_locked');
        await assert.rejects(pool.query('UPDATE certificate SET template=$2 WHERE course_id=$1', [courseIds[0], { ...starter, heading: { en: 'Changed' } }]), { code: '23514' });
        const corrupt = await participant();
        await pool.query("UPDATE registration SET certificate_number='CERT-2026-999999',certificate_issued_at=NOW(),certificate_data='{}' WHERE id=$1", [corrupt.id]);
        assert.equal((await download(corrupt)).status, 503);
        assert.equal((await send(corrupt)).data.created, false);
        assert.equal((await call('/registrations')).status, 200);
        assert.equal((await call(`/courses/${courseIds[0]}`)).status, 200);
        const gateRow = (await issued.rows(pool, 'r.id=$1', [absent.id]))[0];
        const boundary = { ...gateRow, attendance: { s1: { attended: true } }, server_time: new Date(now), sessions: [
            { ...sessions[0], ends_at: iso(0) }, { ...sessions[1], ends_at: iso(0) }], attendance_requirement_percent: 50 };
        assert.equal(issued.eligibility(boundary).eligible, true);
        assert.equal(issued.eligibility({ ...boundary, server_time: new Date(now - 1) }).reasons.includes('certificate_course_unfinished'), true);
        const thirds = { ...boundary, sessions: [sessions[0], sessions[1], { ...sessions[1], id: 's3' }], attendance: { s1: { attended: true }, s2: { attended: true } }, attendance_requirement_percent: 66.67 };
        assert.equal(issued.eligibility(thirds).reasons.includes('certificate_attendance_low'), true);
        assert.equal(issued.eligibility({ ...thirds, attendance_requirement_percent: 66.66 }).eligible, true);
        const log = (await pool.query('SELECT event,registration_id,details FROM log')).rows;
        assert.equal(log.filter(row => row.event === 'certificate.issued' && row.registration_id === eligible.id).length, 1);
        const serialised = JSON.stringify(log);
        assert.equal(serialised.includes(saved.certificate_data.pdf_base64), false);
        assert.equal(serialised.includes(saved.certificate_data.recipient), false);
        assert.equal(serialised.includes('Private authentication'), false);
        assert.equal((await pool.query("SELECT body FROM email WHERE event='application.acknowledgement'")).rows[0].body, 'Preserve acknowledgement');
        assert.equal((await pool.query("SELECT body FROM email WHERE event='attendance.scanner'")).rows[0].body, 'Preserve scanner');
    } finally {
        if (blocker) { await blocker.query('ROLLBACK'); blocker.release(); }
        if (server) await new Promise(resolve => server.close(resolve));
        for (const socket of smtpSockets) socket.destroy();
        if (smtp) await new Promise(resolve => smtp.close(resolve));
        if (store) store.close();
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await pool.end();
    }
});

test('certificate sending has complete three-language website text', async function languageCoverage() {
    const text = (await import('../../frontend/src/certificate-send-text.js')).default;
    for (const language of ['zh-Hant', 'zh-Hans']) {
        assert.deepEqual(Object.keys(text[language]).sort(), Object.keys(text.en).sort());
        assert.ok(Object.values(text[language]).every(value => value.trim()));
    }
});
