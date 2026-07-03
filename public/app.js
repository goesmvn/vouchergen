// App State
let token = localStorage.getItem('admin_token') || null;
let currentTab = 'dashboard'; // Default active tab is 'dashboard'
let html5QrcodeScanner = null;
let currentScannedCode = null;
let appSettings = {};

// Calc pricing breakdown from subtotal using current appSettings
function calcPricing(subtotal) {
  const discountRate = parseFloat(appSettings.discount_rate) || 0;
  const taxRate = parseFloat(appSettings.tax_rate) || 0;
  const serviceFee = parseFloat(appSettings.service_fee) || 0;
  const discountAmt = Math.round(subtotal * discountRate / 100);
  const afterDiscount = subtotal - discountAmt;
  const taxAmt = Math.round(afterDiscount * taxRate / 100);
  const total = afterDiscount + taxAmt + serviceFee;
  return { subtotal, discountRate, discountAmt, taxRate, taxAmt, serviceFee, total };
}



// Date localization helpers
const daysShort = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const daysLong = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const monthsLong = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];


// Tickets List Cache
let ticketCatalog = [];
let invoiceCatalog = [];
let bookingQuantities = {};
let selectedBookingDateString = '';
let activeVoucherTemplate = 1; // 1=Classic, 2=Boarding Pass, 3=Minimal


// Default Unsplash banners for ticket cards
const bannerImages = [
  'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=400&q=80', // Drinks
  'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=400&q=80', // Burger
  'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=400&q=80', // Coffee
  'https://images.unsplash.com/photo-1550305080-4e029753abfd?auto=format&fit=crop&w=400&q=80'  // Coupon / Ticket
];

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  checkAuth();
});

// Auth Check
function checkAuth() {
  const loginSection = document.getElementById('login-section');
  const dashboardSection = document.getElementById('dashboard-section');
  
  if (token) {
    loginSection.classList.add('hidden');
    dashboardSection.classList.remove('hidden');
    // Load initial data
    loadAllData();
  } else {
    loginSection.classList.remove('hidden');
    dashboardSection.classList.add('hidden');
  }
}

// Load All Data
async function loadAllData() {
  await loadSettings();
  await loadTickets();
  await loadInvoices();
  await loadPaymentMethods();
  // Set default view tab
  switchTab(currentTab);
}

// Fetch place settings
async function loadSettings() {
  try {
    const response = await fetch('/api/settings');
    appSettings = await response.json();
    applyDynamicSettings();
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

// Apply settings to the layout elements
function applyDynamicSettings() {
  if (!appSettings.merchant_name) return;

  // Sidebar header title
  const sidebarTitle = document.querySelector('aside h1');
  if (sidebarTitle) sidebarTitle.innerText = appSettings.merchant_name;
  
  // Navbar header title
  const navbarTitle = document.getElementById('navbar-title') || document.querySelector('header div.font-bold');
  if (navbarTitle) navbarTitle.innerText = `${appSettings.merchant_name} Admin`;

  // Voucher generator branding panel header
  const generatorHeader = document.querySelector('#panel-generator h3');
  if (generatorHeader) generatorHeader.innerText = appSettings.merchant_name;

  // Render logo if configured
  const sidebarLogoImg = document.getElementById('sidebar-logo-image');
  const sidebarLogoIcon = document.getElementById('sidebar-logo-icon');
  const navbarLogoImg = document.getElementById('navbar-logo-image');

  if (appSettings.merchant_logo_url) {
    if (sidebarLogoImg) {
      sidebarLogoImg.src = appSettings.merchant_logo_url;
      sidebarLogoImg.classList.remove('hidden');
    }
    if (sidebarLogoIcon) {
      sidebarLogoIcon.classList.add('hidden');
    }
    if (navbarLogoImg) {
      navbarLogoImg.src = appSettings.merchant_logo_url;
      navbarLogoImg.classList.remove('hidden');
    }
  } else {
    if (sidebarLogoImg) {
      sidebarLogoImg.src = '';
      sidebarLogoImg.classList.add('hidden');
    }
    if (sidebarLogoIcon) {
      sidebarLogoIcon.classList.remove('hidden');
    }
    if (navbarLogoImg) {
      navbarLogoImg.src = '';
      navbarLogoImg.classList.add('hidden');
    }
  }
  // Apply dynamic color settings
  if (appSettings.primary_color) {
    document.documentElement.style.setProperty('--color-primary', appSettings.primary_color);
  } else {
    document.documentElement.style.setProperty('--color-primary', '#000000');
  }
  if (appSettings.secondary_color) {
    document.documentElement.style.setProperty('--color-secondary', appSettings.secondary_color);
  } else {
    document.documentElement.style.setProperty('--color-secondary', '#006c4a');
  }
  if (appSettings.background_color) {
    document.documentElement.style.setProperty('--color-background', appSettings.background_color);
  } else {
    document.documentElement.style.setProperty('--color-background', '#f8f9ff');
  }
}

// Event Listeners
function setupEventListeners() {
  // Login form submit
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('login-error');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Login failed');

      token = data.token;
      localStorage.setItem('admin_token', token);
      errorEl.classList.add('hidden');
      showToast('Logged in successfully!');
      checkAuth();
    } catch (err) {
      errorEl.innerText = err.message;
      errorEl.classList.remove('hidden');
    }
  });

  // Ticket CRUD form submit (Configure Ticket Class in Store panel)
  document.getElementById('store-ticket-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('store-ticket-edit-id').value;
    const title = document.getElementById('store-ticket-title').value;
    const price = parseFloat(document.getElementById('store-ticket-price').value);
    const description = document.getElementById('store-ticket-desc').value;
    const is_active = parseInt(document.getElementById('store-ticket-status').value);

    const url = id ? `/api/tickets/${id}` : '/api/tickets';
    const method = id ? 'PUT' : 'POST';

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token
        },
        body: JSON.stringify({ title, price, description, is_active })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save ticket class');

      showToast(id ? 'Ticket class updated!' : 'New ticket class created!');
      resetStoreTicketForm();
      await loadTickets();
      renderStoreTicketsTable();
      renderBookingCatalog();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Scanner modal manual submit
  document.getElementById('manual-scan-form-modal').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = document.getElementById('manual-code-input-modal').value.trim();
    checkVoucherCode(code);
  });

  // Settings form submit
  const settingsForm = document.getElementById('settings-form');
  if (settingsForm) {
    settingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        merchant_name: document.getElementById('settings-name').value.trim(),
        merchant_website: document.getElementById('settings-website').value.trim(),
        merchant_email: document.getElementById('settings-email').value.trim(),
        merchant_phone: document.getElementById('settings-phone').value.trim(),
        merchant_address: document.getElementById('settings-address').value.trim(),
        merchant_logo_url: document.getElementById('settings-logo').value.trim(),
        ninerouter_url: appSettings.ninerouter_url || '',
        ninerouter_key: appSettings.ninerouter_key || '',
        ninerouter_model: appSettings.ninerouter_model || '',
        nvidia_api_key: document.getElementById('settings-nvidia-key').value.trim(),
        nvidia_model: document.getElementById('settings-nvidia-model').value.trim(),
        waha_url: document.getElementById('settings-waha-url').value.trim(),
        primary_color: document.getElementById('settings-primary-color-text').value.trim(),
        secondary_color: document.getElementById('settings-secondary-color-text').value.trim(),
        background_color: document.getElementById('settings-background-color-text').value.trim(),
        tax_rate: document.getElementById('settings-tax-rate').value.trim(),
        service_fee: document.getElementById('settings-service-fee').value.trim(),
        discount_rate: document.getElementById('settings-discount-rate').value.trim(),
        discount_label: document.getElementById('settings-discount-label').value.trim()
      };

      try {
        const response = await fetch('/api/settings', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token
          },
          body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to save settings');

        showToast('Settings saved successfully!');
        await loadSettings();
      } catch (err) {
        showToast(err.message, true);
      }
    });
  }

  // Live logo url preview
  const logoInput = document.getElementById('settings-logo');
  if (logoInput) {
    logoInput.addEventListener('input', (e) => {
      document.getElementById('settings-logo-preview').src = e.target.value;
    });
  }

  // Colors inputs synchronizer
  const pColor = document.getElementById('settings-primary-color');
  const pColorText = document.getElementById('settings-primary-color-text');
  if (pColor && pColorText) {
    pColor.addEventListener('input', (e) => { pColorText.value = e.target.value; });
    pColorText.addEventListener('input', (e) => {
      if (e.target.value.match(/^#[0-9A-Fa-f]{6}$/)) pColor.value = e.target.value;
    });
  }

  const sColor = document.getElementById('settings-secondary-color');
  const sColorText = document.getElementById('settings-secondary-color-text');
  if (sColor && sColorText) {
    sColor.addEventListener('input', (e) => { sColorText.value = e.target.value; });
    sColorText.addEventListener('input', (e) => {
      if (e.target.value.match(/^#[0-9A-Fa-f]{6}$/)) sColor.value = e.target.value;
    });
  }

  const bColor = document.getElementById('settings-background-color');
  const bColorText = document.getElementById('settings-background-color-text');
  if (bColor && bColorText) {
    bColor.addEventListener('input', (e) => { bColorText.value = e.target.value; });
    bColorText.addEventListener('input', (e) => {
      if (e.target.value.match(/^#[0-9A-Fa-f]{6}$/)) bColor.value = e.target.value;
    });
  }

  // Payment Method CRUD form submit
  const storePMForm = document.getElementById('store-pm-form');
  if (storePMForm) {
    storePMForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('store-pm-edit-id').value;
      const name = document.getElementById('store-pm-name').value.trim();
      const is_active = parseInt(document.getElementById('store-pm-status').value);

      const url = id ? `/api/payment-methods/${id}` : '/api/payment-methods';
      const method = id ? 'PUT' : 'POST';

      try {
        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token
          },
          body: JSON.stringify({ name, is_active })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to save payment method');

        showToast(id ? 'Payment method updated!' : 'New payment method created!');
        resetStorePMForm();
        await loadPaymentMethods();
      } catch (err) {
        showToast(err.message, true);
      }
    });
  }
}

// Log out
function logout() {
  token = null;
  localStorage.removeItem('admin_token');
  closeRedeemModal();
  closeNewIssueModal();
  closeModal();
  stopWhatsAppPolling();
  checkAuth();
  showToast('Logged out successfully.');
}

// Tab Switcher
function switchTab(tabId) {
  currentTab = tabId;
  
  // Hide panels
  document.querySelectorAll('section[id^="panel-"]').forEach(panel => panel.classList.add('hidden'));
  
  // Deactivate all sidebar nav buttons
  document.querySelectorAll('aside button[id^="tab-btn-"]').forEach(btn => {
    btn.className = "w-full flex items-center gap-md px-md py-sm rounded-lg text-on-surface-variant hover:text-secondary hover:bg-surface-container-high transition-all duration-200 ease-in-out text-left";
  });

  // Show panel
  const panelEl = document.getElementById(`panel-${tabId}`);
  if (panelEl) panelEl.classList.remove('hidden');
  
  // Highlight active menu item
  const activeBtn = document.getElementById(`tab-btn-${tabId}`);
  if (activeBtn) {
    activeBtn.className = "w-full flex items-center gap-md px-md py-sm rounded-lg text-secondary font-bold border-r-4 border-secondary bg-secondary-container/10 transition-all duration-200 ease-in-out text-left";
  }

  // Update header text if exists
  const topPanelEl = document.getElementById('top-panel-title');
  if (topPanelEl) {
    const titles = {
      dashboard: 'System Dashboard Overview',
      store: 'Ticket Pricing & Master Data',
      generator: 'Voucher Simulator',
      invoices: 'Invoice List Ledger',
      vouchers: 'Vouchers & Tickets',
      orders: 'Transaction logs & Status',
      settings: 'Place configuration & Branding',
      whatsapp: 'WhatsApp Chatbot Virtual Assistant'
    };
    topPanelEl.innerText = titles[tabId] || 'Batur Hot Spring Admin';
  }

  // Load context specific content
  if (tabId === 'dashboard') renderDashboardStats();
  if (tabId === 'store') renderStoreTicketsTable();
  if (tabId === 'generator') { renderBookingCatalog(); initVisitDateInput(); updateBookingTotal(); }
  if (tabId === 'invoices') renderInvoicesTable();
  if (tabId === 'vouchers') renderVouchersList();
  if (tabId === 'orders') renderOrdersTable();
  if (tabId === 'settings') renderSettingsForm();
  
  if (tabId === 'whatsapp') {
    startWhatsAppPolling();
  } else {
    stopWhatsAppPolling();
  }
  
  // Auto-hide mobile sidebar
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) sidebar.classList.remove('show');
}

// Fetch Master Tickets
async function loadTickets() {
  try {
    const response = await fetch('/api/tickets');
    ticketCatalog = await response.json();
  } catch (err) {
    showToast('Failed to retrieve tickets.', true);
  }
}

// Fetch Invoices
async function loadInvoices() {
  try {
    const response = await fetch('/api/invoices');
    invoiceCatalog = await response.json();
  } catch (err) {
    showToast('Failed to retrieve orders.', true);
  }
}

// Render Vouchers tab cards grid
function renderVoucherCardsGrid(filterQuery = '') {
  const container = document.getElementById('voucher-grid-cards-container');
  if (!container) return;

  container.innerHTML = '';
  
  const query = filterQuery.toLowerCase().trim();
  const filteredTickets = ticketCatalog.filter(t => 
    t.title.toLowerCase().includes(query) || 
    (t.description || '').toLowerCase().includes(query)
  );

  if (filteredTickets.length === 0) {
    container.innerHTML = '<p class="text-secondary text-center" style="grid-column: 1/-1;">No matching tickets or vouchers found.</p>';
    return;
  }

  filteredTickets.forEach((ticket, idx) => {
    // Select image banner based on index cycle
    const bannerUrl = bannerImages[idx % bannerImages.length];

    const card = document.createElement('div');
    card.className = 'voucher-item-card fade-in';
    
    const isActive = ticket.is_active === 1;
    const statusText = isActive ? 'Active' : 'Not active';
    const statusDotClass = isActive ? 'status-dot-active' : 'status-dot-inactive';

    card.innerHTML = `
      <div class="card-image-banner" style="background-image: url('${bannerUrl}');"></div>
      <div class="card-body-content">
        <h4>${ticket.title}</h4>
        
        <div class="card-status-toggle-row">
          <div class="status-indicator">
            <span class="status-dot ${statusDotClass}"></span>
            <span>${statusText}</span>
          </div>
          <label class="switch-container">
            <input type="checkbox" ${isActive ? 'checked' : ''} onchange="toggleTicketActiveStatus(${ticket.id})">
            <span class="switch-slider"></span>
          </label>
        </div>

        <div class="properties-list">
          <div class="prop-row">
            <span>Type</span>
            <strong>Voucher</strong>
          </div>
          <div class="prop-row">
            <span>Shipping</span>
            <strong>Online voucher</strong>
          </div>
          <div class="prop-row">
            <span>Price</span>
            <strong>Rp ${ticket.price.toLocaleString('id-ID')}</strong>
          </div>
          <div class="prop-row">
            <span>Shop</span>
            <strong>
              <a href="#" class="prop-link" onclick="event.preventDefault(); showToast('Starbuck Outlet clicked')">Starbuck outlet</a>
            </strong>
          </div>
        </div>

        <div class="card-footer-buttons">
          <button class="btn btn-card-detail" onclick="openVoucherConfigDetails(${ticket.id})">View details</button>
          <button class="btn-card-more" onclick="showToast('Option panel triggered')">...</button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

// Toggle Ticket Active Status via database API
async function toggleTicketActiveStatus(ticketId) {
  try {
    const response = await fetch(`/api/tickets/${ticketId}/toggle`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token
      }
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to toggle status');

    showToast('Voucher active state toggled.');
    await loadTickets();
    renderVoucherCardsGrid(document.getElementById('voucher-search-input').value);
  } catch (err) {
    showToast(err.message, true);
    // Reload grid to fix checkbox mismatch
    renderVoucherCardsGrid();
  }
}

// Filter grid by search bar
function filterVoucherGrid() {
  const query = document.getElementById('voucher-search-input').value;
  renderVoucherCardsGrid(query);
}

// Open Vouchers details modal (info lookup)
function openVoucherConfigDetails(ticketId) {
  const ticket = ticketCatalog.find(t => t.id === ticketId);
  if (!ticket) return;

  const modalBody = document.getElementById('modal-body-container');
  modalBody.innerHTML = `
    <div class="detail-view">
      <h3>Voucher Ticket Profile</h3>
      <div class="detail-grid">
        <div class="detail-field"><span>Name</span><strong>${ticket.title}</strong></div>
        <div class="detail-field"><span>Price</span><strong>Rp ${ticket.price.toLocaleString('id-ID')}</strong></div>
        <div class="detail-field"><span>Status</span><strong>
          <span class="badge ${ticket.is_active === 1 ? 'badge-paid' : 'badge-unpaid'}">
            ${ticket.is_active === 1 ? 'Active' : 'Inactive'}
          </span>
        </strong></div>
        <div class="detail-field"><span>Category Type</span><strong>Admission Ticket</strong></div>
      </div>
      <div class="detail-field" style="margin-top: 15px;">
        <span>Description Details</span>
        <p style="font-size: 0.9rem; color: var(--text-secondary); margin-top:5px; line-height: 1.4;">
          ${ticket.description || 'No detailed features provided for this class.'}
        </p>
      </div>
      <div class="modal-action-row">
        <button class="btn btn-secondary" onclick="closeModal()">Close Details</button>
      </div>
    </div>
  `;
  document.getElementById('details-modal').classList.remove('hidden');
}

// Dashboard statistics
function renderDashboardStats() {
  let totalRevenue = 0;
  let activeCount = ticketCatalog.filter(t => t.is_active === 1).length;
  let totalInvoices = invoiceCatalog.length;
  let redeemedCount = invoiceCatalog.filter(i => i.current_status === 'Redeemed').length;

  invoiceCatalog.forEach(inv => {
    if (inv.current_status === 'Paid' || inv.current_status === 'Redeemed') {
      totalRevenue += inv.total_price;
    }
  });

  document.getElementById('stat-total-revenue').innerText = `Rp ${totalRevenue.toLocaleString('id-ID')}`;
  document.getElementById('stat-active-vouchers').innerText = activeCount;
  document.getElementById('stat-total-invoices').innerText = totalInvoices;
  document.getElementById('stat-total-redeemed').innerText = redeemedCount;

  // Render recent activities (last 5 rows)
  const tbody = document.getElementById('dashboard-recent-body');
  tbody.innerHTML = '';
  
  const recents = invoiceCatalog.slice(0, 5);
  if (recents.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-secondary text-center">No recent activities available.</td></tr>';
    return;
  }

  recents.forEach(inv => {
    const isPaid = inv.current_status === 'Paid';
    const isRedeemed = inv.current_status === 'Redeemed';
    let badge = `<span class="badge badge-unpaid">Unpaid</span>`;
    if (isRedeemed) badge = `<span class="badge badge-redeemed">Redeemed</span>`;
    else if (isPaid) badge = `<span class="badge badge-paid">Paid</span>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>#${inv.id}</td>
      <td><strong>${inv.customer_name}</strong></td>
      <td>${inv.ticket_title}</td>
      <td>${badge}</td>
      <td>${new Date(inv.created_at).toLocaleDateString('id-ID')}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Orders table list
function renderOrdersTable() {
  const tbody = document.getElementById('orders-table-body');
  tbody.innerHTML = '';

  if (invoiceCatalog.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-secondary text-center">No orders found. Use "+ New Issue" to begin.</td></tr>';
    return;
  }

  invoiceCatalog.forEach(inv => {
    const isPaid = inv.current_status === 'Paid';
    const isRedeemed = inv.current_status === 'Redeemed';
    
    let statusBadge = `<span class="badge badge-unpaid">Unpaid</span>`;
    let actionBtn = `<button class="btn btn-success btn-sm" onclick="confirmPayment(${inv.id})">Confirm Payment</button>`;
    
    if (isRedeemed) {
      statusBadge = `<span class="badge badge-redeemed">Redeemed</span>`;
      actionBtn = `<button class="btn btn-secondary btn-sm" onclick="openInvoiceDetails(${inv.id})">Details</button>`;
    } else if (isPaid) {
      statusBadge = `<span class="badge badge-paid">Paid</span>`;
      actionBtn = `
        <button class="btn btn-primary btn-sm" onclick="openVoucherModal('${inv.voucher_code}')">View Voucher</button>
        <button class="btn btn-secondary btn-sm" style="margin-left:5px;" onclick="openInvoiceDetails(${inv.id})">Details</button>
      `;
    } else {
      actionBtn = `
        ${actionBtn}
        <button class="btn btn-secondary btn-sm" style="margin-left:5px;" onclick="openInvoiceDetails(${inv.id})">Details</button>
      `;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>#${inv.id}</td>
      <td><strong>${inv.customer_name}</strong></td>
      <td>${inv.ticket_title}</td>
      <td>${inv.quantity}</td>
      <td>Rp ${inv.total_price.toLocaleString('id-ID')}</td>
      <td>${inv.payment_method}</td>
      <td>${statusBadge}</td>
      <td style="white-space: nowrap;">${actionBtn}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Invoices list for the new Invoices tab
function renderInvoicesTable() {
  const tbody = document.getElementById('invoices-list-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (invoiceCatalog.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-secondary text-center">No invoices found.</td></tr>';
    return;
  }

  invoiceCatalog.forEach(inv => {
    const isPaid = inv.current_status === 'Paid';
    const isRedeemed = inv.current_status === 'Redeemed';
    let statusBadge = `<span class="badge badge-unpaid">Unpaid</span>`;
    if (isRedeemed) statusBadge = `<span class="badge badge-redeemed">Redeemed</span>`;
    else if (isPaid) statusBadge = `<span class="badge badge-paid">Paid</span>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>#${inv.id}</td>
      <td><strong>${inv.customer_name}</strong></td>
      <td>${inv.ticket_title}</td>
      <td>${inv.quantity}</td>
      <td>Rp ${inv.total_price.toLocaleString('id-ID')}</td>
      <td>${statusBadge}</td>
      <td>
        <button class="bg-primary text-on-primary py-1 px-3 rounded text-xs font-semibold hover:bg-surface-tint" onclick="openInvoiceDetails(${inv.id})">View Invoice</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Vouchers list for the new Vouchers tab
function renderVouchersList() {
  const tbody = document.getElementById('vouchers-list-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  // Show paid or redeemed invoices as scannable vouchers
  const paidVouchers = invoiceCatalog.filter(i => i.current_status === 'Paid' || i.current_status === 'Redeemed');

  if (paidVouchers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-secondary text-center">No paid or active vouchers found.</td></tr>';
    return;
  }

  paidVouchers.forEach(inv => {
    const isRedeemed = inv.current_status === 'Redeemed';
    const statusBadge = isRedeemed 
      ? `<span class="badge badge-redeemed">Redeemed</span>` 
      : `<span class="badge badge-paid">Paid (Active)</span>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="font-code-mono">${inv.voucher_code}</td>
      <td><strong>${inv.customer_name}</strong></td>
      <td>${inv.ticket_title}</td>
      <td>${inv.quantity}</td>
      <td>${statusBadge}</td>
      <td>
        <button class="bg-primary text-on-primary py-1 px-3 rounded text-xs font-semibold hover:bg-surface-tint" onclick="openVoucherModal('${inv.voucher_code}')">View Ticket (QR)</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderSettingsForm() {
  document.getElementById('settings-name').value = appSettings.merchant_name || '';
  document.getElementById('settings-website').value = appSettings.merchant_website || '';
  document.getElementById('settings-email').value = appSettings.merchant_email || '';
  document.getElementById('settings-phone').value = appSettings.merchant_phone || '';
  document.getElementById('settings-address').value = appSettings.merchant_address || '';
  document.getElementById('settings-logo').value = appSettings.merchant_logo_url || '';
  document.getElementById('settings-logo-preview').src = appSettings.merchant_logo_url || '';
  document.getElementById('settings-nvidia-key').value = appSettings.nvidia_api_key || '';
  document.getElementById('settings-nvidia-model').value = appSettings.nvidia_model || 'nvidia/llama-3.1-nemotron-70b-instruct';
  document.getElementById('settings-waha-url').value = appSettings.waha_url || '';
  document.getElementById('settings-primary-color').value = appSettings.primary_color || '#000000';
  document.getElementById('settings-primary-color-text').value = appSettings.primary_color || '#000000';
  document.getElementById('settings-secondary-color').value = appSettings.secondary_color || '#006c4a';
  document.getElementById('settings-secondary-color-text').value = appSettings.secondary_color || '#006c4a';
  document.getElementById('settings-background-color').value = appSettings.background_color || '#f8f9ff';
  document.getElementById('settings-background-color-text').value = appSettings.background_color || '#f8f9ff';
  document.getElementById('settings-tax-rate').value = appSettings.tax_rate || '0';
  document.getElementById('settings-service-fee').value = appSettings.service_fee || '0';
  document.getElementById('settings-discount-rate').value = appSettings.discount_rate || '0';
  document.getElementById('settings-discount-label').value = appSettings.discount_label || 'Diskon';
}

// Confirm Invoice payment
async function confirmPayment(invoiceId) {
  try {
    const response = await fetch(`/api/invoices/${invoiceId}/pay`, {
      method: 'POST',
      headers: { 'Authorization': token }
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to verify payment');

    showToast('Payment verified. Voucher issued.');
    await loadInvoices();
    if (currentTab === 'orders') renderOrdersTable();
    if (currentTab === 'dashboard') renderDashboardStats();
  } catch (err) {
    showToast(err.message, true);
  }
}

// Customers list
function renderCustomersTable() {
  const tbody = document.getElementById('customers-table-body');
  tbody.innerHTML = '';

  if (invoiceCatalog.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-secondary text-center">No customers available.</td></tr>';
    return;
  }

  // Filter unique customer profiles
  const profiles = {};
  invoiceCatalog.forEach(inv => {
    if (!profiles[inv.customer_name]) {
      profiles[inv.customer_name] = {
        name: inv.customer_name,
        orders: 0,
        lastOrder: inv.id,
        method: inv.payment_method,
        status: inv.current_status
      };
    }
    profiles[inv.customer_name].orders++;
  });

  Object.values(profiles).forEach(p => {
    let badge = `<span class="badge badge-unpaid">Unpaid</span>`;
    if (p.status === 'Redeemed') badge = `<span class="badge badge-redeemed">Redeemed</span>`;
    else if (p.status === 'Paid') badge = `<span class="badge badge-paid">Paid</span>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${p.name}</strong></td>
      <td>${p.orders} Ticket(s)</td>
      <td>#${p.lastOrder}</td>
      <td>${p.method}</td>
      <td>${badge}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Store panel Tickets list (CRUD)
function renderStoreTicketsTable() {
  const tbody = document.getElementById('store-tickets-table-body');
  tbody.innerHTML = '';

  ticketCatalog.forEach(ticket => {
    const isAct = ticket.is_active === 1;
    const statusText = isAct ? 'Active' : 'Inactive';
    const statusClass = isAct ? 'badge-paid' : 'badge-unpaid';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${ticket.title}</strong></td>
      <td>Rp ${ticket.price.toLocaleString('id-ID')}</td>
      <td><span class="badge ${statusClass}">${statusText}</span></td>
      <td class="button-row">
        <button class="px-3 py-1 bg-secondary-container text-on-secondary-container rounded-lg text-xs font-semibold hover:bg-opacity-80 transition-all mr-2" onclick="editStoreTicket(${ticket.id}, '${ticket.title.replace(/'/g, "\\'")}', ${ticket.price}, '${(ticket.description || '').replace(/'/g, "\\'")}', ${ticket.is_active})">Edit</button>
        <button class="px-3 py-1 bg-error-container text-on-error-container rounded-lg text-xs font-semibold hover:bg-opacity-80 transition-all" onclick="deleteStoreTicket(${ticket.id})">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Edit ticket in Store panel
function editStoreTicket(id, title, price, description, is_active) {
  document.getElementById('store-ticket-edit-id').value = id;
  document.getElementById('store-ticket-title').value = title;
  document.getElementById('store-ticket-price').value = price;
  document.getElementById('store-ticket-desc').value = description;
  document.getElementById('store-ticket-status').value = is_active;

  document.getElementById('store-form-title').innerText = 'Edit Ticket Category';
  document.getElementById('btn-store-save-ticket').innerText = 'Update Ticket Class';
  document.getElementById('btn-store-cancel-edit').classList.remove('hidden');
}

// Reset ticket class CRUD form
function resetStoreTicketForm() {
  document.getElementById('store-ticket-edit-id').value = '';
  document.getElementById('store-ticket-title').value = '';
  document.getElementById('store-ticket-price').value = '';
  document.getElementById('store-ticket-desc').value = '';
  document.getElementById('store-ticket-status').value = '1';

  document.getElementById('store-form-title').innerText = 'Create Ticket Category';
  document.getElementById('btn-store-save-ticket').innerText = 'Save Category';
  document.getElementById('btn-store-cancel-edit').classList.add('hidden');
}

// Delete ticket from Store catalog
async function deleteStoreTicket(id) {
  if (!confirm('Are you sure you want to delete this ticket class? This will invalidate catalog references.')) return;
  try {
    const response = await fetch(`/api/tickets/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': token }
    });
    if (!response.ok) throw new Error('Failed to delete ticket class');

    showToast('Ticket class removed.');
    await loadTickets();
    renderStoreTicketsTable();
    renderBookingCatalog();
  } catch (err) {
    showToast(err.message, true);
  }
}

// Issued vouchers list (with scan validation info)
function renderIssuedVouchersTable() {
  const tbody = document.getElementById('issued-table-body');
  tbody.innerHTML = '';

  const paidInvoices = invoiceCatalog.filter(i => i.current_status === 'Paid' || i.current_status === 'Redeemed');
  if (paidInvoices.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-secondary text-center">No paid vouchers issued yet.</td></tr>';
    return;
  }

  paidInvoices.forEach(inv => {
    const isRed = inv.current_status === 'Redeemed';
    const statusText = isRed ? 'Redeemed' : 'Paid (Active)';
    const badgeClass = isRed ? 'badge-redeemed' : 'badge-paid';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${inv.voucher_code}</strong></td>
      <td>${inv.customer_name}</td>
      <td>${inv.ticket_title}</td>
      <td>${inv.quantity}</td>
      <td>${inv.payment_method}</td>
      <td><span class="badge ${badgeClass}">${statusText}</span></td>
      <td>${isRed ? 'Scanned Checked-in ✓' : 'Pending Verification'}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Modals Open/Close controls
function openNewIssueModal() {
  resetBookingFlow();
  initVisitDateInput();
  const el = document.getElementById('new-issue-modal');
  if (el) el.classList.remove('hidden');
}

function closeNewIssueModal() {
  const el = document.getElementById('new-issue-modal');
  if (el) el.classList.add('hidden');
}

function openRedeemModal() {
  // Reset QR scanner feedback
  const feedbackContainer = document.getElementById('scan-feedback');
  feedbackContainer.className = 'scan-feedback-container feedback-neutral';
  document.getElementById('feedback-title').innerText = 'Ready to Scan';
  document.getElementById('feedback-desc').innerText = 'Place QR Code in front of the camera or submit code above.';
  document.getElementById('feedback-details').classList.add('hidden');
  document.getElementById('btn-confirm-redeem').classList.add('hidden');
  document.getElementById('manual-code-input-modal').value = '';
  
  document.getElementById('redeem-modal').classList.remove('hidden');
}

function closeRedeemModal() {
  stopCamera();
  document.getElementById('redeem-modal').classList.add('hidden');
}

function openNewVoucherModal() {
  // Switches to Store tab to let them configure new Master Tickets
  switchTab('store');
  showToast('Define ticket class in store configuration form.');
}

// Phone Simulator Booking Functions
function renderBookingCatalog() {
  const container = document.getElementById('booking-items-list');
  if (!container) return;

  container.innerHTML = '';
  bookingQuantities = {};

  // Only list active tickets in the simulator booking view
  const activeTickets = ticketCatalog.filter(t => t.is_active === 1);

  if (activeTickets.length === 0) {
    container.innerHTML = '<p class="text-secondary text-center" style="font-size:0.8rem;">No active ticket categories available.</p>';
    return;
  }

  activeTickets.forEach(ticket => {
    bookingQuantities[ticket.id] = 0;
    
    let categoryName = ticket.title;
    let mainHeaderName = 'High Season - Tiket Masuk';
    
    if (ticket.title.includes('(') && ticket.title.includes(')')) {
      const parts = ticket.title.split('(');
      mainHeaderName = parts[0].trim();
      categoryName = parts[1].replace(')', '').trim();
    }

    const itemDiv = document.createElement('div');
    itemDiv.className = 'flex items-center justify-between p-4 bg-surface-container-low border border-outline-variant rounded-xl shadow-sm transition-all hover:shadow-md';
    itemDiv.innerHTML = `
      <div class="flex flex-col gap-1">
        <span class="font-semibold text-on-surface text-sm">${mainHeaderName}</span>
        <span class="text-xs text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded-full w-fit">${categoryName}</span>
        <span class="font-bold text-primary text-sm mt-1">Rp ${ticket.price.toLocaleString('id-ID')}</span>
      </div>
      <div class="flex items-center gap-3 bg-surface-container-high rounded-lg p-1.5 border border-outline-variant">
        <button type="button" onclick="updateQty(${ticket.id}, -1)" class="w-8 h-8 rounded-full bg-surface-container-lowest border border-outline-variant flex items-center justify-center text-on-surface hover:bg-primary hover:text-on-primary active:scale-90 transition-all font-bold text-lg select-none">−</button>
        <span id="qty-${ticket.id}" class="font-bold text-sm w-6 text-center select-none text-on-surface">0</span>
        <button type="button" onclick="updateQty(${ticket.id}, 1)" class="w-8 h-8 rounded-full bg-surface-container-lowest border border-outline-variant flex items-center justify-center text-on-surface hover:bg-primary hover:text-on-primary active:scale-90 transition-all font-bold text-lg select-none">+</button>
      </div>
    `;
    container.appendChild(itemDiv);
  });

  updateBookingTotal();
}

function updateQty(ticketId, change) {
  if (bookingQuantities[ticketId] === undefined) return;
  const newVal = Math.max(0, bookingQuantities[ticketId] + change);
  bookingQuantities[ticketId] = newVal;
  document.getElementById(`qty-${ticketId}`).innerText = newVal;
  updateBookingTotal();
}

function updateBookingTotal() {
  let subtotal = 0;
  const selectedItems = [];
  ticketCatalog.forEach(ticket => {
    const qty = bookingQuantities[ticket.id] || 0;
    if (qty > 0) {
      subtotal += ticket.price * qty;
      selectedItems.push({ ticket, qty });
    }
  });

  // Read per-transaction overrides (fall back to appSettings)
  const discountRate = parseFloat(document.getElementById('checkout-discount')?.value) || parseFloat(appSettings.discount_rate) || 0;
  const taxRate = parseFloat(document.getElementById('checkout-tax')?.value) || parseFloat(appSettings.tax_rate) || 0;
  const serviceFee = parseFloat(appSettings.service_fee) || 0;
  const discLabel = document.getElementById('checkout-discount-label')?.value.trim() || appSettings.discount_label || 'Diskon';

  const discountAmt = Math.round(subtotal * discountRate / 100);
  const afterDiscount = subtotal - discountAmt;
  const taxAmt = Math.round(afterDiscount * taxRate / 100);
  const total = afterDiscount + taxAmt + serviceFee;

  // Render item list in checkout summary
  const itemsEl = document.getElementById('checkout-items-list');
  if (itemsEl) {
    if (selectedItems.length === 0) {
      itemsEl.innerHTML = '<p class="text-xs text-on-surface-variant italic">Belum ada tiket dipilih.</p>';
    } else {
      itemsEl.innerHTML = selectedItems.map(({ ticket, qty }) => `
        <div class="flex justify-between items-center py-1.5 border-b border-outline-variant last:border-0">
          <div>
            <div class="text-xs font-semibold text-on-surface">${ticket.title}</div>
            <div class="text-[10px] text-on-surface-variant">${qty} × Rp ${ticket.price.toLocaleString('id-ID')}</div>
          </div>
          <span class="text-xs font-bold text-on-surface">Rp ${(ticket.price * qty).toLocaleString('id-ID')}</span>
        </div>
      `).join('');
    }
  }

  // Render price breakdown
  const breakdownEl = document.getElementById('booking-price-breakdown');
  if (breakdownEl) {
    let rows = `<div class="flex justify-between items-center">
      <span class="text-xs text-on-surface-variant font-semibold">Subtotal</span>
      <span class="font-semibold text-on-surface">Rp ${subtotal.toLocaleString('id-ID')}</span>
    </div>`;
    if (discountRate > 0) {
      rows += `<div class="flex justify-between items-center text-emerald-600">
        <span class="text-xs font-semibold">${discLabel} (${discountRate}%)</span>
        <span class="font-semibold">- Rp ${discountAmt.toLocaleString('id-ID')}</span>
      </div>`;
    }
    if (taxRate > 0) {
      rows += `<div class="flex justify-between items-center text-on-surface-variant">
        <span class="text-xs font-semibold">PPN (${taxRate}%)</span>
        <span class="font-semibold">Rp ${taxAmt.toLocaleString('id-ID')}</span>
      </div>`;
    }
    if (serviceFee > 0) {
      rows += `<div class="flex justify-between items-center text-on-surface-variant">
        <span class="text-xs font-semibold">Biaya Layanan</span>
        <span class="font-semibold">Rp ${serviceFee.toLocaleString('id-ID')}</span>
      </div>`;
    }
    breakdownEl.innerHTML = rows;
  }

  document.getElementById('booking-total-price').innerText = `Rp ${total.toLocaleString('id-ID')}`;
}

let calendarCurrentDate = new Date();
let calendarSelectedDate = new Date();

function initVisitDateInput() {
  calendarCurrentDate = new Date();
  calendarSelectedDate = new Date();

  // Render month
  renderCustomCalendar();

  // Select initial date
  selectCalendarDate(calendarSelectedDate);

  // Seed discount/tax from settings (only if not yet filled)
  const discEl = document.getElementById('checkout-discount');
  const taxEl = document.getElementById('checkout-tax');
  const labelEl = document.getElementById('checkout-discount-label');
  if (discEl && !discEl.value) discEl.value = parseFloat(appSettings.discount_rate) || '';
  if (taxEl && !taxEl.value) taxEl.value = parseFloat(appSettings.tax_rate) || '';
  if (labelEl && !labelEl.value) labelEl.value = appSettings.discount_label || '';
  updateBookingTotal();
}

function renderCustomCalendar() {
  const grid = document.getElementById('calendar-days-grid');
  const monthYearEl = document.getElementById('calendar-month-year');
  if (!grid || !monthYearEl) return;

  const year = calendarCurrentDate.getFullYear();
  const month = calendarCurrentDate.getMonth();

  // Set header text
  monthYearEl.innerText = `${monthsLong[month]} ${year}`;

  grid.innerHTML = '';

  // Day week-index of the 1st day (0 = Sunday, 1 = Monday, etc.)
  const firstDay = new Date(year, month, 1).getDay();
  // Total days in current month
  const totalDays = new Date(year, month + 1, 0).getDate();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Pad days before 1st of month
  for (let i = 0; i < firstDay; i++) {
    const pad = document.createElement('div');
    pad.className = 'text-center p-2 text-outline/35 pointer-events-none select-none';
    grid.appendChild(pad);
  }

  // Render days
  for (let day = 1; day <= totalDays; day++) {
    const thisDate = new Date(year, month, day);
    const isPast = thisDate < today;
    const isSelected = calendarSelectedDate &&
                       calendarSelectedDate.getDate() === day &&
                       calendarSelectedDate.getMonth() === month &&
                       calendarSelectedDate.getFullYear() === year;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerText = day;

    let btnClass = 'w-full aspect-square flex items-center justify-center rounded-lg transition-all text-xs font-semibold ';
    if (isPast) {
      btnClass += 'text-outline/40 cursor-not-allowed bg-transparent';
      btn.disabled = true;
    } else if (isSelected) {
      btnClass += 'bg-primary text-on-primary font-bold shadow-sm scale-105';
    } else {
      btnClass += 'text-on-surface hover:bg-primary-container/20 active:scale-95';
    }

    btn.className = btnClass;

    if (!isPast) {
      btn.onclick = () => {
        calendarSelectedDate = thisDate;
        selectCalendarDate(thisDate);
        renderCustomCalendar(); // Redraw selection
      };
    }

    grid.appendChild(btn);
  }
}

function changeCalendarMonth(direction) {
  const today = new Date();
  const targetDate = new Date(calendarCurrentDate.getFullYear(), calendarCurrentDate.getMonth() + direction, 1);

  // Avoid navigating to past months
  const compareToday = new Date(today.getFullYear(), today.getMonth(), 1);
  if (targetDate < compareToday) return;

  calendarCurrentDate = targetDate;
  renderCustomCalendar();
}

function selectCalendarDate(dateObj) {
  const dateString = `${daysLong[dateObj.getDay()]}, ${dateObj.getDate()} ${monthsLong[dateObj.getMonth()]} ${dateObj.getFullYear()}`;
  selectedBookingDateString = dateString;
  const el = document.getElementById('selected-date-text');
  if (el) el.innerText = dateString;
}

function showBookingConfirm() {
  const customerName = document.getElementById('booking-customer-name').value.trim();
  const paymentMethod = document.getElementById('booking-payment-method').value;
  if (!customerName) { showToast('Please enter visitor name!', true); return; }

  const selectedItems = [];
  let subtotal = 0;
  ticketCatalog.forEach(ticket => {
    const qty = bookingQuantities[ticket.id] || 0;
    if (qty > 0) { selectedItems.push({ ticket, qty }); subtotal += ticket.price * qty; }
  });
  if (selectedItems.length === 0) { showToast('Please select at least 1 ticket!', true); return; }

  const discountRate = parseFloat(document.getElementById('checkout-discount')?.value) || 0;
  const taxRate = parseFloat(document.getElementById('checkout-tax')?.value) || 0;
  const serviceFee = parseFloat(appSettings.service_fee) || 0;
  const discLabel = document.getElementById('checkout-discount-label')?.value.trim() || appSettings.discount_label || 'Discount';
  const discountAmt = Math.round(subtotal * discountRate / 100);
  const afterDiscount = subtotal - discountAmt;
  const taxAmt = Math.round(afterDiscount * taxRate / 100);
  const total = afterDiscount + taxAmt + serviceFee;

  const itemRows = selectedItems.map(({ ticket, qty }) =>
    `<div class="flex justify-between text-xs py-1 border-b border-outline-variant last:border-0">
      <span class="font-semibold text-on-surface">${ticket.title} <span class="text-on-surface-variant font-normal">×${qty}</span></span>
      <span class="font-bold">Rp ${(ticket.price * qty).toLocaleString('id-ID')}</span>
    </div>`
  ).join('');

  document.getElementById('confirm-summary-body').innerHTML = `
    <div class="bg-surface-container-low rounded-lg p-3 space-y-1">
      <div class="flex justify-between text-xs text-on-surface-variant"><span class="font-bold uppercase tracking-wider">Customer</span><span class="font-semibold text-on-surface">${customerName}</span></div>
      <div class="flex justify-between text-xs text-on-surface-variant"><span class="font-bold uppercase tracking-wider">Date</span><span class="font-semibold text-on-surface">${selectedBookingDateString || '-'}</span></div>
      <div class="flex justify-between text-xs text-on-surface-variant"><span class="font-bold uppercase tracking-wider">Payment</span><span class="font-semibold text-on-surface">${paymentMethod}</span></div>
    </div>
    <div class="space-y-0">${itemRows}</div>
    <div class="bg-surface-container-low rounded-lg p-3 space-y-1 text-xs">
      <div class="flex justify-between"><span class="text-on-surface-variant">Subtotal</span><span class="font-semibold">Rp ${subtotal.toLocaleString('id-ID')}</span></div>
      ${discountRate > 0 ? `<div class="flex justify-between text-emerald-600"><span>${discLabel} (${discountRate}%)</span><span class="font-semibold">- Rp ${discountAmt.toLocaleString('id-ID')}</span></div>` : ''}
      ${taxRate > 0 ? `<div class="flex justify-between text-on-surface-variant"><span>Tax / PPN (${taxRate}%)</span><span class="font-semibold">Rp ${taxAmt.toLocaleString('id-ID')}</span></div>` : ''}
      ${serviceFee > 0 ? `<div class="flex justify-between text-on-surface-variant"><span>Service Fee</span><span class="font-semibold">Rp ${serviceFee.toLocaleString('id-ID')}</span></div>` : ''}
      <div class="flex justify-between border-t border-outline-variant pt-2 mt-1"><span class="font-bold text-sm text-on-surface">Total</span><span class="font-black text-primary text-sm">Rp ${total.toLocaleString('id-ID')}</span></div>
    </div>`;
  document.getElementById('booking-confirm-modal').classList.remove('hidden');
}

function closeBookingConfirm() {
  document.getElementById('booking-confirm-modal').classList.add('hidden');
}

async function processBookingSubmit(payDirectly = false) {
  const customerName = document.getElementById('booking-customer-name').value.trim();
  const paymentMethod = document.getElementById('booking-payment-method').value;
  
  if (!customerName) {
    showToast('Harap masukkan nama lengkap pengunjung!', true);
    return;
  }

  const orderItems = [];
  ticketCatalog.forEach(ticket => {
    const qty = bookingQuantities[ticket.id] || 0;
    if (qty > 0) {
      orderItems.push({
        ticketId: ticket.id,
        quantity: qty,
        ticket: ticket
      });
    }
  });

  if (orderItems.length === 0) {
    showToast('Harap pilih minimal 1 tiket pengunjung!', true);
    return;
  }

  try {
    const createdIds = [];
    closeBookingConfirm();

    for (const item of orderItems) {
      const response = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName,
          ticketId: item.ticketId,
          quantity: item.quantity,
          paymentMethod,
          visitDate: selectedBookingDateString || null
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to submit order');
      createdIds.push(data.id);
    }

    // Auto-pay if user clicked "Bayar Langsung"
    if (payDirectly) {
      for (const id of createdIds) {
        await fetch('/api/invoices/' + id + '/pay', {
          method: 'POST',
          headers: { 'Authorization': token }
        });
      }
    }

    showToast(payDirectly ? 'Pembayaran berhasil dikonfirmasi!' : 'Invoice berhasil dibuat!');
    resetBookingFlow();
    await loadInvoices();

    if (createdIds.length === 1) {
      openInvoiceDetails(createdIds[0]);
    } else {
      openMultiInvoiceDetails(createdIds);
    }

  } catch (err) {
    showToast(err.message, true);
  }
}

function resetBookingFlow() {
  document.getElementById('booking-customer-name').value = '';
  document.getElementById('booking-step-1').classList.remove('hidden');
  document.getElementById('booking-step-2').classList.add('hidden');
  renderBookingCatalog();
}

// Modal View: Multi-ticket order — render all invoices in 1 combined view
async function openMultiInvoiceDetails(invoiceIds) {
  try {
    const invoices = invoiceIds.map(id => invoiceCatalog.find(i => i.id === id)).filter(Boolean);
    if (invoices.length === 0) throw new Error('Invoices not found');

    const first = invoices[0];
    const allUnpaid = invoices.every(i => i.current_status === 'Unpaid');
    const modalBody = document.getElementById('modal-body-container');

    // Header buttons: pay all if all unpaid
    const headerTitle = document.querySelector('.modal-action-row h3');
    if (headerTitle) headerTitle.innerText = `Order: ${first.customer_name} (${invoices.length} Tickets)`;

    const payBtn = document.getElementById('modal-pay-btn');
    const viewVchBtn = document.getElementById('modal-view-vch-btn');
    payBtn.classList.add('hidden');
    viewVchBtn.classList.add('hidden');

    if (allUnpaid) {
      payBtn.classList.remove('hidden');
      payBtn.innerText = `Confirm Payment (${invoices.length} Invoices)`;
      payBtn.onclick = async () => {
        for (const inv of invoices) {
          await confirmPayment(inv.id);
        }
        openMultiInvoiceDetails(invoiceIds);
      };
    }

    const paidInvoices = invoices.filter(i => i.current_status === 'Paid' || i.current_status === 'Redeemed');
    if (paidInvoices.length > 0) {
      viewVchBtn.classList.remove('hidden');
      viewVchBtn.innerText = `View All Vouchers (${paidInvoices.length})`;
      viewVchBtn.onclick = () => {
        const codes = paidInvoices.map(i => i.voucher_code).filter(Boolean);
        openVoucherModal(codes.join(','));
      };
    }

    // Table rows: 1 row per ticket type
    const tableRows = invoices.map(inv => `
      <tr class="border-b border-outline-variant hover:bg-surface transition-colors">
        <td class="py-4 px-4">
          <div class="font-semibold">${inv.ticket_title}</div>
          <div class="flex items-center gap-2 mt-1">
            <span class="badge ${inv.current_status === 'Paid' ? 'badge-paid' : inv.current_status === 'Redeemed' ? 'badge-redeemed' : 'badge-unpaid'} text-[9px] px-2 py-0.5">${inv.current_status.toUpperCase()}</span>
            ${inv.voucher_code ? `<span class="font-mono text-xs text-on-surface-variant">${inv.voucher_code}</span>` : ''}
          </div>
        </td>
        <td class="py-4 px-4 text-right">Rp ${(inv.total_price / inv.quantity).toLocaleString('id-ID')}</td>
        <td class="py-4 px-4 text-center">${inv.quantity}</td>
        <td class="py-4 px-4 text-right font-code-mono">Rp ${inv.total_price.toLocaleString('id-ID')}</td>
        <td class="py-4 px-4 text-center">
          ${inv.current_status === 'Paid' || inv.current_status === 'Redeemed'
            ? `<button onclick="openVoucherModal('${inv.voucher_code}')" class="px-2 py-1 bg-primary text-on-primary text-xs font-bold rounded-lg flex items-center gap-1 mx-auto"><span class="material-symbols-outlined text-[14px]">qr_code</span>Voucher</button>`
            : `<button onclick="confirmPaymentFromModal(${inv.id})" class="px-2 py-1 bg-secondary-container text-on-secondary-container text-xs font-bold rounded-lg mx-auto">Pay</button>`
          }
        </td>
      </tr>
    `).join('');

    const subtotalAll = invoices.reduce((s, i) => s + i.total_price, 0);
    const p = calcPricing(subtotalAll);
    const discLabel = appSettings.discount_label || 'Discount';

    const visitLabel = first.visit_date || new Date(first.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

    modalBody.innerHTML = `
      <div class="invoice-container max-w-4xl mx-auto bg-surface-container-lowest shadow-sm rounded-xl overflow-hidden relative border border-outline-variant p-8 md:p-10">
        <div class="h-2 bg-primary w-full absolute top-0 left-0"></div>

        <!-- Header -->
        <div class="flex flex-col md:flex-row justify-between items-start mb-10 gap-8 pt-4">
          <div>
            <div class="flex items-center gap-2 mb-4">
              <img src="${appSettings.merchant_logo_url || ''}" alt="Logo" class="h-12 object-contain bg-white rounded p-1 border border-outline-variant">
            </div>
            <div class="font-body-md text-body-md text-on-surface-variant space-y-1">
              <p class="font-semibold text-on-surface">${appSettings.merchant_name || 'Batur Natural Hot Spring'}</p>
              <p>${appSettings.merchant_address || ''}</p>
              <p>${appSettings.merchant_email || ''}</p>
              <p>${appSettings.merchant_phone || ''}</p>
            </div>
          </div>
          <div class="text-left md:text-right">
            <h1 class="font-display-lg text-display-lg font-bold text-primary mb-2">INVOICE</h1>
            <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-body-md">
              <span class="font-semibold text-on-surface text-left md:text-right">Order Ref:</span>
              <span class="text-on-surface-variant font-code-mono text-left md:text-right">#INV-${invoices.map(i=>i.id).join(', #INV-')}</span>
              <span class="font-semibold text-on-surface text-left md:text-right">Date Issued:</span>
              <span class="text-on-surface-variant text-left md:text-right">${new Date(first.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              <span class="font-semibold text-on-surface text-left md:text-right">Visit Date:</span>
              <span class="text-primary font-bold text-left md:text-right">${visitLabel}</span>
              <span class="font-semibold text-on-surface text-left md:text-right">Payment Method:</span>
              <span class="text-on-surface-variant text-left md:text-right">${first.payment_method}</span>
            </div>
          </div>
        </div>

        <!-- Billed To -->
        <div class="bg-surface-container-low p-6 rounded-lg mb-10">
          <h3 class="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant mb-2">Billed To:</h3>
          <p class="font-headline-sm font-semibold text-on-surface">${first.customer_name}</p>
          <p class="text-sm text-on-surface-variant mt-1">${invoices.length} Ticket Types</p>
        </div>

        <!-- Items Table -->
        <div class="mb-10 overflow-x-auto">
          <table class="w-full text-left border-collapse min-w-[600px]">
            <thead>
              <tr class="bg-surface-container-low border-b border-outline-variant">
                <th class="py-3 px-4 font-label-md text-label-md uppercase tracking-wider text-on-surface-variant w-2/5">Ticket</th>
                <th class="py-3 px-4 font-label-md text-label-md uppercase tracking-wider text-on-surface-variant text-right">Price</th>
                <th class="py-3 px-4 font-label-md text-label-md uppercase tracking-wider text-on-surface-variant text-center">Qty</th>
                <th class="py-3 px-4 font-label-md text-label-md uppercase tracking-wider text-on-surface-variant text-right">Subtotal</th>
                <th class="py-3 px-4 font-label-md text-label-md uppercase tracking-wider text-on-surface-variant text-center">Action</th>
              </tr>
            </thead>
            <tbody class="font-body-md text-body-md text-on-surface">${tableRows}</tbody>
          </table>
        </div>

        <!-- Totals -->
        <div class="flex flex-col md:flex-row justify-between items-end">
          <div class="w-full md:w-1/2 mb-6 md:mb-0 text-on-surface-variant font-body-md text-sm pr-4">
            <h4 class="font-semibold text-on-surface mb-2">Terms &amp; Conditions</h4>
            <p>Vouchers are non-refundable but can be rescheduled up to 24 hours before the reservation date.</p>
          </div>
          <div class="w-full md:w-1/3 space-y-3">
            <div class="flex justify-between font-body-md text-on-surface">
              <span>Subtotal:</span>
              <span class="font-code-mono">Rp ${p.subtotal.toLocaleString('id-ID')}</span>
            </div>
            ${p.discountRate > 0 ? `<div class="flex justify-between font-body-md text-emerald-600">
              <span>${discLabel} (${p.discountRate}%):</span>
              <span class="font-code-mono">- Rp ${p.discountAmt.toLocaleString('id-ID')}</span>
            </div>` : ''}
            ${p.taxRate > 0 ? `<div class="flex justify-between font-body-md text-on-surface">
              <span>Tax / PPN (${p.taxRate}%):</span>
              <span class="font-code-mono">Rp ${p.taxAmt.toLocaleString('id-ID')}</span>
            </div>` : ''}
            ${p.serviceFee > 0 ? `<div class="flex justify-between font-body-md text-on-surface border-b border-outline-variant pb-3">
              <span>Service Fee:</span>
              <span class="font-code-mono">Rp ${p.serviceFee.toLocaleString('id-ID')}</span>
            </div>` : '<div class="border-b border-outline-variant pb-1"></div>'}
            <div class="flex justify-between items-center pt-2">
              <span class="font-headline-sm font-bold text-secondary">Total Due:</span>
              <span class="font-headline-md font-bold text-secondary font-code-mono">Rp ${p.total.toLocaleString('id-ID')}</span>
            </div>
          </div>
        </div>

        <div class="bg-surface-container px-8 py-6 text-center border-t border-outline-variant mt-8 -mx-8 -mb-8 md:-mx-10 md:-mb-10">
          <p class="font-body-md text-on-surface-variant">Thank you for visiting ${appSettings.merchant_name || 'Batur Natural Hot Spring'}!</p>
        </div>
      </div>
    `;

    closeNewIssueModal();
    document.getElementById('details-modal').classList.remove('hidden');
  } catch (err) {
    showToast(err.message, true);
  }
}

// Modal View: Open Invoice Details
// Modal View: Open Invoice Details
async function openInvoiceDetails(invoiceId) {
  try {
    const inv = invoiceCatalog.find(i => i.id === invoiceId);
    if (!inv) throw new Error('Invoice not found');

    const modalBody = document.getElementById('modal-body-container');
    const isPaid = inv.current_status === 'Paid';
    const isRedeemed = inv.current_status === 'Redeemed';

    // Set modal header title
    const headerTitle = document.querySelector('.modal-action-row h3');
    if (headerTitle) headerTitle.innerText = `Invoice #${inv.id}`;

    // Manage header action buttons
    const payBtn = document.getElementById('modal-pay-btn');
    const viewVchBtn = document.getElementById('modal-view-vch-btn');

    if (!isPaid && !isRedeemed) {
      payBtn.classList.remove('hidden');
      payBtn.onclick = () => confirmPaymentFromModal(inv.id);
      viewVchBtn.classList.add('hidden');
    } else if (isPaid) {
      payBtn.classList.add('hidden');
      viewVchBtn.classList.remove('hidden');
      viewVchBtn.onclick = () => openVoucherModal(inv.voucher_code);
    } else {
      payBtn.classList.add('hidden');
      viewVchBtn.classList.add('hidden');
    }

    modalBody.innerHTML = `
      <div class="invoice-container max-w-4xl mx-auto bg-surface-container-lowest shadow-[0px_2px_4px_rgba(0,0,0,0.05)] rounded-xl overflow-hidden relative border border-outline-variant p-8 md:p-10">
        <!-- Watermark -->
        ${(isPaid || isRedeemed) ? `<div class="watermark font-display-lg text-primary/5">PAID</div>` : `<div class="watermark font-display-lg text-red-500/5">UNPAID</div>`}
        <!-- Green Top Bar -->
        <div class="h-2 bg-primary w-full absolute top-0 left-0"></div>
        
        <!-- Invoice Header -->
        <div class="flex flex-col md:flex-row justify-between items-start mb-12 gap-8 pt-4">
          <!-- Park Info -->
          <div>
            <div class="flex items-center gap-2 mb-4">
              <img src="${appSettings.merchant_logo_url || 'https://lh3.googleusercontent.com/aida/AP1WRLtiJ2K5eJTLjE8W7HzdMaUiQ08NqXBYN0NkHKcqPP927qeFtN-qilPR7-uIB-s_CmqdUTMB8yvgtAkSN5WMRu41-aTsWFU0pvTpPtYwqbVPCZXdGWDnSaYcbZBZl2u-lReVLYLPz6FECLtkHrc0TjMyeuzgmCjmwHqLPYiMkhXfePfB-dhd2zGBblCXN_dOL4i-ToFSBtDRAfHVk8UjpexxOnmFrdDuSFa_pfL0aBrRlEs1v1OR-ekiYIw'}" alt="${appSettings.merchant_name || 'Batur Hot Spring'} Logo" class="h-12 object-contain bg-white rounded p-1 border border-outline-variant">
            </div>
            <div class="font-body-md text-body-md text-on-surface-variant space-y-1">
              <p class="font-semibold text-on-surface">${appSettings.merchant_name || 'Batur Natural Hot Spring'}</p>
              <p class="whitespace-pre-wrap">${appSettings.merchant_address || 'Toya Bungkah, Kintamani, Bangli, Bali'}</p>
              <p class="">${appSettings.merchant_email || 'info@baturhotspring.com'}</p>
              <p class="">${appSettings.merchant_phone || '+62 812-3456-7890'}</p>
            </div>
          </div>
          <!-- Invoice Details -->
          <div class="text-left md:text-right">
            <h1 class="font-display-lg text-display-lg font-bold text-primary mb-2">INVOICE</h1>
            <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-body-md">
              <span class="font-semibold text-on-surface text-left md:text-right">Invoice ID:</span>
              <span class="text-on-surface-variant font-code-mono text-left md:text-right">#INV-${inv.id}</span>
              <span class="font-semibold text-on-surface text-left md:text-right">Date Issued:</span>
              <span class="text-on-surface-variant text-left md:text-right">${new Date(inv.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              <span class="font-semibold text-on-surface text-left md:text-right">Payment Method:</span>
              <span class="text-on-surface-variant text-left md:text-right">${inv.payment_method}</span>
              <span class="font-semibold text-on-surface text-left md:text-right">Status:</span>
              <span class="font-bold flex items-center justify-start md:justify-end gap-1 ${isPaid || isRedeemed ? 'text-primary' : 'text-red-500'}">
                <span class="material-symbols-outlined text-[16px]">${isPaid || isRedeemed ? 'check_circle' : 'pending'}</span>
                ${inv.current_status.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        <!-- Customer Info Container (Subtle gray background) -->
        <div class="bg-surface-container-low p-6 rounded-lg mb-10 flex flex-col md:flex-row justify-between">
          <div>
            <h3 class="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant mb-2">Billed To:</h3>
            <p class="font-headline-sm text-headline-sm font-semibold text-on-surface">${inv.customer_name}</p>
            <p class="font-body-md text-body-md text-on-surface-variant mt-1">Guest at Toya Bungkah</p>
          </div>
          <div class="mt-4 md:mt-0">
            <h3 class="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant mb-2">Order Reference:</h3>
            <p class="font-code-mono text-code-mono text-on-surface">${inv.voucher_code || 'PENDING'}</p>
          </div>
        </div>

        <!-- Itemized Table -->
        <div class="mb-10 overflow-x-auto">
          <table class="w-full text-left border-collapse min-w-[600px]">
            <thead>
              <tr class="bg-surface-container-low border-b border-outline-variant">
                <th class="py-3 px-4 font-label-md text-label-md uppercase tracking-wider text-on-surface-variant w-1/2">Description</th>
                <th class="py-3 px-4 font-label-md text-label-md uppercase tracking-wider text-on-surface-variant text-right">Price</th>
                <th class="py-3 px-4 font-label-md text-label-md uppercase tracking-wider text-on-surface-variant text-center">Qty</th>
                <th class="py-3 px-4 font-label-md text-label-md uppercase tracking-wider text-on-surface-variant text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody class="font-body-md text-body-md text-on-surface">
              <tr class="border-b border-outline-variant hover:bg-surface transition-colors">
                <td class="py-4 px-4">
                  <div class="font-semibold">${inv.ticket_title}</div>
                  <div class="text-on-surface-variant text-sm mt-1">Access to natural hot spring pools.</div>
                </td>
                <td class="py-4 px-4 text-right">Rp ${(inv.total_price / inv.quantity).toLocaleString('id-ID')}</td>
                <td class="py-4 px-4 text-center">${inv.quantity}</td>
                <td class="py-4 px-4 text-right font-code-mono">Rp ${inv.total_price.toLocaleString('id-ID')}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Totals Section -->
        <div class="flex flex-col md:flex-row justify-between items-end">
          <div class="w-full md:w-1/2 mb-6 md:mb-0 text-on-surface-variant font-body-md text-sm pr-4">
            <h4 class="font-semibold text-on-surface mb-2">Terms &amp; Conditions</h4>
            <p class="">Vouchers are non-refundable but can be rescheduled up to 24 hours before the reservation date. Please present the QR code sent to your WhatsApp number (no email will be sent) at the main entrance gate.</p>
          </div>
          <div class="w-full md:w-1/3 space-y-3">
            ${(() => {
              const p = calcPricing(inv.total_price);
              const discLabel = appSettings.discount_label || 'Diskon';
              return `
                <div class="flex justify-between font-body-md text-on-surface">
                  <span>Subtotal:</span>
                  <span class="font-code-mono">Rp ${p.subtotal.toLocaleString('id-ID')}</span>
                </div>
                ${p.discountRate > 0 ? `
                <div class="flex justify-between font-body-md text-emerald-600">
                  <span>${discLabel} (${p.discountRate}%):</span>
                  <span class="font-code-mono">- Rp ${p.discountAmt.toLocaleString('id-ID')}</span>
                </div>` : ''}
                ${p.taxRate > 0 ? `
                <div class="flex justify-between font-body-md text-on-surface">
                  <span>PPN (${p.taxRate}%):</span>
                  <span class="font-code-mono">Rp ${p.taxAmt.toLocaleString('id-ID')}</span>
                </div>` : ''}
                ${p.serviceFee > 0 ? `
                <div class="flex justify-between font-body-md text-on-surface border-b border-outline-variant pb-3">
                  <span>Biaya Layanan:</span>
                  <span class="font-code-mono">Rp ${p.serviceFee.toLocaleString('id-ID')}</span>
                </div>` : '<div class="border-b border-outline-variant pb-1"></div>'}
                <div class="flex justify-between items-center pt-2">
                  <span class="font-headline-sm text-headline-sm font-bold text-secondary">Total Due:</span>
                  <span class="font-headline-md text-headline-md font-bold text-secondary font-code-mono">Rp ${p.total.toLocaleString('id-ID')}</span>
                </div>
              `;
            })()}
          </div>
        </div>

        <!-- Footer area of invoice -->
        <div class="bg-surface-container px-8 py-6 text-center border-t border-outline-variant mt-8 -mx-8 -mb-8 md:-mx-10 md:-mb-10">
          <p class="font-body-md text-on-surface-variant">Thank you for visiting Batur Natural Hot Spring!</p>
          <p class="font-label-md text-xs text-outline mt-2 uppercase tracking-wide">Generated by Batur Hot Spring Management System</p>
        </div>
      </div>
    `;

    document.getElementById('details-modal').classList.remove('hidden');
  } catch (err) {
    showToast(err.message, true);
  }
}

// Helper for voucher ticket dynamic background image
function getVoucherBgImage(voucherCode) {
  const images = [
    'https://images.unsplash.com/photo-1604999333679-b86d54738315?auto=format&fit=crop&w=400&h=250&q=80', // Mount Batur Sunrise
    'https://images.unsplash.com/photo-1552537175-9b222956cf57?auto=format&fit=crop&w=400&h=250&q=80', // Batur Caldera
    'https://images.unsplash.com/photo-1540866225557-974cbd72c74c?auto=format&fit=crop&w=400&h=250&q=80', // Hot Spring Bath
    'https://images.unsplash.com/photo-1588668214407-68bb36530272?auto=format&fit=crop&w=400&h=250&q=80', // Kintamani Resort Pool
    'https://images.unsplash.com/photo-1570168007204-dfb528c6958f?auto=format&fit=crop&w=400&h=250&q=80', // Bali Nature Pool
    'https://images.unsplash.com/photo-1537996194471-e657df975ab4?auto=format&fit=crop&w=400&h=250&q=80'  // Bali Kintamani Landscape
  ];
  let hash = 0;
  if (voucherCode) {
    for (let i = 0; i < voucherCode.length; i++) {
      hash = voucherCode.charCodeAt(i) + ((hash << 5) - hash);
    }
  }
  const index = Math.abs(hash) % images.length;
  return images[index];
}

// Modal View: Open Voucher directly
async function openVoucherModal(code) {
  try {
    const codes = typeof code === 'string' ? code.split(',') : [code];
    
    // Fetch initial voucher details
    const vouchersList = await Promise.all(
      codes.map(async (c) => {
        const res = await fetch(`/api/vouchers/${c.trim()}`);
        return res.ok ? res.json() : null;
      })
    );
    let validVouchers = vouchersList.filter(Boolean);
    if (validVouchers.length === 0) throw new Error('Vouchers not found');

    // Auto-detect siblings if only 1 code was originally requested
    if (codes.length === 1) {
      const primary = validVouchers[0];
      const siblings = invoiceCatalog.filter(inv =>
        inv.customer_name === primary.customer_name &&
        Math.abs(new Date(inv.created_at) - new Date(primary.created_at)) < 15000 &&
        (inv.current_status === 'Paid' || inv.current_status === 'Redeemed')
      );
      const siblingCodes = siblings.map(s => s.voucher_code).filter(Boolean);
      if (siblingCodes.length > 1) {
        const remainingCodes = siblingCodes.filter(c => c !== primary.voucher_code);
        const remainingVouchers = await Promise.all(
          remainingCodes.map(async (c) => {
            const res = await fetch(`/api/vouchers/${c}`);
            return res.ok ? res.json() : null;
          })
        );
        validVouchers = [primary, ...remainingVouchers.filter(Boolean)];
      }
    }

    const allCodes = validVouchers.map(v => v.voucher_code);
    const modalBody = document.getElementById('modal-body-container');

    // Set modal header title
    const headerTitle = document.querySelector('.modal-action-row h3');
    if (headerTitle) {
      headerTitle.innerText = validVouchers.length === 1 
        ? `Voucher Ticket: ${validVouchers[0].voucher_code}`
        : `Vouchers: ${validVouchers.length} Tiket`;
    }

    // Manage header action buttons (hide both)
    document.getElementById('modal-pay-btn').classList.add('hidden');
    document.getElementById('modal-view-vch-btn').classList.add('hidden');

    const templatePicker = `
      <div class="flex items-center justify-center gap-2 mb-6 no-print">
        <span class="text-xs text-on-surface-variant font-semibold uppercase tracking-wider mr-1">Template:</span>
        ${[1,2,3].map(n => `
          <button onclick="activeVoucherTemplate=${n}; openVoucherModal('${allCodes.join(',')}')" 
            class="px-3 py-1 rounded-full text-xs font-bold border transition-all duration-150 ${activeVoucherTemplate===n ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant text-on-surface-variant hover:border-primary'}">
            ${n===1?'Classic':n===2?'Boarding Pass':'Minimal'}
          </button>`).join('')}
      </div>
    `;

    let ticketsHtml = '';

    validVouchers.forEach(data => {
      const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&color=002114&data=${encodeURIComponent(data.voucher_code)}`;
      const visitLabel = data.visit_date || new Date(data.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      const isRedeemed = data.redeemed;
      const statusBadge = isRedeemed ? 'REDEEMED' : 'PAID / VALID';
      const badgeClass = isRedeemed ? 'badge-redeemed' : 'badge-paid';
      const merchantName = appSettings.merchant_name || 'Batur Hot Spring';
      const logoUrl = appSettings.merchant_logo_url || '';
      const website = appSettings.merchant_website || '';
      const bgImg = getVoucherBgImage(data.voucher_code);

      if (activeVoucherTemplate === 1) {
        // === TEMPLATE 1: CLASSIC (compact QR, big title) ===
        ticketsHtml += `
          <div class="relative z-10 w-full max-w-[380px] flex flex-col ticket-container shadow-[0px_10px_30px_rgba(0,33,20,0.15)] rounded-2xl bg-white border border-outline-variant overflow-hidden mb-8 last:mb-0 page-break-avoid">
            <!-- Header -->
            <div class="px-5 py-6 flex flex-col items-center text-center relative overflow-hidden" style="background:#1a3d2b">
              <div class="absolute inset-0 bg-cover bg-center opacity-30" style="background-image:url('${bgImg}')"></div>
              <div class="relative z-10 flex flex-col items-center">
                ${logoUrl ? `<img src="${logoUrl}" alt="Logo" class="h-12 w-12 object-contain bg-white rounded-full p-1 mb-2 shadow">` : ''}
                <p class="text-[10px] uppercase tracking-[3px] text-emerald-300 font-bold mb-1">Official Admission Ticket</p>
                <h2 class="text-white font-extrabold text-lg tracking-tight">${merchantName}</h2>
              </div>
            </div>
            <!-- Tear line -->
            <div class="relative h-0 flex items-center justify-center">
              <div class="w-full border-t border-dashed border-outline-variant"></div>
              <div class="absolute -left-3 w-6 h-6 rounded-full bg-surface-container-low border border-outline-variant"></div>
              <div class="absolute -right-3 w-6 h-6 rounded-full bg-surface-container-low border border-outline-variant"></div>
            </div>
            <!-- Big ticket name -->
            <div class="px-6 pt-7 pb-3 text-center">
              <div class="text-3xl font-extrabold text-on-surface leading-tight mb-1">${data.ticket_title}</div>
              <div class="text-base font-semibold text-on-surface-variant mt-1">${data.customer_name}</div>
              <div class="inline-flex items-center gap-1 mt-2 px-3 py-1 bg-surface-container rounded-full">
                <span class="text-2xl font-black text-primary">${data.quantity}</span>
                <span class="text-sm text-on-surface-variant font-semibold">Pax</span>
              </div>
            </div>
            <!-- Visit date banner -->
            <div class="mx-5 mb-4 py-3 px-4 rounded-xl flex items-center justify-between" style="background:linear-gradient(135deg,#1a3d2b,#2d6a4f)">
              <div>
                <div class="text-[10px] uppercase tracking-widest text-emerald-300 font-bold">Tanggal Kunjungan</div>
                <div class="text-white font-extrabold text-sm mt-0.5">${visitLabel}</div>
              </div>
              <span class="material-symbols-outlined text-emerald-300" style="font-size:28px;font-variation-settings:'FILL' 1">calendar_month</span>
            </div>
            <!-- Small QR -->
            <div class="flex flex-col items-center pb-5 px-6">
              <div class="bg-white rounded-xl border border-outline-variant p-2 shadow-sm mb-3">
                <img src="${qrCodeUrl}" alt="QR" class="w-[120px] h-[120px] object-contain">
              </div>
              <div class="font-mono text-xs text-on-surface-variant tracking-wider">${data.voucher_code}</div>
              <span class="mt-2 badge ${badgeClass} text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest">${statusBadge}</span>
            </div>
            <!-- Footer -->
            <div class="border-t border-dashed border-outline-variant px-5 py-3 flex flex-col items-center gap-0.5 bg-surface-container">
              <p class="text-[9px] text-on-surface-variant uppercase tracking-[2px] font-semibold">Non-transferable • Scan at Entrance</p>
              ${website ? `<p class="text-[9px] text-primary/60 font-semibold">${website}</p>` : ''}
            </div>
          </div>
        `;
      } else if (activeVoucherTemplate === 2) {
        // === TEMPLATE 2: BOARDING PASS (landscape-style, big date) ===
        ticketsHtml += `
          <div class="relative z-10 w-full max-w-[420px] flex flex-col shadow-[0px_8px_32px_rgba(0,0,0,0.18)] rounded-2xl overflow-hidden mb-8 last:mb-0 page-break-avoid" style="background:#f0fdf4">
            <!-- Top stripe -->
            <div class="h-2 w-full" style="background:linear-gradient(90deg,#1a3d2b,#40916c,#74c69d)"></div>
            <!-- Main body -->
            <div class="flex flex-col p-0">
              <!-- Row 1: Merchant + Logo -->
              <div class="flex items-center gap-3 px-5 pt-5 pb-3 border-b border-dashed border-emerald-200">
                ${logoUrl ? `<img src="${logoUrl}" alt="Logo" class="h-10 w-10 object-contain bg-white rounded-full p-1 border border-emerald-200 shadow-sm flex-shrink-0">` : ''}
                <div>
                  <div class="text-[9px] uppercase tracking-[3px] text-emerald-700 font-bold">Official Boarding Pass</div>
                  <div class="font-extrabold text-base text-gray-800">${merchantName}</div>
                </div>
                <div class="ml-auto">
                  <span class="badge ${badgeClass} text-[9px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider">${statusBadge}</span>
                </div>
              </div>
              <!-- Row 2: Ticket type BIG -->
              <div class="px-5 py-4 border-b border-dashed border-emerald-200">
                <div class="text-[9px] uppercase tracking-widest text-emerald-600 font-bold mb-1">Jenis Tiket</div>
                <div class="text-2xl font-black text-gray-900 leading-tight">${data.ticket_title}</div>
              </div>
              <!-- Row 3: 3-col info -->
              <div class="grid grid-cols-3 border-b border-dashed border-emerald-200">
                <div class="px-4 py-3 border-r border-dashed border-emerald-200">
                  <div class="text-[9px] uppercase tracking-widest text-emerald-600 font-bold mb-1">Nama</div>
                  <div class="text-sm font-extrabold text-gray-900 leading-tight">${data.customer_name}</div>
                </div>
                <div class="px-4 py-3 border-r border-dashed border-emerald-200 flex flex-col items-center">
                  <div class="text-[9px] uppercase tracking-widest text-emerald-600 font-bold mb-1">Pax</div>
                  <div class="text-3xl font-black text-emerald-700">${data.quantity}</div>
                </div>
                <div class="px-4 py-3">
                  <div class="text-[9px] uppercase tracking-widest text-emerald-600 font-bold mb-1">Gate</div>
                  <div class="text-sm font-extrabold text-gray-900">Main Gate</div>
                  <div class="text-[10px] text-emerald-600">(North)</div>
                </div>
              </div>
              <!-- Row 4: BIG DATE + small QR side by side -->
              <div class="flex items-stretch">
                <div class="flex-1 px-5 py-5" style="background:linear-gradient(135deg,#1a3d2b 0%,#2d6a4f 100%)">
                  <div class="text-[9px] uppercase tracking-[3px] text-emerald-300 font-bold mb-2">📅 Tanggal Kunjungan</div>
                  <div class="text-white font-black text-xl leading-tight">${visitLabel}</div>
                  <div class="mt-3 font-mono text-emerald-300 text-[10px] tracking-wider">${data.voucher_code}</div>
                </div>
                <div class="flex flex-col items-center justify-center px-4 py-4 border-l border-dashed border-emerald-200 bg-white">
                  <img src="${qrCodeUrl}" alt="QR" class="w-[100px] h-[100px] object-contain">
                  <div class="text-[8px] text-gray-400 mt-1 uppercase tracking-wider">Scan QR</div>
                </div>
              </div>
            </div>
            <!-- Bottom stripe -->
            <div class="h-1.5 w-full" style="background:linear-gradient(90deg,#74c69d,#40916c,#1a3d2b)"></div>
          </div>
        `;
      } else {
        // === TEMPLATE 3: MINIMAL (dark luxury) ===
        ticketsHtml += `
          <div class="relative z-10 w-full max-w-[360px] shadow-[0px_12px_40px_rgba(0,0,0,0.35)] rounded-2xl overflow-hidden mb-8 last:mb-0 page-break-avoid" style="background:#0f1f17">
            <!-- Decorative top bar -->
            <div class="h-1 w-full" style="background:linear-gradient(90deg,#52b788,#95d5b2,#52b788)"></div>
            <!-- Header row -->
            <div class="flex items-center gap-3 px-5 pt-5 pb-4 border-b" style="border-color:#1f3329">
              ${logoUrl ? `<img src="${logoUrl}" alt="Logo" class="h-9 w-9 object-contain bg-white/10 rounded-full p-1">` : ''}
              <div class="flex-1">
                <div class="text-[8px] uppercase tracking-[3px] text-emerald-400 font-bold">${merchantName}</div>
                <div class="text-[10px] text-emerald-200 font-semibold">Admission Ticket</div>
              </div>
              <span class="badge ${badgeClass} text-[9px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider">${statusBadge}</span>
            </div>
            <!-- Big Ticket Name -->
            <div class="px-5 pt-5 pb-2">
              <div class="text-[9px] uppercase tracking-[3px] text-emerald-500 font-bold mb-2">Jenis Tiket</div>
              <div class="text-2xl font-black text-white leading-tight">${data.ticket_title}</div>
            </div>
            <!-- Name + Pax -->
            <div class="px-5 pb-4 flex items-end gap-4">
              <div class="flex-1">
                <div class="text-[9px] uppercase tracking-widest text-emerald-500 font-bold mb-1">Nama Pengunjung</div>
                <div class="text-base font-extrabold text-white">${data.customer_name}</div>
              </div>
              <div class="text-right">
                <div class="text-[9px] uppercase tracking-widest text-emerald-500 font-bold mb-1">Jumlah</div>
                <div class="text-4xl font-black leading-none" style="color:#52b788">${data.quantity}<span class="text-sm ml-0.5 text-emerald-400">pax</span></div>
              </div>
            </div>
            <!-- Date Banner -->
            <div class="mx-4 mb-4 rounded-xl px-4 py-3 flex items-center gap-3" style="background:#1a3d2b;border:1px solid #2d6a4f">
              <span class="material-symbols-outlined" style="color:#52b788;font-size:32px;font-variation-settings:'FILL' 1">event_available</span>
              <div>
                <div class="text-[8px] uppercase tracking-widest text-emerald-500 font-bold">Tanggal Kunjungan</div>
                <div class="text-white font-extrabold text-sm">${visitLabel}</div>
              </div>
            </div>
            <!-- QR + Code -->
            <div class="flex items-center gap-4 px-5 pb-5">
              <div class="bg-white rounded-lg p-1.5 shadow">
                <img src="${qrCodeUrl}" alt="QR" class="w-[90px] h-[90px] object-contain">
              </div>
              <div class="flex-1">
                <div class="text-[8px] uppercase tracking-[2px] text-emerald-500 font-bold mb-1">Voucher Code</div>
                <div class="font-mono text-emerald-200 text-[11px] tracking-wider break-all">${data.voucher_code}</div>
                <div class="mt-2 text-[8px] uppercase tracking-[2px] text-emerald-600 font-semibold">Scan at Main Gate (North)</div>
              </div>
            </div>
            <!-- Footer -->
            <div class="border-t px-5 py-2.5 flex items-center justify-between" style="border-color:#1f3329">
              <p class="text-[8px] text-emerald-600 uppercase tracking-widest">Non-transferable</p>
              ${website ? `<p class="text-[8px] text-emerald-600 font-semibold">${website}</p>` : ''}
            </div>
          </div>
        `;
      }
    });

    modalBody.innerHTML = `
      <div class="flex flex-col items-center justify-start p-4 md:p-6 relative overflow-auto bg-surface-bright min-h-full">
        <div class="absolute inset-0 bg-surface-container-low z-0 overflow-hidden no-print">
          <div class="absolute -top-[20%] -right-[10%] w-[50%] h-[50%] rounded-full bg-secondary-container opacity-20 blur-3xl"></div>
          <div class="absolute bottom-[10%] -left-[10%] w-[40%] h-[40%] rounded-full bg-primary-fixed-dim opacity-20 blur-3xl"></div>
        </div>
        <div class="relative z-10 w-full flex flex-col items-center">
          ${templatePicker}
          ${ticketsHtml}
        </div>
      </div>
    `;

    // Ensure detail modal is shown and other modals closed
    closeNewIssueModal();
    document.getElementById('details-modal').classList.remove('hidden');

  } catch (err) {
    showToast(err.message, true);
  }
}

// Print trigger function
function printModalContent() {
  window.print();
}

// Helper to confirm payment from inside the detail modal
async function confirmPaymentFromModal(invoiceId) {
  await confirmPayment(invoiceId);
  const inv = invoiceCatalog.find(i => i.id === invoiceId);
  if (inv) {
    const siblings = invoiceCatalog.filter(i =>
      i.customer_name === inv.customer_name &&
      Math.abs(new Date(i.created_at) - new Date(inv.created_at)) < 15000
    );
    if (siblings.length > 1) {
      setTimeout(() => openMultiInvoiceDetails(siblings.map(s => s.id)), 200);
      return;
    }
  }
  setTimeout(() => openInvoiceDetails(invoiceId), 200);
}

// Modal closing
function closeModal() {
  document.getElementById('details-modal').classList.add('hidden');
}

// QR Code Checking & Redemption flow
async function checkVoucherCode(code) {
  const feedbackContainer = document.getElementById('scan-feedback');
  const feedbackTitle = document.getElementById('feedback-title');
  const feedbackDesc = document.getElementById('feedback-desc');
  const feedbackDetails = document.getElementById('feedback-details');
  const confirmRedeemBtn = document.getElementById('btn-confirm-redeem');

  // Reset UI state
  feedbackContainer.className = 'scan-feedback-container feedback-neutral';
  feedbackDetails.classList.add('hidden');
  confirmRedeemBtn.classList.add('hidden');
  currentScannedCode = null;

  if (!code) return;

  try {
    const response = await fetch(`/api/vouchers/${code}`);
    const data = await response.json();

    if (!response.ok) {
      feedbackContainer.className = 'scan-feedback-container feedback-error';
      feedbackTitle.innerText = 'Voucher Invalid';
      feedbackDesc.innerText = data.error || 'Code lookup failed.';
      return;
    }

    // Populate Details
    document.getElementById('val-customer').innerText = data.customer_name;
    document.getElementById('val-ticket').innerText = data.ticket_title;
    document.getElementById('val-qty').innerText = `${data.quantity} Person(s)`;
    
    // Check status
    if (data.redeemed) {
      feedbackContainer.className = 'scan-feedback-container feedback-error';
      feedbackTitle.innerText = 'Already Redeemed!';
      feedbackDesc.innerText = `This voucher was scanned and checked in on ${new Date(data.redeemed_at).toLocaleString()}`;
      document.getElementById('val-status').innerText = 'Redeemed / Used';
      feedbackDetails.classList.remove('hidden');
    } else if (data.status !== 'Paid') {
      feedbackContainer.className = 'scan-feedback-container feedback-error';
      feedbackTitle.innerText = 'Voucher Not Paid';
      feedbackDesc.innerText = 'The payment status for this invoice is still marked as Unpaid.';
      document.getElementById('val-status').innerText = 'Unpaid';
      feedbackDetails.classList.remove('hidden');
    } else {
      feedbackContainer.className = 'scan-feedback-container feedback-success';
      feedbackTitle.innerText = 'Voucher Verified!';
      feedbackDesc.innerText = 'Payment is confirmed. Ready for entrance check-in.';
      document.getElementById('val-status').innerText = 'Paid (Active)';
      feedbackDetails.classList.remove('hidden');
      
      confirmRedeemBtn.classList.remove('hidden');
      currentScannedCode = code;
    }

  } catch (err) {
    feedbackContainer.className = 'scan-feedback-container feedback-error';
    feedbackTitle.innerText = 'Verification Error';
    feedbackDesc.innerText = err.message;
  }
}

// Redeem verified code
async function redeemScannedCode() {
  if (!currentScannedCode) return;
  try {
    const response = await fetch(`/api/vouchers/${currentScannedCode}/redeem`, {
      method: 'POST'
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Redemption failed');

    showToast('Check-in completed successfully!');
    checkVoucherCode(currentScannedCode); // refresh scan validation UI
    await loadInvoices();
  } catch (err) {
    showToast(err.message, true);
  }
}

// Camera Scanner Controls
function startCamera() {
  document.getElementById('btn-start-camera').classList.add('hidden');
  document.getElementById('btn-stop-camera').classList.remove('hidden');

  html5QrcodeScanner = new Html5Qrcode("modal-qr-reader");
  
  html5QrcodeScanner.start(
    { facingMode: "environment" },
    {
      fps: 10,
      qrbox: { width: 220, height: 220 }
    },
    (decodedText) => {
      // On QR code success scan
      document.getElementById('manual-code-input-modal').value = decodedText;
      checkVoucherCode(decodedText);
      stopCamera();
    },
    (errorMessage) => {
      // Ignore scanning error messages
    }
  ).catch(err => {
    showToast('Failed to start camera. Grant permissions or use manual entry.', true);
    stopCamera();
  });
}

function stopCamera() {
  document.getElementById('btn-start-camera').classList.remove('hidden');
  document.getElementById('btn-stop-camera').classList.add('hidden');

  if (html5QrcodeScanner) {
    html5QrcodeScanner.stop().then(() => {
      html5QrcodeScanner = null;
    }).catch(err => {
      console.error('Error stopping scanner camera:', err);
    });
  }
}

// Mobile Responsive Navigation Drawer Control
function toggleMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) sidebar.classList.toggle('show');
}

// Toast alerts utility
function showToast(message, isError = false) {
  const toast = document.getElementById('toast-notification');
  toast.innerText = message;
  toast.style.borderLeftColor = isError ? 'var(--danger)' : 'var(--primary)';
  
  toast.classList.remove('hidden');
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 300);
  }, 3500);
}

// WhatsApp Polling & Bot Control
let whatsappInterval = null;

function startWhatsAppPolling() {
  // Initial load
  pollWhatsAppStatus();
  loadWhatsAppLogs();

  // Set interval every 2 seconds
  if (!whatsappInterval) {
    whatsappInterval = setInterval(() => {
      pollWhatsAppStatus();
      loadWhatsAppLogs();
    }, 2000);
  }
}

function stopWhatsAppPolling() {
  if (whatsappInterval) {
    clearInterval(whatsappInterval);
    whatsappInterval = null;
  }
}

async function pollWhatsAppStatus() {
  try {
    const response = await fetch('/api/whatsapp/status', {
      headers: { 'Authorization': token }
    });
    if (!response.ok) throw new Error('Unauthenticated');
    const data = await response.json();
    
    // Update Badge
    const badge = document.getElementById('whatsapp-status-badge');
    badge.innerText = data.status.toUpperCase();
    
    // Update active sessions
    document.getElementById('whatsapp-active-sessions').innerText = data.sessionsCount;

    // Reset styles
    badge.className = 'badge';
    if (data.status === 'connected') {
      badge.className = 'badge badge-paid';
    } else if (data.status === 'connecting') {
      badge.className = 'badge badge-unpaid'; // yellow/orange
    } else if (data.status === 'qrcode') {
      badge.className = 'badge bg-primary text-on-primary'; // purple/blue
    } else {
      badge.className = 'badge badge-unpaid bg-error text-on-error'; // red
    }

    // QR Container visibility
    const qrContainer = document.getElementById('whatsapp-qr-container');
    const qrImg = document.getElementById('whatsapp-qr-image');
    if (data.status === 'qrcode' && data.qr) {
      qrContainer.classList.remove('hidden');
      qrImg.src = data.qr;
    } else {
      qrContainer.classList.add('hidden');
      qrImg.src = '';
    }

    // Action button states
    const btnStart = document.getElementById('btn-whatsapp-start');
    const btnLogout = document.getElementById('btn-whatsapp-logout');
    if (data.status === 'connected') {
      btnStart.disabled = true;
      btnStart.classList.add('opacity-50', 'cursor-not-allowed');
      btnLogout.disabled = false;
      btnLogout.classList.remove('opacity-50', 'cursor-not-allowed');
    } else if (data.status === 'connecting' || data.status === 'qrcode') {
      btnStart.disabled = true;
      btnStart.classList.add('opacity-50', 'cursor-not-allowed');
      btnLogout.disabled = false;
      btnLogout.classList.remove('opacity-50', 'cursor-not-allowed');
    } else {
      btnStart.disabled = false;
      btnStart.classList.remove('opacity-50', 'cursor-not-allowed');
      btnLogout.disabled = true;
      btnLogout.classList.add('opacity-50', 'cursor-not-allowed');
    }

  } catch (err) {
    console.error('WhatsApp status poll failed:', err);
    stopWhatsAppPolling();
  }
}

async function startWhatsAppBot() {
  try {
    const response = await fetch('/api/whatsapp/start', {
      method: 'POST',
      headers: { 'Authorization': token }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to start bot');
    showToast('Starting WhatsApp Bot connection...');
    pollWhatsAppStatus();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function logoutWhatsAppBot() {
  if (!confirm('Apakah Anda yakin ingin memutuskan dan mengeluarkan WhatsApp Bot?')) return;
  try {
    const response = await fetch('/api/whatsapp/logout', {
      method: 'POST',
      headers: { 'Authorization': token }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to disconnect');
    showToast('WhatsApp Bot disconnected.');
    pollWhatsAppStatus();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function loadWhatsAppLogs() {
  try {
    const response = await fetch('/api/whatsapp/logs', {
      headers: { 'Authorization': token }
    });
    if (!response.ok) return;
    const data = await response.json();

    const container = document.getElementById('whatsapp-logs-container');
    if (data.length === 0) {
      container.innerHTML = '<p class="text-secondary text-center text-xs py-8">Belum ada aktivitas obrolan.</p>';
      return;
    }

    container.innerHTML = '';
    data.forEach(log => {
      const logDiv = document.createElement('div');
      logDiv.className = 'p-3 bg-surface-container-low rounded-lg space-y-2 border border-outline-variant fade-in text-xs';
      logDiv.innerHTML = `
        <div class="flex justify-between items-center text-[10px] text-on-surface-variant font-semibold">
          <span>📱 ${log.phone}</span>
          <span>🕒 ${log.timestamp}</span>
        </div>
        <div class="bg-surface-container p-2 rounded text-on-surface">
          <span class="font-bold text-[10px] block text-secondary uppercase">Pesan Masuk:</span>
          <p class="mt-0.5">${log.message}</p>
        </div>
        <div class="bg-primary-container/10 p-2 rounded text-primary border-l-2 border-primary">
          <span class="font-bold text-[10px] block text-primary uppercase">Balasan Otomatis:</span>
          <p class="mt-0.5 whitespace-pre-wrap">${log.reply}</p>
        </div>
      `;
      container.appendChild(logDiv);
    });
  } catch (err) {
    console.error('Failed to load WhatsApp logs:', err);
  }
}

// Payment Methods Data & Handlers
let paymentMethods = [];

async function loadPaymentMethods() {
  try {
    const response = await fetch('/api/payment-methods');
    paymentMethods = await response.json();
    
    // Render in catalog store
    renderStorePMTable();
    
    // Update Voucher Generator dropdown
    populateGeneratorPayments();
  } catch (err) {
    console.error('Failed to load payment methods:', err);
  }
}

function renderStorePMTable() {
  const tbody = document.getElementById('store-pm-table-body');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  paymentMethods.forEach(pm => {
    const tr = document.createElement('tr');
    tr.className = "border-b border-outline-variant hover:bg-surface-container-low transition-colors";
    tr.innerHTML = `
      <td class="py-3 px-4 text-sm font-semibold text-on-surface">${pm.name}</td>
      <td class="py-3 px-4 text-sm">
        <span class="badge ${pm.is_active ? 'badge-paid' : 'badge-unpaid'}">
          ${pm.is_active ? 'Aktif' : 'Tidak Aktif'}
        </span>
      </td>
      <td class="py-3 px-4 text-sm space-x-2">
        <button class="bg-primary/5 text-primary hover:bg-primary hover:text-white px-3 py-1 rounded transition-all text-xs font-semibold" onclick="editStorePM(${pm.id}, '${pm.name}', ${pm.is_active})">Edit</button>
        <button class="bg-error/5 text-error hover:bg-error hover:text-white px-3 py-1 rounded transition-all text-xs font-semibold" onclick="deleteStorePM(${pm.id})">Hapus</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function resetStorePMForm() {
  document.getElementById('store-pm-edit-id').value = '';
  document.getElementById('store-pm-name').value = '';
  document.getElementById('store-pm-status').value = '1';
  document.getElementById('store-pm-form-title').innerText = 'Tambah Metode Pembayaran';
  const cancelBtn = document.getElementById('btn-store-cancel-pm-edit');
  if (cancelBtn) cancelBtn.classList.add('hidden');
}

function editStorePM(id, name, isActive) {
  document.getElementById('store-pm-edit-id').value = id;
  document.getElementById('store-pm-name').value = name;
  document.getElementById('store-pm-status').value = isActive ? '1' : '0';
  document.getElementById('store-pm-form-title').innerText = 'Edit Metode Pembayaran';
  const cancelBtn = document.getElementById('btn-store-cancel-pm-edit');
  if (cancelBtn) cancelBtn.classList.remove('hidden');
  
  // Scroll form into view
  document.getElementById('store-pm-form').scrollIntoView({ behavior: 'smooth' });
}

async function deleteStorePM(id) {
  if (!confirm('Apakah Anda yakin ingin menghapus metode pembayaran ini?')) return;
  try {
    const response = await fetch(`/api/payment-methods/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': token }
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to delete payment method');
    }
    showToast('Payment method deleted!');
    await loadPaymentMethods();
  } catch (err) {
    showToast(err.message, true);
  }
}

function populateGeneratorPayments() {
  const select = document.getElementById('booking-payment-method');
  if (!select) return;
  
  select.innerHTML = '';
  
  // Filter active ones
  const activePMs = paymentMethods.filter(pm => pm.is_active === 1);
  
  activePMs.forEach(pm => {
    const opt = document.createElement('option');
    opt.value = pm.name;
    opt.innerText = pm.name;
    select.appendChild(opt);
  });
}
