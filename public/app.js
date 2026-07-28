// App State
let token = localStorage.getItem('admin_token') || null;
let currentTab = 'dashboard'; // Default active tab is 'dashboard'
let html5QrcodeScanner = null;
let currentScannedCode = null;
let appSettings = {};

// Calc pricing breakdown from subtotal using current appSettings
function calcPricing(subtotal, overrideSettings) {
  const settings = overrideSettings || appSettings;
  const discountType = settings.discount_type || 'percentage';
  const discountRate = parseFloat(settings.discount_rate) || 0;
  const taxRate = parseFloat(settings.tax_rate) || 0;
  const serviceFee = parseFloat(settings.service_fee) || 0;
  
  let discountAmt = 0;
  if (discountType === 'percentage') {
    discountAmt = Math.round(subtotal * discountRate / 100);
  } else {
    discountAmt = discountRate;
  }
  
  const afterDiscount = Math.max(0, subtotal - discountAmt);
  const taxAmt = Math.round(afterDiscount * taxRate / 100);
  const total = afterDiscount + taxAmt + serviceFee;
  return { subtotal, discountType, discountRate, discountAmt, taxRate, taxAmt, serviceFee, total };
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
let agentsList = [];
let usersList = [];
let agentContractItems = {}; // agent_id -> { ticket_id -> { discount_rate, discount_type } }
let bookingQuantities = {};
let selectedBookingDateString = '';
let activeVoucherTemplate = 1; // 1=Classic, 2=Boarding Pass, 3=Minimal
let mySalesChart = null;
let currentChartScale = 'daily';


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

// Helper to show/hide loading overlay
function showLoading(show = true, title = 'Saving...', desc = 'Processing your request, please wait.') {
  const overlay = document.getElementById('loading-overlay');
  const titleEl = document.getElementById('loading-title');
  const descEl = document.getElementById('loading-desc');
  if (!overlay) return;
  
  if (show) {
    if (titleEl) titleEl.innerText = title;
    if (descEl) descEl.innerText = desc;
    overlay.classList.remove('hidden');
  } else {
    overlay.classList.add('hidden');
  }
}

// Check Auth
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
  await loadAgents();
  await loadUsers();
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

  // Document Title & Description
  document.title = `${appSettings.merchant_name} Admin`;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) {
    metaDesc.content = `${appSettings.merchant_name} Voucher Management System. Securely generate, print, and scan vouchers.`;
  }

  // Login screen title
  const loginTitle = document.getElementById('login-branding-title');
  if (loginTitle) loginTitle.innerText = appSettings.merchant_name;

  // Sidebar header title
  const sidebarTitle = document.querySelector('aside h1');
  if (sidebarTitle) sidebarTitle.innerText = appSettings.merchant_name;
  
  // Navbar header title
  const navbarTitle = document.getElementById('navbar-title') || document.querySelector('header div.font-bold');
  if (navbarTitle) navbarTitle.innerText = `${appSettings.merchant_name} Admin`;

  // Voucher generator branding panel header
  const generatorHeader = document.getElementById('generator-branding-title');
  if (generatorHeader) generatorHeader.innerText = appSettings.merchant_name;

  // Sidebar Admin profile
  const currentUser = JSON.parse(localStorage.getItem('admin_user') || '{}');
  const sidebarAvatarImg = document.getElementById('sidebar-avatar-img');
  if (sidebarAvatarImg) {
    sidebarAvatarImg.src = currentUser.avatar_url || appSettings.admin_avatar_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=80&q=80';
  }
  const sidebarAvatarName = document.getElementById('sidebar-avatar-name');
  if (sidebarAvatarName) {
    sidebarAvatarName.innerText = currentUser.name || appSettings.admin_username || 'Super Admin';
  }

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
      if (data.user) {
        localStorage.setItem('admin_user', JSON.stringify(data.user));
      }
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
    const title = document.getElementById('store-ticket-title').value;
    const rawPrice = document.getElementById('store-ticket-price').value.replace(/\./g, '');
    const price = parseFloat(rawPrice);
    const rawDiscount = document.getElementById('store-ticket-discount')?.value.replace(/\./g, '') || '0';
    const discount = parseFloat(rawDiscount) || 0;
    const description = document.getElementById('store-ticket-desc').value;
    const is_active = parseInt(document.getElementById('store-ticket-status').value);

    try {
      showLoading(true, 'Creating...', 'Saving new ticket category...');
      const response = await fetch('/api/tickets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token
        },
        body: JSON.stringify({ title, price, discount, description, is_active })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save ticket class');

      showToast('New ticket class created!');
      resetStoreTicketForm();
      await loadTickets();
      renderStoreTicketsTable();
      renderBookingCatalog();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      showLoading(false);
    }
  });

  // Edit Ticket form submit
  document.getElementById('edit-ticket-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-ticket-id').value;
    const title = document.getElementById('edit-ticket-title').value;
    const rawPrice = document.getElementById('edit-ticket-price').value.replace(/\./g, '');
    const price = parseFloat(rawPrice);
    const rawDiscount = document.getElementById('edit-ticket-discount')?.value.replace(/\./g, '') || '0';
    const discount = parseFloat(rawDiscount) || 0;
    const description = document.getElementById('edit-ticket-desc').value;
    const is_active = parseInt(document.getElementById('edit-ticket-status').value);

    try {
      showLoading(true, 'Updating...', 'Saving ticket changes...');
      const response = await fetch(`/api/tickets/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token
        },
        body: JSON.stringify({ title, price, discount, description, is_active })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to update ticket class');

      showToast('Ticket class updated!');
      closeEditTicketModal();
      await loadTickets();
      renderStoreTicketsTable();
      renderBookingCatalog();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      showLoading(false);
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
        merchant_terms: document.getElementById('settings-terms').value.trim(),
        merchant_payment_instructions: document.getElementById('settings-payment-instructions').value.trim(),
        ninerouter_url: appSettings.ninerouter_url || '',
        ninerouter_key: appSettings.ninerouter_key || '',
        ninerouter_model: appSettings.ninerouter_model || '',
        nvidia_api_key: document.getElementById('settings-nvidia-key').value.trim(),
        nvidia_model: document.getElementById('settings-nvidia-model').value.trim(),
        ai_base_url: document.getElementById('settings-ai-base-url').value.trim(),
        chatbot_knowledge: document.getElementById('settings-chatbot-knowledge').value.trim(),
        waha_url: document.getElementById('settings-waha-url').value.trim(),
        primary_color: document.getElementById('settings-primary-color-text').value.trim(),
        secondary_color: document.getElementById('settings-secondary-color-text').value.trim(),
        background_color: document.getElementById('settings-background-color-text').value.trim(),
        tax_rate: document.getElementById('settings-tax-rate').value.trim(),
        service_fee: document.getElementById('settings-service-fee').value.trim(),
        discount_rate: document.getElementById('settings-discount-rate').value.trim(),
        discount_type: document.getElementById('settings-discount-type').value,
        discount_label: document.getElementById('settings-discount-label').value.trim()
      };

      try {
        showLoading(true, 'Saving Settings...', 'Updating system configurations...');
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
      } finally {
        showLoading(false);
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
      const instructions = document.getElementById('store-pm-instructions').value.trim();
      const is_active = parseInt(document.getElementById('store-pm-status').value);

      const url = id ? `/api/payment-methods/${id}` : '/api/payment-methods';
      const method = id ? 'PUT' : 'POST';

      try {
        showLoading(true, id ? 'Updating...' : 'Creating...', 'Saving payment method...');
        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token
          },
          body: JSON.stringify({ name, instructions, is_active })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to save payment method');

        showToast(id ? 'Payment method updated!' : 'New payment method created!');
        resetStorePMForm();
        await loadPaymentMethods();
      } catch (err) {
        showToast(err.message, true);
      } finally {
        showLoading(false);
      }
    });
  }
}

// Log out
function logout() {
  token = null;
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_user');
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
      whatsapp: 'WhatsApp Chatbot Virtual Assistant',
      agents: 'Agents Management Directory',
      users: 'User Account Management'
    };
    topPanelEl.innerText = titles[tabId] || 'Batur Hot Spring Admin';
  }

  // Load context specific content
  if (tabId === 'dashboard') renderDashboardStats();
  if (tabId === 'store') renderStoreTicketsTable();
  if (tabId === 'agents') loadAgents();
  if (tabId === 'users') loadUsers();
  if (tabId === 'generator') { renderBookingCatalog(); initVisitDateInput(); updateBookingTotal(); }
  if (tabId === 'invoices') { loadInvoices().then(renderInvoicesTable); }
  if (tabId === 'vouchers') renderVouchersList();
  if (tabId === 'orders') { loadInvoices().then(renderOrdersTable); }
  if (tabId === 'settings') renderSettingsForm();
  
  if (tabId === 'whatsapp') {
    startWhatsAppPolling();
  } else {
    stopWhatsAppPolling();
  }

  if (tabId === 'helpdesk') {
    startHelpdeskPolling();
  } else {
    stopHelpdeskPolling();
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
  if (tbody) {
    tbody.innerHTML = '';
    const recents = invoiceCatalog.slice(0, 5);
    if (recents.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-secondary text-center">No recent activities available.</td></tr>';
    } else {
      recents.forEach(inv => {
        const isPaid = inv.current_status === 'Paid';
        const isRedeemed = inv.current_status === 'Redeemed';
        const isDP = inv.current_status === 'DP';
        let badge = `<span class="badge badge-unpaid">Unpaid</span>`;
        if (isRedeemed) badge = `<span class="badge badge-redeemed">Redeemed</span>`;
        else if (isPaid) badge = `<span class="badge badge-paid">Paid</span>`;
        else if (isDP) badge = `<span class="badge" style="background:#fff3cd;color:#856404;">DP</span>`;

        const items = inv.items || [];
        const firstItem = items[0] || { ticket_title: '-' };
        const descText = items.length > 1 ? `${firstItem.ticket_title} + ${items.length - 1} more` : firstItem.ticket_title;

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>#${inv.id}</td>
          <td><strong>${inv.customer_name}</strong></td>
          <td>${descText}</td>
          <td>${badge}</td>
          <td>${new Date(inv.created_at).toLocaleDateString('id-ID')}</td>
        `;
        tbody.appendChild(tr);
      });
    }
  }

  // Calculate & Render Top Agents in Dashboard
  const topAgentsContainer = document.getElementById('dashboard-top-agents');
  if (topAgentsContainer) {
    topAgentsContainer.innerHTML = '';
    const agentSalesMap = {};
    
    // Initialize map
    agentsList.forEach(a => {
      agentSalesMap[a.id] = { name: a.name, code: a.code, spend: 0, orders: 0 };
    });

    // Populate stats
    invoiceCatalog.filter(i => (i.current_status === 'Paid' || i.current_status === 'Redeemed') && i.agent_id).forEach(inv => {
      if (agentSalesMap[inv.agent_id]) {
        agentSalesMap[inv.agent_id].spend += inv.total_price;
        agentSalesMap[inv.agent_id].orders++;
      }
    });

    const sortedAgents = Object.values(agentSalesMap).sort((a, b) => b.spend - a.spend).slice(0, 3);
    if (sortedAgents.length === 0 || sortedAgents.every(a => a.spend === 0)) {
      topAgentsContainer.innerHTML = '<p class="text-xs text-on-surface-variant italic text-center py-2">Belum ada transaksi agen</p>';
    } else {
      sortedAgents.forEach((a, idx) => {
        if (a.spend > 0) {
          const item = document.createElement('div');
          item.className = "flex items-center justify-between p-2.5 bg-surface-container-low rounded-lg border border-outline-variant text-xs";
          item.innerHTML = `
            <div class="truncate max-w-[140px]">
              <span class="font-bold text-on-surface">${idx+1}. ${a.name}</span>
              <div class="text-[10px] text-on-surface-variant font-mono">${a.code}</div>
            </div>
            <div class="text-right">
              <div class="font-bold text-primary">Rp ${a.spend.toLocaleString('id-ID')}</div>
              <div class="text-[10px] text-on-surface-variant">${a.orders} Pesanan</div>
            </div>
          `;
          topAgentsContainer.appendChild(item);
        }
      });
    }
  }

  // Calculate & Render Top Tickets (Laris)
  const topTicketsContainer = document.getElementById('dashboard-top-tickets');
  if (topTicketsContainer) {
    topTicketsContainer.innerHTML = '';
    const ticketSalesMap = {};

    // Populate stats from paid / redeemed invoices
    invoiceCatalog.filter(i => i.current_status === 'Paid' || i.current_status === 'Redeemed').forEach(inv => {
      const items = inv.items || [];
      items.forEach(item => {
        const title = item.ticket_title || 'Admission';
        if (!ticketSalesMap[title]) {
          ticketSalesMap[title] = { title, qty: 0, revenue: 0 };
        }
        ticketSalesMap[title].qty += item.quantity || 0;
        ticketSalesMap[title].revenue += item.total_price || 0;
      });
    });

    const sortedTickets = Object.values(ticketSalesMap).sort((a, b) => b.qty - a.qty).slice(0, 3);
    if (sortedTickets.length === 0) {
      topTicketsContainer.innerHTML = '<p class="text-xs text-on-surface-variant italic text-center py-2">Belum ada tiket terjual</p>';
    } else {
      sortedTickets.forEach((t, idx) => {
        const item = document.createElement('div');
        item.className = "flex items-center justify-between p-2.5 bg-surface-container-low rounded-lg border border-outline-variant text-xs";
        item.innerHTML = `
          <div class="truncate max-w-[140px]" title="${t.title}">
            <span class="font-bold text-on-surface">${idx+1}. ${t.title}</span>
          </div>
          <div class="text-right">
            <div class="font-bold text-secondary">${t.qty} Terjual</div>
            <div class="text-[10px] text-on-surface-variant">Rp ${t.revenue.toLocaleString('id-ID')}</div>
          </div>
        `;
        topTicketsContainer.appendChild(item);
      });
    }
  }

  // Render sales chart
  setTimeout(() => renderSalesChart(), 100);
}

// Render Sales Chart using Chart.js
function renderSalesChart() {
  const ctx = document.getElementById('salesChart');
  if (!ctx) return;

  if (mySalesChart) {
    mySalesChart.destroy();
  }

  const paidInvoices = invoiceCatalog.filter(i => i.current_status === 'Paid' || i.current_status === 'Redeemed');

  let labels = [];
  let dataPoints = [];

  if (currentChartScale === 'daily') {
    // Last 7 days chart labels & stats
    const dailyMap = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
      const dbKey = d.toISOString().split('T')[0]; // YYYY-MM-DD
      dailyMap[dbKey] = { label: dateStr, revenue: 0 };
    }

    paidInvoices.forEach(inv => {
      // created_at is YYYY-MM-DD HH:MM:SS
      const dbKey = inv.created_at.split(' ')[0];
      if (dailyMap[dbKey]) {
        dailyMap[dbKey].revenue += inv.total_price;
      }
    });

    Object.keys(dailyMap).sort().forEach(k => {
      labels.push(dailyMap[k].label);
      dataPoints.push(dailyMap[k].revenue);
    });

  } else {
    // Monthly chart labels & stats
    const monthlyMap = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const monthStr = d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
      const dbKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
      monthlyMap[dbKey] = { label: monthStr, revenue: 0 };
    }

    paidInvoices.forEach(inv => {
      const dateParts = inv.created_at.split(' ')[0].split('-');
      if (dateParts.length >= 2) {
        const dbKey = `${dateParts[0]}-${dateParts[1]}`;
        if (monthlyMap[dbKey]) {
          monthlyMap[dbKey].revenue += inv.total_price;
        }
      }
    });

    Object.keys(monthlyMap).sort().forEach(k => {
      labels.push(monthlyMap[k].label);
      dataPoints.push(monthlyMap[k].revenue);
    });
  }

  // Get primary theme color
  const primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#000000';

  mySalesChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Pendapatan (Rp)',
        data: dataPoints,
        borderColor: primaryColor,
        backgroundColor: `${primaryColor}15`, // primary color with transparency
        borderWidth: 3,
        fill: true,
        tension: 0.35,
        pointBackgroundColor: primaryColor,
        pointHoverRadius: 6,
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return ` Pendapatan: Rp ${context.raw.toLocaleString('id-ID')}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              if (value >= 1000000) {
                return 'Rp ' + (value / 1000000) + 'jt';
              } else if (value >= 1000) {
                return 'Rp ' + (value / 1000) + 'k';
              }
              return 'Rp ' + value;
            },
            font: {
              size: 10
            }
          },
          grid: {
            color: '#F1F5F9'
          }
        },
        x: {
          ticks: {
            font: {
              size: 10
            }
          },
          grid: {
            display: false
          }
        }
      }
    }
  });
}

// Switch sales chart scale between daily and monthly
window.switchChartScale = function(scale) {
  currentChartScale = scale;
  
  const dailyBtn = document.getElementById('chart-btn-daily');
  const monthlyBtn = document.getElementById('chart-btn-monthly');

  if (scale === 'daily') {
    if (dailyBtn) {
      dailyBtn.className = "px-3 py-1.5 rounded-md text-xs font-bold bg-primary text-on-primary shadow-sm transition-all";
    }
    if (monthlyBtn) {
      monthlyBtn.className = "px-3 py-1.5 rounded-md text-xs font-bold text-on-surface-variant hover:text-on-surface transition-all";
    }
  } else {
    if (dailyBtn) {
      dailyBtn.className = "px-3 py-1.5 rounded-md text-xs font-bold text-on-surface-variant hover:text-on-surface transition-all";
    }
    if (monthlyBtn) {
      monthlyBtn.className = "px-3 py-1.5 rounded-md text-xs font-bold bg-primary text-on-primary shadow-sm transition-all";
    }
  }

  renderSalesChart();
};

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
    
    const isDP = inv.current_status === 'DP';
    let statusBadge = `<span class="badge badge-unpaid">Unpaid</span>`;
    let actionBtn = `<button class="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-all" onclick="confirmPayment(${inv.id})" title="Confirm Payment"><span class="material-symbols-outlined text-[18px]">check_circle</span></button>`;
    
    if (isRedeemed) {
      statusBadge = `<span class="badge badge-redeemed">Redeemed</span>`;
      actionBtn = `
        <button class="p-1.5 text-gray-600 hover:bg-gray-100 rounded-lg transition-all" onclick="openInvoiceDetails(${inv.id})" title="Details"><span class="material-symbols-outlined text-[18px]">visibility</span></button>
        <button class="p-1.5 text-error hover:bg-error/10 rounded-lg transition-all" onclick="deleteInvoice(${inv.id})" title="Delete"><span class="material-symbols-outlined text-[18px]">delete</span></button>
      `;
    } else if (isPaid) {
      statusBadge = `<span class="badge badge-paid">Paid</span>`;
      actionBtn = `
        <button class="p-1.5 text-primary hover:bg-primary/10 rounded-lg transition-all" onclick="openVoucherModal('${inv.voucher_code}')" title="View Voucher"><span class="material-symbols-outlined text-[18px]">qr_code</span></button>
        <button class="p-1.5 text-gray-600 hover:bg-gray-100 rounded-lg transition-all" onclick="openInvoiceDetails(${inv.id})" title="Details"><span class="material-symbols-outlined text-[18px]">visibility</span></button>
        <button class="p-1.5 text-error hover:bg-error/10 rounded-lg transition-all" onclick="deleteInvoice(${inv.id})" title="Delete"><span class="material-symbols-outlined text-[18px]">delete</span></button>
      `;
    } else if (isDP) {
      const remaining = Math.max(0, inv.total_price - (inv.down_payment || 0));
      statusBadge = `<span class="badge" style="background:#fff3cd;color:#856404;">DP (Sisa: Rp ${remaining.toLocaleString('id-ID')})</span>`;
      actionBtn = `
        <button class="p-1.5 text-yellow-600 hover:bg-yellow-50 rounded-lg transition-all" onclick="showAddPaymentModal(${inv.id}, ${remaining})" title="Add Payment"><span class="material-symbols-outlined text-[18px]">payments</span></button>
        <button class="p-1.5 text-gray-600 hover:bg-gray-100 rounded-lg transition-all" onclick="openInvoiceDetails(${inv.id})" title="Details"><span class="material-symbols-outlined text-[18px]">visibility</span></button>
        <button class="p-1.5 text-error hover:bg-error/10 rounded-lg transition-all" onclick="deleteInvoice(${inv.id})" title="Delete"><span class="material-symbols-outlined text-[18px]">delete</span></button>
      `;
    } else {
      actionBtn = `
        ${actionBtn}
        <button class="p-1.5 text-gray-600 hover:bg-gray-100 rounded-lg transition-all" onclick="openInvoiceDetails(${inv.id})" title="Details"><span class="material-symbols-outlined text-[18px]">visibility</span></button>
        <button class="p-1.5 text-error hover:bg-error/10 rounded-lg transition-all" onclick="deleteInvoice(${inv.id})" title="Delete"><span class="material-symbols-outlined text-[18px]">delete</span></button>
      `;
    }

    const items = inv.items || [];
    const firstItem = items[0] || { ticket_title: '-' };
    const descText = items.length > 1 ? `${firstItem.ticket_title} + ${items.length - 1} more` : firstItem.ticket_title;
    const totalQty = items.reduce((sum, item) => sum + item.quantity, 0);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>#${inv.id}</td>
      <td><strong>${inv.customer_name}</strong></td>
      <td>${descText}</td>
      <td>${totalQty}</td>
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
    const isDP = inv.current_status === 'DP';
    let statusBadge = `<span class="badge badge-unpaid">Unpaid</span>`;
    if (isRedeemed) statusBadge = `<span class="badge badge-redeemed">Redeemed</span>`;
    else if (isPaid) statusBadge = `<span class="badge badge-paid">Paid</span>`;
    else if (isDP) {
      const remaining = Math.max(0, inv.total_price - (inv.down_payment || 0));
      statusBadge = `<span class="badge" style="background:#fff3cd;color:#856404;">DP (Sisa: Rp ${remaining.toLocaleString('id-ID')})</span>`;
    }

    const items = inv.items || [];
    const firstItem = items[0] || { ticket_title: '-' };
    const descText = items.length > 1 ? `${firstItem.ticket_title} + ${items.length - 1} more` : firstItem.ticket_title;
    const totalQty = items.reduce((sum, item) => sum + item.quantity, 0);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>#${inv.id}</td>
      <td><strong>${inv.customer_name}</strong></td>
      <td>${descText}</td>
      <td>${totalQty}</td>
      <td>Rp ${inv.total_price.toLocaleString('id-ID')}</td>
      <td>${statusBadge}</td>
      <td class="space-x-1">
        <button class="p-1.5 text-primary hover:bg-primary/10 rounded-lg transition-all" onclick="openInvoiceDetails(${inv.id})" title="View Invoice"><span class="material-symbols-outlined text-[18px]">visibility</span></button>
        <button class="p-1.5 text-error hover:bg-error/10 rounded-lg transition-all" onclick="deleteInvoice(${inv.id})" title="Delete"><span class="material-symbols-outlined text-[18px]">delete</span></button>
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

    const items = inv.items || [];
    const firstItem = items[0] || { ticket_title: '-' };
    const descText = items.length > 1 ? `${firstItem.ticket_title} + ${items.length - 1} more` : firstItem.ticket_title;
    const totalQty = items.reduce((sum, item) => sum + item.quantity, 0);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="font-code-mono">${inv.voucher_code}</td>
      <td><strong>${inv.customer_name}</strong></td>
      <td>${descText}</td>
      <td>${totalQty}</td>
      <td>${statusBadge}</td>
      <td>
        <button class="p-1.5 text-primary hover:bg-primary/10 rounded-lg transition-all" onclick="openVoucherModal('${inv.voucher_code}')" title="View Ticket (QR)"><span class="material-symbols-outlined text-[18px]">qr_code</span></button>
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
  document.getElementById('settings-terms').value = appSettings.merchant_terms || '';
  document.getElementById('settings-payment-instructions').value = appSettings.merchant_payment_instructions || '';
  document.getElementById('settings-nvidia-key').value = appSettings.nvidia_api_key || '';
  
  const baseUrl = appSettings.ai_base_url || 'https://integrate.api.nvidia.com/v1/chat/completions';
  document.getElementById('settings-ai-base-url').value = baseUrl;
  document.getElementById('settings-chatbot-knowledge').value = appSettings.chatbot_knowledge || '';
  document.getElementById('settings-waha-url').value = appSettings.waha_url || '';
  
  // Detect and set AI Provider dropdown
  const provider = detectAIProvider(baseUrl);
  document.getElementById('settings-ai-provider').value = provider;
  
  // Populate model dropdown and set value
  onAIProviderChange(appSettings.nvidia_model || '');

  document.getElementById('settings-primary-color').value = appSettings.primary_color || '#000000';
  document.getElementById('settings-primary-color-text').value = appSettings.primary_color || '#000000';
  document.getElementById('settings-secondary-color').value = appSettings.secondary_color || '#006c4a';
  document.getElementById('settings-secondary-color-text').value = appSettings.secondary_color || '#006c4a';
  document.getElementById('settings-background-color').value = appSettings.background_color || '#f8f9ff';
  document.getElementById('settings-background-color-text').value = appSettings.background_color || '#f8f9ff';
  document.getElementById('settings-tax-rate').value = appSettings.tax_rate || '0';
  document.getElementById('settings-service-fee').value = appSettings.service_fee || '0';
  document.getElementById('settings-discount-rate').value = appSettings.discount_rate || '0';
  const discTypeEl = document.getElementById('settings-discount-type');
  if (discTypeEl) discTypeEl.value = appSettings.discount_type || 'percentage';
  document.getElementById('settings-discount-label').value = appSettings.discount_label || 'Diskon';
}

// Detect AI Provider from Endpoint URL
function detectAIProvider(url) {
  if (url.includes('nvidia.com')) return 'nvidia';
  if (url.includes('googleapis.com')) return 'gemini';
  if (url.includes('groq.com')) return 'groq';
  if (url.includes('openai.com')) return 'openai';
  if (url.includes('deepseek.com')) return 'deepseek';
  return 'custom';
}

// Handle AI Provider dropdown change
window.onAIProviderChange = function(presetModel = '') {
  const provider = document.getElementById('settings-ai-provider').value;
  const baseUrlInput = document.getElementById('settings-ai-base-url');
  const modelSelect = document.getElementById('settings-ai-model-select');
  const customModelInput = document.getElementById('settings-nvidia-model');
  const containerBaseUrl = document.getElementById('container-ai-base-url');

  const providerUrls = {
    nvidia: 'https://integrate.api.nvidia.com/v1/chat/completions',
    gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    groq: 'https://api.groq.com/openai/v1/chat/completions',
    openai: 'https://api.openai.com/v1/chat/completions',
    deepseek: 'https://api.deepseek.com/v1/chat/completions'
  };

  const providerModels = {
    nvidia: [{ value: 'nvidia/llama-3.1-nemotron-70b-instruct', label: 'llama-3.1-nemotron-70b-instruct' }],
    gemini: [
      { value: 'gemini-2.5-flash', label: 'gemini-2.5-flash (Recommended/Free)' },
      { value: 'gemini-1.5-flash', label: 'gemini-1.5-flash' },
      { value: 'gemini-2.5-pro', label: 'gemini-2.5-pro' }
    ],
    groq: [
      { value: 'llama-3.3-70b-versatile', label: 'llama-3.3-70b-versatile' },
      { value: 'mixtral-8x7b-32768', label: 'mixtral-8x7b-32768' },
      { value: 'gemma2-9b-it', label: 'gemma2-9b-it' }
    ],
    openai: [
      { value: 'gpt-4o-mini', label: 'gpt-4o-mini (Cheap)' },
      { value: 'gpt-4o', label: 'gpt-4o' }
    ],
    deepseek: [
      { value: 'deepseek-chat', label: 'deepseek-chat (DeepSeek-V3)' },
      { value: 'deepseek-reasoner', label: 'deepseek-reasoner (DeepSeek-R1)' }
    ]
  };

  // Set Endpoint URL automatically
  if (provider !== 'custom') {
    baseUrlInput.value = providerUrls[provider];
    containerBaseUrl.classList.add('opacity-60', 'pointer-events-none'); // Lock for preset providers
  } else {
    containerBaseUrl.classList.remove('opacity-60', 'pointer-events-none'); // Unlock for custom
  }

  // Populate models list
  modelSelect.innerHTML = '';
  if (provider !== 'custom' && providerModels[provider]) {
    providerModels[provider].forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.value;
      opt.innerText = m.label;
      modelSelect.appendChild(opt);
    });
    
    // Add custom model option at the end
    const optCustom = document.createElement('option');
    optCustom.value = 'custom';
    optCustom.innerText = 'Custom Model...';
    modelSelect.appendChild(optCustom);

    // Set preset model or default to first
    const hasPreset = providerModels[provider].some(m => m.value === presetModel);
    if (presetModel && hasPreset) {
      modelSelect.value = presetModel;
      customModelInput.classList.add('hidden');
    } else if (presetModel && !hasPreset) {
      modelSelect.value = 'custom';
      customModelInput.value = presetModel;
      customModelInput.classList.remove('hidden');
    } else {
      modelSelect.selectedIndex = 0;
      customModelInput.classList.add('hidden');
    }
  } else {
    // Custom Provider
    const optCustom = document.createElement('option');
    optCustom.value = 'custom';
    optCustom.innerText = 'Custom Model...';
    modelSelect.appendChild(optCustom);
    modelSelect.value = 'custom';
    
    customModelInput.value = presetModel || '';
    customModelInput.classList.remove('hidden');
  }
};

// Handle AI Model dropdown change
window.onAIModelChange = function() {
  const modelSelect = document.getElementById('settings-ai-model-select');
  const customModelInput = document.getElementById('settings-nvidia-model');
  
  if (modelSelect.value === 'custom') {
    customModelInput.classList.remove('hidden');
    if (!customModelInput.value) {
      customModelInput.value = '';
    }
  } else {
    customModelInput.classList.add('hidden');
    customModelInput.value = modelSelect.value;
  }
};

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
    if (currentTab === 'invoices') renderInvoicesTable();
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
    else if (p.status === 'DP') badge = `<span class="badge" style="background:#fff3cd;color:#856404;">DP</span>`;

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
    const discText = ticket.discount > 0 ? `<br><span class="text-[10px] text-emerald-600 font-semibold">Diskon: Rp ${ticket.discount.toLocaleString('id-ID')}</span>` : '';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${ticket.title}</strong></td>
      <td>Rp ${ticket.price.toLocaleString('id-ID')}${discText}</td>
      <td><span class="badge ${statusClass}">${statusText}</span></td>
      <td class="py-3 px-4 text-sm space-x-2">
        <button class="p-1.5 text-secondary hover:bg-secondary/10 rounded-lg transition-all" onclick="editStoreTicket(${ticket.id})" title="Edit"><span class="material-symbols-outlined text-[18px]">edit</span></button>
        <button class="p-1.5 text-error hover:bg-error/10 rounded-lg transition-all" onclick="deleteStoreTicket(${ticket.id})" title="Delete"><span class="material-symbols-outlined text-[18px]">delete</span></button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Edit ticket in Store panel
function editStoreTicket(id) {
  const ticket = ticketCatalog.find(t => t.id === id);
  if (!ticket) return;

  document.getElementById('edit-ticket-id').value = ticket.id;
  document.getElementById('edit-ticket-title').value = ticket.title;
  
  const priceEl = document.getElementById('edit-ticket-price');
  priceEl.value = ticket.price;
  formatNumberInput(priceEl);
  
  const discEl = document.getElementById('edit-ticket-discount');
  if (discEl) {
    discEl.value = ticket.discount || 0;
    formatNumberInput(discEl);
  }
  
  document.getElementById('edit-ticket-desc').value = ticket.description || '';
  document.getElementById('edit-ticket-status').value = ticket.is_active;
  
  const modal = document.getElementById('edit-ticket-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeEditTicketModal() {
  const modal = document.getElementById('edit-ticket-modal');
  if (modal) modal.classList.add('hidden');
}

// Reset ticket class CRUD form
function resetStoreTicketForm() {
  document.getElementById('store-ticket-title').value = '';
  document.getElementById('store-ticket-price').value = '';
  const discEl = document.getElementById('store-ticket-discount');
  if (discEl) discEl.value = '0';
  document.getElementById('store-ticket-desc').value = '';
  document.getElementById('store-ticket-status').value = '1';
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

// Fetch Agents List
async function loadAgents() {
  try {
    const response = await fetch('/api/agents', {
      headers: { 'Authorization': token }
    });
    agentsList = await response.json();
    
    renderAgentsTable();
    populateAgentSelect();
    renderAgentsLeaderboard();
  } catch (err) {
    console.error('Failed to load agents:', err);
  }
}

// Render Agents Table
function renderAgentsTable() {
  const tbody = document.getElementById('store-agents-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (agentsList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-secondary text-center py-4">No agents registered.</td></tr>';
    return;
  }

  agentsList.forEach(agent => {
    const discDisplay = agent.discount_type === 'nominal' 
      ? `Rp ${agent.discount_rate.toLocaleString('id-ID')}` 
      : `${agent.discount_rate}%`;

    const tr = document.createElement('tr');
    tr.className = "border-b border-outline-variant hover:bg-surface-container-low transition-colors";
    tr.innerHTML = `
      <td class="py-3 px-4 text-sm font-code-mono font-bold text-primary">${agent.code}</td>
      <td class="py-3 px-4 text-sm">
        <div class="font-semibold text-on-surface">${agent.name}</div>
        <div class="text-xs text-on-surface-variant">${agent.email || '-'}</div>
      </td>
      <td class="py-3 px-4 text-sm text-on-surface-variant">${agent.phone || '-'}</td>
      <td class="py-3 px-4 text-sm font-semibold text-emerald-600">${discDisplay}</td>
      <td class="py-3 px-4 text-sm space-x-2">
        <button class="p-1.5 text-primary hover:bg-primary/10 rounded-lg transition-all" onclick="printAgentContract(${agent.id})" title="Print Contract"><span class="material-symbols-outlined text-[18px]">description</span></button>
        <button class="p-1.5 text-secondary hover:bg-secondary/10 rounded-lg transition-all" onclick="editAgent(${agent.id})" title="Edit"><span class="material-symbols-outlined text-[18px]">edit</span></button>
        <button class="p-1.5 text-error hover:bg-error/10 rounded-lg transition-all" onclick="deleteAgent(${agent.id})" title="Delete"><span class="material-symbols-outlined text-[18px]">delete</span></button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Populate Agent Search Dropdown in simulator POS
function populateAgentSelect() {
  filterAgentSearchResults();
}

window.showAgentSearchResults = function() {
  const dropdown = document.getElementById('booking-agent-search-results');
  if (dropdown) dropdown.classList.remove('hidden');
  filterAgentSearchResults();
};

window.filterAgentSearchResults = function() {
  const searchInput = document.getElementById('booking-agent-search');
  const dropdown = document.getElementById('booking-agent-search-results');
  if (!searchInput || !dropdown) return;

  const query = searchInput.value.trim().toLowerCase();
  dropdown.innerHTML = '';

  const filtered = agentsList.filter(agent => 
    agent.name.toLowerCase().includes(query) || 
    agent.code.toLowerCase().includes(query)
  );

  if (filtered.length === 0) {
    dropdown.innerHTML = '<div class="p-3 text-xs text-on-surface-variant italic text-center">No agents found</div>';
    return;
  }

  filtered.forEach(agent => {
    const item = document.createElement('div');
    item.className = "p-3 text-xs hover:bg-primary/5 cursor-pointer border-b border-outline-variant last:border-0 transition-colors flex justify-between items-center";
    const discLabel = agent.discount_type === 'nominal' 
      ? `Rp ${agent.discount_rate.toLocaleString('id-ID')}` 
      : `${agent.discount_rate}%`;
    item.innerHTML = `
      <div>
        <span class="font-semibold text-on-surface">${agent.name}</span>
        <span class="text-[10px] text-primary font-code-mono ml-1">(${agent.code})</span>
      </div>
      <span class="font-bold text-emerald-600">${discLabel}</span>
    `;
    item.onclick = () => selectAgentFromSearch(agent.id, agent.name, agent.code);
    dropdown.appendChild(item);
  });
};

window.selectAgentFromSearch = function(id, name, code) {
  const searchInput = document.getElementById('booking-agent-search');
  const selectVal = document.getElementById('booking-agent-select');
  const dropdown = document.getElementById('booking-agent-search-results');

  if (searchInput) searchInput.value = `${name} (${code})`;
  if (selectVal) selectVal.value = id;
  if (dropdown) dropdown.classList.add('hidden');

  onAgentSelected();
};

// Global click listener to close agent search results
document.addEventListener('click', (event) => {
  const dropdown = document.getElementById('booking-agent-search-results');
  const trigger = document.getElementById('booking-agent-search');
  if (dropdown && !dropdown.classList.contains('hidden') && trigger && !trigger.contains(event.target) && !dropdown.contains(event.target)) {
    dropdown.classList.add('hidden');
  }
});

// Render Top Agents leaderboard based on invoice purchases
function renderAgentsLeaderboard() {
  const container = document.getElementById('agents-stats-container');
  if (!container) return;
  container.innerHTML = '';

  const paidInvoices = invoiceCatalog.filter(i => (i.current_status === 'Paid' || i.current_status === 'Redeemed') && i.agent_id);
  
  const statsMap = {};
  agentsList.forEach(a => {
    statsMap[a.id] = { id: a.id, name: a.name, code: a.code, count: 0, totalSpend: 0 };
  });

  paidInvoices.forEach(inv => {
    if (statsMap[inv.agent_id]) {
      statsMap[inv.agent_id].count++;
      statsMap[inv.agent_id].totalSpend += inv.total_price;
    }
  });

  // Convert to array and sort by spend desc
  const sortedStats = Object.values(statsMap).sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 3);

  // Fill in placeholders if less than 3 top agents
  while (sortedStats.length < 3) {
    sortedStats.push({ id: null, name: 'No Agent', code: '—', count: 0, totalSpend: 0 });
  }

  const trophies = ['🏆 First Place', '🥈 Second Place', '🥉 Third Place'];
  sortedStats.forEach((stat, idx) => {
    const card = document.createElement('div');
    card.className = "bg-surface-container-low p-4 rounded-lg flex items-center justify-between border border-outline-variant";
    card.innerHTML = `
      <div>
        <p class="text-[10px] text-primary uppercase font-black tracking-wider">${trophies[idx]}</p>
        <h4 class="font-bold text-sm text-on-surface mt-1 truncate max-w-[120px]" title="${stat.name}">${stat.name}</h4>
        <p class="text-[10px] text-on-surface-variant font-mono">${stat.code}</p>
      </div>
      <div class="text-right">
        <p class="text-xs font-black text-secondary">${stat.count} Orders</p>
        <p class="text-[11px] text-emerald-600 font-bold">Rp ${stat.totalSpend.toLocaleString('id-ID')}</p>
      </div>
    `;
    container.appendChild(card);
  });
}

// Reset Agent CRUD Form
function resetAgentForm() {
  document.getElementById('store-agent-id').value = '';
  document.getElementById('store-agent-name').value = '';
  document.getElementById('store-agent-code').value = '';
  document.getElementById('store-agent-phone').value = '';
  document.getElementById('store-agent-email').value = '';
  document.getElementById('store-agent-address').value = '';
  document.getElementById('store-agent-discount').value = '';
  const typeEl = document.getElementById('store-agent-discount-type');
  if (typeEl) typeEl.value = 'percentage';
  document.getElementById('agent-form-title').innerText = 'Register New Agent';
  
  // Clear contract items UI
  const container = document.getElementById('contract-items-container');
  if (container) container.innerHTML = '';

  const cancelBtn = document.getElementById('btn-cancel-agent-edit');
  if (cancelBtn) cancelBtn.classList.add('hidden');
}

// Save Agent CRUD Form
async function saveAgentForm(event) {
  event.preventDefault();
  const id = document.getElementById('store-agent-id').value;
  const name = document.getElementById('store-agent-name').value.trim();
  let code = document.getElementById('store-agent-code').value.trim().toUpperCase();
  
  // Dynamic Agent Code generation if empty
  if (!code) {
    const randNum = Math.floor(100000 + Math.random() * 900000);
    code = `AGT-${randNum}`;
  }

  const phone = document.getElementById('store-agent-phone').value.trim();
  const email = document.getElementById('store-agent-email').value.trim();
  const address = document.getElementById('store-agent-address').value.trim();
  const discount_rate = parseFloat(document.getElementById('store-agent-discount').value) || 0;
  const discount_type = document.getElementById('store-agent-discount-type')?.value || 'percentage';

  const payload = { name, code, phone, email, discount_rate, discount_type, address };
  const url = id ? `/api/agents/${id}` : '/api/agents';
  const method = id ? 'PUT' : 'POST';

  try {
    showLoading(true, 'Saving Agent...', 'Submitting agent data...');
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to save agent');

    const agentId = id || data.id;
    
    // Copy contract items from 'temp' to the new agent ID if it is a new agent
    if (!id && agentContractItems['temp'] && Object.keys(agentContractItems['temp']).length > 0) {
      agentContractItems[agentId] = agentContractItems['temp'];
      delete agentContractItems['temp'];
    }

    // Save contract items
    if (agentContractItems[agentId] && Object.keys(agentContractItems[agentId]).length > 0) {
      for (const [ticketId, itemData] of Object.entries(agentContractItems[agentId])) {
        await fetch(`/api/agents/${agentId}/contract-items`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token
          },
          body: JSON.stringify({
            ticket_id: parseInt(ticketId),
            discount_rate: itemData.discount_rate,
            discount_type: itemData.discount_type
          })
        });
      }
    }

    showToast(id ? 'Agent profile updated!' : 'Agent successfully registered!');
    resetAgentForm();
    await loadAgents();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    showLoading(false);
  }
}

// Edit Agent Trigger
async function editAgent(id) {
  const agent = agentsList.find(a => a.id === id);
  if (!agent) return;

  document.getElementById('store-agent-id').value = agent.id;
  document.getElementById('store-agent-name').value = agent.name;
  document.getElementById('store-agent-code').value = agent.code;
  document.getElementById('store-agent-phone').value = agent.phone || '';
  document.getElementById('store-agent-email').value = agent.email || '';
  document.getElementById('store-agent-address').value = agent.address || '';
  document.getElementById('store-agent-discount').value = agent.discount_rate || 0;
  const typeEl = document.getElementById('store-agent-discount-type');
  if (typeEl) typeEl.value = agent.discount_type || 'percentage';
  
  document.getElementById('agent-form-title').innerText = 'Edit Agent Profile';
  
  const cancelBtn = document.getElementById('btn-cancel-agent-edit');
  if (cancelBtn) cancelBtn.classList.remove('hidden');

  // Load contract items for this agent
  await loadAgentContractItems(agent.id);

  // Scroll to form
  document.getElementById('store-agent-form').scrollIntoView({ behavior: 'smooth' });
}

// Delete Agent Trigger
async function deleteAgent(id) {
  if (!confirm('Are you sure you want to remove this agent? Customer invoices associated with this agent will keep their discounts but will unbind from agent stats.')) return;
  try {
    showLoading(true, 'Removing Agent...', 'Deleting agent profile...');
    const response = await fetch(`/api/agents/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': token }
    });
    if (!response.ok) throw new Error('Failed to delete agent');

    showToast('Agent profile removed.');
    await loadAgents();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    showLoading(false);
  }
}

// Load Agent Contract Items
async function loadAgentContractItems(agentId) {
  try {
    const response = await fetch(`/api/agents/${agentId}/contract-items`, {
      headers: { 'Authorization': token }
    });
    const items = await response.json();
    agentContractItems[agentId] = {};
    items.forEach(item => {
      agentContractItems[agentId][item.ticket_id] = {
        discount_rate: item.discount_rate,
        discount_type: item.discount_type
      };
    });
    renderContractItems(agentId);
  } catch (err) {
    console.error('Failed to load contract items:', err);
    renderContractItems(agentId);
  }
}

// Render Contract Items UI
function renderContractItems(agentId) {
  const container = document.getElementById('contract-items-container');
  if (!container) return;
  
  const items = agentContractItems[agentId] || {};
  const activeTickets = ticketCatalog.filter(t => t.is_active === 1);
  
  if (Object.keys(items).length === 0) {
    container.innerHTML = '<p class="text-xs text-on-surface-variant text-center py-4 italic">No contract items configured. Click "Add Contract Item" to start.</p>';
    return;
  }

  container.innerHTML = Object.entries(items).map(([ticketId, data]) => {
    const ticket = activeTickets.find(t => t.id == ticketId);
    if (!ticket) return '';
    return `
      <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-3 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm hover:border-primary/40 transition-all" data-ticket-id="${ticketId}">
        <!-- Ticket Dropdown -->
        <div class="flex-1">
          <select class="w-full px-3 py-1.5 border border-outline-variant rounded-lg text-xs focus:outline-none focus:border-primary bg-white text-on-surface font-semibold" onchange="updateContractItem('${agentId}', ${ticketId}, this.value)">
            ${activeTickets.map(t => `<option value="${t.id}" ${t.id == ticketId ? 'selected' : ''}>${t.title}</option>`).join('')}
          </select>
        </div>
        
        <!-- Discount Inputs Group -->
        <div class="flex items-center gap-2 justify-between">
          <div class="flex items-center border border-outline-variant rounded-lg overflow-hidden bg-white focus-within:border-primary transition-all shadow-sm">
            <select class="w-[50px] px-1 py-1.5 text-center border-r border-outline-variant text-xs focus:outline-none bg-surface-container-low text-on-surface font-bold cursor-pointer" onchange="updateContractItemType('${agentId}', ${ticketId}, this.value)">
              <option value="percentage" ${data.discount_type === 'percentage' ? 'selected' : ''}>%</option>
              <option value="nominal" ${data.discount_type === 'nominal' ? 'selected' : ''}>Rp</option>
            </select>
            <input type="number" value="${data.discount_rate}" min="0" step="0.5" class="w-20 px-2.5 py-1.5 text-xs font-mono font-black focus:outline-none text-right text-primary bg-transparent" onchange="updateContractItemRate('${agentId}', ${ticketId}, this.value)">
          </div>
          
          <!-- Delete button -->
          <button type="button" onclick="removeContractItem('${agentId}', ${ticketId})" class="p-1.5 text-error hover:bg-error/10 active:scale-90 rounded-lg transition-all flex items-center justify-center" title="Remove Item">
            <span class="material-symbols-outlined text-[18px]">delete</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Add Contract Item Row
function addContractItemRow() {
  const agentId = document.getElementById('store-agent-id').value || 'temp';
  
  const container = document.getElementById('contract-items-container');
  const activeTickets = ticketCatalog.filter(t => t.is_active === 1);
  
  if (!agentContractItems[agentId]) agentContractItems[agentId] = {};
  
  // Find first ticket not already in contract
  const usedTicketIds = Object.keys(agentContractItems[agentId]).map(Number);
  const availableTicket = activeTickets.find(t => !usedTicketIds.includes(t.id));
  
  if (!availableTicket) {
    showToast('All active tickets already have contract rates', true);
    return;
  }
  
  agentContractItems[agentId][availableTicket.id] = { discount_rate: 0, discount_type: 'percentage' };
  renderContractItems(agentId);
}

// Update Contract Item (ticket change)
function updateContractItem(agentId, oldTicketId, newTicketId) {
  if (!agentContractItems[agentId]) return;
  const data = agentContractItems[agentId][oldTicketId];
  if (!data) return;
  
  delete agentContractItems[agentId][oldTicketId];
  agentContractItems[agentId][newTicketId] = data;
  renderContractItems(agentId);
}

// Update Contract Item Rate
function updateContractItemRate(agentId, ticketId, value) {
  if (!agentContractItems[agentId] || !agentContractItems[agentId][ticketId]) return;
  agentContractItems[agentId][ticketId].discount_rate = parseFloat(value) || 0;
}

// Update Contract Item Type
function updateContractItemType(agentId, ticketId, type) {
  if (!agentContractItems[agentId] || !agentContractItems[agentId][ticketId]) return;
  agentContractItems[agentId][ticketId].discount_type = type;
}

// Remove Contract Item
function removeContractItem(agentId, ticketId) {
  if (!agentContractItems[agentId]) return;
  delete agentContractItems[agentId][ticketId];
  renderContractItems(agentId);
}

// Print Agent Contract Rate Agreement
window.switchContractLanguage = function(agentId, lang) {
  printAgentContract(parseInt(agentId), lang);
};

function printAgentContract(id, lang = 'id') {
  const agent = agentsList.find(a => a.id === id);
  if (!agent) {
    showToast('Agent not found', true);
    return;
  }

  const modalBody = document.getElementById('modal-body-container');
  if (!modalBody) return;

  // Set print title
  const safeName = agent.name.replace(/[^a-zA-Z0-9- ]/g, '_').trim();
  window.currentPrintTitle = `Kontrak_Rate_${agent.code}_${safeName}`;

  // Hide unnecessary modal buttons, show print button
  const payBtn = document.getElementById('modal-pay-btn');
  const viewVchBtn = document.getElementById('modal-view-vch-btn');
  const editBtn = document.getElementById('modal-edit-btn');
  const deleteBtn = document.getElementById('modal-delete-btn');
  const pdfBtn = document.getElementById('modal-download-pdf-btn');

  if (payBtn) payBtn.classList.add('hidden');
  if (viewVchBtn) viewVchBtn.classList.add('hidden');
  if (editBtn) editBtn.classList.add('hidden');
  if (deleteBtn) deleteBtn.classList.add('hidden');
  if (pdfBtn) pdfBtn.classList.add('hidden');

  // Change header title
  const headerTitle = document.querySelector('.modal-action-row h3');
  if (headerTitle) headerTitle.innerText = `Agent Contract: ${agent.name}`;

  // Generate ticket prices table using CONTRACT ITEMS only
  const contractItems = agentContractItems[agent.id] || {};
  let ticketRowsHtml = '';
  
  if (Object.keys(contractItems).length === 0) {
    ticketRowsHtml = `<tr><td colspan="4" class="text-center py-4 border border-gray-300 text-gray-500">${lang === 'en' ? 'No contract items configured. Add items in Agent edit form.' : 'Belum ada item kontrak dikonfigurasi. Tambahkan item di form edit Agen.'}</td></tr>`;
  } else {
    for (const [ticketId, itemData] of Object.entries(contractItems)) {
      const ticket = ticketCatalog.find(t => t.id === parseInt(ticketId));
      if (!ticket) continue;

      const publishPrice = ticket.price;
      let netPrice = publishPrice;
      let discountLabelText = '';
      
      if (itemData.discount_type === 'nominal') {
        netPrice = Math.max(0, publishPrice - itemData.discount_rate);
        discountLabelText = `Rp ${itemData.discount_rate.toLocaleString('id-ID')}`;
      } else {
        const discountAmt = Math.round(publishPrice * itemData.discount_rate / 100);
        netPrice = Math.max(0, publishPrice - discountAmt);
        discountLabelText = `${itemData.discount_rate}%`;
      }

      ticketRowsHtml += `
        <tr class="border-b border-gray-200">
          <td class="py-3 px-4 text-sm font-semibold text-gray-800 border border-gray-300">${ticket.title}</td>
          <td class="py-3 px-4 text-sm text-right text-gray-700 font-mono border border-gray-300">Rp ${publishPrice.toLocaleString('id-ID')}</td>
          <td class="py-3 px-4 text-sm text-center text-emerald-600 font-bold border border-gray-300">${discountLabelText}</td>
          <td class="py-3 px-4 text-sm text-right text-primary font-bold font-mono border border-gray-300">Rp ${netPrice.toLocaleString('id-ID')}</td>
        </tr>
      `;
    }
  }

  const locale = lang === 'en' ? 'en-US' : 'id-ID';
  const currentDate = new Date().toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });

  // Generate contract HTML template
  modalBody.innerHTML = `
    <!-- Language Toggle (No Print) -->
    <div class="flex items-center gap-2 mb-6 no-print justify-end max-w-4xl mx-auto w-full">
      <span class="text-xs text-on-surface-variant font-semibold uppercase tracking-wider mr-1">${lang === 'en' ? 'Contract Language:' : 'Bahasa Kontrak:'}</span>
      <button onclick="window.switchContractLanguage('${agent.id}', 'id')" class="px-3 py-1 rounded-full text-xs font-bold border transition-all duration-150 ${lang === 'id' ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant text-on-surface-variant hover:border-primary'}">Bahasa Indonesia</button>
      <button onclick="window.switchContractLanguage('${agent.id}', 'en')" class="px-3 py-1 rounded-full text-xs font-bold border transition-all duration-150 ${lang === 'en' ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant text-on-surface-variant hover:border-primary'}">English</button>
    </div>

    <div class="contract-container max-w-4xl mx-auto bg-white p-8 md:p-12 text-gray-800 shadow-sm border border-gray-200 rounded-xl relative">
      <!-- Kop Surat -->
      <div class="flex items-center gap-6 border-b-4 border-double border-gray-800 pb-6 mb-8 flex-col md:flex-row text-center md:text-left">
        <img src="${appSettings.merchant_logo_url || ''}" alt="Logo" class="h-16 object-contain bg-white p-1 border border-gray-300 rounded max-w-[120px]">
        <div class="flex-1">
          <h2 class="text-xl font-bold uppercase text-gray-900 tracking-wide">${appSettings.merchant_name || 'BATUR NATURAL HOT SPRING'}</h2>
          <p class="text-xs text-gray-500 mt-1">${appSettings.merchant_address || ''}</p>
          <p class="text-xs text-gray-500">${appSettings.merchant_email || ''} | ${appSettings.merchant_phone || ''}</p>
        </div>
      </div>

      <!-- Judul Surat -->
      <div class="text-center mb-8">
        <h1 class="text-lg md:text-xl font-extrabold uppercase text-gray-950 underline tracking-wider">
          ${lang === 'en' ? 'COOPERATION AGREEMENT & AGENT CONTRACT RATE' : 'SURAT PERJANJIAN & KONTRAK RATE AGEN'}
        </h1>
        <p class="text-xs text-gray-500 mt-1 font-mono">No: ${agent.code}/AGR-${new Date().getFullYear()}/${Date.now().toString().slice(-4)}</p>
      </div>

      <!-- Pembukaan Perjanjian -->
      <div class="text-sm leading-relaxed mb-6 space-y-3">
        <p>
          ${lang === 'en' 
            ? `On this day, date <strong>${currentDate}</strong>, the undersigned parties hereby agree to establish a ticket sales cooperation agreement between:` 
            : `Pada hari ini, tanggal <strong>${currentDate}</strong>, yang bertanda tangan di bawah ini sepakat mengadakan perjanjian kerjasama penjualan tiket masuk antara:`}
        </p>
        
        <div class="pl-4 border-l-2 border-primary space-y-1 my-3 bg-gray-50 p-3 rounded">
          <p class="font-bold text-gray-900">${lang === 'en' ? 'FIRST PARTY (Service Provider / Merchant):' : 'PIHAK PERTAMA (Penyedia Layanan / Merchant):'}</p>
          <p class="text-xs">${lang === 'en' ? 'Company Name:' : 'Nama Perusahaan:'} <strong class="text-primary">${appSettings.merchant_name || 'Batur Natural Hot Spring'}</strong></p>
          <p class="text-xs">${lang === 'en' ? 'Address:' : 'Alamat:'} ${appSettings.merchant_address || 'Toya Bungkah, Kintamani, Bali'}</p>
        </div>

        <div class="pl-4 border-l-2 border-secondary space-y-1 my-3 bg-gray-50 p-3 rounded">
          <p class="font-bold text-gray-900">${lang === 'en' ? 'SECOND PARTY (Agent Partner / Company):' : 'PIHAK KEDUA (Mitra Agen / Company):'}</p>
          <p class="text-xs">${lang === 'en' ? 'Agent / Company Name:' : 'Nama Agen / Instansi:'} <strong>${agent.name}</strong></p>
          <p class="text-xs">${lang === 'en' ? 'Unique Agent Code:' : 'Kode Agen Unik:'} <span class="font-code-mono font-bold text-primary">${agent.code}</span></p>
          <p class="text-xs">${lang === 'en' ? 'Phone Number:' : 'Nomor Telepon:'} ${agent.phone || '-'}</p>
          <p class="text-xs">Email: ${agent.email || '-'}</p>
          <p class="text-xs">${lang === 'en' ? 'Address:' : 'Alamat:'} ${agent.address || '—'}</p>
        </div>
        
        <p>
          ${lang === 'en' 
            ? 'Both parties agree to establish a ticket sales cooperation with special contract rate terms as follows:' 
            : 'Kedua belah pihak sepakat untuk melakukan hubungan kerjasama penjualan tiket masuk dengan ketentuan tarif khusus (Contract Rate) sebagai berikut:'}
        </p>
      </div>

      <!-- Ketentuan Perjanjian -->
      <div class="space-y-4 mb-8">
        <div>
          <h4 class="font-bold text-sm text-gray-900 border-b pb-1 mb-2">
            ${lang === 'en' ? 'ARTICLE 1: AGENT DISCOUNT POLICY' : 'PASAL 1: KETENTUAN DISKON AGEN'}
          </h4>
          <p class="text-xs leading-relaxed text-gray-650">
            ${lang === 'en'
              ? `THE FIRST PARTY provides a special agent discount (Contract Rate) from the prevailing public price. This discount will be applied directly to every ticket booking using the official agent code of the SECOND PARTY.`
              : `PIHAK PERTAMA memberikan diskon khusus keagenan (Contract Rate) dari harga publik yang berlaku. Potongan ini akan langsung diaplikasikan di setiap pemesanan tiket masuk menggunakan kode agen resmi PIHAK KEDUA.`}
          </p>
        </div>

        <div>
          <h4 class="font-bold text-sm text-gray-900 border-b pb-1 mb-2">
            ${lang === 'en' ? 'ARTICLE 2: CONTRACT RATE TABLE' : 'PASAL 2: DAFTAR TARIF KONTRAK (CONTRACT RATE TABLE)'}
          </h4>
          <div class="overflow-x-auto mt-2">
            <table class="w-full text-left border-collapse border border-gray-300">
              <thead>
                <tr class="bg-gray-150 border-b border-gray-300">
                  <th class="py-2.5 px-4 font-bold text-xs uppercase text-gray-700 border border-gray-300 w-2/5">
                    ${lang === 'en' ? 'Ticket Category / Voucher' : 'Kategori Tiket / Voucher'}
                  </th>
                  <th class="py-2.5 px-4 font-bold text-xs uppercase text-right text-gray-700 border border-gray-300">
                    ${lang === 'en' ? 'Public Price (Publish)' : 'Harga Publik (Publish)'}
                  </th>
                  <th class="py-2.5 px-4 font-bold text-xs uppercase text-center text-gray-700 border border-gray-300">
                    ${lang === 'en' ? 'Agent Discount' : 'Diskon Agen'}
                  </th>
                  <th class="py-2.5 px-4 font-bold text-xs uppercase text-right text-primary border border-gray-300">
                    ${lang === 'en' ? 'Agent Contract Price (Net)' : 'Harga Kontrak Agen (Net)'}
                  </th>
                </tr>
              </thead>
              <tbody>
                ${ticketRowsHtml}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h4 class="font-bold text-sm text-gray-900 border-b pb-1 mb-2">
            ${lang === 'en' ? 'ARTICLE 3: VALIDITY & TERMS' : 'PASAL 3: VALIDITAS & SYARAT'}
          </h4>
          <p class="text-xs leading-relaxed text-gray-650">
            ${lang === 'en'
              ? 'The above contract rates are valid from the date of this agreement and will be reviewed periodically in accordance with public rate adjustments. Tickets purchased are non-refundable and non-transferable unless agreed otherwise.'
              : 'Tarif kontrak di atas berlaku sejak tanggal diterbitkannya surat ini dan akan terus ditinjau kembali secara berkala sesuai ketentuan tarif publik. Tiket yang dibeli tidak dapat ditransfer atau di-refund secara sepihak kecuali ditentukan lain dalam kesepakatan.'}
          </p>
        </div>
      </div>

      <!-- Blok Tanda Tangan -->
      <div class="flex justify-end text-center pt-8 border-t border-dashed border-gray-300 text-sm mt-12 break-inside-avoid">
        <div class="w-64 pr-4">
          <p class="font-semibold text-gray-800">${lang === 'en' ? 'Contract Rate Provider' : 'Pemberi Tarif Kontrak'}</p>
          <p class="text-xs text-gray-400 mt-0.5">${appSettings.merchant_name || 'Batur Natural Hot Spring'}</p>
          <div class="h-20 flex items-center justify-center">
            <span class="text-[10px] text-emerald-600/60 font-black border border-emerald-500/20 px-2 py-1 bg-emerald-50/50 rounded uppercase tracking-widest font-mono">${lang === 'en' ? 'AUTHORIZED STAMP' : 'AUTHORIZED STAMP'}</span>
          </div>
          <p class="font-bold text-gray-900 underline">${appSettings.merchant_name || 'Batur Natural Hot Spring'}</p>
          <p class="text-xs text-gray-500">${lang === 'en' ? 'Authorized Manager' : 'Authorized Manager'}</p>
        </div>
      </div>
    </div>
  `;

  // Show Details Modal
  const modal = document.getElementById('details-modal');
  if (modal) modal.classList.remove('hidden');
}

// Fetch Users List
async function loadUsers() {
  try {
    const response = await fetch('/api/users', {
      headers: { 'Authorization': token }
    });
    usersList = await response.json();
    renderUsersTable();
  } catch (err) {
    console.error('Failed to load users:', err);
  }
}

// Render Users Table
function renderUsersTable() {
  const tbody = document.getElementById('store-users-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (usersList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-secondary text-center py-4">No users registered.</td></tr>';
    return;
  }

  // Get logged in user info to prevent self-deletion
  const currentUser = JSON.parse(localStorage.getItem('admin_user') || '{}');

  usersList.forEach(user => {
    const tr = document.createElement('tr');
    tr.className = "border-b border-outline-variant hover:bg-surface-container-low transition-colors";
    
    const avatar = user.avatar_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=80&q=80';
    const isPrimaryAdmin = user.username === 'admin';
    const isSelf = user.username === currentUser.username;

    let deleteBtnHtml = `<button class="p-1.5 text-error hover:bg-error/10 rounded-lg transition-all" onclick="deleteUser(${user.id})" title="Delete"><span class="material-symbols-outlined text-[18px]">delete</span></button>`;
    if (isPrimaryAdmin || isSelf) {
      deleteBtnHtml = `<button class="p-1.5 text-gray-300 cursor-not-allowed" disabled title="Cannot delete"><span class="material-symbols-outlined text-[18px]">delete</span></button>`;
    }

    tr.innerHTML = `
      <td class="py-3 px-4">
        <img src="${avatar}" alt="${user.name}" class="w-8 h-8 rounded-full border border-outline-variant object-cover">
      </td>
      <td class="py-3 px-4 text-sm font-semibold text-on-surface">
        <div>${user.name}</div>
        <div class="text-[10px] text-on-surface-variant font-mono">ID: #${user.id}</div>
      </td>
      <td class="py-3 px-4 text-sm font-code-mono text-primary">${user.username}</td>
      <td class="py-3 px-4 text-sm">
        <span class="badge ${user.role === 'admin' ? 'badge-paid' : 'badge-unpaid'}">
          ${user.role === 'admin' ? 'Admin' : 'Staff'}
        </span>
      </td>
      <td class="py-3 px-4 text-sm space-x-2">
        <button class="p-1.5 text-secondary hover:bg-secondary/10 rounded-lg transition-all" onclick="editUser(${user.id})" title="Edit"><span class="material-symbols-outlined text-[18px]">edit</span></button>
        ${deleteBtnHtml}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Reset User CRUD Form
function resetUserForm() {
  document.getElementById('store-user-id').value = '';
  document.getElementById('store-user-name').value = '';
  
  const usernameInput = document.getElementById('store-user-username');
  if (usernameInput) {
    usernameInput.value = '';
    usernameInput.disabled = false;
  }

  document.getElementById('store-user-password').value = '';
  document.getElementById('store-user-avatar').value = '';
  
  const roleInput = document.getElementById('store-user-role');
  if (roleInput) {
    roleInput.value = 'staff';
    roleInput.disabled = false;
  }

  document.getElementById('user-form-title').innerText = 'Create New User';
  
  // Reset password requirements
  document.getElementById('store-user-password').required = true;
  const hint = document.getElementById('user-password-hint');
  if (hint) hint.classList.add('hidden');

  const cancelBtn = document.getElementById('btn-cancel-user-edit');
  if (cancelBtn) cancelBtn.classList.add('hidden');
}

// Save User CRUD Form
async function saveUserForm(event) {
  event.preventDefault();
  const id = document.getElementById('store-user-id').value;
  const name = document.getElementById('store-user-name').value.trim();
  const username = document.getElementById('store-user-username').value.trim().toLowerCase();
  const password = document.getElementById('store-user-password').value;
  const avatar_url = document.getElementById('store-user-avatar').value.trim();
  const role = document.getElementById('store-user-role').value;

  const payload = { name, username, avatar_url, role };
  if (password || !id) {
    payload.password = password;
  }

  const url = id ? `/api/users/${id}` : '/api/users';
  const method = id ? 'PUT' : 'POST';

  try {
    showLoading(true, 'Saving User...', 'Submitting user profile...');
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to save user');

    showToast(id ? 'User profile updated!' : 'User successfully registered!');
    
    // If we updated ourselves, refresh localStorage
    const currentUser = JSON.parse(localStorage.getItem('admin_user') || '{}');
    if (id && parseInt(id) === currentUser.id) {
      localStorage.setItem('admin_user', JSON.stringify({
        id: currentUser.id,
        name,
        username,
        avatar_url: avatar_url || currentUser.avatar_url,
        role
      }));
      applyDynamicSettings();
    }

    resetUserForm();
    await loadUsers();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    showLoading(false);
  }
}

// Edit User Trigger
function editUser(id) {
  const user = usersList.find(u => u.id === id);
  if (!user) return;

  document.getElementById('store-user-id').value = user.id;
  document.getElementById('store-user-name').value = user.name;
  
  const usernameInput = document.getElementById('store-user-username');
  if (usernameInput) {
    usernameInput.value = user.username;
    usernameInput.disabled = (user.username === 'admin');
  }

  document.getElementById('store-user-password').value = '';
  document.getElementById('store-user-avatar').value = user.avatar_url || '';
  
  const roleInput = document.getElementById('store-user-role');
  if (roleInput) {
    roleInput.value = user.role || 'staff';
    roleInput.disabled = (user.username === 'admin');
  }
  
  // Make password optional for editing
  document.getElementById('store-user-password').required = false;
  const hint = document.getElementById('user-password-hint');
  if (hint) hint.classList.remove('hidden');

  document.getElementById('user-form-title').innerText = 'Edit User Profile';
  
  const cancelBtn = document.getElementById('btn-cancel-user-edit');
  if (cancelBtn) cancelBtn.classList.remove('hidden');

  // Scroll to form
  document.getElementById('store-user-form').scrollIntoView({ behavior: 'smooth' });
}

// Delete User Trigger
async function deleteUser(id) {
  if (!confirm('Are you sure you want to remove this user? This action cannot be undone.')) return;
  try {
    showLoading(true, 'Removing User...', 'Deleting user profile...');
    const response = await fetch(`/api/users/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': token }
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to delete user');
    }

    showToast('User profile removed.');
    await loadUsers();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    showLoading(false);
  }
}

// Toggle Customer Type in Voucher Simulator checkout
window.toggleCustomerType = function() {
  const type = document.getElementById('booking-customer-type').value;
  const agentContainer = document.getElementById('booking-agent-container');
  const discInput = document.getElementById('checkout-discount');
  const typeEl = document.getElementById('checkout-discount-type');
  const labelEl = document.getElementById('checkout-discount-label');

  if (type === 'agent') {
    if (agentContainer) agentContainer.classList.remove('hidden');
    // Call agent select trigger
    onAgentSelected();
  } else {
    if (agentContainer) agentContainer.classList.add('hidden');
    
    // Clear and unlock inputs
    if (discInput) {
      discInput.value = parseFloat(appSettings.discount_rate) || '';
      discInput.disabled = false;
    }
    if (typeEl) {
      typeEl.value = appSettings.discount_type || 'percentage';
      typeEl.disabled = false;
    }
    if (labelEl) {
      labelEl.value = appSettings.discount_label || '';
      labelEl.disabled = false;
    }
    
    const searchInput = document.getElementById('booking-agent-search');
    if (searchInput) searchInput.value = '';
    const select = document.getElementById('booking-agent-select');
    if (select) select.value = '';

    updateBookingTotal();
  }
};

// Agent Selected trigger in Voucher Simulator
window.onAgentSelected = async function() {
  const select = document.getElementById('booking-agent-select');
  if (!select) return;
  
  const agentId = select.value;
  const discInput = document.getElementById('checkout-discount');
  const typeEl = document.getElementById('checkout-discount-type');
  const labelEl = document.getElementById('checkout-discount-label');

  if (agentId) {
    const agent = agentsList.find(a => a.id == agentId);
    if (agent) {
      // Fetch contract items for this agent if not already cached
      if (!agentContractItems[agentId]) {
        try {
          const response = await fetch(`/api/agents/${agentId}/contract-items`, {
            headers: { 'Authorization': token }
          });
          if (response.ok) {
            const items = await response.json();
            agentContractItems[agentId] = {};
            items.forEach(item => {
              agentContractItems[agentId][item.ticket_id] = {
                discount_rate: item.discount_rate,
                discount_type: item.discount_type
              };
            });
          }
        } catch (err) {
          console.error('Failed to load contract items for agent:', err);
        }
      }

      const hasContract = agentContractItems[agentId] && Object.keys(agentContractItems[agentId]).length > 0;

      // Set discount parameters
      if (hasContract) {
        if (discInput) {
          discInput.value = 0;
          discInput.disabled = true;
        }
        if (typeEl) {
          typeEl.value = 'nominal';
          typeEl.disabled = true;
        }
        if (labelEl) {
          labelEl.value = 'Diskon Kontrak Agen';
          labelEl.disabled = true;
        }
      } else {
        // Fall back to agent global rate
        if (discInput) {
          discInput.value = agent.discount_rate;
          discInput.disabled = true;
        }
        if (typeEl) {
          typeEl.value = agent.discount_type || 'percentage';
          typeEl.disabled = true;
        }
        if (labelEl) {
          labelEl.value = `Diskon Agen: ${agent.name}`;
          labelEl.disabled = true;
        }
      }
      
      // Auto-populate visitor name if empty with agent name
      const visitorNameInput = document.getElementById('booking-customer-name');
      if (visitorNameInput && !visitorNameInput.value.trim()) {
        visitorNameInput.value = agent.name;
      }
    }
  } else {
    // Unlock and fallback to standard settings
    if (discInput) {
      discInput.value = parseFloat(appSettings.discount_rate) || '';
      discInput.disabled = false;
    }
    if (typeEl) {
      typeEl.value = appSettings.discount_type || 'percentage';
      typeEl.disabled = false;
    }
    if (labelEl) {
      labelEl.value = appSettings.discount_label || '';
      labelEl.disabled = false;
    }
  }
  
  updateBookingTotal();
};

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

    let priceDisplay = `Rp ${ticket.price.toLocaleString('id-ID')}`;
    if (ticket.discount > 0) {
      priceDisplay = `<del class="text-xs text-on-surface-variant font-normal mr-2">Rp ${ticket.price.toLocaleString('id-ID')}</del> Rp ${(ticket.price - ticket.discount).toLocaleString('id-ID')}`;
    }

    const itemDiv = document.createElement('div');
    itemDiv.className = 'flex items-center justify-between p-4 bg-surface-container-low border border-outline-variant rounded-xl shadow-sm transition-all hover:shadow-md';
    itemDiv.innerHTML = `
      <div class="flex flex-col gap-1">
        <span class="font-semibold text-on-surface text-sm">${mainHeaderName}</span>
        <span class="text-xs text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded-full w-fit">${categoryName}</span>
        <span class="font-bold text-primary text-sm mt-1">${priceDisplay}</span>
      </div>
      <div class="flex items-center gap-2 bg-surface-container-high rounded-lg p-1.5 border border-outline-variant">
        <button type="button" onclick="updateQty(${ticket.id}, -1)" class="w-8 h-8 rounded-full bg-surface-container-lowest border border-outline-variant flex items-center justify-center text-on-surface hover:bg-primary hover:text-on-primary active:scale-90 transition-all font-bold text-lg select-none">−</button>
        <input type="number" id="qty-${ticket.id}" class="font-bold text-sm w-12 text-center bg-transparent border-none focus:ring-0 p-0 text-on-surface hide-spin-button" value="0" min="0" max="999" onchange="setQtyDirect(${ticket.id}, this.value)" onkeydown="handleQtyKeydown(event, ${ticket.id})">
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
  const inputEl = document.getElementById(`qty-${ticketId}`);
  if (inputEl) inputEl.value = newVal;
  updateBookingTotal();
}

function setQtyDirect(ticketId, value) {
  if (bookingQuantities[ticketId] === undefined) return;
  let parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 0) parsed = 0;
  if (parsed > 999) parsed = 999; // Optional upper limit
  
  bookingQuantities[ticketId] = parsed;
  const inputEl = document.getElementById(`qty-${ticketId}`);
  if (inputEl) inputEl.value = parsed;
  updateBookingTotal();
}

function handleQtyKeydown(event, ticketId) {
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    updateQty(ticketId, 1);
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    updateQty(ticketId, -1);
  }
}

function updateBookingTotal() {
  let subtotal = 0;
  const selectedItems = [];
  ticketCatalog.forEach(ticket => {
    const qty = bookingQuantities[ticket.id] || 0;
    if (qty > 0) {
      subtotal += (ticket.price - (ticket.discount || 0)) * qty;
      selectedItems.push({ ticket, qty });
    }
  });

  // Check if agent is selected and has contract items
  const agentSelect = document.getElementById('booking-agent-select');
  const agentId = agentSelect ? agentSelect.value : null;
  
  let discountAmt = 0;
  let discType = 'percentage';
  let discountVal = 0;
  let discLabel = 'Diskon';
  let itemizedDiscounts = [];
  
  if (agentId && agentContractItems[agentId] && Object.keys(agentContractItems[agentId]).length > 0) {
    // Use per-item contract discounts
    const contractItems = agentContractItems[agentId];
    selectedItems.forEach(({ ticket, qty }) => {
      const contractItem = contractItems[ticket.id];
      if (contractItem) {
        const publishPrice = ticket.price - (ticket.discount || 0);
        let netPrice = publishPrice;
        let itemDiscountLabel = '';
        
        if (contractItem.discount_type === 'nominal') {
          netPrice = Math.max(0, publishPrice - contractItem.discount_rate);
          itemDiscountLabel = `Rp ${contractItem.discount_rate.toLocaleString('id-ID')}`;
        } else {
          const discountAmtItem = Math.round(publishPrice * contractItem.discount_rate / 100);
          netPrice = Math.max(0, publishPrice - discountAmtItem);
          itemDiscountLabel = `${contractItem.discount_rate}%`;
        }
        
        const itemDiscount = (publishPrice - netPrice) * qty;
        discountAmt += itemDiscount;
        itemizedDiscounts.push({ ticket, itemDiscount, itemDiscountLabel, netPrice, qty });
      }
    });
    discLabel = 'Diskon Kontrak Agen';
  } else {
    // Use global/fallback discount
    const discInput = document.getElementById('checkout-discount')?.value;
    discountVal = discInput !== '' && discInput !== undefined ? parseFloat(discInput) : (parseFloat(appSettings.discount_rate) || 0);
    const discTypeEl = document.getElementById('checkout-discount-type');
    discType = discTypeEl ? discTypeEl.value : (appSettings.discount_type || 'percentage');
    discLabel = document.getElementById('checkout-discount-label')?.value.trim() || appSettings.discount_label || 'Diskon';
    
    if (discType === 'percentage') {
      discountAmt = Math.round(subtotal * discountVal / 100);
    } else {
      discountAmt = discountVal;
    }
  }

  const taxRate = parseFloat(document.getElementById('checkout-tax')?.value) || parseFloat(appSettings.tax_rate) || 0;
  const serviceFee = parseFloat(appSettings.service_fee) || 0;
  const afterDiscount = Math.max(0, subtotal - discountAmt);
  const taxAmt = Math.round(afterDiscount * taxRate / 100);
  const total = afterDiscount + taxAmt + serviceFee;

  // Render item list in checkout summary
  const itemsEl = document.getElementById('checkout-items-list');
  if (itemsEl) {
    if (selectedItems.length === 0) {
      itemsEl.innerHTML = '<p class="text-xs text-on-surface-variant italic">No tickets selected.</p>';
    } else {
      itemsEl.innerHTML = selectedItems.map(({ ticket, qty }) => {
        // Check if this item has a contract discount
        const contractDiscount = itemizedDiscounts.find(d => d.ticket.id === ticket.id);
        if (contractDiscount) {
          return `
            <div class="flex justify-between items-center py-1.5 border-b border-outline-variant last:border-0">
              <div>
                <div class="text-xs font-semibold text-on-surface">${ticket.title}</div>
                <div class="text-[10px] text-on-surface-variant">${qty} × Rp ${(ticket.price - (ticket.discount || 0)).toLocaleString('id-ID')}</div>
                <div class="text-[10px] text-emerald-600">Diskon: ${contractDiscount.itemDiscountLabel} → Net: Rp ${contractDiscount.netPrice.toLocaleString('id-ID')}</div>
              </div>
              <span class="text-xs font-bold text-on-surface">Rp ${((ticket.price - (ticket.discount || 0)) * qty).toLocaleString('id-ID')}</span>
            </div>
          `;
        } else {
          return `
            <div class="flex justify-between items-center py-1.5 border-b border-outline-variant last:border-0">
              <div>
                <div class="text-xs font-semibold text-on-surface">${ticket.title}</div>
                <div class="text-[10px] text-on-surface-variant">${qty} × Rp ${(ticket.price - (ticket.discount || 0)).toLocaleString('id-ID')}</div>
              </div>
              <span class="text-xs font-bold text-on-surface">Rp ${((ticket.price - (ticket.discount || 0)) * qty).toLocaleString('id-ID')}</span>
            </div>
          `;
        }
      }).join('');
    }
  }

  // Render price breakdown
  const breakdownEl = document.getElementById('booking-price-breakdown');
  if (breakdownEl) {
    let rows = `<div class="flex justify-between items-center">
      <span class="text-xs text-on-surface-variant font-semibold">Subtotal</span>
      <span class="font-semibold text-on-surface">Rp ${subtotal.toLocaleString('id-ID')}</span>
    </div>`;
    if (discountAmt > 0) {
      rows += `<div class="flex justify-between items-center text-emerald-600">
        <span class="text-xs font-semibold">${discLabel} ${itemizedDiscounts.length > 0 ? '(Per Item)' : (discType === 'percentage' ? `(${discountVal}%)` : '')}</span>
        <span class="font-semibold">- Rp ${discountAmt.toLocaleString('id-ID')}</span>
      </div>`;
    }
    if (taxRate > 0) {
      rows += `<div class="flex justify-between items-center text-on-surface-variant">
        <span class="text-xs font-semibold">Tax (${taxRate}%)</span>
        <span class="font-semibold">Rp ${taxAmt.toLocaleString('id-ID')}</span>
      </div>`;
    }
    if (serviceFee > 0) {
      rows += `<div class="flex justify-between items-center text-on-surface-variant">
        <span class="text-xs font-semibold">Biaya Layanan</span>
        <span class="font-semibold">Rp ${serviceFee.toLocaleString('id-ID')}</span>
      </div>`;
    }
    rows += `<div class="flex justify-between items-center pt-2 border-t border-outline-variant">
      <span class="font-bold text-on-surface text-sm">Total</span>
      <span class="font-bold text-on-surface text-lg text-primary">Rp ${total.toLocaleString('id-ID')}</span>
    </div>`;
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
  const typeEl = document.getElementById('checkout-discount-type');
  const taxEl = document.getElementById('checkout-tax');
  const labelEl = document.getElementById('checkout-discount-label');
  if (discEl && !discEl.value) discEl.value = parseFloat(appSettings.discount_rate) || '';
  if (typeEl && (!discEl || !discEl.value || typeEl.value === 'percentage')) typeEl.value = appSettings.discount_type || 'percentage';
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

    let btnClass = 'w-full aspect-square flex items-center justify-center rounded-full transition-all text-xs font-semibold ';
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

  const shortMonth = monthsLong[dateObj.getMonth()].slice(0, 3);
  const m3Text = `${daysShort[dateObj.getDay()]}, ${dateObj.getDate()} ${shortMonth}`;
  const m3El = document.getElementById('m3-calendar-selected-date');
  if (m3El) m3El.innerText = m3Text;

  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  const yyyy = dateObj.getFullYear();
  const inputEl = document.getElementById('booking-date-input');
  if (inputEl) inputEl.value = `${mm}/${dd}/${yyyy}`;

  const dropdown = document.getElementById('calendar-dropdown');
  if (dropdown) dropdown.classList.add('hidden');
}

// Global Calendar Dropdown Toggle
window.toggleCalendarDropdown = function(event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById('calendar-dropdown');
  if (dropdown) {
    dropdown.classList.toggle('hidden');
  }
};

document.addEventListener('click', (event) => {
  const dropdown = document.getElementById('calendar-dropdown');
  const trigger = document.getElementById('booking-date-input');
  if (dropdown && !dropdown.classList.contains('hidden') && trigger && !trigger.contains(event.target) && !dropdown.contains(event.target)) {
    dropdown.classList.add('hidden');
  }
});

function showBookingConfirm() {
  const customerName = document.getElementById('booking-customer-name').value.trim();
  const paymentMethod = document.getElementById('booking-payment-method').value;
  if (!customerName) { showToast('Please enter visitor name!', true); return; }

  const selectedItems = [];
  let subtotal = 0;
  ticketCatalog.forEach(ticket => {
    const qty = bookingQuantities[ticket.id] || 0;
    if (qty > 0) { selectedItems.push({ ticket, qty }); subtotal += (ticket.price - (ticket.discount || 0)) * qty; }
  });
  if (selectedItems.length === 0) { showToast('Please select at least 1 ticket!', true); return; }

  const discountVal = parseFloat(document.getElementById('checkout-discount')?.value) || 0;
  const discType = document.getElementById('checkout-discount-type')?.value || 'percentage';
  const taxRate = parseFloat(document.getElementById('checkout-tax')?.value) || 0;
  const serviceFee = parseFloat(appSettings.service_fee) || 0;
  const discLabel = document.getElementById('checkout-discount-label')?.value.trim() || appSettings.discount_label || 'Discount';
  
  const rawDP = (document.getElementById('checkout-down-payment')?.value || '').replace(/\./g, '');
  const dpValue = parseFloat(rawDP) || 0;

  let discountAmt = 0;
  if (discType === 'percentage') {
    discountAmt = Math.round(subtotal * discountVal / 100);
  } else {
    discountAmt = discountVal;
  }
  const afterDiscount = Math.max(0, subtotal - discountAmt);
  const taxAmt = Math.round(afterDiscount * taxRate / 100);
  const total = afterDiscount + taxAmt + serviceFee;
  const remainingBalance = Math.max(0, total - dpValue);

  const itemRows = selectedItems.map(({ ticket, qty }) =>
    `<div class="flex justify-between text-xs py-1 border-b border-outline-variant last:border-0">
      <span class="font-semibold text-on-surface">${ticket.title} <span class="text-on-surface-variant font-normal">×${qty}</span></span>
      <span class="font-bold">Rp ${((ticket.price - (ticket.discount || 0)) * qty).toLocaleString('id-ID')}</span>
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
      ${discountVal > 0 ? `<div class="flex justify-between text-emerald-600"><span>${discLabel} ${discType === 'percentage' ? `(${discountVal}%)` : ''}</span><span class="font-semibold">- Rp ${discountAmt.toLocaleString('id-ID')}</span></div>` : ''}
      ${taxRate > 0 ? `<div class="flex justify-between text-on-surface-variant"><span>Tax (${taxRate}%)</span><span class="font-semibold">Rp ${taxAmt.toLocaleString('id-ID')}</span></div>` : ''}
      ${serviceFee > 0 ? `<div class="flex justify-between text-on-surface-variant"><span>Service Fee</span><span class="font-semibold">Rp ${serviceFee.toLocaleString('id-ID')}</span></div>` : ''}
      <div class="flex justify-between border-t border-outline-variant pt-2 mt-1"><span class="font-bold text-sm text-on-surface">Total Bill</span><span class="font-black text-primary text-sm">Rp ${total.toLocaleString('id-ID')}</span></div>
      ${dpValue > 0 ? `
        <div class="flex justify-between text-orange-600 font-semibold"><span>Down Payment (DP)</span><span>Rp ${dpValue.toLocaleString('id-ID')}</span></div>
        <div class="flex justify-between text-on-surface-variant font-bold border-t border-dashed border-outline-variant pt-1 mt-1"><span>Remaining Balance</span><span>Rp ${remainingBalance.toLocaleString('id-ID')}</span></div>
      ` : ''}
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
    showToast('Please enter the customer name!', true);
    return;
  }

  const orderItems = [];
  ticketCatalog.forEach(ticket => {
    const qty = bookingQuantities[ticket.id] || 0;
    if (qty > 0) {
      orderItems.push({
        ticketId: ticket.id,
        quantity: qty
      });
    }
  });

  if (orderItems.length === 0) {
    showToast('Please select at least 1 ticket!', true);
    return;
  }

  try {
    closeBookingConfirm();
    const isEdit = !!window.editingInvoiceId;
    showLoading(true, payDirectly ? 'Processing Payment...' : (isEdit ? 'Updating Invoice...' : 'Creating Invoice...'), 'Submitting booking details...');

    const url = isEdit ? `/api/invoices/${window.editingInvoiceId}` : '/api/invoices';
    const method = isEdit ? 'PUT' : 'POST';

    const agentId = document.getElementById('booking-customer-type').value === 'agent' ? (document.getElementById('booking-agent-select').value || null) : null;
    let discRate = parseFloat(document.getElementById('checkout-discount')?.value) || 0;
    let discType = document.getElementById('checkout-discount-type')?.value || 'percentage';
    let discLabel = document.getElementById('checkout-discount-label')?.value.trim() || '';

    // Calculate total discount from agent contract items if applicable
    if (agentId && agentContractItems[agentId] && Object.keys(agentContractItems[agentId]).length > 0) {
      let contractDiscountAmt = 0;
      const contractItems = agentContractItems[agentId];
      
      orderItems.forEach(item => {
        const ticket = ticketCatalog.find(t => t.id === item.ticketId);
        if (ticket) {
          const contractItem = contractItems[ticket.id];
          if (contractItem) {
            const publishPrice = ticket.price - (ticket.discount || 0);
            let netPrice = publishPrice;
            if (contractItem.discount_type === 'nominal') {
              netPrice = Math.max(0, publishPrice - contractItem.discount_rate);
            } else {
              const discountAmtItem = Math.round(publishPrice * contractItem.discount_rate / 100);
              netPrice = Math.max(0, publishPrice - discountAmtItem);
            }
            contractDiscountAmt += (publishPrice - netPrice) * item.quantity;
          }
        }
      });
      
      discRate = contractDiscountAmt;
      discType = 'nominal';
      discLabel = appSettings.discount_label || 'Diskon';
    }

    const response = await fetch(url, {
      method,
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': token
      },
      body: JSON.stringify({
        customerName,
        items: orderItems,
        paymentMethod,
        visitDate: selectedBookingDateString || null,
        downPayment: parseFloat((document.getElementById('checkout-down-payment')?.value || '').replace(/\./g, '')) || 0,
        discountRate: discRate,
        discountType: discType,
        discountLabel: discLabel,
        taxRate: parseFloat(document.getElementById('checkout-tax')?.value) || 0,
        serviceFee: parseFloat(appSettings.service_fee) || 0,
        agentId: agentId
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to submit order');

    // Auto-pay if user clicked "Bayar Langsung"
    if (payDirectly) {
      await fetch('/api/invoices/' + data.id + '/pay', {
        method: 'POST',
        headers: { 'Authorization': token }
      });
    }

    showToast(payDirectly ? 'Payment successfully confirmed!' : (isEdit ? 'Invoice updated successfully!' : 'Invoice created successfully!'));
    resetBookingFlow();
    await loadInvoices();
    openInvoiceDetails(data.id);

  } catch (err) {
    showToast(err.message, true);
  } finally {
    showLoading(false);
  }
}

function resetBookingFlow() {
  window.editingInvoiceId = null;
  
  const submitBtn = document.getElementById('booking-submit-btn');
  if (submitBtn) {
    submitBtn.innerHTML = `
      <span class="material-symbols-outlined text-[20px]">receipt_long</span>
      Review &amp; Confirm
    `;
  }
  
  const confSaveBtn = document.getElementById('confirm-save-btn');
  if (confSaveBtn) {
    confSaveBtn.innerHTML = `
      <span class="material-symbols-outlined text-[16px]">pending</span>Save (Unpaid)
    `;
  }
  
  const confPayBtn = document.getElementById('confirm-pay-btn');
  if (confPayBtn) {
    confPayBtn.innerHTML = `
      <span class="material-symbols-outlined text-[16px]">check_circle</span>Pay Directly
    `;
  }

  document.getElementById('booking-customer-name').value = '';
  document.getElementById('booking-step-1').classList.remove('hidden');
  document.getElementById('booking-step-2').classList.add('hidden');
  
  const custTypeEl = document.getElementById('booking-customer-type');
  if (custTypeEl) {
    custTypeEl.value = 'regular';
    toggleCustomerType();
  }
  
  renderBookingCatalog();
}

function startEditInvoice(inv) {
  closeModal();
  switchTab('generator');
  window.editingInvoiceId = inv.id;

  const submitBtn = document.getElementById('booking-submit-btn');
  if (submitBtn) {
    submitBtn.innerHTML = `
      <span class="material-symbols-outlined text-[20px]">edit</span>
      Update Invoice
    `;
  }

  const confSaveBtn = document.getElementById('confirm-save-btn');
  if (confSaveBtn) {
    confSaveBtn.innerHTML = `
      <span class="material-symbols-outlined text-[16px]">edit</span>Update
    `;
  }

  const confPayBtn = document.getElementById('confirm-pay-btn');
  if (confPayBtn) {
    confPayBtn.innerHTML = `
      <span class="material-symbols-outlined text-[16px]">check_circle</span>Update &amp; Pay
    `;
  }

  document.getElementById('booking-customer-name').value = inv.customer_name || '';
  document.getElementById('checkout-down-payment').value = inv.down_payment ? inv.down_payment.toLocaleString('id-ID') : '';
  
  // Set customer type & agent select first
  const custTypeEl = document.getElementById('booking-customer-type');
  if (inv.agent_id) {
    if (custTypeEl) custTypeEl.value = 'agent';
    toggleCustomerType();
    const agent = agentsList.find(a => a.id === inv.agent_id);
    if (agent) {
      const searchInput = document.getElementById('booking-agent-search');
      if (searchInput) searchInput.value = `${agent.name} (${agent.code})`;
      const agentSel = document.getElementById('booking-agent-select');
      if (agentSel) agentSel.value = inv.agent_id;
      // Set input ke agent settings (lock)
      onAgentSelected();
    }
  } else {
    if (custTypeEl) custTypeEl.value = 'regular';
    toggleCustomerType();
    
    document.getElementById('checkout-discount').value = inv.discount_rate || '';
    document.getElementById('checkout-discount-type').value = inv.discount_type || 'percentage';
    document.getElementById('checkout-discount-label').value = inv.discount_label || '';
  }
  
  document.getElementById('checkout-tax').value = inv.tax_rate || '';
  document.getElementById('booking-payment-method').value = inv.payment_method || 'Cash';

  if (inv.visit_date) {
    selectedBookingDateString = inv.visit_date;
    const dateTextEl = document.getElementById('selected-date-text');
    if (dateTextEl) dateTextEl.innerText = inv.visit_date;
    const inputEl = document.getElementById('booking-date-input');
    if (inputEl) inputEl.value = inv.visit_date;
  }

  renderBookingCatalog();

  if (inv.items && Array.isArray(inv.items)) {
    inv.items.forEach(item => {
      bookingQuantities[item.ticket_id] = item.quantity;
      const qtyInput = document.getElementById(`qty-${item.ticket_id}`);
      if (qtyInput) {
        qtyInput.value = item.quantity;
      }
    });
  }

  updateBookingTotal();
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

    const safeName = first.customer_name.replace(/[^a-zA-Z0-9- ]/g, '_').trim();
    const safeBranding = (appSettings.merchant_name || 'POS').replace(/[^a-zA-Z0-9- ]/g, '_').replace(/\s+/g, '_').trim();
    window.currentPrintTitle = `${safeBranding}_Invoice_Multiple_${safeName}`;

    const payBtn = document.getElementById('modal-pay-btn');
    const viewVchBtn = document.getElementById('modal-view-vch-btn');
    const pdfBtn = document.getElementById('modal-download-pdf-btn');
    if (pdfBtn) pdfBtn.classList.add('hidden');
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

    // Table rows: 1 row per ticket type (which is 1 invoice in this case)
    const tableRows = invoices.map(inv => {
      const item = (inv.items && inv.items[0]) || {};
      const tTitle = item.ticket_title || '-';
      const tPrice = item.ticket_price || (inv.total_price / inv.quantity);
      const tDisc = item.ticket_discount || 0;

      return `
      <tr class="border-b border-outline-variant hover:bg-surface transition-colors">
        <td class="py-4 px-4">
          <div class="font-semibold">${tTitle}</div>
          ${tDisc > 0 ? `<div class="text-emerald-600 text-xs font-semibold mt-1">Includes Rp ${tDisc.toLocaleString('id-ID')} discount</div>` : ''}
          <div class="flex items-center gap-2 mt-1">
            <span class="badge ${inv.current_status === 'Paid' ? 'badge-paid' : inv.current_status === 'Redeemed' ? 'badge-redeemed' : 'badge-unpaid'} text-[9px] px-2 py-0.5">${inv.current_status.toUpperCase()}</span>
            ${inv.voucher_code ? `<span class="font-mono text-xs text-on-surface-variant">${inv.voucher_code}</span>` : ''}
          </div>
        </td>
        <td class="py-4 px-4 text-right">
          ${tDisc > 0 ? `<div class="line-through text-on-surface-variant text-xs">Rp ${tPrice.toLocaleString('id-ID')}</div>` : ''}
          <div class="${tDisc > 0 ? 'text-emerald-600 font-semibold' : ''}">Rp ${(tPrice - tDisc).toLocaleString('id-ID')}</div>
        </td>
        <td class="py-4 px-4 text-center">${inv.quantity}</td>
        <td class="py-4 px-4 text-right font-code-mono">Rp ${inv.total_price.toLocaleString('id-ID')}</td>
        <td class="py-4 px-4 text-center">
          ${inv.current_status === 'Paid' || inv.current_status === 'Redeemed'
            ? `<button onclick="openVoucherModal('${inv.voucher_code}')" class="px-2 py-1 bg-primary text-on-primary text-xs font-bold rounded-lg flex items-center gap-1 mx-auto"><span class="material-symbols-outlined text-[14px]">qr_code</span>Voucher</button>`
            : `<button onclick="confirmPaymentFromModal(${inv.id})" class="px-2 py-1 bg-secondary-container text-on-secondary-container text-xs font-bold rounded-lg mx-auto">Pay</button>`
          }
        </td>
      </tr>
      `;
    }).join('');

    const subtotalAll = invoices.reduce((s, i) => s + i.total_price, 0);
    const p = calcPricing(subtotalAll, first);
    const discLabel = first.discount_label || appSettings.discount_label || 'Discount';

    const visitLabel = first.visit_date || new Date(first.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

    modalBody.innerHTML = `
      <div class="invoice-container max-w-4xl mx-auto bg-surface-container-lowest shadow-sm rounded-xl overflow-hidden relative border border-outline-variant p-8 md:p-10">
        <div class="h-2 bg-primary w-full absolute top-0 left-0"></div>

        <!-- Header -->
        <div class="flex flex-col md:flex-row print:flex-row justify-between items-start mb-10 print:mb-4 gap-8 pt-4">
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
        <div class="bg-surface-container-low p-6 print:p-4 rounded-lg mb-10 print:mb-4">
          <h3 class="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant mb-2 print:mb-1">Billed To:</h3>
          <p class="font-headline-sm font-semibold text-on-surface">${first.customer_name}</p>
          <p class="text-sm text-on-surface-variant mt-1">${invoices.length} Ticket Types</p>
        </div>

        <!-- Items Table -->
        <div class="mb-10 print:mb-4 overflow-x-auto">
          <table class="w-full text-left border-collapse min-w-[600px] print:min-w-0">
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

        <!-- Totals Section -->
        <div class="flex flex-col items-end mb-8 print:mb-4 break-inside-avoid">
          <div class="w-full sm:w-2/3 md:w-1/2 lg:w-2/5 print:w-[45%] space-y-3 print:space-y-1">
            ${(() => {
              const totalTicketDiscount = invoices.reduce((sum, inv) => {
                const item = (inv.items && inv.items[0]) || {};
                return sum + (item.ticket_discount || 0) * inv.quantity;
              }, 0);
              const originalSubtotal = p.subtotal + totalTicketDiscount;
              return `
            <div class="flex justify-between font-body-md text-on-surface">
              <span>Subtotal:</span>
              <span class="font-code-mono whitespace-nowrap">Rp ${originalSubtotal.toLocaleString('id-ID')}</span>
            </div>
            ${totalTicketDiscount > 0 ? `<div class="flex justify-between font-body-md text-emerald-600">
              <span>Item Discounts:</span>
              <span class="font-code-mono whitespace-nowrap">- Rp ${totalTicketDiscount.toLocaleString('id-ID')}</span>
            </div>` : ''}
            ${p.discountRate > 0 ? `<div class="flex justify-between font-body-md text-emerald-600">
              <span>${discLabel}${p.discountType === 'percentage' ? ` (${p.discountRate}%)` : ''}:</span>
              <span class="font-code-mono whitespace-nowrap">- Rp ${p.discountAmt.toLocaleString('id-ID')}</span>
            </div>` : ''}
            ${p.taxRate > 0 ? `<div class="flex justify-between font-body-md text-on-surface">
              <span>Tax (${p.taxRate}%):</span>
              <span class="font-code-mono whitespace-nowrap">Rp ${p.taxAmt.toLocaleString('id-ID')}</span>
            </div>` : ''}
            ${p.serviceFee > 0 ? `<div class="flex justify-between font-body-md text-on-surface border-b border-outline-variant pb-3">
              <span>Service Fee:</span>
              <span class="font-code-mono whitespace-nowrap">Rp ${p.serviceFee.toLocaleString('id-ID')}</span>
            </div>` : '<div class="border-b border-outline-variant pb-1"></div>'}
            <div class="flex justify-between items-center pt-2">
              <span class="font-headline-sm font-bold text-secondary">Total Due:</span>
              <span class="font-headline-md font-bold text-secondary font-code-mono whitespace-nowrap">Rp ${p.total.toLocaleString('id-ID')}</span>
            </div>
              `;
            })()}
          </div>
        </div>

        <!-- Instructions -->
        <div class="flex flex-col text-on-surface-variant font-body-md text-sm print:text-xs border-t border-outline-variant pt-6 print:pt-4 break-inside-avoid">
          <div class="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-6 print:gap-4">
            <div>
              <h4 class="font-semibold text-on-surface mb-2 print:mb-1">Terms &amp; Conditions</h4>
              <p class="whitespace-pre-wrap">${appSettings.merchant_terms || 'Vouchers are non-refundable but can be rescheduled up to 24 hours before the reservation date. Please present the QR code sent to your WhatsApp number at the main entrance gate.'}</p>
            </div>
            <div>
              <h4 class="font-semibold text-on-surface mb-2 print:mb-1">Payment Instructions</h4>
              <p class="whitespace-pre-wrap">${first.payment_instructions || appSettings.merchant_payment_instructions || 'Please complete transfer.'}</p>
            </div>
          </div>
        </div>

        <div class="bg-surface-container px-8 py-6 print:py-4 text-center border-t border-outline-variant mt-8 print:mt-4 -mx-8 -mb-8 md:-mx-10 md:-mb-10">
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
    const isDP = inv.current_status === 'DP';
    
    const agent = inv.agent_id ? agentsList.find(a => a.id === inv.agent_id) : null;

    // Set modal header title
    const headerTitle = document.querySelector('.modal-action-row h3');
    if (headerTitle) headerTitle.innerText = `Invoice #${inv.id}`;

    const safeName = inv.customer_name.replace(/[^a-zA-Z0-9- ]/g, '_').trim();
    const safeBranding = (appSettings.merchant_name || 'POS').replace(/[^a-zA-Z0-9- ]/g, '_').replace(/\s+/g, '_').trim();
    window.currentPrintTitle = `${safeBranding}_Invoice_${inv.id}_${safeName}`;

    // Manage header action buttons
    const payBtn = document.getElementById('modal-pay-btn');
    const viewVchBtn = document.getElementById('modal-view-vch-btn');
    const editBtn = document.getElementById('modal-edit-btn');
    const deleteBtn = document.getElementById('modal-delete-btn');
    const pdfBtn = document.getElementById('modal-download-pdf-btn');
    if (pdfBtn) pdfBtn.classList.add('hidden');

    if (deleteBtn) {
      deleteBtn.classList.remove('hidden');
      deleteBtn.onclick = () => deleteInvoiceFromModal(inv.id);
    }

    if (!isPaid && !isRedeemed) {
      if (editBtn) {
        editBtn.classList.remove('hidden');
        editBtn.onclick = () => startEditInvoice(inv);
      }
      payBtn.classList.remove('hidden');
      if (isDP) {
        const remaining = Math.max(0, inv.total_price - (inv.down_payment || 0));
        payBtn.innerText = `Confirm Payment (Rp ${remaining.toLocaleString('id-ID')})`;
        payBtn.onclick = () => confirmPaymentFromModal(inv.id);
      } else {
        payBtn.innerText = 'Confirm Payment';
        payBtn.onclick = () => confirmPaymentFromModal(inv.id);
      }
      viewVchBtn.classList.add('hidden');
    } else if (isPaid) {
      if (editBtn) editBtn.classList.add('hidden');
      payBtn.classList.add('hidden');
      viewVchBtn.classList.remove('hidden');
      viewVchBtn.onclick = () => openVoucherModal(inv.voucher_code);
    } else {
      if (editBtn) editBtn.classList.add('hidden');
      payBtn.classList.add('hidden');
      viewVchBtn.classList.add('hidden');
    }

    modalBody.innerHTML = `
      <div class="invoice-container max-w-4xl mx-auto bg-white shadow-sm rounded-xl overflow-hidden relative border border-gray-200 p-8 md:p-10">
        <!-- Top accent bar -->
        <div class="inv-topbar h-2 bg-primary w-full absolute top-0 left-0 rounded-t-xl"></div>

        <!-- HEADER -->
        <div class="inv-header flex flex-col md:flex-row justify-between items-start gap-8 pt-6 mb-10">
          <!-- Merchant Info -->
          <div class="inv-merchant-info">
            <img src="${appSettings.merchant_logo_url || ''}" alt="${appSettings.merchant_name || 'Logo'}" class="h-12 object-contain mb-3">
            <p class="merchant-name font-bold text-gray-900">${appSettings.merchant_name || 'Batur Natural Hot Spring'}</p>
            <p class="text-gray-500 whitespace-pre-wrap">${appSettings.merchant_address || 'Toya Bungkah, Kintamani, Bangli, Bali'}</p>
            <p class="text-gray-500">${appSettings.merchant_email || ''}</p>
            <p class="text-gray-500">${appSettings.merchant_phone || ''}</p>
          </div>
          <!-- Invoice ID Block -->
          <div class="inv-id-block text-right">
            <h1 class="text-4xl font-extrabold text-primary tracking-wide mb-3">INVOICE</h1>
            <table class="ml-auto">
            ${(() => {
              let statusColorClass = 'inv-status-unpaid text-red-500';
              if (isPaid || isRedeemed) statusColorClass = 'inv-status-paid text-green-600';
              else if (isDP) statusColorClass = 'text-yellow-600';

              return `
              <tr><td class="label font-semibold text-right pr-3 text-gray-700">Invoice ID:</td><td class="value font-mono text-gray-600">#INV-${inv.id}</td></tr>
              <tr><td class="label font-semibold text-right pr-3 text-gray-700">Date Issued:</td><td class="value text-gray-600">${new Date(inv.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</td></tr>
              <tr><td class="label font-semibold text-right pr-3 text-gray-700">Payment:</td><td class="value text-gray-600">${inv.payment_method}</td></tr>
              <tr><td class="label font-semibold text-right pr-3 text-gray-700">Status:</td><td class="value ${statusColorClass} font-bold">${inv.current_status.toUpperCase()}</td></tr>
              `;
            })()}
            </table>
          </div>
        </div>

        <!-- CUSTOMER BAR -->
        <div class="inv-customer-bar flex flex-col md:flex-row justify-between bg-gray-50 border border-gray-200 rounded-lg px-6 py-4 mb-8">
          <div>
            <p class="bill-to-label text-xs uppercase tracking-widest text-gray-400 mb-1 font-bold">Billed To</p>
            <p class="customer-name text-xl font-bold text-gray-900">${inv.customer_name}</p>
            <p class="customer-sub text-sm text-gray-500 mt-0.5">${agent ? `Registered Agent — ${agent.code}` : 'Guest Visitor'}</p>
          </div>
          <div class="mt-3 md:mt-0 text-left md:text-right">
            <p class="ref-label text-xs uppercase tracking-widest text-gray-400 mb-1 font-bold">Order Reference</p>
            <p class="ref-code font-mono text-base font-semibold text-gray-800">${inv.voucher_code || '—'}</p>
          </div>
        </div>

        <!-- ITEMS TABLE -->
        <div class="inv-table-wrap mb-8 overflow-x-auto">
          <table class="inv-items-table w-full border-collapse text-sm">
            <thead>
              <tr class="bg-gray-50">
                <th class="td-desc py-3 px-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500 border-b-2 border-primary">Description</th>
                <th class="td-price py-3 px-3 text-right text-xs font-bold uppercase tracking-wider text-gray-500 border-b-2 border-primary">Price/Unit</th>
                <th class="td-qty py-3 px-3 text-center text-xs font-bold uppercase tracking-wider text-gray-500 border-b-2 border-primary">Qty</th>
                <th class="td-sub py-3 px-3 text-right text-xs font-bold uppercase tracking-wider text-gray-500 border-b-2 border-primary">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              ${(inv.items || []).map(item => `
                <tr class="border-b border-gray-100">
                  <td class="td-desc py-4 px-3">
                    <div class="item-title font-semibold text-gray-900">${item.ticket_title}</div>
                    <div class="item-desc text-xs text-gray-400 mt-0.5">Admission to hot spring pools</div>
                    ${item.ticket_discount > 0 ? `<div class="item-disc text-xs text-green-600 font-semibold mt-0.5">Disc. Rp ${item.ticket_discount.toLocaleString('id-ID')}/ticket</div>` : ''}
                  </td>
                  <td class="td-price py-4 px-3 text-right align-top">
                    ${item.ticket_discount > 0 ? `<span class="price-orig text-xs line-through text-gray-400 block">Rp ${item.ticket_price.toLocaleString('id-ID')}</span>` : ''}
                    <span class="${item.ticket_discount > 0 ? 'price-net text-green-600 font-semibold' : 'price-normal text-gray-800'}">Rp ${(item.ticket_price - (item.ticket_discount || 0)).toLocaleString('id-ID')}</span>
                  </td>
                  <td class="td-qty py-4 px-3 text-center align-top text-gray-700">${item.quantity}</td>
                  <td class="td-sub py-4 px-3 text-right align-top font-mono text-gray-800">Rp ${item.total_price.toLocaleString('id-ID')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <!-- TOTALS -->
        <div class="inv-totals-block flex justify-end mb-8">
          <div class="inv-totals-inner w-full md:w-2/5 space-y-1.5">
            ${(() => {
              const totalTicketDiscount = (inv.items || []).reduce((sum, item) => sum + ((item.ticket_discount || 0) * item.quantity), 0);
              const p = calcPricing(inv.total_price, inv);
              const originalSubtotal = p.subtotal + totalTicketDiscount;
              const discLabel = inv.discount_label || appSettings.discount_label || 'Diskon';
              return `
            <div class="total-row flex justify-between text-gray-700">
              <span>Subtotal</span>
              <span class="amount font-mono whitespace-nowrap">Rp ${originalSubtotal.toLocaleString('id-ID')}</span>
            </div>
            ${totalTicketDiscount > 0 ? `
            <div class="total-row discount flex justify-between text-green-600">
              <span>Item Discounts</span>
              <span class="amount font-mono whitespace-nowrap">- Rp ${totalTicketDiscount.toLocaleString('id-ID')}</span>
            </div>` : ''}
            ${p.discountRate > 0 ? `
            <div class="total-row discount flex justify-between text-green-600">
              <span>${discLabel}${p.discountType === 'percentage' ? ` (${p.discountRate}%)` : ''}</span>
              <span class="amount font-mono whitespace-nowrap">- Rp ${p.discountAmt.toLocaleString('id-ID')}</span>
            </div>` : ''}
            ${p.taxRate > 0 ? `
            <div class="total-row flex justify-between text-gray-700">
              <span>Tax (${p.taxRate}%)</span>
              <span class="amount font-mono whitespace-nowrap">Rp ${p.taxAmt.toLocaleString('id-ID')}</span>
            </div>` : ''}
            ${p.serviceFee > 0 ? `
            <div class="total-row flex justify-between text-gray-700">
              <span>Service Fee</span>
              <span class="amount font-mono whitespace-nowrap">Rp ${p.serviceFee.toLocaleString('id-ID')}</span>
            </div>` : ''}
            <hr class="total-divider border-gray-300 my-2">
            <div class="total-row grand-total flex justify-between items-center pt-1">
              <span class="label text-lg font-extrabold text-primary">Total Due</span>
              <span class="amount text-xl font-extrabold text-primary font-mono whitespace-nowrap">Rp ${p.total.toLocaleString('id-ID')}</span>
            </div>
            ${(inv.down_payment || 0) > 0 && inv.current_status !== 'Paid' && inv.current_status !== 'Redeemed' ? `
            <div class="total-row flex justify-between text-yellow-700 mt-2">
              <span class="font-semibold">Down Payment (DP)</span>
              <span class="amount font-mono whitespace-nowrap font-semibold">Rp ${(inv.down_payment || 0).toLocaleString('id-ID')}</span>
            </div>
            <div class="total-row flex justify-between text-red-600 font-bold">
              <span>Remaining Balance</span>
              <span class="amount font-mono whitespace-nowrap">Rp ${Math.max(0, p.total - (inv.down_payment || 0)).toLocaleString('id-ID')}</span>
            </div>
            <div class="mt-3">
              <button onclick="showAddPaymentModal(${inv.id}, ${Math.max(0, p.total - (inv.down_payment || 0))})" class="w-full py-2 px-4 bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-bold rounded-lg transition-all">+ Add Payment</button>
            </div>
            ` : ''}
            ${(inv.down_payment || 0) > 0 && (inv.current_status === 'Paid' || inv.current_status === 'Redeemed') ? `
            <div class="total-row flex justify-between text-green-600 mt-2">
              <span class="font-semibold">Total Paid</span>
              <span class="amount font-mono whitespace-nowrap font-semibold">Rp ${(inv.down_payment || 0).toLocaleString('id-ID')}</span>
            </div>
            ` : ''}
              `;
            })()}
          </div>
        </div>

        <!-- FOOTER INFO: Terms + Payment -->
        <div class="inv-footer-info grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-gray-200 pt-6">
          <div>
            <h4 class="text-xs font-bold uppercase tracking-wider text-gray-600 mb-2">Terms &amp; Conditions</h4>
            <p class="text-xs text-gray-500 leading-relaxed whitespace-pre-wrap">${appSettings.merchant_terms || 'Vouchers are non-refundable but can be rescheduled up to 24 hours before the reservation date. Please present the QR code sent to your WhatsApp number at the main entrance gate.'}</p>
          </div>
          <div>
            <h4 class="text-xs font-bold uppercase tracking-wider text-gray-600 mb-2">Payment Instructions</h4>
            <p class="text-xs text-gray-500 leading-relaxed whitespace-pre-wrap">${inv.payment_instructions || appSettings.merchant_payment_instructions || 'Please complete bank transfer to complete booking.'}</p>
          </div>
        </div>

        <!-- BOTTOM BAR -->
        <div class="inv-bottom-bar bg-gray-50 text-center border-t border-gray-100 mt-8 -mx-8 -mb-8 md:-mx-10 md:-mb-10 py-4 px-6 rounded-b-xl">
          <p class="text-sm text-gray-400">Thank you for visiting <strong class="text-gray-600">${appSettings.merchant_name || 'Batur Natural Hot Spring'}</strong> — We look forward to welcoming you!</p>
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
    const deleteBtn = document.getElementById('modal-delete-btn');
    if (deleteBtn) deleteBtn.classList.add('hidden');
    const pdfBtn = document.getElementById('modal-download-pdf-btn');
    if (pdfBtn) {
      pdfBtn.classList.remove('hidden');
      pdfBtn.onclick = () => downloadVoucherPDF(allCodes.join(','));
    }

    const safeName = validVouchers[0].customer_name.replace(/[^a-zA-Z0-9- ]/g, '_').trim();
    const firstCode = validVouchers[0].voucher_code;
    const isMultiple = validVouchers.length > 1;
    const safeBranding = (appSettings.merchant_name || 'Voucher').replace(/[^a-zA-Z0-9- ]/g, '_').replace(/\s+/g, '_').trim();
    window.currentPrintTitle = isMultiple ? `${safeBranding}_Voucher_Multiple_${firstCode}_${safeName}` : `${safeBranding}_Voucher_${firstCode}_${safeName}`;

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

    // Flat map vouchers to render a card for each item (ticket type) in the invoice
    const itemsToRender = [];
    validVouchers.forEach(invoice => {
      const items = invoice.items || [];
      items.forEach((item, index) => {
        // If the voucher was loaded via a code with a suffix (e.g. VCH-xxx-1), only render that item
        if (invoice.voucher_code.split('-').length > 3) {
          itemsToRender.push({
            invoice,
            item,
            itemVoucherCode: invoice.voucher_code,
            isRedeemed: invoice.redeemed
          });
        } else {
          // It's the main invoice code, generate suffixes for all items
          const itemVoucherCode = `${invoice.voucher_code}-${index + 1}`;
          itemsToRender.push({
            invoice,
            item,
            itemVoucherCode: itemVoucherCode,
            isRedeemed: (invoice.redeemed_items || []).includes(itemVoucherCode) || invoice.redeemed
          });
        }
      });
    });

    itemsToRender.forEach(renderItem => {
      const data = renderItem.invoice;
      const item = renderItem.item;
      const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&color=002114&data=${encodeURIComponent(renderItem.itemVoucherCode)}`;
      const visitLabel = data.visit_date || new Date(data.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      const isRedeemed = renderItem.isRedeemed;
      const statusBadge = isRedeemed ? 'REDEEMED' : 'PAID / VALID';
      const badgeClass = isRedeemed ? 'badge-redeemed' : 'badge-paid';
      const merchantName = appSettings.merchant_name || 'Batur Hot Spring';
      const logoUrl = appSettings.merchant_logo_url || '';
      const website = appSettings.merchant_website || '';
      const bgImg = getVoucherBgImage(renderItem.itemVoucherCode);

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
              <div class="space-y-1 mb-2">
                <div class="text-lg font-extrabold text-on-surface leading-tight">${item.ticket_title} <span class="text-primary">(x${item.quantity})</span></div>
              </div>
              <div class="text-sm font-semibold text-on-surface-variant mt-2">${data.customer_name}</div>
              ${data.agent_name ? `<div class="text-[10px] uppercase tracking-wider text-primary font-bold mt-1">Agent: ${data.agent_name}</div>` : ''}
            </div>
            <!-- Visit date banner -->
            <div class="mx-5 mb-4 py-3 px-4 rounded-xl flex items-center justify-between" style="background:linear-gradient(135deg,#1a3d2b,#2d6a4f)">
              <div>
                <div class="text-[10px] uppercase tracking-widest text-emerald-300 font-bold">Visit Date</div>
                <div class="text-white font-extrabold text-sm mt-0.5">${visitLabel}</div>
              </div>
              <span class="material-symbols-outlined text-emerald-300" style="font-size:28px;font-variation-settings:'FILL' 1">calendar_month</span>
            </div>
            <!-- Small QR -->
            <div class="flex flex-col items-center pb-5 px-6">
              <div class="bg-white rounded-xl border border-outline-variant p-2 shadow-sm mb-3">
                <img src="${qrCodeUrl}" alt="QR" class="w-[120px] h-[120px] object-contain">
              </div>
              <div class="font-mono text-xs text-on-surface-variant tracking-wider">${renderItem.itemVoucherCode}</div>
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
              <div class="flex items-center gap-3 px-5 pt-5 pb-3 border-b border-dashed border-emerald-200">
                <div class="text-[9px] uppercase tracking-widest text-emerald-600 font-bold mb-1">Ticket Type</div>
                <div class="space-y-1">
                  <div class="text-base font-extrabold text-gray-900 leading-tight">${item.ticket_title} <span class="text-emerald-700 font-black">(x${item.quantity})</span></div>
                </div>
              </div>
              <!-- Row 3: 3-col info -->
              <div class="grid grid-cols-3 border-b border-dashed border-emerald-200">
                <div class="px-4 py-3 border-r border-dashed border-emerald-200">
                  <div class="text-[9px] uppercase tracking-widest text-emerald-600 font-bold mb-1">Name</div>
                  <div class="text-sm font-extrabold text-gray-900 leading-tight">${data.customer_name}</div>
                  ${data.agent_name ? `<div class="text-[8px] uppercase tracking-wider text-emerald-700 font-bold mt-1">Agent: ${data.agent_name}</div>` : ''}
                </div>
                <div class="px-4 py-3 border-r border-dashed border-emerald-200 flex flex-col items-center justify-center">
                  <div class="text-[9px] uppercase tracking-widest text-emerald-600 font-bold mb-1">Total Pax</div>
                  <div class="text-2xl font-black text-emerald-700">${item.quantity}</div>
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
                  <div class="text-[9px] uppercase tracking-[3px] text-emerald-300 font-bold mb-2">📅 Visit Date</div>
                  <div class="text-white font-black text-xl leading-tight">${visitLabel}</div>
                  <div class="mt-3 font-mono text-emerald-300 text-[10px] tracking-wider">${renderItem.itemVoucherCode}</div>
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
              <div class="text-[9px] uppercase tracking-[3px] text-emerald-500 font-bold mb-2">Ticket Type</div>
              <div class="space-y-1">
                <div class="text-base font-extrabold text-white leading-tight">${item.ticket_title} <span style="color:#52b788">(x${item.quantity})</span></div>
              </div>
            </div>
            <!-- Name + Pax -->
            <div class="px-5 pb-4 flex items-end gap-4">
              <div class="flex-1">
                <div class="text-[9px] uppercase tracking-widest text-emerald-500 font-bold mb-1">Customer Name</div>
                <div class="text-base font-extrabold text-white">${data.customer_name}</div>
                ${data.agent_name ? `<div class="text-[9px] uppercase tracking-wider text-emerald-400 font-bold mt-0.5">Agent: ${data.agent_name}</div>` : ''}
              </div>
              <div class="text-right">
                <div class="text-[9px] uppercase tracking-widest text-emerald-500 font-bold mb-1">Total Pax</div>
                <div class="text-3xl font-black leading-none" style="color:#52b788">${item.quantity}<span class="text-sm ml-0.5 text-emerald-400">pax</span></div>
              </div>
            </div>
            <!-- Date Banner -->
            <div class="mx-4 mb-4 rounded-xl px-4 py-3 flex items-center gap-3" style="background:#1a3d2b;border:1px solid #2d6a4f">
              <span class="material-symbols-outlined" style="color:#52b788;font-size:32px;font-variation-settings:'FILL' 1">event_available</span>
              <div>
                <div class="text-[8px] uppercase tracking-widest text-emerald-500 font-bold">Visit Date</div>
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
                <div class="font-mono text-emerald-200 text-[11px] tracking-wider break-all">${renderItem.itemVoucherCode}</div>
                <div class="mt-2 text-[8px] uppercase tracking-[2px] text-emerald-600 font-semibold">Scan at Main Gate (North)</div>
              </div>
            </div>
            <!-- Footer -->
            <div class="border-t border-color:#1f3329 px-5 py-2.5 flex items-center justify-between" style="border-color:#1f3329">
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
  const originalTitle = document.title;
  if (window.currentPrintTitle) {
    document.title = window.currentPrintTitle;
  }
  window.print();
  document.title = originalTitle;
}

// PDF Download function - generates PDF from voucher HTML using html2pdf.js
async function downloadVoucherPDF(codes) {
  if (!codes || codes.length === 0) {
    showToast('No voucher code provided for PDF download', true);
    return;
  }

  const codeArray = typeof codes === 'string' ? codes.split(',') : codes;
  const codesToProcess = codeArray.map(c => c.trim()).filter(Boolean);
  
  if (codesToProcess.length === 0) {
    showToast('Invalid voucher codes', true);
    return;
  }

  try {
    showToast('Preparing PDF...');
    
    // Fetch all voucher data
    const vouchersList = await Promise.all(
      codesToProcess.map(async (c) => {
        const res = await fetch(`/api/vouchers/${c}`);
        return res.ok ? res.json() : null;
      })
    );
    let validVouchers = vouchersList.filter(Boolean);
    
    if (validVouchers.length === 0) throw new Error('Vouchers not found');

    // Auto-detect siblings if only 1 code
    if (codesToProcess.length === 1) {
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
    
    // Build ticket items
    const itemsToRender = [];
    validVouchers.forEach(invoice => {
      const items = invoice.items || [];
      items.forEach((item, index) => {
        if (invoice.voucher_code.split('-').length > 3) {
          itemsToRender.push({
            invoice,
            item,
            itemVoucherCode: invoice.voucher_code,
            isRedeemed: invoice.redeemed
          });
        } else {
          const itemVoucherCode = `${invoice.voucher_code}-${index + 1}`;
          itemsToRender.push({
            invoice,
            item,
            itemVoucherCode,
            isRedeemed: (invoice.redeemed_items || []).includes(itemVoucherCode) || invoice.redeemed
          });
        }
      });
    });

    // Create temporary container for PDF generation
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '0';
    container.style.width = '420px';
    container.style.background = 'white';
    container.style.padding = '0';
    container.style.fontFamily = 'Inter, system-ui, sans-serif';
    document.body.appendChild(container);

    let ticketsHtml = '';
    const merchantName = appSettings.merchant_name || 'Batur Hot Spring';
    const logoUrl = appSettings.merchant_logo_url || '';
    const website = appSettings.merchant_website || '';

    itemsToRender.forEach(renderItem => {
      const data = renderItem.invoice;
      const item = renderItem.item;
      const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&color=002114&data=${encodeURIComponent(renderItem.itemVoucherCode)}`;
      const visitLabel = data.visit_date || new Date(data.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      const isRedeemed = renderItem.isRedeemed;
      const statusBadge = isRedeemed ? 'REDEEMED' : 'PAID / VALID';
      const badgeClass = isRedeemed ? 'badge-redeemed' : 'badge-paid';
      const bgImg = getVoucherBgImage(renderItem.itemVoucherCode);

      // Template 1: Classic
      if (activeVoucherTemplate === 1) {
        ticketsHtml += `
          <div class="relative z-10 w-full max-w-[380px] flex flex-col ticket-container shadow-[0px_10px_30px_rgba(0,33,20,0.15)] rounded-2xl bg-white border border-[#c6c6cd] overflow-hidden mb-8 last:mb-0 page-break-avoid" style="margin: 0 auto 32px auto;">
            <div class="px-5 py-6 flex flex-col items-center text-center relative overflow-hidden" style="background:#1a3d2b">
              <div class="absolute inset-0 bg-cover bg-center opacity-30" style="background-image:url('${bgImg}')"></div>
              <div class="relative z-10 flex flex-col items-center">
                ${logoUrl ? `<img src="${logoUrl}" alt="Logo" class="h-12 w-12 object-contain bg-white rounded-full p-1 mb-2 shadow">` : ''}
                <p class="text-[10px] uppercase tracking-[3px] text-emerald-300 font-bold mb-1">Official Admission Ticket</p>
                <h2 class="text-white font-extrabold text-lg tracking-tight">${merchantName}</h2>
              </div>
            </div>
            <div class="relative h-0 flex items-center justify-center">
              <div class="w-full border-t border-dashed border-[#c6c6cd]"></div>
              <div class="absolute -left-3 w-6 h-6 rounded-full bg-[#f8f9ff] border border-[#c6c6cd]"></div>
              <div class="absolute -right-3 w-6 h-6 rounded-full bg-[#f8f9ff] border border-[#c6c6cd]"></div>
            </div>
            <div class="px-6 pt-7 pb-3 text-center">
              <div class="space-y-1 mb-2">
                <div class="text-lg font-extrabold text-[#0b1c30] leading-tight">${item.ticket_title} <span class="text-[#000000]">(x${item.quantity})</span></div>
              </div>
              <div class="text-sm font-semibold text-[#45464d] mt-2">${data.customer_name}</div>
            </div>
            <div class="mx-5 mb-4 py-3 px-4 rounded-xl flex items-center justify-between" style="background:linear-gradient(135deg,#1a3d2b,#2d6a4f)">
              <div>
                <div class="text-[10px] uppercase tracking-widest text-emerald-300 font-bold">Visit Date</div>
                <div class="text-white font-extrabold text-sm mt-0.5">${visitLabel}</div>
              </div>
              <span class="material-symbols-outlined text-emerald-300" style="font-size:28px;font-variation-settings:'FILL' 1">calendar_month</span>
            </div>
            <div class="flex flex-col items-center pb-5 px-6">
              <div class="bg-white rounded-xl border border-[#c6c6cd] p-2 shadow-sm mb-3">
                <img src="${qrCodeUrl}" alt="QR" class="w-[120px] h-[120px] object-contain">
              </div>
              <div class="font-mono text-xs text-[#45464d] tracking-wider">${renderItem.itemVoucherCode}</div>
              <span class="mt-2 badge ${badgeClass} text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest">${statusBadge}</span>
            </div>
            <div class="border-t border-dashed border-[#c6c6cd] px-5 py-3 flex flex-col items-center gap-0.5 bg-[#eff4ff]">
              <p class="text-[9px] text-[#45464d] uppercase tracking-[2px] font-semibold">Non-transferable • Scan at Entrance</p>
              ${website ? `<p class="text-[9px] text-[#000000]/60 font-semibold">${website}</p>` : ''}
            </div>
          </div>
        `;
      } 
      // Template 2: Boarding Pass
      else if (activeVoucherTemplate === 2) {
        ticketsHtml += `
          <div class="relative z-10 w-full max-w-[420px] flex flex-col shadow-[0px_8px_32px_rgba(0,0,0,0.18)] rounded-2xl overflow-hidden mb-8 last:mb-0 page-break-avoid" style="background:#f0fdf4;margin:0 auto 32px auto;">
            <div class="h-2 w-full" style="background:linear-gradient(90deg,#1a3d2b,#40916c,#74c69d)"></div>
            <div class="flex flex-col p-0">
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
              <div class="px-5 py-4 border-b border-dashed border-emerald-200">
                <div class="text-[9px] uppercase tracking-widest text-emerald-600 font-bold mb-1">Ticket Type</div>
                <div class="space-y-1">
                  <div class="text-base font-extrabold text-gray-900 leading-tight">${item.ticket_title} <span class="text-emerald-700 font-black">(x${item.quantity})</span></div>
                </div>
              </div>
              <div class="grid grid-cols-3 border-b border-dashed border-emerald-200">
                <div class="px-4 py-3 border-r border-dashed border-emerald-200">
                  <div class="text-[9px] uppercase tracking-widest text-emerald-600 font-bold mb-1">Name</div>
                  <div class="text-sm font-extrabold text-gray-900 leading-tight">${data.customer_name}</div>
                </div>
                <div class="px-4 py-3 border-r border-dashed border-emerald-200 flex flex-col items-center justify-center">
                  <div class="text-[9px] uppercase tracking-widest text-emerald-600 font-bold mb-1">Total Pax</div>
                  <div class="text-2xl font-black text-emerald-700">${item.quantity}</div>
                </div>
                <div class="px-4 py-3">
                  <div class="text-[9px] uppercase tracking-widest text-emerald-600 font-bold mb-1">Gate</div>
                  <div class="text-sm font-extrabold text-gray-900">Main Gate</div>
                  <div class="text-[10px] text-emerald-600">(North)</div>
                </div>
              </div>
              <div class="flex items-stretch">
                <div class="flex-1 px-5 py-5" style="background:linear-gradient(135deg,#1a3d2b 0%,#2d6a4f 100%)">
                  <div class="text-[9px] uppercase tracking-[3px] text-emerald-300 font-bold mb-2">📅 Visit Date</div>
                  <div class="text-white font-black text-xl leading-tight">${visitLabel}</div>
                  <div class="mt-3 font-mono text-emerald-300 text-[10px] tracking-wider">${renderItem.itemVoucherCode}</div>
                </div>
                <div class="flex flex-col items-center justify-center px-4 py-4 border-l border-dashed border-emerald-200 bg-white">
                  <img src="${qrCodeUrl}" alt="QR" class="w-[100px] h-[100px] object-contain">
                  <div class="text-[8px] text-gray-400 mt-1 uppercase tracking-wider">Scan QR</div>
                </div>
              </div>
            </div>
            <div class="h-1.5 w-full" style="background:linear-gradient(90deg,#74c69d,#40916c,#1a3d2b)"></div>
          </div>
        `;
      } 
      // Template 3: Minimal
      else {
        ticketsHtml += `
          <div class="relative z-10 w-full max-w-[360px] shadow-[0px_12px_40px_rgba(0,0,0,0.35)] rounded-2xl overflow-hidden mb-8 last:mb-0 page-break-avoid" style="background:#0f1f17;margin:0 auto 32px auto;">
            <div class="h-1 w-full" style="background:linear-gradient(90deg,#52b788,#95d5b2,#52b788)"></div>
            <div class="flex items-center gap-3 px-5 pt-5 pb-4 border-b" style="border-color:#1f3329">
              ${logoUrl ? `<img src="${logoUrl}" alt="Logo" class="h-9 w-9 object-contain bg-white/10 rounded-full p-1">` : ''}
              <div class="flex-1">
                <div class="text-[8px] uppercase tracking-[3px] text-emerald-400 font-bold">${merchantName}</div>
                <div class="text-[10px] text-emerald-200 font-semibold">Admission Ticket</div>
              </div>
              <span class="badge ${badgeClass} text-[9px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider">${statusBadge}</span>
            </div>
            <div class="px-5 pt-5 pb-2">
              <div class="text-[9px] uppercase tracking-[3px] text-emerald-500 font-bold mb-2">Ticket Type</div>
              <div class="space-y-1">
                <div class="text-base font-extrabold text-white leading-tight">${item.ticket_title} <span style="color:#52b788">(x${item.quantity})</span></div>
              </div>
            </div>
            <div class="px-5 pb-4 flex items-end gap-4">
              <div class="flex-1">
                <div class="text-[9px] uppercase tracking-widest text-emerald-500 font-bold mb-1">Customer Name</div>
                <div class="text-base font-extrabold text-white">${data.customer_name}</div>
              </div>
              <div class="text-right">
                <div class="text-[9px] uppercase tracking-widest text-emerald-500 font-bold mb-1">Total Pax</div>
                <div class="text-3xl font-black leading-none" style="color:#52b788">${item.quantity}<span class="text-sm ml-0.5 text-emerald-400">pax</span></div>
              </div>
            </div>
            <div class="mx-4 mb-4 rounded-xl px-4 py-3 flex items-center gap-3" style="background:#1a3d2b;border:1px solid #2d6a4f">
              <span class="material-symbols-outlined" style="color:#52b788;font-size:32px;font-variation-settings:'FILL' 1">event_available</span>
              <div>
                <div class="text-[8px] uppercase tracking-widest text-emerald-500 font-bold">Visit Date</div>
                <div class="text-white font-extrabold text-sm">${visitLabel}</div>
              </div>
            </div>
            <div class="flex items-center gap-4 px-5 pb-5">
              <div class="bg-white rounded-lg p-1.5 shadow">
                <img src="${qrCodeUrl}" alt="QR" class="w-[90px] h-[90px] object-contain">
              </div>
              <div class="flex-1">
                <div class="text-[8px] uppercase tracking-[2px] text-emerald-500 font-bold mb-1">Voucher Code</div>
                <div class="font-mono text-emerald-200 text-[11px] tracking-wider break-all">${renderItem.itemVoucherCode}</div>
                <div class="mt-2 text-[8px] uppercase tracking-[2px] text-emerald-600 font-semibold">Scan at Main Gate (North)</div>
              </div>
            </div>
            <div class="border-t px-5 py-2.5 flex items-center justify-between" style="border-color:#1f3329">
              <p class="text-[8px] text-emerald-600 uppercase tracking-widest">Non-transferable</p>
              ${website ? `<p class="text-[8px] text-emerald-600 font-semibold">${website}</p>` : ''}
            </div>
          </div>
        `;
      }
    });

    container.innerHTML = `
      <div class="flex flex-col items-center justify-start p-4 md:p-6 relative overflow-auto bg-white min-h-full">
        <div class="relative z-10 w-full flex flex-col items-center">
          ${ticketsHtml}
        </div>
      </div>
    `;

    // Wait for Tailwind CDN to process the newly added classes
    await new Promise(resolve => setTimeout(resolve, 800));

    // Determine filename for PDF
    let finalFilename = `Voucher-${allCodes.join('-')}.pdf`;
    if (window.currentPrintTitle) {
      finalFilename = window.currentPrintTitle + '.pdf';
    }

    // Generate PDF
    const opt = {
      margin: 0,
      filename: finalFilename,
      image: { type: 'jpeg', quality: 1.0 },
      html2canvas: { scale: 2, useCORS: true, letterRendering: true, logging: false },
      jsPDF: { unit: 'pt', format: 'a4', orientation: 'portrait' }
    };

    await html2pdf().set(opt).from(container).save();
    
    // Clean up
    document.body.removeChild(container);
    showToast('PDF downloaded successfully!');
    
  } catch (err) {
    console.error('PDF generation error:', err);
    showToast('Failed to generate PDF: ' + err.message, true);
    // Try to clean up
    const tempContainer = document.querySelector('div[style*="left: -9999px"]');
    if (tempContainer) document.body.removeChild(tempContainer);
  }
}

// Helper to format number input value with thousands dots
function formatNumberInput(input) {
  let val = input.value.replace(/\D/g, '');
  if (!val) {
    input.value = '';
    return;
  }
  input.value = parseInt(val).toLocaleString('id-ID');
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
    const items = data.items || [];
    const ticketDesc = items.map(i => `${i.ticket_title} (x${i.quantity})`).join(', ');
    const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);

    document.getElementById('val-customer').innerText = data.customer_name;
    document.getElementById('val-ticket').innerText = ticketDesc;
    document.getElementById('val-qty').innerText = `${totalQty} Person(s)`;
    
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
  if (!confirm('Are you sure you want to disconnect and log out the WhatsApp Bot?')) return;
  try {
    showLoading(true, 'Disconnecting...', 'Logging out WhatsApp session...');
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
  } finally {
    showLoading(false);
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
      container.innerHTML = '<p class="text-secondary text-center text-xs py-8">No chat activities yet.</p>';
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
          <span class="font-bold text-[10px] block text-secondary uppercase">Incoming Message:</span>
          <p class="mt-0.5">${log.message}</p>
        </div>
        <div class="bg-primary-container/10 p-2 rounded text-primary border-l-2 border-primary">
          <span class="font-bold text-[10px] block text-primary uppercase">Auto Reply:</span>
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
        <button class="p-1.5 text-secondary hover:bg-secondary/10 rounded-lg transition-all" onclick="editStorePM(${pm.id})" title="Edit"><span class="material-symbols-outlined text-[18px]">edit</span></button>
        <button class="p-1.5 text-error hover:bg-error/10 rounded-lg transition-all" onclick="deleteStorePM(${pm.id})" title="Hapus"><span class="material-symbols-outlined text-[18px]">delete</span></button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function resetStorePMForm() {
  document.getElementById('store-pm-edit-id').value = '';
  document.getElementById('store-pm-name').value = '';
  document.getElementById('store-pm-instructions').value = '';
  document.getElementById('store-pm-status').value = '1';
  document.getElementById('store-pm-form-title').innerText = 'Tambah Metode Pembayaran';
  const cancelBtn = document.getElementById('btn-store-cancel-pm-edit');
  if (cancelBtn) cancelBtn.classList.add('hidden');
}

function editStorePM(id) {
  const pm = paymentMethods.find(p => p.id === id);
  if (!pm) return;

  document.getElementById('store-pm-edit-id').value = pm.id;
  document.getElementById('store-pm-name').value = pm.name;
  document.getElementById('store-pm-instructions').value = pm.instructions || '';
  document.getElementById('store-pm-status').value = pm.is_active ? '1' : '0';
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

async function backupDatabase() {
  try {
    showLoading(true, 'Backing up...', 'Preparing database copy...');
    const response = await fetch('/api/admin/database/backup', {
      headers: { 'Authorization': token }
    });
    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || 'Failed to download backup');
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const timestamp = new Date().toISOString().slice(0, 10);
    a.download = `backup_database_${timestamp}.sqlite`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    showToast('Backup downloaded successfully!');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    showLoading(false);
  }
}

async function resetDatabase() {
  const confirmed = confirm('CRITICAL WARNING!\n\nThis action will delete ALL invoice, ticket redemption, and WhatsApp log data.\n\nAre you sure you want to proceed?');
  if (!confirmed) return;
  
  const doubleConfirmed = prompt('Type "RESET" to confirm this action:');
  if (doubleConfirmed !== 'RESET') {
    showToast('Reset cancelled.', true);
    return;
  }

  try {
    showLoading(true, 'Resetting...', 'Wiping database data...');
    const response = await fetch('/api/admin/database/reset', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token
      }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Reset failed');
    showToast('Database wiped successfully!');
    setTimeout(() => window.location.reload(), 1500);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    showLoading(false);
  }
}

async function handleRestoreFileSelected(input) {
  const file = input.files[0];
  if (!file) return;

  const confirmed = confirm(`Are you sure you want to restore the database using "${file.name}"?\n\nThe current database will be completely overwritten.`);
  if (!confirmed) {
    input.value = '';
    return;
  }

  const formData = new FormData();
  formData.append('backup', file);

  try {
    showLoading(true, 'Restoring...', 'Uploading and applying database backup...');
    const response = await fetch('/api/admin/database/restore', {
      method: 'POST',
      headers: {
        'Authorization': token
      },
      body: formData
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Restore failed');
    showToast('Database restored successfully!');
    setTimeout(() => window.location.reload(), 1500);
  } catch (err) {
    showToast(err.message, true);
    input.value = '';
  } finally {
    showLoading(false);
  }
}

// Down Payment: Show Add Payment Modal
function showAddPaymentModal(invoiceId, remaining) {
  const modal = document.getElementById('add-payment-modal');
  if (modal) {
    document.getElementById('add-payment-invoice-id').value = invoiceId;
    document.getElementById('add-payment-remaining').innerText = `Rp ${remaining.toLocaleString('id-ID')}`;
    document.getElementById('add-payment-amount').value = '';
    modal.classList.remove('hidden');
  } else {
    // Fallback: prompt
    addPaymentToInvoice(invoiceId);
  }
}

function closeAddPaymentModal() {
  const modal = document.getElementById('add-payment-modal');
  if (modal) modal.classList.add('hidden');
}

async function submitAddPayment() {
  const invoiceId = document.getElementById('add-payment-invoice-id').value;
  const rawAmount = (document.getElementById('add-payment-amount').value || '').replace(/\./g, '');
  const amount = parseFloat(rawAmount) || 0;
  if (amount <= 0) { showToast('Masukkan nominal pembayaran!', true); return; }

  try {
    showLoading(true, 'Processing...', 'Recording payment...');
    const response = await fetch(`/api/invoices/${invoiceId}/add-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': token },
      body: JSON.stringify({ amount })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to add payment');

    showToast(data.message);
    closeAddPaymentModal();
    await loadInvoices();
    if (currentTab === 'orders') renderOrdersTable();
    if (currentTab === 'invoices') renderInvoicesTable();
    if (currentTab === 'dashboard') renderDashboardStats();
    openInvoiceDetails(parseInt(invoiceId));
  } catch (err) {
    showToast(err.message, true);
  } finally {
    showLoading(false);
  }
}

// Fallback prompt-based add payment
async function addPaymentToInvoice(invoiceId) {
  const input = prompt('Masukkan nominal pembayaran (Rp):');
  if (!input) return;
  const amount = parseFloat(input.replace(/\./g, '')) || 0;
  if (amount <= 0) { showToast('Nominal tidak valid!', true); return; }

  try {
    showLoading(true, 'Processing...', 'Recording payment...');
    const response = await fetch(`/api/invoices/${invoiceId}/add-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': token },
      body: JSON.stringify({ amount })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to add payment');

    showToast(data.message);
    await loadInvoices();
    if (currentTab === 'orders') renderOrdersTable();
    if (currentTab === 'invoices') renderInvoicesTable();
    if (currentTab === 'dashboard') renderDashboardStats();
    openInvoiceDetails(invoiceId);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    showLoading(false);
  }
}

// Delete Invoice logic
async function deleteInvoice(invoiceId) {
  const confirmed = confirm(`Apakah Anda yakin ingin menghapus Invoice #${invoiceId}? Tindakan ini permanen.`);
  if (!confirmed) return;

  try {
    showLoading(true, 'Deleting...', 'Removing invoice...');
    const response = await fetch(`/api/invoices/${invoiceId}`, {
      method: 'DELETE',
      headers: { 'Authorization': token }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to delete invoice');

    showToast('Invoice deleted successfully!');
    await loadInvoices();
    if (currentTab === 'orders') renderOrdersTable();
    if (currentTab === 'invoices') renderInvoicesTable();
    if (currentTab === 'dashboard') renderDashboardStats();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    showLoading(false);
  }
}

async function deleteInvoiceFromModal(invoiceId) {
  const confirmed = confirm(`Apakah Anda yakin ingin menghapus Invoice #${invoiceId}? Tindakan ini akan menutup detail modal.`);
  if (!confirmed) return;

  try {
    showLoading(true, 'Deleting...', 'Removing invoice...');
    const response = await fetch(`/api/invoices/${invoiceId}`, {
      method: 'DELETE',
      headers: { 'Authorization': token }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to delete invoice');

    showToast('Invoice deleted successfully!');
    closeModal();
    await loadInvoices();
    if (currentTab === 'orders') renderOrdersTable();
    if (currentTab === 'invoices') renderInvoicesTable();
    if (currentTab === 'dashboard') renderDashboardStats();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    showLoading(false);
  }
}

// Helpdesk Variables
let helpdeskChats = [];
let activeChatPhone = null;
let helpdeskPollInterval = null;

// Fetch Helpdesk Chats List
async function loadHelpdeskChats(silent = false) {
  try {
    const res = await fetch('/api/helpdesk/chats', {
      headers: { 'Authorization': token }
    });
    if (!res.ok) return;
    helpdeskChats = await res.json();
    renderHelpdeskChatsList();
  } catch (err) {
    console.error('Failed to load helpdesk chats:', err);
  }
}

// Render Left Panel Chat List
function renderHelpdeskChatsList() {
  const container = document.getElementById('helpdesk-chat-list');
  if (!container) return;

  const searchQuery = document.getElementById('helpdesk-chat-search')?.value.toLowerCase() || '';
  const filtered = helpdeskChats.filter(chat => 
    chat.phone.toLowerCase().includes(searchQuery) || 
    (chat.name && chat.name.toLowerCase().includes(searchQuery)) ||
    (chat.ticket_subject && chat.ticket_subject.toLowerCase().includes(searchQuery))
  );

  if (filtered.length === 0) {
    container.innerHTML = '<p class="text-xs text-on-surface-variant text-center py-8">No chats found.</p>';
    return;
  }

  container.innerHTML = filtered.map(chat => {
    const isActive = activeChatPhone === chat.phone;
    const displayName = chat.name || `WhatsApp User (${chat.phone})`;
    const lastMsgText = chat.last_message || chat.last_reply || 'No messages yet';
    const timestampStr = chat.last_activity ? new Date(chat.last_activity).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';
    
    // Mode badge
    const isBot = chat.bot_mode === 'bot';
    const botBadgeClass = isBot ? 'bg-primary/10 text-primary' : 'bg-secondary/10 text-secondary';
    const botBadgeText = isBot ? 'Bot' : 'Manual';

    // Status badge
    const isOpen = chat.ticket_status === 'open';
    const statusBadgeClass = isOpen ? 'badge-unpaid' : 'badge-paid';
    const statusBadgeText = isOpen ? 'OPEN' : 'CLOSED';

    return `
      <div onclick="openHelpdeskChat('${chat.phone}')" class="p-4 cursor-pointer hover:bg-surface-container-high transition-colors ${isActive ? 'bg-surface-container-high border-r-4 border-primary' : ''}">
        <div class="flex justify-between items-start mb-1">
          <span class="font-bold text-xs text-on-surface truncate pr-2 max-w-[150px]">${displayName}</span>
          <span class="text-[10px] text-on-surface-variant whitespace-nowrap">${timestampStr}</span>
        </div>
        <div class="text-[11px] text-on-surface-variant truncate mb-2">${lastMsgText}</div>
        <div class="flex gap-1.5 items-center">
          <span class="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${botBadgeClass}">${botBadgeText}</span>
          <span class="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${statusBadgeClass}">${statusBadgeText}</span>
          ${chat.ticket_subject ? `<span class="text-[9px] text-on-surface-variant truncate max-w-[100px]" title="${chat.ticket_subject}">• ${chat.ticket_subject}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// Filter chats list on search input
window.filterHelpdeskChats = function() {
  renderHelpdeskChatsList();
};

// Open Specific Chat Details
window.openHelpdeskChat = async function(phone) {
  activeChatPhone = phone;
  
  // Hide empty state, show chat window
  document.getElementById('helpdesk-empty-state').classList.add('hidden');
  document.getElementById('helpdesk-chat-window').classList.remove('hidden');
  
  // Update header info
  document.getElementById('helpdesk-chat-phone').innerText = `+${phone}`;
  document.getElementById('helpdesk-chat-name').innerText = 'Loading...';
  
  // Highlighting active list item
  renderHelpdeskChatsList();

  await refreshActiveHelpdeskChat();
};

// Refresh Active Chat (called on open and during polling)
async function refreshActiveHelpdeskChat() {
  if (!activeChatPhone) return;

  try {
    const res = await fetch(`/api/helpdesk/chats/${activeChatPhone}`, {
      headers: { 'Authorization': token }
    });
    if (!res.ok) return;
    const data = await res.json();
    
    // Set customer name
    const displayName = data.session?.name || 'WhatsApp User';
    document.getElementById('helpdesk-chat-name').innerText = displayName;

    // Toggle Bot button state
    const botBtn = document.getElementById('helpdesk-toggle-bot-btn');
    const isBot = data.session?.bot_mode === 'bot';
    if (botBtn) {
      botBtn.innerText = isBot ? 'Auto (Bot)' : 'Manual (Agent)';
      botBtn.className = `badge cursor-pointer hover:opacity-80 transition-opacity ${isBot ? 'bg-primary text-on-primary' : 'bg-secondary text-on-secondary'}`;
    }

    // Toggle Ticket button state
    const ticketBtn = document.getElementById('helpdesk-toggle-ticket-btn');
    const isOpen = data.session?.ticket_status === 'open';
    if (ticketBtn) {
      ticketBtn.innerText = isOpen ? 'Open Ticket' : 'Closed';
      ticketBtn.className = `badge cursor-pointer hover:opacity-80 transition-opacity ${isOpen ? 'badge-unpaid' : 'badge-paid'}`;
    }

    // Render Conversation Logs
    const historyContainer = document.getElementById('helpdesk-chat-history');
    if (historyContainer) {
      if (data.logs.length === 0) {
        historyContainer.innerHTML = '<p class="text-xs text-on-surface-variant text-center py-8">No messages exchanged yet.</p>';
      } else {
        const atBottom = historyContainer.scrollHeight - historyContainer.scrollTop <= historyContainer.clientHeight + 40;
        
        historyContainer.innerHTML = data.logs.map(log => {
          const isIncoming = log.message && log.message.trim() !== '';
          const msgText = isIncoming ? log.message : log.reply;
          const bubbleClass = isIncoming 
            ? 'bg-surface-container-high text-on-surface self-start rounded-tl-none mr-12' 
            : 'bg-primary text-on-primary self-end rounded-tr-none ml-12';
            
          const timeStr = log.timestamp ? new Date(log.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';
          
          return `
            <div class="flex flex-col max-w-[85%] ${isIncoming ? 'self-start' : 'self-end'} space-y-1">
              <div class="px-4 py-2.5 rounded-2xl text-xs leading-relaxed ${bubbleClass}">
                ${msgText.replace(/\n/g, '<br>')}
              </div>
              <span class="text-[9px] text-on-surface-variant ${isIncoming ? 'self-start pl-1' : 'self-end pr-1'}">${timeStr}</span>
            </div>
          `;
        }).join('');

        // Auto scroll to bottom on new messages
        if (atBottom) {
          historyContainer.scrollTop = historyContainer.scrollHeight;
        }
      }
    }
  } catch (err) {
    console.error('Error refreshing helpdesk chat:', err);
  }
}

// Toggle Bot Mode (Auto vs Manual)
window.toggleChatbotMode = async function() {
  if (!activeChatPhone) return;
  
  const botBtn = document.getElementById('helpdesk-toggle-bot-btn');
  const isCurrentlyBot = botBtn.innerText.includes('Auto');
  const nextMode = isCurrentlyBot ? 'agent' : 'bot';
  
  try {
    const res = await fetch(`/api/helpdesk/sessions/${activeChatPhone}/toggle-bot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': token },
      body: JSON.stringify({ bot_mode: nextMode })
    });
    if (res.ok) {
      showToast(`Mode Chatbot diubah ke: ${nextMode.toUpperCase()}`);
      await refreshActiveHelpdeskChat();
      await loadHelpdeskChats(true);
    }
  } catch (err) {
    showToast('Failed to toggle bot mode', true);
  }
};

// Toggle Ticket Status (Open vs Closed)
window.toggleTicketStatus = async function() {
  if (!activeChatPhone) return;
  
  const ticketBtn = document.getElementById('helpdesk-toggle-ticket-btn');
  const isCurrentlyOpen = ticketBtn.innerText.includes('Open');
  const nextStatus = isCurrentlyOpen ? 'closed' : 'open';
  
  try {
    const res = await fetch(`/api/helpdesk/sessions/${activeChatPhone}/toggle-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': token },
      body: JSON.stringify({ ticket_status: nextStatus })
    });
    if (res.ok) {
      showToast(`Status Tiket diubah ke: ${nextStatus.toUpperCase()}`);
      await refreshActiveHelpdeskChat();
      await loadHelpdeskChats(true);
    }
  } catch (err) {
    showToast('Failed to toggle ticket status', true);
  }
};

// Send Reply Message
window.sendHelpdeskMessage = async function(event) {
  event.preventDefault();
  if (!activeChatPhone) return;

  const inputEl = document.getElementById('helpdesk-message-input');
  const text = inputEl?.value.trim();
  if (!text) return;

  try {
    const res = await fetch(`/api/helpdesk/sessions/${activeChatPhone}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': token },
      body: JSON.stringify({ text })
    });
    if (!res.ok) throw new Error('Failed to send message');
    
    if (inputEl) inputEl.value = '';
    await refreshActiveHelpdeskChat();
    
    // Scroll chat history to bottom
    const historyContainer = document.getElementById('helpdesk-chat-history');
    if (historyContainer) historyContainer.scrollTop = historyContainer.scrollHeight;
    
    await loadHelpdeskChats(true);
  } catch (err) {
    showToast(err.message, true);
  }
};

// Polling for helpdesk updates
function startHelpdeskPolling() {
  stopHelpdeskPolling();
  loadHelpdeskChats();
  helpdeskPollInterval = setInterval(() => {
    if (currentTab === 'helpdesk') {
      loadHelpdeskChats(true);
      if (activeChatPhone) {
        refreshActiveHelpdeskChat();
      }
    }
  }, 4000);
}

function stopHelpdeskPolling() {
  if (helpdeskPollInterval) {
    clearInterval(helpdeskPollInterval);
    helpdeskPollInterval = null;
  }
}
