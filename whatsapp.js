const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestWaWebVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const QRCode = require('qrcode');

// Load translation dictionary
const T = require('./t_dict.json');

// DB connection
const dbPath = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('WhatsApp DB connection error:', err.message);
});

// DB Helpers
const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) reject(err);
    else resolve(row);
  });
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) {
    if (err) reject(err);
    else resolve({ id: this.lastID, changes: this.changes });
  });
});

let statusCache = { status: 'disconnected', qr: null, sessionsCount: 0 };
let logsCache = [];
let sock = null;
let isStarted = false;

// Sync session status count from SQLite directly
async function updateSessionsCount() {
  try {
    const row = await dbGet("SELECT COUNT(*) as count FROM chatbot_sessions WHERE step > 0");
    statusCache.sessionsCount = row ? row.count : 0;
  } catch (e) {
    statusCache.sessionsCount = 0;
  }
}

// Sync logs from SQLite database directly
async function syncLogs() {
  try {
    const rows = await dbAll('SELECT * FROM whatsapp_logs ORDER BY id DESC LIMIT 20');
    logsCache = rows.map(r => ({
      timestamp: r.timestamp ? new Date(r.timestamp).toLocaleTimeString('id-ID') : new Date().toLocaleTimeString('id-ID'),
      phone: r.phone,
      message: r.message,
      reply: r.reply
    }));
  } catch (err) {
    logsCache = [];
  }
}

// Start background timers
setInterval(updateSessionsCount, 5000);
setInterval(syncLogs, 3000);

// Initial immediate syncs
syncLogs().catch(() => {});

function getStatus() {
  return statusCache;
}

function getLogs() {
  return logsCache;
}

async function startClient() {
  if (isStarted) return;
  isStarted = true;
  await connectToWhatsApp();
}

async function logoutClient() {
  isStarted = false;
  statusCache = { status: 'disconnected', qr: null, sessionsCount: 0 };
  
  if (sock) {
    try {
      await sock.logout();
    } catch (e) {}
    sock = null;
  }
  
  // Clear auth directory
  const authDir = path.join(path.dirname(dbPath), 'auth_info_baileys');
  if (fs.existsSync(authDir)) {
    fs.rmSync(authDir, { recursive: true, force: true });
  }
  
  // Re-create empty directory
  fs.mkdirSync(authDir, { recursive: true });
}

async function sendManualMessage(phone, text) {
  if (!sock) throw new Error('WhatsApp Bot is not connected.');
  const chat_id = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
  await sock.sendMessage(chat_id, { text: text });
}

async function handleIncomingMessage(from, rawText) {
  // Baileys receives messages natively, so this is a no-op
}

async function connectToWhatsApp() {
  const authDir = path.join(path.dirname(dbPath), 'auth_info_baileys');
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }
  
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  // Fetch the latest WA Web version to prevent "Unable to link device" pairing errors
  let version = [2, 3000, 1043984129];
  try {
    const { version: latestVersion } = await fetchLatestWaWebVersion();
    if (latestVersion) version = latestVersion;
  } catch (err) {
    console.warn('Failed to fetch latest WA Web version, using fallback:', err.message);
  }

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' })
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      statusCache.status = 'qrcode';
      try {
        statusCache.qr = await QRCode.toDataURL(qr);
      } catch (err) {
        statusCache.qr = null;
      }
    }
    
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('WhatsApp connection closed, reconnecting: ', shouldReconnect);
      statusCache.status = 'disconnected';
      statusCache.qr = null;
      
      if (shouldReconnect && isStarted) {
        setTimeout(connectToWhatsApp, 5000);
      } else {
        isStarted = false;
      }
    } else if (connection === 'open') {
      console.log('WhatsApp connection opened successfully.');
      statusCache.status = 'connected';
      statusCache.qr = null;
      await updateSessionsCount();
    }
  });

  // Handle incoming messages
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type === 'notify') {
      for (const msg of messages) {
        if (!msg.key.fromMe && msg.message) {
          const from = msg.key.remoteJid;
          const text = (msg.message.conversation || 
                        msg.message.extendedTextMessage?.text || 
                        '').trim();
          if (from && text) {
            try {
              await handleChatbotMessage(from, text);
            } catch (err) {
              console.error('Error in handleChatbotMessage:', err.message);
            }
          }
        }
      }
    }
  });
}

// Chatbot Session Helpers
function cleanPhone(jid) {
  return jid.replace('@s.whatsapp.net', '').replace('@c.us', '').trim();
}

async function getSession(jid) {
  const phone = cleanPhone(jid);
  const row = await dbGet("SELECT * FROM chatbot_sessions WHERE phone = ?", [phone]);
  if (!row) return null;
  
  const session = {
    step: row.step,
    timestamp: row.timestamp,
    name: row.name,
    paymentMethod: row.payment_method,
    bot_mode: row.bot_mode,
    ticket_status: row.ticket_status,
    ticket_subject: row.ticket_subject,
    lang: row.lang || 'id',
    quantity: row.quantity
  };
  
  if (row.ticket_id) {
    session.ticket = await dbGet("SELECT * FROM tickets WHERE id = ?", [row.ticket_id]);
  } else {
    session.ticket = null;
  }
  
  session.availableTickets = await dbAll("SELECT * FROM tickets WHERE is_active = 1");
  
  const activePayments = await dbAll("SELECT * FROM payment_methods WHERE is_active = 1 ORDER BY name ASC");
  session.availablePayments = activePayments.length > 0 ? activePayments : [{ name: 'Tunai' }, { name: 'Transfer Bank' }, { name: 'QRIS' }];
  
  return session;
}

async function saveSession(jid, session) {
  const phone = cleanPhone(jid);
  const ticketId = session.ticket ? session.ticket.id : null;
  
  await dbRun(
    `INSERT OR REPLACE INTO chatbot_sessions 
     (phone, step, timestamp, name, ticket_id, quantity, payment_method, bot_mode, ticket_status, ticket_subject, lang) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      phone,
      session.step || 0,
      session.timestamp || (Date.now() / 1000),
      session.name || null,
      ticketId,
      session.quantity || null,
      session.paymentMethod || null,
      session.bot_mode || 'bot',
      session.ticket_status || 'closed',
      session.ticket_subject || null,
      session.lang || 'id'
    ]
  );
}

async function deleteSession(jid) {
  const phone = cleanPhone(jid);
  await dbRun(
    `UPDATE chatbot_sessions 
     SET step = 0, name = NULL, ticket_id = NULL, quantity = NULL, payment_method = NULL 
     WHERE phone = ?`,
    [phone]
  );
}

// Load company knowledge base on startup
let knowledgeParagraphs = [];
try {
  const kbPath = path.join(__dirname, 'chatbot', 'company_knowledge.txt');
  if (fs.existsSync(kbPath)) {
    const content = fs.readFileSync(kbPath, 'utf8');
    knowledgeParagraphs = content.split('\n\n').map(p => p.trim()).filter(Boolean);
  } else {
    const kbPathAlternative = path.join(__dirname, 'company_knowledge.txt');
    if (fs.existsSync(kbPathAlternative)) {
      const content = fs.readFileSync(kbPathAlternative, 'utf8');
      knowledgeParagraphs = content.split('\n\n').map(p => p.trim()).filter(Boolean);
    }
  }
} catch (e) {
  console.error('Failed to load knowledge base:', e.message);
}

// Tokenize helper for similarity search
function tokenize(text) {
  return text.toLowerCase().match(/\w+/g) || [];
}

// Simple RAG Cosine Similarity
function calculateSimilarity(str1, str2) {
  const words1 = tokenize(str1);
  const words2 = tokenize(str2);
  if (words1.length === 0 || words2.length === 0) return 0;
  
  const set1 = new Set(words1);
  const set2 = new Set(words2);
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  
  return intersection.size / Math.sqrt(set1.size * set2.size);
}

function getRelevantContext(query, paragraphs, topN = 3) {
  const scored = paragraphs.map(p => {
    const similarity = calculateSimilarity(query, p);
    const qWords = new Set(tokenize(query));
    const pWords = new Set(tokenize(p));
    const overlap = [...qWords].filter(x => pWords.has(x)).length;
    const score = similarity + (0.05 * overlap);
    return { score, p };
  });
  
  scored.sort((a, b) => b.score - a.score);
  const relevant = scored.filter(x => x.score > 0.05).slice(0, topN).map(x => x.p);
  return relevant.join('\n\n');
}

// Chatbot Logic
async function handleChatbotMessage(from, rawText) {
  const text = rawText.toLowerCase().trim();
  
  // Load settings
  const settingsRows = await dbAll("SELECT * FROM settings");
  const settings = {};
  settingsRows.forEach(r => { settings[r.key] = r.value; });
  
  const merchantName = settings.merchant_name || 'Batur Hot Spring';
  const merchantAddress = settings.merchant_address || 'Toya Bungkah, Kintamani, Bangli, Bali';
  const merchantWebsite = settings.merchant_website || 'www.baturhotspring.com';
  const merchantPhone = settings.merchant_phone || '+62 812-3456-7890';
  const merchantEmail = settings.merchant_email || 'info@baturhotspring.com';
  
  // Clean expired sessions (5 minutes timeout)
  const SESSION_TIMEOUT = 5 * 60;
  const cutoff = (Date.now() / 1000) - SESSION_TIMEOUT;
  await dbRun("UPDATE chatbot_sessions SET step = 0, name = NULL, ticket_id = NULL, quantity = NULL, payment_method = NULL WHERE step > 0 AND timestamp < ?", [cutoff]);
  
  let session = await getSession(from);
  
  // Language detection
  let lang = 'id';
  if (session && session.lang) {
    lang = session.lang;
  } else {
    const enIndicators = ['english', 'en', 'hello', 'hi', 'hey', 'booking', 'ticket', 'price', 'location', 'hours', 'help'];
    if (enIndicators.some(w => text.includes(w))) {
      lang = 'en';
    }
  }
  
  // Direct language commands
  if (['english', 'en', 'inggris'].includes(text)) {
    lang = 'en';
    if (!session) {
      session = { step: 0, bot_mode: 'bot', ticket_status: 'closed', lang: 'en' };
    } else {
      session.lang = 'en';
    }
    await saveSession(from, session);
    const reply = "Language changed to English. How can I help you? 😊";
    await sock.sendMessage(from, { text: reply });
    await dbRun("INSERT INTO whatsapp_logs (phone, message, reply) VALUES (?, ?, ?)", [cleanPhone(from), rawText, reply]);
    return;
  } else if (['indonesia', 'id', 'indo'].includes(text)) {
    lang = 'id';
    if (!session) {
      session = { step: 0, bot_mode: 'bot', ticket_status: 'closed', lang: 'id' };
    } else {
      session.lang = 'id';
    }
    await saveSession(from, session);
    const reply = "Bahasa diubah ke Bahasa Indonesia. Ada yang bisa saya bantu? 😊";
    await sock.sendMessage(from, { text: reply });
    await dbRun("INSERT INTO whatsapp_logs (phone, message, reply) VALUES (?, ?, ?)", [cleanPhone(from), rawText, reply]);
    return;
  }
  
  // Switch language on keyword
  if (text.includes('booking')) {
    lang = 'en';
    if (session) { session.lang = 'en'; await saveSession(from, session); }
  } else if (text.includes('pesan')) {
    lang = 'id';
    if (session) { session.lang = 'id'; await saveSession(from, session); }
  }
  
  // Agent mode check
  if (session && session.bot_mode === 'agent') {
    await dbRun("INSERT INTO whatsapp_logs (phone, message, reply) VALUES (?, ?, '')", [cleanPhone(from), rawText]);
    return;
  }
  
  // Global cancel
  const isCancel = (text === 'batal' || text === 'cancel');
  if (isCancel && session && session.step > 0) {
    await deleteSession(from);
    const reply = T.cancel[lang];
    await sock.sendMessage(from, { text: reply });
    await dbRun("INSERT INTO whatsapp_logs (phone, message, reply) VALUES (?, ?, ?)", [cleanPhone(from), rawText, reply]);
    return;
  }
  
  // Awaiting steps in booking flow
  if (session && session.step > 0) {
    session.timestamp = Date.now() / 1000;
    
    // Step 1: Awaiting Name
    if (session.step === 1) {
      session.name = rawText.trim();
      const tickets = session.availableTickets;
      if (tickets.length === 0) {
        await deleteSession(from);
        const reply = T.no_tickets[lang];
        await sock.sendMessage(from, { text: reply });
        await dbRun("INSERT INTO whatsapp_logs (phone, message, reply) VALUES (?, ?, ?)", [cleanPhone(from), rawText, reply]);
        return;
      }
      
      session.step = 2;
      await saveSession(from, session);
      
      let optionsText = "";
      tickets.forEach((t, idx) => {
        optionsText += `*${idx + 1}.* ${t.title} - Rp ${Math.round(t.price).toLocaleString('id-ID')}\n`;
      });
      
      const reply = T.step1_prompt[lang].replace('{name}', session.name).replace('{options_text}', optionsText);
      await sock.sendMessage(from, { text: reply });
      await dbRun("INSERT INTO whatsapp_logs (phone, message, reply) VALUES (?, ?, ?)", [cleanPhone(from), rawText, reply]);
      return;
    }
    
    // Step 2: Awaiting Ticket Selection
    if (session.step === 2) {
      const val = parseInt(text);
      if (isNaN(val) || val < 1 || val > session.availableTickets.length) {
        const reply = T.step2_invalid[lang].replace('{count}', session.availableTickets.length);
        await sock.sendMessage(from, { text: reply });
        await dbRun("INSERT INTO whatsapp_logs (phone, message, reply) VALUES (?, ?, ?)", [cleanPhone(from), rawText, reply]);
        return;
      }
      
      session.ticket = session.availableTickets[val - 1];
      session.step = 3;
      await saveSession(from, session);
      
      const reply = T.step2_prompt[lang].replace('{title}', session.ticket.title).replace('{price}', Math.round(session.ticket.price).toLocaleString('id-ID'));
      await sock.sendMessage(from, { text: reply });
      await dbRun("INSERT INTO whatsapp_logs (phone, message, reply) VALUES (?, ?, ?)", [cleanPhone(from), rawText, reply]);
      return;
    }
    
    // Step 3: Awaiting Quantity
    if (session.step === 3) {
      const qty = parseInt(text);
      if (isNaN(qty) || qty <= 0) {
        const reply = T.step3_invalid[lang];
        await sock.sendMessage(from, { text: reply });
        await dbRun("INSERT INTO whatsapp_logs (phone, message, reply) VALUES (?, ?, ?)", [cleanPhone(from), rawText, reply]);
        return;
      }
      
      session.quantity = qty;
      session.step = 4;
      await saveSession(from, session);
      
      let optionsText = "";
      session.availablePayments.forEach((pm, idx) => {
        optionsText += `*${idx + 1}.* ${pm.name}\n`;
      });
      
      const reply = T.step3_prompt[lang].replace('{options_text}', optionsText);
      await sock.sendMessage(from, { text: reply });
      await dbRun("INSERT INTO whatsapp_logs (phone, message, reply) VALUES (?, ?, ?)", [cleanPhone(from), rawText, reply]);
      return;
    }
    
    // Step 4: Awaiting Payment Method
    if (session.step === 4) {
      const val = parseInt(text);
      if (isNaN(val) || val < 1 || val > session.availablePayments.length) {
        const reply = T.step4_invalid[lang].replace('{count}', session.availablePayments.length);
        await sock.sendMessage(from, { text: reply });
        await dbRun("INSERT INTO whatsapp_logs (phone, message, reply) VALUES (?, ?, ?)", [cleanPhone(from), rawText, reply]);
        return;
      }
      
      session.paymentMethod = session.availablePayments[val - 1].name;
      session.step = 5;
      await saveSession(from, session);
      
      const totalBill = (session.ticket.price - (session.ticket.discount || 0)) * session.quantity;
      const reply = T.step4_prompt[lang]
        .replace('{name}', session.name)
        .replace('{title}', session.ticket.title)
        .replace('{quantity}', session.quantity)
        .replace('{total_bill}', Math.round(totalBill).toLocaleString('id-ID'))
        .replace('{payment_method}', session.paymentMethod);
        
      await sock.sendMessage(from, { text: reply });
      await dbRun("INSERT INTO whatsapp_logs (phone, message, reply) VALUES (?, ?, ?)", [cleanPhone(from), rawText, reply]);
      return;
    }
    
    // Step 5: Confirm Order (Yes / No)
    if (session.step === 5) {
      const isYes = ['ya', 'yes'].includes(text);
      if (isYes) {
        const totalBill = (session.ticket.price - (session.ticket.discount || 0)) * session.quantity;
        
        // Generate unique voucher code
        const randomHex = Math.random().toString(36).substring(2, 8).toUpperCase();
        const voucherCode = `VCH-${Date.now().toString().slice(-6)}-${randomHex}`;
        
        const validatedItems = [{
          ticket_id: session.ticket.id,
          ticket_title: session.ticket.title,
          ticket_price: session.ticket.price,
          ticket_discount: session.ticket.discount || 0,
          quantity: session.quantity,
          total_price: totalBill
        }];
        
        try {
          const resInvoice = await dbRun(
            `INSERT INTO invoices (customer_name, total_price, payment_method, status, voucher_code, items) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [session.name, totalBill, session.paymentMethod, 'Unpaid', voucherCode, JSON.stringify(validatedItems)]
          );
          
          await deleteSession(from);
          
          let paymentInstructions = "";
          if (session.paymentMethod.includes("BCA")) {
            paymentInstructions = T.transfer_instruction[lang].replace('{bank_name}', 'BCA 123-456-7890').replace('{merchant_name}', merchantName);
          } else if (session.paymentMethod.includes("Mandiri")) {
            paymentInstructions = T.transfer_instruction[lang].replace('{bank_name}', 'Mandiri 987-654-3210').replace('{merchant_name}', merchantName);
          } else {
            paymentInstructions = T.cash_instruction[lang];
          }
          
          const reply = T.step5_success[lang]
            .replace('{invoice_id}', resInvoice.id)
            .replace('{voucher_code}', voucherCode)
            .replace('{name}', session.name)
            .replace('{title}', session.ticket.title)
            .replace('{quantity}', session.quantity)
            .replace('{total_bill}', Math.round(totalBill).toLocaleString('id-ID'))
            .replace('{payment_instructions}', paymentInstructions)
            .replace('{merchant_website}', merchantWebsite);
            
          await sock.sendMessage(from, { text: reply });
          await dbRun("INSERT INTO whatsapp_logs (phone, message, reply) VALUES (?, ?, ?)", [cleanPhone(from), rawText, reply]);
        } catch (e) {
          console.error("Invoice insertion error:", e.message);
          await deleteSession(from);
          const reply = T.step5_error[lang];
          await sock.sendMessage(from, { text: reply });
          await dbRun("INSERT INTO whatsapp_logs (phone, message, reply) VALUES (?, ?, ?)", [cleanPhone(from), rawText, reply]);
        }
      } else {
        const reply = T.step5_invalid[lang];
        await sock.sendMessage(from, { text: reply });
        await dbRun("INSERT INTO whatsapp_logs (phone, message, reply) VALUES (?, ?, ?)", [cleanPhone(from), rawText, reply]);
      }
      return;
    }
  }
  
  // Trigger booking if keywords matched
  if (text.includes('pesan') || text.includes('booking') || text === '3') {
    const newSession = session || {
      step: 0,
      bot_mode: 'bot',
      ticket_status: 'closed',
      lang: lang
    };
    newSession.step = 1;
    newSession.timestamp = Date.now() / 1000;
    newSession.lang = lang;
    await saveSession(from, newSession);
    
    const reply = T.booking_start[lang].replace('{merchant_name}', merchantName);
    await sock.sendMessage(from, { text: reply });
    await dbRun("INSERT INTO whatsapp_logs (phone, message, reply) VALUES (?, ?, ?)", [cleanPhone(from), rawText, reply]);
    return;
  }
  
  // Ticket list shortcut
  if (text === '1' || text.includes('tiket') || text.includes('harga') || text.includes('ticket') || text.includes('price')) {
    const tickets = await dbAll("SELECT * FROM tickets WHERE is_active = 1");
    let ticketList = T.ticket_list_header[lang].replace('{merchant_name}', merchantName);
    if (tickets.length === 0) {
      ticketList += T.ticket_list_empty[lang];
    } else {
      tickets.forEach((t, idx) => {
        ticketList += `*${idx + 1}. ${t.title}*\n`;
        ticketList += lang === 'en' ? `   Price: Rp ${Math.round(t.price).toLocaleString('id-ID')}\n` : `   Harga: Rp ${Math.round(t.price).toLocaleString('id-ID')}\n`;
        if (t.description) ticketList += `   Detail: ${t.description}\n`;
        ticketList += "\n";
      });
      ticketList += T.ticket_list_footer[lang];
    }
    await sock.sendMessage(from, { text: ticketList });
    await dbRun("INSERT INTO whatsapp_logs (phone, message, reply) VALUES (?, ?, ?)", [cleanPhone(from), rawText, ticketList]);
    return;
  }
  
  // Location shortcut
  if (text === '2' || ['lokasi', 'alamat', 'jam', 'buka', 'location', 'address', 'hours', 'open'].some(w => text.includes(w))) {
    const reply = T.location_info[lang]
      .replace('{merchant_name}', merchantName)
      .replace('{merchant_address}', merchantAddress)
      .replace('{merchant_website}', merchantWebsite);
    await sock.sendMessage(from, { text: reply });
    await dbRun("INSERT INTO whatsapp_logs (phone, message, reply) VALUES (?, ?, ?)", [cleanPhone(from), rawText, reply]);
    return;
  }
  
  // Customer Service shortcut
  if (text === '4' || ['admin', 'cs', 'hubungi', 'kontak', 'contact', 'help', 'support'].some(w => text.includes(w))) {
    const sess = session || {
      step: 0,
      bot_mode: 'agent',
      ticket_status: 'open',
      ticket_subject: 'Customer requested CS support',
      lang: lang
    };
    sess.bot_mode = 'agent';
    sess.ticket_status = 'open';
    sess.ticket_subject = 'Customer requested CS support';
    await saveSession(from, sess);
    
    const reply = T.cs_info[lang]
      .replace('{merchant_name}', merchantName)
      .replace('{merchant_phone}', merchantPhone)
      .replace('{merchant_email}', merchantEmail);
      
    await sock.sendMessage(from, { text: reply });
    await dbRun("INSERT INTO whatsapp_logs (phone, message, reply) VALUES (?, ?, ?)", [cleanPhone(from), rawText, reply]);
    return;
  }
  
  // RAG with NVIDIA AI
  const nvidiaKey = settings.nvidia_api_key || '';
  const nvidiaModel = settings.nvidia_model || 'nvidia/llama-3.1-nemotron-70b-instruct';
  
  if (nvidiaKey) {
    try {
      const context = getRelevantContext(rawText, knowledgeParagraphs, 3);
      const tickets = await dbAll("SELECT * FROM tickets WHERE is_active = 1");
      let ticketContext = "";
      tickets.forEach(t => {
        ticketContext += `- ${t.title}: Rp ${Math.round(t.price).toLocaleString('id-ID')} (${t.description || ''})\n`;
      });
      
      let systemInstruction = "";
      if (lang === 'en') {
        systemInstruction = `You are the official WhatsApp Virtual Assistant for ${merchantName} (${merchantWebsite}).\nYour job is to assist customers by answering their questions politely and friendly in the language they use (Indonesian, English, Balinese, etc.).\n\nUse the following official company information/context to answer questions:\n[COMPANY CONTEXT]\n${context || 'No specific context.'}\n[/COMPANY CONTEXT]\n\nActive Tickets & Prices:\n${ticketContext}\nBooking Terms:\n- Customers can book tickets directly through WhatsApp by typing \"BOOKING\" or \"PESAN\".\n- If customers want to book tickets, instruct them to type \"BOOKING\" to start the automated booking. Do not book manually via AI chat.\n\nAnswer Rules:\n- Keep answers short, clear, and friendly.\n- Use appropriate emojis.\n- Only answer based on the provided company context. If you do not know or it is not in the context, say that you do not know and refer them to CS at ${merchantPhone}.\n- Reply using the exact same language as the customer's message.`;
      } else {
        systemInstruction = `Kamu adalah Virtual Assistant WhatsApp resmi untuk ${merchantName} (${merchantWebsite}).\nTugasmu adalah membantu pelanggan menjawab pertanyaan dengan sopan dan ramah dalam bahasa yang mereka gunakan (Indonesia, Inggris, Bali, dll.).\n\nGunakan informasi/konteks resmi dari perusahaan berikut untuk menjawab pertanyaan:\n[KONTEKS PERUSAHAAN]\n${context || 'Tidak ada konteks spesifik.'}\n[/KONTEKS PERUSAHAAN]\n\nDaftar Tiket Aktif & Harga:\n${ticketContext}\nKetentuan Pemesanan:\n- Pelanggan bisa memesan tiket langsung lewat WhatsApp dengan mengetik kata kunci \"PESAN\" atau \"BOOKING\".\n- Jika pelanggan ingin memesan tiket, arahkan mereka untuk mengetik \"PESAN\" agar sistem otomatis memandu langkah pemesanan. Jangan lakukan pemesanan manual lewat percakapan AI biasa.\n\nAturan Jawaban:\n- Jawab dengan singkat, padat, dan ramah.\n- Gunakan emoji yang sesuai.\n- Hanya jawab berdasarkan konteks perusahaan yang disediakan. Jika tidak tahu atau tidak ada di konteks, jawab bahwa Anda tidak tahu dan arahkan untuk menghubungi CS di ${merchantPhone}.\n- Jawab menggunakan bahasa yang sama dengan pesan pelanggan.`;
      }
      
      const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: 'POST',
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${nvidiaKey}`
        },
        body: JSON.stringify({
          model: nvidiaModel,
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: rawText }
          ]
        })
      });
      
      if (response.ok) {
        const resData = await response.json();
        const reply = resData.choices[0].message.content.trim();
        await sock.sendMessage(from, { text: reply });
        await dbRun("INSERT INTO whatsapp_logs (phone, message, reply) VALUES (?, ?, ?)", [cleanPhone(from), rawText, reply]);
        return;
      }
    } catch (apiErr) {
      console.error("NVIDIA RAG API Call failed:", apiErr.message);
    }
  }
  
  // Welcome fallback
  const welcome = T.welcome[lang].replace('{merchant_name}', merchantName);
  await sock.sendMessage(from, { text: welcome });
  await dbRun("INSERT INTO whatsapp_logs (phone, message, reply) VALUES (?, ?, ?)", [cleanPhone(from), rawText, welcome]);
}

// Auto start client if creds.json exists to persist session across restarts
const authDir = path.join(path.dirname(dbPath), 'auth_info_baileys');
const credsExists = fs.existsSync(path.join(authDir, 'creds.json'));
if (credsExists) {
  startClient().catch(err => console.error('Failed to auto-start WhatsApp client:', err));
}

module.exports = {
  getStatus,
  getLogs,
  startClient,
  logoutClient,
  handleIncomingMessage,
  sendManualMessage
};
