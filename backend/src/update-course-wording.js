const pool = require('./db');
const courses = require('./demo-courses');
const writeLog = require('./log');

const originalFingerprints = [
    '027e490e41083179890e802a8840245b', '4cd1e7dd58209465567d9eef529b7508',
    '6daff30ea3384d39dcae4eeaa008ff42', '32394977a5a340e5e1bec09e4ca1eceb',
    'f4528028f5030410cb87d031bc4a1ebf', '4ec0f6335500d3de97be76ff2d6b4d67',
    'd7bf5e8741e01e3ed5d6d6cb57047424', 'b7ee4978cf2aebd85ca06fff605abc3d',
    '3a366c1113bf95d261a8847a32df5f8f', 'f2efc083bfedbc5eef4ff90333b26254',
];
const labels = { en: 'What would you like to learn?', 'zh-Hant': '你希望學習甚麼？', 'zh-Hans': '你希望学习什么？' };
const originalLabels = { en: 'Demo only: What would you like to learn?', 'zh-Hant': '僅供示範：你希望學習甚麼？', 'zh-Hans': '仅供示范：你希望学习什么？' };

async function updateWording(client) {
    let changed = 0;
    for (let index = 0; index < courses.length; index += 1) {
        const course = courses[index];
        const result = await client.query(
            `SELECT id, code, md5(jsonb_build_object('code', code, 'title', title,
                    'short_description', short_description, 'long_description', long_description,
                    'information', information, 'sessions', sessions)::text) AS fingerprint
             FROM course WHERE id = $1 FOR UPDATE`, [index + 10]
        );
        const existing = result.rows[0];
        if (!existing) throw new Error(`Approved course ID ${index + 10} is missing.`);
        const expected = await client.query(
            `SELECT md5(jsonb_build_object('code', $1::text, 'title', $2::jsonb,
                    'short_description', $3::jsonb, 'long_description', $4::jsonb,
                    'information', $5::jsonb, 'sessions', $6::jsonb)::text) AS fingerprint`,
            [course.code, course.title, course.short_description, course.long_description,
                course.information ?? {}, JSON.stringify(course.sessions)]
        );
        if (existing.fingerprint === expected.rows[0].fingerprint) continue;
        if (existing.fingerprint !== originalFingerprints[index]) {
            throw new Error(`Course ${existing.id} has changed since the wording proposal; nothing was overwritten.`);
        }
        await client.query(
            `UPDATE course SET code = $1, title = $2, short_description = $3,
                    long_description = $4, information = $5, sessions = $6 WHERE id = $7`,
            [course.code, course.title, course.short_description, course.long_description,
                course.information ?? {}, JSON.stringify(course.sessions), existing.id]
        );
        const question = await client.query('SELECT id, definition FROM question WHERE course_id = $1 FOR UPDATE', [existing.id]);
        if (question.rowCount) {
            const definition = question.rows[0].definition;
            if (definition.questions.length !== 1 || definition.questions[0].id !== 'demo_learning_goal' ||
                JSON.stringify(Object.entries(definition.questions[0].label).sort()) !== JSON.stringify(Object.entries(originalLabels).sort())) {
                throw new Error(`Course ${existing.id} question wording has changed; review it before cleanup.`);
            }
            await client.query("UPDATE question SET definition = jsonb_set(definition, '{questions,0,label}', $1) WHERE id = $2",
                [labels, question.rows[0].id]);
        }
        await writeLog(client, { actorType: 'system', event: 'course.wording_updated', courseId: existing.id,
            details: { previous_code: existing.code, code: course.code } });
        changed += 1;
    }
    return changed;
}

async function run() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const changed = await updateWording(client);
        await client.query('COMMIT');
        console.log('Existing course wordings updated:', changed);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

if (require.main === module) {
    run().catch(function reportError(error) {
        console.error('Wording update failed:', error.message);
        process.exitCode = 1;
    }).finally(function closePool() { return pool.end(); });
}

module.exports = updateWording;
