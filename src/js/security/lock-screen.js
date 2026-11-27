// Proteção de acesso do aplicativo: PIN com PBKDF2, bloqueio de tentativas e biometria WebAuthn.

import { getSetting, setSetting } from '../core/database.js';
import { arrayBufferToBase64, openConfirmDialog, showToast, switchTab } from '../ui/navigation.js';

// =========================================================================
// 9. SEGURANÇA DO APP (VALIDAÇÃO DE PIN, ALTERAR PIN COM PIN ATUAL + WEBAUTHN)
// =========================================================================
async function sha256Hash(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const PIN_ITERATIONS = 210000;
export const hexOf = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
export const bytesOf = hex => new Uint8Array(hex.match(/.{2}/g).map(b => parseInt(b, 16)));
async function pbkdf2Hex(pin, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return hexOf(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}
async function hashPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PIN_ITERATIONS}$${hexOf(salt)}$${await pbkdf2Hex(pin, salt, PIN_ITERATIONS)}`;
}
export async function verifyPin(pin, stored) {
  if (!stored) return false;
  if (stored.startsWith('pbkdf2$')) {
    const [, it, saltHex, hashHex] = stored.split('$');
    return (await pbkdf2Hex(pin, bytesOf(saltHex), parseInt(it, 10))) === hashHex;
  }
  // Hash legado (SHA-256 sem salt): valida e migra automaticamente para PBKDF2
  if ((await sha256Hash(pin)) === stored) {
    try { await setSetting('security_pin_hash', await hashPin(pin)); } catch (_) {}
    return true;
  }
  return false;
}
function pinLockRemaining() {
  try { return Math.max(0, Math.ceil((Number(localStorage.getItem('ledgerly_pin_lock')) - Date.now()) / 1000)); } catch (_) { return 0; }
}
function pinRegisterFail() {
  try {
    const n = Number(localStorage.getItem('ledgerly_pin_fails') || 0) + 1;
    localStorage.setItem('ledgerly_pin_fails', String(n));
    if (n >= 5) localStorage.setItem('ledgerly_pin_lock', String(Date.now() + Math.min(900, 30 * 2 ** (n - 5)) * 1000));
  } catch (_) {}
}
function pinResetFails() {
  try { localStorage.removeItem('ledgerly_pin_fails'); localStorage.removeItem('ledgerly_pin_lock'); } catch (_) {}
}

async function handlePinManagementSubmit(event) {
  event.preventDefault();
  const existingPinHash = getSetting('security_pin_hash');
  const currentPinTyped = document.getElementById('currentPinInput').value.trim();
  const newPin = document.getElementById('newPinInput').value.trim();
  const confirmNewPin = document.getElementById('confirmNewPinInput').value.trim();

  // 1. Se já existir um PIN salvo, exige e valida o PIN atual antes de permitir a troca
  if (existingPinHash) {
    if (!currentPinTyped) {
      showToast('Informe seu PIN atual para poder alterá-lo.', 'error');
      document.getElementById('currentPinInput').focus();
      return;
    }
    if (!(await verifyPin(currentPinTyped, existingPinHash))) {
      showToast('PIN atual incorreto! Alteração não autorizada.', 'error');
      document.getElementById('currentPinInput').focus();
      return;
    }
  }

  // 2. Valida tamanho mínimo e confirmação do novo PIN
  if (newPin.length < 4) {
    showToast('O novo PIN deve conter pelo menos 4 dígitos.', 'error');
    return;
  }

  if (newPin !== confirmNewPin) {
    showToast('A confirmação do novo PIN não confere. Digite valores iguais.', 'error');
    document.getElementById('confirmNewPinInput').focus();
    return;
  }

  const newHash = await hashPin(newPin);
  await setSetting('security_enabled', '1');
  await setSetting('security_pin_hash', newHash);

  document.getElementById('currentPinInput').value = '';
  document.getElementById('newPinInput').value = '';
  document.getElementById('confirmNewPinInput').value = '';

  updateSecurityUIState();
  showToast(existingPinHash ? 'PIN alterado com sucesso!' : 'PIN de segurança criado e ativado!', 'success');
}

async function toggleSmartphoneBiometrics() {
  const pinHash = getSetting('security_pin_hash');
  if (!pinHash) {
    showToast('Cadastre primeiro um PIN acima antes de ativar a biometria.', 'error');
    return;
  }

  const currentBio = getSetting('biometrics_enabled') === '1';
  if (currentBio) {
    await setSetting('biometrics_enabled', '0');
    updateSecurityUIState();
    showToast('Biometria do smartphone desativada.', 'info');
    return;
  }

  if (!window.PublicKeyCredential) {
    showToast('Seu navegador atual não suporta WebAuthn Biométrico.', 'error');
    return;
  }

  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const userId = new Uint8Array(16);
    crypto.getRandomValues(userId);

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'Ledgerly Pro' },
        user: {
          id: userId,
          name: 'investidor@ledgerly.local',
          displayName: 'Investidor'
        },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required'
        },
        timeout: 60000
      }
    });

    if (credential && credential.rawId) {
      const credIdBase64 = arrayBufferToBase64(credential.rawId);
      await setSetting('biometrics_cred_id', credIdBase64);
      await setSetting('biometrics_enabled', '1');
      updateSecurityUIState();
      showToast('Biometria / Segurança do Smartphone vinculada com sucesso!', 'success');
    }
  } catch (err) {
    console.warn('WebAuthn registro:', err);
    showToast('Não foi possível registrar biometria neste ambiente (use HTTPS ou tela instalada).', 'error');
  }
}

async function disableAppSecurity() {
  openConfirmDialog({
    title: 'Desativar Bloqueio por PIN',
    message: 'Digite seu PIN atual para remover a proteção ao abrir o aplicativo:',
    requirePin: true,
    onConfirm: async () => {
      await setSetting('security_enabled', '0');
      await setSetting('security_pin_hash', '');
      await setSetting('biometrics_enabled', '0');
      updateSecurityUIState();
      showToast('Bloqueio de abertura desativado.', 'info');
    }
  });
}

export function updateSecurityUIState() {
  const hasPin = Boolean(getSetting('security_pin_hash'));
  const enabled = getSetting('security_enabled') === '1' && hasPin;
  const bioEnabled = getSetting('biometrics_enabled') === '1';

  const pill = document.getElementById('securityStatusPill');
  const disableBtn = document.getElementById('disableSecurityBtn');
  const bioBtn = document.getElementById('biometricToggleBtn');
  const currentPinWrapper = document.getElementById('currentPinFieldWrapper');
  const pinFormTitle = document.getElementById('pinFormTitle');
  const savePinBtn = document.getElementById('savePinSubmitBtn');

  if (enabled) {
    pill.textContent = bioEnabled ? 'PIN + Biometria Ativos' : 'PIN Ativo';
    pill.className = 'text-[11px] font-mono px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
    disableBtn.classList.remove('hidden');
    if (currentPinWrapper) currentPinWrapper.classList.remove('hidden');
    if (pinFormTitle) pinFormTitle.textContent = 'Alterar PIN Existente (Exige PIN Atual)';
    if (savePinBtn) savePinBtn.textContent = 'Confirmar e Alterar PIN';
  } else {
    pill.textContent = 'Desativado';
    pill.className = 'text-[11px] font-mono px-2.5 py-1 rounded-full bg-slate-800 text-slate-400';
    disableBtn.classList.add('hidden');
    if (currentPinWrapper) currentPinWrapper.classList.add('hidden');
    if (pinFormTitle) pinFormTitle.textContent = 'Criar PIN de Segurança';
    if (savePinBtn) savePinBtn.textContent = 'Salvar e Ativar PIN';
  }

  if (bioEnabled) {
    bioBtn.textContent = 'Biometria Ativa (Desativar)';
    bioBtn.className = 'px-3.5 py-2 rounded-xl bg-emerald-500/20 text-emerald-300 text-xs font-bold border border-emerald-500/40 transition shrink-0';
  } else {
    bioBtn.textContent = 'Ativar Biometria do Celular';
    bioBtn.className = 'px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition shrink-0';
  }
}

export function checkLockScreenOnStartup() {
  const enabled = getSetting('security_enabled') === '1' && Boolean(getSetting('security_pin_hash'));
  if (enabled) {
    showLockScreen();
  }
}

function lockAppNow() {
  const hasPin = Boolean(getSetting('security_pin_hash'));
  if (!hasPin) {
    switchTab('config');
    showToast('Crie um PIN primeiro na aba Configurações para bloquear o aplicativo.', 'info');
    document.getElementById('newPinInput').focus();
    return;
  }
  showLockScreen();
}

function showLockScreen() {
  const lockScreen = document.getElementById('lockScreen');
  const bioContainer = document.getElementById('biometricUnlockContainer');
  const unlockForm = document.getElementById('unlockForm');
  const subtitle = document.getElementById('lockScreenSubtitle');
  const bioEnabled = getSetting('biometrics_enabled') === '1';
  const credentialId = getSetting('biometrics_cred_id');

  document.getElementById('unlockPinInput').value = '';
  document.getElementById('unlockErrorMsg').classList.add('hidden');

  // Com biometria configurada, não exibe solicitação de PIN/token.
  // O PIN continua cadastrado apenas como requisito interno da configuração.
  if (bioEnabled && credentialId) {
    unlockForm.classList.add('hidden');
    bioContainer.classList.remove('hidden');
    subtitle.textContent = 'Confirme sua identidade usando a biometria do smartphone.';
  } else {
    unlockForm.classList.remove('hidden');
    bioContainer.classList.add('hidden');
    subtitle.textContent = 'Digite seu PIN para acessar sua carteira.';
  }

  lockScreen.classList.remove('hidden');
  lucide.createIcons();

  if (bioEnabled && credentialId) {
    // Tenta abrir a autenticação biométrica automaticamente.
    setTimeout(() => triggerBiometricUnlock(), 250);
  }
}

async function handleUnlockWithPin(event) {
  event.preventDefault();
  const typed = document.getElementById('unlockPinInput').value.trim();
  const lockLeft = pinLockRemaining();
  if (lockLeft > 0) {
    showToast(`Muitas tentativas. Aguarde ${lockLeft}s.`, 'error');
    return;
  }

  if (await verifyPin(typed, getSetting('security_pin_hash'))) {
    pinResetFails();
    document.getElementById('lockScreen').classList.add('hidden');
    document.getElementById('unlockErrorMsg').classList.add('hidden');
    showToast('App desbloqueado!', 'success');
  } else {
    pinRegisterFail();
    const errEl = document.getElementById('unlockErrorMsg');
    const card = document.getElementById('lockScreenCard');
    errEl.classList.remove('hidden');
    document.getElementById('unlockPinInput').value = '';
    if (card) {
      card.classList.remove('shake-error');
      void card.offsetWidth;
      card.classList.add('shake-error');
    }
  }
}

async function triggerBiometricUnlock() {
  const credentialIdBase64 = getSetting('biometrics_cred_id');

  if (!credentialIdBase64) {
    showToast('Biometria não cadastrada. Configure novamente nas opções de segurança.', 'error');
    return;
  }

  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    // Usa exatamente a credencial registrada neste aparelho.
    const binaryId = atob(credentialIdBase64);
    const credentialId = Uint8Array.from(binaryId, char => char.charCodeAt(0));

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{
          type: 'public-key',
          id: credentialId
        }],
        userVerification: 'required',
        timeout: 60000
      }
    });

    if (assertion) {
      document.getElementById('lockScreen').classList.add('hidden');
      showToast('Desbloqueado via Biometria do Smartphone!', 'success');
    }
  } catch (err) {
    // Mantém a tela protegida e permite tentar a biometria novamente.
    console.warn('Biometria cancelada ou indisponível:', err);
    const subtitle = document.getElementById('lockScreenSubtitle');
    if (subtitle) {
      subtitle.textContent = 'Não foi possível concluir a biometria. Toque em “Usar Biometria” para tentar novamente.';
    }
  }
}

// Compatibilidade apenas para handlers inline no HTML/templates.
Object.assign(globalThis, {
  disableAppSecurity,
  handlePinManagementSubmit,
  handleUnlockWithPin,
  lockAppNow,
  toggleSmartphoneBiometrics,
  triggerBiometricUnlock
});
