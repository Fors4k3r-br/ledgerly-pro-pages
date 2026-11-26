// Integração com a API brapi.dev para configuração de token e atualização de cotações online.

// =========================================================================
// 7. INTEGRAÇÃO DE COTAÇÕES ONLINE (BRAPI.DEV)
// =========================================================================
function renderApiStatus() {
  const b = document.getElementById('apiBrapiBadge'); if (!b) return;
  const ok = Boolean(getSetting('brapi_token'));
  b.textContent = ok ? 'Configurado' : 'Não configurado';
  b.className = 'inline-block mt-3 text-[11px] font-mono px-2.5 py-1 rounded-full border ' + (ok ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-slate-800 text-slate-400 border-slate-700');
}
function loadBrapiSettingsToUI() {
  const token = getSetting('brapi_token') || '';
  const autoSync = getSetting('brapi_auto_sync') === '1';
  const lastSync = getSetting('brapi_last_sync') || '';

  const input = document.getElementById('brapiTokenInput');
  if (input) input.value = token;

  const toggle = document.getElementById('brapiAutoSyncToggle');
  if (toggle) toggle.checked = autoSync;

  const badge = document.getElementById('brapiConfigBadge');
  if (badge) {
    if (token) {
      badge.textContent = 'Token Configurado';
      badge.className = 'text-[11px] font-mono px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0';
    } else {
      badge.textContent = 'Sem Token';
      badge.className = 'text-[11px] font-mono px-2.5 py-1 rounded-full bg-slate-800 text-slate-400 shrink-0';
    }
  }

  renderApiStatus();
  updateQuotesLabel();
}

function toggleBrapiTokenVisibility() {
  const input = document.getElementById('brapiTokenInput');
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

async function saveBrapiConfig(event) {
  event.preventDefault();
  const token = document.getElementById('brapiTokenInput').value.trim();
  await setSetting('brapi_token', token);
  loadBrapiSettingsToUI();
  showToast(token ? 'Chave de API brapi.dev salva no banco de dados!' : 'Chave da API removida.', 'success');
}

async function toggleBrapiAutoSync(checked) {
  await setSetting('brapi_auto_sync', checked ? '1' : '0');
  showToast(checked ? 'Atualização automática ativada!' : 'Atualização automática desativada.', 'info');
}

async function testAndSyncBrapiConnection() {
  const inputToken = document.getElementById('brapiTokenInput').value.trim();
  if (inputToken) {
    await setSetting('brapi_token', inputToken);
    loadBrapiSettingsToUI();
  }
  await syncAllQuotesFromBrapi(false, true);
}

async function syncAllQuotesFromBrapi(silent = false, isTestFromConfig = false) {
  const token = getSetting('brapi_token') || '';
  const positions = getConsolidatedPositions().filter(p => p.qtdAtual > 0);

  const tickersToFetch = positions.length > 0
    ? positions.map(p => p.ticker)
    : (isTestFromConfig ? ['PETR4'] : []);

  if (tickersToFetch.length === 0) {
    if (!silent) {
      showToast('Adicione ativos à carteira antes de sincronizar as cotações.', 'info');
    }
    return;
  }

  const icon = document.getElementById('iconSyncBrapiCarteira');
  const btn = document.getElementById('btnSyncBrapiCarteira');
  if (icon) icon.classList.add('animate-spin');
  if (btn) btn.disabled = true;

  const statusText = document.getElementById('brapiConfigStatusText');
  if (statusText) statusText.textContent = 'Consultando brapi.dev...';

  let updatedCount = 0;

  try {
    for (const ticker of tickersToFetch) {
      const url = `https://brapi.dev/api/quote/${encodeURIComponent(ticker)}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} ao consultar ${ticker}`);
      }
      const data = await resp.json();
      const result = data?.results?.[0];
      if (result && typeof result.regularMarketPrice === 'number') {
        db.run(
          'INSERT OR REPLACE INTO cotacoes_atuais (ticker, preco_atual) VALUES (?, ?)',
          [ticker.toUpperCase(), result.regularMarketPrice]
        );
        updatedCount++;
      }
    }

    const nowStr = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    db.run('INSERT OR REPLACE INTO configuracoes_seguranca (chave, valor) VALUES (?, ?)', ['brapi_last_sync', nowStr]);
    db.run('INSERT OR REPLACE INTO configuracoes_seguranca (chave, valor) VALUES (?, ?)', ['brapi_last_sync_iso', new Date().toISOString()]);
    await persistSQLiteToIndexedDB({ userEdit: false });

    loadBrapiSettingsToUI();
    refreshAllViews();

    if (statusText) {
      statusText.textContent = `Conectado! Último teste: ${nowStr}`;
    }
    if (!silent) {
      showToast(`${updatedCount} cotação(ões) atualizada(s) via brapi.dev!`, 'success');
    }
  } catch (err) {
    console.error('Erro na API brapi.dev:', err);
    if (statusText) {
      statusText.textContent = 'Falha ao validar token ou consultar ativo.';
    }
    if (!silent) {
      showToast('Erro ao buscar na brapi.dev. Verifique se o Token API é necessário ou válido.', 'error');
    }
  } finally {
    const iconEl = document.getElementById('iconSyncBrapiCarteira');
    if (iconEl) iconEl.classList.remove('animate-spin');
    const btnEl = document.getElementById('btnSyncBrapiCarteira');
    if (btnEl) btnEl.disabled = false;
  }
}

// Ponte de compatibilidade: mantém os nomes públicos acessíveis ao HTML e aos demais módulos.
Object.defineProperty(globalThis, "renderApiStatus", { configurable: true, enumerable: true, get: () => renderApiStatus, set: value => { renderApiStatus = value; } });
Object.defineProperty(globalThis, "loadBrapiSettingsToUI", { configurable: true, enumerable: true, get: () => loadBrapiSettingsToUI, set: value => { loadBrapiSettingsToUI = value; } });
Object.defineProperty(globalThis, "toggleBrapiTokenVisibility", { configurable: true, enumerable: true, get: () => toggleBrapiTokenVisibility, set: value => { toggleBrapiTokenVisibility = value; } });
Object.defineProperty(globalThis, "saveBrapiConfig", { configurable: true, enumerable: true, get: () => saveBrapiConfig, set: value => { saveBrapiConfig = value; } });
Object.defineProperty(globalThis, "toggleBrapiAutoSync", { configurable: true, enumerable: true, get: () => toggleBrapiAutoSync, set: value => { toggleBrapiAutoSync = value; } });
Object.defineProperty(globalThis, "testAndSyncBrapiConnection", { configurable: true, enumerable: true, get: () => testAndSyncBrapiConnection, set: value => { testAndSyncBrapiConnection = value; } });
Object.defineProperty(globalThis, "syncAllQuotesFromBrapi", { configurable: true, enumerable: true, get: () => syncAllQuotesFromBrapi, set: value => { syncAllQuotesFromBrapi = value; } });
