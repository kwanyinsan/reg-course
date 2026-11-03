const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/db');
const { starter, validateTemplate, lockReason } = require('../src/certificate-template');
const pdf = require('../src/certificate-pdf');

test('English certificate validation, single-pass values and fixed PDF bounds', async function rendering() {
    assert.equal(validateTemplate(starter), null);
    assert.equal(validateTemplate({ ...starter, heading: { en: 'Certificate', 'zh-Hant': '證書' } }).code, 'english_only');
    assert.equal(validateTemplate({ ...starter, footer: { en: ' ' } }).code, 'english_required');
    assert.equal(validateTemplate({ ...starter, body: { en: '{{unknown}}' } }).code, 'unknown_placeholder');
    assert.equal(validateTemplate({ ...starter, body: { en: '{{participant_name}' } }).code, 'unknown_placeholder');
    assert.equal(validateTemplate({ ...starter, extra: {} }).code, 'invalid_template');
    assert.equal(validateTemplate({ ...starter, body: { en: '\u0000' } }).code, 'invalid_text');
    assert.equal(lockReason({ state: 'draft', published_at: new Date() }), 'published');
    const course = { code: 'CR-QA', title: { en: 'Information management', 'zh-Hant': '不應出現在英文證書' } };
    const values = { ...pdf.previewValues, participant_name: '陳大文 & "Lee" <text> {{unknown}}' };
    const resolved = pdf.resolveCertificate(starter, course, values);
    assert.ok(resolved.body.includes(values.participant_name));
    assert.ok(resolved.body.includes(course.title.en));
    assert.equal(resolved.body.includes(course.title['zh-Hant']), false);
    const buffer = await pdf.renderCertificate(starter, course, values);
    assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
    pdf.checkLayout(starter, { ...course, title: { en: 'A practical introduction to information management and project records for small teams' } },
        { ...pdf.previewValues, participant_name: 'Alexandria Catherine Chan Lee Wong Maria Isabella Victoria Johnson' });
    assert.throws(() => pdf.checkLayout({ ...starter, heading: { en: 'Certificate\n'.repeat(9) } }, course), { code: 'content_overflow', field: 'heading' });
    assert.throws(() => pdf.checkLayout(starter, { ...course, title: { en: 'W'.repeat(1000) } }), { code: 'content_overflow', field: 'body' });
    assert.throws(() => pdf.checkLayout({ ...starter, body: { en: String.fromCodePoint(0x10ffff) } }, course), { code: 'unsupported_character', field: 'body' });
});

test('certificate authorisation, transactional saving, conflicts and publication locks', async function integration() {
    const schema = `certificate_test_${process.pid}_${Date.now()}`;
    assert.match(schema, /^certificate_test_\d+_\d+$/);
    pool.options.options = `-c search_path=${schema},public`;
    let server;
    let blocker;
    let store;
    let enteredSave;
    let sent = 0;
    try {
        await pool.query(`CREATE SCHEMA "${schema}"`);
        await pool.query(fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8'));
        const { rows: [admin] } = await pool.query("INSERT INTO admin(username,password_hash) VALUES('QA','unused-test-hash') RETURNING id");
        const sessions = [{ id: 's1', starts_at: '2027-01-01T10:00:00+08:00', ends_at: '2027-01-01T12:00:00+08:00', topic: { en: 'Workshop' }, mode: 'in_person' }];
        const ids = [];
        for (let index = 0; index < 5; index++) {
            const { rows: [course] } = await pool.query(`INSERT INTO course(code,title,short_description,long_description,mode,sessions,fee,payment_deadline,attendance_requirement_percent,state)
                VALUES($1,'{"en":"Information management"}','{"en":"Short"}','{"en":"Long"}','in_person',$2,0,NOW()+INTERVAL '7 days',100,'draft') RETURNING id`,
                [`CERT-${index}`, JSON.stringify(sessions)]);
            ids.push(course.id);
            await pool.query('INSERT INTO question(course_id,definition) VALUES($1,\'{"questions":[]}\')', [course.id]);
        }
        await pool.query('INSERT INTO certificate(course_id,template) VALUES($1,$2)', [ids[1], starter]);
        await pool.query("UPDATE course SET state='published' WHERE id=ANY($1::int[])", [[ids[1], ids[2]]]);
        await pool.query("UPDATE course SET state='archived' WHERE id=$1", [ids[1]]);
        require('../src/mail').sendMessage = async function forbiddenEmail() { sent++; throw new Error('Certificate operations must not email.'); };
        const express = require('express');
        const app = express();
        app.use(express.json({ limit: '96kb' }));
        app.use(require('../src/security').requireTrustedRequest);
        const requireAdmin = require('../src/auth');
        store = require('../src/session').sessionStore;
        app.use('/admin', function reviewSession(req, res, next) {
            req.session = { adminId: req.get('X-QA-Admin') === 'yes' ? admin.id : undefined, expiresAt: Date.now() + 60000,
                destroy(callback) { callback(); } };
            if (req.method === 'PUT' && enteredSave) { enteredSave(); enteredSave = null; }
            next();
        }, requireAdmin, require('../src/admin'));
        app.use(function error(error, req, res, next) { void next; res.status(error.status || 500).json({ code: 'request_failed' }); });
        server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        const base = `http://127.0.0.1:${server.address().port}/admin/courses/`;
        async function call(id, method = 'GET', body, authorised = true, headers = {}) {
            const response = await fetch(base + id + '/certificate' + (method === 'POST' ? '/preview' : ''), {
                method, headers: { Origin: process.env.APP_ORIGIN, 'Content-Type': 'application/json', 'X-Requested-With': 'reg-course',
                    ...(authorised ? { 'X-QA-Admin': 'yes' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
            });
            const isPdf = response.headers.get('Content-Type')?.startsWith('application/pdf');
            return { status: response.status, data: isPdf ? Buffer.from(await response.arrayBuffer()) : await response.json(), cache: response.headers.get('Cache-Control') };
        }
        for (const method of ['GET', 'PUT', 'POST']) assert.equal((await call(ids[0], method, method === 'GET' ? undefined : { template: starter, original_template: null }, false)).status, 401);
        const initial = await call(ids[0]);
        assert.equal(initial.data.editable, true);
        assert.equal(initial.data.certificate, null);
        assert.deepEqual(initial.data.starter_template, starter);
        assert.equal((await call('bad')).status, 400);
        assert.equal((await call(2147483647)).status, 404);
        const preview = await call(ids[0], 'POST', { template: starter });
        assert.equal(preview.status, 200);
        assert.equal(preview.data.subarray(0, 5).toString(), '%PDF-');
        assert.equal(preview.cache, 'no-store');
        assert.equal((await pool.query('SELECT COUNT(*)::int n FROM certificate WHERE course_id=$1', [ids[0]])).rows[0].n, 0);
        assert.equal((await pool.query('SELECT COUNT(*)::int n FROM log')).rows[0].n, 0);
        assert.equal((await call(ids[0], 'POST', { template: starter, language: 'zh-Hant' })).status, 400);
        assert.equal((await call(ids[0], 'PUT', { template: starter, original_template: null }, true, { Origin: 'https://wrong.example.invalid' })).status, 403);
        const saved = await call(ids[0], 'PUT', { template: starter, original_template: null });
        assert.equal(saved.status, 200);
        assert.deepEqual((await call(ids[0])).data.certificate.template, starter);
        assert.equal((await call(ids[0], 'PUT', { template: starter, original_template: null })).status, 200);
        assert.equal((await pool.query('SELECT COUNT(*)::int n FROM log')).rows[0].n, 1);
        const changed = { ...starter, heading: { en: 'Certificate wording review' } };
        assert.equal((await call(ids[0], 'PUT', { template: changed, original_template: starter })).status, 200);
        assert.equal((await call(ids[0], 'PUT', { template: { ...starter, heading: { en: 'Stale tab' } }, original_template: starter })).data.code, 'template_conflict');
        const concurrent = await Promise.all(['First editor', 'Second editor'].map(en => call(ids[0], 'PUT', { template: { ...changed, heading: { en } }, original_template: changed })));
        assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 409]);
        const current = (await call(ids[0])).data.certificate.template;
        const tooTall = { ...starter, heading: { en: 'Line\n'.repeat(14) } };
        assert.equal((await call(ids[0], 'PUT', { template: tooTall, original_template: current })).data.code, 'content_overflow');
        assert.deepEqual((await call(ids[0])).data.certificate.template, current);
        await pool.query(`CREATE FUNCTION fail_certificate_log() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
            IF NEW.event='course.certificate_template_saved' THEN RAISE EXCEPTION 'Private test diagnostic'; END IF; RETURN NEW; END $$`);
        await pool.query('CREATE TRIGGER fail_certificate_log BEFORE INSERT ON log FOR EACH ROW EXECUTE FUNCTION fail_certificate_log()');
        assert.equal((await call(ids[0], 'PUT', { template: changed, original_template: current })).status, 500);
        assert.deepEqual((await call(ids[0])).data.certificate.template, current);
        assert.equal((await call(ids[3], 'PUT', { template: starter, original_template: null })).status, 500);
        assert.equal((await call(ids[3])).data.certificate, null, 'First insert must roll back when its log fails');
        await pool.query('DROP TRIGGER fail_certificate_log ON log');
        for (const id of [ids[1], ids[2]]) {
            assert.equal((await call(id)).data.editable, false);
            assert.equal((await call(id, 'PUT', { template: starter, original_template: id === ids[1] ? starter : null })).data.code, 'template_locked');
        }
        assert.equal((await call(ids[1], 'POST', { template: starter })).status, 200);
        assert.equal((await call(ids[1], 'POST', { template: changed })).status, 409);
        assert.equal((await call(ids[2], 'POST', { template: starter })).status, 409);
        await assert.rejects(pool.query('INSERT INTO certificate(course_id,template) VALUES($1,$2)', [ids[2], starter]), { code: '23514' });
        await assert.rejects(pool.query('UPDATE certificate SET template=$1 WHERE course_id=$2', [changed, ids[1]]), { code: '23514' });
        blocker = await pool.connect();
        await blocker.query('BEGIN');
        await blocker.query("UPDATE course SET state='published' WHERE id=$1", [ids[4]]);
        const entered = new Promise(resolve => { enteredSave = resolve; });
        const racingSave = call(ids[4], 'PUT', { template: starter, original_template: null });
        await entered;
        let waiting = false;
        for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
            const state = await pool.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting', [blocker.processID]);
            waiting = state.rows[0].waiting;
            if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(waiting, true, 'Save must actually wait for the concurrent publication lock');
        await blocker.query('COMMIT'); blocker.release(); blocker = null;
        assert.equal((await racingSave).data.code, 'template_locked');
        assert.equal((await call(ids[4])).data.certificate, null);
        const overflow = await call(ids[0], 'POST', { template: { ...starter, heading: { en: 'Line\n'.repeat(14) } } });
        assert.equal(overflow.status, 422);
        assert.equal(overflow.data.field, 'heading');
        assert.equal((await pool.query('SELECT COUNT(*)::int n FROM registration WHERE certificate_number IS NOT NULL')).rows[0].n, 0);
        assert.equal(sent, 0);
        const logs = (await pool.query('SELECT event,admin_id,course_id,details FROM log')).rows;
        assert.ok(logs.every(row => row.admin_id === admin.id && row.course_id === ids[0] && row.details.certificate_id));
        assert.doesNotMatch(JSON.stringify(logs), /Private test diagnostic|Preview Participant|participant_name|Course code:/);
        const workspace = await (await fetch(base + ids[0], { headers: { 'X-QA-Admin': 'yes' } })).json();
        assert.equal(workspace.course.certificate_editable, true);
        const questions = await (await fetch(base + ids[0] + '/questions', { headers: { 'X-QA-Admin': 'yes' } })).json();
        assert.equal(questions.editable, true);
        assert.deepEqual(questions.question.definition, { questions: [] });
        console.log('Verified: admin access, English-only validation, PDF preview without writes/email, initial save, stale and concurrent saves, atomic logs, publication races and locked history.');
    } finally {
        if (blocker) { await blocker.query('ROLLBACK'); blocker.release(); }
        if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
        if (store) store.close();
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await pool.end();
    }
});

test('certificate draft comparison ignores JSON key order and UI translations are complete', async function frontendHelpers() {
    const { pathToFileURL } = require('node:url');
    const helpers = await import(pathToFileURL(path.join(__dirname, '../../frontend/src/certificate-utils.js')));
    const { default: texts } = await import(pathToFileURL(path.join(__dirname, '../../frontend/src/certificate-text.js')));
    const reordered = { footer: starter.footer, body: starter.body, heading: starter.heading };
    assert.equal(helpers.certificateDraftDirty({ template: starter, originalTemplate: reordered }), false);
    assert.equal(helpers.certificateDraftDirty({ template: starter, originalTemplate: null, starter }), false);
    assert.equal(helpers.certificateDraftDirty({ template: null }), false);
    assert.equal(helpers.certificateDraftDirty({ template: { ...starter, heading: { en: 'Changed' } }, originalTemplate: starter }), true);
    for (const language of ['zh-Hant', 'zh-Hans']) assert.deepEqual(Object.keys(texts[language]).sort(), Object.keys(texts.en).sort());
});
