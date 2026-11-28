// Delegação centralizada de eventos (click, change, input e submit) sem handlers inline nem funções em globalThis.

import {
  downloadIndividualSQLiteDatabase,
  downloadLocalSQLiteBackup,
  handleRestoreSQLiteFile,
  requestRestoreDatabase,
  requestWipeDatabase
} from '../core/backup-restore.js';
import { onManCorretoraChange } from '../core/database.js';
import {
  closeProvSheet,
  confirmCalendarProvento,
  deleteProvento,
  onProvCorretoraChange,
  onProvTickerChange,
  openProvSheet,
  provAutoTax,
  refreshDividendCalendar,
  renderProventos,
  saveProvento,
  setProvCalFilter,
  setProvSubView
} from '../dividends/proventos.js';
import {
  autoCalcManualTotal,
  cancelStaging,
  changeSavedNotesPage,
  commitStagedNotesToSQLite,
  deleteSavedNote,
  filterSavedNotes,
  handlePdfSelection,
  removeStagedNote,
  saveManualOperation,
  updateStagedOpField,
  viewSavedNote
} from '../notes/notes-manager.js';
import {
  saveBrapiConfig,
  syncAllQuotesFromBrapi,
  testAndSyncBrapiConnection,
  toggleBrapiAutoSync,
  toggleBrapiTokenVisibility
} from '../portfolio/brapi.js';
import {
  applyPositionsView,
  classifyNextPending,
  clearPositionsFilters,
  deleteSingleOperation,
  focusCorretora,
  focusSetor,
  focusTicker,
  onQuotesBlockTap,
  openSectorEditor,
  setChartMode,
  setPositionsCorretora,
  setPositionsFilter,
  setProfitRange,
  showOutrosAtivos,
  togglePositionCard,
  updateTickerQuote
} from '../portfolio/positions.js';
import {
  clearAuditChecklist,
  clearAuditImportedFile,
  handleAuditFileImport,
  onAuditCorretoraChange,
  onAuditFileInstChange,
  setAuditManualQty,
  setAuditSubView,
  toggleAuditChecked
} from '../portfolio/audit-view.js';
import { checkForUpdate, showUpdateDialog } from '../pwa/updates-and-sw.js';
import {
  exportReportsExcel,
  exportReportsPDF,
  renderReports,
  setReportView
} from '../reports/reports-view.js';
import {
  disableAppSecurity,
  handlePinManagementSubmit,
  handleUnlockWithPin,
  lockAppNow,
  toggleSmartphoneBiometrics,
  triggerBiometricUnlock
} from '../security/lock-screen.js';
import {
  handleSyncStatusAction,
  requestDeleteDatabase,
  restoreConflictBackup,
  setConflictMode,
  syncConnect,
  syncDisconnect,
  syncNow,
  toggleSyncStatusPanel
} from '../sync/google-drive.js';
import {
  applyCalculatorValue,
  calcEvaluate,
  calcInput,
  closeCalculator,
  openCalculator
} from './calculator.js';
import {
  navigateFromBottom,
  navigateFromMenu,
  openAddAssetsSubTab,
  setTheme,
  switchAddSubTab,
  switchTab,
  togglePrivacyMode,
  toggleSideMenu
} from './navigation.js';

function parseBoolArg(el) {
  if (el.dataset.arg === 'true') return true;
  if (el.dataset.arg === 'false') return false;
  return undefined;
}

const CLICK_ACTIONS = {
  // Utilitários DOM simples
  triggerClick: el => document.getElementById(el.dataset.target)?.click(),
  hideElement: el => document.getElementById(el.dataset.target)?.classList.add('hidden'),

  // Navegação e menu
  toggleSideMenu: el => toggleSideMenu(parseBoolArg(el)),
  navigateFromMenu: el => navigateFromMenu(el.dataset.arg),
  navigateFromBottom: el => navigateFromBottom(el.dataset.arg),
  switchTab: el => switchTab(el.dataset.arg),
  switchAddSubTab: el => switchAddSubTab(el.dataset.arg),
  openAddAssetsSubTab: el => openAddAssetsSubTab(el.dataset.arg),
  togglePrivacyMode: () => togglePrivacyMode(),

  // Segurança
  triggerBiometricUnlock: () => triggerBiometricUnlock(),
  lockAppNow: () => lockAppNow(),
  toggleSmartphoneBiometrics: () => toggleSmartphoneBiometrics(),
  disableAppSecurity: () => disableAppSecurity(),

  // Sincronização Google Drive
  toggleSyncStatusPanel: el => toggleSyncStatusPanel(parseBoolArg(el)),
  handleSyncStatusAction: () => handleSyncStatusAction(),
  syncConnect: () => syncConnect(),
  syncNow: el => syncNow(el.dataset.arg === 'false' ? false : true),
  syncDisconnect: () => syncDisconnect(),
  restoreConflictBackup: () => restoreConflictBackup(),
  requestDeleteDatabase: () => requestDeleteDatabase(),

  // Backup e restauração
  downloadLocalSQLiteBackup: () => downloadLocalSQLiteBackup(),
  downloadIndividualSQLiteDatabase: el => downloadIndividualSQLiteDatabase(el.dataset.arg),
  requestRestoreDatabase: () => requestRestoreDatabase(),
  requestWipeDatabase: () => requestWipeDatabase(),

  // Carteira, gráficos e posições
  setProfitRange: el => setProfitRange(el.dataset.arg),
  onQuotesBlockTap: () => onQuotesBlockTap(),
  setChartMode: el => setChartMode(el.dataset.arg),
  classifyNextPending: () => classifyNextPending(),
  setPositionsFilter: el => setPositionsFilter(el.dataset.arg),
  clearPositionsFilters: () => clearPositionsFilters(),
  deleteSingleOperation: el => deleteSingleOperation(Number(el.dataset.arg)),
  openSectorEditor: el => openSectorEditor(el.dataset.arg),
  updateTickerQuote: el => updateTickerQuote(el.dataset.arg),
  togglePositionCard: el => togglePositionCard(Number(el.dataset.arg)),
  focusSetor: el => focusSetor(el.dataset.arg),
  focusCorretora: el => focusCorretora(el.dataset.arg === 'none' ? 'none' : Number(el.dataset.arg)),
  focusTicker: el => focusTicker(el.dataset.arg),
  showOutrosAtivos: () => showOutrosAtivos(),

  // Brapi
  syncAllQuotesFromBrapi: () => syncAllQuotesFromBrapi(),
  toggleBrapiTokenVisibility: () => toggleBrapiTokenVisibility(),
  testAndSyncBrapiConnection: () => testAndSyncBrapiConnection(),

  // Notas e staging
  commitStagedNotesToSQLite: () => commitStagedNotesToSQLite(),
  cancelStaging: () => cancelStaging(),
  removeStagedNote: el => removeStagedNote(Number(el.dataset.noteIdx)),
  changeSavedNotesPage: el => changeSavedNotesPage(Number(el.dataset.arg)),
  viewSavedNote: el => viewSavedNote(Number(el.dataset.arg)),
  deleteSavedNote: el => deleteSavedNote(Number(el.dataset.arg)),

  // Proventos
  openProvSheet: () => openProvSheet(false),
  closeProvSheet: () => closeProvSheet(),
  deleteProvento: el => deleteProvento(Number(el.dataset.arg)),
  setProvSubView: el => setProvSubView(el.dataset.arg),
  setProvCalFilter: el => setProvCalFilter(el.dataset.arg),
  refreshDividendCalendar: () => refreshDividendCalendar(),
  confirmCalendarProvento: el => confirmCalendarProvento(el.dataset.arg),

  // Conferência da carteira
  setAuditSubView: el => setAuditSubView(el.dataset.arg),
  clearAuditImportedFile: () => clearAuditImportedFile(),
  toggleAuditChecked: el => toggleAuditChecked(el.dataset.arg),
  clearAuditChecklist: () => clearAuditChecklist(),

  // Relatórios
  exportReportsPDF: () => exportReportsPDF(),
  exportReportsExcel: () => exportReportsExcel(),
  setReportView: el => setReportView(el.dataset.arg),

  // PWA / atualizações
  checkForUpdate: () => checkForUpdate(),
  showUpdateDialog: () => showUpdateDialog(),

  // Calculadora
  openCalculator: el => openCalculator(el.dataset.target, el.dataset.label),
  closeCalculator: () => closeCalculator(),
  calcInput: el => calcInput(el.dataset.arg),
  calcEvaluate: () => calcEvaluate(),
  applyCalculatorValue: () => applyCalculatorValue()
};

const CLICK_SELF_ACTIONS = {
  closeProvSheet: () => closeProvSheet()
};

const CHANGE_ACTIONS = {
  renderReports: () => renderReports(),
  applyPositionsView: () => applyPositionsView(),
  setPositionsCorretora: () => setPositionsCorretora(),
  handlePdfSelection: (el, event) => handlePdfSelection(event, el.dataset.arg),
  filterSavedNotes: el => filterSavedNotes(el.dataset.arg === 'true'),
  onManCorretoraChange: () => onManCorretoraChange(),
  renderProventos: () => renderProventos(),
  onProvTickerChange: () => onProvTickerChange(),
  provAutoTax: () => provAutoTax(),
  onProvCorretoraChange: () => onProvCorretoraChange(),
  toggleBrapiAutoSync: el => toggleBrapiAutoSync(Boolean(el.checked)),
  setTheme: el => setTheme(el.dataset.arg),
  setConflictMode: el => setConflictMode(el.dataset.arg),
  handleRestoreSQLiteFile: (_el, event) => handleRestoreSQLiteFile(event),
  onAuditCorretoraChange: () => onAuditCorretoraChange(),
  onAuditFileInstChange: () => onAuditFileInstChange(),
  handleAuditFileImport: (_el, event) => handleAuditFileImport(event),
  commitAuditManualQty: el => setAuditManualQty(el.dataset.ticker, el.value, true),
  updateStagedOpField: el => {
    const nIdx = Number(el.dataset.noteIdx);
    const opIdx = Number(el.dataset.opIdx);
    const field = el.dataset.field;
    const parse = el.dataset.parse;
    const val = parse === 'float'
      ? (parseFloat(el.value) || 0)
      : parse === 'upper'
        ? el.value.toUpperCase()
        : el.value;
    updateStagedOpField(nIdx, opIdx, field, val);
  }
};

const INPUT_ACTIONS = {
  applyPositionsView: () => applyPositionsView(),
  filterSavedNotes: el => filterSavedNotes(el.dataset.arg === 'true'),
  autoCalcManualTotal: () => autoCalcManualTotal(),
  provAutoTax: () => provAutoTax(),
  markManual: el => { el.dataset.manual = '1'; },
  setAuditManualQty: el => setAuditManualQty(el.dataset.ticker, el.value, false)
};

const SUBMIT_ACTIONS = {
  handleUnlockWithPin: (_el, event) => handleUnlockWithPin(event),
  saveManualOperation: (_el, event) => saveManualOperation(event),
  saveProvento: (_el, event) => saveProvento(event),
  handlePinManagementSubmit: (_el, event) => handlePinManagementSubmit(event),
  saveBrapiConfig: (_el, event) => saveBrapiConfig(event)
};

document.addEventListener('click', event => {
  const selfEl = event.target instanceof Element ? event.target.closest('[data-click-self]') : null;
  if (selfEl && event.target === selfEl) {
    const fn = CLICK_SELF_ACTIONS[selfEl.dataset.clickSelf];
    if (fn) fn(selfEl, event);
    return;
  }
  const el = event.target instanceof Element ? event.target.closest('[data-click]') : null;
  if (!el || el.disabled) return;
  if (event.detail > 0 && el instanceof HTMLElement && el.closest('#bottomNavigation, #sideMenu, header')) {
    el.blur();
  }
  const fn = CLICK_ACTIONS[el.dataset.click];
  if (fn) fn(el, event);
});

document.addEventListener('change', event => {
  const el = event.target instanceof Element ? event.target.closest('[data-change]') : null;
  if (!el) return;
  const fn = CHANGE_ACTIONS[el.dataset.change];
  if (fn) fn(el, event);
});

document.addEventListener('input', event => {
  const el = event.target instanceof Element ? event.target.closest('[data-input]') : null;
  if (!el) return;
  const fn = INPUT_ACTIONS[el.dataset.input];
  if (fn) fn(el, event);
});

document.addEventListener('submit', event => {
  const form = event.target instanceof Element ? event.target.closest('form[data-submit]') : null;
  if (!form) return;
  const fn = SUBMIT_ACTIONS[form.dataset.submit];
  if (fn) fn(form, event);
});
