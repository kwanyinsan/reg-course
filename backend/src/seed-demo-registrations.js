const pool = require('./db');
const writeLog = require('./log');

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
                check_in_at: '2026-10-20T09:55:00+08:00', check_out_at: '2026-10-20T12:05:00+08:00', attended: true,
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

async function seed() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SELECT pg_advisory_xact_lock(hashtext('reg-course synthetic registration seed'))");
        const result = await insertRegistrations(client);
        await client.query('COMMIT');
        console.log('Synthetic submissions inserted:', result.inserted);
        console.log('Existing submission references preserved:', result.skipped);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
}

if (require.main === module) {
    seed().catch(function reportError(error) {
        console.error('Registration seed failed:', error.message);
        process.exitCode = 1;
    }).finally(function closePool() { return pool.end(); });
}

module.exports = insertRegistrations;
