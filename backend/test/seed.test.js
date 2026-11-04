const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { spawnSync } = require('node:child_process');
const pool = require('../src/db');
const { seed, seedData } = require('../src/seed');

test('unified seed is transactional, repeatable and never sends email', async function integration() {
    const schema = `seed_test_${process.pid}_${Date.now()}`;
    pool.options.options = `-c search_path=${schema},public`;
    const mail = require('../src/mail');
    const originalSend = mail.sendMessage;
    let sent = 0;
    mail.sendMessage = async function forbiddenEmail() { sent++; throw new Error('Seeding must not send email.'); };
    const options = { username: 'Seed QA', password: 'Isolated seed password 123' };
    const tables = ['admin', 'course', 'question', 'certificate', 'email', 'submission', 'registration', 'payment', 'log'];
    async function count(table) { return (await pool.query(`SELECT count(*)::int AS total FROM ${table}`)).rows[0].total; }
    try {
        await pool.query(`CREATE SCHEMA "${schema}"`);
        await pool.query(fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8'));
        await pool.query(`CREATE FUNCTION reject_seed_log() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
            RAISE EXCEPTION 'Controlled seed log failure'; END; $$;
            CREATE TRIGGER reject_seed_log BEFORE INSERT ON log FOR EACH ROW EXECUTE FUNCTION reject_seed_log()`);
        await assert.rejects(seed(options));
        for (const table of tables) assert.equal(await count(table), 0, table);
        await pool.query('DROP TRIGGER reject_seed_log ON log');
        seedData.courses.find(course => course.code === 'CR-009').title.en = 'Configured draft title';
        seedData.questions.questions[0].label.en = 'Configured learning question';
        seedData.certificate.heading.en = 'Configured certificate';
        seedData.emailTemplates[0].subject = 'Configured acknowledgement subject';
        seedData.applications[0].organisation = 'Configured organisation';
        seedData.applications[0].registrations[0].answers.demo_learning_goal = 'Configured course answer';
        const initial = await seed(options);
        assert.equal(initial.admin, 1);
        assert.equal(initial.templates, 4);
        assert.equal(initial.courses.inserted, 10);
        assert.equal(initial.registrations.inserted, 6);
        for (const table of tables) assert.ok(await count(table) > 0, table);
        assert.equal(await count('course'), 10);
        assert.equal(await count('question'), 10);
        assert.equal(await count('certificate'), 10);
        assert.equal(await count('registration'), 9);
        assert.equal(await count('payment'), 6);
        assert.equal((await pool.query(`SELECT count(*)::int AS total FROM course c LEFT JOIN certificate k ON k.course_id=c.id
            WHERE c.published_at IS NOT NULL AND k.id IS NULL`)).rows[0].total, 0);
        assert.equal((await pool.query("SELECT title->>'en' AS value FROM course WHERE code='CR-009'")).rows[0].value, 'Configured draft title');
        assert.equal((await pool.query("SELECT definition->'questions'->0->'label'->>'en' AS value FROM question LIMIT 1")).rows[0].value, 'Configured learning question');
        assert.equal((await pool.query("SELECT template->'heading'->>'en' AS value FROM certificate LIMIT 1")).rows[0].value, 'Configured certificate');
        assert.equal((await pool.query("SELECT subject FROM email WHERE event='application.acknowledgement'")).rows[0].subject, 'Configured acknowledgement subject');
        assert.equal((await pool.query('SELECT organisation FROM submission WHERE reference=$1', [seedData.applications[0].reference])).rows[0].organisation, 'Configured organisation');
        assert.equal((await pool.query("SELECT answers->>'demo_learning_goal' AS value FROM registration r JOIN submission s ON s.id=r.submission_id JOIN course c ON c.id=r.course_id WHERE s.reference=$1 AND c.code='CR-001'", [seedData.applications[0].reference])).rows[0].value, 'Configured course answer');
        const beforeHash = (await pool.query("SELECT password_hash FROM admin WHERE username='Seed QA'")).rows[0].password_hash;
        assert.equal(await bcrypt.compare(options.password, beforeHash), true);
        await pool.query("UPDATE course SET title='{\"en\":\"My edited draft\"}' WHERE code='CR-009'");
        await pool.query("UPDATE email SET subject='Existing custom subject' WHERE event='application.acknowledgement'");
        const beforePayments = (await pool.query('SELECT * FROM payment ORDER BY id')).rows;
        const beforeLogs = await count('log');
        const repeated = await seed({ ...options, password: 'Another unused password 456' });
        assert.equal(repeated.admin, 0);
        assert.equal(repeated.templates, 0);
        assert.equal(repeated.courses.inserted, 0);
        assert.equal(repeated.courses.skipped, 10);
        assert.equal(repeated.registrations.inserted, 0);
        assert.equal(repeated.registrations.skipped, 6);
        assert.equal((await pool.query("SELECT title->>'en' AS title FROM course WHERE code='CR-009'")).rows[0].title, 'My edited draft');
        assert.equal((await pool.query("SELECT password_hash FROM admin WHERE username='Seed QA'")).rows[0].password_hash, beforeHash);
        assert.equal((await pool.query("SELECT subject FROM email WHERE event='application.acknowledgement'")).rows[0].subject, 'Existing custom subject');
        const concurrent = await Promise.all([seed(options), seed(options)]);
        assert.equal(concurrent.every(result => result.courses.inserted === 0 && result.registrations.inserted === 0), true);
        assert.equal(await count('registration'), 9);
        assert.equal(await count('payment'), 6);
        assert.deepEqual((await pool.query('SELECT * FROM payment ORDER BY id')).rows, beforePayments);
        assert.equal(await count('log'), beforeLogs);
        assert.equal((await pool.query("SELECT count(*)::int AS total FROM pg_tables WHERE schemaname=$1 AND tablename='session'", [schema])).rows[0].total, 0);
        assert.equal(sent, 0);
        const retiredFlag = spawnSync(process.execPath, [path.join(__dirname, '../src/seed.js'), '--demo'], {
            encoding: 'utf8', env: { ...process.env, PGHOST: '127.0.0.1', PGPORT: '1' },
        });
        assert.equal(retiredFlag.status, 1);
        assert.match(retiredFlag.stderr, /without additional arguments/);
        console.log('Verified all nine application tables, editable top-level data, templates before publication, concurrent repeats, preserved history, full rollback and no SMTP/session creation.');
    } finally {
        mail.sendMessage = originalSend;
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await pool.end();
    }
});
