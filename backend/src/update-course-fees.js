const pool = require('./db');
const writeLog = require('./log');

const replacements = [
    ['CR-002', 149.50, 140], ['CR-003', 350.25, 350], ['CR-006', 50.10, 50],
    ['CR-007', 99.99, 90], ['CR-008', 275.50, 270], ['CR-009', 75, 70],
];

async function updateCourseFees(client) {
    let changed = 0;
    for (const [code, previous, amount] of replacements) {
        const result = await client.query('SELECT id, fee FROM course WHERE code = $1 FOR UPDATE', [code]);
        const course = result.rows[0];
        if (!course) throw new Error(`Course ${code} is missing.`);
        if (Number(course.fee) === amount) continue;
        if (Number(course.fee) !== previous) throw new Error(`Course ${code} has another price; nothing was overwritten.`);
        await client.query('UPDATE course SET fee = $1 WHERE id = $2', [amount, course.id]);
        await writeLog(client, { actorType: 'system', event: 'course.fee_updated', courseId: course.id,
            details: { previous_fee: previous, fee: amount } });
        changed += 1;
    }
    const invalid = await client.query('SELECT id FROM course WHERE fee < 0 OR fee <> TRUNC(fee) OR MOD(fee, 10) <> 0');
    if (invalid.rowCount) throw new Error('Other course prices do not match the approved whole-dollar multiple-of-ten rule.');
    const column = await client.query("SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'course' AND column_name = 'fee'");
    if (column.rows[0]?.data_type === 'numeric') {
        await client.query('ALTER TABLE course DROP CONSTRAINT course_fee_check');
        await client.query('ALTER TABLE course ALTER COLUMN fee TYPE INTEGER USING fee::INTEGER');
        await client.query('ALTER TABLE course ADD CONSTRAINT course_fee_multiple_of_ten CHECK (fee >= 0 AND MOD(fee, 10) = 0)');
    } else if (column.rows[0]?.data_type !== 'integer') {
        throw new Error('Review the existing course fee type before applying this change.');
    }
    return changed;
}

async function run() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SELECT pg_advisory_xact_lock(hashtext('reg-course course fee update'))");
        const count = await updateCourseFees(client);
        await client.query('COMMIT');
        console.log('Course prices updated:', count);
        console.log('Course fees use integer HKD amounts in multiples of ten. Historical charges were preserved.');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
}

if (require.main === module) {
    run().catch(function reportError(error) {
        console.error('Course fee update failed:', error.message);
        process.exitCode = 1;
    }).finally(function closePool() { return pool.end(); });
}

module.exports = updateCourseFees;
