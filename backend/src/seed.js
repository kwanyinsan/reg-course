const bcrypt = require('bcryptjs');
const pool = require('./db');
const courses = require('./demo-courses');
const writeLog = require('./log');
const { starter } = require('./certificate-template');
const acknowledgement = require('./acknowledgement');
const attendanceMail = require('./attendance-mail');
const attendanceResults = require('./attendance-result-mail');
const certificateMail = require('./certificate-mail');

const definition = { questions: [{
    id: 'demo_learning_goal',
    label: {
        en: 'What would you like to learn?',
        'zh-Hant': '你希望學習甚麼？',
        'zh-Hans': '你希望学习什么？',
    },
    type: 'text', required: false,
}] };

// Entirely synthetic local fixtures. Reserved email addresses must never receive mail.
const applications = [
    { reference: 'APP-202610-001', name: 'Alex Chan', salutation: 'Mr', email: 'alex.chan@example.invalid',
        phone: '00001001', courses: ['CR-001', 'CR-002', 'CR-003'], state: 'pending', created: '2026-10-27T10:00:00+08:00',
        comments: 'Please provide step-free access.', answer: 'Understand how to organise project records.' },
    { reference: 'APP-202610-002', name: 'Jamie Lee', salutation: 'Ms', email: 'jamie.lee@example.invalid',
        phone: '00001002', courses: ['CR-004', 'CR-007'], state: 'paid', created: '2026-10-27T11:00:00+08:00', paid: '2026-10-28T10:00:00+08:00' },
    { reference: 'APP-202610-003', name: 'Taylor Wong', salutation: 'Miss', email: 'taylor.wong@example.invalid',
        phone: '00001003', courses: ['CR-006'], state: 'paid', created: '2026-10-10T10:00:00+08:00', paid: '2026-10-11T10:00:00+08:00', attended: true },
    { reference: 'APP-202610-004', name: 'Casey Lam', salutation: 'Mr', email: 'casey.lam@example.invalid',
        phone: '00001004', courses: ['CR-006'], state: 'expired', created: '2026-10-11T11:00:00+08:00' },
    { reference: 'APP-202610-005', name: 'Morgan Ho', salutation: 'Ms', email: 'morgan.ho@example.invalid',
        phone: '00001005', courses: ['CR-002'], state: 'cancelled', created: '2026-10-27T12:00:00+08:00', cancelled: true },
    { reference: 'APP-202610-006', name: 'Riley Lau', salutation: 'Mr', email: 'riley.lau@example.invalid',
        phone: '00001006', courses: ['CR-004'], state: 'paid', created: '2026-10-27T13:00:00+08:00',
        paid: '2026-10-28T10:00:00+08:00', cancelled: true },
];

async function insertAdmin(client, username, password) {
    if (typeof username !== 'string' || !username.trim() || username.length > 50) {
        throw new Error('SEED_STAFF_USERNAME must contain 1 to 50 characters.');
    }
    if (typeof password !== 'string' || password.length < 8 ||
        Buffer.byteLength(password, 'utf8') > 72) {
        throw new Error('SEED_STAFF_PASSWORD must contain at least 8 characters and fit within 72 UTF-8 bytes.');
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await client.query(
        `INSERT INTO admin (username, password_hash)
         VALUES ($1, $2)
         ON CONFLICT (username) DO NOTHING
         RETURNING id`,
        [username.trim(), hash]
    );

    return result.rowCount;
}

async function insertDemoCourses(client) {
    const validation = await client.query('SELECT valid_sessions($1::jsonb, $2) AS valid',
        [JSON.stringify(courses[0].sessions), courses[0].mode]);
    if (!validation.rows[0].valid) {
        throw new Error('Apply the approved optional session description/speaker validator before demo seeding.');
    }
    const result = { inserted: 0, skipped: 0 };
    for (const course of courses) {
        const existing = await client.query('SELECT id FROM course WHERE code = $1 OR code = $2 FOR UPDATE',
            [course.code, `DEMO-${course.code}`]);
        if (existing.rowCount > 1) throw new Error(`Both legacy and current codes exist for ${course.code}.`);
        if (existing.rowCount) {
            result.skipped += 1;
            continue;
        }
        const inserted = await client.query(
            `INSERT INTO course
             (code, title, short_description, long_description, information, mode, sessions,
              fee, registration_opens_at, registration_closes_at, payment_deadline,
              attendance_requirement_percent, state)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'draft')
             ON CONFLICT (code) DO NOTHING RETURNING id`,
            [course.code, course.title, course.short_description, course.long_description,
                course.information ?? {}, course.mode, JSON.stringify(course.sessions), course.fee,
                course.registration_opens_at ?? null, course.registration_closes_at ?? null,
                course.payment_deadline, course.attendance_requirement_percent]
        );
        if (!inserted.rowCount) {
            result.skipped += 1;
            continue;
        }
        const id = inserted.rows[0].id;
        await client.query('INSERT INTO question (course_id, definition) VALUES ($1, $2)', [id, definition]);
        await client.query('INSERT INTO certificate (course_id, template) VALUES ($1, $2)', [id, starter]);
        if (course.state !== 'draft') {
            await client.query('UPDATE course SET state = $1 WHERE id = $2', ['published', id]);
            if (course.state === 'archived') {
                await client.query('UPDATE course SET state = $1 WHERE id = $2', ['archived', id]);
            }
        }
        result.inserted += 1;
    }
    return result;
}

async function insertRegistrations(client) {
    const admin = await client.query('SELECT id FROM admin ORDER BY id LIMIT 1');
    if (!admin.rowCount) throw new Error('An existing administrator is required for cancellation metadata.');
    let inserted = 0;
    let skipped = 0;
    for (const application of applications) {
        const existing = await client.query('SELECT id FROM submission WHERE reference = $1', [application.reference]);
        if (existing.rowCount) { skipped += 1; continue; }
        const result = await client.query('SELECT id, code, fee, payment_deadline FROM course WHERE code = ANY($1::text[]) ORDER BY code', [application.courses]);
        if (result.rowCount !== application.courses.length) throw new Error('Run the approved course wording cleanup before registration seeding.');
        const cents = result.rows.reduce(function addFee(total, course) { return total + Math.round(Number(course.fee) * 100); }, 0);
        const total = (cents / 100).toFixed(2);
        const deadline = new Date(Math.min(...result.rows.map(function due(course) { return course.payment_deadline.getTime(); })));
        const cancelledAt = application.cancelled ? '2026-10-28T15:00:00+08:00' : null;
        const cancelledBy = application.cancelled ? admin.rows[0].id : null;
        const reason = application.cancelled ? 'Application withdrawn.' : null;
        const submission = await client.query(
            `INSERT INTO submission (reference, salutation, full_name, organisation, job_title, phone, email,
                    comments, consent_accepted, total, is_cancelled, cancelled_at, cancelled_by, cancellation_reason, created_at)
             VALUES ($1, $2, $3, 'Learning Group', 'Project officer', $4, $5, $6, TRUE, $7, $8, $9, $10, $11, $12) RETURNING id`,
            [application.reference, application.salutation, application.name, application.phone, application.email,
                application.comments ?? null, total, !!application.cancelled, cancelledAt, cancelledBy, reason, application.created]);
        const submissionId = submission.rows[0].id;
        for (const course of result.rows) {
            const answers = application.answer ? { demo_learning_goal: application.answer } : {};
            const attendance = application.attended ? { session_1: {
                recorded_at: '2026-10-20T09:55:00+08:00', attended: true,
            } } : {};
            await client.query(
                `INSERT INTO registration (submission_id, course_id, fee, answers, attendance, state,
                        cancelled_at, cancelled_by, cancellation_reason, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [submissionId, course.id, course.fee, answers, attendance, application.cancelled ? 'cancelled' : 'registered',
                    cancelledAt, cancelledBy, reason, application.created]);
        }
        await client.query(
            `INSERT INTO payment (submission_id, reference, amount, due_at, state, paid_at, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [submissionId, application.reference.replace('APP-', 'PAY-'), total, deadline, application.state,
                application.paid ?? null, application.created]);
        await writeLog(client, { actorType: 'system', event: 'development.registrations_seeded', submissionId,
            details: { synthetic: true, registrations: result.rowCount } });
        inserted += 1;
    }
    return { inserted, skipped };
}

async function seed({ demo = false, username = process.env.SEED_STAFF_USERNAME, password = process.env.SEED_STAFF_PASSWORD, database = pool } = {}) {
    if (typeof demo !== 'boolean') throw new Error('Choose whether to include sample data.');
    const client = await database.connect();
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SELECT pg_advisory_xact_lock(hashtext('reg-course initial data seed'))");
        const admin = await insertAdmin(client, username, password);
        let templates = 0;
        for (const email of [acknowledgement, attendanceMail, attendanceResults, certificateMail]) {
            templates += await email.installTemplate(client);
        }
        const courses = demo ? await insertDemoCourses(client) : { inserted: 0, skipped: 0 };
        const registrations = demo ? await insertRegistrations(client) : { inserted: 0, skipped: 0 };
        await client.query('COMMIT');
        return { admin, templates, courses, registrations };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
}

async function run() {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== '--demo')) {
        throw new Error('Use npm run seed or npm run seed -- --demo.');
    }
    const result = await seed({ demo: args.includes('--demo') });
    console.log('Administrator accounts inserted:', result.admin);
    console.log('Email templates inserted:', result.templates);
    console.log('Sample courses inserted/skipped:', result.courses.inserted, result.courses.skipped);
    console.log('Sample submissions inserted/skipped:', result.registrations.inserted, result.registrations.skipped);
}

if (require.main === module) {
    run().catch(function reportSeedError(error) {
        console.error('Seed failed:', error.message);
        process.exitCode = 1;
    }).finally(function closePool() { return pool.end(); });
}

module.exports = { seed, insertAdmin, insertDemoCourses, insertRegistrations };
