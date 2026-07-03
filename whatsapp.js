const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Resolve database path
const dbPath = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Proxy DB connection error:', err.message);
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

const CHATBOT_URL = process.env.CHATBOT_URL || 'http://localhost:5001';

let statusCache = { status: 'disconnected', qr: null, sessionsCount: 0 };
let logsCache = [];

// Sync session status from Flask chatbot
async function syncStatus() {
  try {
    const res = await fetch(`${CHATBOT_URL}/api/status`);
    if (res.ok) {
      statusCache = await res.json();
    }
  } catch (err) {
    statusCache = { status: 'disconnected', qr: null, sessionsCount: 0 };
  }
}

// Sync logs from SQLite database directly
async function syncLogs() {
  try {
    const rows = await dbAll('SELECT * FROM whatsapp_logs ORDER BY id DESC LIMIT 20');
    logsCache = rows.map(r => ({
      timestamp: new Date(r.timestamp).toLocaleTimeString('id-ID'),
      phone: r.phone,
      message: r.message,
      reply: r.reply
    }));
  } catch (err) {
    logsCache = [];
  }
}

// Start background timers
setInterval(syncStatus, 5000);
setInterval(syncLogs, 3000);

// Initial immediate syncs
syncStatus().catch(() => {});
syncLogs().catch(() => {});

function getStatus() {
  return statusCache;
}

function getLogs() {
  return logsCache;
}

async function startClient() {
  try {
    await fetch(`${CHATBOT_URL}/api/start`, { method: 'POST' });
    setTimeout(syncStatus, 1000);
  } catch (err) {
    console.error('Failed to proxy startClient:', err.message);
  }
}

async function logoutClient() {
  try {
    await fetch(`${CHATBOT_URL}/api/logout`, { method: 'POST' });
    setTimeout(syncStatus, 1000);
  } catch (err) {
    console.error('Failed to proxy logoutClient:', err.message);
  }
}

// Forward incoming message payload to Flask Chatbot
async function handleIncomingMessage(from, rawText) {
  try {
    await fetch(`${CHATBOT_URL}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'message',
        payload: {
          from: from,
          body: rawText,
          fromMe: false
        }
      })
    });
  } catch (err) {
    console.error('Failed to forward webhook to Flask chatbot:', err.message);
  }
}

module.exports = {
  getStatus,
  getLogs,
  startClient,
  logoutClient,
  handleIncomingMessage
};
