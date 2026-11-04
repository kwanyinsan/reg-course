const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const pool = require('../src/db');
const { seed } = require('../src/seed');

test('unified seed is transactional, repeatable and never sends email', async function integration() {
    const schema = `seed_test_${process.pid}_${Date.now()}`;
    pool.options.options = `-c search_path=${schema},public`;
    const mail = require('../src/mail');
    const originalSend = mail.sendMessage;
    let sent = 0;
    mail.sendMessage = async function forbiddenEmail() { sent++; throw new Error('Seeding must not send email.'); };
    const options = { username: 'Seed QA', password: 'Isolated seed password 123' };
    async function count(table) { return (await pool.query(`SELECT count(*)::int AS total FROM ${table}`)).rows[0].total; }
    try {
        await pool.query(`CREATE SCHEMA "${schema}"`);
        await pool.query(fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8'));
        const initial = await seed(options);
        assert.equal(initial.admin, 1);
        assert.equal(initial.templates, 4);
        for (const table of ['course', 'question', 'certificate', 'submission', 'registration', 'payment']) assert.equal(await count(table), 0, table);
        const beforeHash = (await pool.query("SELECT password_hash FROM admin WHERE username='Seed QA'")).rows[0].password_hash;
        assert.equal(await bcrypt.compare(options.password, beforeHash), true);
        await pool.query("UPDATE email SET subject='Existing custom subject' WHERE event='application.acknowledgement'");
        const again = await seed({ ...options, password: 'Another unused password 456' });
        assert.equal(again.admin, 0);
        assert.equal(again.templates, 0);
        assert.equal((await pool.query("SELECT password_hash FROM admin WHERE username='Seed QA'")).rows[0].password_hash, beforeHash);
        assert.equal((await pool.query("SELECT subject FROM email WHERE event='application.acknowledgement'")).rows[0].subject, 'Existing custom subject');
        await pool.query(`CREATE FUNCTION reject_seed_log() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
            RAISE EXCEPTION 'Controlled seed log failure'; END; $$;
            CREATE TRIGGER reject_seed_log BEFORE INSERT ON log FOR EACH ROW EXECUTE FUNCTION reject_seed_log()`);
        await assert.rejects(seed({ ...options, username: 'Rolled back admin', demo: true }));
        for (const table of ['course', 'question', 'certificate', 'submission', 'registration', 'payment']) assert.equal(await count(table), 0, table);
        assert.equal(await count('admin'), 1);
        assert.equal(await count('email'), 4);
        await pool.query('DROP TRIGGER reject_seed_log ON log');
        const demo = await seed({ ...options, demo: true });
        assert.equal(demo.courses.inserted, 10);
        assert.equal(demo.registrations.inserted, 6);
        assert.equal(await count('course'), 10);
        assert.equal(await count('question'), 10);
        assert.equal(await count('certificate'), 10);
        assert.equal(await count('registration'), 9);
        assert.equal(await count('payment'), 6);
        assert.equal((await pool.query(`SELECT count(*)::int AS total FROM course c LEFT JOIN certificate k ON k.course_id=c.id
            WHERE c.published_at IS NOT NULL AND k.id IS NULL`)).rows[0].total, 0);
        await pool.query("UPDATE course SET title='{\"en\":\"My edited draft\"}' WHERE code='CR-009'");
        const repeated = await seed({ ...options, demo: true });
        assert.equal(repeated.courses.inserted, 0);
        assert.equal(repeated.courses.skipped, 10);
        assert.equal(repeated.registrations.inserted, 0);
        assert.equal(repeated.registrations.skipped, 6);
        assert.equal((await pool.query("SELECT title->>'en' AS title FROM course WHERE code='CR-009'")).rows[0].title, 'My edited draft');
        assert.equal(await count('registration'), 9);
        assert.equal(await count('payment'), 6);
        assert.equal(sent, 0);
        console.log('Verified default setup, optional sample data, templates before publication, protected existing values, full rollback and no SMTP calls.');
    } finally {
        mail.sendMessage = originalSend;
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await pool.end();
    }
});
