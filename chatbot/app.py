import os
import re
import math
import sqlite3
import random
import time
import requests
from collections import Counter
from flask import Flask, request, jsonify

app = Flask(__name__)

# Resolve SQLite database path (Dummy since we use HTTP API to prevent locking)
def get_db_path():
    return 'database.sqlite'

# Initialize Logs Table (Dummy since generator handles SQLite schema)
def init_db():
    pass

GENERATOR_URL = os.environ.get('GENERATOR_URL', 'http://voucher-generator:3000')

# DB Helpers over HTTP API (Single Writer Pattern)
def db_get(query, params=()):
    query_lower = query.lower()
    if "settings" in query_lower:
        try:
            r = requests.get(f"{GENERATOR_URL}/api/internal/settings", timeout=5)
            if r.status_code == 200:
                rows = r.json() # list of {key, value}
                if "waha_url" in query_lower:
                    for row in rows:
                        if row.get('key') == 'waha_url':
                            return row
                for row in rows:
                    if len(params) > 0 and row.get('key') == params[0]:
                        return row
        except Exception as e:
            print(f"Error fetching settings from generator: {e}")
    elif "chatbot_sessions" in query_lower:
        phone = params[0]
        try:
            r = requests.get(f"{GENERATOR_URL}/api/internal/session/{phone}", timeout=5)
            if r.status_code == 200:
                return r.json()
        except Exception as e:
            print(f"Error fetching session {phone} from generator: {e}")
    elif "tickets" in query_lower:
        ticket_id = params[0]
        try:
            r = requests.get(f"{GENERATOR_URL}/api/internal/tickets", timeout=5)
            if r.status_code == 200:
                tickets = r.json()
                for t in tickets:
                    if t.get('id') == ticket_id:
                        return t
        except Exception as e:
            print(f"Error fetching ticket {ticket_id} from generator: {e}")
    return None

def get_waha_url():
    waha_env = os.environ.get('WAHA_URL')
    if waha_env:
        return waha_env
    waha_url_row = db_get("SELECT value FROM settings WHERE key = 'waha_url'")
    if waha_url_row and waha_url_row.get('value'):
        return waha_url_row['value']
    return 'http://localhost:3006'

def db_all(query, params=()):
    query_lower = query.lower()
    if "settings" in query_lower:
        try:
            r = requests.get(f"{GENERATOR_URL}/api/internal/settings", timeout=5)
            if r.status_code == 200:
                return r.json()
        except Exception as e:
            print(f"Error fetching all settings from generator: {e}")
    elif "tickets" in query_lower:
        try:
            r = requests.get(f"{GENERATOR_URL}/api/internal/tickets", timeout=5)
            if r.status_code == 200:
                return r.json()
        except Exception as e:
            print(f"Error fetching active tickets from generator: {e}")
    elif "payment_methods" in query_lower:
        try:
            r = requests.get(f"{GENERATOR_URL}/api/internal/payment-methods", timeout=5)
            if r.status_code == 200:
                return r.json()
        except Exception as e:
            print(f"Error fetching active payment methods from generator: {e}")
    elif "chatbot_sessions" in query_lower:
        # Used for clearing expired sessions. For safety, return empty list or hit internal API.
        # Chatbot app.py clean_expired_sessions query: SELECT phone FROM chatbot_sessions WHERE step > 0 AND ? - timestamp > ?
        # We can implement clean_expired_sessions by querying local generator API if needed.
        pass
    return []

def db_run(query, params=()):
    query_lower = query.lower()
    if "insert" in query_lower and "invoices" in query_lower:
        # params: (session['name'], total_bill, session['paymentMethod'], 'Unpaid', voucher_code, items_json)
        payload = {
            "customer_name": params[0],
            "total_price": params[1],
            "payment_method": params[2],
            "status": params[3],
            "voucher_code": params[4],
            "items": params[5]
        }
        try:
            r = requests.post(f"{GENERATOR_URL}/api/internal/invoices", json=payload, timeout=5)
            if r.status_code == 201:
                return r.json() # {"id": last_id}
        except Exception as e:
            print(f"Error posting invoice to generator: {e}")
    elif "insert" in query_lower and "chatbot_sessions" in query_lower:
        # params: (phone, step, timestamp, name, ticket_id, quantity, payment_method, bot_mode, ticket_status, ticket_subject, lang)
        phone = params[0]
        payload = {
            "step": params[1],
            "timestamp": params[2],
            "name": params[3],
            "ticket_id": params[4],
            "quantity": params[5],
            "payment_method": params[6],
            "bot_mode": params[7],
            "ticket_status": params[8],
            "ticket_subject": params[9],
            "lang": params[10]
        }
        try:
            requests.post(f"{GENERATOR_URL}/api/internal/session/{phone}", json=payload, timeout=5)
        except Exception as e:
            print(f"Error updating session {phone} on generator: {e}")
    elif "update" in query_lower and "chatbot_sessions" in query_lower:
        # Delete/Reset session query is an UPDATE query
        # params is (cleaned,)
        phone = params[0]
        payload = {
            "step": 0,
            "timestamp": time.time(),
            "name": None,
            "ticket_id": None,
            "quantity": None,
            "payment_method": None,
            "bot_mode": "bot",
            "ticket_status": "closed",
            "ticket_subject": None,
            "lang": "id"
        }
        try:
            requests.post(f"{GENERATOR_URL}/api/internal/session/{phone}", json=payload, timeout=5)
        except Exception as e:
            print(f"Error resetting session {phone} on generator: {e}")
    elif "insert" in query_lower and "whatsapp_logs" in query_lower:
        # params: (phone, message, reply)
        payload = {
            "phone": params[0],
            "message": params[1],
            "reply": params[2]
        }
        try:
            requests.post(f"{GENERATOR_URL}/api/internal/logs", json=payload, timeout=5)
        except Exception as e:
            print(f"Error posting log to generator: {e}")
    return {"id": 0, "changes": 0}

# Chatbot Session Helpers (Database-Backed)
SESSION_TIMEOUT = 5 * 60  # 5 minutes

def clean_phone(phone):
    return phone.replace('@s.whatsapp.net', '').replace('@c.us', '').strip()

def get_session(phone):
    cleaned = clean_phone(phone)
    row = db_get("SELECT * FROM chatbot_sessions WHERE phone = ?", (cleaned,))
    if not row:
        return None
    session = {
        'step': row['step'],
        'timestamp': row['timestamp'],
        'name': row['name'],
        'paymentMethod': row['payment_method'],
        'bot_mode': row['bot_mode'],
        'ticket_status': row['ticket_status'],
        'ticket_subject': row['ticket_subject'],
        'lang': row.get('lang', 'id')
    }
    if row['ticket_id']:
        ticket = db_get("SELECT * FROM tickets WHERE id = ?", (row['ticket_id'],))
        session['ticket'] = ticket
    else:
        session['ticket'] = None
    session['quantity'] = row['quantity']
    
    # Load available tickets
    tickets = db_all("SELECT * FROM tickets WHERE is_active = 1")
    session['availableTickets'] = tickets
    
    # Load payment methods
    active_payments = db_all("SELECT * FROM payment_methods WHERE is_active = 1 ORDER BY name ASC")
    if not active_payments:
        active_payments = [{'name': 'Tunai'}, {'name': 'Transfer Bank'}, {'name': 'QRIS'}]
    session['availablePayments'] = active_payments
    return session

def save_session(phone, session):
    cleaned = clean_phone(phone)
    ticket_id = session.get('ticket', {}).get('id') if session.get('ticket') else None
    db_run(
        """INSERT OR REPLACE INTO chatbot_sessions 
           (phone, step, timestamp, name, ticket_id, quantity, payment_method, bot_mode, ticket_status, ticket_subject, lang) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            cleaned,
            session.get('step', 0),
            session.get('timestamp', time.time()),
            session.get('name'),
            ticket_id,
            session.get('quantity'),
            session.get('paymentMethod'),
            session.get('bot_mode', 'bot'),
            session.get('ticket_status', 'open'),
            session.get('ticket_subject'),
            session.get('lang', 'id')
        )
    )

def delete_session(phone):
    cleaned = clean_phone(phone)
    db_run(
        """UPDATE chatbot_sessions 
           SET step = 0, name = NULL, ticket_id = NULL, quantity = NULL, payment_method = NULL 
           WHERE phone = ?""",
        (cleaned,)
    )

def clear_expired_sessions():
    try:
        r = requests.post(f"{GENERATOR_URL}/api/internal/session/clear-expired", json={"timeoutSec": SESSION_TIMEOUT}, timeout=5)
        if r.status_code == 200:
            expired = r.json()
            if expired:
                print(f"Cleared expired sessions for: {expired}")
    except Exception as e:
        print(f"Error clearing expired sessions: {e}")

# Pure Python Cosine Similarity & TF-IDF for RAG
def tokenize(text):
    return re.findall(r'\w+', text.lower())

def calculate_cosine_similarity(str1, str2):
    vec1 = Counter(tokenize(str1))
    vec2 = Counter(tokenize(str2))
    intersection = set(vec1.keys()) & set(vec2.keys())
    numerator = sum([vec1[x] * vec2[x] for x in intersection])
    sum1 = sum([vec1[x]**2 for x in vec1.keys()])
    sum2 = sum([vec2[x]**2 for x in vec2.keys()])
    denominator = math.sqrt(sum1) * math.sqrt(sum2)
    if not denominator:
        return 0.0
    return float(numerator) / denominator

def get_relevant_context(query, knowledge_paragraphs, top_n=3):
    scored = []
    for p in knowledge_paragraphs:
        similarity = calculate_cosine_similarity(query, p)
        # Add simple overlap boost
        q_words = set(tokenize(query))
        p_words = set(tokenize(p))
        overlap = len(q_words & p_words)
        score = similarity + (0.05 * overlap)
        scored.append((score, p))
    
    scored.sort(key=lambda x: x[0], reverse=True)
    # Filter out paragraphs with zero relevance
    relevant = [p for score, p in scored[:top_n] if score > 0.05]
    if not relevant:
        return ""
    return "\n\n".join(relevant)

# Load Knowledge Base
def load_knowledge_base():
    kb_path = os.path.join(os.path.dirname(__file__), 'company_knowledge.txt')
    if not os.path.exists(kb_path):
        kb_path = 'company_knowledge.txt'
    if os.path.exists(kb_path):
        with open(kb_path, 'r', encoding='utf-8') as f:
            content = f.read()
            # Split by double newline to get distinct paragraphs
            paragraphs = [p.strip() for p in content.split('\n\n') if p.strip()]
            return paragraphs
    return []

KNOWLEDGE_PARAGRAPHS = load_knowledge_base()

# Send Message via WAHA REST API
def send_waha_message(to, text):
    # Fetch WAHA URL
    waha_url = get_waha_url()
    
    chat_id = to if '@c.us' in to else f"{to.split('@')[0]}@c.us"
    url = f"{waha_url}/api/sendText"
    
    payload = {
        "session": "default",
        "chatId": chat_id,
        "text": text
    }
    try:
        res = requests.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=10)
        return res.status_code == 201 or res.status_code == 200
    except Exception as e:
        print(f"Error sending message to WAHA: {e}")
        return False

# Log activity helper
def log_activity(phone, message, reply):
    db_run(
        "INSERT INTO whatsapp_logs (phone, message, reply) VALUES (?, ?, ?)",
        (phone.replace('@s.whatsapp.net', '').replace('@c.us', ''), message, reply)
    )

# Translation dictionary for multi-language support
T = {
    'welcome': {
        'id': "Halo! Selamat datang di WhatsApp *{merchant_name}*. ada yang bisa kami bantu? 😊\n\n"
              "Silakan ketik nomor pilihan berikut:\n"
              "*1.* Info Tiket & Harga\n"
              "*2.* Lokasi & Jam Operasional\n"
              "*3.* Cara Pemesanan Tiket\n"
              "*4.* Hubungi Customer Service\n\n"
              "Atau ketik *PESAN* untuk memesan tiket masuk langsung lewat WhatsApp!",
        'en': "Hello! Welcome to WhatsApp *{merchant_name}*. How can we help you? 😊\n\n"
              "Please type the number of your choice:\n"
              "*1.* Ticket Info & Prices\n"
              "*2.* Location & Opening Hours\n"
              "*3.* How to Book Tickets\n"
              "*4.* Contact Customer Service\n\n"
              "Or type *BOOKING* to book tickets directly via WhatsApp!"
    },
    'cancel': {
        'id': "❌ Pemesanan tiket dibatalkan. Jika ada hal lain yang bisa kami bantu, silakan hubungi kami kembali.",
        'en': "❌ Ticket booking cancelled. If there is anything else we can help you with, please contact us again."
    },
    'booking_start': {
        'id': "Halo! Selamat datang di layanan reservasi otomatis *{merchant_name}*.\n\nSilakan ketik *Nama Lengkap* Anda untuk memulai:",
        'en': "Hello! Welcome to *{merchant_name}* automated reservation service.\n\nPlease type your *Full Name* to start:"
    },
    'no_tickets': {
        'id': "Maaf, saat ini tidak ada tiket aktif yang dapat dipesan. Silakan hubungi customer service kami.",
        'en': "Sorry, there are no active tickets available for booking at the moment. Please contact our customer service."
    },
    'step1_prompt': {
        'id': "Hai *{name}*!\n\nSilakan pilih kategori tiket masuk (Ketik nomornya):\n\n{options_text}\nKetik *BATAL* jika ingin membatalkan.",
        'en': "Hi *{name}*!\n\nPlease select ticket category (Type the number):\n\n{options_text}\nType *CANCEL* to cancel."
    },
    'step2_invalid': {
        'id': "Pilihan nomor tidak valid. Silakan pilih nomor *1* sampai *{count}*, atau ketik *BATAL* untuk keluar.",
        'en': "Invalid number selection. Please select a number from *1* to *{count}*, or type *CANCEL* to exit."
    },
    'step2_prompt': {
        'id': "Anda memilih tiket:\n*{title}* (Rp {price:,})\n\nBerapa jumlah tiket yang ingin Anda pesan?\n(Ketik angka saja, contoh: *2*)",
        'en': "You selected ticket:\n*{title}* (Rp {price:,})\n\nHow many tickets would you like to book?\n(Type number only, e.g., *2*)"
    },
    'step3_invalid': {
        'id': "Jumlah tiket tidak valid. Silakan ketik angka lebih besar dari 0 (contoh: *3*).",
        'en': "Invalid number of tickets. Please type a number greater than 0 (e.g., *3*)."
    },
    'step3_prompt': {
        'id': "Silakan pilih metode pembayaran (Ketik nomornya):\n\n{options_text}\nKetik *BATAL* untuk membatalkan.",
        'en': "Please select payment method (Type the number):\n\n{options_text}\nType *CANCEL* to cancel."
    },
    'step4_invalid': {
        'id': "Pilihan pembayaran tidak valid. Silakan ketik angka *1* sampai *{count}*.",
        'en': "Invalid payment selection. Please type a number from *1* to *{count}*."
    },
    'step4_prompt': {
        'id': "Berikut ringkasan pesanan Anda:\n\n"
              "• Nama: *{name}*\n"
              "• Tiket: *{title}*\n"
              "• Jumlah: *{quantity} pcs*\n"
              "• Total Bayar: *Rp {total_bill:,}*\n"
              "• Pembayaran: *{payment_method}*\n\n"
              "Apakah data pesanan ini sudah benar?\n"
              "Ketik *YA* jika setuju, atau *BATAL* jika ingin membatalkan.",
        'en': "Here is your booking summary:\n\n"
              "• Name: *{name}*\n"
              "• Ticket: *{title}*\n"
              "• Quantity: *{quantity} pcs*\n"
              "• Total Bill: *Rp {total_bill:,}*\n"
              "• Payment Method: *{payment_method}*\n\n"
              "Is this booking information correct?\n"
              "Type *YES* to confirm, or *CANCEL* to cancel."
    },
    'step5_success': {
        'id': "Pemesanan Berhasil! 🎉\n\n"
              "• *Invoice ID*: #{invoice_id}\n"
              "• *Voucher Code*: {voucher_code}\n"
              "• *Nama*: {name}\n"
              "• *Tiket*: {title}\n"
              "• *Jumlah*: {quantity} pcs\n"
              "• *Total Bayar*: Rp {total_bill:,}\n"
              "• *Status*: Belum Lunas (Unpaid){payment_instructions}\n\n"
              "Setelah pembayaran lunas, voucher aktif Anda dapat diakses dan diunduh di website kami: http://{merchant_website}/vouchers.html?code={voucher_code}\n\n"
              "Terima kasih! Sampai jumpa di Batur Hot Spring.",
        'en': "Booking Successful! 🎉\n\n"
              "• *Invoice ID*: #{invoice_id}\n"
              "• *Voucher Code*: {voucher_code}\n"
              "• *Name*: {name}\n"
              "• *Ticket*: {title}\n"
              "• *Quantity*: {quantity} pcs\n"
              "• *Total Bill*: Rp {total_bill:,}\n"
              "• *Status*: Unpaid{payment_instructions}\n\n"
              "Once payment is completed, your active voucher can be accessed and downloaded on our website: http://{merchant_website}/vouchers.html?code={voucher_code}\n\n"
              "Thank you! See you at Batur Hot Spring."
    },
    'step5_error': {
        'id': "Maaf, terjadi kesalahan sistem saat membuat pesanan Anda. Silakan coba lagi nanti.",
        'en': "Sorry, a system error occurred while creating your booking. Please try again later."
    },
    'step5_invalid': {
        'id': "Konfirmasi tidak dikenali. Silakan ketik *YA* untuk konfirmasi pesanan Anda, atau *BATAL* jika ingin membatalkan.",
        'en': "Confirmation not recognized. Please type *YES* to confirm your booking, or *CANCEL* to cancel."
    },
    'ticket_list_header': {
        'id': "Daftar Harga Tiket Masuk *{merchant_name}*:\n\n",
        'en': "Ticket Prices for *{merchant_name}*:\n\n"
    },
    'ticket_list_empty': {
        'id': "Saat ini tidak ada kategori tiket aktif.",
        'en': "There are no active ticket categories at the moment."
    },
    'ticket_list_footer': {
        'id': "Ketik *PESAN* untuk memesan tiket secara langsung.",
        'en': "Type *BOOKING* to book tickets directly."
    },
    'location_info': {
        'id': "📍 *Alamat & Lokasi {merchant_name}*:\n"
              "{merchant_address}\n\n"
              "🕒 *Jam Operasional*:\n"
              "Setiap hari: 07:00 - 19:00 WITA\n\n"
              "Website resmi: http://{merchant_website}",
        'en': "📍 *Address & Location of {merchant_name}*:\n"
              "{merchant_address}\n\n"
              "🕒 *Opening Hours*:\n"
              "Every day: 07:00 - 19:00 WITA\n\n"
              "Official website: http://{merchant_website}"
    },
    'cs_info': {
        'id': "📞 *Layanan Pelanggan {merchant_name}*:\n\n"
              "Pesan Anda telah diteruskan ke Customer Service (CS).\n"
              "Sistem chatbot dijeda sementara. Admin kami akan segera membalas pesan Anda di sini.\n\n"
              "Hubungi langsung jika darurat:\n"
              "• Telepon: {merchant_phone}\n"
              "• Email: {merchant_email}",
        'en': "📞 *Customer Service for {merchant_name}*:\n\n"
              "Your message has been forwarded to Customer Service (CS).\n"
              "The chatbot is temporarily paused. Our admin will reply to your message here shortly.\n\n"
              "Contact directly for emergencies:\n"
              "• Phone: {merchant_phone}\n"
              "• Email: {merchant_email}"
    },
    'cara_booking': {
        'id': "💡 *Cara Pemesanan Tiket*:\n\n"
              "1. Ketik *PESAN* di chat ini untuk melakukan pemesanan instan.\n"
              "2. Isi Nama, pilih kategori tiket, jumlah tiket, dan metode pembayaran.\n"
              "3. Lakukan transfer sesuai instruksi yang diberikan.\n"
              "4. Konfirmasi pembayaran Anda ke admin melalui chat ini.\n"
              "5. Setelah lunas, Anda akan mendapatkan voucher dengan kode QR unik.\n\n"
              "Anda juga bisa memesan tiket langsung di website kami: http://{merchant_website}",
        'en': "💡 *How to Book Tickets*:\n\n"
              "1. Type *BOOKING* in this chat to start instant booking.\n"
              "2. Fill in your Name, select ticket category, quantity, and payment method.\n"
              "3. Transfer payment according to instructions.\n"
              "4. Confirm payment to admin via this chat.\n"
              "5. Once paid, you will receive a voucher with a unique QR code.\n\n"
              "You can also book tickets directly on our website: http://{merchant_website}"
    },
    'cash_instruction': {
        'id': "\n\nSilakan tunjukkan Invoice ID Anda saat kedatangan di loket kami untuk pembayaran.",
        'en': "\n\nPlease show your Invoice ID at our counter to pay upon arrival."
    },
    'transfer_instruction': {
        'id': "\n\nSilakan transfer ke *{bank_name}* a/n *{merchant_name}*.",
        'en': "\n\nPlease transfer to *{bank_name}* a/n *{merchant_name}*."
    }
}

# Core Chatbot Responder
def handle_message(sender, raw_text):
    text = raw_text.lower().strip()
    
    # Load all settings
    settings_rows = db_all("SELECT * FROM settings")
    settings = {r['key']: r['value'] for r in settings_rows}
    
    merchant_name = settings.get('merchant_name', 'Batur Hot Spring')
    merchant_address = settings.get('merchant_address', 'Toya Bungkah, Kintamani, Bangli, Bali')
    merchant_website = settings.get('merchant_website', 'www.baturhotspring.com')
    merchant_phone = settings.get('merchant_phone', '+62 812-3456-7890')
    merchant_email = settings.get('merchant_email', 'info@baturhotspring.com')
    
    # Manage session timeout
    clear_expired_sessions()
    session = get_session(sender)
    
    # Language detection and switching
    lang = 'id'
    if session and 'lang' in session:
        lang = session['lang']
    else:
        # Detect from message on first contact
        en_indicators = ['english', 'en', 'hello', 'hi', 'hey', 'booking', 'ticket', 'price', 'location', 'hours', 'help']
        if any(w in text for w in en_indicators):
            lang = 'en'
            
    if text in ['english', 'en', 'inggris']:
        lang = 'en'
        if not session:
            session = {"step": 0, "bot_mode": "bot", "ticket_status": "closed", "lang": "en"}
        else:
            session['lang'] = 'en'
        save_session(sender, session)
        reply = "Language changed to English. How can I help you? 😊"
        send_waha_message(sender, reply)
        log_activity(sender, raw_text, reply)
        return
    elif text in ['indonesia', 'id', 'indo']:
        lang = 'id'
        if not session:
            session = {"step": 0, "bot_mode": "bot", "ticket_status": "closed", "lang": "id"}
        else:
            session['lang'] = 'id'
        save_session(sender, session)
        reply = "Bahasa diubah ke Bahasa Indonesia. Ada yang bisa saya bantu? 😊"
        send_waha_message(sender, reply)
        log_activity(sender, raw_text, reply)
        return
        
    # Switch language if specific booking keywords are used
    if 'booking' in text:
        lang = 'en'
        if session:
            session['lang'] = 'en'
            save_session(sender, session)
    elif 'pesan' in text:
        lang = 'id'
        if session:
            session['lang'] = 'id'
            save_session(sender, session)
            
    # If session is in manual 'agent' mode, do NOT auto-reply. Just log.
    if session and session.get('bot_mode') == 'agent':
        log_activity(sender, raw_text, '')
        return
 
    # Handle global cancellation
    is_cancel = (text == 'batal' or text == 'cancel')
    if is_cancel and session and session.get('step', 0) > 0:
        delete_session(sender)
        reply = T['cancel'][lang]
        send_waha_message(sender, reply)
        log_activity(sender, raw_text, reply)
        return
 
    # Awaiting steps in booking flow
    if session and session.get('step', 0) > 0:
        session['timestamp'] = time.time()
        
        # Step 1: Awaiting Name
        if session['step'] == 1:
            session['name'] = raw_text.strip()
            tickets = db_all("SELECT * FROM tickets WHERE is_active = 1")
            if not tickets:
                delete_session(sender)
                reply = T['no_tickets'][lang]
                send_waha_message(sender, reply)
                log_activity(sender, raw_text, reply)
                return
            
            session['availableTickets'] = tickets
            session['step'] = 2
            save_session(sender, session)
            
            options_text = ""
            for idx, t in enumerate(tickets):
                options_text += f"*{idx + 1}.* {t['title']} - Rp {int(t['price']):,}\n"
            
            reply = T['step1_prompt'][lang].format(name=session['name'], options_text=options_text)
            send_waha_message(sender, reply)
            log_activity(sender, raw_text, reply)
            return
            
        # Step 2: Awaiting Ticket Selection
        elif session['step'] == 2:
            try:
                val = int(text)
                if val < 1 or val > len(session['availableTickets']):
                    raise ValueError()
            except ValueError:
                reply = T['step2_invalid'][lang].format(count=len(session['availableTickets']))
                send_waha_message(sender, reply)
                log_activity(sender, raw_text, reply)
                return
                
            session['ticket'] = session['availableTickets'][val - 1]
            session['step'] = 3
            save_session(sender, session)
            
            reply = T['step2_prompt'][lang].format(
                title=session['ticket']['title'],
                price=int(session['ticket']['price'])
            )
            send_waha_message(sender, reply)
            log_activity(sender, raw_text, reply)
            return
 
        # Step 3: Awaiting Quantity
        elif session['step'] == 3:
            try:
                qty = int(text)
                if qty <= 0:
                    raise ValueError()
            except ValueError:
                reply = T['step3_invalid'][lang]
                send_waha_message(sender, reply)
                log_activity(sender, raw_text, reply)
                return
                
            session['quantity'] = qty
            session['step'] = 4
            
            # Load active payment methods from DB
            active_payments = db_all("SELECT * FROM payment_methods WHERE is_active = 1 ORDER BY name ASC")
            if not active_payments:
                active_payments = [{'name': 'Tunai'}, {'name': 'Transfer Bank'}, {'name': 'QRIS'}]
            session['availablePayments'] = active_payments
            save_session(sender, session)
            
            options_text = ""
            for idx, pm in enumerate(active_payments):
                options_text += f"*{idx + 1}.* {pm['name']}\n"
            
            reply = T['step3_prompt'][lang].format(options_text=options_text)
            send_waha_message(sender, reply)
            log_activity(sender, raw_text, reply)
            return
            
        # Step 4: Awaiting Payment Method
        elif session['step'] == 4:
            available_payments = session.get('availablePayments', [])
            try:
                val = int(text)
                if val < 1 or val > len(available_payments):
                    raise ValueError()
                payment_method = available_payments[val - 1]['name']
            except ValueError:
                reply = T['step4_invalid'][lang].format(count=len(available_payments))
                send_waha_message(sender, reply)
                log_activity(sender, raw_text, reply)
                return
                
            session['paymentMethod'] = payment_method
            session['step'] = 5
            total_bill = int(session['ticket']['price']) * session['quantity']
            save_session(sender, session)
            
            reply = T['step4_prompt'][lang].format(
                name=session['name'],
                title=session['ticket']['title'],
                quantity=session['quantity'],
                total_bill=total_bill,
                payment_method=session['paymentMethod']
            )
            send_waha_message(sender, reply)
            log_activity(sender, raw_text, reply)
            return
            
        elif session['step'] == 5:
            is_yes = (text == 'ya' or text == 'yes')
            if is_yes:
                import json
                total_bill = int(session['ticket']['price']) * session['quantity']
                # Generate unique voucher code mimicking Node.js code
                random_hex = "".join(random.choices("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", k=6))
                timestamp_sec = str(int(time.time()))[-6:]
                voucher_code = f"VCH-{timestamp_sec}-{random_hex}"
                
                validated_items = [{
                    "ticket_id": session['ticket']['id'],
                    "ticket_title": session['ticket']['title'],
                    "ticket_price": float(session['ticket']['price']),
                    "quantity": session['quantity'],
                    "total_price": total_bill
                }]
                items_json = json.dumps(validated_items)
 
                try:
                    res = db_run(
                        "INSERT INTO invoices (customer_name, total_price, payment_method, status, voucher_code, items) VALUES (?, ?, ?, ?, ?, ?)",
                        (session['name'], total_bill, session['paymentMethod'], 'Unpaid', voucher_code, items_json)
                    )
                    
                    # Clear booking session
                    delete_session(sender)
                    
                    payment_instructions = ""
                    if "BCA" in session['paymentMethod']:
                        payment_instructions = T['transfer_instruction'][lang].format(bank_name="BCA 123-456-7890", merchant_name=merchant_name)
                    elif "Mandiri" in session['paymentMethod']:
                        payment_instructions = T['transfer_instruction'][lang].format(bank_name="Mandiri 987-654-3210", merchant_name=merchant_name)
                    else:
                        payment_instructions = T['cash_instruction'][lang]
                        
                    reply = T['step5_success'][lang].format(
                        invoice_id=res['id'],
                        voucher_code=voucher_code,
                        name=session['name'],
                        title=session['ticket']['title'],
                        quantity=session['quantity'],
                        total_bill=total_bill,
                        payment_instructions=payment_instructions,
                        merchant_website=merchant_website
                    )
                    send_waha_message(sender, reply)
                    log_activity(sender, raw_text, reply)
                except Exception as e:
                    print(f"Error database insert: {e}")
                    delete_session(sender)
                    reply = T['step5_error'][lang]
                    send_waha_message(sender, reply)
                    log_activity(sender, raw_text, reply)
            else:
                reply = T['step5_invalid'][lang]
                send_waha_message(sender, reply)
                log_activity(sender, raw_text, reply)
            return
 
    # Trigger booking workflow if keywords found
    if 'pesan' in text or 'booking' in text or text == '3':
        new_session = get_session(sender) or {
            "step": 0,
            "bot_mode": "bot",
            "ticket_status": "closed",
            "lang": lang
        }
        new_session["step"] = 1
        new_session["timestamp"] = time.time()
        new_session["lang"] = lang
        save_session(sender, new_session)
        reply = T['booking_start'][lang].format(merchant_name=merchant_name)
        send_waha_message(sender, reply)
        log_activity(sender, raw_text, reply)
        return
 
    # Handle welcome menu number shortcuts
    if text == '1' or 'tiket' in text or 'harga' in text or 'ticket' in text or 'price' in text:
        tickets = db_all("SELECT * FROM tickets WHERE is_active = 1")
        ticket_list = T['ticket_list_header'][lang].format(merchant_name=merchant_name)
        if not tickets:
            ticket_list += T['ticket_list_empty'][lang]
        else:
            for idx, t in enumerate(tickets):
                ticket_list += f"*{idx + 1}. {t['title']}*\n"
                ticket_list += f"   Price: Rp {int(t['price']):,}\n" if lang == 'en' else f"   Harga: Rp {int(t['price']):,}\n"
                if t['description']:
                    ticket_list += f"   Detail: {t['description']}\n"
                ticket_list += "\n"
            ticket_list += T['ticket_list_footer'][lang]
        send_waha_message(sender, ticket_list)
        log_activity(sender, raw_text, ticket_list)
        return
 
    if text == '2' or 'lokasi' in text or 'alamat' in text or 'jam' in text or 'buka' in text or 'location' in text or 'address' in text or 'hours' in text or 'open' in text:
        reply = T['location_info'][lang].format(
            merchant_name=merchant_name,
            merchant_address=merchant_address,
            merchant_website=merchant_website
        )
        send_waha_message(sender, reply)
        log_activity(sender, raw_text, reply)
        return
 
    if text == '4' or 'admin' in text or 'cs' in text or 'hubungi' in text or 'kontak' in text or 'contact' in text or 'help' in text or 'support' in text:
        # Switch to agent mode and open support ticket
        sess = get_session(sender)
        if not sess:
            sess = {
                "step": 0,
                "bot_mode": "agent",
                "ticket_status": "open",
                "ticket_subject": "Customer requested CS support",
                "lang": lang
            }
        else:
            sess["bot_mode"] = "agent"
            sess["ticket_status"] = "open"
            sess["ticket_subject"] = "Customer requested CS support"
        save_session(sender, sess)
 
        reply = T['cs_info'][lang].format(
            merchant_name=merchant_name,
            merchant_phone=merchant_phone,
            merchant_email=merchant_email
        )
        send_waha_message(sender, reply)
        log_activity(sender, raw_text, reply)
        return
 
    # RAG with NVIDIA Nemotron NIM API
    nvidia_key = settings.get('nvidia_api_key', '')
    nvidia_model = settings.get('nvidia_model', 'nvidia/llama-3.1-nemotron-70b-instruct')
    
    if nvidia_key:
        try:
            # 1. Retrieve relevant context from Knowledge Base
            context = get_relevant_context(raw_text, KNOWLEDGE_PARAGRAPHS, top_n=3)
            
            # 2. Get active tickets context
            tickets = db_all("SELECT * FROM tickets WHERE is_active = 1")
            ticket_context = ""
            for idx, t in enumerate(tickets):
                ticket_context += f"- {t['title']}: Rp {int(t['price']):,} ({t['description'] or ''})\n"
            
            # 3. Build Prompt with context
            if lang == 'en':
                system_instruction = (
                    f"You are the official WhatsApp Virtual Assistant for {merchant_name} ({merchant_website}).\n"
                    f"Your job is to assist customers by answering their questions politely and friendly in the language they use (Indonesian, English, Balinese, etc.).\n\n"
                    f"Use the following official company information/context to answer questions:\n"
                    f"[COMPANY CONTEXT]\n"
                    f"{context if context else 'No specific context.'}\n"
                    f"[/COMPANY CONTEXT]\n\n"
                    f"Active Tickets & Prices:\n{ticket_context}\n"
                    f"Booking Terms:\n"
                    f"- Customers can book tickets directly through WhatsApp by typing \"BOOKING\" or \"PESAN\".\n"
                    f"- If customers want to book tickets, instruct them to type \"BOOKING\" to start the automated booking. Do not book manually via AI chat.\n\n"
                    f"Answer Rules:\n"
                    f"- Keep answers short, clear, and friendly.\n"
                    f"- Use appropriate emojis.\n"
                    f"- Only answer based on the provided company context. If you do not know or it is not in the context, say that you do not know and refer them to CS at {merchant_phone}.\n"
                    f"- Reply using the exact same language as the customer's message."
                )
            else:
                system_instruction = (
                    f"Kamu adalah Virtual Assistant WhatsApp resmi untuk {merchant_name} ({merchant_website}).\n"
                    f"Tugasmu adalah membantu pelanggan menjawab pertanyaan dengan sopan dan ramah dalam bahasa yang mereka gunakan (Indonesia, Inggris, Bali, dll.).\n\n"
                    f"Gunakan informasi/konteks resmi dari perusahaan berikut untuk menjawab pertanyaan:\n"
                    f"[KONTEKS PERUSAHAAN]\n"
                    f"{context if context else 'Tidak ada konteks spesifik.'}\n"
                    f"[/KONTEKS PERUSAHAAN]\n\n"
                    f"Daftar Tiket Aktif & Harga:\n{ticket_context}\n"
                    f"Ketentuan Pemesanan:\n"
                    f"- Pelanggan bisa memesan tiket langsung lewat WhatsApp dengan mengetik kata kunci \"PESAN\" atau \"BOOKING\".\n"
                    f"- Jika pelanggan ingin memesan tiket, arahkan mereka untuk mengetik \"PESAN\" agar sistem otomatis memandu langkah pemesanan. Jangan lakukan pemesanan manual lewat percakapan AI biasa.\n\n"
                    f"Aturan Jawaban:\n"
                    f"- Jawab dengan singkat, padat, dan ramah.\n"
                    f"- Gunakan emoji yang sesuai.\n"
                    f"- Hanya jawab berdasarkan konteks perusahaan yang disediakan. Jika tidak tahu atau tidak ada di konteks, jawab bahwa Anda tidak tahu dan arahkan untuk menghubungi CS di {merchant_phone}.\n"
                    f"- Jawab menggunakan bahasa yang sama dengan pesan pelanggan."
                )
            
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {nvidia_key}"
            }
            
            payload = {
                "model": nvidia_model,
                "messages": [
                    {"role": "system", "content": system_instruction},
                    {"role": "user", "content": raw_text}
                ]
            }
            
            res = requests.post("https://integrate.api.nvidia.com/v1/chat/completions", json=payload, headers=headers, timeout=12)
            if res.status_code == 200:
                res_data = res.json()
                reply = res_data['choices'][0]['message']['content'].strip()
                send_waha_message(sender, reply)
                log_activity(sender, raw_text, reply)
                return
            else:
                print(f"NVIDIA API Error status {res.status_code}: {res.text}")
        except Exception as api_err:
            print(f"Failed to fetch response from NVIDIA Nemotron: {api_err}")
 
    # Fallback: Rule-based matching for 'cara' or 'how'
    if 'cara' in text or 'how' in text:
        reply = T['cara_booking'][lang].format(merchant_website=merchant_website)
        send_waha_message(sender, reply)
        log_activity(sender, raw_text, reply)
        return
 
    # Welcome Fallback Message
    welcome = T['welcome'][lang].format(merchant_name=merchant_name)
    send_waha_message(sender, welcome)
    log_activity(sender, raw_text, welcome)


# Flask Webhook Endpoint
@app.route('/webhook', methods=['POST'])
def webhook():
    try:
        data = request.json
        event = data.get('event')
        payload = data.get('payload', {})
        
        if (event == 'message' or event == 'message.any') and payload and not payload.get('fromMe'):
            sender = payload.get('from')
            body = (payload.get('body') or '').strip()
            
            if sender and body:
                handle_message(sender, body)
                
        return "OK", 200
    except Exception as e:
        print(f"Error in webhook: {e}")
        return jsonify({"error": str(e)}), 500

# Status API Endpoint
@app.route('/api/status', methods=['GET'])
def status():
    # Sync status from WAHA
    waha_url = get_waha_url()
    
    try:
        waha_res = requests.get(f"{waha_url}/api/sessions/default", timeout=5)
        if waha_res.status_code == 200:
            session_info = waha_res.json()
            waha_status = session_info.get('status', 'STOPPED')
            
            if waha_status == 'WORKING':
                status_str = 'connected'
            elif waha_status == 'SCAN_QR_CODE':
                status_str = 'qrcode'
            elif waha_status == 'STARTING':
                status_str = 'connecting'
            else:
                status_str = 'disconnected'
        else:
            status_str = 'disconnected'
    except Exception:
        status_str = 'disconnected'

    qr_data_url = None
    if status_str == 'qrcode':
        try:
            qr_res = requests.get(f"{waha_url}/api/default/auth/qr?format=image", timeout=5)
            if qr_res.status_code == 200:
                import base64
                qr_base64 = base64.b64encode(qr_res.content).decode('utf-8')
                qr_data_url = f"data:image/png;base64,{qr_base64}"
        except Exception as e:
            print(f"Failed to fetch QR image: {e}")
        
    try:
        sessions_count = db_get("SELECT COUNT(*) as count FROM chatbot_sessions WHERE step > 0")['count']
    except Exception:
        sessions_count = 0
        
    return jsonify({
        "status": status_str,
        "qr": qr_data_url,
        "sessionsCount": sessions_count
    })

# Start session API Endpoint
@app.route('/api/start', methods=['POST'])
def start():
    waha_url = get_waha_url()
    try:
        requests.post(f"{waha_url}/api/sessions/start", json={"name": "default"}, timeout=10)
        return jsonify({"message": "WhatsApp bot starting..."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# Logout session API Endpoint
@app.route('/api/logout', methods=['POST'])
def logout():
    waha_url = get_waha_url()
    try:
        requests.post(f"{waha_url}/api/sessions/logout", json={"name": "default"}, timeout=10)
        return jsonify({"message": "WhatsApp bot logged out."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
