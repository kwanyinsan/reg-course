const fs = require('node:fs');
const path = require('node:path');
const pool = require('../../src/db');
const writeLog = require('../../src/log');

function guardBody(value) {
    const body = value.slice(value.indexOf('DECLARE'), value.lastIndexOf('END;') + 4);
    return body.replace(/    (check_in|check_out) TIMESTAMPTZ;\r?\n/g, '').replace(/    attended BOOLEAN;\r?\n/g, '')
        .replace(/    FOR attendance_entry IN SELECT \* FROM jsonb_each\(NEW.attendance\) LOOP[\s\S]*?    END LOOP;/, 'ATTENDANCE_VALIDATION')
        .replace(/\s+/g, ' ').trim();
}

async function updateAttendance(database = pool) {
    const source = fs.readFileSync(path.join(__dirname, '../../../database/schema.sql'), 'utf8');
    const definition = source.match(/CREATE FUNCTION validate_registration_data\(\)[\s\S]*?\$\$;/)?.[0];
    if (!definition) throw new Error('Attendance validator source is missing.');
    const client = await database.connect();
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout='5s'");
        await client.query('LOCK TABLE registration IN SHARE ROW EXCLUSIVE MODE');
        const current = await client.query("SELECT pg_get_functiondef('validate_registration_data()'::regprocedure) AS definition");
        if (guardBody(current.rows[0].definition) !== guardBody(definition)) throw new Error('Unrelated registration guards differ; review the migration.');
        const rows = await client.query("SELECT id,submission_id,course_id,attendance,certificate_number FROM registration WHERE attendance<>'{}'::jsonb ORDER BY id FOR UPDATE");
        const changes = [];
        for (const row of rows.rows) {
            const after = {};
            let changed = false;
            for (const [sessionId, entry] of Object.entries(row.attendance)) {
                if (Object.keys(entry).sort().join(',') === 'attended,recorded_at' && entry.attended === true) { after[sessionId] = entry; continue; }
                if (Object.keys(entry).sort().join(',') !== 'attended,check_in_at,check_out_at' || entry.attended !== true || !entry.check_in_at || row.certificate_number) throw new Error('Unexpected attendance history requires review.');
                after[sessionId] = { recorded_at: entry.check_in_at, attended: true };
                changed = true;
            }
            if (changed) changes.push({ row, after });
        }
        await client.query(definition.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'));
        for (const { row, after } of changes) {
            await client.query('UPDATE registration SET attendance=$2 WHERE id=$1', [row.id, after]);
            await writeLog(client, { actorType: 'system', event: 'attendance.format_updated', courseId: row.course_id,
                submissionId: row.submission_id, registrationId: row.id,
                details: { reason: 'Single-scan attendance replaces arrival and departure recording.', before: row.attendance, after } });
        }
        await client.query('COMMIT');
        return changes.length;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
}

if (require.main === module) updateAttendance()
    .then(count => console.log('Attendance records converted:', count))
    .catch(function failed(error) { console.error(error.message); process.exitCode = 1; })
    .finally(() => pool.end());

module.exports = { updateAttendance };
