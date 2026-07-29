const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { addClient, removeClient } = require('../events');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no' // disable proxy buffering (nginx) so pushes arrive immediately
  });
  res.write('\n');
  addClient(res);

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeClient(res);
  });
});

module.exports = router;
