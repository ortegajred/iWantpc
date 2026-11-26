'use strict';
/* iWant PC - one script shared by every page. Each page sets <body data-page="..."> and gets its own init below.
   PRODUCTS live in Supabase (table: products). Users, cart, orders and bookings still live in localStorage. */

/* ===== Supabase connection ===== */
const SUPABASE_URL = 'https://gvrtyixxtmsaryrphxhu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_uM3M9u329B9AjYI-K2eVrg_rQ90pObS';
const IMAGE_BUCKET = 'product-images';

/* Tiny PostgREST client (no library needed). path is relative to /rest/v1/ */
async function sb(path, { method = 'GET', body, prefer } = {}) {
    let res;
    try {
        res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
            method,
            headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
    } catch { throw new Error('Could not reach the database. Check your internet connection.'); }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) {
        let msg = (data && (data.message || data.error)) || res.statusText || 'Request failed';
        if (/duplicate key/i.test(msg)) msg = 'A product with this name already exists.';
        if (/relation .* does not exist|schema cache/i.test(msg)) msg = 'The products table was not found. Run supabase_setup.sql in the Supabase SQL Editor first.';
        throw new Error(msg);
    }
    return data;
}

async function uploadProductImage(blob, name) {
    const slug = String(name || 'product').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'product';
    const path = `${Date.now()}-${slug}.jpg`;
    let res;
    try {
        res = await fetch(`${SUPABASE_URL}/storage/v1/object/${IMAGE_BUCKET}/${path}`, {
            method: 'POST',
            headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': blob.type || 'image/jpeg', 'x-upsert': 'false' },
            body: blob
        });
    } catch { throw new Error('Image upload failed: could not reach Supabase Storage.'); }
    if (!res.ok) {
        let msg = res.statusText;
        try { const j = await res.json(); msg = j.message || j.error || msg; } catch { /* ignore */ }
        throw new Error('Image upload failed: ' + msg + '. Check the storage policies in supabase_setup.sql, or paste an image URL instead.');
    }
    return `${SUPABASE_URL}/storage/v1/object/public/${IMAGE_BUCKET}/${path}`;
}

/* ===== Constants & helpers ===== */
const KEY = {
    users: 'iwp_users', session: 'iwp_session', cart: 'iwp_cart', orders: 'iwp_orders', bookings: 'iwp_bookings',
    reports: 'iwp_reports', build: 'iwp_build', buildNote: 'iwp_build_note', prefill: 'iwp_booking_prefill'
};
const SHIPPING_FEE = 15;
const ASSEMBLY_FEE = 50;
const ASSEMBLY_ID = 'svc-assembly';
const CATEGORIES = {
    processors: 'Processors (CPU)',
    motherboards: 'Motherboards',
    memory: 'Memory (RAM)',
    'graphics-cards': 'Graphics cards (GPU)',
    'power-supplies': 'Power supplies (PSU)',
    storage: 'Storage',
    case: 'PC Cases',
    cooler: 'CPU Coolers',
    peripheral: 'Peripherals',
    other: 'Other components'
};
const ORDER_STATUS = {
    pending:   { label: 'Pending Payment', icon: 'fa-hourglass-half' },
    toship:    { label: 'To Ship',         icon: 'fa-clock' },
    toreceive: { label: 'Shipped Out',     icon: 'fa-truck' },
    completed: { label: 'Delivered',       icon: 'fa-check' }
};

/* Technical specs per category. The staff form and the PC builder both read this one definition.
   type: number | select | combo (text with suggestions). unit is appended on product chips. */
const SPEC_FIELDS = {
    processors: [
        { key: 'socket', label: 'Socket', type: 'combo', options: ['AM4', 'AM5', 'LGA1200', 'LGA1700', 'LGA1851'], required: true },
        { key: 'memory_type', label: 'Supported memory', type: 'select', options: ['DDR4', 'DDR5', 'DDR4/DDR5'], required: true },
        { key: 'tdp', label: 'TDP (W)', type: 'number', unit: 'W', required: true },
        { key: 'cores', label: 'Cores', type: 'number', unit: ' cores' },
        { key: 'threads', label: 'Threads', type: 'number', unit: ' threads' },
        { key: 'boost_clock_ghz', label: 'Boost clock (GHz)', type: 'number', step: 0.1, unit: 'GHz' }
    ],
    motherboards: [
        { key: 'socket', label: 'Socket', type: 'combo', options: ['AM4', 'AM5', 'LGA1200', 'LGA1700', 'LGA1851'], required: true },
        { key: 'memory_type', label: 'Memory type', type: 'select', options: ['DDR4', 'DDR5'], required: true },
        { key: 'form_factor', label: 'Form factor', type: 'select', options: ['ATX', 'Micro-ATX', 'Mini-ITX', 'E-ATX'] },
        { key: 'chipset', label: 'Chipset', type: 'combo', options: ['A620', 'B550', 'B650', 'X670E', 'B760', 'Z690', 'Z790', 'Z890'] },
        { key: 'memory_slots', label: 'Memory slots', type: 'number', unit: ' slots' },
        { key: 'tdp', label: 'Board power draw (W)', type: 'number', unit: 'W' }
    ],
    memory: [
        { key: 'memory_type', label: 'Memory type', type: 'select', options: ['DDR4', 'DDR5'], required: true },
        { key: 'capacity_gb', label: 'Total capacity (GB)', type: 'number', unit: 'GB', required: true },
        { key: 'speed_mhz', label: 'Speed (MHz)', type: 'number', unit: 'MHz', required: true },
        { key: 'modules', label: 'Number of sticks', type: 'number', unit: ' sticks' },
        { key: 'tdp', label: 'Power draw (W)', type: 'number', unit: 'W' }
    ],
    'graphics-cards': [
        { key: 'chipset', label: 'GPU chipset', type: 'combo', options: ['GeForce RTX 4060', 'GeForce RTX 4070', 'GeForce RTX 4080', 'Radeon RX 7600', 'Radeon RX 7800 XT'] },
        { key: 'vram_gb', label: 'VRAM (GB)', type: 'number', unit: 'GB' },
        { key: 'tdp', label: 'Board power / TDP (W)', type: 'number', unit: 'W', required: true },
        { key: 'recommended_psu', label: 'Recommended PSU (W)', type: 'number', unit: 'W PSU' },
        { key: 'length_mm', label: 'Card length (mm)', type: 'number', unit: 'mm' }
    ],
    'power-supplies': [
        { key: 'wattage', label: 'Wattage (W)', type: 'number', unit: 'W', required: true },
        { key: 'efficiency', label: 'Efficiency rating', type: 'combo', options: ['80+ White', '80+ Bronze', '80+ Silver', '80+ Gold', '80+ Platinum', '80+ Titanium'] },
        { key: 'modular', label: 'Cabling', type: 'select', options: ['Non-modular', 'Semi-modular', 'Fully modular'] },
        { key: 'form_factor', label: 'Form factor', type: 'select', options: ['ATX', 'SFX', 'SFX-L'] }
    ]
};

const $ = (sel, root = document) => root.querySelector(sel); const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const money = n => '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = prefix => prefix + Date.now().toString().slice(-6);
const sameId = (a, b) => String(a) === String(b);

function totals(items) {
    const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
    const shipping = items.length ? SHIPPING_FEE : 0;
    return { subtotal, shipping, total: subtotal + shipping };
}

/* Product image placeholder (shown until staff add a real image) */
function placeholder() {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#1e293b"/>' +
        '<g fill="none" stroke="#475569" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"><rect x="150" y="90" width="100" height="70" rx="8"/><path d="M175 190h50M200 160v30"/></g>' +
        '<text x="200" y="240" fill="#94a3b8" font-family="sans-serif" font-size="18" text-anchor="middle">No image yet</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
const productImg = p => (p && p.image) || placeholder();

function toast(message, type = 'ok') {
    let box = $('.toast-container');
    if (!box) { box = document.createElement('div'); box.className = 'toast-container'; document.body.append(box); }
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = `<i class="fa-solid ${type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check'}"></i><span>${message}</span>`;
    box.append(el);
    setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 300); }, type === 'error' ? 4500 : 2500);
}

/* Resize a picked image to a JPEG blob (max side 900px) before uploading */
function resizeToBlob(file, max = 900) {
    return new Promise((resolve, reject) => {
        const img = new Image(), url = URL.createObjectURL(file);
        img.onload = () => {
            const scale = Math.min(1, max / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('That image could not be processed.')), 'image/jpeg', 0.85);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image.')); };
        img.src = url;
    });
}

/* ===== Products (Supabase) ===== */
const normalizeProduct = r => ({
    ...r,
    price: Number(r.price) || 0,
    stock: Number(r.stock) || 0,
    description: r.description || '',
    image: r.image || '',
    specs: r.specs && typeof r.specs === 'object' && !Array.isArray(r.specs) ? r.specs : {}
});
const byCatTitle = (a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title);

const Products = {
    list: [],
    async load() {
        const rows = await sb('products?select=*&order=category.asc,title.asc');
        this.list = (rows || []).map(normalizeProduct);
        return this.list;
    },
    get(id) { return this.list.find(p => sameId(p.id, id)); },
    byTitle(title) { return this.list.find(p => p.title === title); },
    byCategory(cat) { return this.list.filter(p => p.category === cat); },
    async create(data) {
        const rows = await sb('products', { method: 'POST', body: data, prefer: 'return=representation' });
        if (!rows || !rows.length) throw new Error('The product was not created. Your database policies may block inserts.');
        const p = normalizeProduct(rows[0]);
        this.list.push(p); this.list.sort(byCatTitle);
        return p;
    },
    async update(id, changes) {
        const rows = await sb(`products?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: changes, prefer: 'return=representation' });
        if (!rows || !rows.length) throw new Error('The change was not saved. The product may have been deleted, or your database policies block edits.');
        const fresh = normalizeProduct(rows[0]), existing = this.get(id);
        if (existing) Object.assign(existing, fresh); else this.list.push(fresh);
        this.list.sort(byCatTitle);
        return this.get(id);
    },
    async remove(id) {
        const rows = await sb(`products?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', prefer: 'return=representation' });
        if (!rows || !rows.length) throw new Error('The product was not deleted. Your database policies may block deletes.');
        this.list = this.list.filter(p => !sameId(p.id, id));
    },
    /* direction -1 = take stock (checkout), +1 = give it back (cancel). Atomic on the server. */
    async adjustStock(lines, direction) {
        const items = lines.filter(i => !i.service && i.id !== null && i.id !== undefined).map(i => ({ id: i.id, qty: i.qty }));
        if (items.length) await sb('rpc/adjust_stock_bulk', { method: 'POST', body: { items, direction } });
    }
};

/* Spec helpers */
const specText = (f, v) => (v === undefined || v === null || v === '') ? '' : String(v) + (f.unit || '');
function specChips(p, max = 4) {
    return (SPEC_FIELDS[p.category] || []).map(f => specText(f, p.specs[f.key])).filter(Boolean).slice(0, max)
        .map(t => `<span class="chip">${esc(t)}</span>`).join('');
}

/* ===== PC-builder compatibility rules (pure functions) ===== */
const specOf = p => (p && p.specs) || {};
const memTypes = cpu => String(specOf(cpu).memory_type || '').split('/').map(s => s.trim()).filter(Boolean);
const OVERHEAD_W = 50;    /* fans, drives, USB, RGB, etc. */

/* sel = { processors, motherboards, memory, 'graphics-cards', 'power-supplies' } holding product objects */
function pairChecks(sel) {
    const cpu = sel.processors, mb = sel.motherboards, ram = sel.memory, out = [];
    if (cpu && mb && specOf(cpu).socket && specOf(mb).socket) {
        const a = specOf(cpu).socket, b = specOf(mb).socket;
        out.push(a === b
            ? { level: 'ok', text: `CPU and motherboard share the ${a} socket.` }
            : { level: 'error', who: ['processors', 'motherboards'], reason: `socket ${a} vs ${b}`, text: `Socket mismatch: the CPU is ${a} but the motherboard is ${b}.` });
    }
    if (mb && ram && specOf(mb).memory_type && specOf(ram).memory_type) {
        const a = specOf(mb).memory_type, b = specOf(ram).memory_type;
        out.push(a === b
            ? { level: 'ok', text: `Memory is ${b}, which the motherboard supports.` }
            : { level: 'error', who: ['motherboards', 'memory'], reason: `${a} board vs ${b} RAM`, text: `Memory mismatch: the motherboard takes ${a} but the RAM is ${b}.` });
    }
    if (cpu && ram && memTypes(cpu).length && specOf(ram).memory_type && !memTypes(cpu).includes(specOf(ram).memory_type)) {
        out.push({ level: 'error', who: ['processors', 'memory'], reason: `CPU needs ${memTypes(cpu).join('/')}`, text: `This CPU supports ${memTypes(cpu).join('/')} memory, not ${specOf(ram).memory_type}.` });
    }
    if (cpu && mb && memTypes(cpu).length && specOf(mb).memory_type && !memTypes(cpu).includes(specOf(mb).memory_type)) {
        out.push({ level: 'error', who: ['processors', 'motherboards'], reason: `CPU needs ${memTypes(cpu).join('/')}`, text: `This CPU supports ${memTypes(cpu).join('/')} memory, but the motherboard takes ${specOf(mb).memory_type}.` });
    }
    return out;
}

/* Why would product p (in category cat) clash with what is already picked? null = fine */
function incompatibility(cat, p, sel) {
    const hypo = { ...sel, [cat]: p };
    const bad = pairChecks(hypo).find(c => c.level === 'error' && c.who.includes(cat));
    return bad ? bad.reason : null;
}

function powerEstimate(sel) {
    const parts = ['processors', 'motherboards', 'memory', 'graphics-cards'].filter(c => sel[c]);
    if (!parts.length) return 0;
    return parts.reduce((n, c) => n + (Number(specOf(sel[c]).tdp) || 0), 0) + OVERHEAD_W;
}
function recommendedPsu(sel) {
    const est = powerEstimate(sel);
    if (!est) return 0;
    const byHeadroom = Math.ceil(est * 1.3 / 50) * 50;
    return Math.max(byHeadroom, Number(specOf(sel['graphics-cards']).recommended_psu) || 0);
}

function buildChecks(sel) {
    const out = pairChecks(sel);
    const est = powerEstimate(sel), rec = recommendedPsu(sel), psu = sel['power-supplies'];
    if (psu && est && specOf(psu).wattage) {
        const w = Number(specOf(psu).wattage);
        if (w < est) out.push({ level: 'error', text: `Power supply too small: this build draws about ${est}W but the PSU supplies ${w}W.` });
        else if (w < rec) out.push({ level: 'warn', text: `Power supply works but has little headroom. We recommend ${rec}W or more.` });
        else out.push({ level: 'ok', text: `${w}W power supply covers the estimated ${est}W draw with room to spare.` });
    } else if (est) {
        out.push({ level: 'info', text: `Recommended power supply: ${rec}W or more.` });
    }
    const missing = Object.keys(CATEGORIES).filter(c => !sel[c]).map(c => CATEGORIES[c].toLowerCase());
    if (Object.keys(sel).some(c => sel[c]) && missing.length) out.push({ level: 'info', text: `Still to choose: ${missing.join(', ')}.` });
    return out;
}

/* ===== Seed data (first run only: users, orders, bookings) ===== */
const person = o => ({ phone: '', address: '', city: '', zip: '', active: true, ...o });

const SEED_USERS = [
    person({ id: 'USR-001', name: 'Edgardo Ortega', username: 'edgardo', email: 'edgardo@example.com', password: 'admin123', role: 'admin' }),
    person({ id: 'USR-002', name: 'Staff Mark', username: 'staffmark', email: 'mark.staff@iwantpc.com', password: 'staff123', role: 'staff' }),
    person({ id: 'USR-003', name: 'Alex Johnson', username: 'alexjohnson', email: 'alex.j@example.com', password: 'user123', role: 'customer', phone: '+63 912 345 6789', address: '123 Tech Street, Barangay San Isidro', city: 'Valenzuela City', zip: '1440' })
];

function seedOrder(id, status, lines, receiveDate) {
    const items = lines.map(([title, price, qty]) => ({ id: null, title, price, qty }));
    return { id, email: 'alex.j@example.com', customer: 'Alex Johnson', items, total: totals(items).total, status, payment: 'cod', note: '', placed: '2026-10-10', receiveDate, proof: '' };
}
const SEED_ORDERS = [
    seedOrder('ORD-2026-9041', 'toreceive', [['NVIDIA RTX 4070 OC Edition', 649, 1]], '2026-10-25'),
    seedOrder('ORD-2026-9042', 'toship', [['Corsair Vengeance RGB 32GB DDR5', 119.99, 1]], '2026-10-26'),
    seedOrder('ORD-2026-8810', 'completed', [['AMD Ryzen 7 7800X3D', 399, 1]], '2026-10-05'),
    seedOrder('ORD-2026-9100', 'pending', [['Corsair RM850x Shift 850W PSU', 139.99, 1]], '')
];
const SEED_BOOKINGS = [
    { id: 'SRV-5012', customer: 'Michael Tan', email: '', device: 'AMD Ryzen 5 Processor', type: 'Warranty Claim (Bent Pins)', details: '', status: 'Under Review' }
];

[[KEY.users, SEED_USERS], [KEY.orders, SEED_ORDERS], [KEY.bookings, SEED_BOOKINGS], [KEY.reports, 0]]
    .forEach(([key, value]) => { if (localStorage.getItem(key) === null) write(key, value); });
localStorage.removeItem('iwp_products');   /* products moved to Supabase */

/* ===== Session & access control ===== */
const homeFor = role => ({ admin: 'admin.html', staff: 'staff.html' }[role] || 'home.html');
function currentUser() {
    const s = read(KEY.session, null);
    return (s && read(KEY.users, []).find(u => u.email === s.email && u.active)) || null;
}
function guard(roles) {
    const user = currentUser();
    if (!user || (roles && !roles.includes(user.role))) { location.replace(user ? homeFor(user.role) : 'login.html'); return null; }
    return user;
}
function formMessage(text, ok = false) {
    const el = $('#formMsg');
    el.textContent = text;
    el.classList.toggle('ok', ok);
}

/* ===== Cart ===== */
const getCart = () => read(KEY.cart, []);
const saveCart = cart => {
    write(KEY.cart, cart);
    if (typeof AUTH_USER !== 'undefined' && AUTH_USER) {
        syncCartToDatabase(cart).catch(err => console.warn('Cart sync failed:', err.message));
    }
};
function addToCart(id, qty = 1) {
    const product = Products.get(id);
    const cart = getCart(), line = cart.find(i => sameId(i.id, id));
    if (!product || (line ? line.qty : 0) + qty > product.stock) { toast('Not enough stock for this item.', 'error'); return null; }
    if (line) line.qty += qty; else cart.push({ id: product.id, title: product.title, price: product.price, qty });
    saveCart(cart);
    return product;
}

/* Navbar + cart drawer + account menu: shared by the home page and the PC builder */
function initShell(user) {
    const drawer = $('#cartDrawer'), overlay = $('#cartOverlay'), dropdown = $('#userDropdown');
    $('#userName').textContent = user.name;
    $('#userEmail').textContent = user.email;

    const renderCart = () => {
        const cart = getCart();
        $('#cartCount').textContent = cart.reduce((n, i) => n + i.qty, 0);
        $('#cartItems').innerHTML = cart.length ? cart.map(i => {
            const p = i.service ? null : (Products.get(i.id) || Products.byTitle(i.title));
            return `
            <div class="cart-item" data-id="${esc(i.id)}">
                <img class="cart-item-img" src="${productImg(p)}" alt="">
                <div class="cart-item-details">
                    <div class="cart-item-title">${esc(i.title)}</div>
                    <div class="cart-item-price">${money(i.price * i.qty)}</div>
                    ${i.service ? '<div class="stock">Service</div>' : `<div class="qty-controls">
                        <button class="qty-btn" data-qty="-1" aria-label="Decrease quantity">-</button>
                        <span>${i.qty}</span>
                        <button class="qty-btn" data-qty="1" aria-label="Increase quantity">+</button>
                    </div>`}
                </div>
                <button class="remove-item-btn" data-remove aria-label="Remove item"><i class="fa-solid fa-trash"></i></button>
            </div>`;
        }).join('') : '<p class="cart-empty">Your cart is empty.</p>';
        const t = totals(cart);
        $('#cartSubtotal').textContent = money(t.subtotal);
        $('#cartTotal').textContent = money(t.subtotal);
    };
    const toggleCart = open => { drawer.classList.toggle('open', open); overlay.classList.toggle('show', open); };

    $('#cartItems').addEventListener('click', e => {
        const row = e.target.closest('.cart-item');
        if (!row) return;
        const id = row.dataset.id, cart = getCart(), line = cart.find(i => sameId(i.id, id));
        if (!line) return;
        const step = e.target.closest('[data-qty]');
        if (e.target.closest('[data-remove]')) saveCart(cart.filter(i => i !== line));
        else if (step && +step.dataset.qty > 0) { if (!line.service) addToCart(id); }
        else if (step) { line.qty--; saveCart(cart.filter(i => i.qty > 0)); }
        renderCart();
    });
    $('#checkoutBtn').addEventListener('click', () => {
        if (!getCart().length) return toast('Your cart is empty.', 'error');
        location.href = 'checksumm.html';
    });
    $('#openCartBtn').addEventListener('click', () => toggleCart(true));
    $('#closeCartBtn').addEventListener('click', () => toggleCart(false));
    overlay.addEventListener('click', () => toggleCart(false));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { toggleCart(false); dropdown.classList.remove('show'); } });
    $('#userMenuBtn').addEventListener('click', e => { e.stopPropagation(); dropdown.classList.toggle('show'); });
    document.addEventListener('click', () => dropdown.classList.remove('show'));

    renderCart();
    return { renderCart, toggleCart };
}

const errorCard = (message, retry = true) =>
    `<div class="card empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>${esc(message)}</p>${retry ? '<button class="btn btn-primary" data-retry>Try again</button>' : ''}</div>`;

/* ===== Shared inventory manager (staff + admin) ===== */
function setupInventory(tbody, { canDelete = false, addButton = null } = {}) {
    const modal = $('#productModal'), form = $('#productForm'), specBox = $('#specFields');
    const filterCat = $('#inventoryCategory'), filterText = $('#inventorySearch');
    const preview = $('#imagePreview'), imageUrl = $('#imageUrl'), imageFile = $('#imageFile');
    const catSelect = form.elements.category, saveBtn = $('#saveProductBtn');
    const catOptions = Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    catSelect.innerHTML = catOptions;
    filterCat.innerHTML = '<option value="all">All categories</option>' + catOptions;

    let editing = null, pendingBlob = null, objectUrl = null;
    const COLS = 7;

    /* --- table --- */
    const rowHtml = p => `
        <tr data-id="${esc(p.id)}">
            <td><img class="thumb" src="${productImg(p)}" alt="${esc(p.title)}" loading="lazy"></td>
            <td><strong>${esc(p.title)}</strong><div class="sub">${esc(p.description)}</div></td>
            <td>${esc(CATEGORIES[p.category] || p.category)}</td>
            <td><div class="chips">${specChips(p) || '<span class="stock">No specs yet</span>'}</div></td>
            <td><input class="edit-input narrow" type="number" min="0" step="1" data-f="stock" value="${p.stock}" aria-label="Stock for ${esc(p.title)}"></td>
            <td><input class="edit-input narrow" type="number" min="0" step="0.01" data-f="price" value="${p.price.toFixed(2)}" aria-label="Price for ${esc(p.title)}"></td>
            <td class="actions">
                <button class="btn btn-sm btn-soft" data-edit><i class="fa-solid fa-pen"></i> Edit</button>
                ${canDelete ? '<button class="btn btn-sm btn-outline danger" data-delete aria-label="Delete product"><i class="fa-solid fa-trash"></i></button>' : ''}
            </td>
        </tr>`;
    const matches = p => (filterCat.value === 'all' || p.category === filterCat.value)
        && `${p.title} ${p.description} ${Object.values(p.specs).join(' ')}`.toLowerCase().includes(filterText.value.trim().toLowerCase());
    const render = () => {
        const list = Products.list.filter(matches);
        tbody.innerHTML = list.length ? list.map(rowHtml).join('')
            : `<tr><td colspan="${COLS}" class="table-empty">${Products.list.length ? 'No products match your filter.' : 'No products yet. Use the Add component button to create one.'}</td></tr>`;
    };
    const changed = () => document.dispatchEvent(new CustomEvent('inventory:changed'));
    const load = async () => {
        tbody.innerHTML = `<tr><td colspan="${COLS}" class="table-empty"><i class="fa-solid fa-spinner fa-spin"></i> Loading products...</td></tr>`;
        try { await Products.load(); render(); }
        catch (err) { tbody.innerHTML = `<tr><td colspan="${COLS}" class="table-empty">${esc(err.message)} <button class="btn btn-sm btn-soft" data-retry>Retry</button></td></tr>`; }
        changed();
    };

    /* --- dynamic spec fields --- */
    const specInput = (cat, f, value) => {
        const id = 'spec-' + f.key, req = f.required ? ' required' : '', val = value ?? '';
        let control;
        if (f.type === 'select') {
            const opts = (!val || f.options.includes(String(val))) ? f.options : [...f.options, String(val)];
            control = `<select id="${id}" data-spec="${f.key}"${req}><option value="">Select...</option>${opts.map(o => `<option${String(o) === String(val) ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
        } else if (f.type === 'combo') {
            control = `<input id="${id}" data-spec="${f.key}" list="dl-${cat}-${f.key}" value="${esc(val)}" autocomplete="off"${req}><datalist id="dl-${cat}-${f.key}">${f.options.map(o => `<option value="${esc(o)}">`).join('')}</datalist>`;
        } else {
            control = `<input id="${id}" data-spec="${f.key}" type="number" min="0" step="${f.step || 1}" value="${esc(val)}"${req}>`;
        }
        return `<label class="field"><span>${esc(f.label)}${f.required ? ' *' : ''}</span>${control}</label>`;
    };
    const renderSpecs = (cat, values = {}) => {
        $('#specTitle').textContent = 'Technical specifications: ' + (CATEGORIES[cat] || '');
        specBox.innerHTML = (SPEC_FIELDS[cat] || []).map(f => specInput(cat, f, values[f.key])).join('');
    };
    const collectSpecs = () => {
        const out = {};
        $$('[data-spec]', specBox).forEach(el => {
            const key = el.dataset.spec, f = (SPEC_FIELDS[catSelect.value] || []).find(x => x.key === key), v = el.value.trim();
            if (!v) return;
            out[key] = f.type === 'number' ? Number(v) : (key === 'socket' ? v.toUpperCase() : v);
        });
        return out;
    };

    /* --- image field --- */
    const setPreview = src => { preview.src = src || placeholder(); };
    preview.addEventListener('error', () => { preview.src = placeholder(); });
    imageFile.addEventListener('change', async () => {
        const file = imageFile.files[0];
        if (!file) return;
        try {
            pendingBlob = await resizeToBlob(file);
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            objectUrl = URL.createObjectURL(pendingBlob);
            imageUrl.value = '';
            setPreview(objectUrl);
        } catch (err) { pendingBlob = null; imageFile.value = ''; toast(esc(err.message), 'error'); }
    });
    imageUrl.addEventListener('input', () => { pendingBlob = null; imageFile.value = ''; });
    imageUrl.addEventListener('change', () => setPreview(imageUrl.value.trim()));   /* preview once, not per keystroke */
    $('#imageClear').addEventListener('click', () => { pendingBlob = null; imageFile.value = ''; imageUrl.value = ''; setPreview(''); });

    /* --- modal --- */
    const openModal = p => {
        editing = p || null; pendingBlob = null;
        form.reset(); imageFile.value = '';
        $('#modalTitle').textContent = p ? 'Edit component' : 'Add component';
        form.elements.title.value = p?.title ?? '';
        catSelect.value = p?.category || 'processors';
        form.elements.price.value = p ? p.price.toFixed(2) : '';
        form.elements.stock.value = p ? p.stock : 0;
        form.elements.description.value = p?.description ?? '';
        imageUrl.value = p?.image || '';
        setPreview(p?.image);
        renderSpecs(catSelect.value, p?.specs || {});
        modal.showModal();
    };
    catSelect.addEventListener('change', () => { const carry = collectSpecs(); renderSpecs(catSelect.value, carry); });
    $$('[data-close]', modal).forEach(b => b.addEventListener('click', () => modal.close()));
    modal.addEventListener('click', e => { if (e.target === modal) modal.close(); });

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const title = form.elements.title.value.trim();
        const price = Math.round((parseFloat(form.elements.price.value) || 0) * 100) / 100;
        const stock = Math.max(0, parseInt(form.elements.stock.value, 10) || 0);
        if (!title) return toast('Please enter a product name.', 'error');
        if (price < 0) return toast('Price cannot be negative.', 'error');
        saveBtn.disabled = true;
        const label = saveBtn.innerHTML;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
        try {
            let image = imageUrl.value.trim() || null;
            if (pendingBlob) image = await uploadProductImage(pendingBlob, title);
            const category = catSelect.value;
            const specs = (editing && editing.category === category) ? { ...editing.specs } : {};
            (SPEC_FIELDS[category] || []).forEach(f => delete specs[f.key]);
            Object.assign(specs, collectSpecs());
            const payload = { title, category, description: form.elements.description.value.trim(), price, stock, image, specs };
            if (editing) await Products.update(editing.id, payload); else await Products.create(payload);
            toast(editing ? 'Component updated.' : 'Component added.');
            modal.close(); render(); changed();
        } catch (err) { toast(esc(err.message), 'error'); }
        finally { saveBtn.disabled = false; saveBtn.innerHTML = label; }
    });

    /* --- table events --- */
    tbody.addEventListener('click', async e => {
        if (e.target.closest('[data-retry]')) return load();
        const row = e.target.closest('tr[data-id]');
        if (!row) return;
        const p = Products.get(row.dataset.id);
        if (!p) return;
        if (e.target.closest('[data-edit]')) openModal(p);
        if (e.target.closest('[data-delete]') && confirm(`Delete "${p.title}"? This cannot be undone.`)) {
            try { await Products.remove(p.id); render(); changed(); toast('Product deleted.'); }
            catch (err) { toast(esc(err.message), 'error'); }
        }
    });
    tbody.addEventListener('change', async e => {
        const input = e.target.closest('[data-f]');
        if (!input) return;
        const p = Products.get(input.closest('tr').dataset.id), field = input.dataset.f;
        if (!p) return;
        const value = field === 'stock' ? Math.max(0, parseInt(input.value, 10) || 0) : Math.max(0, Math.round((parseFloat(input.value) || 0) * 100) / 100);
        try {
            await Products.update(p.id, { [field]: value });
            input.value = field === 'price' ? value.toFixed(2) : value;
            toast(`${field === 'price' ? 'Price' : 'Stock'} updated.`);
            changed();
        } catch (err) { input.value = field === 'price' ? p.price.toFixed(2) : p.stock; toast(esc(err.message), 'error'); }
    });
    filterCat.addEventListener('change', render);
    filterText.addEventListener('input', render);
    if (addButton) addButton.addEventListener('click', () => openModal(null));

    load();
}

const paidOrders = () => read(KEY.orders, []).filter(o => o.status !== 'pending');
const revenue = () => paidOrders().reduce((sum, o) => sum + o.total, 0);

/* ===== Page initializers ===== */
const pages = {};

pages.login = () => {
    const existing = currentUser();
    if (existing) { location.replace(homeFor(existing.role)); return; }
    $('#loginForm').addEventListener('submit', e => {
        e.preventDefault();
        const email = $('#email').value.trim().toLowerCase(), password = $('#password').value;
        const user = read(KEY.users, []).find(u => u.email.toLowerCase() === email && u.password === password);
        if (!user) return formMessage('Incorrect email or password.');
        if (!user.active) return formMessage('This account is suspended. Contact an administrator.');
        write(KEY.session, { email: user.email });
        location.href = homeFor(user.role);
    });
};

pages.signup = () => {
    $('#signupForm').addEventListener('submit', e => {
        e.preventDefault();
        const users = read(KEY.users, []);
        const email = $('#email').value.trim().toLowerCase(), password = $('#password').value;
        if (password.length < 6) return formMessage('Password must be at least 6 characters.');
        if (password !== $('#confirm-password').value) return formMessage('Passwords do not match.');
        if (users.some(u => u.email.toLowerCase() === email)) return formMessage('An account with this email already exists.');
        const name = $('#fullname').value.trim();
        users.push(person({ id: 'USR-' + String(users.length + 1).padStart(3, '0'), name, username: email.split('@')[0], email, password, role: 'customer' }));
        write(KEY.users, users);
        formMessage('Account created. Redirecting to sign in...', true);
        setTimeout(() => { location.href = 'login.html'; }, 1000);
    });
};

pages.home = async () => {
    const user = guard();
    if (!user) return;
    let category = 'all';
    const grid = $('#productGrid'), search = $('#searchInput');
    const shell = initShell(user);

    const renderProducts = () => {
        const q = search.value.trim().toLowerCase();
        const list = Products.list.filter(p => (category === 'all' || p.category === category)
            && `${p.title} ${p.description} ${Object.values(p.specs).join(' ')}`.toLowerCase().includes(q));
        grid.innerHTML = list.length ? list.map(p => `
            <article class="product-card" data-id="${esc(p.id)}">
                <div class="product-image"><img src="${productImg(p)}" alt="${esc(p.title)}" loading="lazy"></div>
                <div class="product-info">
                    <h3 class="product-title">${esc(p.title)}</h3>
                    <div class="chips">${specChips(p, 3)}</div>
                    <p class="product-description">${esc(p.description)}</p>
                </div>
                <div class="product-bottom">
                    <div class="product-meta">
                        <span class="product-price">${money(p.price)}</span>
                        <span class="stock${p.stock <= 5 ? ' low' : ''}">${p.stock > 0 ? p.stock + ' in stock' : 'Out of stock'}</span>
                    </div>
                    <div class="card-actions">
                        <button class="btn btn-soft" data-add ${p.stock < 1 ? 'disabled' : ''}><i class="fa-solid fa-cart-plus"></i> Add</button>
                        <button class="btn btn-ok" data-buy ${p.stock < 1 ? 'disabled' : ''}>Buy Now</button>
                    </div>
                </div>
            </article>`).join('') : '<div class="empty-state"><i class="fa-solid fa-magnifying-glass"></i><p>No products found matching your search.</p></div>';
    };

    const load = async () => {
        grid.innerHTML = '<div class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i><p>Loading products...</p></div>';
        try { await Products.load(); renderProducts(); shell.renderCart(); }
        catch (err) { grid.innerHTML = errorCard(err.message); }
    };

    grid.addEventListener('click', e => {
        if (e.target.closest('[data-retry]')) return load();
        const card = e.target.closest('.product-card');
        if (!card) return;
        const id = card.dataset.id;
        if (e.target.closest('[data-add]')) {
            const p = addToCart(id);
            if (p) { shell.renderCart(); toast(`Added <strong>${esc(p.title)}</strong> to cart!`); }
        }
        if (e.target.closest('[data-buy]') && addToCart(id)) { shell.renderCart(); shell.toggleCart(true); }
    });

    search.addEventListener('input', renderProducts);
    $('#categoryPills').addEventListener('click', e => {
        const pill = e.target.closest('.pill');
        if (!pill) return;
        $$('.pill').forEach(p => p.classList.toggle('active', p === pill));
        category = pill.dataset.category;
        renderProducts();
    });

    /* arriving from the builder's search box or its "Book Consultation" button */
    const q0 = new URLSearchParams(location.search).get('q');
    if (q0) search.value = q0;
    $$('[data-prefill]').forEach(btn => btn.addEventListener('click', () => { $('#bookingType').value = btn.dataset.prefill; }));
    const pre = read(KEY.prefill, null);
    if (pre) {
        $('#bookingType').value = pre.type; $('#bookingDevice').value = pre.device; $('#bookingDetails').value = pre.details;
        localStorage.removeItem(KEY.prefill);
    }
    $('#bookingForm').addEventListener('submit', e => {
        e.preventDefault();
        const bookings = read(KEY.bookings, []);
        bookings.push({ id: uid('SRV-'), customer: user.name, email: user.email, device: $('#bookingDevice').value.trim(), type: $('#bookingType').value, details: $('#bookingDetails').value.trim(), status: 'Under Review' });
        write(KEY.bookings, bookings);
        e.target.reset();
        toast('Booking submitted. Our staff will review it shortly.');
    });

    await load();
};

pages['pc-builder'] = async () => {
    const user = guard();
    if (!user) return;
    const shell = initShell(user);
    $('#searchInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') location.href = 'home.html?q=' + encodeURIComponent(e.target.value.trim()) + '#products';
    });

    const PARTS = [
        { cat: 'processors', label: 'Processor (CPU)', icon: 'fa-microchip', prompt: 'Select a processor' },
        { cat: 'motherboards', label: 'Motherboard', icon: 'fa-server', prompt: 'Select a motherboard' },
        { cat: 'memory', label: 'Memory (RAM)', icon: 'fa-memory', prompt: 'Select memory' },
        { cat: 'graphics-cards', label: 'Graphics Card (GPU)', icon: 'fa-desktop', prompt: 'Select a graphics card' },
        { cat: 'power-supplies', label: 'Power Supply (PSU)', icon: 'fa-plug', prompt: 'Select a power supply' }
    ];
    const groups = $('#builderGroups');
    let ids = read(KEY.build, {});          /* category -> product id */

    const load = async () => {
        groups.innerHTML = '<div class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i><p>Loading components...</p></div>';
        try { await Products.load(); } catch (err) { groups.innerHTML = errorCard(err.message); return false; }
        shell.renderCart();
        groups.innerHTML = PARTS.map(({ cat, label, icon }) => `
            <div class="component-group" data-cat="${cat}">
                <div class="component-header">
                    <span class="component-title"><i class="fa-solid ${icon}"></i> ${label}</span>
                    <span class="stock" data-count></span>
                </div>
                <label class="field" style="margin-bottom:0"><span class="sr-only">${label}</span><select data-select aria-label="${label}"></select></label>
                <div class="selected-part" data-detail></div>
            </div>`).join('');
        return true;
    };

    const selection = () => Object.fromEntries(PARTS.map(({ cat }) => [cat, ids[cat] ? Products.get(ids[cat]) : undefined]));

    const refresh = () => {
        const sel = selection();
        PARTS.forEach(({ cat }) => { if (ids[cat] && !sel[cat]) delete ids[cat]; });
        write(KEY.build, ids);

        PARTS.forEach(({ cat, prompt }) => {
            const group = $(`[data-cat="${cat}"]`, groups), select = $('[data-select]', group);
            const list = Products.byCategory(cat).sort((a, b) => a.price - b.price);
            $('[data-count]', group).textContent = `${list.length} available`;
            select.innerHTML = `<option value="">-- ${prompt} --</option>` + list.map(p => {
                const why = sel[cat]?.id === p.id ? null : incompatibility(cat, p, sel);
                const out = p.stock < 1 && sel[cat]?.id !== p.id;
                const extra = specText({ unit: 'W' }, specOf(p).tdp ?? specOf(p).wattage);
                const tag = out ? ' (out of stock)' : why ? ` (incompatible: ${why})` : '';
                return `<option value="${esc(p.id)}"${sel[cat]?.id === p.id ? ' selected' : ''}${(out || why) ? ' disabled' : ''}>${esc(p.title)} | ${money(p.price)}${extra ? ' | ' + extra : ''}${tag}</option>`;
            }).join('');
            const p = sel[cat], detail = $('[data-detail]', group);
            detail.classList.toggle('active', !!p);
            detail.innerHTML = p
                ? `<img class="thumb" src="${productImg(p)}" alt=""><div class="part-info"><div class="part-name">${esc(p.title)}</div><div class="chips">${specChips(p, 6)}</div></div><div class="part-price">${money(p.price)}</div>`
                : '<span class="hint" style="margin:0">Nothing selected yet.</span>';
        });

        /* summary */
        const chosen = PARTS.filter(({ cat }) => sel[cat]).map(({ cat }) => ({ cat, p: sel[cat] }));
        const assembly = $('#assemblyToggle').checked;
        const subtotal = chosen.reduce((n, c) => n + c.p.price, 0);
        $('#selectedPartsList').innerHTML = chosen.length
            ? chosen.map(({ cat, p }) => `<div class="summary-row"><span class="part-line">${esc(p.title)}</span><span>${money(p.price)} <button class="remove-item-btn" data-clear="${cat}" aria-label="Remove ${esc(p.title)}"><i class="fa-solid fa-xmark"></i></button></span></div>`).join('')
            : '<p class="hint">No components selected yet.</p>';
        $('#buildSubtotal').textContent = money(subtotal);
        $('#assemblyRow').hidden = !assembly;
        $('#buildTotal').textContent = money(subtotal + (assembly && chosen.length ? ASSEMBLY_FEE : 0));
        $('#assemblyRow').querySelector('span:last-child').textContent = money(ASSEMBLY_FEE);

        /* power meter */
        const est = powerEstimate(sel), rec = recommendedPsu(sel), psuW = Number(specOf(sel['power-supplies']).wattage) || 0;
        $('#totalWatts').textContent = est ? `${est} W` : '0 W';
        $('#recWatts').textContent = rec ? `${rec} W+` : '--';
        const pct = est && psuW ? Math.min(100, Math.round(est / psuW * 100)) : 0;
        const fill = $('#meterFill');
        fill.style.width = pct + '%';
        fill.className = 'meter-fill' + (psuW && est > psuW ? ' bad' : (psuW && psuW < rec ? ' warn' : ''));
        $('#meterLabel').textContent = psuW && est ? `${pct}% of the ${psuW}W power supply` : 'Pick a power supply to see headroom';

        /* compatibility */
        const checks = buildChecks(sel);
        const icon = { ok: 'fa-circle-check', warn: 'fa-triangle-exclamation', error: 'fa-circle-xmark', info: 'fa-circle-info' };
        $('#compatList').innerHTML = checks.length
            ? checks.map(c => `<li class="compat ${c.level}"><i class="fa-solid ${icon[c.level]}"></i><span>${esc(c.text)}</span></li>`).join('')
            : '<li class="compat info"><i class="fa-solid fa-circle-info"></i><span>Pick parts and we will check that they fit together.</span></li>';
        return { sel, chosen, checks };
    };

    if (!(await load())) {
        groups.addEventListener('click', e => { if (e.target.closest('[data-retry]')) location.reload(); });
        return;
    }
    {
        groups.addEventListener('change', e => {
            const select = e.target.closest('[data-select]');
            if (!select) return;
            const cat = select.closest('[data-cat]').dataset.cat;
            if (select.value) ids[cat] = select.value; else delete ids[cat];
            refresh();
        });
        $('#selectedPartsList').addEventListener('click', e => {
            const btn = e.target.closest('[data-clear]');
            if (btn) { delete ids[btn.dataset.clear]; refresh(); }
        });
        $('#assemblyToggle').addEventListener('change', refresh);
        $('#resetBuildBtn').addEventListener('click', () => { ids = {}; refresh(); toast('Build cleared.'); });

        $('#addBuildBtn').addEventListener('click', async () => {
            if (!(await requireCompleteProfile())) return;
            const { chosen, checks } = refresh();
            if (!chosen.length) return toast('Select at least one component first.', 'error');
            if (checks.some(c => c.level === 'error')) return toast('Fix the compatibility errors before adding this build to your cart.', 'error');
            let added = 0;
            chosen.forEach(({ p }) => { if (addToCart(p.id)) added++; });
            if (!added) return;
            if ($('#assemblyToggle').checked) {
                const cart = getCart();
                if (!cart.some(i => i.id === ASSEMBLY_ID)) { cart.push({ id: ASSEMBLY_ID, title: 'PC Assembly & Testing Service', price: ASSEMBLY_FEE, qty: 1, service: true }); saveCart(cart); }
            }
            const notes = $('#buildNotes').value.trim();
            if (notes) localStorage.setItem(KEY.buildNote, 'Custom PC build request: ' + notes);
            shell.renderCart(); shell.toggleCart(true);
            toast('Build added to your cart.');
        });

        $('#bookConsultBtn').addEventListener('click', async () => {
            if (!(await requireCompleteProfile())) return;
            const { chosen } = refresh();
            write(KEY.prefill, {
                type: 'PC Build Consultation',
                device: chosen.length ? chosen.map(c => c.p.title).join(' + ') : 'Custom PC build',
                details: $('#buildNotes').value.trim() || 'I would like help finalizing this build.'
            });
            location.href = 'home.html#services-booking';
        });
        refresh();
    }
};

pages.checkout = async () => {
    const user=guard();if(!user)return;
    if(!(await requireCompleteProfile()))return;
    const body=$('#checkoutBody');let cart=await loadCartFromDatabase();
    if(!cart.length){body.innerHTML='<div class="card empty-state"><p>Your cart is empty.</p><a href="home.html" class="btn btn-primary">Browse products</a></div>';return;}
    await Products.load();
    cart=cart.map(i=>{const p=Products.get(i.id);return p?{id:p.id,title:p.title,price:p.price,qty:Math.min(i.qty,p.stock)}:null;}).filter(i=>i&&i.qty>0);
    if(!cart.length)throw new Error('Your cart items are no longer available.');
    const t=totals(cart),address=[user.address,user.city,user.zip].filter(Boolean).join(', ');
    $('#summaryRows').innerHTML=cart.map(i=>`<div class="summary-row"><span>${esc(i.title)} (x${i.qty})</span><span>${money(i.price*i.qty)}</span></div>`).join('')+
      `<div class="summary-row"><span>Subtotal</span><span>${money(t.subtotal)}</span></div><div class="summary-row"><span>Shipping</span><span>${money(t.shipping)}</span></div>`;
    $('#sumTotal').textContent=money(t.total);$('#shipTo').textContent='Ship to: '+address;
    $('#checkoutForm').elements.payment.innerHTML='<option value="gcash" selected>GCash</option>';
    $('#checkoutForm').addEventListener('submit',async e=>{
        e.preventDefault();const btn=$('button[type="submit"]',e.target);btn.disabled=true;
        try{
            const fd=new FormData(e.target),addressPayload={user_id:user.id,street:user.address,city:user.city,postal_code:user.zip,country:'PH',is_default:true};
            const {data:existing,error:findError}=await sbClient.from('address').select('address_id').eq('user_id',user.id).eq('is_default',true).maybeSingle();
            if(findError)throw findError;
            let addressId;
            if(existing){
                const {data,error}=await sbClient.from('address').update(addressPayload).eq('address_id',existing.address_id).select('address_id').single();
                if(error)throw error;addressId=data.address_id;
            }else{
                const {data,error}=await sbClient.from('address').insert(addressPayload).select('address_id').single();
                if(error)throw error;addressId=data.address_id;
            }
            const {data:orderId,error}=await sbClient.rpc('place_order_secure',{
                p_address_id:addressId,p_items:cart.map(i=>({component_id:Number(i.id),quantity:i.qty})),
                p_payment_method:'gcash',p_customer_note:fd.get('note')||''
            });
            if(error)throw error;if(!orderId)throw new Error('The database did not return the new order number.');
            write(KEY.cart,[]);await syncCartToDatabase([]);toast('Order placed and saved to your purchase history.');location.href='myorders.html';
        }catch(err){toast(err.message,'error');btn.disabled=false;}
    });
};

pages.orders = async () => {
    const user = guard();
    if (!user) return;
    const list = $('#ordersList');
    let tab = 'all';
    const actions = {
        pending:   '<button class="btn btn-outline danger" data-act="cancel"><i class="fa-solid fa-xmark"></i> Cancel Order</button><button class="btn btn-ok" data-act="pay"><i class="fa-solid fa-credit-card"></i> Pay Now</button>',
        toship:    '<button class="btn btn-outline" data-act="contact"><i class="fa-solid fa-headset"></i> Contact Seller</button>',
        toreceive: '<button class="btn btn-outline" data-act="track"><i class="fa-solid fa-location-dot"></i> Track Parcel</button><button class="btn btn-primary" data-act="received"><i class="fa-solid fa-box-open"></i> Order Received</button>',
        completed: '<button class="btn btn-outline" data-act="review"><i class="fa-solid fa-star"></i> Write Review</button><button class="btn btn-primary" data-act="again"><i class="fa-solid fa-rotate-right"></i> Buy Again</button>'
    };
    const render = () => {
        const mine = read(KEY.orders, []).filter(o => o.email === user.email && (tab === 'all' || o.status === tab));
        list.innerHTML = mine.length ? mine.map(o => `
            <div class="order-card" data-id="${esc(o.id)}">
                <div class="order-header">
                    <span>Order ID: <span class="order-id">#${esc(o.id)}</span></span>
                    <span class="status ${o.status}"><i class="fa-solid ${ORDER_STATUS[o.status].icon}"></i> ${ORDER_STATUS[o.status].label}</span>
                </div>
                ${o.items.map(i => `
                <div class="order-item">
                    <img class="item-img" src="${productImg(Products.byTitle(i.title))}" alt="">
                    <div class="item-info"><div class="item-name">${esc(i.title)}</div><div class="item-qty">Quantity: x${i.qty}</div></div>
                    <div class="item-price">${money(i.price * i.qty)}</div>
                </div>`).join('')}
                <div class="order-footer">
                    <div class="order-total">Total Amount: <strong>${money(o.total)}</strong></div>
                    <div class="order-actions">${actions[o.status]}</div>
                </div>
            </div>`).join('') : '<div class="card empty-state"><i class="fa-solid fa-box-open"></i><p>No orders in this tab yet.</p></div>';
    };

    $('#orderTabs').addEventListener('click', e => {
        const btn = e.target.closest('.tab-btn');
        if (!btn) return;
        $$('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
        tab = btn.dataset.tab;
        render();
    });

    list.addEventListener('click', async e => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const orders = read(KEY.orders, []), order = orders.find(o => o.id === btn.closest('.order-card').dataset.id);
        if (!order) return;
        const save = message => { write(KEY.orders, orders); render(); toast(message); };
        switch (btn.dataset.act) {
            case 'pay': order.status = 'toship'; save('Payment received. Your order is ready to ship.'); break;
            case 'received': order.status = 'completed'; save('Thanks! Order marked as received.'); break;
            case 'cancel':
                if (!confirm('Cancel this order?')) break;
                try {
                    /* put stock back; match by title because seeded orders carry no product id */
                    await Products.load();
                    const back = order.items.map(i => ({ ...i, id: Products.byTitle(i.title)?.id ?? null }));
                    await Products.adjustStock(back, +1);
                } catch (err) { toast(esc(err.message), 'error'); break; }
                write(KEY.orders, orders.filter(o => o !== order)); render(); toast('Order cancelled.');
                break;
            case 'again': {
                let added = 0;
                order.items.forEach(i => {
                    const p = Products.byTitle(i.title);
                    if (p && !i.service && addToCart(p.id, i.qty)) added++;
                });
                if (!added) { toast('Those items are no longer available.', 'error'); break; }
                toast('Items added to your cart.');
                setTimeout(() => { location.href = 'home.html'; }, 800);
                break;
            }
            case 'track': toast('Tracking: your parcel is on its way.'); break;
            case 'contact': toast('The seller has been notified.'); break;
            case 'review': toast('Reviews are coming soon.'); break;
        }
    });
    render();
    try { await Products.load(); render(); } catch { /* images fall back to the placeholder */ }
};

pages.settings = () => {
    const user = guard();
    if (!user) return;
    const users = read(KEY.users, []);
    const fill = form => $$('[name]', form).forEach(input => { if (input.name in user && input.type !== 'password') input.value = user[input.name]; });
    const persist = (changes, message) => { Object.assign(user, changes); write(KEY.users, users.map(u => u.id === user.id ? user : u)); write(KEY.session, { email: user.email }); toast(message); };
    const data = form => Object.fromEntries(new FormData(form));
    $$('#profileForm, #addressForm').forEach(fill);
    $('#profileForm').addEventListener('submit', e => {
        e.preventDefault();
        const d = data(e.target);
        if (users.some(u => u.id !== user.id && u.email.toLowerCase() === d.email.toLowerCase())) return toast('That email is already used by another account.', 'error');
        persist(d, 'Profile settings updated successfully!');
    });
    $('#addressForm').addEventListener('submit', e => { e.preventDefault(); persist(data(e.target), 'Shipping address updated successfully!'); });
    $('#passwordForm').addEventListener('submit', e => {
        e.preventDefault();
        const d = data(e.target);
        if (d.current !== user.password) return toast('Current password is incorrect.', 'error');
        if (d.next.length < 6) return toast('New password must be at least 6 characters.', 'error');
        if (d.next !== d.confirm) return toast('New passwords do not match.', 'error');
        persist({ password: d.next }, 'Password changed successfully!');
        e.target.reset();
    });
};

pages.staff = () => {
    if (!guard(['staff', 'admin'])) return;
    const tbody = $('#queueBody'), proofInput = $('#proofInput');
    let pendingId = null;
    const saveOrders = orders => { write(KEY.orders, orders); renderQueue(); };

    const renderMetrics = () => {
        $('#mItems').textContent = Products.list.reduce((n, p) => n + p.stock, 0);
        $('#mSale').textContent = money(revenue());
        $('#mBookings').textContent = read(KEY.bookings, []).length;
        $('#mReports').textContent = read(KEY.reports, 0);
    };
    function renderQueue() {
        const orders = read(KEY.orders, []);
        tbody.innerHTML = orders.map(o => {
            const done = o.status === 'completed';
            const action = done ? `<span class="btn btn-sm btn-ok static"><i class="fa-solid fa-check"></i> Completed</span><span class="proof"><i class="fa-solid fa-image"></i> ${esc(o.proof || 'Proof uploaded')}</span>`
                : o.status === 'pending' ? '<span class="stock">Awaiting payment</span>'
                : (o.status === 'toship' ? '<button class="btn btn-sm btn-soft" data-ship>Ship out</button> ' : '') + '<button class="btn btn-sm btn-danger" data-complete>Complete order</button>';
            return `<tr data-id="${esc(o.id)}">
                <td>#${esc(o.id)}</td><td>${esc(o.customer)}</td>
                <td>${esc(o.items.map(i => `${i.title} (x${i.qty})`).join(', '))}</td>
                <td>${money(o.total)}</td>
                <td><span class="status ${o.status}">${ORDER_STATUS[o.status].label}</span></td>
                <td><input type="date" class="edit-input date" data-date value="${esc(o.receiveDate || '')}" ${done ? 'disabled' : ''} aria-label="When to receive"></td>
                <td class="actions">${action}</td></tr>`;
        }).join('') || '<tr><td colspan="8" class="table-empty">No orders yet.</td></tr>';
        renderMetrics();
    }

    tbody.addEventListener('click', e => {
        const row = e.target.closest('tr[data-id]');
        if (!row) return;
        if (e.target.closest('[data-ship]')) {
            const orders = read(KEY.orders, []);
            orders.find(o => o.id === row.dataset.id).status = 'toreceive';
            saveOrders(orders); toast('Order marked as shipped out.');
        }
        if (e.target.closest('[data-complete]')) { pendingId = row.dataset.id; proofInput.click(); }
    });
    tbody.addEventListener('change', e => {
        if (!e.target.matches('[data-date]')) return;
        const orders = read(KEY.orders, []);
        orders.find(o => o.id === e.target.closest('tr').dataset.id).receiveDate = e.target.value;
        write(KEY.orders, orders); toast('Delivery date saved.');
    });
    proofInput.addEventListener('change', () => {
        const file = proofInput.files[0];
        if (!file || !pendingId) return toast('Image proof is required to complete this order.', 'error');
        const orders = read(KEY.orders, []), order = orders.find(o => o.id === pendingId);
        order.status = 'completed'; order.proof = file.name;
        proofInput.value = ''; pendingId = null;
        saveOrders(orders); toast('Order completed, proof uploaded, and date locked.');
    });

    $('#reportBtn').addEventListener('click', () => {
        const rows = [['Order ID', 'Customer', 'Items', 'Total', 'Status', 'Receive date']].concat(read(KEY.orders, []).map(o => [o.id, o.customer, o.items.map(i => `${i.title} x${i.qty}`).join('; '), o.total.toFixed(2), ORDER_STATUS[o.status].label, o.receiveDate]));
        const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
        const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'iwantpc-orders-report.csv' });
        link.click();
        write(KEY.reports, read(KEY.reports, 0) + 1);
        renderMetrics(); toast('Report generated.');
    });

    document.addEventListener('inventory:changed', renderMetrics);
    setupInventory($('#inventoryBody'), { addButton: $('#addProductBtn') });
    renderQueue();
};

pages.admin = () => {
    const admin = guard(['admin']);
    if (!admin) return;
    const usersBody = $('#usersBody'), servicesBody = $('#servicesBody');

    const renderMetrics = () => {
        $('#mRevenue').textContent = money(revenue());
        $('#mOrders').textContent = read(KEY.orders, []).length;
        $('#mAccounts').textContent = read(KEY.users, []).length;
        $('#mServices').textContent = read(KEY.bookings, []).filter(b => b.status === 'Under Review').length;
    };
    const renderUsers = () => {
        usersBody.innerHTML = read(KEY.users, []).map(u => `
            <tr data-id="${esc(u.id)}" class="${u.active ? '' : 'is-suspended'}">
                <td>#${esc(u.id)}</td><td>${esc(u.name)}</td><td>${esc(u.email)}</td>
                <td>
                    <select class="edit-input" data-role aria-label="Role for ${esc(u.name)}" ${u.id === admin.id ? 'disabled' : ''}>
                        ${['admin', 'staff', 'customer'].map(r => `<option value="${r}"${r === u.role ? ' selected' : ''}>${r[0].toUpperCase() + r.slice(1)}</option>`).join('')}
                    </select>
                </td>
                <td><span class="status ${u.active ? u.role : 'suspended'}">${u.active ? 'Active' : 'Suspended'}</span></td>
                <td class="actions">${u.id === admin.id ? '<span class="stock">This is you</span>' : `<button class="btn btn-sm ${u.active ? 'btn-outline danger' : 'btn-soft'}" data-toggle>${u.active ? 'Suspend' : 'Reactivate'}</button>`}</td>
            </tr>`).join('');
        renderMetrics();
    };
    const renderServices = () => {
        const statusClass = { 'Under Review': 'pending', Approved: 'approved', Rejected: 'rejected' };
        servicesBody.innerHTML = read(KEY.bookings, []).map(b => `
            <tr data-id="${esc(b.id)}">
                <td>#${esc(b.id)}</td><td>${esc(b.customer)}</td><td>${esc(b.device)}</td><td>${esc(b.type)}</td>
                <td><span class="status ${statusClass[b.status]}">${esc(b.status)}</span></td>
                <td class="actions">${b.status === 'Under Review' ? '<button class="btn btn-sm btn-soft" data-decide="Approved">Approve</button><button class="btn btn-sm btn-outline danger" data-decide="Rejected">Reject</button>' : ''}</td>
            </tr>`).join('') || '<tr><td colspan="6" class="table-empty">No service tickets yet.</td></tr>';
        renderMetrics();
    };
    const updateUser = (id, change) => {
        const users = read(KEY.users, []);
        change(users.find(u => u.id === id));
        write(KEY.users, users);
        renderUsers();
    };

    usersBody.addEventListener('change', e => {
        if (e.target.matches('[data-role]')) { updateUser(e.target.closest('tr').dataset.id, u => { u.role = e.target.value; }); toast('Role updated.'); }
    });
    usersBody.addEventListener('click', e => {
        if (!e.target.closest('[data-toggle]')) return;
        updateUser(e.target.closest('tr').dataset.id, u => { u.active = !u.active; });
        toast('Account status updated.');
    });
    servicesBody.addEventListener('click', e => {
        const btn = e.target.closest('[data-decide]');
        if (!btn) return;
        const bookings = read(KEY.bookings, []);
        bookings.find(b => b.id === btn.closest('tr').dataset.id).status = btn.dataset.decide;
        write(KEY.bookings, bookings);
        renderServices(); toast(`Claim ${btn.dataset.decide.toLowerCase()}.`);
    });
    $('#addUserBtn').addEventListener('click', () => {
        const name = (prompt('Full name of the new user:') || '').trim();
        const email = (prompt('Email address:') || '').trim().toLowerCase();
        if (!name || !email) return;
        const users = read(KEY.users, []);     /* was an undeclared variable (crashed in strict mode) */
        if (users.some(u => u.email.toLowerCase() === email)) return toast('That email already has an account.', 'error');
        users.push(person({ id: 'USR-' + String(users.length + 1).padStart(3, '0'), name, username: email.split('@')[0], email, password: 'changeme123', role: 'customer' }));
        write(KEY.users, users);
        renderUsers(); toast('User added with the temporary password "changeme123".');
    });

    setupInventory($('#inventoryBody'), { canDelete: true, addButton: $('#addProductBtn') });
    renderUsers();
    renderServices();
};


/* ================= SUPABASE AUTH + COMPONENT-CENTRIC DATA LAYER =================
   The existing page markup and styling remain the presentation layer. The database
   is authoritative; localStorage is only a short-lived UI cache for the cart/build. */
const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
let AUTH_USER = null;
let AUTH_PROFILE = null;

function currentUser() { return AUTH_USER; }
function guard(roles) {
    const user = AUTH_USER;
    if (!user || (roles && !roles.includes(user.role))) {
        location.replace(user ? homeFor(user.role) : 'login.html');
        return null;
    }
    return user;
}
async function loadAuthUser() {
    const { data: { session }, error } = await sbClient.auth.getSession();
    if (error) throw error;
    if (!session) { AUTH_USER = null; return null; }
    const id = session.user.id;
    const [{ data: u, error: ue }, { data: p, error: pe }] = await Promise.all([
        sbClient.from('users').select('user_id,username,email,user_role,role,is_active,name').eq('user_id', id).maybeSingle(),
        sbClient.from('profiles').select('id,email,name,username,role,active,phone,address,city,zip').eq('id', id).maybeSingle()
    ]);
    if (ue) throw ue;
    if (pe && pe.code !== 'PGRST116') throw pe;
    if (!u || u.is_active === false || (p && p.active === false)) {
        await sbClient.auth.signOut();
        AUTH_USER = null;
        throw new Error('This account is inactive. Please contact an administrator.');
    }
    AUTH_PROFILE = p || {};
    AUTH_USER = {
        id, user_id: id, email: session.user.email || u.email,
        username: p?.username || u.username || '',
        name: p?.name || u.name || '',
        role: u.role || u.user_role || p?.role || 'customer',
        active: u.is_active !== false && p?.active !== false,
        phone: p?.phone || '', address: p?.address || '', city: p?.city || '', zip: p?.zip || ''
    };
    return AUTH_USER;
}

// UI keys stay readable; these values exactly match public.component_category.
const CATEGORY_ALIASES = {
    processors: ['processors','processor','cpu','proccesor','proccessor'],
    motherboards: ['motherboards','motherboard','mainboard'],
    memory: ['memory','ram','rams'],
    'graphics-cards': ['graphics-cards','graphics_cards','graphics card','gpu','gpus'],
    'power-supplies': ['power-supplies','power_supplies','power supply','psu'],
    storage: ['storage','ssd','hdd'],
    case: ['case','cases','pc case'],
    cooler: ['cooler','coolers','cpu cooler'],
    peripheral: ['peripheral','peripherals'],
    other: ['other','others','other component']
};
const categoryToUi = value => {
    const raw = String(value || '').trim().toLowerCase();
    return Object.entries(CATEGORY_ALIASES).find(([, aliases]) => aliases.includes(raw))?.[0] || raw;
};
const categoryToDatabase = value => ({
    processors:'cpu', motherboards:'motherboard', memory:'ram',
    'graphics-cards':'gpu', 'power-supplies':'psu',
    storage:'storage', case:'case', cooler:'cooler', peripheral:'peripheral', other:'other'
}[categoryToUi(value)] || String(value || '').trim().toLowerCase());
const componentToProduct = r => ({
    ...r, id:r.component_id, title:r.name, category:categoryToUi(r.category),
    stock:Number(r.stock_level)||0, price:Number(r.price)||0,
    image:r.image_url||'', description:r.description||'',
    specs:{...(r.specs||{}),socket:r.socket||r.specs?.socket,
        memory_type:r.ram_type||r.specs?.memory_type,
        wattage:r.psu_watts||r.specs?.wattage,min_psu_watts:r.min_psu_watts||r.specs?.min_psu_watts}
});
Object.assign(Products, {
    async load() {
        const { data, error } = await sbClient.from('component').select('*').eq('is_active', true).order('category').order('name');
        if (error) throw error;
        this.list = (data || []).map(componentToProduct).sort(byCatTitle);
        return this.list;
    },
    async create(data) {
        const specs = data.specs || {};
        const payload = {
            name: data.title, sku: ('IWP-' + data.title).toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 48) + '-' + Date.now().toString().slice(-5),
            category: categoryToDatabase(data.category), description: data.description || '', price: data.price, stock_level: data.stock,
            image_url: data.image, specs, socket: specs.socket || null,
            ram_type: specs.memory_type && ['DDR4','DDR5'].includes(specs.memory_type) ? specs.memory_type : null,
            psu_watts: specs.wattage || null, min_psu_watts: specs.min_psu_watts || null
        };
        const { data: row, error } = await sbClient.from('component').insert(payload).select('*').single();
        if (error) throw error;
        const p = componentToProduct(row); this.list.push(p); this.list.sort(byCatTitle); return p;
    },
    async update(id, changes) {
        const payload = {};
        if ('title' in changes) payload.name = changes.title;
        if ('description' in changes) payload.description = changes.description;
        if ('price' in changes) payload.price = changes.price;
        if ('stock' in changes) payload.stock_level = changes.stock;
        if ('image' in changes) payload.image_url = changes.image;
        if ('category' in changes) payload.category = categoryToDatabase(changes.category);
        if ('specs' in changes) {
            payload.specs = changes.specs;
            payload.socket = changes.specs.socket || null;
            payload.ram_type = ['DDR4','DDR5'].includes(changes.specs.memory_type) ? changes.specs.memory_type : null;
            payload.psu_watts = changes.specs.wattage || null;
            payload.min_psu_watts = changes.specs.min_psu_watts || null;
        }
        const { data: row, error } = await sbClient.from('component').update(payload).eq('component_id', id).select('*').single();
        if (error) throw error;
        const fresh = componentToProduct(row), ix = this.list.findIndex(x => sameId(x.id,id));
        if (ix >= 0) this.list[ix] = fresh; else this.list.push(fresh);
        this.list.sort(byCatTitle); return fresh;
    },
    async remove(id) {
        const { error } = await sbClient.from('component').update({ is_active: false }).eq('component_id', id);
        if (error) throw error;
        this.list = this.list.filter(p => !sameId(p.id,id));
    },
    async adjustStock(lines, direction) {
        const items = lines.filter(i => !i.service && i.id != null).map(i => ({ id: i.id, qty: i.qty }));
        if (items.length) {
            const { error } = await sbClient.rpc('adjust_stock_bulk', { items, direction });
            if (error) throw error;
            await this.load();
        }
    }
});

async function fetchProfileAndAddress(userId) {
    const [{ data: p, error: pe }, { data: a, error: ae }] = await Promise.all([
        sbClient.from('profiles').select('*').eq('id', userId).maybeSingle(),
        sbClient.from('address').select('*').eq('user_id', userId).eq('is_default', true).maybeSingle()
    ]);
    if (pe) throw pe; if (ae && ae.code !== 'PGRST116') throw ae;
    if (p) Object.assign(AUTH_USER, { name:p.name, username:p.username, phone:p.phone, address:p.address, city:p.city, zip:p.zip });
    if (a) Object.assign(AUTH_USER, { address:a.street, city:a.city, zip:a.postal_code, address_id:a.address_id });
    return AUTH_USER;
}
async function requireCompleteProfile(user = AUTH_USER) {
    if (!user) { location.href='login.html'; return false; }
    await fetchProfileAndAddress(user.id);
    const missing = ['name','phone','address','city','zip'].filter(k => !String(user[k] || '').trim());
    if (missing.length) {
        toast('Please complete your name, contact number, and shipping address before continuing.', 'error');
        location.href = 'accountsetting.html';
        return false;
    }
    return true;
}

/* Persist cart rows in the user's Supabase cart; localStorage is only the render cache. */
async function syncCartToDatabase(cart) {
    const { data: c, error: ce } = await sbClient.from('cart').upsert({ user_id: AUTH_USER.id }, { onConflict:'user_id' }).select('cart_id').single();
    if (ce) throw ce;
    const { error: de } = await sbClient.from('cart_item').delete().eq('cart_id', c.cart_id);
    if (de) throw de;
    const rows = cart.filter(i => !i.service && i.id != null).map(i => ({ cart_id:c.cart_id, component_id:Number(i.id), quantity:i.qty }));
    if (rows.length) { const { error } = await sbClient.from('cart_item').insert(rows); if (error) throw error; }
}
async function loadCartFromDatabase() {
    if (!AUTH_USER) return [];
    const { data: c, error: ce } = await sbClient.from('cart').select('cart_id').eq('user_id', AUTH_USER.id).maybeSingle();
    if (ce) throw ce;
    if (!c) { write(KEY.cart, []); return []; }
    const { data: rows, error } = await sbClient.from('cart_item').select('cart_item_id,component_id,quantity').eq('cart_id', c.cart_id);
    if (error) throw error;
    await Products.load();
    const cart = (rows || []).map(r => {
        const p = Products.get(r.component_id);
        return p ? { id:p.id,title:p.title,price:p.price,qty:r.quantity } : null;
    }).filter(Boolean);
    write(KEY.cart, cart); return cart;
}

pages.login = () => {
    if (AUTH_USER) { location.replace(homeFor(AUTH_USER.role)); return; }
    $('#loginForm').addEventListener('submit', async e => {
        e.preventDefault(); const btn = $('button[type="submit"]',e.target);
        btn.disabled=true; formMessage('Signing in...');
        try {
            const { error } = await sbClient.auth.signInWithPassword({
                email:$('#email').value.trim().toLowerCase(), password:$('#password').value
            });
            if (error) throw error;
            await loadAuthUser();
            if (!AUTH_USER) throw new Error('Your account profile is not ready. Contact support.');
            location.replace(homeFor(AUTH_USER.role));
        } catch(err) { formMessage(err.message || 'Unable to sign in.'); btn.disabled=false; }
    });
};
pages.signup = () => {
    $('#signupForm').addEventListener('submit', async e => {
        e.preventDefault();
        const password=$('#password').value, name=$('#fullname').value.trim(), email=$('#email').value.trim().toLowerCase();
        if (password.length<8) return formMessage('Use a password with at least 8 characters.');
        if (password!==$('#confirm-password').value) return formMessage('Passwords do not match.');
        const btn=$('button[type="submit"]',e.target); btn.disabled=true;
        try {
            const username=email.split('@')[0].replace(/[^a-z0-9_]/gi,'').slice(0,30) || 'customer';
            const { data, error } = await sbClient.auth.signUp({ email,password,options:{data:{name,username}} });
            if (error) throw error;
            if (!data.session) {
                formMessage('Account created. Check your email to confirm your account, then sign in.',true);
                return;
            }
            await loadAuthUser();
            location.replace('accountsetting.html');
        } catch(err) { formMessage(err.message); btn.disabled=false; }
    });
};

pages.home = async () => {
    const user=guard(); if(!user) return;
    const shell=initShell(user), grid=$('#productGrid'), search=$('#searchInput');
    let category='all', sales={};
    const render=()=>{
        const q=search.value.trim().toLowerCase();
        const list=Products.list.filter(p=>(category==='all'||p.category===category)&&`${p.title} ${p.description} ${Object.values(p.specs).join(' ')}`.toLowerCase().includes(q));
        grid.innerHTML=list.length?list.map(p=>`<article class="product-card" data-id="${esc(p.id)}">
          <div class="product-image"><img src="${productImg(p)}" alt="${esc(p.title)}" loading="lazy"></div>
          <div class="product-info"><h3 class="product-title">${esc(p.title)}</h3><div class="chips">${specChips(p,3)}</div><p class="product-description">${esc(p.description)}</p></div>
          <div class="product-bottom"><div class="product-meta"><span class="product-price">${money(p.price)}</span><span class="stock${p.stock<=5?' low':''}">${p.stock>0?p.stock+' in stock':'Out of stock'}</span></div>
          <p class="hint sold-count">${Number(sales[p.id]||0)} units ordered</p>
          <div class="card-actions"><button class="btn btn-soft" data-add ${p.stock<1?'disabled':''}><i class="fa-solid fa-cart-plus"></i> Add</button><button class="btn btn-ok" data-buy ${p.stock<1?'disabled':''}>Buy Now</button></div></div></article>`).join(''):'<div class="empty-state"><p>No products found matching your search.</p></div>';
    };
    await Products.load();
    const {data:salesRows,error:se}=await sbClient.from('v_component_sales').select('component_id,units_ordered');
    if(!se) (salesRows||[]).forEach(x=>sales[x.component_id]=x.units_ordered);
    await loadCartFromDatabase(); shell.renderCart(); render();
    search.addEventListener('input',render);
    $('#categoryPills').addEventListener('click',e=>{const p=e.target.closest('.pill');if(!p)return;$$('.pill').forEach(x=>x.classList.toggle('active',x===p));category=p.dataset.category;render();});
    grid.addEventListener('click',async e=>{
        const card=e.target.closest('.product-card');if(!card)return;
        if(!(await requireCompleteProfile()))return;
        const p=Products.get(card.dataset.id); if(!p)return;
        if(e.target.closest('[data-add]')||e.target.closest('[data-buy]')){
            const result=addToCart(p.id); if(result){await syncCartToDatabase(getCart());shell.renderCart();if(e.target.closest('[data-buy]'))shell.toggleCart(true);toast('Added '+esc(p.title)+' to cart.');}
        }
    });
    $$('[data-prefill]').forEach(b=>b.addEventListener('click',()=>$('#bookingType').value=b.dataset.prefill));
    const bookingType=$('#bookingType'), originalDeviceInput=$('#bookingDevice').outerHTML;
    const deviceLabel=$('#bookingDevice').closest('label');
    const loadWarrantyChoices=async()=>{
        if(!bookingType.value.toLowerCase().includes('warranty')){
            if($('#bookingDevice').tagName==='SELECT')deviceLabel.innerHTML='<span>Device / part</span>'+originalDeviceInput;
            return;
        }
        const {data:orders,error}=await sbClient.from('orders').select('order_id,order_item(order_item_id,product_id,item_name)').eq('user_id',user.id).eq('order_status','completed');
        if(error)throw error;
        const purchased=(orders||[]).flatMap(o=>(o.order_item||[]).map(i=>({...i,order_id:o.order_id}))).filter(i=>i.product_id!=null);
        const unique=[...new Map(purchased.map(i=>[String(i.product_id),i])).values()];
        deviceLabel.innerHTML='<span>Purchased device / part</span><select id="bookingDevice" required><option value="">Select a purchased component</option>'+unique.map(i=>`<option value="${esc(i.product_id)}">${esc(i.item_name||'Component')} — Order #${esc(i.order_id)}</option>`).join('')+'</select>';
        if(!unique.length)$('#bookingDevice').innerHTML='<option value="">No completed purchases available</option>';
    };
    const visitDate=$('#bookingVisitDate');
    const syncVisitDate=()=>{const isWarranty=bookingType.value.toLowerCase().includes('warranty');visitDate.required=!isWarranty;visitDate.closest('label').hidden=isWarranty;};
    visitDate.min=new Date().toLocaleDateString('en-CA');
    bookingType.addEventListener('change',()=>{syncVisitDate();loadWarrantyChoices().catch(err=>toast(err.message,'error'));});
    syncVisitDate();
    if(bookingType.value.toLowerCase().includes('warranty'))await loadWarrantyChoices();
    $('#bookingForm').addEventListener('submit',async e=>{
        e.preventDefault();if(!(await requireCompleteProfile()))return;
        const type=bookingType.value,device=$('#bookingDevice').value.trim(),details=$('#bookingDetails').value.trim(),isWarranty=type.toLowerCase().includes('warranty');
        const appointmentDate=visitDate.value;
        if(!isWarranty&&!appointmentDate)return toast('Please choose your preferred store visit date.','error');
        try{
            if(isWarranty){
                const {data:orders,error}=await sbClient.from('orders').select('order_id,order_item(order_item_id,product_id,item_name)').eq('user_id',user.id).eq('order_status','completed');
                if(error)throw error;
                const item=(orders||[]).flatMap(o=>(o.order_item||[]).map(i=>({...i,order_id:o.order_id}))).find(i=>String(i.product_id)===device);
                if(!item)throw new Error('Warranty claims are accepted only for components in your completed purchases.');
                const {error:we}=await sbClient.from('warranty_request').insert({user_id:user.id,product_id:item.product_id,order_item_id:item.order_item_id,description:details,customer_name:user.name,customer_email:user.email,customer_phone:user.phone,receipt_code:String(item.order_id)});
                if(we)throw we;
            }else{
                const {error}=await sbClient.from('service_reservation').insert({user_id:user.id,service_type:type.toLowerCase().includes('consult')?'consultation':'repair',status:'requested',appointment_date:appointmentDate,notes:details,device_details:device,customer_name:user.name,customer_email:user.email,customer_phone:user.phone});
                if(error)throw error;
            }
            e.target.reset();syncVisitDate();toast(isWarranty?'Warranty request submitted successfully.':'Service booking submitted successfully.');
        }catch(err){toast(err.message,'error');}
    });
};

pages.checkout = async () => {
    const user=guard();if(!user)return;
    if(!(await requireCompleteProfile()))return;
    const body=$('#checkoutBody');let cart=await loadCartFromDatabase();
    if(!cart.length){body.innerHTML='<div class="card empty-state"><p>Your cart is empty.</p><a href="home.html" class="btn btn-primary">Browse products</a></div>';return;}
    await Products.load();
    cart=cart.map(i=>{const p=Products.get(i.id);return p?{id:p.id,title:p.title,price:p.price,qty:Math.min(i.qty,p.stock)}:null;}).filter(i=>i&&i.qty>0);
    if(!cart.length)throw new Error('Your cart items are no longer available.');
    const t=totals(cart),address=[user.address,user.city,user.zip].filter(Boolean).join(', ');
    $('#summaryRows').innerHTML=cart.map(i=>`<div class="summary-row"><span>${esc(i.title)} (x${i.qty})</span><span>${money(i.price*i.qty)}</span></div>`).join('')+
      `<div class="summary-row"><span>Subtotal</span><span>${money(t.subtotal)}</span></div><div class="summary-row"><span>Shipping</span><span>${money(t.shipping)}</span></div>`;
    $('#sumTotal').textContent=money(t.total);$('#shipTo').textContent='Ship to: '+address;
    $('#checkoutForm').elements.payment.innerHTML='<option value="gcash" selected>GCash</option>';
    $('#checkoutForm').addEventListener('submit',async e=>{
        e.preventDefault();const btn=$('button[type="submit"]',e.target);btn.disabled=true;
        try{
            const fd=new FormData(e.target),addressPayload={user_id:user.id,street:user.address,city:user.city,postal_code:user.zip,country:'PH',is_default:true};
            const {data:existing,error:findError}=await sbClient.from('address').select('address_id').eq('user_id',user.id).eq('is_default',true).maybeSingle();
            if(findError)throw findError;
            let addressId;
            if(existing){
                const {data,error}=await sbClient.from('address').update(addressPayload).eq('address_id',existing.address_id).select('address_id').single();
                if(error)throw error;addressId=data.address_id;
            }else{
                const {data,error}=await sbClient.from('address').insert(addressPayload).select('address_id').single();
                if(error)throw error;addressId=data.address_id;
            }
            const {data:orderId,error}=await sbClient.rpc('place_order_secure',{p_address_id:addressId,p_items:cart.map(i=>({component_id:Number(i.id),quantity:i.qty})),p_payment_method:'gcash',p_customer_note:fd.get('note')||''});
            if(error)throw error;if(!orderId)throw new Error('The database did not return the new order number.');
            write(KEY.cart,[]);await syncCartToDatabase([]);toast('Order placed and saved to your purchase history.');location.href='myorders.html';
        }catch(err){toast(err.message,'error');btn.disabled=false;}
    });
};

pages.orders = async () => {
    const user=guard();if(!user)return;
    const list=$('#ordersList');let tab='all',orders=[];
    const labels={pending:'Pending Payment',toship:'To Ship',toreceive:'To Receive',completed:'Completed',cancelled:'Cancelled'};
    const render=()=>{
        const filtered=orders.filter(o=>tab==='all'||o.status===tab);
        list.innerHTML=filtered.length?filtered.map(o=>`<div class="order-card" data-id="${o.id}">
          <div class="order-header"><span>Order ID: <span class="order-id">#${o.id}</span></span><span class="status ${o.status}">${labels[o.status]||o.status}</span></div>
          ${(o.items||[]).map(i=>`<div class="order-item"><div class="item-info"><div class="item-name">${esc(i.title)}</div><div class="item-qty">Quantity: x${i.qty}</div></div><div class="item-price">${money(i.price*i.qty)}</div></div>`).join('')}
          <p class="hint">Scheduled delivery: <strong>${o.delivery_date||'Not yet scheduled'}</strong></p>
          ${o.proof_image_url?`<p class="hint">Delivery proof: <a href="${esc(o.proof_image_url)}" target="_blank" rel="noopener">View photo</a></p>`:''}
          <div class="order-footer"><div class="order-total">Total Amount: <strong>${money(o.total)}</strong></div><div class="order-actions">${o.status==='toreceive'?'<button class="btn btn-primary" data-received>Order Received</button>':''}</div></div></div>`).join(''):'<div class="card empty-state"><p>No orders in this tab yet.</p></div>';
    };
    const {data,error}=await sbClient.from('orders').select('*,order_item(*),address(*)').eq('user_id',user.id).order('created_at',{ascending:false});
    if(error)throw error;
    orders=(data||[]).map(o=>({id:o.order_id,status:String(o.order_status),total:Number(o.total_amount),delivery_date:o.delivery_date,proof_image_url:o.proof_image_url||null,items:(o.order_item||[]).map(i=>({title:i.item_name||'PC Component',qty:i.quantity,price:Number(i.unit_price)}))}));
    render();
    $('#orderTabs').addEventListener('click',e=>{const b=e.target.closest('.tab-btn');if(!b)return;$$('.tab-btn').forEach(x=>x.classList.toggle('active',x===b));tab=b.dataset.tab;render();});
    list.addEventListener('click',async e=>{
        const b=e.target.closest('[data-received]');if(!b)return;
        const id=Number(b.closest('.order-card').dataset.id);
        if(!confirm('Are you sure you have received this order?'))return;
        const {error}=await sbClient.from('orders').update({order_status:'completed',received_at:new Date().toISOString()}).eq('order_id',id).eq('user_id',user.id);
        if(error)return toast(error.message,'error');
        orders=orders.map(o=>o.id===id?{...o,status:'completed'}:o);render();toast('Order marked as received.');
    });
};

pages.bookings = async () => {
    const user=guard();if(!user)return;
    const list=$('#bookingsList');let tab='all',bookings=[];
    const statusInfo={requested:{label:'Pending',className:'pending'},pending:{label:'Pending',className:'pending'},approved:{label:'Approved',className:'approved'},rejected:{label:'Rejected',className:'rejected'}};
    const prettyDate=value=>{if(!value)return 'Not selected';const raw=String(value).slice(0,10);const d=new Date(raw+'T00:00:00');return Number.isNaN(d.getTime())?raw:d.toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'});};
    const render=()=>{
        const filtered=bookings.filter(b=>tab==='all'||(tab==='pending'?['requested','pending'].includes(String(b.status).toLowerCase()):String(b.status).toLowerCase()===tab));
        list.innerHTML=filtered.length?filtered.map(b=>{const st=statusInfo[String(b.status||'requested').toLowerCase()]||{label:b.status||'Pending',className:'pending'};return `
          <article class="order-card booking-card">
            <div class="order-header"><span>Booking ID: <span class="order-id">#${esc(b.reservation_id)}</span></span><span class="status ${st.className}"><i class="fa-solid ${st.className==='approved'?'fa-circle-check':st.className==='rejected'?'fa-circle-xmark':'fa-hourglass-half'}"></i> ${esc(st.label)}</span></div>
            <div class="booking-details-grid"><div><span class="booking-label">Service</span><strong>${esc((b.service_type||'Service').replaceAll('_',' '))}</strong></div><div><span class="booking-label">Device / Part</span><strong>${esc(b.device_details||'—')}</strong></div><div><span class="booking-label">Preferred store visit</span><strong>${prettyDate(b.appointment_date)}</strong></div><div><span class="booking-label">Submitted</span><strong>${prettyDate(b.created_at)}</strong></div></div>
            <div class="booking-description"><span class="booking-label">Your request</span><p>${esc(b.notes||'No additional details provided.')}</p></div>
            <div class="booking-feedback"><span class="booking-label"><i class="fa-solid fa-comment-dots"></i> Staff feedback</span><p>${b.staff_feedback?esc(b.staff_feedback):'No feedback from staff yet.'}</p></div>
          </article>`;}).join(''):'<div class="card empty-state"><i class="fa-solid fa-calendar-xmark"></i><p>No service bookings in this category yet.</p></div>';
    };
    const {data,error}=await sbClient.from('service_reservation').select('reservation_id,service_type,status,appointment_date,notes,device_details,staff_feedback,created_at').eq('user_id',user.id).order('created_at',{ascending:false});
    if(error)throw error;bookings=data||[];render();
    $('#bookingTabs').addEventListener('click',e=>{const b=e.target.closest('.tab-btn');if(!b)return;$$('#bookingTabs .tab-btn').forEach(x=>x.classList.toggle('active',x===b));tab=b.dataset.tab;render();});
};

pages.settings = async () => {
    const user=guard();if(!user)return;
    await fetchProfileAndAddress(user.id);
    const pf=$('#profileForm'),af=$('#addressForm');
    ['username','name','email','phone'].forEach(k=>{if(pf.elements[k])pf.elements[k].value=user[k]||'';});
    ['address','city','zip'].forEach(k=>{if(af.elements[k])af.elements[k].value=user[k]||'';});
    pf.addEventListener('submit',async e=>{
        e.preventDefault();const d=Object.fromEntries(new FormData(pf));
        try{
            const {error}=await sbClient.from('profiles').update({username:d.username,name:d.name,email:d.email,phone:d.phone}).eq('id',user.id);if(error)throw error;
            const {error:ue}=await sbClient.from('users').update({username:d.username,name:d.name,email:d.email}).eq('user_id',user.id);if(ue)throw ue;
            if(d.email!==user.email){const {error:ae}=await sbClient.auth.updateUser({email:d.email});if(ae)throw ae;}
            await loadAuthUser();toast('Profile updated.');
        }catch(err){toast(err.message,'error');}
    });
    af.addEventListener('submit',async e=>{
        e.preventDefault();const d=Object.fromEntries(new FormData(af));
        try{
            const {data:old}=await sbClient.from('address').select('address_id').eq('user_id',user.id).eq('is_default',true).maybeSingle();
            const payload={user_id:user.id,street:d.address,city:d.city,postal_code:d.zip,country:'PH',is_default:true};
            const result=old?await sbClient.from('address').update(payload).eq('address_id',old.address_id):await sbClient.from('address').insert(payload);
            if(result.error)throw result.error;
            const {error}=await sbClient.from('profiles').update({address:d.address,city:d.city,zip:d.zip}).eq('id',user.id);if(error)throw error;
            await loadAuthUser();toast('Shipping address updated.');
        }catch(err){toast(err.message,'error');}
    });
    $('#passwordForm').addEventListener('submit',async e=>{
        e.preventDefault();const d=Object.fromEntries(new FormData(e.target));
        if(d.next.length<8)return toast('Password must be at least 8 characters.','error');
        if(d.next!==d.confirm)return toast('New passwords do not match.','error');
        const {error}=await sbClient.auth.updateUser({password:d.next});
        if(error)return toast(error.message,'error');
        e.target.reset();toast('Password updated.');
    });
};

pages.staff = async () => {
    const staff=guard(['staff','admin']);if(!staff)return;
    const tbody=$('#queueBody');
    const load=async()=>{
        const {data,error}=await sbClient.from('orders').select('*,users(username,email,name),address(*),order_item(*)').order('created_at',{ascending:false});
        if(error)throw error;
        const orders=data||[];
        tbody.innerHTML=orders.length?orders.map(o=>{
            const items=o.order_item||[], customer=o.users?.name||o.users?.email||'Customer';
            const action=o.order_status==='toreceive'?'<button class="btn btn-sm btn-ok" data-complete>Order Completed</button>':o.order_status==='completed'?'<span class="status">Completed</span>':'<button class="btn btn-sm btn-primary" data-ship>Update Status</button>';
            return `<tr data-id="${o.order_id}"><td>#${o.order_id}<button class="btn btn-sm btn-soft" data-expand>Details</button></td><td>${esc(customer)}</td><td>${items.length} item(s)</td><td>${money(o.total_amount)}</td><td><span class="status">${esc(o.order_status)}</span></td><td><input type="date" class="edit-input date" data-date value="${o.delivery_date||''}"></td><td>${esc(o.customer_note||'—')}</td><td>${action}${o.proof_image_url?`<br><a href="${esc(o.proof_image_url)}" target="_blank" rel="noopener">View proof</a>`:''}</td></tr>
            <tr class="order-detail-row" data-detail-for="${o.order_id}" hidden><td colspan="8"><strong>Shipping address:</strong> ${esc([o.address?.street,o.address?.city,o.address?.postal_code,o.address?.country].filter(Boolean).join(', ')||'No address')}<br><strong>Items:</strong><ul>${items.map(i=>`<li>${esc(i.item_name||'Component')} × ${i.quantity} — ${money(i.unit_price)}</li>`).join('')}</ul><strong>Customer note:</strong> ${esc(o.customer_note||'None')}</td></tr>`;
        }).join(''):'<tr><td colspan="8" class="table-empty">No orders yet.</td></tr>';
        $('#mItems').textContent=Products.list.reduce((n,p)=>n+p.stock,0);
        $('#mSale').textContent=money(orders.filter(o=>o.order_status!=='pending').reduce((n,o)=>n+Number(o.total_amount),0));
        const {count}=await sbClient.from('service_reservation').select('*',{count:'exact',head:true});$('#mBookings').textContent=count||0;
        $('#mReports').textContent='—';
    };
    // Initialize inventory independently: an order/ticket query must never prevent
    // staff from viewing or managing components.
    setupInventory($('#inventoryBody'),{addButton:$('#addProductBtn')});
    const ticketsBody=$('#staffTicketsBody');
    const loadStaffTickets=async()=>{
        const [{data:w,error:we},{data:s,error:se}]=await Promise.all([
            sbClient.from('warranty_request').select('*,component:component!warranty_request_product_id_fkey(name)').order('created_at',{ascending:false}),
            sbClient.from('service_reservation').select('*').order('created_at',{ascending:false})
        ]);
        if(we)throw we;if(se)throw se;
        const warrantyRows=(w||[]).map(x=>({kind:'warranty',id:x.warranty_id,table:'warranty_request',key:'warranty_id',customer:x.customer_name||x.customer_email||'Customer',device:x.component?.name||x.product_id,type:'Warranty',details:x.description,contact:[x.customer_email,x.customer_phone].filter(Boolean).join(' / '),date:x.created_at,status:x.status}));
        const serviceRows=(s||[]).map(x=>({kind:'service',id:x.reservation_id,table:'service_reservation',key:'reservation_id',customer:x.customer_name||x.customer_email||'Customer',device:x.device_details||x.service_type,type:'Service',details:x.notes,contact:[x.customer_email,x.customer_phone].filter(Boolean).join(' / '),date:x.appointment_date,status:String(x.status||'requested').toLowerCase(),feedback:x.staff_feedback||''}));
        const rows=[...serviceRows,...warrantyRows];
        ticketsBody.innerHTML=rows.map(x=>{
            if(x.kind==='service'){
                const final=['approved','rejected'].includes(x.status),label=x.status==='requested'?'Pending':x.status.charAt(0).toUpperCase()+x.status.slice(1),cls=x.status==='approved'?'approved':x.status==='rejected'?'rejected':'pending';
                const actions=final?'<span class="stock">Decision locked</span>':'<button class="btn btn-sm btn-ok" data-service-decision="approved">Approve</button><button class="btn btn-sm btn-outline danger" data-service-decision="rejected">Reject</button>';
                return `<tr data-kind="service" data-id="${esc(x.id)}"><td>#${esc(x.id)}</td><td>${esc(x.customer)}</td><td>${esc(x.device||'')}</td><td>Service</td><td><details><summary>View details</summary>${esc(x.details||'No details')}<br>Contact: ${esc(x.contact||'Not provided')}</details></td><td><strong>${prettyBookingDate(x.date)}</strong></td><td><span class="status ${cls}">${esc(label)}</span></td><td><div class="feedback-editor"><textarea class="edit-input" data-feedback rows="2" maxlength="1000" placeholder="Write feedback for the customer">${esc(x.feedback)}</textarea><button class="btn btn-sm btn-soft" data-save-feedback>Save feedback</button></div></td><td class="actions">${actions}${final?'<button class="btn btn-sm btn-danger" data-delete-booking>Delete</button>':''}</td></tr>`;
            }
            return `<tr data-kind="warranty" data-table="warranty_request" data-key="warranty_id" data-id="${esc(x.id)}"><td>#${esc(x.id)}</td><td>${esc(x.customer)}</td><td>${esc(x.device||'')}</td><td>Warranty</td><td><details><summary>View details</summary>${esc(x.details||'No details')}<br>Contact: ${esc(x.contact||'Not provided')}</details></td><td>${prettyBookingDate(x.date)}</td><td>${esc(x.status)}</td><td>—</td><td><select class="edit-input" data-ticket-status><option value="${esc(x.status)}">${esc(x.status)}</option><option value="in_progress">In progress</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="resolved">Resolved</option></select></td></tr>`;
        }).join('')||'<tr><td colspan="9" class="table-empty">No service or warranty requests.</td></tr>';
    };
    const prettyBookingDate=value=>{if(!value)return 'Not provided';const raw=String(value).slice(0,10);const d=new Date(raw+'T00:00:00');return Number.isNaN(d.getTime())?raw:d.toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'});};
    load().catch(err=>{console.error('Staff order queue:',err);tbody.innerHTML=`<tr><td colspan="8" class="table-empty">${esc(err.message||'Unable to load orders.')}</td></tr>`;});
    loadStaffTickets().catch(err=>{console.error('Staff service queue:',err);ticketsBody.innerHTML=`<tr><td colspan="9" class="table-empty">${esc(err.message||'Unable to load service requests.')}</td></tr>`;});
    ticketsBody.addEventListener('click',async e=>{
        const row=e.target.closest('tr[data-id]');if(!row)return;
        const decision=e.target.closest('[data-service-decision]');
        if(decision){
            const next=decision.dataset.serviceDecision;
            if(!confirm(`Are you sure you want to ${next} this booking? This decision cannot be changed.`))return;
            const {data,error}=await sbClient.from('service_reservation').update({status:next}).eq('reservation_id',row.dataset.id).eq('status','requested').select('reservation_id').maybeSingle();
            if(error)return toast(error.message,'error');if(!data)return toast('This booking has already been decided. Refreshing the list.','error');
            await loadStaffTickets();toast(`Booking ${next}. The decision is now locked.`);return;
        }
        if(e.target.closest('[data-save-feedback]')){
            const feedback=$('[data-feedback]',row).value.trim();
            const {error}=await sbClient.from('service_reservation').update({staff_feedback:feedback}).eq('reservation_id',row.dataset.id);
            if(error)return toast(error.message,'error');toast('Feedback saved for the customer.');return;
        }
        if(e.target.closest('[data-delete-booking]')){
            if(!confirm('Delete this finalized booking? This cannot be undone.'))return;
            const {error}=await sbClient.from('service_reservation').delete().eq('reservation_id',row.dataset.id).in('status',['approved','rejected']);
            if(error)return toast(error.message,'error');await loadStaffTickets();toast('Booking deleted.');
        }
    });
    ticketsBody.addEventListener('change',async e=>{
        if(!e.target.matches('[data-ticket-status]'))return;
        const row=e.target.closest('tr'),{error}=await sbClient.from('warranty_request').update({status:e.target.value}).eq('warranty_id',row.dataset.id);
        if(error)return toast(error.message,'error');toast('Warranty request status updated.');
    });
    tbody.addEventListener('click',async e=>{
        const row=e.target.closest('tr[data-id]');if(!row)return;
        if(e.target.closest('[data-expand]')){const detail=$(`[data-detail-for="${row.dataset.id}"]`,tbody);detail.hidden=!detail.hidden;}
        if(e.target.closest('[data-ship]')){
            const date=$('[data-date]',row).value;
            if(!date)return toast('Please set the delivery date first.','error');
            const current=row.querySelector('.status')?.textContent?.trim().toLowerCase();
            const next=current==='pending'?'toship':current==='toship'?'toreceive':null;
            if(!next)return toast('This order cannot be moved to the next shipping stage.','error');
            const {error}=await sbClient.from('orders').update({order_status:next,delivery_date:date,shipped_at:next==='toreceive'?new Date().toISOString():null}).eq('order_id',row.dataset.id);
            if(error)return toast(error.message,'error');
            await load();toast(next==='toship'?'Order accepted for fulfillment.':'Order marked as shipped.');
        }
    });
    let completingOrderId=null;
    const proofInput=$('#proofInput');
    tbody.addEventListener('click',e=>{
        const btn=e.target.closest('[data-complete]');if(!btn)return;
        completingOrderId=btn.closest('tr').dataset.id;proofInput.click();
    });
    proofInput.addEventListener('change',async()=>{
        const file=proofInput.files?.[0];if(!file||!completingOrderId)return;
        if(!file.type.startsWith('image/'))return toast('Please select an image file.','error');
        try{
            const ext=(file.name.split('.').pop()||'jpg').replace(/[^a-z0-9]/gi,'').toLowerCase()||'jpg';
            const path=`delivery-proof/${completingOrderId}-${Date.now()}.${ext}`;
            const {error:uploadError}=await sbClient.storage.from(IMAGE_BUCKET).upload(path,file,{contentType:file.type,upsert:false});
            if(uploadError)throw uploadError;
            const {data:{publicUrl}}=sbClient.storage.from(IMAGE_BUCKET).getPublicUrl(path);
            const {error}=await sbClient.from('orders').update({order_status:'completed',proof_image_url:publicUrl,received_at:new Date().toISOString()}).eq('order_id',completingOrderId);
            if(error)throw error;
            completingOrderId=null;proofInput.value='';await load();toast('Order completed and delivery proof saved.');
        }catch(err){toast(err.message||'Could not save delivery proof.','error');}
    });
    tbody.addEventListener('change',async e=>{
        if(!e.target.matches('[data-date]'))return;
        const {error}=await sbClient.from('orders').update({delivery_date:e.target.value||null}).eq('order_id',e.target.closest('tr').dataset.id);
        if(error)return toast(error.message,'error');toast('Delivery date saved.');
    });
    $('#reportBtn').addEventListener('click',async()=>{
        try {
            const {data,error}=await sbClient.from('orders')
                .select('order_id,created_at,order_status,total_amount,delivery_date,user_id')
                .order('created_at',{ascending:false});
            if(error)throw error;
            const rows=[['Order ID','Created At','Status','Total Amount','Delivery Date','Customer ID'],
                ...(data||[]).map(o=>[o.order_id,o.created_at,o.order_status,o.total_amount,o.delivery_date||'',o.user_id])];
            const csv=rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\\r\\n');
            const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
            const a=document.createElement('a');a.href=url;a.download=`iwantpc-orders-${new Date().toISOString().slice(0,10)}.csv`;
            document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
            toast('Order report downloaded.');
        } catch(err) { toast(err.message||'Could not generate report.','error'); }
    });
    makeDashboardTablesCollapsible(document,[['main .card:nth-of-type(1)','Order fulfillment records'],['main .card:nth-of-type(2)','Product inventory'],['main .card:nth-of-type(3)','Service and warranty requests']]);
};


function makeDashboardTablesCollapsible(root, labels) {
    labels.forEach(([selector,label])=>{
        const section=$(selector,root), wrap=section?.querySelector('.table-wrap');
        if(!wrap || wrap.parentElement.tagName==='DETAILS')return;
        const details=document.createElement('details'); details.className='dashboard-table-collapse'; details.open=true;
        const summary=document.createElement('summary'); summary.textContent=label;
        wrap.parentNode.insertBefore(details,wrap); details.append(summary,wrap);
    });
}

pages.admin = async () => {
    const admin=guard(['admin']);if(!admin)return;
    const usersBody=$('#usersBody');
    const loadUsers=async()=>{
        const {data,error}=await sbClient.from('users').select('user_id,username,email,role,user_role,is_active,name').order('created_at',{ascending:false});
        if(error)throw error;
        usersBody.innerHTML=(data||[]).map(u=>`<tr data-id="${u.user_id}"><td>${u.user_id.slice(0,8)}</td><td>${esc(u.name||u.username)}</td><td>${esc(u.email)}</td><td><select class="edit-input" data-role ${u.user_id===admin.id?'disabled':''}>${['admin','staff','customer'].map(r=>`<option value="${r}" ${(u.role||u.user_role)===r?'selected':''}>${r}</option>`).join('')}</select></td><td>${u.is_active?'Active':'Suspended'}</td><td>${u.user_id===admin.id?'You':`<button class="btn btn-sm btn-soft" data-toggle>${u.is_active?'Suspend':'Reactivate'}</button>`}</td></tr>`).join('');
        $('#mAccounts').textContent=(data||[]).length;
    };
    // Inventory is a first-class admin feature and must not depend on user/ticket queries.
    setupInventory($('#inventoryBody'),{canDelete:true,addButton:$('#addProductBtn')});
    loadUsers().catch(err=>{
        console.error('Admin users:',err);
        usersBody.innerHTML=`<tr><td colspan="6" class="table-empty">${esc(err.message||'Unable to load user accounts.')}</td></tr>`;
    });
    usersBody.addEventListener('change',async e=>{
        if(!e.target.matches('[data-role]'))return;
        const id=e.target.closest('tr').dataset.id,role=e.target.value;
        const {error}=await sbClient.from('users').update({role,user_role:role}).eq('user_id',id);
        if(error){toast(error.message,'error');return loadUsers();}toast('User role updated.');
    });
    usersBody.addEventListener('click',async e=>{
        if(!e.target.closest('[data-toggle]'))return;
        const row=e.target.closest('tr'),id=row.dataset.id;
        const active=row.children[4].textContent.trim()!=='Active';
        const {error}=await sbClient.from('users').update({is_active:active}).eq('user_id',id);
        if(error)return toast(error.message,'error');await loadUsers();toast('Account status updated.');
    });
    $('#addUserBtn').addEventListener('click',async()=>{
        const name=(prompt('Full name for the new account:')||'').trim();
        if(!name)return;
        const email=(prompt('Email address for the invitation:')||'').trim().toLowerCase();
        if(!email)return;
        if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email))return toast('Enter a valid email address.','error');
        const role=(prompt('Assign role: admin, staff, or customer','staff')||'').trim().toLowerCase();
        if(!['admin','staff','customer'].includes(role))return toast('Role must be admin, staff, or customer.','error');
        try{
            const {data,error}=await sbClient.functions.invoke('admin-invite-user',{body:{name,email,role}});
            if(error)throw error;
            await loadUsers();
            toast(data?.message||`Invitation sent to ${email}.`);
        }catch(err){
            console.error('Admin invite:',err);
            toast(err.message||'Could not send the account invitation.','error');
        }
    });
    sbClient.from('orders').select('total_amount,order_status').then(({data,error})=>{
        if(error)throw error;
        $('#mOrders').textContent=(data||[]).length;
        $('#mRevenue').textContent=money((data||[]).filter(o=>!['pending','cancelled'].includes(String(o.order_status))).reduce((n,o)=>n+Number(o.total_amount||0),0));
    }).catch(err=>{
        console.error('Admin order metrics:',err);
        $('#mOrders').textContent='—';$('#mRevenue').textContent='—';
    });
    makeDashboardTablesCollapsible(document,[['main .card:nth-of-type(1)','Product inventory'],['main .card:nth-of-type(2)','User accounts']]);
};

/* End Supabase integration overrides */

/* ===== Boot ===== */
document.addEventListener('DOMContentLoaded', async () => {
    const footer = $('#footer');
    if (footer) {
        footer.className = 'footer';
        footer.innerHTML = '<div class="footer-container"><p class="copyright">&copy; 2026 iWant PC Inc. All rights reserved.</p><div class="footer-links"><a href="#">Privacy Policy</a><a href="#">Terms of Service</a></div></div>';
    }
    document.addEventListener('click', async e => {
        if (e.target.closest('[data-logout]')) { e.preventDefault(); await sbClient.auth.signOut(); AUTH_USER=null; location.href='login.html'; }
    });
    try {
        await loadAuthUser();
        if (AUTH_USER) await fetchProfileAndAddress(AUTH_USER.id);
        const page = document.body.dataset.page;
        const publicPages = ['login','signup'];
        if (!AUTH_USER && !publicPages.includes(page)) { location.replace('login.html'); return; }
        if (AUTH_USER && publicPages.includes(page)) { location.replace(homeFor(AUTH_USER.role)); return; }
        if (AUTH_USER) await loadCartFromDatabase().catch(err => console.warn('Cart could not be hydrated:',err.message));
        const init = pages[page];
        if (init) await init();
    } catch (err) {
        console.error(err);
        toast(esc(err.message || 'Something went wrong loading this page.'), 'error');
    }
});
