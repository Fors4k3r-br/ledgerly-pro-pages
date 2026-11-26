// Estado global compartilhado, configuração do worker do PDF.js e constantes do IndexedDB.

// Configuração do Worker do PDF.js
if (window['pdfjsLib']) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
}

// Estado Global
let lastBackPressTime = 0;
let SQL = null;
let db = null; // central.db: fonte principal da carteira
let dailyDb = null; // daily.db: histórico patrimonial independente
let portfolioChart = null;
let isPrivacyMode = false;
let stagedNotesQueue = []; // Notas aguardando revisão na tela de staging
let currentCalcTargetId = null;
let currentCalcExpression = '';

// Constantes do IndexedDB para persistir o binário do SQLite
const IDB_NAME = 'Ledgerly_Database';
const IDB_STORE = 'sqlite_binary';
const IDB_KEY = 'carteira_db_central';
const DAILY_IDB_KEY = 'carteira_db_daily';
const LEGACY_IDB_KEY = 'carteira_db';
