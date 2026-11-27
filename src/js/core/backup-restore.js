// Fluxos de backup local (.lgp e .db individuais), restauração local/nuvem e limpeza da carteira.

import { openDb } from '../security/encryption.js';
import { SQL, db, setDb, dailyDb, setDailyDb, setStagedNotesQueue } from './state.js';
import { refreshAllViews } from './events.js';
import { createCentralSchema, createDailySchema, getSetting, persistSQLiteToIndexedDB, setSetting, updateDatabaseStats } from './database.js';
import { renderStagingScreen } from '../notes/notes-manager.js';
import { renderOnboarding } from '../portfolio/positions.js';
import { updateSecurityUIState } from '../security/lock-screen.js';
import { applyRemoteDb, clearConflictBackups, deleteCloudDb, disconnectSyncLocal, driveDeleteExtras, driveDownload, driveFind, ensureKey, exportSyncPackage, getToken, hashCurrentPair, packSyncPackage, prefetched, setPrefetched, renderSyncCard, sanitizedExport, saveSyncState, setSyncStatusFlags, syncAfterPersist, syncState, unpackSyncPackage, updateConnectionBadge, validateDatabasePair, wipeAllData } from '../sync/google-drive.js';
import { ledgerlyModal, openConfirmDialog, showToast, switchTab } from '../ui/navigation.js';

async function generateSQLiteBackupFileObject() {
  const pair = await unpackSyncPackage(await exportSyncPackage());
  const safeCentral = sanitizedExport(pair.central);
  const binaryArray = await packSyncPackage(safeCentral, pair.daily);
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
  const fileName = `ledgerly_conjunto_${stamp}.lgp`;
  const blob = new Blob([binaryArray], { type: 'application/octet-stream' });
  return { blob, fileName };
}

async function downloadLocalSQLiteBackup() {
  const { blob, fileName } = await generateSQLiteBackupFileObject();
  const nowFormatted = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  await setSetting('ultimo_backup', nowFormatted);
  updateDatabaseStats();
  updateSecurityUIState();
  triggerBlobDownload(blob, fileName);
  showToast(`Backup do banco de dados (${fileName}) baixado!`, 'success');
}

// Exporta um banco SQLite convencional para consulta externa.
// A cópia é sanitizada: remove configurações locais/sensíveis, sem alterar o banco ativo.
async function downloadIndividualSQLiteDatabase(which) {
  const database = which === 'daily' ? dailyDb : db;
  if (!database) { showToast('Banco de dados ainda não está disponível.', 'error'); return; }
  let copy = null;
  try {
    copy = new SQL.Database(database.export());
    if (which === 'central') {
      copy.run('DELETE FROM configuracoes_seguranca');
    }
    const bytes = copy.export();
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const fileName = `ledgerly_${which}_${stamp}.db`;
    triggerBlobDownload(new Blob([bytes], { type: 'application/vnd.sqlite3' }), fileName);
    showToast(`${fileName} exportado para consulta.`, 'success');
  } catch (error) {
    console.error('Falha ao exportar banco SQLite individual:', error);
    showToast('Não foi possível exportar o banco SQLite.', 'error');
  } finally { try { copy?.close(); } catch (_) {} }
}

function triggerBlobDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function requestRestoreDatabase() {
  const choice = await ledgerlyModal({ title: 'Restaurar banco de dados', message: 'Escolha de onde deseja recuperar o conjunto central.db + daily.db.',
    buttons: [{ label: 'Arquivo deste aparelho (.lgp)', value: 'local', primary: true }, { label: 'Google Drive (nuvem)', value: 'cloud' }, { label: 'Cancelar', value: 'cancel' }] });
  if (choice.value === 'local') { document.getElementById('restoreDbInput')?.click(); return; }
  if (choice.value === 'cloud') await restoreDatabaseFromDrive();
}

async function restoreDatabaseFromDrive() {
  try {
    if (!navigator.onLine) throw new Error('Conecte-se à internet para restaurar o backup do Google Drive.');
    setPrefetched(null);
    const token = await getToken('interactive');
    const remote = await driveFind(token);
    if (!remote) throw new Error('Nenhum backup Ledgerly foi encontrado no Google Drive.');
    const keyResult = await ensureKey(remote, token);
    if (keyResult.remoteDeleted) throw new Error('O backup da nuvem foi removido durante a redefinição da senha. Nenhum dado foi restaurado.');
    const bytes = (prefetched && prefetched.rev === (remote.appProperties || {}).rev)
      ? prefetched.bytes : await openDb(await driveDownload(remote.id, token), keyResult.kd.key);
    openConfirmDialog({ title: 'Confirmar restauração da nuvem',
      message: 'O backup criptografado foi descriptografado. A carteira e o histórico atuais deste aparelho serão substituídos pelos dados do Google Drive.',
      requirePin: Boolean(getSetting('security_pin_hash')),
      onConfirm: async () => {
        try {
          await applyRemoteDb(bytes);
          const rev = (remote.appProperties || {}).rev || null;
          const localHash = await hashCurrentPair();
          saveSyncState({ connected: true, needsLogin: false, fileId: remote.id, baseRev: rev, syncedHash: localHash,
            localChangedAt: (remote.appProperties || {}).ts || remote.modifiedTime || new Date().toISOString(), lastSync: new Date().toISOString(),
            hasLocalUserChanges: false, recoveredFromEmptyIdb: false });
          setSyncStatusFlags({ syncPending: false, syncCloudMissing: false, syncConflict: false });
          updateConnectionBadge(); renderSyncCard(); refreshAllViews(); renderOnboarding(); switchTab('carteira');
          showToast('Conjunto central.db + daily.db restaurado do Google Drive.', 'success');
          try { await driveDeleteExtras(token, remote.id); } catch (cleanupError) { console.warn('Não foi possível remover backups duplicados do Drive:', cleanupError); showToast('Restauração concluída, mas não foi possível remover todas as cópias duplicadas da nuvem.', 'info'); }
        } catch (restoreError) {
          console.error('Falha ao aplicar backup do Google Drive:', restoreError);
          showToast('Falha ao restaurar da nuvem: ' + ((restoreError && restoreError.message) || restoreError), 'error');
        }
      }
    });
  } catch (error) {
    if (!(error && error.cancelled)) { console.error('Restauração do Google Drive:', error); showToast('Falha ao restaurar da nuvem: ' + ((error && error.message) || error), 'error'); }
  } finally { setPrefetched(null); }
}

async function handleRestoreSQLiteFile(event) {
  const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
  const fileHeader = new TextDecoder().decode(new Uint8Array(await file.slice(0, 4).arrayBuffer()));
  if (fileHeader === 'SQLi') { showToast('Este arquivo contém apenas um banco SQLite individual. Para restaurar a carteira, selecione o backup completo Ledgerly (.lgp).', 'info'); return; }
  const confirmAction = async () => {
    let nextCentral=null, nextDaily=null;
    const previousCentral=db, previousDaily=dailyDb;
    let restored=false;
    try {
      const pair=await unpackSyncPackage(new Uint8Array(await file.arrayBuffer()));
      if (pair.manifest.central.schemaVersion!==3 || pair.manifest.daily.schemaVersion!==1) throw new Error('O backup usa versões de schema incompatíveis.');
      nextCentral=new SQL.Database(pair.central); nextDaily=new SQL.Database(pair.daily);
      validateDatabasePair(nextCentral,nextDaily);
      const localBiometricId=getSetting('biometrics_cred_id');
      window.__ledgerlyApplying=true; setDb(nextCentral); setDailyDb(nextDaily);
      createCentralSchema(db); createDailySchema(dailyDb);
      if (localBiometricId && !getSetting('biometrics_cred_id')) db.run("INSERT OR REPLACE INTO configuracoes_seguranca(chave,valor) VALUES('biometrics_cred_id',?)",[localBiometricId]);
      if (!getSetting('biometrics_cred_id')) db.run("INSERT OR REPLACE INTO configuracoes_seguranca(chave,valor) VALUES('biometrics_enabled','0')");
      await persistSQLiteToIndexedDB({suppressSync:true});
      restored=true;
    } catch(err) {
      console.error('Erro ao restaurar conjunto SQLite:',err);
      try { if (db===nextCentral) setDb(previousCentral); if (dailyDb===nextDaily) setDailyDb(previousDaily); nextCentral?.close(); nextDaily?.close(); } catch(_) {}
      showToast((err && err.message) || 'O arquivo selecionado não é um conjunto Ledgerly válido.', 'error');
    } finally { window.__ledgerlyApplying=false; }
    if (restored) {
      try { previousCentral?.close(); previousDaily?.close(); } catch(_) {}
      try { refreshAllViews(); switchTab('carteira'); } catch(uiErr) { console.error('Erro ao atualizar telas após restauração:', uiErr); }
      showToast('Conjunto central.db + daily.db restaurado com sucesso!', 'success');
    }
    if (restored && syncState().connected) await syncAfterPersist().catch(e=>console.warn('Não foi possível agendar a sincronização após a restauração:',e));
  };
  openConfirmDialog({ title:'Restaurar conjunto de bancos', message:`Deseja substituir central.db e daily.db pelo conjunto de backup "${file.name}"?`, requirePin:Boolean(getSetting('security_pin_hash')), onConfirm:confirmAction });
}

async function requestWipeDatabase() {
  const choice = await ledgerlyModal({ title: 'Limpar todos os dados',
    message: 'Escolha o alcance da limpeza. O PIN, as configurações e o token da brapi serão mantidos.',
    buttons: [{ label: 'Somente neste aparelho', value: 'local', primary: true }, { label: 'Aparelho + Google Drive', value: 'all' }, { label: 'Cancelar', value: 'cancel' }] });
  if (choice.value === 'cancel') return;
  const cloud = choice.value === 'all';
  openConfirmDialog({ title: cloud ? 'Apagar carteira e backup da nuvem?' : 'Limpar dados deste aparelho?',
    message: cloud
      ? 'Serão apagados os dados de investimentos deste aparelho e TODOS os backups Ledgerly encontrados no Google Drive. A cópia criptografada da nuvem também será excluída. A sincronização será desconectada para impedir que o backup seja recriado. Esta ação não pode ser desfeita.'
      : 'Serão apagados os dados de investimentos deste aparelho. O backup do Google Drive será mantido, mas a sincronização será desconectada para impedir que a carteira vazia sobrescreva a cópia da nuvem. Uma cópia local de segurança ficará disponível para restauração.',
    requirePin: Boolean(getSetting('security_pin_hash')),
    onConfirm: async () => {
      try {
        if (cloud) await deleteCloudDb();
        await wipeAllData({ keepLocalRecovery: !cloud, suppressSync: true });
        await disconnectSyncLocal();
        if (cloud) { await clearConflictBackups(); }
        setStagedNotesQueue([]); renderStagingScreen(); refreshAllViews(); updateConnectionBadge(); renderSyncCard();
        showToast(cloud ? 'Dados locais e backup do Google Drive excluídos.' : 'Dados locais limpos. O backup da nuvem foi preservado e a sincronização desconectada.', 'success');
      } catch (error) {
        showToast('Falha ao limpar os dados: ' + ((error && error.message) || error), 'error');
      }
    }
  });
}

// Compatibilidade apenas para handlers inline no HTML/templates.
Object.assign(globalThis, {
  downloadIndividualSQLiteDatabase,
  downloadLocalSQLiteBackup,
  handleRestoreSQLiteFile,
  requestRestoreDatabase,
  requestWipeDatabase
});
