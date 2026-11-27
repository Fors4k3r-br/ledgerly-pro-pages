// Estado global compartilhado, configuração do worker do PDF.js e constantes do IndexedDB.

// Configuração do Worker do PDF.js
if (window['pdfjsLib']) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
}

// Estado compartilhado entre módulos (live bindings com setters explícitos)
export let SQL = null;
export let db = null; // central.db: fonte principal da carteira
export let dailyDb = null; // daily.db: histórico patrimonial independente
export let isPrivacyMode = false;
export let stagedNotesQueue = []; // Notas aguardando revisão na tela de staging

export function setSQL(value) { SQL = value; }
export function setDb(value) { db = value; }
export function setDailyDb(value) { dailyDb = value; }
export function setIsPrivacyMode(value) { isPrivacyMode = value; }
export function setStagedNotesQueue(value) { stagedNotesQueue = value; }

// Constantes do IndexedDB para persistir o binário do SQLite
export const IDB_NAME = 'Ledgerly_Database';
export const IDB_STORE = 'sqlite_binary';
export const IDB_KEY = 'carteira_db_central';
export const DAILY_IDB_KEY = 'carteira_db_daily';
export const LEGACY_IDB_KEY = 'carteira_db';
