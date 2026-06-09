const API_URL = 'https://script.google.com/macros/s/AKfycbwA271ln5DbeQZ2fWr-GxHnLxoJte8jlpLDIBnGFjo4hJYtpbIS0rRMd_bfqwf12WKlSg/exec';

function apiRequest(action, args) {
  args = Array.isArray(args) ? args : (args === undefined ? [] : [args]);

  return new Promise((resolve, reject) => {
    const callbackName = '__boulangerieApiCallback_' + Date.now() + '_' + Math.floor(Math.random() * 1000000);
    const script = document.createElement('script');
    const sep = API_URL.indexOf('?') === -1 ? '?' : '&';

    const cleanup = () => {
      try { delete window[callbackName]; } catch (e) { window[callbackName] = undefined; }
      if (script && script.parentNode) script.parentNode.removeChild(script);
    };

    window[callbackName] = (response) => {
      cleanup();
      if (response && response.success) {
        resolve(response.result);
      } else {
        reject(new Error((response && response.error) || 'Erreur API Apps Script'));
      }
    };

    script.onerror = () => {
      cleanup();
      reject(new Error('Impossible de contacter l’API Apps Script.'));
    };

    script.src = API_URL + sep +
      'action=' + encodeURIComponent(action) +
      '&payload=' + encodeURIComponent(JSON.stringify(args)) +
      '&callback=' + encodeURIComponent(callbackName) +
      '&_=' + Date.now();

    document.body.appendChild(script);
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    });
  }
}

function setupInstallPrompt() {
  let deferredPrompt = null;
  const banner = document.getElementById('installPwaBanner');
  const installBtn = document.getElementById('installPwaBtn');
  const iosHelp = document.getElementById('iosInstallHelp');

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);

  if (!isStandalone && isIOS) {
    setTimeout(() => { if (iosHelp) iosHelp.classList.add('show'); }, 1200);
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    if (banner && !isStandalone) banner.classList.add('show');
  });

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      if (banner) banner.classList.remove('show');
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
    });
  }

  window.addEventListener('appinstalled', () => {
    if (banner) banner.classList.remove('show');
  });
}

registerServiceWorker();
document.addEventListener('DOMContentLoaded', setupInstallPrompt);

let PARAMS = { boulangeries: [], employes: [], produits: [], prixProduits: {}, statuts: [], priorites: [] };
let LAST_BOULANGERIE = '';
let LAST_EMPLOYE = '';
let HAS_SAVED_ORDER = false;
let APP_BUSY = false;

const titles = {
  'main-menu': ['', ''],
  dashboard: ['Accueil', ''],
  'new-order': ['Nouvelle commande', ''],
  history: ['Historique', ''],
  production: ['Production', ''],
  billing: ['Facturation', ''],
  settings: ['Paramètres', '']
};

document.addEventListener('DOMContentLoaded', initApp);

function initApp() {
  setBusy(true, 'Chargement...');
  document.getElementById('orderForm').addEventListener('submit', submitOrder);
  document.getElementById('orderForm').addEventListener('reset', () => setTimeout(resetOrderForm, 0));
  document.getElementById('telephone').addEventListener('blur', cleanTelephoneField);
  document.addEventListener('input', event => { if (event.target.matches('.line-qte,.line-prix')) updateOrderTotal(); });

  apiRequest('getAppData').then(data => {
      PARAMS = data.parametres || PARAMS;
      hydrateSelects();
      updateStats(data.stats || {});
      renderProductsSettings();
      setTodayLabel();
      resetOrderForm();
      document.getElementById('loader').classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
      setBusy(false);
    })
    .catch(err => { setBusy(false); showError(err); });
}

function refreshAll() {
  if (APP_BUSY) return;
  setBusy(true, 'Actualisation...');
  apiRequest('getAppData').then(data => {
      PARAMS = data.parametres || PARAMS;
      hydrateSelects();
      updateStats(data.stats || {});
      renderProductsSettings();
      setBusy(false);
      toast('Données actualisées', 'success');
    })
    .catch(err => { setBusy(false); showError(err); });
}

function showPage(pageId) {
  if (APP_BUSY) return;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
  if (pageId === 'history') loadHistory();
  if (pageId === 'production') loadProduction();
  if (pageId === 'billing') loadInvoices();
  if (pageId === 'settings') renderProductsSettings();
}

function setTodayLabel() {
  const el = document.getElementById('todayLabel');
  if (!el) return;
  const d = new Date();
  el.textContent = d.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).replace(/^./, c => c.toUpperCase());
}


function showMainMenu() {
  showPage('main-menu');
}

function hydrateSelects() {
  fillSelect('boulangerie', PARAMS.boulangeries, '');
  fillSelect('employe', PARAMS.employes, '');
  fillSelect('hBoulangerie', PARAMS.boulangeries, 'Toutes les boulangeries');
  fillSelect('pBoulangerie', PARAMS.boulangeries, 'Toutes les boulangeries');
  fillSelect('fBoulangerie', PARAMS.boulangeries, 'Toutes les boulangeries');
  fillSelect('hStatut', PARAMS.statuts, 'Tous les statuts');
}

function fillSelect(id, values, placeholder) {
  const select = document.getElementById(id);
  if (!select) return;
  const current = select.value;
  select.innerHTML = '';
  if (placeholder !== undefined) select.append(new Option(placeholder, ''));
  (values || []).forEach(v => select.append(new Option(v, v)));
  if ([...select.options].some(o => o.value === current)) select.value = current;
}

function updateStats(stats) {
  document.getElementById('statCommandes').textContent = stats.commandesJour || 0;
  document.getElementById('statProduction').textContent = stats.productionJour || 0;
  document.getElementById('statFactures').textContent = stats.facturesAttente || 0;
}

function resetOrderForm() {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('dateLivraison').value = today;
  document.getElementById('heure').value = '08:00';

  // Au premier affichage, Boulangerie, Employe et Produit restent vides.
  // Apres une commande enregistree, on conserve seulement Boulangerie et Employe.
  document.getElementById('boulangerie').value = HAS_SAVED_ORDER ? LAST_BOULANGERIE : '';
  document.getElementById('employe').value = HAS_SAVED_ORDER ? LAST_EMPLOYE : '';

  document.getElementById('productLines').innerHTML = '';
  addProductLine();
}

function addProductLine() {
  const wrap = document.getElementById('productLines');
  const line = document.createElement('div');
  line.className = 'product-line';
  line.innerHTML = `
    <label>Produit<select class=\"line-product\" required></select></label>
    <label>Qté<input class=\"line-qte\" type=\"number\" min=\"1\" step=\"1\" value=\"1\" required></label>
    <label>Prix<input class=\"line-prix\" type=\"number\" min=\"0\" step=\"0.01\" value=\"0\"></label>
    <input class=\"line-note\" type=\"hidden\" value=\"\">
    <button type=\"button\" class=\"btn danger line-remove\" title=\"Supprimer\" onclick=\"removeProductLine(this)\">×</button>
  `;
  wrap.appendChild(line);
  const select = line.querySelector('.line-product');
  select.append(new Option('', ''));
  (PARAMS.produits || []).forEach(p => select.append(new Option(p, p)));
  select.value = '';
  select.addEventListener('change', () => { updateLinePrice(line); updateOrderTotal(); });
  updateLinePrice(line);
}

function updateLinePrice(line) {
  const produit = line.querySelector('.line-product').value;
  const priceInput = line.querySelector('.line-prix');
  const price = Number((PARAMS.prixProduits || {})[produit] || 0);
  priceInput.value = price ? price.toFixed(2) : '0';
  updateOrderTotal();
}

function updateOrderTotal() {
  const total = [...document.querySelectorAll('.product-line')].reduce((sum, line) => {
    const qte = Number(line.querySelector('.line-qte')?.value || 0);
    const prix = Number(line.querySelector('.line-prix')?.value || 0);
    return sum + qte * prix;
  }, 0);
  const el = document.getElementById('orderTotal');
  if (el) el.textContent = formatMoney(total);
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function removeProductLine(button) {
  const lines = document.querySelectorAll('.product-line');
  if (lines.length <= 1) return toast('Il faut garder au moins un produit.', 'error');
  button.closest('.product-line').remove();
  updateOrderTotal();
}

function cleanTelephoneField() {
  const input = document.getElementById('telephone');
  input.value = cleanPhone(input.value);
}

function cleanPhone(value) {
  return String(value || '').replace(/\D/g, '').trim();
}

function submitOrder(event) {
  event.preventDefault();
  const phone = cleanPhone(document.getElementById('telephone').value);
  document.getElementById('telephone').value = phone;
  if (!/^\d{10}$/.test(phone)) {
    toast('Le téléphone doit contenir exactement 10 chiffres.', 'error');
    return;
  }

  const produits = [...document.querySelectorAll('.product-line')].map(line => ({
    produit: line.querySelector('.line-product').value,
    qte: Number(line.querySelector('.line-qte').value),
    prix: Number(line.querySelector('.line-prix').value || 0),
    note: line.querySelector('.line-note').value.trim()
  }));

  const payload = {
    boulangerie: document.getElementById('boulangerie').value,
    employe: document.getElementById('employe').value,
    dateLivraison: document.getElementById('dateLivraison').value,
    heure: document.getElementById('heure').value,
    client: document.getElementById('client').value.trim(),
    telephone: phone,
    produits: produits,
    statut: 'Confirmée'
  };

  setBusy(true);
  apiRequest('saveCommande', [payload]).then(res => {
      setBusy(false);
      toast(`Commande ${res.numero} enregistrée`, 'success');
      LAST_BOULANGERIE = payload.boulangerie;
      LAST_EMPLOYE = payload.employe;
      HAS_SAVED_ORDER = true;
      document.getElementById('orderForm').reset();
      resetOrderForm();
      // Les statistiques seront rafraichies à la prochaine actualisation ou retour accueil.
    })
    .catch(err => { setBusy(false); showError(err); });
}

function loadHistory() {
  if (APP_BUSY) return;
  setBusy(true, 'Recherche...');
  const filters = {
    dateDebut: document.getElementById('hDateDebut').value,
    dateFin: document.getElementById('hDateFin').value,
    boulangerie: document.getElementById('hBoulangerie').value,
    statut: document.getElementById('hStatut').value,
    client: document.getElementById('hClient').value.trim()
  };
  apiRequest('getCommandes', [filters])
    .then(rows => { renderHistory(rows); setBusy(false); })
    .catch(err => { setBusy(false); showError(err); });
}

function renderHistory(rows) {
  const table = document.getElementById('historyTable');
  table.innerHTML = `
    <thead><tr><th>N°</th><th>Livraison</th><th>Client</th><th>Téléphone</th><th>Boulangerie</th><th>Produit</th><th>Qté</th><th>Statut</th><th>Actions</th></tr></thead>
    <tbody></tbody>`;
  const tbody = table.querySelector('tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9">Aucune commande trouvée.</td></tr>';
    return;
  }
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(r.numero)}</strong></td>
      <td>${escapeHtml(r.dateLivraison)}<br><small>${escapeHtml(r.heure)}</small></td>
      <td>${escapeHtml(r.client)}</td>
      <td>${escapeHtml(r.telephone)}</td>
      <td>${escapeHtml(r.boulangerie)}</td>
      <td>${escapeHtml(r.produit)}<br><small>${escapeHtml(r.note || '')}</small></td>
      <td>${escapeHtml(r.qte)}</td>
      <td>${statusSelect(r.row, r.statut)}</td>
      <td><button class="btn danger" onclick="deleteLine(${r.row})">Supprimer</button></td>`;
    tbody.appendChild(tr);
  });
}

function statusSelect(row, selected) {
  const opts = (PARAMS.statuts || []).map(s => `<option value="${escapeAttr(s)}" ${s === selected ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('');
  return `<select onchange="changeStatus(${row}, this.value)">${opts}</select>`;
}

function changeStatus(row, statut) {
  if (APP_BUSY) return;
  setBusy(true, 'Modification...');
  apiRequest('updateCommandeStatus', [row, statut])
    .then(() => { setBusy(false); toast('Statut modifié', 'success'); })
    .catch(err => { setBusy(false); showError(err); });
}

function deleteLine(row) {
  if (APP_BUSY) return;
  if (!confirm('Supprimer cette ligne de commande ?')) return;
  setBusy(true, 'Suppression...');
  apiRequest('deleteCommandeLine', [row])
    .then(() => { setBusy(false); toast('Ligne supprimée', 'success'); loadHistory(); })
    .catch(err => { setBusy(false); showError(err); });
}

function loadProduction() {
  if (APP_BUSY) return;
  setBusy(true, 'Chargement production...');
  const filters = {
    dateDebut: document.getElementById('pDateDebut').value,
    dateFin: document.getElementById('pDateFin').value,
    boulangerie: document.getElementById('pBoulangerie').value
  };
  apiRequest('getProduction', [filters])
    .then(rows => { renderProduction(rows); setBusy(false); })
    .catch(err => { setBusy(false); showError(err); });
}

function renderProduction(rows) {
  const table = document.getElementById('productionTable');
  table.innerHTML = `<thead><tr><th>Produit</th><th>Total</th><th>Détail par boulangerie</th></tr></thead><tbody></tbody>`;
  const tbody = table.querySelector('tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="3">Aucune production à afficher.</td></tr>';
    return;
  }
  rows.forEach(r => {
    const detail = Object.entries(r.parBoulangerie || {}).map(([k, v]) => `${escapeHtml(k)} : <strong>${v}</strong>`).join('<br>');
    tbody.innerHTML += `<tr><td><strong>${escapeHtml(r.produit)}</strong></td><td>${r.total}</td><td>${detail}</td></tr>`;
  });
}

function loadInvoices() {
  if (APP_BUSY) return;
  setBusy(true, 'Chargement factures...');
  apiRequest('getFactures', [{}])
    .then(rows => { renderInvoices(rows); setBusy(false); })
    .catch(err => { setBusy(false); showError(err); });
}

function createInvoice() {
  if (APP_BUSY) return;
  const filters = {
    dateDebut: document.getElementById('fDateDebut').value,
    dateFin: document.getElementById('fDateFin').value,
    boulangerie: document.getElementById('fBoulangerie').value,
    client: document.getElementById('fClient').value.trim()
  };
  if (!filters.client) return toast('Indiquez le client à facturer.', 'error');
  setBusy(true, 'Création facture...');
  apiRequest('createFacture', [filters])
    .then(res => { setBusy(false); toast(`Facture ${res.numero} créée`, 'success'); loadInvoices(); })
    .catch(err => { setBusy(false); showError(err); });
}

function renderInvoices(rows) {
  const table = document.getElementById('invoiceTable');
  table.innerHTML = `<thead><tr><th>Facture</th><th>Date</th><th>Client</th><th>Boulangerie</th><th>TTC</th><th>Statut</th><th>Actions</th></tr></thead><tbody></tbody>`;
  const tbody = table.querySelector('tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7">Aucune facture.</td></tr>';
    return;
  }
  rows.forEach(r => {
    tbody.innerHTML += `<tr>
      <td><strong>${escapeHtml(r.numero)}</strong><br><small>${escapeHtml(r.commandes)}</small></td>
      <td>${escapeHtml(r.dateFacture)}</td>
      <td>${escapeHtml(r.client)}<br><small>${escapeHtml(r.telephone)}</small></td>
      <td>${escapeHtml(r.boulangerie || '-')}</td>
      <td><strong>${Number(r.ttc || 0).toFixed(2)} €</strong></td>
      <td><span class="badge">${escapeHtml(r.statut)}</span></td>
      <td>${r.statut !== 'Payée' ? `<button class="btn primary" onclick="markPaid(${r.row})">Marquer payée</button>` : ''}</td>
    </tr>`;
  });
}

function markPaid(row) {
  if (APP_BUSY) return;
  setBusy(true, 'Mise à jour...');
  apiRequest('markFacturePaid', [row])
    .then(() => { setBusy(false); toast('Facture marquée payée', 'success'); loadInvoices(); })
    .catch(err => { setBusy(false); showError(err); });
}

function setBusy(isBusy, message) {
  APP_BUSY = !!isBusy;
  const overlay = document.getElementById('busyOverlay');
  if (overlay) {
    const text = overlay.querySelector('.busy-box div:last-child');
    if (text && message) text.textContent = message;
    overlay.classList.toggle('hidden', !isBusy);
  }
  document.querySelectorAll('button,input,select,textarea').forEach(el => { if (!isBusy && el.dataset.alwaysDisabled === '1') return; el.disabled = !!isBusy; });
}

function toast(message, type) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast ${type || ''}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3500);
}

function showError(error) {
  const message = error && error.message ? error.message : String(error || 'Erreur inconnue');
  toast(message, 'error');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}


function renderProductsSettings() {
  const table = document.getElementById('productsTable');
  if (!table) return;
  table.innerHTML = '<thead><tr><th>Produit</th><th>Prix</th><th></th></tr></thead><tbody></tbody>';
  const tbody = table.querySelector('tbody');
  const produits = PARAMS.produits || [];
  if (!produits.length) {
    tbody.innerHTML = '<tr><td colspan="3">Aucun produit paramétré.</td></tr>';
    return;
  }
  produits.forEach(produit => {
    const prix = Number((PARAMS.prixProduits || {})[produit] || 0);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(produit)}</td><td>${formatMoney(prix)}</td><td><button class="btn secondary" onclick="editParamProduct('${escapeAttr(produit)}')">✎</button><button class="btn danger" onclick="deleteParamProduct('${escapeAttr(produit)}')">🗑</button></td>`;
    tbody.appendChild(tr);
  });
}

function addParamProduct() {
  if (APP_BUSY) return;
  const name = document.getElementById('newProductName').value.trim();
  const price = Number(document.getElementById('newProductPrice').value || 0);
  if (!name) return toast('Indiquez un produit.', 'error');
  if (price < 0) return toast('Prix invalide.', 'error');
  setBusy(true, 'Enregistrement...');
  apiRequest('saveParamProduct', [{ produit: name, prix: price }]).then(data => {
    PARAMS = data.parametres || PARAMS;
    hydrateSelects();
    renderProductsSettings();
    document.getElementById('newProductName').value = '';
    document.getElementById('newProductPrice').value = '';
    setBusy(false);
    toast('Produit ajouté', 'success');
  }).catch(err => { setBusy(false); showError(err); });
}

function editParamProduct(produit) {
  if (APP_BUSY) return;
  const current = Number((PARAMS.prixProduits || {})[produit] || 0);
  const value = prompt('Prix pour ' + produit + ' (€)', current.toFixed(2));
  if (value === null) return;
  const price = Number(String(value).replace(',', '.'));
  if (isNaN(price) || price < 0) return toast('Prix invalide.', 'error');
  setBusy(true, 'Modification...');
  apiRequest('saveParamProduct', [{ produit: produit, prix: price }]).then(data => {
    PARAMS = data.parametres || PARAMS;
    hydrateSelects();
    renderProductsSettings();
    setBusy(false);
    toast('Prix modifié', 'success');
  }).catch(err => { setBusy(false); showError(err); });
}

function deleteParamProduct(produit) {
  if (APP_BUSY) return;
  if (!confirm('Supprimer le produit "' + produit + '" ?')) return;
  setBusy(true, 'Suppression...');
  apiRequest('deleteParamProduct', [produit]).then(data => {
    PARAMS = data.parametres || PARAMS;
    hydrateSelects();
    renderProductsSettings();
    setBusy(false);
    toast('Produit supprimé', 'success');
  }).catch(err => { setBusy(false); showError(err); });
}

function escapeAttr(value) { return escapeHtml(value).replace(/'/g, '&#39;'); }