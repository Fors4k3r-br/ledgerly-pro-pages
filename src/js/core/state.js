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

// Ponte de compatibilidade: mantém os nomes públicos acessíveis ao HTML e aos demais módulos.
Object.defineProperty(globalThis, "lastBackPressTime", { configurable: true, enumerable: true, get: () => lastBackPressTime, set: value => { lastBackPressTime = value; } });
Object.defineProperty(globalThis, "SQL", { configurable: true, enumerable: true, get: () => SQL, set: value => { SQL = value; } });
Object.defineProperty(globalThis, "db", { configurable: true, enumerable: true, get: () => db, set: value => { db = value; } });
Object.defineProperty(globalThis, "dailyDb", { configurable: true, enumerable: true, get: () => dailyDb, set: value => { dailyDb = value; } });
Object.defineProperty(globalThis, "portfolioChart", { configurable: true, enumerable: true, get: () => portfolioChart, set: value => { portfolioChart = value; } });
Object.defineProperty(globalThis, "isPrivacyMode", { configurable: true, enumerable: true, get: () => isPrivacyMode, set: value => { isPrivacyMode = value; } });
Object.defineProperty(globalThis, "stagedNotesQueue", { configurable: true, enumerable: true, get: () => stagedNotesQueue, set: value => { stagedNotesQueue = value; } });
Object.defineProperty(globalThis, "currentCalcTargetId", { configurable: true, enumerable: true, get: () => currentCalcTargetId, set: value => { currentCalcTargetId = value; } });
Object.defineProperty(globalThis, "currentCalcExpression", { configurable: true, enumerable: true, get: () => currentCalcExpression, set: value => { currentCalcExpression = value; } });
Object.defineProperty(globalThis, "IDB_NAME", { configurable: true, enumerable: true, get: () => IDB_NAME });
Object.defineProperty(globalThis, "IDB_STORE", { configurable: true, enumerable: true, get: () => IDB_STORE });
Object.defineProperty(globalThis, "IDB_KEY", { configurable: true, enumerable: true, get: () => IDB_KEY });
Object.defineProperty(globalThis, "DAILY_IDB_KEY", { configurable: true, enumerable: true, get: () => DAILY_IDB_KEY });
Object.defineProperty(globalThis, "LEGACY_IDB_KEY", { configurable: true, enumerable: true, get: () => LEGACY_IDB_KEY });
