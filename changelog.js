// Única fonte da versão do app. A cada entrega, edite APENAS este arquivo:
//   - suba "version" e "build" (o build define o nome do cache do service worker);
//   - acrescente uma entrada nova no INÍCIO de "entries" com as mudanças, em linguagem simples.
globalThis.LEDGERLY_CHANGELOG = {
  version: '1.4.0',
  build: 26.1,
  entries: [
    {
      version: '1.4.2',
      date: '2026-11-14',
      notes: [
        'Configurações → APIs agora abre a lista “APIs & Integrações”, com o cartão da brapi.dev (Configurado / Não configurado) e espaço para futuras integrações.',
        'Tela da brapi.dev: link “Cadastre-se na brapi.dev” logo abaixo do campo da chave, para quem ainda não tem um token (abre o site em uma nova aba).'
      ]
    },
    {
      version: '1.4.1',
      date: '2026-11-13',
      notes: [
        'Corrigido o falso “Não informada” na rosca por corretora: ativos sem cotação agora usam o último preço negociado (pela data da operação), o mesmo valor em todas as visões.',
        'Rosca por ativo mostra até 8 ativos; “Outros” só aparece acima disso e abre a lista do que está agrupado.',
        'Meus ativos: o contador (“7 de 7 ativos”) e o “Limpar” ficam numa linha própria e não saem mais da tela ao usar os filtros Todas e Encerradas.',
        'Rosca por corretora mostra “Sem corretora” apenas quando há operações realmente sem corretora, e ao tocar abre Meus ativos só com elas.'
      ]
    },
    {
      version: '1.4.0',
      date: '2026-11-13',
      notes: [
        'Nova visão “Por setor” em Meus ativos, com a classificação setorial da B3: toque numa fatia para ver só os ativos daquele setor.',
        'Cada ativo mostra setor e subsetor. Para empresas novas ou que mudaram de setor, toque no setor e escolha o correto (vale para todas as classes da empresa). Fundos, ETFs e BDRs ficam em grupos próprios.',
        'Importação de notas de outras corretoras corrigida (BTG Pactual): taxas de liquidação e de transferência de ativos, número e data do pregão e nome completo da corretora.'
      ]
    },
    {
      version: '1.3.1',
      date: '2026-11-10',
      notes: [
        'Gráfico da Carteira: o eixo agora termina em “Atual” (última cotação conhecida) e a linha tracejada sai da data da última compra até ele, mesmo quando você compra no dia da atualização das cotações.',
        'Os balões do gráfico somem sozinhos depois de alguns segundos.'
      ]
    },
    {
      version: '1.3.0',
      date: '2026-11-09',
      notes: [
        'Gráfico da Carteira simplificado: a linha do investido segue as datas das suas compras e o último ponto é o patrimônio atual (último preço conhecido). O banco não guarda mais pontos diários.',
        'O filtro "Desde o início" agora é o primeiro da lista.',
        'Notas de corretagem: novo botão com o ícone de olho (Ver nota) mostra as operações, as taxas e o PDF original, com opção de baixar.',
        'Barra de menu inferior refeita: agora ela fica fora da área de rolagem, então não se desloca mais ao detalhar um ativo em Meus ativos.'
      ]
    },
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
