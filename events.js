// In-process pub/sub for Server-Sent Events. One server instance holds the
// shared data, so this is just a set of open responses to write to — no
// external broker needed at this scale.
const clients = new Set();

function addClient(res) {
  clients.add(res);
}

function removeClient(res) {
  clients.delete(res);
}

function broadcast(scopes) {
  const payload = `data: ${JSON.stringify({ scopes: Array.isArray(scopes) ? scopes : [scopes] })}\n\n`;
  for (const res of clients) {
    res.write(payload);
  }
}

module.exports = { addClient, removeClient, broadcast };
