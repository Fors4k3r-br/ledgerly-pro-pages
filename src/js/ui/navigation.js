// Navegação entre abas/menu, temas em runtime, formatação, diálogos, modais e notificações toast.

// Temas
const THEMES = { default: { name: 'Padrão (atual)', meta: '#090d16' }, dark: { name: 'Escuro', meta: '#050505' }, light: { name: 'Claro', meta: '#f1f5f9' } };
function currentTheme() { const t = document.documentElement.getAttribute('data-theme'); return THEMES[t] ? t : 'default'; }
function applyTheme(t) {
  t = THEMES[t] ? t : 'default';
  document.documentElement.setAttribute('data-theme', t);
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', THEMES[t].meta);
}
function setTheme(t) { try { localStorage.setItem('ledgerly_theme', t); } catch (_) {} applyTheme(t); refreshAllViews(); }
function themeRgb(n, a) {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--s-' + n).trim().replace(/\s+/g, ',') || '11,17,30';
  return a == null ? `rgb(${v})` : `rgba(${v},${a})`;
}
function renderThemeCard() {
  const cur = currentTheme();
  Object.keys(THEMES).forEach(k => {
    const el = document.getElementById('themeOpt-' + k); if (!el) return;
    el.classList.toggle('border-emerald-500', k === cur); el.classList.toggle('border-slate-800', k !== cur);
    const r = el.querySelector('input'); if (r) r.checked = (k === cur);
  });
  const s = document.getElementById('themeSummaryText'); if (s) s.textContent = THEMES[cur].name;
}

// =========================================================================
// 10. NAVEGAÇÃO ENTRE ABAS, SUB-ABAS E UTILITÁRIOS VISUAIS
// =========================================================================
function toggleSideMenu(open) {
  const panel = document.getElementById('sideMenu');
  const backdrop = document.getElementById('sideMenuBackdrop');
  const trigger = document.querySelector('[data-bottom-tab="menu"]');
  if (!panel || !backdrop) return;
  const wasOpen = panel.classList.contains('menu-open');
  const shouldOpen = typeof open === 'boolean' ? open : !wasOpen;
  panel.classList.toggle('menu-open', shouldOpen);
  backdrop.classList.toggle('menu-open', shouldOpen);
  panel.setAttribute('aria-hidden', String(!shouldOpen));
  backdrop.setAttribute('aria-hidden', String(!shouldOpen));
  if (trigger) trigger.setAttribute('aria-expanded', String(shouldOpen));
  document.body.classList.toggle('bottom-sheet-open', shouldOpen);
  if (shouldOpen) { const closeBtn = panel.querySelector('button[aria-label="Fechar menu"]'); if (closeBtn) closeBtn.focus(); }
  else if (trigger && wasOpen) trigger.focus({preventScroll:true});
}
function navigateFromMenu(tabId) { toggleSideMenu(false); switchTab(tabId); }
function navigateFromBottom(tabId) { toggleSideMenu(false); switchTab(tabId); }
document.addEventListener('keydown', event => { if (event.key === 'Escape') toggleSideMenu(false); });

function switchTab(tabId, pushHistory = true) {
  toggleSideMenu(false);
  const tabs = ['carteira', 'posicoes', 'adicionar', 'relatorios', 'proventos', 'config', 'banco', 'seguranca', 'apis', 'api-brapi', 'temas', 'sync', 'sobre'];
  tabs.forEach(t => {
    const section = document.getElementById(`tab-${t}`);
    if (section) {
      section.classList.toggle('hidden', t !== tabId);
    }
  });

  const activeNavId = ['banco', 'seguranca', 'apis', 'api-brapi', 'temas', 'sync', 'sobre'].includes(tabId) ? 'config' : tabId;
  document.querySelectorAll('[data-menu-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.menuTab === activeNavId));
  document.querySelectorAll('[data-bottom-tab]').forEach(btn => { const isMenu = btn.dataset.bottomTab === 'menu'; const represented = ['carteira', 'posicoes', 'adicionar', 'relatorios'].includes(activeNavId); btn.classList.toggle('active', isMenu ? !represented : btn.dataset.bottomTab === activeNavId); });

  { const sc = document.getElementById('appScroll'); (sc && sc.scrollTo ? sc : window).scrollTo({ top: 0, behavior: 'smooth' }); }
  
  // Registra a navegação no histórico do navegador/celular apenas se solicitado
  if (pushHistory) {
    history.pushState({ tab: tabId }, "", `#${tabId}`);
  }

  refreshAllViews();
}

function switchAddSubTab(subTab) {
  const subImportar = document.getElementById('subtab-importar');
  const subManual = document.getElementById('subtab-manual');
  const btnImportar = document.getElementById('subtab-btn-importar');
  const btnManual = document.getElementById('subtab-btn-manual');

  if (subTab === 'manual') {
    subImportar.classList.add('hidden');
    subManual.classList.remove('hidden');
    btnManual.className = 'py-2.5 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 bg-emerald-500 text-slate-950 shadow-md';
    btnImportar.className = 'py-2.5 px-3 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-2 text-slate-300 hover:bg-slate-800/70';
  } else {
    subManual.classList.add('hidden');
    subImportar.classList.remove('hidden');
    btnImportar.className = 'py-2.5 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 bg-emerald-500 text-slate-950 shadow-md';
    btnManual.className = 'py-2.5 px-3 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-2 text-slate-300 hover:bg-slate-800/70';
  }
  lucide.createIcons();
}

function openAddAssetsSubTab(subTab) {
  switchTab('adicionar');
  switchAddSubTab(subTab);
}

function togglePrivacyMode() {
  isPrivacyMode = !isPrivacyMode;
  const icon = document.getElementById('privacyIcon');
  icon.setAttribute('data-lucide', isPrivacyMode ? 'eye-off' : 'eye');
  refreshAllViews();
}

function formatMoney(value) {
  if (isPrivacyMode) return 'R$ •••••';
  const num = Number(value) || 0;
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatPercent(value) {
  if (isPrivacyMode) return '•••%';
  const num = Number(value) || 0;
  return `${num.toFixed(2).replace('.', ',')}%`;
}

function formatNumber(value) {
  const num = Number(value) || 0;
  return num.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// Modal de Confirmação com suporte a verificação de senha
function openConfirmDialog({ title, message, requirePin = false, onConfirm }) {
  const modal = document.getElementById('customDialogModal');
  document.getElementById('dialogTitle').textContent = title;
  document.getElementById('dialogMessage').textContent = message;
  const pinWrapper = document.getElementById('dialogPasswordWrapper');
  const pinInput = document.getElementById('dialogSecurityPin');
  pinInput.value = '';

  if (requirePin) {
    pinWrapper.classList.remove('hidden');
  } else {
    pinWrapper.classList.add('hidden');
  }

  modal.classList.remove('hidden');

  document.getElementById('dialogCancelBtn').onclick = () => {
    modal.classList.add('hidden');
  };

  document.getElementById('dialogConfirmBtn').onclick = async () => {
    if (requirePin) {
      if (!(await verifyPin(pinInput.value.trim(), getSetting('security_pin_hash')))) {
        showToast('Senha incorreta! Operação negada.', 'error');
        return;
      }
    }
    modal.classList.add('hidden');
    if (onConfirm) await onConfirm();
  };
}

// Janela de diálogo simples (senha, conflito, confirmação)
function ledgerlyModal({ title, message, password = 0, buttons }) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    const box = document.createElement('div');
    box.className = 'glass-card w-full max-w-sm max-h-[85vh] overflow-y-auto rounded-2xl p-5 space-y-3 border border-slate-700';
    const h3 = document.createElement('h3'); h3.className = 'text-base font-bold text-white'; h3.textContent = title;
    const p = document.createElement('p'); p.className = 'text-xs text-slate-300 whitespace-pre-line'; p.textContent = message;
    box.append(h3, p);
    const inputs = [];
    for (let i = 0; i < password; i++) {
      const inp = document.createElement('input');
      inp.type = 'password'; inp.autocomplete = i ? 'new-password' : 'current-password';
      inp.placeholder = i ? 'Repita a senha' : 'Senha de sincronização';
      inp.setAttribute('aria-label', inp.placeholder);
      inp.className = 'w-full bg-slate-900 border border-slate-700 focus:border-emerald-500 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none';
      box.appendChild(inp); inputs.push(inp);
    }
    const err = document.createElement('p'); err.className = 'hidden text-xs text-rose-300'; box.appendChild(err);
    const row = document.createElement('div'); row.className = 'flex flex-col gap-2 pt-1';
    buttons.forEach(b => {
      const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = b.label;
      btn.className = 'w-full px-4 py-2.5 rounded-xl text-xs font-bold ' + (b.primary ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950' : 'bg-slate-800 hover:bg-slate-700 text-slate-200');
      btn.onclick = () => {
        if (b.needsPw) {
          if (inputs[0].value.length < 8) { err.textContent = 'Use pelo menos 8 caracteres.'; err.classList.remove('hidden'); return; }
          if (inputs[1] && inputs[1].value !== inputs[0].value) { err.textContent = 'As senhas não conferem.'; err.classList.remove('hidden'); return; }
        }
        ov.remove(); resolve({ value: b.value, pw: inputs[0] ? inputs[0].value : '' });
      };
      row.appendChild(btn);
    });
    box.appendChild(row); ov.appendChild(box); document.body.appendChild(ov);
    if (inputs[0]) inputs[0].focus();
  });
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  const colorMap = {
    success: 'border-emerald-500/50 bg-slate-900/95 text-emerald-300',
    error: 'border-rose-500/50 bg-slate-900/95 text-rose-300',
    info: 'border-indigo-500/50 bg-slate-900/95 text-indigo-300'
  };
  toast.className = `p-3.5 rounded-2xl border shadow-xl text-xs font-semibold flex items-center justify-between gap-2 backdrop-blur-md transition-all ${colorMap[type] || colorMap.info}`;
  const span = document.createElement('span');
  span.textContent = message;
  toast.appendChild(span);
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3400);
}
