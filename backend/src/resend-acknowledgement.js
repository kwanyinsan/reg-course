const pool = require('./db');
const acknowledgement = require('./acknowledgement');

async function resend() {
    const argument = process.argv[2];
    if (process.argv.length !== 3 || !/^[1-9]\d*$/.test(argument || '') || Number(argument) > 2147483647) {
        throw new Error('Provide exactly one submission ID.');
    }
    const before = await acknowledgement.status(pool, Number(argument));
    if (!['failed', 'requested'].includes(before.status)) {
        throw new Error('Only a definite failure or an unstarted acknowledgement can be retried.');
    }
    const result = await acknowledgement.send(Number(argument), { retry: true });
    console.log('Acknowledgement status:', result.status);
    if (result.status !== 'accepted') process.exitCode = 1;
}

resend()
    .catch(function failed(error) { console.error(error.message); process.exitCode = 1; })
    .finally(function close() { return pool.end(); });
