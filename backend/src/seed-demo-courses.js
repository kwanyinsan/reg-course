const pool = require('./db');
const courses = require('./demo-courses');

const definition = { questions: [{
    id: 'demo_learning_goal',
    label: {
        en: 'Demo only: What would you like to learn?',
        'zh-Hant': '僅供示範：你希望學習甚麼？',
        'zh-Hans': '仅供示范：你希望学习什么？',
    },
    type: 'text', required: false,
}] };

async function insertDemoCourses(client) {
    const validation = await client.query('SELECT valid_sessions($1::jsonb, $2) AS valid',
        [JSON.stringify(courses[0].sessions), courses[0].mode]);
    if (!validation.rows[0].valid) {
        throw new Error('Apply the approved optional session description/speaker validator before demo seeding.');
    }
    const result = { inserted: 0, skipped: 0 };
    for (const course of courses) {
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
        if (course.state !== 'draft') {
            await client.query('INSERT INTO question (course_id, definition) VALUES ($1, $2)', [id, definition]);
            await client.query('UPDATE course SET state = $1 WHERE id = $2', ['published', id]);
            if (course.state === 'archived') {
                await client.query('UPDATE course SET state = $1 WHERE id = $2', ['archived', id]);
            }
        }
        result.inserted += 1;
    }
    return result;
}

async function seed() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await insertDemoCourses(client);
        await client.query('COMMIT');
        console.log('Demo courses inserted:', result.inserted);
        console.log('Existing course codes preserved:', result.skipped);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

if (require.main === module) {
    seed().catch(function reportSeedError(error) {
        console.error('Demo seed failed:', error.message);
        process.exitCode = 1;
    }).finally(function closePool() { return pool.end(); });
}

module.exports = insertDemoCourses;
