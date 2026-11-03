const pool = require('./db');
const { installTemplate } = require('./acknowledgement');

installTemplate()
    .then(function installed(count) { console.log('Acknowledgement templates inserted:', count); })
    .catch(function failed() { console.error('Acknowledgement template installation failed.'); process.exitCode = 1; })
    .finally(function close() { return pool.end(); });
