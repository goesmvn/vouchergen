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

# Resolve SQLite database path
def get_db_path():
    db_path = os.environ.get('DB_PATH')
    if db_path:
        return db_path
    # Local fallbacks
    if os.path.exists('database.sqlite'):
        return 'database.sqlite'
    elif os.path.exists('../database.sqlite'):
        return '../database.sqlite'
    return 'database.sqlite'

# Initialize Logs Table
def init_db():
    path = get_db_path()
    conn = sqlite3.connect(path)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS whatsapp_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone TEXT,
            message TEXT,
            reply TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()

init_db()

# DB Helpers
def db_get(query, params=()):
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(query, params)
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def get_waha_url():
    waha_env = os.environ.get('WAHA_URL')
    if waha_env:
        return waha_env
    waha_url_row = db_get("SELECT value FROM settings WHERE key = 'waha_url'")
    if waha_url_row and waha_url_row['value']:
        return waha_url_row['value']
    return 'http://localhost:3006'

def db_all(query, params=()):
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def db_run(query, params=()):
    conn = sqlite3.connect(get_db_path())
    cursor = conn.cursor()
    cursor.execute(query, params)
    last_id = cursor.lastrowid
    changes = conn.total_changes
    conn.commit()
    conn.close()
    return {"id": last_id, "changes": changes}

# Chatbot Session Store
# phone -> {step: int, timestamp: float, name: str, ticket: dict, quantity: int, paymentMethod: str, availableTickets: list}
SESSIONS = {}
SESSION_TIMEOUT = 5 * 60  # 5 minutes

def clear_expired_sessions():
    now = time.time()
    expired = [k for k, v in SESSIONS.items() if now - v.get('timestamp', 0) > SESSION_TIMEOUT]
    for k in expired:
        del SESSIONS[k]

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
    session = SESSIONS.get(sender)
    
    # Handle global cancellation
    if text == 'batal' and session:
        del SESSIONS[sender]
        reply = "❌ Pemesanan tiket dibatalkan. Jika ada hal lain yang bisa kami bantu, silakan hubungi kami kembali."
        send_waha_message(sender, reply)
        log_activity(sender, raw_text, reply)
        return

    # Awaiting steps in booking flow
    if session:
        session['timestamp'] = time.time()
        
        # Step 1: Awaiting Name
        if session['step'] == 1:
            session['name'] = raw_text.strip()
            tickets = db_all("SELECT * FROM tickets WHERE is_active = 1")
            if not tickets:
                del SESSIONS[sender]
                reply = "Maaf, saat ini tidak ada tiket aktif yang dapat dipesan. Silakan hubungi customer service kami."
                send_waha_message(sender, reply)
                log_activity(sender, raw_text, reply)
                return
            
            session['availableTickets'] = tickets
            session['step'] = 2
            
            options_text = ""
            for idx, t in enumerate(tickets):
                options_text += f"*{idx + 1}.* {t['title']} - Rp {int(t['price']):,}\n"
            
            reply = f"Hai *{session['name']}*!\n\nSilakan pilih kategori tiket masuk (Ketik nomornya):\n\n{options_text}\nKetik *BATAL* jika ingin membatalkan."
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
                reply = f"Pilihan nomor tidak valid. Silakan pilih nomor *1* sampai *{len(session['availableTickets'])}*, atau ketik *BATAL* untuk keluar."
                send_waha_message(sender, reply)
                log_activity(sender, raw_text, reply)
                return
                
            session['ticket'] = session['availableTickets'][val - 1]
            session['step'] = 3
            
            reply = f"Anda memilih tiket:\n*{session['ticket']['title']}* (Rp {int(session['ticket']['price']):,})\n\nBerapa jumlah tiket yang ingin Anda pesan?\n(Ketik angka saja, contoh: *2*)"
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
                reply = "Jumlah tiket tidak valid. Silakan ketik angka lebih besar dari 0 (contoh: *3*)."
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
            
            options_text = ""
            for idx, pm in enumerate(active_payments):
                options_text += f"*{idx + 1}.* {pm['name']}\n"
            
            reply = f"Silakan pilih metode pembayaran (Ketik nomornya):\n\n{options_text}\nKetik *BATAL* untuk membatalkan."
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
                reply = f"Pilihan pembayaran tidak valid. Silakan ketik angka *1* sampai *{len(available_payments)}*."
                send_waha_message(sender, reply)
                log_activity(sender, raw_text, reply)
                return
                
            session['paymentMethod'] = payment_method
            session['step'] = 5
            total_bill = int(session['ticket']['price']) * session['quantity']
            
            reply = (f"Berikut ringkasan pesanan Anda:\n\n"
                     f"• Nama: *{session['name']}*\n"
                     f"• Tiket: *{session['ticket']['title']}*\n"
                     f"• Jumlah: *{session['quantity']} pcs*\n"
                     f"• Total Bayar: *Rp {total_bill:,}*\n"
                     f"• Pembayaran: *{session['paymentMethod']}*\n\n"
                     f"Apakah data pesanan ini sudah benar?\n"
                     f"Ketik *YA* jika setuju, atau *BATAL* jika ingin membatalkan.")
            send_waha_message(sender, reply)
            log_activity(sender, raw_text, reply)
            return
            
        # Step 5: Awaiting Final Confirmation
        elif session['step'] == 5:
            if text == 'ya':
                total_bill = int(session['ticket']['price']) * session['quantity']
                # Generate unique voucher code mimicking Node.js code
                random_hex = "".join(random.choices("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", k=6))
                timestamp_sec = str(int(time.time()))[-6:]
                voucher_code = f"VCH-{timestamp_sec}-{random_hex}"
                
                try:
                    res = db_run(
                        "INSERT INTO invoices (customer_name, ticket_id, quantity, total_price, payment_method, status, voucher_code) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (session['name'], session['ticket']['id'], session['quantity'], total_bill, session['paymentMethod'], 'Unpaid', voucher_code)
                    )
                    
                    # Clear session
                    del SESSIONS[sender]
                    
                    payment_instructions = ""
                    if "BCA" in session['paymentMethod']:
                        payment_instructions = "\n\nSilakan transfer ke *BCA 123-456-7890* a/n *Batur Hot Spring*."
                    elif "Mandiri" in session['paymentMethod']:
                        payment_instructions = "\n\nSilakan transfer ke *Mandiri 987-654-3210* a/n *Batur Hot Spring*."
                    else:
                        payment_instructions = "\n\nSilakan tunjukkan Invoice ID Anda saat kedatangan di loket kami untuk pembayaran."
                        
                    reply = (f"Pemesanan Berhasil! 🎉\n\n"
                             f"• *Invoice ID*: #{res['id']}\n"
                             f"• *Voucher Code*: {voucher_code}\n"
                             f"• *Nama*: {session['name']}\n"
                             f"• *Tiket*: {session['ticket']['title']}\n"
                             f"• *Jumlah*: {session['quantity']} pcs\n"
                             f"• *Total Bayar*: Rp {total_bill:,}\n"
                             f"• *Status*: Belum Lunas (Unpaid){payment_instructions}\n\n"
                             f"Setelah pembayaran lunas, voucher aktif Anda dapat diakses dan diunduh di website kami: http://{merchant_website}/vouchers.html?code={voucher_code}\n\n"
                             f"Terima kasih! Sampai jumpa di Batur Hot Spring.")
                    send_waha_message(sender, reply)
                    log_activity(sender, raw_text, reply)
                except Exception as e:
                    print(f"Error database insert: {e}")
                    del SESSIONS[sender]
                    reply = "Maaf, terjadi kesalahan sistem saat membuat pesanan Anda. Silakan coba lagi nanti."
                    send_waha_message(sender, reply)
                    log_activity(sender, raw_text, reply)
            else:
                reply = "Konfirmasi tidak dikenali. Silakan ketik *YA* untuk konfirmasi pesanan Anda, atau *BATAL* jika ingin membatalkan."
                send_waha_message(sender, reply)
                log_activity(sender, raw_text, reply)
            return

    # Trigger booking workflow if keywords found
    if 'pesan' in text or 'booking' in text or text == '3':
        SESSIONS[sender] = {
            "step": 1,
            "timestamp": time.time()
        }
        reply = f"Halo! Selamat datang di layanan reservasi otomatis *{merchant_name}*.\n\nSilakan ketik *Nama Lengkap* Anda untuk memulai:"
        send_waha_message(sender, reply)
        log_activity(sender, raw_text, reply)
        return

    # Handle welcome menu number shortcuts
    if text == '1' or 'tiket' in text or 'harga' in text:
        tickets = db_all("SELECT * FROM tickets WHERE is_active = 1")
        ticket_list = f"Daftar Harga Tiket Masuk *{merchant_name}*:\n\n"
        if not tickets:
            ticket_list += "Saat ini tidak ada kategori tiket aktif."
        else:
            for idx, t in enumerate(tickets):
                ticket_list += f"*{idx + 1}. {t['title']}*\n"
                ticket_list += f"   Harga: Rp {int(t['price']):,}\n"
                if t['description']:
                    ticket_list += f"   Detail: {t['description']}\n"
                ticket_list += "\n"
            ticket_list += "Ketik *PESAN* untuk memesan tiket secara langsung."
        send_waha_message(sender, ticket_list)
        log_activity(sender, raw_text, ticket_list)
        return

    if text == '2' or 'lokasi' in text or 'alamat' in text or 'jam' in text or 'buka' in text:
        reply = (f"📍 *Alamat & Lokasi {merchant_name}*:\n"
                 f"{merchant_address}\n\n"
                 f"🕒 *Jam Operasional*:\n"
                 f"Setiap hari: 07:00 - 19:00 WITA\n\n"
                 f"Website resmi: http://{merchant_website}")
        send_waha_message(sender, reply)
        log_activity(sender, raw_text, reply)
        return

    if text == '4' or 'admin' in text or 'cs' in text or 'hubungi' in text or 'kontak' in text:
        reply = (f"📞 *Layanan Pelanggan {merchant_name}*:\n\n"
                 f"Jika Anda memiliki pertanyaan khusus, silakan hubungi kami di:\n"
                 f"• Telepon: {merchant_phone}\n"
                 f"• Email: {merchant_email}\n\n"
                 f"Pesan Anda akan dibalas oleh admin kami segera. Terima kasih!")
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

    # Fallback: Rule-based matching for 'cara'
    if 'cara' in text:
        reply = (f"💡 *Cara Pemesanan Tiket*:\n\n"
                 f"1. Ketik *PESAN* di chat ini untuk melakukan pemesanan instan.\n"
                 f"2. Isi Nama, pilih kategori tiket, jumlah tiket, dan metode pembayaran.\n"
                 f"3. Lakukan transfer sesuai instruksi yang diberikan.\n"
                 f"4. Konfirmasi pembayaran Anda ke admin melalui chat ini.\n"
                 f"5. Setelah lunas, Anda akan mendapatkan voucher dengan kode QR unik.\n\n"
                 f"Anda juga bisa memesan tiket langsung di website kami: http://{merchant_website}")
        send_waha_message(sender, reply)
        log_activity(sender, raw_text, reply)
        return

    # Welcome Fallback Message
    welcome = (f"Halo! Selamat datang di WhatsApp *{merchant_name}*. ada yang bisa kami bantu? 😊\n\n"
               f"Silakan ketik nomor pilihan berikut:\n"
               f"*1.* Info Tiket & Harga\n"
               f"*2.* Lokasi & Jam Operasional\n"
               f"*3.* Cara Pemesanan Tiket\n"
               f"*4.* Hubungi Customer Service\n\n"
               f"Atau ketik *PESAN* untuk memesan tiket masuk langsung lewat WhatsApp!")
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
        
    return jsonify({
        "status": status_str,
        "qr": qr_data_url,
        "sessionsCount": len(SESSIONS)
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
