/* =========================================================
   Sika — application commerçant (prototype autonome)
   Données stockées localement dans le navigateur.
   ========================================================= */
'use strict';

const STORAGE_KEY = 'sika.app.v1';
const APP_VERSION = '1.0.0';
const CURRENCY = 'FCFA';
const VIEWS = ['overview', 'transactions', 'documents', 'scanner', 'report', 'financing', 'settings'];
const INCOME_CATEGORIES = ['Ventes', 'Vente en gros', 'Livraison', 'Autre revenu'];
const EXPENSE_CATEGORIES = ['Achats', 'Loyer', 'Transport', 'Électricité', 'Salaire', 'Communication', 'Autres dépenses'];
const ALL_CATEGORIES = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES];
const CATEGORY_COLORS = {
  'Ventes': '#21765a',
  'Vente en gros': '#4a8f73',
  'Livraison': '#7ea992',
  'Autre revenu': '#94a099',
  'Achats': '#d3a04f',
  'Loyer': '#bf604b',
  'Transport': '#5f829b',
  'Électricité': '#a97e3f',
  'Salaire': '#7b699c',
  'Communication': '#78979b',
  'Autres dépenses': '#9b8c75'
};

let state = null;
let currentView = 'overview';
let tesseractScriptPromise = null;
let activeOCRWorker = null;
let printCleanupTimer = null;

const txFilters = { search: '', type: 'all', period: 'all', visible: 12 };
const docFilters = { type: 'all' };
const scannerState = {
  phase: 'idle',
  fileName: '',
  image: '',
  extraction: null,
  savedTransactionId: null,
  token: 0,
  fallback: false,
  ocrText: ''
};

/* ---------- Petites fonctions utilitaires ---------- */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function icon(name, className = '') {
  return `<svg class="icon ${className}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

function escapeHTML(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
}

function escapeXml(value) {
  return String(value == null ? '' : value).replace(/[<>&"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  }[char]));
}

function uid(prefix) {
  if (window.crypto && crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getInitials(name, fallback = 'SI') {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return fallback;
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

function getBusinessInitials(name) {
  const ignored = new Set(['chez', 'de', 'du', 'des', 'la', 'le', 'les', 'et']);
  const words = String(name || '').trim().split(/\s+/).filter(word => word && !ignored.has(word.toLowerCase()));
  if (!words.length) return 'SI';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

function pad(number) { return String(number).padStart(2, '0'); }
function toISODate(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function todayISO() { return toISODate(new Date()); }
function parseISODate(value) {
  if (!value) return new Date();
  const [year, month, day] = String(value).split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1, 12, 0, 0);
}
function addDays(date, amount) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
  copy.setDate(copy.getDate() + amount);
  return copy;
}
function monthStart(offset = 0, base = new Date()) {
  return new Date(base.getFullYear(), base.getMonth() + offset, 1, 12, 0, 0);
}
function monthEnd(offset = 0, base = new Date()) {
  return new Date(base.getFullYear(), base.getMonth() + offset + 1, 0, 12, 0, 0);
}

const numberFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

function formatNumber(value) {
  return numberFormatter.format(Math.round(Number(value) || 0));
}
function formatAmount(value) {
  return `${formatNumber(value)} ${CURRENCY}`;
}
function formatCompact(value) {
  const number = Math.abs(Number(value) || 0);
  if (number >= 1000000) return `${decimalFormatter.format(number / 1000000)} M`;
  if (number >= 1000) return `${decimalFormatter.format(number / 1000)} k`;
  return formatNumber(number);
}
function formatPercent(value) {
  return decimalFormatter.format(Number(value) || 0);
}
function formatDate(value, options = {}) {
  const date = parseISODate(value);
  if (Number.isNaN(date.getTime())) return '—';
  const yearOption = options.year === false ? null : options.year === '2-digit' ? '2-digit' : 'numeric';
  const format = new Intl.DateTimeFormat('fr-FR', {
    day: options.day || 'numeric',
    month: options.month || 'short',
    ...(yearOption ? { year: yearOption } : {})
  });
  return format.format(date).replace(/\./g, options.keepDot ? '.' : '');
}
function formatDateShort(value) {
  const date = parseISODate(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(date).replace(/\./g, '');
}
function formatMonth(value, long = false) {
  return new Intl.DateTimeFormat('fr-FR', { month: long ? 'long' : 'short' }).format(parseISODate(value)).replace(/\./g, '');
}
function capitalize(value) {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}
function todayLongLabel() {
  return capitalize(new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()));
}
function formatRange(startISO, endISO) {
  const start = parseISODate(startISO);
  const end = parseISODate(endISO);
  const year = end.getFullYear();
  const startDay = start.getDate() === 1 ? '1er' : String(start.getDate());
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${startDay} – ${end.getDate()} ${formatMonth(endISO, true)} ${year}`;
  }
  return `${startDay} ${formatMonth(startISO, false)} – ${end.getDate()} ${formatMonth(endISO, true)} ${year}`;
}

function isInRange(dateValue, startISO, endISO) {
  return dateValue >= startISO && dateValue <= endISO;
}

function saveState(silent = false) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.error('Stockage local indisponible', error);
    if (!silent) {
      showToast('Impossible de sauvegarder', 'Le stockage du navigateur est saturé. Exportez vos données puis retirez un document.', 'error');
    }
    return false;
  }
}

/* ---------- Données de démonstration ---------- */
function createDefaultState() {
  const base = {
    version: 1,
    createdAt: new Date().toISOString(),
    profile: {
      owner: 'Awa Diallo',
      business: 'Épicerie Chez Awa',
      city: 'Abidjan',
      country: 'Côte d’Ivoire',
      phone: '+225 07 58 42 19 06',
      openingBalance: 75000,
      since: '2024-03-01'
    },
    transactions: [],
    documents: [],
    checklist: {
      identity: true,
      registry: true,
      mobileMoney: false,
      premises: false
    },
    preferences: {
      notifications: true,
      autoCategorize: true,
      aiInsights: true
    },
    chartPeriod: '6m',
    reportPeriod: 'month',
    loan: { amount: 1000000, months: 18 }
  };

  base.transactions = buildSeedTransactions();
  base.documents = buildSeedDocuments(base.transactions, base.profile);
  return base;
}

function buildSeedTransactions() {
  const transactions = [];
  const now = new Date();
  let counter = 0;

  const add = (date, data) => {
    const iso = toISODate(date);
    if (iso > todayISO()) return;
    counter += 1;
    transactions.push({
      id: `tx_demo_${counter}`,
      type: data.type,
      label: data.label,
      amount: Math.max(0, Math.round(data.amount)),
      date: iso,
      category: data.category,
      party: data.party || '',
      method: data.method || 'Espèces',
      note: data.note || '',
      source: 'demo',
      documentId: null,
      createdAt: new Date(`${iso}T${String(8 + (counter % 9)).padStart(2, '0')}:${String((counter * 7) % 60).padStart(2, '0')}:00`).toISOString()
    });
  };

  for (let offset = 5; offset >= 0; offset -= 1) {
    const start = monthStart(-offset);
    const year = start.getFullYear();
    const month = start.getMonth();
    const growth = 1 + (5 - offset) * 0.016;
    const weeklyBase = [104000, 96500, 112000, 121000];

    [3, 10, 17, 24].forEach((day, index) => {
      const amount = Math.round((weeklyBase[index] * growth + ((offset * 3 + index * 7) % 4) * 1500) / 500) * 500;
      add(new Date(year, month, day), {
        type: 'income',
        label: 'Ventes de la semaine',
        amount,
        category: 'Ventes',
        party: ['Clientèle du quartier', 'Clientèle du marché', 'Clients fidèles', 'Clientèle du quartier'][index],
        method: index % 2 === 0 ? 'Espèces' : 'Mobile Money',
        note: 'Ventes regroupées sur la semaine.'
      });
    });

    const wholesaleAmount = Math.round((92000 * growth + offset * 1700) / 500) * 500;
    add(new Date(year, month, 12), {
      type: 'income',
      label: 'Vente en gros — Restaurant Le Baobab',
      amount: wholesaleAmount,
      category: 'Vente en gros',
      party: 'Restaurant Le Baobab',
      method: 'Virement',
      note: 'Commande hebdomadaire livrée.'
    });

    add(new Date(year, month, 2), {
      type: 'expense',
      label: 'Loyer de la boutique',
      amount: 65000,
      category: 'Loyer',
      party: 'Propriétaire du local',
      method: 'Mobile Money',
      note: 'Loyer mensuel.'
    });

    const supplierOne = Math.round((80000 * growth + offset * 1100) / 500) * 500;
    const supplierTwo = Math.round((68000 * growth + offset * 900) / 500) * 500;
    add(new Date(year, month, 5), {
      type: 'expense',
      label: 'Achat de marchandises',
      amount: supplierOne,
      category: 'Achats',
      party: 'Grossiste Adjamé',
      method: 'Mobile Money',
      note: 'Réapprovisionnement du début de mois.'
    });
    add(new Date(year, month, 19), {
      type: 'expense',
      label: 'Achat de marchandises',
      amount: supplierTwo,
      category: 'Achats',
      party: 'Grossiste Adjamé',
      method: 'Espèces',
      note: 'Réassort produits secs et boissons.'
    });

    add(new Date(year, month, 8), {
      type: 'expense',
      label: 'Transport de marchandises',
      amount: 6000,
      category: 'Transport',
      party: 'Taxi Yopougon',
      method: 'Espèces'
    });
    add(new Date(year, month, 22), {
      type: 'expense',
      label: 'Livraison chez un client',
      amount: 4500,
      category: 'Transport',
      party: 'Coursier quartier',
      method: 'Espèces'
    });
    add(new Date(year, month, 10), {
      type: 'expense',
      label: 'Facture d’électricité',
      amount: 18500,
      category: 'Électricité',
      party: 'CIE',
      method: 'Mobile Money',
      note: 'Consommation de la boutique.'
    });
    add(new Date(year, month, 15), {
      type: 'expense',
      label: 'Crédit de communication',
      amount: 7500,
      category: 'Communication',
      party: 'Orange CI',
      method: 'Mobile Money'
    });
    add(new Date(year, month, 28), {
      type: 'expense',
      label: 'Salaire — Fatou',
      amount: 48000,
      category: 'Salaire',
      party: 'Fatou Koné',
      method: 'Mobile Money',
      note: 'Aide-vendeuse.'
    });
  }

  add(now, {
    type: 'income',
    label: 'Ventes de la journée',
    amount: 38500,
    category: 'Ventes',
    party: 'Comptoir',
    method: 'Espèces',
    note: 'Encaissements du jour.'
  });

  return transactions.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

function buildSeedDocuments(transactions, profile) {
  const latestMatching = predicate => transactions
    .filter(predicate)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))[0];

  const supplierTx = latestMatching(tx => tx.type === 'expense' && tx.category === 'Achats');
  const saleTx = latestMatching(tx => tx.type === 'income' && tx.label.includes('journée'))
    || latestMatching(tx => tx.type === 'income' && tx.category === 'Ventes');
  const transportTx = latestMatching(tx => tx.type === 'expense' && tx.category === 'Transport');
  const documents = [];

  if (supplierTx) {
    const first = Math.round((supplierTx.amount * 0.46) / 500) * 500;
    const second = Math.round((supplierTx.amount * 0.31) / 500) * 500;
    const items = [
      { description: 'Riz parfumé 25 kg × 2', amount: first },
      { description: 'Huile végétale 5 L × 3', amount: second },
      { description: 'Savons et divers épicerie', amount: supplierTx.amount - first - second }
    ];
    const doc = {
      id: 'doc_demo_supplier',
      transactionId: supplierTx.id,
      name: 'Facture_Grossiste_Adjame.svg',
      title: 'Facture — Grossiste Adjamé',
      type: 'expense',
      category: 'Achats',
      party: 'Grossiste Adjamé',
      amount: supplierTx.amount,
      date: supplierTx.date,
      status: 'Vérifié',
      confidence: 97,
      docNumber: 'FA-2026-1048',
      lineItems: items,
      uploadedAt: supplierTx.createdAt
    };
    doc.image = makeReceiptSvg({
      shop: 'GROSSISTE ADJAMÉ',
      kind: 'FACTURE',
      docNumber: doc.docNumber,
      date: doc.date,
      party: 'Épicerie Chez Awa',
      items,
      total: doc.amount,
      method: supplierTx.method,
      footer: 'Merci pour votre confiance — Paiement reçu'
    });
    documents.push(doc);
    supplierTx.documentId = doc.id;
    supplierTx.source = 'scan';
  }

  if (saleTx) {
    const first = Math.round((saleTx.amount * 0.52) / 500) * 500;
    const second = Math.round((saleTx.amount * 0.28) / 500) * 500;
    const items = [
      { description: 'Articles d’épicerie', amount: first },
      { description: 'Boissons et jus', amount: second },
      { description: 'Produits frais', amount: saleTx.amount - first - second }
    ];
    const doc = {
      id: 'doc_demo_sale',
      transactionId: saleTx.id,
      name: 'Recu_vente_jour.svg',
      title: 'Reçu de vente — Comptoir',
      type: 'income',
      category: 'Ventes',
      party: 'Comptoir',
      amount: saleTx.amount,
      date: saleTx.date,
      status: 'Vérifié',
      confidence: 98,
      docNumber: 'VTE-0851',
      lineItems: items,
      uploadedAt: saleTx.createdAt
    };
    doc.image = makeReceiptSvg({
      shop: profile.business.toUpperCase(),
      kind: 'REÇU DE VENTE',
      docNumber: doc.docNumber,
      date: doc.date,
      party: 'Client de la boutique',
      items,
      total: doc.amount,
      method: saleTx.method,
      footer: 'Merci de votre visite ! À bientôt.'
    });
    documents.push(doc);
    saleTx.documentId = doc.id;
    saleTx.source = 'scan';
  }

  if (transportTx) {
    const items = [
      { description: 'Course Yopougon – Adjamé', amount: transportTx.amount }
    ];
    const doc = {
      id: 'doc_demo_transport',
      transactionId: transportTx.id,
      name: 'Ticket_transport.svg',
      title: 'Ticket de transport',
      type: 'expense',
      category: 'Transport',
      party: transportTx.party,
      amount: transportTx.amount,
      date: transportTx.date,
      status: 'Vérifié',
      confidence: 94,
      docNumber: 'TR-2291',
      lineItems: items,
      uploadedAt: transportTx.createdAt
    };
    doc.image = makeReceiptSvg({
      shop: 'TAXI YOPOUGON',
      kind: 'TICKET',
      docNumber: doc.docNumber,
      date: doc.date,
      party: 'Épicerie Chez Awa',
      items,
      total: doc.amount,
      method: transportTx.method,
      footer: 'Bon voyage — Merci'
    });
    documents.push(doc);
    transportTx.documentId = doc.id;
    transportTx.source = 'scan';
  }

  return documents;
}

/* ---------- Générateur de faux reçu illustratif ---------- */
function makeReceiptSvg({ shop, kind, docNumber, date, party, items, total, method, footer }) {
  const width = 620;
  const itemRows = items.slice(0, 5);
  const rowStart = 330;
  const rowHeight = 48;
  const totalY = rowStart + itemRows.length * rowHeight + 30;
  const height = Math.max(790, totalY + 230);
  const rows = itemRows.map((item, index) => {
    const y = rowStart + index * rowHeight;
    return `
      <line x1="60" y1="${y + 26}" x2="560" y2="${y + 26}" stroke="#e9e2d4" stroke-width="1" stroke-dasharray="2 5"/>
      <text x="60" y="${y}" font-family="Courier New, monospace" font-size="17" fill="#283d34">${escapeXml(item.description)}</text>
      <text x="560" y="${y}" text-anchor="end" font-family="Courier New, monospace" font-size="17" fill="#283d34">${escapeXml(formatNumber(item.amount))}</text>`;
  }).join('');

  const barcodeBars = Array.from({ length: 43 }, (_, index) => {
    const barWidth = [1, 2, 3][index % 3];
    const x = 196 + index * 5.3;
    return `<rect x="${x.toFixed(1)}" y="${height - 90}" width="${barWidth}" height="38" fill="#1e3a2f"/>`;
  }).join('');

  const initials = shop.split(/\s+/).slice(0, 2).map(word => word[0]).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="#fffdf8"/>
    <rect width="${width}" height="9" fill="#0d3b2e"/>
    <rect x="42" y="42" width="42" height="42" rx="12" fill="#0d3b2e"/>
    <text x="63" y="69" text-anchor="middle" font-family="Arial, sans-serif" font-size="17" font-weight="700" fill="#eab45f">${escapeXml(initials)}</text>
    <text x="98" y="58" font-family="Courier New, monospace" font-size="17" font-weight="700" fill="#0d3b2e">${escapeXml(shop)}</text>
    <text x="98" y="79" font-family="Courier New, monospace" font-size="11" fill="#7a8b82">Commerce de proximité · Abidjan</text>
    <text x="560" y="58" text-anchor="end" font-family="Courier New, monospace" font-size="11" font-weight="700" letter-spacing="2" fill="#a96f16">${escapeXml(kind)}</text>
    <text x="560" y="78" text-anchor="end" font-family="Courier New, monospace" font-size="10" fill="#7a8b82">${escapeXml(docNumber)}</text>
    <line x1="42" y1="112" x2="578" y2="112" stroke="#0d3b2e" stroke-width="1.2"/>
    <text x="60" y="145" font-family="Courier New, monospace" font-size="11" fill="#7a8b82">DATE</text>
    <text x="60" y="166" font-family="Courier New, monospace" font-size="16" fill="#283d34">${escapeXml(formatDate(date, { year: true }))}</text>
    <text x="330" y="145" font-family="Courier New, monospace" font-size="11" fill="#7a8b82">CLIENT / BÉNÉFICIAIRE</text>
    <text x="330" y="166" font-family="Courier New, monospace" font-size="16" fill="#283d34">${escapeXml(party)}</text>
    <rect x="42" y="200" width="536" height="35" rx="5" fill="#f1ede2"/>
    <text x="60" y="223" font-family="Courier New, monospace" font-size="11" font-weight="700" letter-spacing="1.6" fill="#65776e">DÉSIGNATION</text>
    <text x="560" y="223" text-anchor="end" font-family="Courier New, monospace" font-size="11" font-weight="700" letter-spacing="1.6" fill="#65776e">MONTANT</text>
    <line x1="42" y1="250" x2="578" y2="250" stroke="#e0d8c8" stroke-width="1"/>
    <text x="60" y="277" font-family="Courier New, monospace" font-size="11" fill="#7a8b82">DÉTAIL DES ARTICLES</text>
    ${rows}
    <line x1="42" y1="${totalY - 4}" x2="578" y2="${totalY - 4}" stroke="#0d3b2e" stroke-width="1.2"/>
    <text x="60" y="${totalY + 27}" font-family="Courier New, monospace" font-size="17" font-weight="700" fill="#0d3b2e">TOTAL</text>
    <text x="560" y="${totalY + 28}" text-anchor="end" font-family="Courier New, monospace" font-size="26" font-weight="700" fill="#0d3b2e">${escapeXml(formatNumber(total))} FCFA</text>
    <text x="60" y="${totalY + 58}" font-family="Courier New, monospace" font-size="11" fill="#7a8b82">RÈGLEMENT</text>
    <text x="560" y="${totalY + 58}" text-anchor="end" font-family="Courier New, monospace" font-size="12" fill="#283d34">${escapeXml(method)}</text>
    <line x1="42" y1="${totalY + 84}" x2="578" y2="${totalY + 84}" stroke="#e9e2d4" stroke-width="1" stroke-dasharray="3 5"/>
    <text x="310" y="${totalY + 115}" text-anchor="middle" font-family="Courier New, monospace" font-size="12" fill="#52665c">${escapeXml(footer || 'Merci de votre confiance')}</text>
    <text x="310" y="${height - 114}" text-anchor="middle" font-family="Courier New, monospace" font-size="10" letter-spacing="2" fill="#94a099">DOCUMENT ILLUSTRATIF</text>
    ${barcodeBars}
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/* ---------- Chargement de l'application ---------- */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.transactions) || !parsed.profile) return null;
    parsed.documents = Array.isArray(parsed.documents) ? parsed.documents : [];
    parsed.checklist = parsed.checklist || { identity: false, registry: false, mobileMoney: false, premises: false };
    parsed.preferences = parsed.preferences || { notifications: true, autoCategorize: true, aiInsights: true };
    parsed.chartPeriod = parsed.chartPeriod || '6m';
    parsed.reportPeriod = parsed.reportPeriod || 'month';
    parsed.loan = parsed.loan || { amount: 1000000, months: 18 };
    return parsed;
  } catch (error) {
    console.warn('Données locales illisibles', error);
    return null;
  }
}

state = loadState();
if (!state) {
  state = createDefaultState();
  saveState(true);
}

/* ---------- Calculs financiers ---------- */
function sortedTransactions() {
  return [...state.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

function transactionsInRange(startISO, endISO) {
  return state.transactions.filter(tx => isInRange(tx.date, startISO, endISO));
}

function sumTransactions(transactions) {
  return transactions.reduce((total, tx) => total + Number(tx.amount || 0), 0);
}

function getFinancials(startISO, endISO) {
  const transactions = transactionsInRange(startISO, endISO);
  const income = sumTransactions(transactions.filter(tx => tx.type === 'income'));
  const expense = sumTransactions(transactions.filter(tx => tx.type === 'expense'));
  const net = income - expense;
  return {
    transactions,
    count: transactions.length,
    income,
    expense,
    net,
    margin: income > 0 ? (net / income) * 100 : 0
  };
}

function daysInclusive(startISO, endISO) {
  return Math.max(1, Math.round((parseISODate(endISO) - parseISODate(startISO)) / 86400000) + 1);
}

function getPreviousRange(startISO, endISO) {
  const days = daysInclusive(startISO, endISO);
  const previousEnd = addDays(parseISODate(startISO), -1);
  const previousStart = addDays(previousEnd, -(days - 1));
  return { start: toISODate(previousStart), end: toISODate(previousEnd) };
}

function getPeriodRange(key) {
  const now = new Date();
  const end = todayISO();
  if (key === 'last30') {
    return { start: toISODate(addDays(now, -29)), end };
  }
  if (key === 'quarter') {
    return { start: toISODate(monthStart(-2)), end };
  }
  if (key === 'semester') {
    return { start: toISODate(monthStart(-5)), end };
  }
  return { start: toISODate(monthStart(0)), end };
}

function getPeriodData(key) {
  const range = getPeriodRange(key);
  const previousRange = getPreviousRange(range.start, range.end);
  const current = getFinancials(range.start, range.end);
  const previous = getFinancials(previousRange.start, previousRange.end);
  return {
    key,
    range,
    previousRange,
    current,
    previous,
    label: formatRange(range.start, range.end)
  };
}

function getMonthlySeries(count = 6) {
  const series = [];
  const now = new Date();
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const start = monthStart(-offset);
    const startISO = toISODate(start);
    const endISO = offset === 0 ? todayISO() : toISODate(monthEnd(-offset));
    const transactions = transactionsInRange(startISO, endISO);
    const income = sumTransactions(transactions.filter(tx => tx.type === 'income'));
    const expense = sumTransactions(transactions.filter(tx => tx.type === 'expense'));
    series.push({
      key: startISO.slice(0, 7),
      label: capitalize(formatMonth(startISO)),
      fullLabel: `${capitalize(new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(start))}`,
      start: startISO,
      end: endISO,
      income,
      expense,
      net: income - expense
    });
  }
  return series;
}

function getBreakdown(transactions, type = 'expense') {
  const groups = new Map();
  transactions.filter(tx => tx.type === type).forEach(tx => {
    groups.set(tx.category, (groups.get(tx.category) || 0) + Number(tx.amount || 0));
  });
  const total = Array.from(groups.values()).reduce((sum, value) => sum + value, 0);
  return Array.from(groups.entries())
    .map(([category, amount]) => ({
      category,
      amount,
      share: total ? (amount / total) * 100 : 0,
      color: CATEGORY_COLORS[category] || '#6f8078'
    }))
    .sort((a, b) => b.amount - a.amount);
}

function compareMetric(currentValue, previousValue, inverse = false) {
  if (!previousValue) {
    return { className: 'neutral', text: currentValue ? 'Nouveau' : 'Aucune donnée', icon: 'info' };
  }
  const change = ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
  if (Math.abs(change) < 0.5) return { className: 'neutral', text: 'Stable', icon: 'info' };
  const isGood = inverse ? change < 0 : change > 0;
  return {
    className: isGood ? 'positive' : 'negative',
    text: `${change > 0 ? '+' : ''}${formatPercent(change)} %`,
    icon: change > 0 ? 'arrow-up-right' : 'arrow-down-left'
  };
}

function trendBadgeHTML(trend) {
  return `<span class="trend ${trend.className}">${icon(trend.icon)}<span>${trend.text}</span></span>`;
}

function getReadiness() {
  const activeMonths = getMonthlySeries(6).filter(month => month.income > 0 || month.expense > 0).length;
  const positiveMonths = getMonthlySeries(6).filter(month => month.net > 0).length;
  const semester = getFinancials(toISODate(monthStart(-5)), todayISO());
  const currentMonth = getFinancials(toISODate(monthStart(0)), todayISO());
  const checklist = getChecklistItems(activeMonths);
  const checklistDone = checklist.filter(item => item.done).length;
  const docs = state.documents.length;
  const margin = semester.income > 0 ? (semester.net / semester.income) * 100 : 0;
  const avgMonthlyNet = getMonthlySeries(3).reduce((sum, month) => sum + Math.max(0, month.net), 0) / 3;

  const components = [
    {
      key: 'history',
      label: 'Historique d’activité',
      detail: `${activeMonths} mois documenté${activeMonths > 1 ? 's' : ''}`,
      score: Math.round(Math.min(1, activeMonths / 6) * 20),
      max: 20,
      icon: 'clock',
      tone: activeMonths >= 4 ? 'green' : 'amber'
    },
    {
      key: 'regularity',
      label: 'Régularité des revenus',
      detail: `${positiveMonths} mois bénéficiaire${positiveMonths > 1 ? 's' : ''} sur ${activeMonths || 0}`,
      score: activeMonths ? Math.round((positiveMonths / activeMonths) * 20) : 0,
      max: 20,
      icon: 'trending',
      tone: positiveMonths >= 4 ? 'green' : 'amber'
    },
    {
      key: 'profitability',
      label: 'Rentabilité',
      detail: `Marge nette moyenne de ${formatPercent(margin)} %`,
      score: Math.round(Math.max(0, Math.min(1, margin / 25)) * 25),
      max: 25,
      icon: 'target',
      tone: margin >= 20 ? 'green' : margin >= 10 ? 'amber' : 'terra'
    },
    {
      key: 'documentation',
      label: 'Documentation',
      detail: `${docs} document${docs > 1 ? 's' : ''} · ${checklistDone}/5 pièces`,
      score: Math.round((Math.min(1, docs / 6) * 0.5 + (checklistDone / 5) * 0.5) * 20),
      max: 20,
      icon: 'file',
      tone: docs + checklistDone >= 6 ? 'green' : 'amber'
    },
    {
      key: 'capacity',
      label: 'Capacité de remboursement',
      detail: `${formatAmount(Math.round(avgMonthlyNet))} de bénéfice mensuel`,
      score: Math.round(Math.max(0, Math.min(1, avgMonthlyNet / 260000)) * 15),
      max: 15,
      icon: 'wallet',
      tone: avgMonthlyNet >= 150000 ? 'green' : 'amber'
    }
  ];

  const score = Math.max(0, Math.min(100, components.reduce((sum, item) => sum + item.score, 0)));
  const label = score >= 80 ? 'Dossier solide' : score >= 60 ? 'En bonne voie' : 'À renforcer';
  return {
    score,
    label,
    activeMonths,
    positiveMonths,
    docs,
    checklist,
    checklistDone,
    margin,
    avgMonthlyNet,
    semester,
    currentMonth,
    components
  };
}

const CHECKLIST_DEFINITIONS = [
  { key: 'identity', label: 'Pièce d’identité du gérant', hint: 'CNI ou passeport en cours de validité', icon: 'user' },
  { key: 'registry', label: 'Registre du commerce (RCCM)', hint: 'Ou attestation d’activité', icon: 'file' },
  { key: 'mobileMoney', label: 'Relevés Mobile Money', hint: '3 derniers mois (Wave, Orange Money…)', icon: 'phone' },
  { key: 'premises', label: 'Justificatif du local', hint: 'Bail, facture ou attestation', icon: 'map-pin' }
];

function getChecklistItems(activeMonths = null) {
  const months = activeMonths == null ? getMonthlySeries(6).filter(month => month.income > 0 || month.expense > 0).length : activeMonths;
  const manual = CHECKLIST_DEFINITIONS.map(item => ({
    ...item,
    auto: false,
    done: Boolean(state.checklist[item.key])
  }));
  manual.push({
    key: 'history',
    label: '6 mois d’activité documentés',
    hint: months >= 6 ? 'Ajouté et vérifié par Sika' : `${months} mois sur 6 disponibles`,
    icon: 'clock',
    auto: true,
    done: months >= 6
  });
  return manual;
}

function getAvgMonthlyProfit(months = 3) {
  const recent = getMonthlySeries(months);
  const positive = recent.map(month => Math.max(0, month.net));
  return positive.reduce((sum, value) => sum + value, 0) / Math.max(1, positive.length);
}

function getSuggestedLoan() {
  const monthlyProfit = getAvgMonthlyProfit(3);
  const capacity = monthlyProfit * 0.35;
  const annualRate = 0.09;
  const monthlyRate = annualRate / 12;
  const months = state.loan.months || 18;
  const maxAmount = monthlyRate > 0
    ? capacity * (1 - Math.pow(1 + monthlyRate, -months)) / monthlyRate
    : capacity * months;
  return {
    monthlyProfit,
    monthlyCapacity: capacity,
    maxAmount: Math.max(0, Math.round(maxAmount / 50000) * 50000)
  };
}

function getLoanSimulation() {
  const amount = Math.max(0, Number(state.loan.amount) || 0);
  const months = Math.max(1, Number(state.loan.months) || 18);
  const annualRate = 0.09;
  const monthlyRate = annualRate / 12;
  const monthlyPayment = monthlyRate > 0
    ? amount * monthlyRate / (1 - Math.pow(1 + monthlyRate, -months))
    : amount / months;
  const totalCost = monthlyPayment * months;
  const avgProfit = Math.max(1, getAvgMonthlyProfit(3));
  const ratio = (monthlyPayment / avgProfit) * 100;
  return { amount, months, monthlyPayment, totalCost, interest: totalCost - amount, ratio, avgProfit };
}

/* ---------- Graphiques SVG ---------- */
function niceChartScale(maxValue) {
  if (maxValue <= 0) return { top: 100000, step: 25000 };
  const rough = maxValue / 4;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / power;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  const step = nice * power;
  return { top: step * 4, step };
}

function chartMarkup(id, series) {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
  const width = 760;
  const height = 278;
  const margin = { top: 18, right: 12, bottom: 34, left: 48 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const bottom = margin.top + plotHeight;
  const maxValue = Math.max(...series.flatMap(item => [item.income, item.expense]), 1);
  const scale = niceChartScale(maxValue);
  const groupWidth = plotWidth / Math.max(1, series.length);
  const barWidth = Math.min(21, Math.max(9, groupWidth * 0.21));
  const gap = Math.max(3, Math.min(5, groupWidth * 0.06));
  const aria = series.map(item => `${item.fullLabel} : ${formatAmount(item.income)} encaissés, ${formatAmount(item.expense)} dépensés`).join('. ');

  const gridLines = Array.from({ length: 5 }, (_, index) => {
    const value = scale.top - index * scale.step;
    const y = margin.top + (plotHeight / 4) * index;
    return `
      <line class="chart-grid-line" x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}"/>
      <text class="chart-axis-text" x="${margin.left - 8}" y="${y + 3.5}" text-anchor="end">${escapeHTML(formatCompact(value))}</text>`;
  }).join('');

  const groups = series.map((item, index) => {
    const groupX = margin.left + groupWidth * index;
    const center = groupX + groupWidth / 2;
    const incomeHeight = Math.max(2, (item.income / scale.top) * plotHeight);
    const expenseHeight = Math.max(2, (item.expense / scale.top) * plotHeight);
    const incomeX = center - barWidth - gap / 2;
    const expenseX = center + gap / 2;
    return `
      <g class="chart-point" data-index="${index}" tabindex="0" role="img" aria-label="${escapeHTML(item.fullLabel)} : ${formatNumber(item.income)} FCFA encaissés, ${formatNumber(item.expense)} FCFA dépensés">
        <rect class="chart-hover" x="${groupX}" y="${margin.top}" width="${groupWidth}" height="${plotHeight}"/>
        <rect class="chart-bar chart-bar-income" x="${incomeX}" y="${bottom - incomeHeight}" width="${barWidth}" height="${incomeHeight}" rx="5" style="--bar-delay:${index * 45}ms"/>
        <rect class="chart-bar chart-bar-expense" x="${expenseX}" y="${bottom - expenseHeight}" width="${barWidth}" height="${expenseHeight}" rx="5" style="--bar-delay:${index * 45 + 40}ms"/>
        <text class="chart-axis-text month" x="${center}" y="${height - 10}" text-anchor="middle">${escapeHTML(item.label)}</text>
      </g>`;
  }).join('');

  return `
    <div class="chart-wrap" data-chart-wrap="${safeId}">
      <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Évolution des encaissements et dépenses. ${escapeHTML(aria)}">
        <defs>
          <linearGradient id="${safeId}-income" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#2c8767"/>
            <stop offset="100%" stop-color="#1a624a"/>
          </linearGradient>
        </defs>
        ${gridLines}
        ${groups}
      </svg>
      <div class="chart-tooltip" data-chart-tooltip></div>
    </div>`;
}

function chartTooltipHTML(point) {
  return `
    <div class="chart-tooltip-title">${escapeHTML(point.fullLabel)}</div>
    <div class="chart-tooltip-row income"><span>Encaissements</span><strong>${formatAmount(point.income)}</strong></div>
    <div class="chart-tooltip-row expense"><span>Dépenses</span><strong>${formatAmount(point.expense)}</strong></div>
    <div class="chart-tooltip-row"><span>Bénéfice</span><strong>${formatAmount(point.net)}</strong></div>`;
}

function attachChartEvents(wrap, series) {
  if (!wrap) return;
  const tooltip = $('[data-chart-tooltip]', wrap);
  if (!tooltip) return;
  const points = $$('.chart-point', wrap);
  const showTooltip = (pointElement, clientX = null) => {
    const index = Number(pointElement.dataset.index);
    const point = series[index];
    if (!point) return;
    tooltip.innerHTML = chartTooltipHTML(point);
    const rect = wrap.getBoundingClientRect();
    let x = rect.width / 2;
    if (clientX != null) x = clientX - rect.left;
    else {
      const box = pointElement.getBoundingClientRect();
      x = box.left - rect.left + box.width / 2;
    }
    x = Math.max(88, Math.min(rect.width - 88, x));
    tooltip.style.left = `${x}px`;
    tooltip.style.top = '10px';
    tooltip.classList.add('is-visible');
    const half = tooltip.offsetWidth / 2;
    if (half + 4 > 88) {
      x = Math.max(half + 4, Math.min(rect.width - half - 4, x));
      tooltip.style.left = `${x}px`;
    }
  };
  points.forEach(point => {
    point.addEventListener('pointerenter', event => showTooltip(point, event.clientX));
    point.addEventListener('pointermove', event => showTooltip(point, event.clientX));
    point.addEventListener('pointerleave', () => tooltip.classList.remove('is-visible'));
    point.addEventListener('focus', () => showTooltip(point));
    point.addEventListener('blur', () => tooltip.classList.remove('is-visible'));
  });
}

/* ---------- Navigation et éléments communs ---------- */
const PAGE_TITLES = {
  overview: 'Vue d’ensemble',
  transactions: 'Transactions',
  documents: 'Documents',
  scanner: 'Scanner un document',
  report: 'Rapport financier',
  financing: 'Financement',
  settings: 'Paramètres'
};

function navigateTo(view) {
  if (!VIEWS.includes(view)) view = 'overview';
  if (currentView === view) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    closeSidebar();
    return;
  }
  if (location.hash === `#${view}`) {
    switchView(view);
  } else {
    // Dans une iframe sans origine propre (aperçu Streamlit), modifier le hash
    // peut être refusé : on bascule alors directement la vue.
    try {
      location.hash = view;
      if (location.hash !== `#${view}`) switchView(view);
    } catch (error) {
      switchView(view);
    }
  }
}

function switchView(view) {
  if (!VIEWS.includes(view)) view = 'overview';
  currentView = view;
  $$('.page').forEach(page => page.classList.toggle('is-active', page.dataset.page === view));
  renderCurrentPage();
  updateChrome();
  closeSidebar();
  closeNotifications();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function renderCurrentPage() {
  const renderers = {
    overview: renderOverview,
    transactions: renderTransactions,
    documents: renderDocuments,
    scanner: renderScanner,
    report: renderReport,
    financing: renderFinancing,
    settings: renderSettings
  };
  if (renderers[currentView]) renderers[currentView]();
}

function updateChrome() {
  const profile = state.profile;
  const ownerName = profile.owner || 'Commerçant';
  const businessName = profile.business || 'Mon commerce';
  const locationLabel = [profile.city, profile.country].filter(Boolean).join(', ');

  const setText = (selector, value) => {
    const element = $(selector);
    if (element) element.textContent = value;
  };
  setText('#sidebarBusinessName', businessName);
  setText('#sidebarBusinessCity', locationLabel || 'Commerce de proximité');
  setText('#sidebarUserName', ownerName);
  setText('#sidebarBusinessAvatar', getBusinessInitials(businessName));
  setText('#sidebarUserAvatar', getInitials(ownerName, 'AD'));
  setText('#topbarUserName', ownerName);
  setText('#topbarUserAvatar', getInitials(ownerName, 'AD'));
  setText('#topbarDate', todayLongLabel());
  setText('#navTransactionCount', String(state.transactions.length));

  $$('.nav-item, .mobile-nav-item, .mobile-scan-button').forEach(item => {
    item.classList.toggle('is-active', item.dataset.view === currentView);
  });

  document.title = `${PAGE_TITLES[currentView] || 'Sika'} — Sika`;
  const notificationDot = $('.notification-dot');
  if (notificationDot) notificationDot.style.display = state.preferences.notifications ? '' : 'none';
  renderNotificationList();
}

function sourceMeta(source) {
  if (source === 'scan') return { label: 'Scanné', icon: 'scan', className: 'scan' };
  if (source === 'manuel') return { label: 'Manuel', icon: 'edit', className: '' };
  return { label: 'Carnet', icon: 'receipt', className: '' };
}

function sourceChipHTML(source) {
  const meta = sourceMeta(source);
  return `<span class="source-chip ${meta.className}">${icon(meta.icon)}${meta.label}</span>`;
}

function txLineHTML(tx, options = {}) {
  const isIncome = tx.type === 'income';
  const meta = sourceMeta(tx.source);
  return `
    <button type="button" class="tx-line" data-action="edit-transaction" data-id="${escapeHTML(tx.id)}" aria-label="Modifier ${escapeHTML(tx.label)}">
      <span class="tx-line-icon ${isIncome ? 'income' : 'expense'}">${icon(isIncome ? 'arrow-down-left' : 'arrow-up-right')}</span>
      <span class="tx-line-main">
        <strong>${escapeHTML(tx.label)}</strong>
        <span class="tx-line-meta">
          <span>${escapeHTML(tx.category)}</span>
          <span class="dot"></span>
          <span>${formatDateShort(tx.date)}</span>
          ${options.showSource === false ? '' : `<span class="source-chip ${meta.className}">${icon(meta.icon)}${meta.label}</span>`}
        </span>
      </span>
      <span class="tx-line-amount ${isIncome ? 'income' : ''}">
        ${isIncome ? '+' : '−'}${formatNumber(tx.amount)}
        <small>${CURRENCY}</small>
      </span>
      ${icon('chevron-right', 'tx-line-chevron icon-sm')}
    </button>`;
}

function renderNotificationList() {
  const list = $('#notificationList');
  if (!list) return;
  if (!state.preferences.notifications) {
    list.innerHTML = `<div style="padding:22px;text-align:center;color:var(--muted);font-size:10px;">Les notifications sont désactivées.</div>`;
    return;
  }
  const readiness = getReadiness();
  const latestDocs = state.documents.slice(0, 2);
  const items = latestDocs.map(doc => `
    <button type="button" class="notification-item" data-action="open-document" data-id="${escapeHTML(doc.id)}">
      <span class="notification-item-icon">${icon('file')}</span>
      <span class="notification-item-copy">
        <strong>Document analysé</strong>
        <p>${escapeHTML(doc.title)} · ${formatAmount(doc.amount)}</p>
      </span>
      <span class="notification-item-time">${formatDateShort(doc.date)}</span>
    </button>`).join('');
  list.innerHTML = `
    <div class="notification-list">
      ${items}
      <button type="button" class="notification-item" data-view="financing">
        <span class="notification-item-icon">${icon('bank')}</span>
        <span class="notification-item-copy">
          <strong>Votre dossier progresse</strong>
          <p>Score de financement : ${readiness.score}/100 · ${readiness.label.toLowerCase()}</p>
        </span>
        <span class="notification-item-time">Maintenant</span>
      </button>
      <button type="button" class="notification-item" data-view="scanner">
        <span class="notification-item-icon">${icon('sparkles')}</span>
        <span class="notification-item-copy">
          <strong>Pensez à scanner vos reçus</strong>
          <p>Un reçu ajouté aujourd’hui renforce vos preuves.</p>
        </span>
        <span class="notification-item-time">Conseil</span>
      </button>
    </div>`;
}

function scoreRingHTML(score, className = '') {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(100, score)) / 100);
  return `
    <div class="score-ring ${className}" aria-label="Score ${score} sur 100">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle class="score-ring-track" cx="60" cy="60" r="${radius}"></circle>
        <circle class="score-ring-fill" cx="60" cy="60" r="${radius}" stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"></circle>
      </svg>
      <div class="score-ring-text"><strong>${score}</strong><small>sur 100</small></div>
    </div>`;
}

function buildDashboardInsight() {
  const period = getPeriodData('month');
  const { current, previous } = period;
  const expenses = current.transactions.filter(tx => tx.type === 'expense');
  const breakdown = getBreakdown(expenses, 'expense');
  const topCategory = breakdown[0];
  const readiness = getReadiness();
  const incomeTrend = compareMetric(current.income, previous.income);
  const topShare = topCategory ? Math.round(topCategory.share) : 0;

  let title = 'Votre activité reste sur la bonne voie.';
  if (current.net < 0) title = 'Votre trésorerie mérite une attention.';
  else if (current.margin >= 35) title = 'Votre marge est solide ce mois-ci.';
  else if (incomeTrend.className === 'positive' && parseFloat(incomeTrend.text.replace(',', '.')) >= 7) title = 'Votre activité gagne de l’élan.';

  const comparisonSentence = previous.income > 0
    ? ` Vos encaissements sont ${incomeTrend.className === 'positive' ? 'en hausse' : incomeTrend.className === 'negative' ? 'en baisse' : 'stables'} de ${incomeTrend.text.replace('+', '')} par rapport à la même période du mois dernier.`
    : '';

  const summary = `Ce mois-ci, vous avez encaissé <strong>${formatAmount(current.income)}</strong> et dépensé <strong>${formatAmount(current.expense)}</strong>. Votre bénéfice net s’élève à <strong>${formatAmount(current.net)}</strong>, soit ${formatPercent(current.margin)} % de vos encaissements.${comparisonSentence}`;

  const bullets = [];
  if (topCategory) {
    bullets.push({
      icon: 'chart',
      text: `<strong>${escapeHTML(topCategory.category)}</strong> représente ${topShare} % de vos dépenses du mois (${formatAmount(topCategory.amount)}).`,
      warn: topCategory.share > 45
    });
  }
  if (readiness.docs > 0) {
    bullets.push({
      icon: 'shield',
      text: `<strong>${readiness.docs} document${readiness.docs > 1 ? 's' : ''} vérifié${readiness.docs > 1 ? 's' : ''}</strong> soutiennent déjà votre dossier de financement (score ${readiness.score}/100).`,
      warn: false
    });
  } else {
    bullets.push({
      icon: 'scan',
      text: 'Scannez votre premier reçu pour renforcer la preuve de votre activité.',
      warn: true
    });
  }

  return { title, summary, bullets };
}

/* ---------- Vue d'ensemble ---------- */
function renderOverview() {
  const page = $('.page[data-page="overview"]');
  if (!page) return;
  const now = new Date();
  const firstName = state.profile.owner.split(/\s+/)[0] || 'vous';
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Bonjour' : hour < 19 ? 'Bon après-midi' : 'Bonsoir';
  const period = getPeriodData('month');
  const { current, previous } = period;
  const totalIncome = sumTransactions(state.transactions.filter(tx => tx.type === 'income'));
  const totalExpense = sumTransactions(state.transactions.filter(tx => tx.type === 'expense'));
  const treasury = Number(state.profile.openingBalance || 0) + totalIncome - totalExpense;
  const incomeTrend = compareMetric(current.income, previous.income);
  const expenseTrend = compareMetric(current.expense, previous.expense, true);
  const netTrend = compareMetric(current.net, previous.net);
  const readiness = getReadiness();
  const insight = buildDashboardInsight();
  const chartSeries = getMonthlySeries(state.chartPeriod === '3m' ? 3 : 6);
  const activeMonths = getMonthlySeries(6).filter(month => month.income > 0 || month.expense > 0).length;
  const recent = sortedTransactions().slice(0, 5);
  const chartId = 'overviewCashflowChart';
  const periodLabel = state.chartPeriod === '3m' ? '3 mois' : '6 mois';

  page.innerHTML = `
    <div class="page-head">
      <div class="page-head-main">
        <p class="eyebrow">Vue d’ensemble · ${escapeHTML(new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(now))}</p>
        <h1 class="page-title" id="overviewTitle">${greeting}, ${escapeHTML(firstName)}<em>.</em></h1>
        <p class="page-subtitle">Voici l’essentiel de ${escapeHTML(state.profile.business)}. Vos chiffres sont à jour et prêts à raconter votre activité.</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-secondary" data-action="add-transaction">${icon('plus', 'icon-sm')} Ajouter une opération</button>
        <button type="button" class="btn btn-primary" data-view="scanner">${icon('scan', 'icon-sm')} Scanner un reçu</button>
      </div>
    </div>

    <div class="kpi-grid">
      <article class="kpi-card">
        <div class="kpi-top"><span class="kpi-label">Encaissements</span><span class="kpi-icon income">${icon('arrow-down-left')}</span></div>
        <div class="kpi-value">${formatNumber(current.income)}<small>${CURRENCY}</small></div>
        <div class="kpi-foot">${trendBadgeHTML(incomeTrend)}<span class="kpi-note">vs même période</span></div>
      </article>
      <article class="kpi-card">
        <div class="kpi-top"><span class="kpi-label">Dépenses</span><span class="kpi-icon expense">${icon('arrow-up-right')}</span></div>
        <div class="kpi-value">${formatNumber(current.expense)}<small>${CURRENCY}</small></div>
        <div class="kpi-foot">${trendBadgeHTML(expenseTrend)}<span class="kpi-note">vs même période</span></div>
      </article>
      <article class="kpi-card kpi-primary">
        <div class="kpi-top"><span class="kpi-label">Bénéfice net</span><span class="kpi-icon profit">${icon('trending')}</span></div>
        <div class="kpi-value">${formatNumber(current.net)}<small>${CURRENCY}</small></div>
        <div class="kpi-foot">${trendBadgeHTML(netTrend)}<span class="kpi-note">${formatPercent(current.margin)} % de marge</span></div>
      </article>
      <article class="kpi-card">
        <div class="kpi-top"><span class="kpi-label">Trésorerie estimée</span><span class="kpi-icon balance">${icon('wallet')}</span></div>
        <div class="kpi-value">${formatNumber(treasury)}<small>${CURRENCY}</small></div>
        <div class="kpi-foot"><span class="trend neutral">${icon('clock')} ${activeMonths} mois</span><span class="kpi-note">depuis l’ouverture</span></div>
      </article>
    </div>

    <div class="overview-grid">
      <article class="card chart-card">
        <div class="card-head chart-head">
          <div>
            <h2 class="card-title">Flux de trésorerie</h2>
            <p class="card-subtitle">Encaissements et dépenses, mois par mois</p>
          </div>
          <div class="chart-controls">
            <div class="chart-legend">
              <span class="legend-item"><span class="legend-swatch income"></span> Encaissements</span>
              <span class="legend-item"><span class="legend-swatch expense"></span> Dépenses</span>
            </div>
            <div class="chart-tabs" role="group" aria-label="Période du graphique">
              <button type="button" class="chart-tab ${state.chartPeriod === '6m' ? 'is-active' : ''}" data-action="chart-period" data-period="6m">6 mois</button>
              <button type="button" class="chart-tab ${state.chartPeriod === '3m' ? 'is-active' : ''}" data-action="chart-period" data-period="3m">3 mois</button>
            </div>
          </div>
        </div>
        ${chartMarkup(chartId, chartSeries)}
        <div class="chart-footnote">${icon('info')} ${periodLabel} d’activité · montants en ${CURRENCY}</div>
      </article>

      <section class="finance-card" aria-labelledby="financeCardTitle">
        <div class="finance-kicker">${icon('bank')} Dossier de financement</div>
        <div class="finance-score-row">
          ${scoreRingHTML(readiness.score)}
          <div class="finance-score-copy">
            <h3 id="financeCardTitle">${readiness.label}</h3>
            <p>Votre dossier devient lisible pour une banque ou une institution de microfinance.</p>
          </div>
        </div>
        <div class="finance-list">
          <div class="finance-list-item">${icon('check-circle')} ${readiness.activeMonths} mois d’activité documentés</div>
          <div class="finance-list-item">${icon('check-circle')} ${readiness.docs} document${readiness.docs > 1 ? 's' : ''} vérifié${readiness.docs > 1 ? 's' : ''}</div>
          <div class="finance-list-item">${icon('check-circle')} ${readiness.checklistDone}/5 pièces disponibles</div>
        </div>
        <button type="button" class="finance-cta" data-view="financing">
          <span class="cta-inner">Préparer mon dossier ${icon('arrow-right')}</span>
        </button>
      </section>

      <article class="card recent-card">
        <div class="card-head">
          <div>
            <h2 class="card-title">Dernières opérations</h2>
            <p class="card-subtitle">Vos mouvements les plus récents</p>
          </div>
          <button type="button" class="text-link card-link" data-view="transactions">Tout voir ${icon('arrow-right', 'icon-sm')}</button>
        </div>
        <div class="recent-list">
          ${recent.map(tx => txLineHTML(tx)).join('') || `<div class="empty-state" style="min-height:160px"><p>Aucune opération pour le moment.</p></div>`}
        </div>
        <div class="recent-foot">
          <span class="recent-count">${state.transactions.length} opérations · dernière mise à jour à l’instant</span>
          <button type="button" class="text-link" data-action="add-transaction">${icon('plus', 'icon-sm')} Ajouter</button>
        </div>
      </article>

      <article class="insight-card">
        <div class="insight-top">
          <span class="insight-icon">${icon('sparkles')}</span>
          <span class="insight-kicker">L’œil de Sika</span>
          <span class="insight-live">analyse à jour</span>
        </div>
        <h2 class="insight-title">${escapeHTML(insight.title)}</h2>
        <p class="insight-text">${insight.summary}</p>
        <ul class="insight-list">
          ${insight.bullets.map(bullet => `
            <li>
              <span class="insight-list-icon ${bullet.warn ? 'warn' : ''}">${icon(bullet.warn ? 'alert' : 'check')}</span>
              <span>${bullet.text}</span>
            </li>`).join('')}
        </ul>
        <button type="button" class="text-link insight-link" data-view="report">Lire mon rapport détaillé ${icon('arrow-right', 'icon-sm')}</button>
      </article>
    </div>`;

  const chartWrap = $(`[data-chart-wrap="${chartId}"]`, page);
  attachChartEvents(chartWrap, chartSeries);
}

/* ---------- Transactions ---------- */
function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function getFilteredTransactions() {
  const now = new Date();
  let list = sortedTransactions();
  if (txFilters.type !== 'all') list = list.filter(tx => tx.type === txFilters.type);
  if (txFilters.period === 'month') {
    list = list.filter(tx => tx.date >= toISODate(monthStart(0)) && tx.date <= todayISO());
  } else if (txFilters.period === '30') {
    list = list.filter(tx => tx.date >= toISODate(addDays(now, -29)));
  } else if (txFilters.period === '90') {
    list = list.filter(tx => tx.date >= toISODate(addDays(now, -89)));
  }
  if (txFilters.search.trim()) {
    const query = normalizeText(txFilters.search);
    list = list.filter(tx => normalizeText([tx.label, tx.party, tx.category, tx.note, tx.method, tx.amount].join(' ')).includes(query));
  }
  return list;
}

function transactionStatsHTML(list) {
  const income = sumTransactions(list.filter(tx => tx.type === 'income'));
  const expense = sumTransactions(list.filter(tx => tx.type === 'expense'));
  const net = income - expense;
  return `
    <article class="stat-block">
      <span class="stat-block-label">Opérations affichées</span>
      <div class="stat-block-value">${list.length}<small>sur ${state.transactions.length}</small></div>
      <p class="stat-block-note">${txFilters.period === 'all' ? 'Tout l’historique' : 'Période sélectionnée'}</p>
    </article>
    <article class="stat-block">
      <span class="stat-block-label">Encaissements</span>
      <div class="stat-block-value income">${formatNumber(income)}<small>${CURRENCY}</small></div>
      <p class="stat-block-note">${list.filter(tx => tx.type === 'income').length} entrée${list.filter(tx => tx.type === 'income').length > 1 ? 's' : ''}</p>
    </article>
    <article class="stat-block">
      <span class="stat-block-label">Dépenses</span>
      <div class="stat-block-value expense">${formatNumber(expense)}<small>${CURRENCY}</small></div>
      <p class="stat-block-note">${list.filter(tx => tx.type === 'expense').length} sortie${list.filter(tx => tx.type === 'expense').length > 1 ? 's' : ''}</p>
    </article>
    <article class="stat-block">
      <span class="stat-block-label">Solde net</span>
      <div class="stat-block-value profit">${formatNumber(net)}<small>${CURRENCY}</small></div>
      <p class="stat-block-note">${income > 0 ? `${formatPercent((net / income) * 100)} % de marge` : 'Aucun encaissement'}</p>
    </article>`;
}

function transactionTableRowsHTML(list) {
  const visible = list.slice(0, txFilters.visible);
  return visible.map(tx => {
    const meta = sourceMeta(tx.source);
    const isIncome = tx.type === 'income';
    return `
      <tr>
        <td>
          <div class="table-tx">
            <span class="table-tx-icon ${isIncome ? 'income' : 'expense'}">${icon(isIncome ? 'arrow-down-left' : 'arrow-up-right')}</span>
            <span class="table-tx-copy">
              <strong>${escapeHTML(tx.label)}</strong>
              <small>${escapeHTML(tx.party || tx.note || tx.method)}</small>
            </span>
          </div>
        </td>
        <td><span class="category-tag" style="--cat-color:${CATEGORY_COLORS[tx.category] || '#6f8078'}">${escapeHTML(tx.category)}</span></td>
        <td class="table-date">${formatDateShort(tx.date)}</td>
        <td><span class="source-chip ${meta.className}">${icon(meta.icon)}${meta.label}</span></td>
        <td class="num">
          <span class="amount-cell ${isIncome ? 'income' : 'expense'}">${isIncome ? '+' : '−'}${formatNumber(tx.amount)}<small>${CURRENCY}</small></span>
        </td>
        <td>
          <button type="button" class="row-open" data-action="edit-transaction" data-id="${escapeHTML(tx.id)}" aria-label="Ouvrir ${escapeHTML(tx.label)}">${icon('chevron-right')}</button>
        </td>
      </tr>`;
  }).join('');
}

function mobileTransactionRowsHTML(list) {
  const visible = list.slice(0, txFilters.visible);
  return visible.map(tx => {
    const isIncome = tx.type === 'income';
    const meta = sourceMeta(tx.source);
    return `
      <button type="button" class="mobile-tx-card" data-action="edit-transaction" data-id="${escapeHTML(tx.id)}">
        <span class="mobile-tx-icon ${isIncome ? 'income' : 'expense'}">${icon(isIncome ? 'arrow-down-left' : 'arrow-up-right')}</span>
        <span class="mobile-tx-main">
          <strong>${escapeHTML(tx.label)}</strong>
          <small><span>${formatDateShort(tx.date)}</span><span>·</span><span>${escapeHTML(tx.category)}</span></small>
        </span>
        <span class="mobile-tx-side">
          <strong class="${isIncome ? 'income' : ''}">${isIncome ? '+' : '−'}${formatNumber(tx.amount)}</strong>
          <span class="source-chip ${meta.className}">${icon(meta.icon)}${meta.label}</span>
        </span>
        ${icon('chevron-right', 'icon-sm')}
      </button>`;
  }).join('');
}

function tableFooterHTML(list) {
  const visibleCount = Math.min(txFilters.visible, list.length);
  if (!list.length) return `<span>Aucune opération à afficher.</span>`;
  return `
    <span>${visibleCount} sur ${list.length} opération${list.length > 1 ? 's' : ''}</span>
    ${visibleCount < list.length ? `<button type="button" class="btn btn-secondary btn-sm" data-action="load-more-transactions">Afficher plus ${icon('chevron-down', 'icon-sm')}</button>` : `<span>Tout est affiché</span>`}`;
}

function updateTransactionsView() {
  const list = getFilteredTransactions();
  const stats = $('#transactionStats');
  const summary = $('#txFilterSummary');
  const tableBody = $('#transactionTableBody');
  const mobileList = $('#transactionMobileList');
  const footer = $('#txTableFooter');
  if (stats) stats.innerHTML = transactionStatsHTML(list);
  if (summary) {
    const activeFilters = (txFilters.search.trim() ? 1 : 0) + (txFilters.type !== 'all' ? 1 : 0) + (txFilters.period !== 'all' ? 1 : 0);
    summary.innerHTML = `
      <span><strong>${list.length}</strong> opération${list.length > 1 ? 's' : ''} trouvée${list.length > 1 ? 's' : ''}</span>
      <span>${activeFilters ? `${activeFilters} filtre${activeFilters > 1 ? 's' : ''} actif${activeFilters > 1 ? 's' : ''}` : 'Toutes vos opérations, sans filtre'}</span>`;
  }
  if (tableBody) {
    tableBody.innerHTML = list.slice(0, txFilters.visible).map(tx => {
      const meta = sourceMeta(tx.source);
      const isIncome = tx.type === 'income';
      return `
        <tr>
          <td>
            <div class="table-tx">
              <span class="table-tx-icon ${isIncome ? 'income' : 'expense'}">${icon(isIncome ? 'arrow-down-left' : 'arrow-up-right')}</span>
              <span class="table-tx-copy">
                <strong>${escapeHTML(tx.label)}</strong>
                <small>${escapeHTML(tx.party || tx.note || tx.method)}</small>
              </span>
            </div>
          </td>
          <td><span class="category-tag" style="--cat-color:${CATEGORY_COLORS[tx.category] || '#6f8078'}">${escapeHTML(tx.category)}</span></td>
          <td class="table-date">${formatDateShort(tx.date)}</td>
          <td><span class="source-chip ${meta.className}">${icon(meta.icon)}${meta.label}</span></td>
          <td class="num"><span class="amount-cell ${isIncome ? 'income' : 'expense'}">${isIncome ? '+' : '−'}${formatNumber(tx.amount)}<small>${CURRENCY}</small></span></td>
          <td><button type="button" class="row-open" data-action="edit-transaction" data-id="${escapeHTML(tx.id)}" aria-label="Ouvrir ${escapeHTML(tx.label)}">${icon('chevron-right')}</button></td>
        </tr>`;
    }).join('');
  }
  if (mobileList) {
    mobileList.innerHTML = list.length ? mobileTransactionRowsHTML(list) : `
      <div class="empty-state">
        <span class="empty-state-icon">${icon('search')}</span>
        <h3>Aucun résultat</h3>
        <p>Essayez de modifier votre recherche ou vos filtres.</p>
      </div>`;
  }
  if (footer) footer.innerHTML = tableFooterHTML(list);
}

function renderTransactions() {
  const page = $('.page[data-page="transactions"]');
  if (!page) return;
  const list = getFilteredTransactions();
  const visibleList = list.slice(0, txFilters.visible);
  const typeCounts = {
    all: state.transactions.length,
    income: state.transactions.filter(tx => tx.type === 'income').length,
    expense: state.transactions.filter(tx => tx.type === 'expense').length
  };

  page.innerHTML = `
    <div class="page-head">
      <div class="page-head-main">
        <p class="eyebrow">Journal de caisse</p>
        <h1 class="page-title" id="transactionsTitle">Transactions<em>.</em></h1>
        <p class="page-subtitle">Toutes vos ventes et dépenses réunies, classées et prêtes à être analysées.</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-secondary" data-action="export-csv">${icon('download', 'icon-sm')} Exporter</button>
        <button type="button" class="btn btn-primary" data-action="add-transaction">${icon('plus', 'icon-sm')} Ajouter une opération</button>
      </div>
    </div>

    <div class="transaction-stats" id="transactionStats">${transactionStatsHTML(list)}</div>

    <div class="filter-card">
      <div class="filter-row">
        <label class="search-field">
          ${icon('search')}
          <input type="search" id="transactionSearch" placeholder="Rechercher une opération, un client, un montant…" value="${escapeHTML(txFilters.search)}" aria-label="Rechercher dans les transactions">
        </label>
        <div class="segmented filter-segmented" role="group" aria-label="Type de transaction">
          <button type="button" class="segmented-btn ${txFilters.type === 'all' ? 'is-active' : ''}" data-action="filter-tx-type" data-value="all">Toutes <span style="opacity:.55">${typeCounts.all}</span></button>
          <button type="button" class="segmented-btn ${txFilters.type === 'income' ? 'is-active' : ''}" data-action="filter-tx-type" data-value="income">Entrées <span style="opacity:.55">${typeCounts.income}</span></button>
          <button type="button" class="segmented-btn ${txFilters.type === 'expense' ? 'is-active' : ''}" data-action="filter-tx-type" data-value="expense">Sorties <span style="opacity:.55">${typeCounts.expense}</span></button>
        </div>
        <select class="filter-select" id="transactionPeriodFilter" aria-label="Période">
          <option value="all" ${txFilters.period === 'all' ? 'selected' : ''}>Toute la période</option>
          <option value="month" ${txFilters.period === 'month' ? 'selected' : ''}>Ce mois-ci</option>
          <option value="30" ${txFilters.period === '30' ? 'selected' : ''}>30 derniers jours</option>
          <option value="90" ${txFilters.period === '90' ? 'selected' : ''}>3 derniers mois</option>
        </select>
        <button type="button" class="btn btn-ghost btn-sm filter-reset" data-action="reset-tx-filters">Réinitialiser</button>
      </div>
      <div class="filter-summary" id="txFilterSummary"></div>
    </div>

    <div class="card table-card">
      <div class="table-card-head">
        <h2 class="table-card-title">Journal de caisse</h2>
        <button type="button" class="text-link" data-action="export-csv">${icon('download', 'icon-sm')} Exporter en CSV</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Opération</th>
              <th>Catégorie</th>
              <th>Date</th>
              <th>Source</th>
              <th class="num">Montant</th>
              <th aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody id="transactionTableBody">${transactionTableRowsHTML(list)}</tbody>
        </table>
      </div>
      <div class="mobile-tx-list" id="transactionMobileList">${mobileTransactionRowsHTML(list)}</div>
      <div class="table-footer" id="txTableFooter">${tableFooterHTML(list)}</div>
    </div>`;

  updateTransactionsView();

  const search = $('#transactionSearch');
  if (search) {
    search.addEventListener('input', event => {
      txFilters.search = event.target.value;
      txFilters.visible = 12;
      updateTransactionsView();
    });
  }
  const period = $('#transactionPeriodFilter');
  if (period) {
    period.addEventListener('change', event => {
      txFilters.period = event.target.value;
      txFilters.visible = 12;
      updateTransactionsView();
    });
  }
  if (visibleList.length === 0) {
    const desktopBody = $('#transactionTableBody');
    if (desktopBody) desktopBody.innerHTML = '';
  }
}

function setTransactionCategoryOptions(select, type, selectedCategory) {
  if (!select) return;
  const categories = type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  const chosen = selectedCategory || categories[0];
  select.innerHTML = categories.map(category => `<option value="${escapeHTML(category)}" ${category === chosen ? 'selected' : ''}>${escapeHTML(category)}</option>`).join('');
}

function openTransactionDialog(transaction = null) {
  const dialog = $('#transactionDialog');
  if (!dialog) return;
  const form = $('#transactionForm');
  form.reset();
  $('#txFormError').hidden = true;
  const isEditing = Boolean(transaction);
  $('#transactionDialogTitle').textContent = isEditing ? 'Modifier l’opération' : 'Ajouter une transaction';
  $('#transactionDialogEyebrow').textContent = isEditing ? 'Mise à jour' : 'Nouvelle opération';
  $('#txSubmitButton').textContent = isEditing ? 'Enregistrer les modifications' : 'Enregistrer l’opération';
  $('#txDeleteButton').hidden = !isEditing;
  $('#txId').value = transaction?.id || '';
  $('#txDate').max = todayISO();
  $('#txDate').value = transaction?.date || todayISO();
  $('#txLabel').value = transaction?.label || '';
  $('#txAmount').value = transaction?.amount || '';
  $('#txParty').value = transaction?.party || '';
  $('#txNote').value = transaction?.note || '';
  $('#txMethod').value = transaction?.method || 'Espèces';
  const type = transaction?.type || 'income';
  $('#txTypeIncome').checked = type === 'income';
  $('#txTypeExpense').checked = type === 'expense';
  setTransactionCategoryOptions($('#txCategory'), type, transaction?.category);
  if (!dialog.open) dialog.showModal();
  setTimeout(() => $('#txLabel')?.focus(), 80);
}

function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog?.open) dialog.close();
}

function exportTransactionsCSV(list = getFilteredTransactions()) {
  if (!list.length) {
    showToast('Rien à exporter', 'Aucune transaction ne correspond aux filtres actuels.', 'error');
    return;
  }
  const rows = [
    ['Date', 'Type', 'Catégorie', 'Libellé', 'Client / fournisseur', 'Montant FCFA', 'Moyen de paiement', 'Source'],
    ...list.map(tx => [
      tx.date,
      tx.type === 'income' ? 'Encaissement' : 'Dépense',
      tx.category,
      tx.label,
      tx.party,
      tx.amount,
      tx.method,
      sourceMeta(tx.source).label
    ])
  ];
  const csv = '\ufeff' + rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `sika-transactions-${todayISO()}.csv`);
  showToast('Export prêt', `${list.length} opération${list.length > 1 ? 's' : ''} exportée${list.length > 1 ? 's' : ''} au format CSV.`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Documents ---------- */
function getFilteredDocuments() {
  const list = [...state.documents].sort((a, b) => b.date.localeCompare(a.date));
  if (docFilters.type === 'all') return list;
  return list.filter(doc => doc.type === docFilters.type);
}

function documentCardHTML(doc) {
  const isIncome = doc.type === 'income';
  return `
    <button type="button" class="document-card" data-action="open-document" data-id="${escapeHTML(doc.id)}">
      <div class="doc-thumb">
        <span class="doc-type-chip">${isIncome ? 'Reçu' : doc.category === 'Transport' ? 'Ticket' : 'Facture'}</span>
        <span class="doc-status">${icon('check')} ${escapeHTML(doc.status || 'Vérifié')}</span>
        ${doc.image ? `<img src="${escapeHTML(doc.image)}" alt="Aperçu de ${escapeHTML(doc.title)}" loading="lazy">` : `<span class="empty-state-icon">${icon('file')}</span>`}
      </div>
      <div class="doc-body">
        <div class="doc-title">
          <h3>${escapeHTML(doc.title)}</h3>
          <strong class="${isIncome ? 'income' : ''}">${isIncome ? '+' : '−'}${formatNumber(doc.amount)}</strong>
        </div>
        <div class="doc-meta">
          <span>${escapeHTML(doc.party || 'Sans tiers')}</span><span class="dot"></span><span>${formatDateShort(doc.date)}</span>
        </div>
        <div class="doc-footer">
          <small>${doc.confidence || 95} % de fiabilité</small>
          <span class="text-link">Voir le document ${icon('arrow-right', 'icon-sm')}</span>
        </div>
      </div>
    </button>`;
}

function renderDocuments() {
  const page = $('.page[data-page="documents"]');
  if (!page) return;
  const all = getFilteredDocuments();
  const counts = {
    all: state.documents.length,
    income: state.documents.filter(doc => doc.type === 'income').length,
    expense: state.documents.filter(doc => doc.type === 'expense').length
  };
  page.innerHTML = `
    <div class="page-head">
      <div class="page-head-main">
        <p class="eyebrow">Preuves & justificatifs</p>
        <h1 class="page-title" id="documentsTitle">Documents<em>.</em></h1>
        <p class="page-subtitle">Vos factures et reçus, rangés automatiquement et reliés à vos opérations.</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-primary" data-view="scanner">${icon('scan', 'icon-sm')} Scanner un document</button>
      </div>
    </div>

    <div class="documents-toolbar">
      <div class="documents-count"><strong>${state.documents.length}</strong> document${state.documents.length > 1 ? 's' : ''} · <span class="status-pill">${icon('check')} Tous vérifiés</span></div>
      <div class="documents-filter">
        <div class="segmented" role="group" aria-label="Filtrer les documents">
          <button type="button" class="segmented-btn ${docFilters.type === 'all' ? 'is-active' : ''}" data-action="filter-documents" data-value="all">Tous (${counts.all})</button>
          <button type="button" class="segmented-btn ${docFilters.type === 'income' ? 'is-active' : ''}" data-action="filter-documents" data-value="income">Reçus (${counts.income})</button>
          <button type="button" class="segmented-btn ${docFilters.type === 'expense' ? 'is-active' : ''}" data-action="filter-documents" data-value="expense">Justificatifs (${counts.expense})</button>
        </div>
      </div>
    </div>

    <div class="document-grid">
      ${all.length ? all.map(documentCardHTML).join('') : `
        <div class="documents-empty">
          <p>Aucun document dans cette catégorie.</p>
          <button type="button" class="btn btn-secondary btn-sm" data-view="scanner" style="margin-top:12px">${icon('scan', 'icon-sm')} Scanner un reçu</button>
        </div>`}
    </div>`;
}

function openDocumentDialog(docId) {
  const doc = state.documents.find(item => item.id === docId);
  if (!doc) return;
  const linkedTx = doc.transactionId ? state.transactions.find(tx => tx.id === doc.transactionId) : null;
  const dialog = $('#documentDialog');
  const title = $('#documentDialogTitle');
  if (title) title.textContent = doc.title;
  const body = $('#documentDialogBody');
  if (!body) return;
  body.innerHTML = `
    <div class="document-dialog-grid">
      <div class="document-dialog-preview">
        ${doc.image ? `<img src="${escapeHTML(doc.image)}" alt="Aperçu de ${escapeHTML(doc.title)}">` : `<div class="empty-state"><span class="empty-state-icon">${icon('file')}</span><p>Aperçu indisponible</p></div>`}
      </div>
      <div class="document-dialog-info">
        <span class="status-pill">${icon('check')} ${escapeHTML(doc.status || 'Vérifié')} · ${doc.confidence || 95} %</span>
        <h3 style="margin-top:10px">${escapeHTML(doc.title)}</h3>
        <p>${escapeHTML(doc.party || 'Sans tiers')} · ${formatDate(doc.date)}</p>
        <div class="doc-info-amount">
          <span>Montant extrait</span>
          <strong>${doc.type === 'income' ? '+' : '−'}${formatNumber(doc.amount)} <small>${CURRENCY}</small></strong>
        </div>
        <div class="doc-info-list">
          <div class="doc-info-row"><span>Type</span><strong>${doc.type === 'income' ? 'Encaissement' : 'Dépense'}</strong></div>
          <div class="doc-info-row"><span>Catégorie</span><strong>${escapeHTML(doc.category)}</strong></div>
          <div class="doc-info-row"><span>N° du document</span><strong>${escapeHTML(doc.docNumber || '—')}</strong></div>
          <div class="doc-info-row"><span>Fichier</span><strong>${escapeHTML(doc.name || '—')}</strong></div>
          <div class="doc-info-row"><span>Opération liée</span><strong>${linkedTx ? formatDate(linkedTx.date) : 'Non liée'}</strong></div>
        </div>
        <div class="doc-dialog-actions">
          ${linkedTx ? `<button type="button" class="btn btn-primary btn-sm" data-action="open-linked-transaction" data-id="${escapeHTML(linkedTx.id)}">${icon('receipt', 'icon-sm')} Voir l’opération</button>` : ''}
          <button type="button" class="btn btn-secondary btn-sm" data-close-dialog="documentDialog">Fermer</button>
        </div>
        <p class="doc-info-note">${icon('shield')} Ce document est conservé localement et sert de preuve dans votre dossier financier.</p>
      </div>
    </div>`;
  if (!dialog.open) dialog.showModal();
}

/* ---------- Scanner ---------- */
const SCAN_STEPS = [
  { title: 'Document sécurisé', hint: 'La photo est prête pour l’analyse' },
  { title: 'Lecture du texte', hint: 'Reconnaissance des caractères du document' },
  { title: 'Extraction des montants', hint: 'Montant, date, fournisseur et catégorie' },
  { title: 'Classement de l’opération', hint: 'Rattachement au bon journal de caisse' }
];

function getSampleDocuments() {
  return [
    {
      key: 'supplier',
      cardTitle: 'Facture grossiste',
      cardMeta: 'Achat · 78 500 FCFA',
      cardVendor: 'Grossiste Adjamé',
      kind: 'FACTURE',
      shop: 'GROSSISTE ADJAMÉ',
      docNumber: 'FA-2026-1048',
      title: 'Facture — Grossiste Adjamé',
      type: 'expense',
      category: 'Achats',
      party: 'Grossiste Adjamé',
      amount: 78500,
      date: toISODate(addDays(new Date(), -3)),
      method: 'Mobile Money',
      transactionLabel: 'Achat de marchandises',
      confidence: 97,
      fileName: 'Facture_Grossiste_Adjame.svg',
      footer: 'Merci pour votre confiance — Paiement reçu',
      lineItems: [
        { description: 'Riz parfumé 25 kg × 2', amount: 36000 },
        { description: 'Huile végétale 5 L × 3', amount: 28500 },
        { description: 'Savons et divers épicerie', amount: 14000 }
      ]
    },
    {
      key: 'sale',
      cardTitle: 'Reçu de vente',
      cardMeta: 'Vente · 42 500 FCFA',
      cardVendor: 'Restaurant Le Baobab',
      kind: 'REÇU DE VENTE',
      shop: state.profile.business.toUpperCase(),
      docNumber: 'VTE-0864',
      title: 'Reçu de vente — Restaurant Le Baobab',
      type: 'income',
      category: 'Ventes',
      party: 'Restaurant Le Baobab',
      amount: 42500,
      date: toISODate(addDays(new Date(), -1)),
      method: 'Mobile Money',
      transactionLabel: 'Vente — Restaurant Le Baobab',
      confidence: 98,
      fileName: 'Recu_vente_Baobab.svg',
      footer: 'Merci de votre visite ! À bientôt.',
      lineItems: [
        { description: 'Riz 10 kg', amount: 14000 },
        { description: 'Huile 5 L', amount: 9500 },
        { description: 'Boissons et jus', amount: 11000 },
        { description: 'Épicerie diverse', amount: 8000 }
      ]
    },
    {
      key: 'transport',
      cardTitle: 'Ticket transport',
      cardMeta: 'Dépense · 4 500 FCFA',
      cardVendor: 'Taxi Yopougon',
      kind: 'TICKET',
      shop: 'TAXI YOPOUGON',
      docNumber: 'TR-2291',
      title: 'Ticket — Taxi Yopougon',
      type: 'expense',
      category: 'Transport',
      party: 'Taxi Yopougon',
      amount: 4500,
      date: toISODate(addDays(new Date(), -2)),
      method: 'Espèces',
      transactionLabel: 'Transport de marchandises',
      confidence: 94,
      fileName: 'Ticket_transport.svg',
      footer: 'Bon voyage — Merci',
      lineItems: [
        { description: 'Course Yopougon – Adjamé', amount: 4500 }
      ]
    }
  ];
}

function sampleImage(sample) {
  return makeReceiptSvg({
    shop: sample.shop,
    kind: sample.kind,
    docNumber: sample.docNumber,
    date: sample.date,
    party: sample.key === 'supplier' ? state.profile.business : sample.party,
    items: sample.lineItems,
    total: sample.amount,
    method: sample.method,
    footer: sample.footer
  });
}

function scanStepMarkup(step) {
  return SCAN_STEPS.map((item, index) => {
    const number = index + 1;
    const isDone = number < step;
    const isCurrent = number === step;
    const iconHTML = isDone ? icon('check') : isCurrent ? '<span class="step-spinner"></span>' : String(number).padStart(2, '0');
    return `
      <div class="analysis-step ${isDone ? 'is-done' : isCurrent ? 'is-current' : ''}" data-step="${number}">
        <span class="step-icon">${iconHTML}</span>
        <span class="step-copy"><strong>${item.title}</strong><small>${item.hint}</small></span>
      </div>`;
  }).join('');
}

function setScanStep(step, percentage = null) {
  scannerState.progress = { step, pct: percentage ?? scannerState.progress.pct };
  const stepsContainer = $('.analysis-steps');
  if (stepsContainer) stepsContainer.innerHTML = scanStepMarkup(step);
  const bar = $('.analysis-progress span');
  if (bar) bar.style.width = `${Math.max(8, Math.min(100, scannerState.progress.pct))}%`;
}

function renderScannerHeader() {
  return `
    <div class="page-head">
      <div class="page-head-main">
        <p class="eyebrow">Lecture intelligente</p>
        <h1 class="page-title" id="scannerTitle">Scanner un document<em>.</em></h1>
        <p class="page-subtitle">Photographiez un reçu ou une facture. Sika lit les montants, la date et le fournisseur, puis range tout au bon endroit.</p>
      </div>
      <div class="page-actions">
        <span class="private-label">${icon('lock')} Traitement local et privé</span>
      </div>
    </div>`;
}

function uploadIdleHTML() {
  const samples = getSampleDocuments();
  return `
    <article class="card upload-card">
      <div class="upload-head">
        <div>
          <h2>Importer un document</h2>
          <p>Facture, reçu de vente ou ticket de transport</p>
        </div>
        <span class="private-label">${icon('lock')} Privé</span>
      </div>
      <div class="dropzone" id="scanDropzone" data-dropzone>
        <span class="dropzone-icon">${icon('camera')}</span>
        <h3>Glissez votre document ici</h3>
        <p>ou choisissez une photo depuis votre appareil</p>
        <div class="dropzone-actions">
          <button type="button" class="btn btn-primary" data-action="trigger-scan-file">${icon('upload', 'icon-sm')} Choisir une photo</button>
          <button type="button" class="btn btn-secondary" data-action="trigger-scan-camera">${icon('camera', 'icon-sm')} Prendre une photo</button>
        </div>
        <span class="dropzone-hint">JPG, PNG ou WebP · 12 Mo maximum · le texte doit rester lisible</span>
        <input type="file" id="scanFileInput" accept="image/*" aria-label="Choisir une photo de reçu">
        <input type="file" id="scanCameraInput" accept="image/*" capture="environment" aria-label="Prendre une photo de reçu">
      </div>
      <div class="upload-divider">ou essayez avec un exemple</div>
      <div class="sample-section">
        <div class="sample-title"><strong>Documents de démonstration</strong><span>extraction simulée</span></div>
        <div class="sample-grid">
          ${samples.map(sample => `
            <button type="button" class="sample-card" data-action="use-sample" data-sample="${sample.key}">
              <span class="sample-doc" aria-hidden="true"><i></i><i></i><i></i><span class="mini-total"></span><span class="receipt-stamp">✓</span></span>
              <span class="sample-info">
                <strong>${sample.cardTitle}</strong>
                <small>${sample.cardVendor}</small>
                <span class="sample-amount">${sample.cardMeta}</span>
              </span>
            </button>`).join('')}
        </div>
      </div>
    </article>`;
}

function howItWorksHTML() {
  return `
    <article class="card how-card">
      <h2>Ce que Sika fait pour vous</h2>
      <p class="how-sub">Trois secondes de lecture, zéro ressaisie.</p>
      <div class="how-steps">
        <div class="how-step">
          <span class="how-step-number">01</span>
          <span class="how-step-copy"><strong>Photographiez</strong><p>Un reçu froissé, une facture ou un ticket de caisse.</p></span>
        </div>
        <div class="how-step">
          <span class="how-step-number">02</span>
          <span class="how-step-copy"><strong>Sika extrait l’essentiel</strong><p>Montant, date, commerçant, catégorie et détail des articles.</p></span>
        </div>
        <div class="how-step">
          <span class="how-step-number">03</span>
          <span class="how-step-copy"><strong>Vous validez</strong><p>L’opération rejoint votre journal et votre dossier de financement.</p></span>
        </div>
      </div>
      <div class="how-tags"><span>Montants</span><span>Dates</span><span>Fournisseurs</span><span>Catégories</span><span>Preuves</span></div>
    </article>`;
}

function scanPrivacyHTML() {
  return `
    <div class="scan-privacy">
      ${icon('shield')}
      <p><strong>Vos documents restent les vôtres.</strong> L’analyse et le stockage se font dans votre navigateur. Aucun document n’est envoyé à un serveur sans votre accord.</p>
    </div>`;
}

function scanDocumentPanelHTML() {
  const isProcessing = scannerState.phase === 'processing';
  return `
    <article class="card document-panel">
      <div class="document-panel-head">
        <span class="file-icon">${icon('file')}</span>
        <div>
          <strong>${escapeHTML(scannerState.fileName || 'Document')}</strong>
          <small>Document importé · aperçu sécurisé</small>
        </div>
        <span class="status-pill ${isProcessing ? 'warn' : ''}">${isProcessing ? icon('sparkles') + ' Analyse en cours' : icon('check') + ' Analysé'}</span>
      </div>
      <div class="document-preview-wrap ${isProcessing ? 'is-processing' : ''}">
        ${isProcessing ? '<span class="scanner-line" aria-hidden="true"></span>' : ''}
        ${scannerState.image ? `<img class="document-preview" src="${escapeHTML(scannerState.image)}" alt="Aperçu du document scanné">` : `<div class="empty-state"><span class="empty-state-icon">${icon('file')}</span><p>Aperçu indisponible</p></div>`}
      </div>
      <div class="document-panel-foot">
        <small>${isProcessing ? 'Lecture locale · ne fermez pas cette page' : 'Extraction terminée · vérifiez les champs'}</small>
        <button type="button" class="text-link" data-action="new-scan">${icon('refresh', 'icon-sm')} Recommencer</button>
      </div>
    </article>`;
}

function analysisPanelHTML() {
  const progress = scannerState.progress || { step: 1, pct: 8 };
  return `
    <article class="card analysis-card">
      <div class="analysis-head">
        <span class="analysis-pulse">${icon('sparkles')}</span>
        <div>
          <h2>Lecture en cours…</h2>
          <p>Sika identifie les informations utiles de votre document.</p>
        </div>
      </div>
      <div class="analysis-progress"><span style="width:${Math.max(8, Math.min(100, progress.pct))}%"></span></div>
      <div class="analysis-steps">${scanStepMarkup(progress.step)}</div>
      <button type="button" class="btn btn-secondary btn-sm btn-block" style="margin-top:15px" data-action="skip-ocr">Saisir les informations manuellement</button>
      <div class="analysis-note">${icon('shield')} La reconnaissance de texte (OCR) peut prendre quelques secondes lors du premier document.</div>
    </article>`;
}

function extractedItemsHTML(extraction) {
  if (!extraction.lineItems || !extraction.lineItems.length) return '';
  return `
    <div class="extracted-section">
      <div class="extracted-head">
        <span>Détail lu sur le document</span>
        <small>${extraction.lineItems.length} ligne${extraction.lineItems.length > 1 ? 's' : ''}</small>
      </div>
      <div class="extracted-list">
        ${extraction.lineItems.map(item => `
          <div class="extracted-item"><span>${escapeHTML(item.description)}</span><strong>${formatAmount(item.amount)}</strong></div>`).join('')}
      </div>
    </div>`;
}

function scanResultPanelHTML() {
  const extraction = scannerState.extraction || {};
  const type = extraction.type === 'income' ? 'income' : 'expense';
  const categories = type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  const lowConfidence = scannerState.fallback || !extraction.amount || Number(extraction.confidence) < 70;
  return `
    <article class="card result-card">
      <div class="result-head">
        <div>
          <h2>Vérifiez l’extraction</h2>
          <p>Corrigez si besoin, puis ajoutez l’opération.</p>
        </div>
        <span class="status-pill">${icon('sparkles')} Extrait</span>
      </div>
      ${lowConfidence ? `
        <div class="confidence-banner low">
          <span class="confidence-icon console">${icon('alert')}</span>
          <div>
            <strong>Vérification nécessaire</strong>
            <small>Certains champs n’ont pas pu être lus avec certitude. Complétez-les avant de valider.</small>
          </div>
          <span class="confidence-value">${extraction.confidence || 0} %</span>
        </div>` : `
        <div class="confidence-banner">
          <span class="confidence-icon">${icon('check')}</span>
          <div>
            <strong>Extraction terminée</strong>
            <small>Sika a identifié ${extraction.amount ? 'le montant' : 'les informations principales'} et la date du document.</small>
          </div>
          <span class="confidence-value">${extraction.confidence || 0} %</span>
        </div>`}
      <form id="scanForm" class="scan-form" novalidate>
        <div class="type-toggle">
          <label class="type-option">
            <input type="radio" name="scanType" value="expense" ${type === 'expense' ? 'checked' : ''}>
            <span class="type-option-inner">
              <span class="type-icon expense">${icon('arrow-up-right')}</span>
              <span><strong>Dépense</strong><small>Achat, facture…</small></span>
            </span>
          </label>
          <label class="type-option">
            <input type="radio" name="scanType" value="income" ${type === 'income' ? 'checked' : ''}>
            <span class="type-option-inner">
              <span class="type-icon income">${icon('arrow-down-left')}</span>
              <span><strong>Encaissement</strong><small>Vente, reçu…</small></span>
            </span>
          </label>
        </div>
        <div class="form-grid">
          <label class="field field-span-2">
            <span>Libellé <em>*</em></span>
            <input type="text" name="label" value="${escapeHTML(extraction.transactionLabel || extraction.label || '')}" placeholder="Ex. Achat de marchandises" required maxlength="80">
          </label>
          <label class="field">
            <span>Montant <em>*</em></span>
            <span class="input-suffix">
              <input type="number" name="amount" value="${extraction.amount || ''}" placeholder="0" min="1" step="1" required inputmode="numeric">
              <span>${CURRENCY}</span>
            </span>
          </label>
          <label class="field">
            <span>Date <em>*</em></span>
            <input type="date" name="date" value="${escapeHTML(extraction.date || todayISO())}" max="${todayISO()}" required>
          </label>
          <label class="field">
            <span>Catégorie</span>
            <select name="category" id="scanCategory">
              ${categories.map(category => `<option value="${escapeHTML(category)}" ${category === extraction.category ? 'selected' : ''}>${escapeHTML(category)}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>Moyen de paiement</span>
            <select name="method">
              ${['Espèces', 'Mobile Money', 'Virement', 'Chèque', 'Autre'].map(method => `<option ${method === extraction.method ? 'selected' : ''}>${method}</option>`).join('')}
            </select>
          </label>
          <label class="field field-span-2">
            <span>Fournisseur / client</span>
            <input type="text" name="party" value="${escapeHTML(extraction.party || '')}" placeholder="Nom du commerçant ou du client" maxlength="80">
          </label>
        </div>
        ${extractedItemsHTML(extraction)}
        <div class="scan-actions">
          <button type="button" class="btn btn-secondary" data-action="new-scan">Annuler</button>
          <button type="submit" class="btn btn-primary">${icon('check', 'icon-sm')} Ajouter à ma comptabilité</button>
        </div>
        <div class="scan-source-note">${icon('lock')} Vérifiez le montant total avant validation.</div>
      </form>
    </article>`;
}

function scanSavedPanelHTML() {
  const transaction = state.transactions.find(tx => tx.id === scannerState.savedTransactionId);
  if (!transaction) {
    return `
      <article class="card scan-success">
        <span class="success-icon">${icon('check-circle')}</span>
        <h2>Document enregistré</h2>
        <p>Le document est bien ajouté à votre comptabilité.</p>
        <div class="success-actions"><button type="button" class="btn btn-primary" data-action="new-scan">Scanner un autre document</button></div>
      </article>`;
  }
  return `
    <article class="card scan-success">
      <span class="success-icon">${icon('check-circle')}</span>
      <h2>Opération enregistrée.</h2>
      <p>Le document est classé et rattaché à votre journal de caisse.</p>
      <div class="success-summary">
        <div><span>Libellé</span><strong>${escapeHTML(transaction.label)}</strong></div>
        <div><span>Montant</span><strong>${transaction.type === 'income' ? '+' : '−'}${formatAmount(transaction.amount)}</strong></div>
        <div><span>Date</span><strong>${formatDate(transaction.date)}</strong></div>
        <div><span>Catégorie</span><strong>${escapeHTML(transaction.category)}</strong></div>
      </div>
      <div class="success-actions">
        <button type="button" class="btn btn-secondary" data-action="edit-transaction" data-id="${escapeHTML(transaction.id)}">Voir l’opération</button>
        <button type="button" class="btn btn-primary" data-action="new-scan">Scanner un autre</button>
      </div>
    </article>`;
}

function renderScanner() {
  const page = $('.page[data-page="scanner"]');
  if (!page) return;
  const phase = scannerState.phase;
  let leftColumn = uploadIdleHTML();
  let rightColumn = howItWorksHTML();
  if (phase === 'processing' || phase === 'result' || phase === 'saved') {
    leftColumn = scanDocumentPanelHTML();
  }
  if (phase === 'processing') rightColumn = analysisPanelHTML();
  if (phase === 'result') rightColumn = scanResultPanelHTML();
  if (phase === 'saved') rightColumn = scanSavedPanelHTML();

  page.innerHTML = `
    ${renderScannerHeader()}
    <div class="scanner-layout">
      <div class="scanner-column">${leftColumn}</div>
      <div class="scanner-column scan-right">${rightColumn}</div>
    </div>
    ${scanPrivacyHTML()}`;

  if (phase === 'idle') {
    const fileInput = $('#scanFileInput');
    const cameraInput = $('#scanCameraInput');
    fileInput?.addEventListener('change', event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) handleScanFile(file);
    });
    cameraInput?.addEventListener('change', event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) handleScanFile(file);
    });
  }

  if (phase === 'result') {
    $$('#scanForm input[name="scanType"]').forEach(radio => {
      radio.addEventListener('change', event => {
        const categories = event.target.value === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
        const select = $('#scanCategory');
        if (select) select.innerHTML = categories.map(category => `<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`).join('');
      });
    });
  }
}

function revokeScannerPreview() {
  if (scannerState.image && scannerState.image.startsWith('blob:')) {
    URL.revokeObjectURL(scannerState.image);
  }
}

function stopActiveOCR() {
  if (activeOCRWorker) {
    const worker = activeOCRWorker;
    activeOCRWorker = null;
    worker.terminate().catch(() => {});
  }
}

function resetScanner() {
  scannerState.token += 1;
  stopActiveOCR();
  revokeScannerPreview();
  scannerState.phase = 'idle';
  scannerState.fileName = '';
  scannerState.image = '';
  scannerState.extraction = null;
  scannerState.savedTransactionId = null;
  scannerState.fallback = false;
  scannerState.ocrText = '';
  scannerState.progress = { step: 1, pct: 8 };
  renderScanner();
}

function useSampleScan(key) {
  const sample = getSampleDocuments().find(item => item.key === key);
  if (!sample) return;
  scannerState.token += 1;
  stopActiveOCR();
  revokeScannerPreview();
  const token = scannerState.token;
  scannerState.phase = 'processing';
  scannerState.fileName = sample.fileName;
  scannerState.image = sampleImage(sample);
  scannerState.extraction = null;
  scannerState.fallback = false;
  scannerState.progress = { step: 1, pct: 8 };
  renderScanner();

  setTimeout(() => {
    if (token !== scannerState.token) return;
    setScanStep(2, 36);
  }, 520);
  setTimeout(() => {
    if (token !== scannerState.token) return;
    setScanStep(3, 65);
  }, 1250);
  setTimeout(() => {
    if (token !== scannerState.token) return;
    setScanStep(4, 88);
  }, 1980);
  setTimeout(() => {
    if (token !== scannerState.token) return;
    scannerState.extraction = {
      type: sample.type,
      category: sample.category,
      party: sample.party,
      amount: sample.amount,
      date: sample.date,
      method: sample.method,
      transactionLabel: sample.transactionLabel,
      confidence: sample.confidence,
      lineItems: sample.lineItems,
      docNumber: sample.docNumber,
      title: sample.title
    };
    scannerState.phase = 'result';
    scannerState.fallback = false;
    renderScanner();
  }, 2750);
}

async function handleScanFile(file) {
  if (!file) return;
  const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(file.name);
  if (!isImage) {
    showToast('Format non pris en charge', 'Choisissez une photo JPG, PNG ou WebP de votre document.', 'error');
    return;
  }
  if (file.size > 12 * 1024 * 1024) {
    showToast('Photo trop lourde', 'La photo doit faire moins de 12 Mo. Réduisez sa taille puis réessayez.', 'error');
    return;
  }

  scannerState.token += 1;
  stopActiveOCR();
  revokeScannerPreview();
  const token = scannerState.token;
  scannerState.phase = 'processing';
  scannerState.fileName = file.name;
  scannerState.extraction = null;
  scannerState.fallback = false;
  scannerState.progress = { step: 1, pct: 8 };
  scannerState.image = URL.createObjectURL(file);
  renderScanner();

  let imageData = '';
  try {
    imageData = await compressImageFile(file);
  } catch (error) {
    console.warn('Compression impossible', error);
    imageData = scannerState.image;
  }
  if (token !== scannerState.token) return;
  revokeScannerPreview();
  scannerState.image = imageData;
  renderScanner();
  setTimeout(() => {
    if (token !== scannerState.token) return;
    setScanStep(2, 30);
    runOCR(imageData, token, file.name);
  }, 420);
}

function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        try {
          const maxDimension = 1050;
          const ratio = Math.min(1, maxDimension / Math.max(image.width, image.height));
          const width = Math.max(1, Math.round(image.width * ratio));
          const height = Math.max(1, Math.round(image.height * ratio));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, width, height);
          context.drawImage(image, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.72));
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = () => reject(new Error('Image illisible'));
      image.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Fichier illisible'));
    reader.readAsDataURL(file);
  });
}

function loadTesseractScript() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractScriptPromise) return tesseractScriptPromise;
  tesseractScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
    script.async = true;
    script.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error('Tesseract indisponible'));
    script.onerror = () => {
      tesseractScriptPromise = null;
      reject(new Error('Impossible de charger le moteur OCR'));
    };
    document.head.appendChild(script);
  });
  return tesseractScriptPromise;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Délai OCR dépassé')), ms))
  ]);
}

async function runOCR(imageData, token, fileName) {
  let worker = null;
  try {
    if (!navigator.onLine) throw new Error('Hors ligne');
    await loadTesseractScript();
    if (token !== scannerState.token) return;
    setScanStep(2, 38);
    worker = await Tesseract.createWorker('fra', 1, {
      logger: message => {
        if (token !== scannerState.token) return;
        if (message.status === 'recognizing text') {
          const pct = 38 + (message.progress || 0) * 35;
          const bar = $('.analysis-progress span');
          if (bar) bar.style.width = `${Math.min(73, pct)}%`;
        }
      }
    });
    if (token !== scannerState.token) {
      await worker.terminate();
      return;
    }
    activeOCRWorker = worker;
    const result = await withTimeout(worker.recognize(imageData), 90000);
    activeOCRWorker = null;
    await worker.terminate();
    worker = null;
    if (token !== scannerState.token) return;
    const text = result?.data?.text || '';
    scannerState.ocrText = text;
    setScanStep(3, 76);
    const extraction = parseReceiptText(text, fileName);
    setTimeout(() => {
      if (token !== scannerState.token) return;
      setScanStep(4, 92);
      setTimeout(() => {
        if (token !== scannerState.token) return;
        scannerState.extraction = extraction;
        scannerState.fallback = !extraction.amount || extraction.confidence < 65;
        scannerState.phase = 'result';
        renderScanner();
        if (scannerState.fallback) {
          showToast('Vérification nécessaire', 'Le document a été lu partiellement. Complétez les champs avant de valider.', 'error');
        }
      }, 450);
    }, 250);
  } catch (error) {
    if (worker) worker.terminate().catch(() => {});
    activeOCRWorker = null;
    if (token !== scannerState.token) return;
    console.warn('OCR indisponible', error);
    const fallback = createManualExtraction(fileName);
    setTimeout(() => {
      if (token !== scannerState.token) return;
      scannerState.extraction = fallback;
      scannerState.fallback = true;
      scannerState.phase = 'result';
      renderScanner();
      showToast('Lecture automatique indisponible', 'Saisissez les informations du document manuellement.', 'error');
    }, 500);
  }
}

function createManualExtraction(fileName) {
  const baseName = String(fileName || 'Document scanné').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return {
    type: 'expense',
    transactionLabel: baseName ? capitalize(baseName) : 'Dépense scannée',
    category: 'Achats',
    party: '',
    amount: '',
    date: todayISO(),
    method: 'Espèces',
    confidence: 0,
    lineItems: [],
    note: ''
  };
}

function skipOCR() {
  if (scannerState.phase !== 'processing') return;
  scannerState.token += 1;
  stopActiveOCR();
  scannerState.extraction = createManualExtraction(scannerState.fileName);
  scannerState.fallback = true;
  scannerState.phase = 'result';
  renderScanner();
  showToast('Saisie manuelle activée', 'Complétez les informations extraites du document.', 'info');
}

function parseAmountToken(token) {
  if (!token) return 0;
  let cleaned = String(token).replace(/[^\d.,]/g, '');
  if (!cleaned) return 0;
  const comma = cleaned.lastIndexOf(',');
  const dot = cleaned.lastIndexOf('.');
  const decimalIndex = Math.max(comma, dot);
  if (decimalIndex >= 0) {
    const decimals = cleaned.length - decimalIndex - 1;
    if (decimals > 0 && decimals <= 2) {
      const integerPart = cleaned.slice(0, decimalIndex).replace(/[.,]/g, '');
      cleaned = `${integerPart}.${cleaned.slice(decimalIndex + 1)}`;
    } else {
      cleaned = cleaned.replace(/[.,]/g, '');
    }
  }
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function extractAmountTokens(text) {
  const matches = String(text).match(/\d{1,3}(?:[ .]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/g) || [];
  return matches.map(parseAmountToken).filter(value => value >= 100 && value <= 50000000 && !(value >= 1900 && value <= 2100));
}

function extractReceiptDate(text) {
  const textValue = String(text);
  const numeric = textValue.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (numeric) {
    let day = Number(numeric[1]);
    let month = Number(numeric[2]);
    let year = Number(numeric[3]);
    if (year < 100) year += 2000;
    if (month > 12 && day <= 12) [day, month] = [month, day];
    const date = new Date(year, month - 1, day, 12);
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) return toISODate(date);
  }
  const months = {
    janvier: 1, fevrier: 2, 'février': 2, mars: 3, avril: 4, mai: 5, juin: 6,
    juillet: 7, aout: 8, 'août': 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12, 'décembre': 12
  };
  const textual = textValue.toLowerCase().match(/\b(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+(\d{4})\b/);
  if (textual && months[textual[2]]) {
    return toISODate(new Date(Number(textual[3]), months[textual[2]] - 1, Number(textual[1]), 12));
  }
  return '';
}

function detectType(text) {
  const value = normalizeText(text);
  const expenseKeywords = ['facture', 'fournisseur', 'achat', 'grossiste', 'tva', 'depense', 'transport', 'taxi', 'carburant', 'loyer', 'electricite', 'salaire'];
  const incomeKeywords = ['recu', 'vente', 'client', 'encaissement', 'recette', 'merci de votre visite'];
  const expenseScore = expenseKeywords.reduce((score, keyword) => score + (value.includes(keyword) ? 1 : 0), 0);
  const incomeScore = incomeKeywords.reduce((score, keyword) => score + (value.includes(keyword) ? 1 : 0), 0);
  return { type: incomeScore > expenseScore ? 'income' : 'expense', decisive: expenseScore !== incomeScore };
}

function detectCategory(text, type) {
  const value = normalizeText(text);
  if (type === 'income') return value.includes('gros') ? 'Vente en gros' : 'Ventes';
  if (/transport|taxi|carburant|essence|coursier/.test(value)) return 'Transport';
  if (/loyer|bail/.test(value)) return 'Loyer';
  if (/electricite|c\.i\.e|c ie|sodeci|eau/.test(value)) return 'Électricité';
  if (/salaire|employe|paie/.test(value)) return 'Salaire';
  if (/orange|mtn|moov|communication|telephone|credit tel/.test(value)) return 'Communication';
  if (/grossiste|fournisseur|achat|marchandise|approvisionnement/.test(value)) return 'Achats';
  return 'Autres dépenses';
}

function detectParty(text, lines) {
  const value = String(text);
  const explicit = value.match(/(?:fournisseur|client|vendeur|commerçant|commercant)\s*[:\-]\s*([^\n]{2,60})/i);
  if (explicit) return explicit[1].trim();
  const likely = lines.find(line => line.length >= 3 && line.length <= 48 && /[A-Za-zÀ-ÿ]{3}/.test(line) && !/facture|recu|reçu|ticket|date|total|montant|merci|adresse|tel|téléphone|numero|numéro/i.test(line));
  return likely ? likely.replace(/\s{2,}/g, ' ').trim() : '';
}

function extractLineItems(lines, total) {
  const items = [];
  for (const line of lines) {
    if (items.length >= 5) break;
    if (/total|montant|net a payer|net à payer|tva|date|facture|reçu|recu|ticket|merci|fcfa|xof/i.test(line)) continue;
    const match = line.match(/^(.{2,52}?)\s+(\d{1,3}(?:[ .]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:fcfa|xof|f)?$/i);
    if (match) {
      const amount = parseAmountToken(match[2]);
      if (amount >= 100 && (!total || amount <= total)) {
        items.push({ description: match[1].replace(/[.:;-]+$/, '').trim(), amount });
      }
    }
  }
  return items;
}

function parseReceiptText(text, fileName) {
  const rawText = String(text || '').replace(/\u00a0/g, ' ');
  const lines = rawText.split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const date = extractReceiptDate(rawText);
  const typeInfo = detectType(rawText);
  const type = typeInfo.type;
  const category = detectCategory(rawText, type);
  const party = detectParty(rawText, lines) || String(fileName || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');

  const totalLines = lines.filter(line => /total|montant|net\s*(à|a)?\s*payer|somme|à payer|a payer/i.test(line));
  let total = 0;
  if (totalLines.length) {
    totalLines.forEach(line => {
      const amounts = extractAmountTokens(line);
      if (amounts.length) total = Math.max(total, ...amounts);
    });
  }
  if (!total) {
    const candidates = lines.filter(line => !/date|facture|reçu|recu|ticket|tel|téléphone|telephone|n[°o]\s|client/i.test(line));
    const amounts = candidates.flatMap(extractAmountTokens);
    if (amounts.length) total = Math.max(...amounts);
  }

  let method = 'Espèces';
  if (/mobile money|wave|orange money|mtn money|moov money/i.test(rawText)) method = 'Mobile Money';
  else if (/virement|transfert bancaire/i.test(rawText)) method = 'Virement';
  else if (/ch[eè]que/i.test(rawText)) method = 'Chèque';

  const lineItems = extractLineItems(lines, total);
  const labelType = type === 'income' ? 'Vente' : 'Achat';
  const transactionLabel = party ? `${labelType} — ${party}` : `${labelType} — document scanné`;
  let confidence = 34;
  if (total) confidence += 28;
  if (date) confidence += 12;
  if (party) confidence += 8;
  if (typeInfo.decisive) confidence += 9;
  if (lineItems.length) confidence += 5;
  if (/total/i.test(rawText)) confidence += 3;

  return {
    type,
    category,
    party,
    amount: total,
    date: date || todayISO(),
    method,
    transactionLabel,
    confidence: Math.min(96, confidence),
    lineItems,
    documentTitle: `${type === 'income' ? 'Reçu' : 'Facture'} — ${party || 'Document scanné'}`
  };
}

/* ---------- Rapport financier ---------- */
const REPORT_PERIODS = {
  month: 'Ce mois-ci',
  last30: '30 derniers jours',
  quarter: '3 derniers mois',
  semester: '6 derniers mois'
};

function getReportData(key) {
  const period = getPeriodData(key);
  const current = period.current;
  const previous = period.previous;
  const breakdown = getBreakdown(current.transactions, 'expense');
  const incomeBreakdown = getBreakdown(current.transactions, 'income');
  const readiness = getReadiness();
  const activeMonths = getMonthlySeries(6).filter(month => month.income > 0 || month.expense > 0).length;
  const docsInPeriod = state.documents.filter(doc => isInRange(doc.date, period.range.start, period.range.end));
  const incomeTrend = compareMetric(current.income, previous.income);
  const expenseTrend = compareMetric(current.expense, previous.expense, true);
  const netTrend = compareMetric(current.net, previous.net);
  const topExpense = breakdown[0];
  const qualityRaw = 6.1
    + Math.min(1.4, (state.documents.length / 4) * 1.4)
    + Math.min(1, activeMonths / 6)
    + Math.min(1, current.count / 40);
  const quality = Math.min(9.7, Math.round(qualityRaw * 10) / 10);

  const narrative = buildReportNarrative({
    period,
    current,
    previous,
    breakdown,
    topExpense,
    readiness,
    incomeTrend,
    expenseTrend,
    netTrend,
    docsInPeriod,
    quality
  });

  return {
    key,
    period,
    range: period.range,
    label: period.label,
    periodName: REPORT_PERIODS[key] || 'Période analysée',
    current,
    previous,
    breakdown,
    incomeBreakdown,
    readiness,
    activeMonths,
    docsInPeriod,
    incomeTrend,
    expenseTrend,
    netTrend,
    topExpense,
    quality,
    narrative,
    chartId: 'reportChart',
    series: getMonthlySeries(6)
  };
}

function buildReportNarrative({ period, current, previous, breakdown, topExpense, readiness, incomeTrend, expenseTrend, netTrend, docsInPeriod, quality }) {
  const paragraphs = [];
  const incomeText = formatAmount(current.income);
  const expenseText = formatAmount(current.expense);
  const netText = formatAmount(current.net);
  const previousIncome = previous.income;
  const incomeChange = previousIncome > 0 ? Math.abs(((current.income - previousIncome) / previousIncome) * 100) : 0;

  paragraphs.push(`Sur la période du <strong>${escapeHTML(period.label)}</strong>, votre activité a enregistré <strong>${current.count} opération${current.count > 1 ? 's' : ''}</strong>, pour <strong>${incomeText}</strong> d’encaissements et <strong>${expenseText}</strong> de dépenses. Le bénéfice net ressort à <strong>${netText}</strong>, soit une marge nette de <strong>${formatPercent(current.margin)} %</strong>.`);

  if (previousIncome > 0) {
    const direction = current.income >= previousIncome ? 'progressent' : 'reculent';
    paragraphs.push(`Les encaissements ${direction} de <strong>${formatPercent(incomeChange)} %</strong> par rapport à la période précédente. ${expenseTrend.className === 'positive' ? 'Les dépenses sont mieux maîtrisées.' : 'Les dépenses augmentent et méritent une vérification.'} ${topExpense ? `Le poste <strong>${escapeHTML(topExpense.category)}</strong> concentre ${Math.round(topExpense.share)} % des sorties.` : ''}`);
  } else if (topExpense) {
    paragraphs.push(`Le poste <strong>${escapeHTML(topExpense.category)}</strong> représente ${Math.round(topExpense.share)} % des dépenses enregistrées, pour <strong>${formatAmount(topExpense.amount)}</strong>.`);
  }

  if (current.net >= 0) {
    paragraphs.push(`Avec ${readiness.docs} document${readiness.docs > 1 ? 's' : ''} vérifié${readiness.docs > 1 ? 's' : ''} et une activité documentée sur ${readiness.activeMonths} mois, votre dossier présente un niveau de préparation de <strong>${readiness.score}/100</strong>. ${readiness.score >= 80 ? 'Les bases sont solides pour préparer une demande de financement.' : 'Quelques pièces complémentaires renforceraient encore la crédibilité du dossier.'}`);
  } else {
    paragraphs.push(`Le résultat de la période est négatif. La priorité est de reconstituer la trésorerie en réduisant les sorties non essentielles et en relançant les encaissements. Votre score de préparation est actuellement de <strong>${readiness.score}/100</strong>.`);
  }

  const attentions = [];
  if (current.net < 0) attentions.push('Le bénéfice net est négatif sur la période : la trésorerie doit être surveillée.');
  if (topExpense && topExpense.share > 42) attentions.push(`${topExpense.category} représente ${Math.round(topExpense.share)} % des dépenses. Un poste très concentré réduit votre marge de manœuvre.`);
  if (!docsInPeriod.length) attentions.push('Aucun document n’est rattaché aux opérations de cette période.');
  if (current.count < 5) attentions.push('Le volume d’opérations est faible : complétez le journal pour rendre l’analyse plus fiable.');
  if (!attentions.length) attentions.push('Aucun point bloquant majeur. Continuez à enregistrer vos opérations régulièrement.');

  const recommendations = [];
  if (topExpense) recommendations.push(`Négociez ou étalez le poste ${topExpense.category} (${formatAmount(topExpense.amount)}) si son poids reste supérieur à 40 %.`);
  if (readiness.docs < 4) recommendations.push('Scannez au moins 4 nouveaux justificatifs pour consolider vos preuves.');
  else recommendations.push('Continuez à scanner chaque facture d’achat : vos preuves sont votre meilleur argument de financement.');
  if (readiness.checklistDone < 5) recommendations.push(`Complétez les ${5 - readiness.checklistDone} pièce${5 - readiness.checklistDone > 1 ? 's' : ''} manquante${5 - readiness.checklistDone > 1 ? 's' : ''} de votre dossier.`);
  recommendations.push(`Gardez une réserve équivalente à ${current.expense > 0 ? Math.max(1, Math.ceil(current.expense / Math.max(1, current.income || 1))) : 1} mois de dépenses pour absorber les imprévus.`);

  const plain = `Rapport financier Sika — ${period.label}\n\n${paragraphs.map(stripHTML).join('\n\n')}\n\nPoints d’attention :\n${attentions.map(item => `- ${item}`).join('\n')}\n\nRecommandations :\n${recommendations.map(item => `- ${item}`).join('\n')}`;

  return { paragraphs, attentions, recommendations, plain, quality };
}

function stripHTML(html) {
  const temporary = document.createElement('div');
  temporary.innerHTML = html;
  return (temporary.textContent || temporary.innerText || '').trim();
}

function categoryBarsHTML(breakdown) {
  if (!breakdown.length) return `<p style="color:var(--muted);font-size:9.5px">Aucune dépense enregistrée sur la période.</p>`;
  const top = breakdown.slice(0, 5);
  const max = Math.max(...top.map(item => item.amount), 1);
  return `
    <div class="category-bars">
      ${top.map(item => `
        <div class="category-bar" style="--cat-color:${item.color};--cat-width:${(item.amount / max) * 100}%">
          <div class="category-bar-head"><span>${escapeHTML(item.category)}</span><strong>${formatAmount(item.amount)}</strong></div>
          <div class="category-bar-track"><div class="category-bar-fill"></div></div>
        </div>`).join('')}
    </div>`;
}

function reportCoreHTML(data, printMode = false) {
  const chartId = printMode ? 'printReportChart' : 'reportChart';
  const netClass = data.current.net < 0 ? 'negative' : '';
  return `
    <div class="report-letterhead">
      <div class="report-brand">
        <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M8 23v-6M15 23V10M22 23V5" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg></span>
        <span class="report-brand-copy">
          <strong>sika.</strong>
          <small>Votre activité, en toute clarté</small>
        </span>
      </div>
      <div class="report-letterhead-meta">
        <span class="report-kind">Rapport financier</span>
        <h2>${escapeHTML(state.profile.business)}</h2>
        <p>${escapeHTML(data.label)} · ${data.periodName}</p>
      </div>
    </div>

    <div class="report-hero">
      <div>
        <div class="report-hero-label">${icon('trending')} Bénéfice net sur la période</div>
        <div class="report-hero-amount ${netClass}"><strong>${formatNumber(data.current.net)}</strong><small>${CURRENCY}</small></div>
        <div class="report-hero-meta">
          ${trendBadgeHTML(data.netTrend)}
          <span>${formatPercent(data.current.margin)} % de marge nette</span>
        </div>
      </div>
      <div class="report-hero-period">
        <strong>${escapeHTML(data.label)}</strong>
        <small>${data.current.count} opérations · ${data.docsInPeriod.length} document${data.docsInPeriod.length > 1 ? 's' : ''}</small>
      </div>
    </div>

    <div class="report-kpis">
      <div class="report-kpi">
        <span>Encaissements</span>
        <strong class="income">${formatNumber(data.current.income)} <small>${CURRENCY}</small></strong>
        <em>${data.incomeTrend.text} vs période précédente</em>
      </div>
      <div class="report-kpi">
        <span>Dépenses</span>
        <strong class="expense">${formatNumber(data.current.expense)} <small>${CURRENCY}</small></strong>
        <em>${data.expenseTrend.text} vs période précédente</em>
      </div>
      <div class="report-kpi">
        <span>Marge nette</span>
        <strong>${formatPercent(data.current.margin)} <small>%</small></strong>
        <em>${data.current.net >= 0 ? 'Bénéfice après dépenses' : 'Résultat déficitaire'}</em>
      </div>
    </div>

    <section class="report-section">
      <div class="report-section-head"><h3>Lecture de Sika</h3><span>${data.quality}/10 de fiabilité</span></div>
      <div class="report-narrative">
        <div class="ai-narrative-head">
          <span class="ai-mark">${icon('sparkles')}</span>
          <strong>Analyse financière</strong>
          <span>générée à partir de ${data.current.count} opérations</span>
        </div>
        ${data.narrative.paragraphs.map(paragraph => `<p>${paragraph}</p>`).join('')}
      </div>
    </section>

    <section class="report-section">
      <div class="report-section-head"><h3>Évolution de l’activité</h3><span>6 derniers mois</span></div>
      <div class="report-chart-card">
        <div class="report-chart-head">
          <strong>Encaissements et dépenses</strong>
          <span class="report-chart-legend">
            <span class="legend-item"><span class="legend-swatch income"></span> Encaissements</span>
            <span class="legend-item"><span class="legend-swatch expense"></span> Dépenses</span>
          </span>
        </div>
        ${chartMarkup(chartId, data.series)}
      </div>
    </section>

    <div class="report-bottom-grid">
      <section>
        <div class="report-section-head"><h3>Répartition des dépenses</h3><span>${data.breakdown.length} catégorie${data.breakdown.length > 1 ? 's' : ''}</span></div>
        ${categoryBarsHTML(data.breakdown)}
      </section>
      <section>
        <div class="report-section-head"><h3>À retenir</h3><span>analyse</span></div>
        <div class="report-callout">
          <h4>${icon('alert')} Points d’attention</h4>
          <ul>${data.narrative.attentions.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul>
        </div>
        <div class="report-callout" style="margin-top:9px">
          <h4>${icon('target')} Recommandations</h4>
          <ul>${data.narrative.recommendations.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul>
        </div>
      </section>
    </div>

    <div class="report-footer">
      <span>Rapport généré par <strong>Sika</strong> le ${todayLongLabel()} · données déclaratives de l’activité</span>
      <span>${escapeHTML(state.profile.business)} · ${escapeHTML(state.profile.city)}, ${escapeHTML(state.profile.country)}</span>
    </div>`;
}

function renderReport() {
  const page = $('.page[data-page="report"]');
  if (!page) return;
  const data = getReportData(state.reportPeriod);
  page.innerHTML = `
    <div class="page-head">
      <div class="page-head-main">
        <p class="eyebrow">Analyse financière</p>
        <h1 class="page-title" id="reportTitle">Rapport financier<em>.</em></h1>
        <p class="page-subtitle">Une lecture claire de votre activité, prête à être partagée avec un partenaire financier.</p>
      </div>
    </div>

    <div class="report-toolbar">
      <div class="report-period-control">
        <label for="reportPeriodSelect">Période</label>
        <select class="filter-select" id="reportPeriodSelect">
          ${Object.entries(REPORT_PERIODS).map(([value, label]) => `<option value="${value}" ${value === state.reportPeriod ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </div>
      <div class="report-actions">
        <button type="button" class="btn btn-secondary" data-action="copy-report">${icon('copy', 'icon-sm')} Copier le résumé</button>
        <button type="button" class="btn btn-primary" data-action="print-report">${icon('printer', 'icon-sm')} Exporter en PDF</button>
      </div>
    </div>

    <div class="report-layout">
      <article class="report-sheet" id="reportSheet">${reportCoreHTML(data)}</article>

      <aside class="report-side">
        <section class="report-side-card">
          <h3>${icon('shield')} Qualité des données</h3>
          <p>Plus votre journal est complet, plus votre analyse est crédible.</p>
          <div class="quality-score"><strong>${data.quality}</strong><span>/ 10</span></div>
          <div class="quality-meter"><span style="width:${data.quality * 10}%"></span></div>
          <div class="quality-list">
            <div class="quality-item">${icon('check-circle')} ${state.documents.length} documents vérifiés</div>
            <div class="quality-item">${icon('check-circle')} ${data.activeMonths} mois de données</div>
            <div class="quality-item">${icon('check-circle')} ${data.current.count} opérations analysées</div>
          </div>
        </section>

        <section class="report-side-card">
          <h3>${icon('arrow-right')} Passer à l’action</h3>
          <p>Utilisez votre historique pour préparer une demande de financement.</p>
          <div class="report-side-actions">
            <button type="button" class="btn btn-primary btn-sm btn-block" data-view="financing">Préparer mon dossier</button>
            <button type="button" class="btn btn-secondary btn-sm btn-block" data-action="print-report">${icon('printer', 'icon-sm')} Imprimer / PDF</button>
          </div>
          <p class="report-side-note">Le rapport est généré automatiquement à partir de votre journal. Il ne remplace pas un état financier certifié.</p>
        </section>
      </aside>
    </div>`;

  const chartWrap = $(`[data-chart-wrap="${data.chartId}"]`, page);
  attachChartEvents(chartWrap, data.series);
  const select = $('#reportPeriodSelect');
  if (select) {
    select.addEventListener('change', event => {
      state.reportPeriod = event.target.value;
      saveState();
      renderReport();
    });
  }
}

function copyReportSummary() {
  const data = getReportData(state.reportPeriod);
  const text = data.narrative.plain;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => showToast('Résumé copié', 'Vous pouvez maintenant le coller dans un message ou un document.'))
      .catch(() => fallbackCopyText(text));
  } else {
    fallbackCopyText(text);
  }
}

function fallbackCopyText(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand('copy');
    showToast('Résumé copié', 'Vous pouvez maintenant le coller dans un document.');
  } catch (error) {
    showToast('Copie impossible', 'Sélectionnez le texte du rapport pour le copier manuellement.', 'error');
  }
  area.remove();
}

function printReport() {
  const data = getReportData(state.reportPeriod);
  const html = `<div class="print-page"><article class="report-sheet" style="padding:0;border:0;box-shadow:none;background:#fff">${reportCoreHTML(data, true)}</article></div>`;
  launchPrint(html);
}

/* ---------- Financement ---------- */
function readinessComponentsHTML(readiness) {
  return readiness.components.map(component => {
    const percentage = Math.round((component.score / component.max) * 100);
    const tone = percentage >= 70 ? '' : percentage >= 40 ? 'amber' : 'terra';
    return `
      <div class="readiness-item">
        <div class="readiness-item-top">
          <span>${icon(component.icon)} ${component.label}</span>
          <strong>${component.score}/${component.max}</strong>
        </div>
        <div class="readiness-track"><div class="readiness-fill ${tone}" style="width:${percentage}%"></div></div>
        <div class="readiness-note">${escapeHTML(component.detail)}</div>
      </div>`;
  }).join('');
}

function checklistHTML(readiness) {
  return `
    <div class="checklist">
      ${readiness.checklist.map(item => `
        <label class="checklist-item ${item.auto ? 'is-auto' : ''}">
          <span class="checklist-control">
            <input type="checkbox" ${item.done ? 'checked' : ''} ${item.auto ? 'disabled' : ''} data-checklist-key="${item.auto ? '' : item.key}">
            <span class="checklist-box">${icon('check')}</span>
          </span>
          <span class="checklist-copy"><strong>${escapeHTML(item.label)}</strong><small>${escapeHTML(item.hint)}</small></span>
          ${item.auto ? `<span class="checklist-auto">${icon('sparkles')} Auto</span>` : ''}
        </label>`).join('')}
    </div>
    <div class="checklist-summary">
      <div class="checklist-progress-head"><span>Pièces rassemblées</span><strong>${readiness.checklistDone}/5</strong></div>
      <div class="checklist-progress"><span style="width:${(readiness.checklistDone / 5) * 100}%"></span></div>
    </div>`;
}

function simulatorResultsHTML(simulation) {
  const ratio = simulation.ratio;
  const ratioClass = ratio > 45 ? 'danger' : ratio > 35 ? 'warn' : '';
  const warning = ratio > 45
    ? `Cette mensualité représente ${formatPercent(ratio)} % de votre bénéfice mensuel moyen. Réduisez le montant ou allongez la durée.`
    : ratio > 35
      ? `La mensualité reste élevée (${formatPercent(ratio)} % du bénéfice). Gardez une marge de sécurité pour les imprévus.`
      : `Mensualité compatible avec votre bénéfice moyen. Le ratio d’endettement estimé est de ${formatPercent(ratio)} %.`;
  return `
    <div class="sim-results">
      <div class="sim-result accent">
        <span>Mensualité estimée</span>
        <strong id="simMonthlyPayment">${formatNumber(simulation.monthlyPayment)} <small>${CURRENCY}</small></strong>
        <small>pendant ${simulation.months} mois</small>
      </div>
      <div class="sim-result">
        <span>Coût total du crédit</span>
        <strong id="simTotalCost">${formatNumber(simulation.totalCost)} <small>${CURRENCY}</small></strong>
        <small>intérêts : ${formatAmount(simulation.interest)}</small>
      </div>
    </div>
    <div class="sim-meter">
      <div class="sim-meter-head"><span>Poids de la mensualité sur le bénéfice</span><strong id="simRatio">${formatPercent(ratio)} %</strong></div>
      <div class="sim-meter-track"><span id="simRatioBar" class="${ratioClass}" style="width:${Math.min(100, ratio)}%"></span></div>
    </div>
    <div class="sim-warning" id="simWarning">
      <span id="simWarningIcon">${icon(ratio > 35 ? 'alert' : 'check')}</span>
      <span id="simWarningText">${warning}</span>
    </div>
    <p class="sim-disclaimer">Simulation indicative sur la base d’un taux annuel de 9 % et d’un profil standard. Elle ne constitue pas une offre de crédit.</p>`;
}

function renderFinancing() {
  const page = $('.page[data-page="financing"]');
  if (!page) return;
  const readiness = getReadiness();
  const simulation = getLoanSimulation();
  const suggested = getSuggestedLoan();
  const monthlyProfit = readiness.avgMonthlyNet;
  const amountPercent = ((state.loan.amount - 250000) / (4000000 - 250000)) * 100;
  const monthsPercent = ((state.loan.months - 6) / (36 - 6)) * 100;

  page.innerHTML = `
    <div class="page-head">
      <div class="page-head-main">
        <p class="eyebrow">Crédit & microfinance</p>
        <h1 class="page-title" id="financingTitle">Financement<em>.</em></h1>
        <p class="page-subtitle">Transformez votre activité quotidienne en un dossier crédible pour votre banque ou votre institution de microfinance.</p>
      </div>
    </div>

    <section class="financing-hero">
      <div class="financing-hero-copy">
        <span class="hero-badge">${icon('sparkles')} Dossier ${readiness.score >= 80 ? 'prêt à présenter' : 'en cours de préparation'}</span>
        <h2>Votre activité parle déjà aux financeurs.</h2>
        <p>${readiness.score >= 80 ? 'Vos données sont régulières et vos documents commencent à raconter une histoire solide. Il ne reste qu’à finaliser les pièces.' : 'Chaque reçu scanné et chaque vente enregistrée rendent votre dossier plus lisible. Complétez les éléments manquants pour gagner en crédibilité.'}</p>
        <div class="financing-hero-chips">
          <span class="hero-chip">${icon('check-circle')} ${readiness.activeMonths} mois documentés</span>
          <span class="hero-chip">${icon('shield')} ${readiness.docs} preuves vérifiées</span>
          <span class="hero-chip">${icon('target')} ${readiness.checklistDone}/5 pièces rassemblées</span>
        </div>
        <div class="financing-hero-actions">
          <button type="button" class="btn btn-amber" data-action="open-dossier">${icon('file', 'icon-sm')} Aperçu du dossier</button>
          <button type="button" class="btn btn-secondary" data-view="scanner">${icon('scan', 'icon-sm')} Ajouter une preuve</button>
        </div>
      </div>
      <div class="financing-hero-score">
        ${scoreRingHTML(readiness.score, 'score-ring-lg')}
        <div>
          <h3>${readiness.label}</h3>
          <p>Score de préparation basé sur votre historique, vos marges et vos justificatifs.</p>
          <span class="score-caption">${icon('trending')} ${readiness.score >= 80 ? 'Bon niveau de confiance' : 'Encore quelques efforts'}</span>
        </div>
      </div>
    </section>

    <div class="financing-layout">
      <div class="financing-column">
        <section class="card financing-card">
          <div class="financing-card-head">
            <div><h2>Ce que votre score raconte</h2><p>Les critères qu’un analyste de crédit regarde en priorité.</p></div>
            <span class="status-pill">${readiness.score}/100</span>
          </div>
          <div class="readiness-list">${readinessComponentsHTML(readiness)}</div>
          <div class="financing-tip">
            ${icon('sparkles')}
            <p><strong>Le conseil de Sika :</strong> ${readiness.docs < 4 ? 'ajoutez quelques reçus de ventes récentes. La régularité des preuves pèse plus lourd qu’un seul gros chiffre.' : 'votre historique est déjà lisible. Concentrez-vous sur les pièces administratives encore manquantes.'}</p>
          </div>
        </section>

        <section class="card financing-card">
          <div class="financing-card-head">
            <div><h2>Complétez les pièces</h2><p>Cochez ce que vous avez déjà, Sika met à jour votre score.</p></div>
            <span class="status-pill neutral">${readiness.checklistDone}/5</span>
          </div>
          ${checklistHTML(readiness)}
        </section>
      </div>

      <div class="financing-column financing-column-side">
        <section class="card simulator-card">
          <div class="simulator-head">
            <div><h2>Simuler un prêt</h2><p>Estimez une mensualité compatible avec votre activité.</p></div>
            <span class="status-pill neutral">9 % / an</span>
          </div>
          <div class="sim-body">
            <div class="sim-fields">
              <div class="sim-field">
                <div class="sim-field-head"><span>Montant du prêt</span><strong id="simAmountValue">${formatAmount(state.loan.amount)}</strong></div>
                <input class="range-input" type="range" id="simAmount" min="250000" max="4000000" step="50000" value="${state.loan.amount}" style="--range-progress:${amountPercent}%" aria-label="Montant du prêt">
                <div class="range-scale"><span>250 000</span><span>4 000 000 FCFA</span></div>
              </div>
              <div class="sim-field">
                <div class="sim-field-head"><span>Durée de remboursement</span><strong id="simMonthsValue">${state.loan.months} mois</strong></div>
                <input class="range-input" type="range" id="simMonths" min="6" max="36" step="6" value="${state.loan.months}" style="--range-progress:${monthsPercent}%" aria-label="Durée du prêt">
                <div class="range-scale"><span>6 mois</span><span>36 mois</span></div>
              </div>
            </div>
            <div id="simResults">${simulatorResultsHTML(simulation)}</div>
          </div>
        </section>

        <section class="capacity-card">
          <div class="capacity-head">
            <span class="capacity-head-icon">${icon('bank')}</span>
            <span>Capacité estimée</span>
          </div>
          <h3>Montant de prêt recommandé</h3>
          <div class="capacity-value">${formatNumber(suggested.maxAmount)} <small>${CURRENCY}</small></div>
          <p>Sur la base de ${formatAmount(monthlyProfit)} de bénéfice mensuel moyen et d’une mensualité plafonnée à 35 % de ce bénéfice. À valider avec votre institution.</p>
        </section>
      </div>
    </div>`;

  const amountInput = $('#simAmount');
  const monthsInput = $('#simMonths');
  if (amountInput) {
    amountInput.addEventListener('input', event => {
      state.loan.amount = Number(event.target.value);
      event.target.style.setProperty('--range-progress', `${((state.loan.amount - 250000) / (4000000 - 250000)) * 100}%`);
      updateSimulatorUI();
      saveState(true);
    });
  }
  if (monthsInput) {
    monthsInput.addEventListener('input', event => {
      state.loan.months = Number(event.target.value);
      event.target.style.setProperty('--range-progress', `${((state.loan.months - 6) / (36 - 6)) * 100}%`);
      updateSimulatorUI();
      saveState(true);
    });
  }
}

function updateSimulatorUI() {
  const simulation = getLoanSimulation();
  const amountLabel = $('#simAmountValue');
  const monthsLabel = $('#simMonthsValue');
  if (amountLabel) amountLabel.textContent = formatAmount(simulation.amount);
  if (monthsLabel) monthsLabel.textContent = `${simulation.months} mois`;
  const container = $('#simResults');
  if (container) container.innerHTML = simulatorResultsHTML(simulation);
}

function openDossierDialog() {
  const readiness = getReadiness();
  const simulation = getLoanSimulation();
  const suggested = getSuggestedLoan();
  const dialog = $('#dossierDialog');
  const body = $('#dossierDialogBody');
  if (!body) return;
  const docs = state.documents.slice(0, 5);
  body.innerHTML = `
    <div class="dossier-preview">
      <div class="dossier-preview-head">
        <div class="dossier-preview-brand">
          <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M8 23v-6M15 23V10M22 23V5" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg></span>
          <strong>sika.</strong>
        </div>
        <div class="dossier-preview-meta">
          <span>Dossier de financement</span>
          <strong>${escapeHTML(state.profile.business)}</strong>
          <small>Généré le ${formatDate(todayISO())}</small>
        </div>
      </div>
      <div class="dossier-business">
        <div>
          <h3>${escapeHTML(state.profile.owner)}</h3>
          <p>${escapeHTML(state.profile.business)} · ${escapeHTML(state.profile.city)}, ${escapeHTML(state.profile.country)}</p>
        </div>
        <div class="dossier-score-mini"><span class="score-bubble">${readiness.score}</span> ${readiness.label}</div>
      </div>
      <div class="dossier-preview-kpis">
        <div class="dossier-kpi"><span>Bénéfice / mois</span><strong>${formatAmount(Math.round(readiness.avgMonthlyNet))}</strong></div>
        <div class="dossier-kpi"><span>Documents vérifiés</span><strong>${readiness.docs}</strong></div>
        <div class="dossier-kpi"><span>Capacité estimée</span><strong>${formatAmount(suggested.maxAmount)}</strong></div>
      </div>
      <p>Cette synthèse présente l’historique de ${escapeHTML(state.profile.business)} sur ${readiness.activeMonths} mois. Les revenus moyens et la régularité des encaissements ressortent favorablement, avec un score de préparation de <strong>${readiness.score}/100</strong>.</p>
      <h4>Forces du dossier</h4>
      <p>${readiness.components.filter(component => component.score / component.max >= 0.7).map(component => component.label).join(' · ') || 'Historique en cours de constitution.'}</p>
      <h4>Documents disponibles</h4>
      <div class="dossier-doc-list">
        ${docs.length ? docs.map(doc => `<div class="dossier-doc-row">${icon('check-circle')} ${escapeHTML(doc.title)} · ${formatDate(doc.date)}</div>`).join('') : '<div class="dossier-doc-row">Aucun document scanné pour le moment.</div>'}
      </div>
      <h4>Simulation de financement</h4>
      <p>Montant sollicité : <strong>${formatAmount(simulation.amount)}</strong> sur ${simulation.months} mois. Mensualité estimée : <strong>${formatAmount(simulation.monthlyPayment)}</strong>, soit ${formatPercent(simulation.ratio)} % du bénéfice mensuel moyen. Capacité de remboursement mensuelle estimée : ${formatAmount(suggested.monthlyCapacity)}.</p>
      <div class="dossier-disclaimer">Document indicatif généré à partir de données déclaratives. Il ne constitue ni une offre de crédit, ni une garantie de financement. Les informations devront être vérifiées par l’institution financière.</div>
    </div>
    <div class="dossier-preview-actions">
      <button type="button" class="btn btn-secondary" data-close-dialog="dossierDialog">Fermer</button>
      <button type="button" class="btn btn-primary" data-action="print-dossier">${icon('printer', 'icon-sm')} Imprimer / PDF</button>
    </div>`;
  if (!dialog.open) dialog.showModal();
}

function printDossier() {
  const readiness = getReadiness();
  const simulation = getLoanSimulation();
  const suggested = getSuggestedLoan();
  const components = readiness.components.map(component => {
    const percentage = Math.round((component.score / component.max) * 100);
    return `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:10px;color:#52665c;margin-bottom:4px"><span style="font-weight:500">${escapeHTML(component.label)}</span><strong>${component.score}/${component.max}</strong></div><div style="height:5px;background:#f1ede2;border-radius:4px;overflow:hidden"><div style="height:100%;width:${percentage}%;background:${percentage >= 70 ? '#21765a' : '#eab45f'};border-radius:4px"></div></div></div>`;
  }).join('');
  const docList = state.documents.slice(0, 6).map(doc => `<li>${escapeHTML(doc.title)} — ${formatAmount(doc.amount)} (${formatDate(doc.date)})</li>`).join('');
  const html = `
    <div class="print-page">
      <article class="report-sheet" style="padding:0;border:0;box-shadow:none;background:#fff">
        <div class="report-letterhead">
          <div class="report-brand">
            <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M8 23v-6M15 23V10M22 23V5" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg></span>
            <span class="report-brand-copy"><strong>sika.</strong><small>Dossier de financement</small></span>
          </div>
          <div class="report-letterhead-meta">
            <span class="report-kind">Dossier de financement</span>
            <h2>${escapeHTML(state.profile.business)}</h2>
            <p>Généré le ${todayLongLabel()}</p>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;gap:20px;align-items:center;margin:24px 0 18px;padding-bottom:16px;border-bottom:1px solid #e6e0d2">
          <div><h1 style="font-family:Fraunces,Georgia,serif;font-size:28px;font-weight:500;letter-spacing:-.04em;margin:0 0 4px">${escapeHTML(state.profile.owner)}</h1><p style="font-size:11px;color:#6f8078;margin:0">${escapeHTML(state.profile.business)} · ${escapeHTML(state.profile.city)}, ${escapeHTML(state.profile.country)} · ${escapeHTML(state.profile.phone)}</p></div>
          <div style="min-width:112px;text-align:center;padding:12px;border:1px solid #dfeee6;border-radius:12px;background:#edf6f0"><div style="font-family:Fraunces,Georgia,serif;font-size:28px;color:#0d3b2e;line-height:1;font-weight:600">${readiness.score}<span style="font-size:11px;color:#6f8078">/100</span></div><div style="font-size:9px;color:#21765a;font-weight:600;margin-top:4px">${readiness.label}</div></div>
        </div>
        <div class="report-kpis">
          <div class="report-kpi"><span>Bénéfice moyen / mois</span><strong>${formatNumber(readiness.avgMonthlyNet)} <small>FCFA</small></strong><em>sur les 3 derniers mois</em></div>
          <div class="report-kpi"><span>Chiffre d’affaires / 6 mois</span><strong>${formatNumber(readiness.semester.income)} <small>FCFA</small></strong><em>${readiness.activeMonths} mois documentés</em></div>
          <div class="report-kpi"><span>Capacité mensuelle</span><strong>${formatNumber(suggested.monthlyCapacity)} <small>FCFA</small></strong><em>plafond indicatif</em></div>
        </div>
        <section class="report-section"><div class="report-section-head"><h3>Synthèse de l’activité</h3><span>Analyse Sika</span></div>
          <div class="report-narrative"><p>${escapeHTML(state.profile.business)} exerce une activité de commerce de proximité documentée sur ${readiness.activeMonths} mois. Les encaissements enregistrés sur les six derniers mois s’élèvent à <strong>${formatAmount(readiness.semester.income)}</strong>, pour un bénéfice net cumulé de <strong>${formatAmount(readiness.semester.net)}</strong>. Le bénéfice mensuel moyen retenu est de <strong>${formatAmount(readiness.avgMonthlyNet)}</strong>.</p><p>La demande simulée porte sur <strong>${formatAmount(simulation.amount)}</strong> remboursables sur ${simulation.months} mois, avec une mensualité estimée à <strong>${formatAmount(simulation.monthlyPayment)}</strong>. Cette mensualité représente ${formatPercent(simulation.ratio)} % du bénéfice mensuel moyen.</p></div>
        </section>
        <div class="report-bottom-grid">
          <section><div class="report-section-head"><h3>Score de préparation</h3><span>${readiness.score}/100</span></div>${components}</section>
          <section><div class="report-section-head"><h3>Documents disponibles</h3><span>${state.documents.length}</span></div>${docList ? `<ul style="font-size:9px;line-height:1.8;color:#52665c;padding-left:14px">${docList}</ul>` : '<p style="font-size:9px;color:#6f8078">Aucun document disponible.</p>'}</section>
        </div>
        <div class="report-footer"><span>Document généré par <strong>Sika</strong> · données déclaratives de l’activité</span><span>Ne constitue pas une offre de crédit.</span></div>
      </article>
    </div>`;
  closeDialog('dossierDialog');
  launchPrint(html);
}

function launchPrint(html) {
  const printArea = $('#printArea');
  if (!printArea) return;
  printArea.innerHTML = html;
  const cleanup = () => {
    printArea.innerHTML = '';
    window.removeEventListener('afterprint', cleanup);
    if (printCleanupTimer) clearTimeout(printCleanupTimer);
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  if (printCleanupTimer) clearTimeout(printCleanupTimer);
  printCleanupTimer = setTimeout(cleanup, 60000);
  setTimeout(() => window.print(), 160);
}

/* ---------- Paramètres ---------- */
function preferenceRowHTML(key, title, description, checked) {
  return `
    <div class="preference-row">
      <div class="preference-copy"><strong>${title}</strong><small>${description}</small></div>
      <label class="switch">
        <input type="checkbox" data-pref="${key}" ${checked ? 'checked' : ''}>
        <span class="switch-track"></span>
      </label>
    </div>`;
}

function renderSettings() {
  const page = $('.page[data-page="settings"]');
  if (!page) return;
  const profile = state.profile;
  const locationLabel = [profile.city, profile.country].filter(Boolean).join(', ');
  page.innerHTML = `
    <div class="page-head">
      <div class="page-head-main">
        <p class="eyebrow">Votre espace</p>
        <h1 class="page-title" id="settingsTitle">Paramètres<em>.</em></h1>
        <p class="page-subtitle">Votre profil, vos préférences et la gestion de vos données locales.</p>
      </div>
    </div>

    <div class="settings-grid">
      <div class="settings-column">
        <section class="card settings-card">
          <div class="settings-card-head">
            <span class="settings-head-icon">${icon('briefcase')}</span>
            <div><h2>Profil de l’entreprise</h2><p>Ces informations apparaissent sur vos rapports et votre dossier.</p></div>
          </div>
          <div class="profile-banner">
            <span class="profile-banner-avatar">${escapeHTML(getBusinessInitials(profile.business))}</span>
            <div><h3>${escapeHTML(profile.business)}</h3><p>${escapeHTML(profile.owner)} · ${escapeHTML(locationLabel)}</p></div>
            <span class="status-pill">${icon('check')} Actif</span>
          </div>
          <form id="settingsForm" class="settings-form">
            <div class="form-grid">
              <label class="field field-span-2">
                <span>Nom du commerce <em>*</em></span>
                <input type="text" name="business" value="${escapeHTML(profile.business)}" required maxlength="70">
              </label>
              <label class="field">
                <span>Nom du gérant <em>*</em></span>
                <input type="text" name="owner" value="${escapeHTML(profile.owner)}" required maxlength="70">
              </label>
              <label class="field">
                <span>Téléphone</span>
                <input type="tel" name="phone" value="${escapeHTML(profile.phone)}" maxlength="30">
              </label>
              <label class="field">
                <span>Ville</span>
                <input type="text" name="city" value="${escapeHTML(profile.city)}" maxlength="50">
              </label>
              <label class="field">
                <span>Pays</span>
                <input type="text" name="country" value="${escapeHTML(profile.country)}" maxlength="50">
              </label>
              <label class="field field-span-2">
                <span>Trésorerie de départ <small>(solde à l’ouverture)</small></span>
                <span class="input-suffix">
                  <input type="number" name="openingBalance" value="${Number(profile.openingBalance) || 0}" min="0" step="1000">
                  <span>FCFA</span>
                </span>
              </label>
            </div>
            <div class="settings-actions">
              <button type="submit" class="btn btn-primary">${icon('check', 'icon-sm')} Enregistrer le profil</button>
            </div>
          </form>
        </section>

        <section class="card settings-card">
          <div class="settings-card-head">
            <span class="settings-head-icon">${icon('settings')}</span>
            <div><h2>Préférences</h2><p>Adaptez le comportement de Sika à votre quotidien.</p></div>
          </div>
          <div class="preference-list">
            ${preferenceRowHTML('notifications', 'Notifications et rappels', 'Recevoir un rappel lorsqu’un justificatif manque.', state.preferences.notifications)}
            ${preferenceRowHTML('autoCategorize', 'Tri automatique des reçus', 'Classer automatiquement les documents par catégorie.', state.preferences.autoCategorize)}
            ${preferenceRowHTML('aiInsights', 'Analyses et conseils', 'Afficher l’œil de Sika et les recommandations personnalisées.', state.preferences.aiInsights)}
          </div>
          <div class="settings-note">${icon('sparkles')} L’extraction et l’analyse fonctionnent directement dans votre navigateur, sans compte à créer.</div>
        </section>
      </div>

      <div class="settings-column">
        <section class="card settings-card">
          <div class="settings-card-head">
            <span class="settings-head-icon">${icon('download')}</span>
            <div><h2>Mes données</h2><p>Exportez ou réinitialisez les informations stockées sur cet appareil.</p></div>
          </div>
          <div class="data-actions">
            <button type="button" class="data-action" data-action="download-json">
              <span class="data-action-icon">${icon('download')}</span>
              <span class="data-action-copy"><strong>Exporter toutes mes données</strong><small>${state.transactions.length} opérations · ${state.documents.length} documents (JSON)</small></span>
              ${icon('chevron-right')}
            </button>
            <button type="button" class="data-action" data-action="export-csv-all">
              <span class="data-action-icon">${icon('receipt')}</span>
              <span class="data-action-copy"><strong>Exporter le journal de caisse</strong><small>Fichier CSV compatible tableur</small></span>
              ${icon('chevron-right')}
            </button>
            <button type="button" class="data-action danger" data-action="reset-data">
              <span class="data-action-icon">${icon('refresh')}</span>
              <span class="data-action-copy"><strong>Réinitialiser l’application</strong><small>Restaurer les données de démonstration</small></span>
              ${icon('chevron-right')}
            </button>
          </div>
          <div class="settings-note">${icon('lock')} Vos données ne quittent pas cet appareil. Pensez à exporter régulièrement votre journal.</div>
        </section>

        <section class="about-card">
          <div class="about-logo-row">
            <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M8 23v-6M15 23V10M22 23V5" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg></span>
            <strong>sika.</strong>
          </div>
          <h3>Une identité financière pour les petits commerces.</h3>
          <p>Sika transforme les reçus, les ventes et les dépenses du quotidien en une comptabilité claire et en un dossier de financement crédible.</p>
          <div class="about-meta">${icon('info')} Version ${APP_VERSION} · prototype commerçant</div>
        </section>
      </div>
    </div>`;
}

function saveSettingsForm() {
  const form = $('#settingsForm');
  if (!form) return;
  const data = new FormData(form);
  state.profile.business = String(data.get('business') || '').trim() || state.profile.business;
  state.profile.owner = String(data.get('owner') || '').trim() || state.profile.owner;
  state.profile.phone = String(data.get('phone') || '').trim();
  state.profile.city = String(data.get('city') || '').trim();
  state.profile.country = String(data.get('country') || '').trim();
  state.profile.openingBalance = Math.max(0, Number(data.get('openingBalance')) || 0);
  saveState();
  updateChrome();
  renderSettings();
  showToast('Profil enregistré', 'Vos informations sont à jour dans tous vos documents.');
}

function exportStateJSON() {
  const payload = {
    application: 'Sika',
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    ...state
  };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `sika-donnees-${todayISO()}.json`);
  showToast('Données exportées', 'Le fichier JSON contient vos opérations, documents et préférences.');
}

function resetAppData() {
  const confirmed = window.confirm('Réinitialiser Sika ?\n\nToutes vos opérations et vos documents locaux seront remplacés par les données de démonstration.');
  if (!confirmed) return;
  try { localStorage.removeItem(STORAGE_KEY); } catch (error) { /* stockage indisponible : on continue avec l'état en mémoire */ }
  state = createDefaultState();
  saveState(true);
  resetScanner();
  txFilters.search = '';
  txFilters.type = 'all';
  txFilters.period = 'all';
  txFilters.visible = 12;
  docFilters.type = 'all';
  if (location.hash !== '#overview') {
    try { history.replaceState(null, '', '#overview'); } catch (error) { /* iframe sans origine : ignoré */ }
  }
  switchView('overview');
  showToast('Application réinitialisée', 'Les données de démonstration ont été restaurées.');
}

/* ---------- Notifications et tiroir ---------- */
function openSidebar() {
  $('#sidebar')?.classList.add('is-open');
  $('#sidebarOverlay')?.classList.add('is-open');
}
function closeSidebar() {
  $('#sidebar')?.classList.remove('is-open');
  $('#sidebarOverlay')?.classList.remove('is-open');
}
function openNotifications() {
  const panel = $('#notificationPanel');
  const button = $('#notificationButton');
  if (!panel) return;
  panel.hidden = false;
  button?.setAttribute('aria-expanded', 'true');
}
function closeNotifications() {
  const panel = $('#notificationPanel');
  const button = $('#notificationButton');
  if (!panel) return;
  panel.hidden = true;
  button?.setAttribute('aria-expanded', 'false');
}
function toggleNotifications() {
  const panel = $('#notificationPanel');
  if (!panel) return;
  if (panel.hidden) openNotifications(); else closeNotifications();
}

/* ---------- Journalisation et suppression ---------- */
function showFormError(element, message) {
  const error = $('#txFormError');
  if (error) {
    error.textContent = message;
    error.hidden = false;
  }
  element?.focus();
}

function saveTransactionForm() {
  const form = $('#transactionForm');
  if (!form) return;
  const id = $('#txId').value;
  const type = form.querySelector('input[name="type"]:checked')?.value || 'income';
  const label = $('#txLabel').value.trim();
  const amount = Number($('#txAmount').value);
  const date = $('#txDate').value;
  const category = $('#txCategory').value;
  const method = $('#txMethod').value;
  const party = $('#txParty').value.trim();
  const note = $('#txNote').value.trim();
  const error = $('#txFormError');
  if (error) error.hidden = true;

  if (!label) return showFormError($('#txLabel'), 'Ajoutez un libellé pour identifier l’opération.');
  if (!amount || amount <= 0) return showFormError($('#txAmount'), 'Saisissez un montant supérieur à zéro.');
  if (!date) return showFormError($('#txDate'), 'Choisissez une date.');
  if (date > todayISO()) return showFormError($('#txDate'), 'La date ne peut pas être dans le futur.');

  const existing = id ? state.transactions.find(tx => tx.id === id) : null;
  if (existing) {
    Object.assign(existing, { type, label, amount, date, category, method, party, note });
    const doc = state.documents.find(item => item.transactionId === existing.id);
    if (doc) Object.assign(doc, { type, amount, date, category, party });
    saveState();
    closeDialog('transactionDialog');
    renderCurrentPage();
    updateChrome();
    showToast('Opération modifiée', `${label} a été mise à jour.`);
  } else {
    const transaction = {
      id: uid('tx'),
      type, label, amount, date, category, method, party, note,
      source: 'manuel',
      documentId: null,
      createdAt: new Date().toISOString()
    };
    state.transactions.unshift(transaction);
    saveState();
    closeDialog('transactionDialog');
    renderCurrentPage();
    updateChrome();
    showToast('Opération enregistrée', `${label} a été ajoutée à votre journal.`);
  }
}

function deleteTransactionFromDialog() {
  const id = $('#txId').value;
  const transaction = state.transactions.find(tx => tx.id === id);
  if (!transaction) return;
  if (!window.confirm(`Supprimer « ${transaction.label} » ?\n\nCette action est définitive.`)) return;
  state.transactions = state.transactions.filter(tx => tx.id !== id);
  state.documents.forEach(doc => {
    if (doc.transactionId === id) doc.transactionId = null;
  });
  saveState();
  closeDialog('transactionDialog');
  renderCurrentPage();
  updateChrome();
  showToast('Opération supprimée', 'L’opération a été retirée du journal.');
}

function saveScannedTransaction() {
  const form = $('#scanForm');
  if (!form) return;
  const extraction = scannerState.extraction || {};
  const type = form.querySelector('input[name="scanType"]:checked')?.value || 'expense';
  const label = form.querySelector('[name="label"]').value.trim();
  const amount = Number(form.querySelector('[name="amount"]').value);
  const date = form.querySelector('[name="date"]').value;
  const category = form.querySelector('[name="category"]').value;
  const method = form.querySelector('[name="method"]').value;
  const party = form.querySelector('[name="party"]').value.trim();

  if (!label) {
    showToast('Libellé manquant', 'Indiquez un libellé pour cette opération.', 'error');
    form.querySelector('[name="label"]')?.focus();
    return;
  }
  if (!amount || amount <= 0) {
    showToast('Montant invalide', 'Saisissez le montant total lu sur le document.', 'error');
    form.querySelector('[name="amount"]')?.focus();
    return;
  }
  if (!date || date > todayISO()) {
    showToast('Date invalide', 'Choisissez une date valide, pas dans le futur.', 'error');
    form.querySelector('[name="date"]')?.focus();
    return;
  }

  const transactionId = uid('tx');
  const documentId = uid('doc');
  const now = new Date().toISOString();
  const transaction = {
    id: transactionId,
    type,
    label,
    amount,
    date,
    category,
    method,
    party,
    note: extraction.note || '',
    source: 'scan',
    documentId,
    createdAt: now
  };
  const image = scannerState.image && !scannerState.image.startsWith('blob:') ? scannerState.image : '';
  const documentRecord = {
    id: documentId,
    transactionId,
    name: scannerState.fileName || 'document-scan.jpg',
    title: extraction.documentTitle || extraction.title || label,
    type,
    category,
    party,
    amount,
    date,
    status: scannerState.fallback ? 'À vérifier' : 'Vérifié',
    confidence: extraction.confidence || 0,
    docNumber: extraction.docNumber || '',
    lineItems: extraction.lineItems || [],
    image,
    uploadedAt: now
  };

  state.transactions.unshift(transaction);
  state.documents.unshift(documentRecord);
  let saved = saveState(true);
  if (!saved && documentRecord.image) {
    documentRecord.image = '';
    saved = saveState(true);
    if (saved) showToast('Document ajouté sans aperçu', 'Le stockage local est saturé : l’aperçu n’a pas pu être conservé.', 'error');
  }
  if (!saved) {
    showToast('Sauvegarde incomplète', 'L’opération est en mémoire mais n’a pas pu être enregistrée durablement.', 'error');
  }

  scannerState.phase = 'saved';
  scannerState.savedTransactionId = transactionId;
  renderScanner();
  updateChrome();
  showToast('Ajouté à votre comptabilité', `${label} · ${formatAmount(amount)}`);
}

/* ---------- Toasts ---------- */
function showToast(title, message = '', type = 'success') {
  const stack = $('#toastStack');
  if (!stack) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'error' : ''}`;
  const iconName = type === 'error' ? 'alert' : type === 'info' ? 'sparkles' : 'check-circle';
  toast.innerHTML = `
    <span class="toast-icon">${icon(iconName)}</span>
    <span class="toast-copy"><strong>${escapeHTML(title)}</strong>${message ? `<p>${escapeHTML(message)}</p>` : ''}</span>
    <button type="button" class="toast-close" aria-label="Fermer">${icon('x')}</button>`;
  const remove = () => {
    if (!toast.isConnected) return;
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 220);
  };
  toast.querySelector('.toast-close')?.addEventListener('click', remove);
  stack.appendChild(toast);
  while (stack.children.length > 3) stack.firstElementChild.remove();
  setTimeout(remove, type === 'error' ? 6500 : 4800);
}

/* ---------- Gestion globale des événements ---------- */
function handleGlobalClick(event) {
  const origin = event.target;

  if (origin.closest('#notificationButton')) {
    event.preventDefault();
    toggleNotifications();
    return;
  }
  if (!origin.closest('#notificationPanel')) {
    closeNotifications();
  }

  const closeTarget = origin.closest('[data-close-dialog]');
  if (closeTarget) {
    event.preventDefault();
    closeDialog(closeTarget.dataset.closeDialog);
    return;
  }

  const actionTarget = origin.closest('[data-action]');
  const viewTarget = origin.closest('[data-view]');

  if (actionTarget) {
    event.preventDefault();
    const action = actionTarget.dataset.action;
    const id = actionTarget.dataset.id;
    switch (action) {
      case 'toggle-sidebar':
        $('#sidebar')?.classList.contains('is-open') ? closeSidebar() : openSidebar();
        break;
      case 'close-sidebar':
        closeSidebar();
        break;
      case 'close-notifications':
        closeNotifications();
        break;
      case 'add-transaction':
        openTransactionDialog();
        break;
      case 'edit-transaction': {
        const transaction = state.transactions.find(tx => tx.id === id);
        if (transaction) openTransactionDialog(transaction);
        break;
      }
      case 'delete-transaction':
        deleteTransactionFromDialog();
        break;
      case 'chart-period':
        state.chartPeriod = actionTarget.dataset.period === '3m' ? '3m' : '6m';
        saveState(true);
        renderOverview();
        break;
      case 'filter-tx-type':
        txFilters.type = actionTarget.dataset.value || 'all';
        txFilters.visible = 12;
        renderTransactions();
        break;
      case 'reset-tx-filters':
        txFilters.search = '';
        txFilters.type = 'all';
        txFilters.period = 'all';
        txFilters.visible = 12;
        renderTransactions();
        break;
      case 'load-more-transactions':
        txFilters.visible += 12;
        updateTransactionsView();
        break;
      case 'export-csv':
        exportTransactionsCSV();
        break;
      case 'export-csv-all':
        exportTransactionsCSV(sortedTransactions());
        break;
      case 'filter-documents':
        docFilters.type = actionTarget.dataset.value || 'all';
        renderDocuments();
        break;
      case 'open-document':
        closeNotifications();
        openDocumentDialog(id);
        break;
      case 'open-linked-transaction': {
        const linked = state.transactions.find(tx => tx.id === id);
        closeDialog('documentDialog');
        if (linked) openTransactionDialog(linked);
        break;
      }
      case 'trigger-scan-file':
        $('#scanFileInput')?.click();
        break;
      case 'trigger-scan-camera':
        $('#scanCameraInput')?.click();
        break;
      case 'use-sample':
        useSampleScan(actionTarget.dataset.sample);
        break;
      case 'new-scan':
        resetScanner();
        break;
      case 'skip-ocr':
        skipOCR();
        break;
      case 'copy-report':
        copyReportSummary();
        break;
      case 'print-report':
        printReport();
        break;
      case 'open-dossier':
        openDossierDialog();
        break;
      case 'print-dossier':
        printDossier();
        break;
      case 'download-json':
        exportStateJSON();
        break;
      case 'reset-data':
        resetAppData();
        break;
      default:
        break;
    }
    return;
  }

  if (viewTarget) {
    event.preventDefault();
    navigateTo(viewTarget.dataset.view);
  }
}

function handleGlobalChange(event) {
  const target = event.target;
  if (target.name === 'type' && target.closest('#transactionForm')) {
    const selected = target.value;
    const currentId = $('#txId').value;
    const current = currentId ? state.transactions.find(tx => tx.id === currentId) : null;
    const keepCategory = current && current.type === selected ? current.category : null;
    setTransactionCategoryOptions($('#txCategory'), selected, keepCategory);
    return;
  }
  if (target.matches('[data-pref]')) {
    const key = target.dataset.pref;
    state.preferences[key] = target.checked;
    saveState(true);
    updateChrome();
    if (key === 'notifications' && target.checked) {
      showToast('Notifications activées', 'Sika vous rappellera quand un justificatif manque.');
    }
    return;
  }
  if (target.matches('[data-checklist-key]') && target.dataset.checklistKey) {
    state.checklist[target.dataset.checklistKey] = target.checked;
    saveState(true);
    renderFinancing();
    updateChrome();
    if (target.checked) showToast('Pièce ajoutée', 'Votre score de financement a été mis à jour.');
  }
}

function handleGlobalSubmit(event) {
  const form = event.target;
  // getAttribute plutôt que .id : un champ nommé "id" dans le formulaire masque la propriété id.
  const formId = form instanceof HTMLFormElement ? form.getAttribute('id') : null;
  if (formId === 'transactionForm') {
    event.preventDefault();
    saveTransactionForm();
  } else if (formId === 'scanForm') {
    event.preventDefault();
    saveScannedTransaction();
  } else if (formId === 'settingsForm') {
    event.preventDefault();
    saveSettingsForm();
  }
}

function handleGlobalKeydown(event) {
  if (event.key === 'Escape') {
    closeNotifications();
    closeSidebar();
  }
}

/* ---------- Initialisation ---------- */
function bindGlobalEvents() {
  document.addEventListener('click', handleGlobalClick);
  document.addEventListener('change', handleGlobalChange);
  document.addEventListener('submit', handleGlobalSubmit);
  document.addEventListener('keydown', handleGlobalKeydown);

  $$('dialog.modal').forEach(dialog => {
    dialog.addEventListener('click', event => {
      if (event.target === dialog) dialog.close();
    });
  });

  document.addEventListener('dragover', event => {
    const dropzone = event.target.closest('[data-dropzone]');
    if (!dropzone) return;
    event.preventDefault();
    dropzone.classList.add('is-dragging');
  });
  document.addEventListener('dragleave', event => {
    const dropzone = event.target.closest('[data-dropzone]');
    if (!dropzone) return;
    dropzone.classList.remove('is-dragging');
  });
  document.addEventListener('drop', event => {
    const dropzone = event.target.closest('[data-dropzone]');
    if (!dropzone) return;
    event.preventDefault();
    dropzone.classList.remove('is-dragging');
    const file = event.dataTransfer?.files?.[0];
    if (file) handleScanFile(file);
  });

  window.addEventListener('hashchange', () => {
    const view = location.hash.replace('#', '');
    if (VIEWS.includes(view) && view !== currentView) switchView(view);
  });
}

function initApp() {
  bindGlobalEvents();
  const initial = location.hash.replace('#', '');
  const view = VIEWS.includes(initial) ? initial : 'overview';
  switchView(view);
}

initApp();
