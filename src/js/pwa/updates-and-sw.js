// Controle de versão, novidades do changelog, registro do Service Worker e tratamento global de erros.

// ===== VERSÃO E NOVIDADES =====
const APP_INFO = globalThis.LEDGERLY_CHANGELOG || { version: '0.0.0', build: 0, entries: [] };
const SEEN_VERSION_KEY = 'ledgerly_seen_version';
let pendingWorker = null;
function cmpVer(a, b) {
  const p = s => String(s || '0').split('.').map(n => parseInt(n, 10) || 0), x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1; }
  return 0;
}
function fmtChangelogDate(iso) { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; }
function newerEntries(entries, than) { return (entries || []).filter(e => cmpVer(e.version, than) > 0).sort((a, b) => cmpVer(b.version, a.version)); }
function changelogText(entries) {
  return entries.map(e => `Versão ${e.version}${e.date ? ' · ' + fmtChangelogDate(e.date) : ''}\n` + (e.notes || []).map(n => '• ' + n).join('\n')).join('\n\n');
}
// Pergunta ao service worker em espera quais são as novidades da versão que ele traz
function askWorkerInfo(worker) {
  return new Promise(resolve => {
    const sw = navigator.serviceWorker;
    if (!sw || !worker) return resolve(null);
    let timer;
    const done = v => { sw.removeEventListener('message', onMsg); clearTimeout(timer); resolve(v); };
    const onMsg = e => { if (e.data && e.data.type === 'INFO') done(e.data); };
    timer = setTimeout(() => done(null), 1500);
    sw.addEventListener('message', onMsg);
    try { worker.postMessage({ type: 'GET_INFO' }); } catch (_) { done(null); }
  });
}
function setPendingUpdate(worker) {
  pendingWorker = worker;
  const banner = document.getElementById('updateBanner'), btn = document.getElementById('updateBtn');
  if (banner) banner.classList.remove('hidden');
  if (btn) btn.onclick = () => showUpdateDialog();
  renderAbout();
}
async function showUpdateDialog() {
  if (!pendingWorker) return;
  const info = await askWorkerInfo(pendingWorker);
  const entries = info ? newerEntries(info.entries, APP_INFO.version) : [];
  const newV = info && info.version;
  const r = await ledgerlyModal({ title: newV ? `Nova versão ${newV}` : 'Nova versão disponível',
    message: entries.length ? changelogText(entries) : 'Há uma nova versão disponível com melhorias e correções.',
    buttons: [{ label: 'Atualizar agora', value: 'now', primary: true }, { label: 'Depois', value: 'later' }] });
  if (r.value === 'now') {
    try { if (newV) localStorage.setItem(SEEN_VERSION_KEY, newV); } catch (_) {}   // já leu as novidades: não repete após reiniciar
    pendingWorker.postMessage({ type: 'SKIP_WAITING' });
  } else { const b = document.getElementById('updateBanner'); if (b) b.classList.add('hidden'); }
}
// Primeira abertura depois de uma atualização: mostra "O que há de novo" uma única vez
async function maybeShowWhatsNew() {
  let seen = null; try { seen = localStorage.getItem(SEEN_VERSION_KEY); } catch (_) {}
  if (seen === APP_INFO.version) return;
  const mark = () => { try { localStorage.setItem(SEEN_VERSION_KEY, APP_INFO.version); } catch (_) {} };
  const entries = newerEntries(APP_INFO.entries, seen || '0.0.0');
  if (!entries.length || (!seen && isLocalEmpty())) { mark(); return; }   // instalação nova: nada a contar
  const lock = document.getElementById('lockScreen');
  if (lock && !lock.classList.contains('hidden')) { setTimeout(maybeShowWhatsNew, 1500); return; }   // espera o desbloqueio
  await ledgerlyModal({ title: `O que há de novo · ${APP_INFO.version}`, message: changelogText(entries), buttons: [{ label: 'Entendi', value: 'ok', primary: true }] });
  mark();
}
async function checkForUpdate() {
  const reg = window.__swReg;
  if (!reg) { showToast('Atualizações automáticas não estão disponíveis neste navegador.', 'info'); return; }
  if (!navigator.onLine) { showToast('Sem internet para verificar atualizações.', 'info'); return; }
  try { await reg.update(); } catch (_) { showToast('Não foi possível verificar agora.', 'error'); return; }
  await new Promise(r => setTimeout(r, 1500));
  if (pendingWorker || reg.waiting) { if (!pendingWorker) setPendingUpdate(reg.waiting); showUpdateDialog(); }
  else if (reg.installing) showToast('Baixando a nova versão… tente novamente em instantes.', 'info');
  else showToast(`Você já está na versão mais recente (${APP_INFO.version}).`, 'success');
}
function renderAbout() {
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  set('appVersionLabel', `${APP_INFO.version} (build ${APP_INFO.build})`);
  set('aboutVersion', `Versão ${APP_INFO.version} · build ${APP_INFO.build}`);
  set('aboutSummaryText', pendingWorker ? 'Nova versão disponível' : 'Novidades e atualizações');
  set('aboutUpdateStatus', pendingWorker ? 'Há uma nova versão pronta para instalar.' : 'Toque em “Verificar atualização” para procurar novidades.');
  const dot = document.getElementById('updateDot'); if (dot) dot.classList.toggle('hidden', !pendingWorker);
  const ab = document.getElementById('aboutApplyBtn'); if (ab) ab.classList.toggle('hidden', !pendingWorker);
  const list = document.getElementById('aboutChangelog');
  if (list) {
    list.textContent = '';
    [...(APP_INFO.entries || [])].sort((a, b) => cmpVer(b.version, a.version)).forEach(e => {
      const box = document.createElement('div'); box.className = 'space-y-1';
      const t = document.createElement('h4'); t.className = 'text-xs font-bold text-white'; t.textContent = `Versão ${e.version}${e.date ? ' · ' + fmtChangelogDate(e.date) : ''}`;
      const ul = document.createElement('ul'); ul.className = 'list-disc pl-4 space-y-0.5 text-[11px] text-slate-300';
      (e.notes || []).forEach(n => { const li = document.createElement('li'); li.textContent = n; ul.appendChild(li); });
      box.append(t, ul); list.appendChild(box);
    });
  }
}
document.addEventListener('DOMContentLoaded', renderAbout);
// ===== FIM VERSÃO E NOVIDADES =====

window.addEventListener('unhandledrejection', e => {
  console.error(e.reason);
  try { showToast('Ocorreu um erro inesperado. Tente novamente.', 'error'); } catch (_) {}
});
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('button[title]:not([aria-label])').forEach(b => b.setAttribute('aria-label', b.title));
});
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
      window.__swReg = reg;
      const offer = worker => setPendingUpdate(worker);
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (w) w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
        });
      });
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!reloading) { reloading = true; location.reload(); }
      });
      setInterval(() => reg.update().catch(() => {}), 3600000);
    } catch (error) { console.error('Falha ao registrar Service Worker:', error); }
  });
}
