const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const nodemailer = require('nodemailer');
const pool = require('../src/db');
const acknowledgement = require('../src/acknowledgement');
const { mailFailure } = require('../src/mail');
const payments = require('../src/payment');
process.env.PAYMENT_LINK_SECRET = require('node:crypto').randomBytes(32).toString('base64url');

test('combined English acknowledgements, controlled SMTP outcomes and safe retries', async function mailTest() {
    const schema = `mail_test_${process.pid}_${Date.now()}`;
    assert.match(schema, /^mail_test_\d+_\d+$/);
    pool.options.options = `-c search_path=${schema},public`;
    let server;
    let mode = 'accept';
    const messages = [];
    const sockets = new Set();
    try {
        await pool.query(`CREATE SCHEMA "${schema}"`);
        await pool.query(fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8'));
        assert.equal(await acknowledgement.installTemplate(), 1);
        assert.equal(await acknowledgement.installTemplate(), 0);
        const { rows: [template] } = await pool.query('SELECT id,subject,body FROM email');
        await pool.query('UPDATE email SET body=$1,subject=$2 WHERE id=$3', [template.body.replace('\n\n{{payment_action}}', ''), 'Custom subject', template.id]);
        assert.equal(await acknowledgement.updatePaymentTemplate(), 1);
        assert.equal(await acknowledgement.updatePaymentTemplate(), 0);
        assert.equal((await pool.query('SELECT subject FROM email WHERE id=$1', [template.id])).rows[0].subject, 'Custom subject');
        await pool.query('UPDATE email SET body=$1 WHERE id=$2', ['Custom wording\n' + template.body.replace('\n\n{{payment_action}}', ''), template.id]);
        await assert.rejects(acknowledgement.updatePaymentTemplate());
        assert.match((await pool.query('SELECT body FROM email WHERE id=$1', [template.id])).rows[0].body, /^Custom wording/);
        await pool.query('UPDATE email SET body=$1,subject=$2 WHERE id=$3', [template.body, template.subject, template.id]);
        const sessions = [{ id: 's1', starts_at: '2027-01-01T10:00:00+08:00', ends_at: '2027-01-01T12:00:00+08:00', topic: { en: 'Session' }, mode: 'in_person' }];
        const courses = [];
        for (const [index, fee] of [100, 30].entries()) {
            const { rows: [course] } = await pool.query(`INSERT INTO course
                (code,title,short_description,long_description,mode,sessions,fee,registration_opens_at,registration_closes_at,payment_deadline,attendance_requirement_percent,state)
                VALUES ($1,$2,'{"en":"Short"}','{"en":"Long"}','in_person',$3,$4,NOW()-INTERVAL '1 day',NOW()+INTERVAL '1 day',NOW()+INTERVAL '7 days',100,'draft') RETURNING id,code,title,sessions,fee`,
                [`ACK-${index}`, { en: `Course ${index} <b>A & B</b>` }, JSON.stringify(sessions), fee]);
            await pool.query('INSERT INTO question(course_id,definition) VALUES($1,\'{"questions":[]}\')', [course.id]);
            await pool.query("UPDATE course SET state='published' WHERE id=$1", [course.id]);
            courses.push(course);
        }
        async function create(reference) {
            const { rows: [submission] } = await pool.query(`INSERT INTO submission
                (reference,salutation,full_name,organisation,job_title,phone,email,consent_accepted,total)
                VALUES($1,'Ms',$2,'QA','Tester','12345678','sink@example.invalid',true,130) RETURNING *`, [reference, 'Ada <img src=x onerror=bad()> & "Test"']);
            for (const course of courses) await pool.query('INSERT INTO registration(submission_id,course_id,fee) VALUES($1,$2,$3)', [submission.id, course.id, course.fee]);
            await payments.createPending(pool, submission.id);
            await acknowledgement.request(pool, submission.id);
            return submission;
        }
        const first = await create('ACK-ENGLISH');
        const payment = await payments.forSubmission(pool, first.id, true);
        const rendered = acknowledgement.render(template, first, courses, payment);
        assert.equal(rendered.subject, 'Application acknowledgement — ACK-ENGLISH');
        assert.match(rendered.text, /HKD\s*130/);
        assert.match(rendered.text, /HKD\s*100/);
        assert.match(rendered.text, /HKD\s*30/);
        assert.match(rendered.text, /Jan 2027, 10:00/);
        assert.match(rendered.text, /Hong Kong time/);
        assert.match(rendered.html, /lang="en"/);
        assert.match(rendered.html, /&lt;img/);
        assert.match(rendered.html, /&lt;b&gt;A &amp; B&lt;\/b&gt;/);
        assert.doesNotMatch(rendered.html, /<img|<script|<button/i);
        assert.ok(rendered.text.includes(payment.access_url));
        assert.ok(rendered.html.includes(`href="${payment.access_url}"`));
        assert.match(rendered.text, /payment link expires at this deadline/);
        assert.doesNotMatch(rendered.text, /not available yet|no payment deadline has been assigned/);
        assert.doesNotMatch(acknowledgement.render(template, { ...first, total: '0' }, courses, payment).html, /href=/);
        assert.match(acknowledgement.render(template, first, courses).text, /not available for this application/);
        const paidExpired = acknowledgement.render(template, first, courses, { ...payment, state: 'paid', access_url: null });
        assert.match(paidExpired.text, /payment link has expired/);
        assert.doesNotMatch(paidExpired.text, /link below/);
        assert.throws(function unsafeLink() { acknowledgement.render(template, first, courses, { ...payment, access_url: 'javascript:alert(1)' }); }, { code: 'MAIL_TEMPLATE' });
        assert.match(acknowledgement.render(template, { ...first, total: '0' }, courses).text, /No payment is required/);
        assert.throws(function unknownPlaceholder() { acknowledgement.render({ ...template, body: '{{unknown}}' }, first, courses); }, { code: 'MAIL_TEMPLATE' });

        server = net.createServer(function connected(socket) {
            sockets.add(socket);
            socket.on('close', function closed() { sockets.delete(socket); });
            socket.write('220 local-test ESMTP\r\n');
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
                        messages.push(data.join('\n'));
                        data = [];
                        if (mode === 'disconnect') socket.destroy();
                        else socket.write(mode === 'reject' ? '550 Message rejected\r\n' : '250 Message accepted\r\n');
                    } else if (/^EHLO|^HELO/.test(line)) socket.write('250-local-test\r\n250 8BITMIME\r\n');
                    else if (/^DATA/.test(line)) { dataMode = true; socket.write('354 End with dot\r\n'); }
                    else if (/^QUIT/.test(line)) socket.end('221 Goodbye\r\n');
                    else socket.write('250 OK\r\n');
                }
            });
            socket.on('error', function ignored() {});
        });
        server.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        const transport = nodemailer.createTransport({ host: '127.0.0.1', port: server.address().port,
            secure: false, ignoreTLS: true, connectionTimeout: 1000, greetingTimeout: 1000, socketTimeout: 2000 });
        const sendMessage = message => transport.sendMail({ from: 'sender@example.invalid', ...message });

        await Promise.all([acknowledgement.send(first.id, { sendMessage }), acknowledgement.send(first.id, { sendMessage })]);
        assert.equal(messages.length, 1);
        assert.equal((await acknowledgement.status(pool, first.id)).status, 'accepted');
        assert.equal((await acknowledgement.send(first.id, { retry: true, sendMessage })).status, 'accepted');
        assert.equal(messages.length, 1);

        const rejected = await create('ACK-REJECTED');
        mode = 'reject';
        assert.equal((await acknowledgement.send(rejected.id, { sendMessage })).status, 'failed');
        assert.equal((await pool.query('SELECT COUNT(*)::int n FROM registration WHERE submission_id=$1', [rejected.id])).rows[0].n, 2);
        mode = 'accept';
        await Promise.all([acknowledgement.send(rejected.id, { retry: true, sendMessage }), acknowledgement.send(rejected.id, { retry: true, sendMessage })]);
        assert.equal(messages.length, 3);
        assert.equal((await acknowledgement.status(pool, rejected.id)).status, 'accepted');

        const uncertain = await create('ACK-UNCERTAIN');
        mode = 'disconnect';
        assert.equal((await acknowledgement.send(uncertain.id, { sendMessage })).status, 'uncertain');
        await acknowledgement.send(uncertain.id, { retry: true, sendMessage });
        assert.equal(messages.length, 4);

        const authentication = await create('ACK-AUTH');
        const privateDiagnostic = 'SECRET-AUTH-DIAGNOSTIC-DO-NOT-LOG';
        const failed = await acknowledgement.send(authentication.id, { sendMessage: async function fail() {
            throw Object.assign(new Error(privateDiagnostic), { code: 'EAUTH', command: 'AUTH LOGIN', responseCode: 535 });
        } });
        assert.equal(failed.status, 'failed');
        const logs = await pool.query('SELECT details FROM log');
        assert.equal(JSON.stringify(logs.rows).includes(privateDiagnostic), false);
        assert.equal(JSON.stringify(logs.rows).includes('Dear Ada'), false);
        assert.equal(JSON.stringify(logs.rows).includes(payment.access_url.split('/#payment/')[1]), false);
        assert.equal(mailFailure({ code: 'ETIMEDOUT', command: 'DATA' }).status, 'uncertain');

        const unlogged = await create('ACK-LOG-FAILURE');
        await pool.query(`CREATE FUNCTION fail_outcome() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
            IF NEW.event='acknowledgement.accepted' THEN RAISE EXCEPTION 'QA outcome failure'; END IF; RETURN NEW; END $$`);
        await pool.query('CREATE TRIGGER fail_outcome BEFORE INSERT ON log FOR EACH ROW EXECUTE FUNCTION fail_outcome()');
        mode = 'accept';
        assert.equal((await acknowledgement.send(unlogged.id, { sendMessage })).status, 'uncertain');
        assert.equal((await acknowledgement.status(pool, unlogged.id)).status, 'uncertain');
        await acknowledgement.send(unlogged.id, { retry: true, sendMessage });
        assert.equal(messages.length, 5);
        await pool.query('DROP TRIGGER fail_outcome ON log');
        assert.equal((await pool.query("SELECT COUNT(*)::int n FROM payment WHERE state='pending'")).rows[0].n, 5);
        console.log('Verified: English combined content, dates/fees, HTML escaping, controlled SMTP acceptance/rejection/disconnect, safe logging, concurrent send protection, manual retry and uncertain-outcome protection.');
    } finally {
        for (const socket of sockets) socket.destroy();
        if (server) await new Promise(resolve => server.close(resolve));
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await pool.end();
    }
});
