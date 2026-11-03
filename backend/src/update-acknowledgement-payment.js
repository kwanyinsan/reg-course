const pool = require('./db');
const { updatePaymentTemplate } = require('./acknowledgement');

updatePaymentTemplate()
    .then(function updated(count) { console.log('Acknowledgement templates updated:', count); })
    .catch(function failed() { console.error('Acknowledgement payment template update stopped; check the installed template.'); process.exitCode = 1; })
    .finally(function close() { return pool.end(); });
