// Barramento leve de ganchos/eventos para desacoplar módulos sem criar ciclos de import.

let refreshHandler = () => {};
let afterPersistHandler = async () => {};
let pinVerifier = async () => false;
let quotesSyncHandler = async () => {};
const freshInstallResetHandlers = [];
const emptyIdbRecoveryHandlers = [];

export function registerRefreshHandler(fn) {
  if (typeof fn === 'function') refreshHandler = fn;
}
export function refreshAllViews() {
  return refreshHandler();
}

export function registerAfterPersistHandler(fn) {
  if (typeof fn === 'function') afterPersistHandler = fn;
}
export function notifyAfterPersist(options = {}) {
  return Promise.resolve(afterPersistHandler(options));
}

export function registerPinVerifier(fn) {
  if (typeof fn === 'function') pinVerifier = fn;
}
export function verifyAppPin(pin) {
  return Promise.resolve(pinVerifier(pin));
}

export function registerFreshInstallResetHandler(fn) {
  if (typeof fn === 'function') freshInstallResetHandlers.push(fn);
}
export async function notifyFreshInstallReset() {
  for (const fn of freshInstallResetHandlers) {
    try { await fn(); } catch (_) {}
  }
}

export function registerEmptyIdbRecoveryHandler(fn) {
  if (typeof fn === 'function') emptyIdbRecoveryHandlers.push(fn);
}
export function notifyEmptyIdbRecovery() {
  for (const fn of emptyIdbRecoveryHandlers) {
    try { fn(); } catch (_) {}
  }
}

export function registerQuotesSyncHandler(fn) {
  if (typeof fn === 'function') quotesSyncHandler = fn;
}
export function requestQuotesSync() {
  return Promise.resolve(quotesSyncHandler());
}
