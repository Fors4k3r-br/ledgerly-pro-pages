// Inicialização principal da aplicação (DOMContentLoaded) e controle do botão Voltar (popstate).

// Inicialização ao carregar a página
window.addEventListener('DOMContentLoaded', async () => {
  lucide.createIcons();
  setTodayDateOnManualForm();

  // Define o estado inicial da carteira no histórico do navegador
  history.replaceState({ tab: 'carteira' }, "", '#carteira');	  

  await initSQLiteDatabase();
  loadBrapiSettingsToUI();
  checkLockScreenOnStartup();
  refreshAllViews();
  // Primeiro reconcilia os bancos locais com o Google Drive. Nenhuma rotina
  // automática deve alterar o SQLite antes de decidir qual versão prevalece.
  const startupSyncOk = await syncOnStart();
  maybeShowWhatsNew();

  // Se a sincronização estiver conectada mas não puder ser concluída (offline,
  // login expirado ou conflito pendente), não modifica o banco antes do próximo
  // ciclo. Isso impede que uma captura/cotação transforme dados antigos em upload.
  if (startupSyncOk) {
    await captureDailyPortfolioSnapshot();

    // Só atualiza cotações depois da sincronização inicial.
    if (getSetting('brapi_auto_sync') === '1' && getSetting('brapi_token')) {
      await syncAllQuotesFromBrapi(true);
    }
  } else {
    console.warn('Inicialização: captura diária e atualização automática de cotações adiadas porque a sincronização inicial não foi concluída.');
  }

// Intercepta o botão "Voltar" do celular para alternar as abas ou exigir duplo clique para fechar
window.addEventListener('popstate', (event) => {
  const currentActiveTab = document.querySelector('main > section:not(.hidden)')?.id?.replace('tab-', '');

  if (currentActiveTab === 'carteira' || !event.state || !event.state.tab) {
    const now = Date.now();
    if (now - lastBackPressTime < 2500) {
      // Se apertar de novo em menos de 2.5 segundos, permite fechar o app / histórico
      history.back();
    } else {
      lastBackPressTime = now;
      showToast('Pressione mais uma vez para sair do aplicativo.', 'info');
      // Empurra o estado de volta para manter o usuário na carteira no primeiro toque
      history.pushState({ tab: 'carteira' }, "", '#carteira');
    }
  } else {
    // Se estiver em outra aba, volta para a aba anterior normalmente sem empurrar novo histórico
    const targetTab = event.state.tab || 'carteira';
    switchTab(targetTab, false);
  }	  

  });

});
