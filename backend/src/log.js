async function writeLog(database, entry) {
    await database.query(
        `INSERT INTO log
         (actor_type, admin_id, event, course_id, submission_id,
          registration_id, payment_id, email_id, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [entry.actorType, entry.adminId ?? null, entry.event,
            entry.courseId ?? null, entry.submissionId ?? null,
            entry.registrationId ?? null, entry.paymentId ?? null,
            entry.emailId ?? null, entry.details ?? {}]
    );
}

module.exports = writeLog;
