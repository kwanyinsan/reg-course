const path = require('node:path');
const express = require('express');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const port = Number(process.env.PORT || 3000);

app.get('/status', function getStatus(request, response) {
  response.json({
    status: 'ok',
    message: 'Express backend is connected.',
  });
});

const server = app.listen(port, '127.0.0.1', function reportStarted() {
  console.log(`Backend is running at http://127.0.0.1:${port}`);
});

server.on('error', function handleServerError(error) {
  console.error('Could not start backend:', error.message);
  process.exitCode = 1;
});
