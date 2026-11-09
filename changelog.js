// Única fonte da versão do app. A cada entrega, edite APENAS este arquivo:
//   - suba "version" e "build" (o build define o nome do cache do service worker);
//   - acrescente uma entrada nova no INÍCIO de "entries" com as mudanças, em linguagem simples.
globalThis.LEDGERLY_CHANGELOG = {
  version: '1.2.0',
  build: 21,
  entries: [
    {
      version: '1.2.0',
      date: '2026-11-07',
      notes: [
        'Carteira com gráfico de evolução: linha do investido e do patrimônio, com filtros de período (1 semana até Desde o início).',
        'Bloco de cotações logo abaixo do gráfico: toque nele para atualizar e veja o horário da última atualização.',
        'Meus ativos: a composição da carteira e a lista de posições ficam na mesma tela, aberta pelo botão Ver mais.',
        'O histórico do patrimônio começa no dia em que você abre o app, um ponto por dia, e fica guardado no banco de dados (vai para o Drive e para os backups). A linha do investido vem das suas operações.'
      ]
    },
    {
      version: '1.1.0',
      date: '2026-11-07',
      notes: [
        'Login do Google uma única vez: o app renova o acesso sozinho e não pede mais para escolher a conta a cada abertura.',
        'A sincronização agora acontece logo ao abrir o app, sem precisar tocar na tela.'
      ]
    },
    {
      version: '1.0.0',
      date: '2026-11-07',
      notes: [
        'Sincronização com o Google Drive: o banco é criptografado com a sua senha e fica igual em todos os seus aparelhos.',
        'Conflitos de sincronização: vale a alteração mais recente ou você decide (Configurações → Banco de dados → Sincronização).',
        'Corretora em cada nota, operação e provento, com filtros nas posições, notas e proventos.',
        'Proventos: janela para lançar e gráfico com os últimos 12 meses.',
        'Início redesenhado: patrimônio em destaque, gráfico por ativo ou por corretora e menu com Posições.',
        'Temas: Padrão, Escuro e Claro (Configurações → Temas).',
        'Configurações reorganizadas: Banco de dados, Segurança, APIs e Temas.'
      ]
    }
  ]
};
