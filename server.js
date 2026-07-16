const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const whatsapp = require('./whatsapp');

const upload = multer({ dest: '/tmp/' });

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure database directory exists
const dbPath = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize SQLite database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    initializeDatabase();
  }
});

// Helper functions wrapping sqlite3 in Promises
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) {
    if (err) reject(err);
    else resolve({ id: this.lastID, changes: this.changes });
  });
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) reject(err);
    else resolve(row);
  });
});

async function initializeDatabase() {
  try {
    // Tickets Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        price REAL NOT NULL,
        description TEXT,
        is_active INTEGER DEFAULT 1
      )
    `);

    // Safe migration: Add is_active column if it doesn't exist
    try {
      await dbRun('ALTER TABLE tickets ADD COLUMN is_active INTEGER DEFAULT 1');
      console.log('Added is_active column to tickets.');
    } catch (e) {
      // Column already exists, ignore
    }

    // Safe migration: Add discount column if it doesn't exist
    try {
      await dbRun('ALTER TABLE tickets ADD COLUMN discount REAL DEFAULT 0');
      console.log('Added discount column to tickets.');
    } catch (e) {
      // Column already exists, ignore
    }

    // Recreate invoices table if it does not have 'items' column (for migration)
    let dropInvoices = false;
    try {
      await dbGet('SELECT items FROM invoices LIMIT 1');
    } catch (e) {
      dropInvoices = true;
    }

    if (dropInvoices) {
      console.log('Migrating invoices table to support multiple items...');
      await dbRun('DROP TABLE IF EXISTS invoices');
    }

    // Invoices Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        total_price REAL NOT NULL,
        down_payment REAL DEFAULT 0,
        payment_method TEXT,
        status TEXT DEFAULT 'Unpaid',
        voucher_code TEXT UNIQUE,
        visit_date TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        items TEXT NOT NULL
      )
    `);

    // Safe migration: Add down_payment column to invoices if it doesn't exist
    try {
      await dbRun('ALTER TABLE invoices ADD COLUMN down_payment REAL DEFAULT 0');
      console.log('Added down_payment column to invoices.');
    } catch (e) {
      // Column already exists, ignore
    }

    // Redemptions Table (to track double scanning)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS redemptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        voucher_code TEXT UNIQUE NOT NULL,
        redeemed_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Seed default tickets if empty
    const tickets = await dbAll('SELECT * FROM tickets');
    if (tickets.length === 0) {
      await dbRun('INSERT INTO tickets (title, price, description, is_active) VALUES (?, ?, ?, 1)', [
        'High Season - Tiket Masuk (Dewasa)',
        150000.00,
        'Tiket masuk kategori Dewasa untuk periode High Season.'
      ]);
      await dbRun('INSERT INTO tickets (title, price, description, is_active) VALUES (?, ?, ?, 0)', [
        'High Season - Tiket Masuk (Anak)',
        90000.00,
        'Tiket masuk kategori Anak-anak untuk periode High Season.'
      ]);
      await dbRun('INSERT INTO tickets (title, price, description, is_active) VALUES (?, ?, ?, 1)', [
        'High Season - Tiket Masuk (Pelajar/Mahasiswa)',
        120000.00,
        'Tiket masuk kategori Pelajar/Mahasiswa (menunjukkan kartu identitas).'
      ]);
      console.log('Seeded initial tickets.');
    }

    // Settings Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    // WhatsApp Logs Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS whatsapp_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT,
        message TEXT,
        reply TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Seed default settings
    const defaultSettings = [
      { key: 'merchant_name', value: 'Batur Natural Hot Spring' },
      { key: 'merchant_address', value: 'Toya Bungkah, Kintamani, Bangli, Bali' },
      { key: 'merchant_website', value: 'www.baturhotspring.com' },
      { key: 'merchant_email', value: 'info@baturhotspring.com' },
      { key: 'merchant_phone', value: '+62 812-3456-7890' },
      { key: 'merchant_logo_url', value: 'https://lh3.googleusercontent.com/aida/AP1WRLtiJ2K5eJTLjE8W7HzdMaUiQ08NqXBYN0NkHKcqPP927qeFtN-qilPR7-uIB-s_CmqdUTMB8yvgtAkSN5WMRu41-aTsWFU0pvTpPtYwqbVPCZXdGWDnSaYcbZBZl2u-lReVLYLPz6FECLtkHrc0TjMyeuzgmCjmwHqLPYiMkhXfePfB-dhd2zGBblCXN_dOL4i-ToFSBtDRAfHVk8UjpexxOnmFrdDuSFa_pfL0aBrRlEs1v1OR-ekiYIw' },
      { key: 'merchant_terms', value: 'Vouchers are non-refundable but can be rescheduled up to 24 hours before the reservation date. Please present the QR code sent to your WhatsApp number at the main entrance gate.' },
      { key: 'merchant_payment_instructions', value: 'Bank Transfer:\nBank Jago — 103494729785\na.n. Ida Ayu Gede Anindyatari\nSwift: JAGBIDJA\n\nPayPal:\narcomteknologi@gmail.com\n\nPlease send proof of payment to confirm your booking.' },
      { key: 'ninerouter_url', value: 'http://localhost:20128' },
      { key: 'ninerouter_key', value: '' },
      { key: 'ninerouter_model', value: 'gpt-4o-mini' },
      { key: 'nvidia_api_key', value: '' },
      { key: 'nvidia_model', value: 'nvidia/llama-3.1-nemotron-70b-instruct' },
      { key: 'waha_url', value: 'http://localhost:3006' },
      { key: 'primary_color', value: '#000000' },
      { key: 'secondary_color', value: '#006c4a' },
      { key: 'background_color', value: '#f8f9ff' },
      { key: 'tax_rate', value: '0' },
      { key: 'service_fee', value: '0' },
      { key: 'discount_rate', value: '0' },
      { key: 'discount_label', value: 'Diskon' }
    ];

    for (const setting of defaultSettings) {
      const row = await dbGet('SELECT * FROM settings WHERE key = ?', [setting.key]);
      if (!row) {
        await dbRun('INSERT INTO settings (key, value) VALUES (?, ?)', [setting.key, setting.value]);
      }
    }
    console.log('Database settings table initialized.');

    // Create Payment Methods Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS payment_methods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        instructions TEXT DEFAULT '',
        is_active INTEGER DEFAULT 1
      )
    `);

    // Safe migration: Add instructions column to payment_methods if it doesn't exist
    try {
      await dbRun('ALTER TABLE payment_methods ADD COLUMN instructions TEXT DEFAULT \'\'');
      console.log('Added instructions column to payment_methods.');
    } catch (e) {
      // Column already exists, ignore
    }

    // Seed default payment methods if empty
    const pms = await dbAll('SELECT * FROM payment_methods');
    if (pms.length === 0) {
      await dbRun('INSERT INTO payment_methods (name, instructions, is_active) VALUES (?, ?, 1)', ['Tunai', 'Pembayaran langsung secara tunai di kasir/front office saat kedatangan.']);
      await dbRun('INSERT INTO payment_methods (name, instructions, is_active) VALUES (?, ?, 1)', ['Transfer Bank', 'Silakan lakukan transfer ke:\nBank name: Bank Jago\nAccount number: 103494729785\nAccount name: Ida Ayu Gede Anindyatari\nSwift code: JAGBIDJA\n\nHarap kirimkan bukti transfer untuk konfirmasi.']);
      await dbRun('INSERT INTO payment_methods (name, instructions, is_active) VALUES (?, ?, 1)', ['QRIS', 'Silakan scan QRIS resmi merchant yang tersedia di kasir atau tanyakan ke petugas kami untuk penyediaan barcode.']);
      await dbRun('INSERT INTO payment_methods (name, instructions, is_active) VALUES (?, ?, 1)', ['Debit Card', 'Gunakan kartu debit Anda langsung di mesin EDC kasir saat kedatangan.']);
      console.log('Seeded initial payment methods.');
    }

    // Create Chatbot Sessions Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS chatbot_sessions (
        phone TEXT PRIMARY KEY,
        step INTEGER DEFAULT 0,
        timestamp REAL,
        name TEXT,
        ticket_id INTEGER,
        quantity INTEGER,
        payment_method TEXT,
        bot_mode TEXT DEFAULT 'bot',
        ticket_status TEXT DEFAULT 'closed',
        ticket_subject TEXT
      )
    `);
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Simple Auth Middleware
const authenticateToken = async (req, res, next) => {
  const token = req.headers['authorization'];
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized access. Token missing.' });
  }

  // Allow static admin token
  if (token === 'admin-secret-token') {
    return next();
  }

  // Also check if it's a dynamic chatbot token/session from database
  try {
    const session = await dbGet('SELECT phone FROM chatbot_sessions WHERE phone = ?', [token]);
    if (session) {
      return next();
    }
  } catch (err) {
    console.error('Error verifying chatbot session token:', err);
  }

  res.status(401).json({ error: 'Unauthorized access. Please login.' });
};

// Auth endpoint
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  console.log(`Login attempt: username="${username}", password="${password}"`);
  // Simple credential verification
  if (username === 'admin' && password === 'admin123') {
    console.log('Login successful');
    res.json({ token: 'admin-secret-token', role: 'admin' });
  } else {
    console.log(`Login failed: username match=${username === 'admin'}, password match=${password === 'admin123'}`);
    res.status(400).json({ error: 'Invalid username or password' });
  }
});

// Tickets API
app.get('/api/tickets', async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM tickets');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tickets', authenticateToken, async (req, res) => {
  const { title, price, description, is_active, discount } = req.body;
  if (!title || !price) {
    return res.status(400).json({ error: 'Title and Price are required' });
  }
  try {
    const result = await dbRun(
      'INSERT INTO tickets (title, price, description, is_active, discount) VALUES (?, ?, ?, ?, ?)',
      [title, parseFloat(price), description, is_active !== undefined ? is_active : 1, parseFloat(discount) || 0]
    );
    res.status(201).json({ id: result.id, title, price, description, is_active: is_active !== undefined ? is_active : 1, discount: parseFloat(discount) || 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/tickets/:id', authenticateToken, async (req, res) => {
  const { title, price, description, is_active, discount } = req.body;
  const { id } = req.params;
  try {
    await dbRun(
      'UPDATE tickets SET title = ?, price = ?, description = ?, is_active = ?, discount = ? WHERE id = ?',
      [title, parseFloat(price), description, is_active !== undefined ? is_active : 1, parseFloat(discount) || 0, id]
    );
    res.json({ message: 'Ticket updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/tickets/:id/toggle', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const ticket = await dbGet('SELECT is_active FROM tickets WHERE id = ?', [id]);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    const newStatus = ticket.is_active === 1 ? 0 : 1;
    await dbRun('UPDATE tickets SET is_active = ? WHERE id = ?', [newStatus, id]);
    res.json({ id: parseInt(id), is_active: newStatus });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/tickets/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun('DELETE FROM tickets WHERE id = ?', [id]);
    res.json({ message: 'Ticket deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Invoices API
app.get('/api/invoices', async (req, res) => {
  try {
    const query = `
      SELECT invoices.*,
      CASE WHEN redemptions.voucher_code IS NOT NULL THEN 'Redeemed' ELSE invoices.status END as current_status,
      payment_methods.instructions as payment_instructions
      FROM invoices 
      LEFT JOIN redemptions ON invoices.voucher_code = redemptions.voucher_code
      LEFT JOIN payment_methods ON invoices.payment_method = payment_methods.name
      ORDER BY invoices.id DESC
    `;
    const rows = await dbAll(query);
    rows.forEach(r => {
      r.items = JSON.parse(r.items || '[]');
    });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/invoices', authenticateToken, async (req, res) => {
  const { customerName, items, paymentMethod, visitDate, downPayment } = req.body;
  if (!customerName || !items || !items.length || !paymentMethod) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    let totalPrice = 0;
    const validatedItems = [];
    for (const item of items) {
      const ticket = await dbGet('SELECT * FROM tickets WHERE id = ?', [item.ticketId]);
      if (!ticket) {
        return res.status(404).json({ error: `Ticket type ${item.ticketId} not found` });
      }
      const itemTotalPrice = (ticket.price - (ticket.discount || 0)) * item.quantity;
      totalPrice += itemTotalPrice;
      validatedItems.push({
        ticket_id: ticket.id,
        ticket_title: ticket.title,
        ticket_price: ticket.price,
        ticket_discount: ticket.discount || 0,
        quantity: item.quantity,
        total_price: itemTotalPrice
      });
    }

    const dpValue = parseFloat(downPayment) || 0;
    let initialStatus = 'Unpaid';
    let voucherCode = null;

    if (dpValue >= totalPrice) {
      initialStatus = 'Paid';
      const randomHex = Math.random().toString(36).substring(2, 8).toUpperCase();
      voucherCode = `VCH-${Date.now().toString().slice(-6)}-${randomHex}`;
    } else if (dpValue > 0) {
      initialStatus = 'DP';
    }

    const result = await dbRun(
      'INSERT INTO invoices (customer_name, total_price, down_payment, payment_method, status, voucher_code, visit_date, items) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [customerName, totalPrice, dpValue, paymentMethod, initialStatus, voucherCode, visitDate || null, JSON.stringify(validatedItems)]
    );

    res.status(201).json({
      id: result.id,
      customer_name: customerName,
      total_price: totalPrice,
      down_payment: dpValue,
      payment_method: paymentMethod,
      status: initialStatus,
      voucher_code: voucherCode,
      visit_date: visitDate || null,
      items: validatedItems
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/invoices/:id/pay', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const invoice = await dbGet('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Generate voucher code on full payment
    let voucherCode = invoice.voucher_code;
    if (!voucherCode) {
      const randomHex = Math.random().toString(36).substring(2, 8).toUpperCase();
      voucherCode = `VCH-${Date.now().toString().slice(-6)}-${randomHex}`;
    }

    await dbRun(
      "UPDATE invoices SET status = 'Paid', down_payment = ?, voucher_code = ? WHERE id = ?",
      [invoice.total_price, voucherCode, id]
    );
    res.json({ message: 'Payment confirmed successfully', status: 'Paid', voucher_code: voucherCode });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add payment (partial/DP) to invoice
app.post('/api/invoices/:id/add-payment', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { amount } = req.body;
  try {
    const invoice = await dbGet('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    if (invoice.status === 'Paid') {
      return res.status(400).json({ error: 'Invoice already fully paid' });
    }

    const addAmount = parseFloat(amount) || 0;
    if (addAmount <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }

    const newDP = (invoice.down_payment || 0) + addAmount;
    const isFullyPaid = newDP >= invoice.total_price;
    const newStatus = isFullyPaid ? 'Paid' : 'DP';

    let voucherCode = invoice.voucher_code;
    if (isFullyPaid && !voucherCode) {
      const randomHex = Math.random().toString(36).substring(2, 8).toUpperCase();
      voucherCode = `VCH-${Date.now().toString().slice(-6)}-${randomHex}`;
    }

    await dbRun(
      'UPDATE invoices SET down_payment = ?, status = ?, voucher_code = ? WHERE id = ?',
      [newDP, newStatus, voucherCode, id]
    );

    res.json({
      message: isFullyPaid ? 'Payment complete! Voucher issued.' : 'Down payment recorded.',
      status: newStatus,
      down_payment: newDP,
      remaining: Math.max(0, invoice.total_price - newDP),
      voucher_code: voucherCode
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Voucher scan and redemption logic
app.get('/api/vouchers/:code', async (req, res) => {
  const { code } = req.params;
  try {
    let baseCode = code;
    let itemIndex = null;
    const parts = code.split('-');
    if (parts.length > 3) {
      baseCode = parts.slice(0, 3).join('-');
      itemIndex = parseInt(parts[3]) - 1; // 0-based index
    }

    const invoice = await dbGet(
      `SELECT invoices.*
       FROM invoices
       WHERE invoices.voucher_code = ?`,
      [baseCode]
    );

    if (!invoice) {
      return res.status(404).json({ error: 'Voucher code invalid or not found' });
    }

    invoice.items = JSON.parse(invoice.items || '[]');

    // If no itemIndex (i.e. it's the main invoice code), find all redeemed items starting with this baseCode
    if (itemIndex === null) {
      const redemptions = await dbAll('SELECT voucher_code FROM redemptions WHERE voucher_code LIKE ?', [`${baseCode}%`]);
      const redeemedItemsList = redemptions.map(r => r.voucher_code);
      
      // An invoice is fully redeemed if ALL items are redeemed
      const allItemsRedeemed = invoice.items.length > 0 && invoice.items.every((item, idx) => 
        redeemedItemsList.includes(`${baseCode}-${idx + 1}`)
      );

      res.json({
        ...invoice,
        redeemed: allItemsRedeemed || redeemedItemsList.includes(baseCode),
        redeemed_items: redeemedItemsList
      });
    } else {
      // It's a specific item code
      const redemption = await dbGet('SELECT * FROM redemptions WHERE voucher_code = ?', [code]);
      const item = invoice.items[itemIndex];
      
      if (!item) {
        return res.status(404).json({ error: 'Ticket item index invalid.' });
      }

      res.json({
        ...invoice,
        voucher_code: code, // Override with the item-specific voucher code
        items: [item],       // Only return the item being scanned
        redeemed: !!redemption,
        redeemed_at: redemption ? redemption.redeemed_at : null
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/vouchers/:code/redeem', async (req, res) => {
  const { code } = req.params;
  try {
    let baseCode = code;
    let itemIndex = null;
    const parts = code.split('-');
    if (parts.length > 3) {
      baseCode = parts.slice(0, 3).join('-');
      itemIndex = parseInt(parts[3]) - 1; // 0-based index
    }

    const invoice = await dbGet('SELECT * FROM invoices WHERE voucher_code = ?', [baseCode]);
    if (!invoice) {
      return res.status(404).json({ error: 'Invalid voucher code.' });
    }

    if (invoice.status !== 'Paid') {
      return res.status(400).json({ error: 'Voucher payment has not been confirmed.' });
    }

    // Check if already redeemed
    const redemption = await dbGet('SELECT * FROM redemptions WHERE voucher_code = ?', [code]);
    if (redemption) {
      return res.status(400).json({ error: 'This voucher has ALREADY been scanned and redeemed.' });
    }

    // Insert redemption
    await dbRun('INSERT INTO redemptions (voucher_code) VALUES (?)', [code]);
    invoice.items = JSON.parse(invoice.items || '[]');

    let redeemedItems = invoice.items;
    if (itemIndex !== null) {
      const item = invoice.items[itemIndex];
      if (item) {
        redeemedItems = [item];
      }
    }

    res.json({
      message: 'Voucher successfully redeemed!',
      customer_name: invoice.customer_name,
      items: redeemedItems,
      redeemed_at: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Settings API endpoints
app.get('/api/settings', async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM settings');
    const settingsObj = {};
    rows.forEach(r => {
      settingsObj[r.key] = r.value;
    });
    res.json(settingsObj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Internal API routes for Chatbot Python (Single Writer pattern)
app.get('/api/internal/settings', async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM settings');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/internal/tickets', async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM tickets WHERE is_active = 1');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/internal/payment-methods', async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM payment_methods WHERE is_active = 1 ORDER BY name ASC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/internal/invoices', async (req, res) => {
  const { customer_name, total_price, down_payment, payment_method, status, voucher_code, items } = req.body;
  try {
    const result = await dbRun(
      'INSERT INTO invoices (customer_name, total_price, down_payment, payment_method, status, voucher_code, items) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [customer_name, total_price, down_payment || 0, payment_method, status, voucher_code, items]
    );
    res.status(201).json({ id: result.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/internal/session/:phone', async (req, res) => {
  try {
    const row = await dbGet('SELECT * FROM chatbot_sessions WHERE phone = ?', [req.params.phone]);
    res.json(row || null);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/internal/session/:phone', async (req, res) => {
  const { step, timestamp, name, ticket_id, quantity, payment_method, bot_mode, ticket_status, ticket_subject, lang } = req.body;
  try {
    await dbRun(
      `INSERT OR REPLACE INTO chatbot_sessions 
       (phone, step, timestamp, name, ticket_id, quantity, payment_method, bot_mode, ticket_status, ticket_subject, lang)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.phone, step, timestamp, name, ticket_id, quantity, payment_method, bot_mode, ticket_status, ticket_subject, lang]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/internal/session/clear-expired', async (req, res) => {
  const { timeoutSec } = req.body;
  const cutoff = (Date.now() / 1000) - (timeoutSec || 300);
  try {
    const expired = await dbAll('SELECT phone FROM chatbot_sessions WHERE step > 0 AND timestamp < ?', [cutoff]);
    for (const r of expired) {
      await dbRun(
        `UPDATE chatbot_sessions 
         SET step = 0, name = NULL, ticket_id = NULL, quantity = NULL, payment_method = NULL 
         WHERE phone = ?`,
        [r.phone]
      );
    }
    res.json(expired);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/internal/logs', async (req, res) => {
  const { phone, message, reply } = req.body;
  try {
    await dbRun(
      'INSERT INTO whatsapp_logs (phone, message, reply) VALUES (?, ?, ?)',
      [phone, message, reply]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/settings', authenticateToken, async (req, res) => {
  const settingsData = req.body;
  try {
    for (const [key, value] of Object.entries(settingsData)) {
      await dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
    }
    res.json({ message: 'Settings updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Database Management endpoints
app.get('/api/admin/database/backup', authenticateToken, (req, res) => {
  if (!fs.existsSync(dbPath)) {
    return res.status(404).json({ error: 'Database file not found.' });
  }
  res.download(dbPath, 'database.sqlite');
});

app.post('/api/admin/database/reset', authenticateToken, async (req, res) => {
  try {
    await dbRun('DROP TABLE IF EXISTS redemptions');
    await dbRun('DROP TABLE IF EXISTS invoices');
    await dbRun('DROP TABLE IF EXISTS whatsapp_logs');
    await dbRun('DROP TABLE IF EXISTS settings');
    await dbRun('DROP TABLE IF EXISTS payment_methods');
    
    await initializeDatabase();
    res.json({ message: 'Database reset successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/database/restore', authenticateToken, upload.single('backup'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No backup file uploaded.' });
    }

    const tempPath = req.file.path;

    // Verify it is a valid sqlite file
    const header = fs.readFileSync(tempPath, { encoding: 'utf8', flag: 'r' }).slice(0, 15);
    if (header !== 'SQLite format 3') {
      fs.unlinkSync(tempPath);
      return res.status(400).json({ error: 'Invalid backup file. Must be a valid SQLite database file.' });
    }

    // Send success response first before closing and exiting
    res.json({ message: 'Database successfully restored. Restarting application...' });

    // In the background, close db, replace file, and exit to trigger Docker restart
    setTimeout(() => {
      db.close((err) => {
        try {
          fs.copyFileSync(tempPath, dbPath);
          fs.unlinkSync(tempPath);
          console.log('Database restored. Exiting process for container restart.');
          process.exit(0);
        } catch (copyErr) {
          console.error('Error replacing database file during restore:', copyErr.message);
          process.exit(1);
        }
      });
    }, 1000);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Payment Methods API
app.get('/api/payment-methods', async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM payment_methods ORDER BY name ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/payment-methods', authenticateToken, async (req, res) => {
  const { name, instructions } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const result = await dbRun('INSERT INTO payment_methods (name, instructions, is_active) VALUES (?, ?, 1)', [name, instructions || '']);
    res.status(201).json({ id: result.lastID, name, instructions: instructions || '', is_active: 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/payment-methods/:id', authenticateToken, async (req, res) => {
  const { name, instructions, is_active } = req.body;
  try {
    await dbRun('UPDATE payment_methods SET name = ?, instructions = ?, is_active = ? WHERE id = ?', [name, instructions || '', is_active, req.params.id]);
    res.json({ id: req.params.id, name, instructions, is_active });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/payment-methods/:id', authenticateToken, async (req, res) => {
  try {
    await dbRun('DELETE FROM payment_methods WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helpdesk API routes
app.get('/api/helpdesk/chats', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        wl.phone,
        COALESCE(cs.name, '') as name,
        COALESCE(cs.bot_mode, 'bot') as bot_mode,
        COALESCE(cs.ticket_status, 'closed') as ticket_status,
        COALESCE(cs.ticket_subject, '') as ticket_subject,
        MAX(wl.timestamp) as last_activity,
        (SELECT message FROM whatsapp_logs WHERE phone = wl.phone ORDER BY id DESC LIMIT 1) as last_message,
        (SELECT reply FROM whatsapp_logs WHERE phone = wl.phone ORDER BY id DESC LIMIT 1) as last_reply
      FROM whatsapp_logs wl
      LEFT JOIN chatbot_sessions cs ON wl.phone = cs.phone
      GROUP BY wl.phone
      ORDER BY last_activity DESC
    `;
    const rows = await dbAll(query);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/helpdesk/chats/:phone', authenticateToken, async (req, res) => {
  const { phone } = req.params;
  try {
    const logs = await dbAll('SELECT * FROM whatsapp_logs WHERE phone = ? ORDER BY id ASC', [phone]);
    const session = await dbGet('SELECT * FROM chatbot_sessions WHERE phone = ?', [phone]);
    res.json({
      logs: logs.map(l => ({
        id: l.id,
        phone: l.phone,
        message: l.message,
        reply: l.reply,
        timestamp: l.timestamp
      })),
      session: session || { phone, bot_mode: 'bot', ticket_status: 'closed', step: 0 }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/helpdesk/sessions/:phone/toggle-bot', authenticateToken, async (req, res) => {
  const { phone } = req.params;
  const { bot_mode } = req.body;
  try {
    const existing = await dbGet('SELECT phone FROM chatbot_sessions WHERE phone = ?', [phone]);
    if (existing) {
      await dbRun('UPDATE chatbot_sessions SET bot_mode = ? WHERE phone = ?', [bot_mode, phone]);
    } else {
      await dbRun('INSERT INTO chatbot_sessions (phone, bot_mode, ticket_status) VALUES (?, ?, ?)', [phone, bot_mode, 'closed']);
    }
    res.json({ success: true, phone, bot_mode });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/helpdesk/sessions/:phone/toggle-ticket', authenticateToken, async (req, res) => {
  const { phone } = req.params;
  const { ticket_status } = req.body;
  try {
    const existing = await dbGet('SELECT phone FROM chatbot_sessions WHERE phone = ?', [phone]);
    if (existing) {
      await dbRun('UPDATE chatbot_sessions SET ticket_status = ? WHERE phone = ?', [ticket_status, phone]);
    } else {
      await dbRun('INSERT INTO chatbot_sessions (phone, bot_mode, ticket_status) VALUES (?, ?, ?)', [phone, 'bot', ticket_status]);
    }
    res.json({ success: true, phone, ticket_status });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/helpdesk/sessions/:phone/message', authenticateToken, async (req, res) => {
  const { phone } = req.params;
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Message text is required' });
  }
  try {
    const wahaRow = await dbGet("SELECT value FROM settings WHERE key = 'waha_url'");
    const wahaUrl = (wahaRow && wahaRow.value) || 'http://localhost:3006';
    const chat_id = phone.includes('@') ? phone : `${phone}@c.us`;
    const wahaPayload = {
      session: "default",
      chatId: chat_id,
      text: text
    };
    
    console.log(`Sending manual helpdesk message via WAHA: ${wahaUrl}/api/sendText`, wahaPayload);
    const wahaRes = await fetch(`${wahaUrl}/api/sendText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(wahaPayload)
    });
    
    if (!wahaRes.ok) {
      const errText = await wahaRes.text();
      throw new Error(`WAHA API returned status ${wahaRes.status}: ${errText}`);
    }
    
    const existing = await dbGet('SELECT phone FROM chatbot_sessions WHERE phone = ?', [phone]);
    if (existing) {
      await dbRun("UPDATE chatbot_sessions SET bot_mode = 'agent' WHERE phone = ?", [phone]);
    } else {
      await dbRun("INSERT INTO chatbot_sessions (phone, bot_mode, ticket_status) VALUES (?, 'agent', 'open')", [phone]);
    }
    
    await dbRun("INSERT INTO whatsapp_logs (phone, message, reply) VALUES (?, '', ?)", [phone, text]);
    res.json({ success: true, phone, reply: text });
  } catch (error) {
    console.error('Error sending manual helpdesk message:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// WhatsApp API routes
app.get('/api/whatsapp/status', authenticateToken, (req, res) => {
  res.json(whatsapp.getStatus());
});

app.post('/api/whatsapp/start', authenticateToken, async (req, res) => {
  try {
    await whatsapp.startClient();
    res.json({ message: 'WhatsApp bot starting...' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/whatsapp/logout', authenticateToken, async (req, res) => {
  try {
    await whatsapp.logoutClient();
    res.json({ message: 'WhatsApp bot logged out and disconnected.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/whatsapp/logs', authenticateToken, (req, res) => {
  res.json(whatsapp.getLogs());
});

// WAHA Webhook Endpoint
app.post('/api/whatsapp/webhook', async (req, res) => {
  try {
    const { event, payload } = req.body;
    // Handle incoming messages that are not sent by the bot itself
    if ((event === 'message' || event === 'message.any') && payload && !payload.fromMe) {
      const from = payload.from;
      const text = (payload.body || '').trim();
      if (from && text && whatsapp.handleIncomingMessage) {
        // Run asynchronously to reply quickly to the webhook
        whatsapp.handleIncomingMessage(from, text).catch(err => {
          console.error('Error in handleIncomingMessage:', err);
        });
      }
    }
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook processing error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Fallback to HTML client for other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  // Start WhatsApp bot connection on startup
  whatsapp.startClient().catch(err => console.error('Failed to start WhatsApp bot:', err));
});
