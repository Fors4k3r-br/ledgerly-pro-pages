
// Única fonte da versão do app. A cada entrega, edite APENAS este arquivo:
//   - suba "version" e "build" (o build define o nome do cache do service worker);
//   - acrescente uma entrada nova no INÍCIO de "entries" com as mudanças, em linguagem simples.
globalThis.LEDGERLY_CHANGELOG = {
  version: '1.4.16',
  build: 40,
  entries: [
    {
      version: '1.4.16',
      date: '2026-11-24',
      notes: [
        'Estrutura: os arquivos da classificação setorial agora ficam juntos em src/js/portfolio: sectors-data.js contém a base da B3 e sectors.js contém as funções de classificação.',
        'PWA: corrigidos os caminhos no HTML, no Service Worker e no gerador da base setorial; removida a referência ao antigo setores.js da raiz.'
      ]
    },
    {
      version: '1.4.15',
      date: '2026-11-24',
      notes: [
        'Estrutura: iniciada a modularização JavaScript. A classificação setorial foi separada em um módulo ES, preservando as regras manuais, o cadastro da B3 e as classificações automáticas.',
        'PWA: o novo módulo setorial foi incluído no cache inicial para manter o funcionamento também sem conexão.'
      ]
    },
    {
      version: '1.4.14',
      date: '2026-11-24',
      notes: [
        'Backup na nuvem: o Ledgerly mantém somente um arquivo de sincronização no Google Drive; após uma sincronização ou restauração bem-sucedida, cópias duplicadas são removidas.',
        'Restauração: agora é possível escolher entre um arquivo local .lgp e o Google Drive. A restauração da nuvem exige a senha de criptografia e valida o conjunto dos dois bancos antes de substituir os dados locais.',
        'Limpeza: é possível apagar somente os dados deste aparelho, preservando o backup da nuvem, ou apagar os dados locais e também todos os backups Ledgerly do Google Drive. A sincronização é desconectada para evitar recriação automática do backup excluído.'
      ]
    },
    {
      version: '1.4.13',
      date: '2026-11-24',
      notes: [
        'Backup: o conjunto completo dos bancos agora usa a extensão .lgp, identificando o pacote Ledgerly e evitando confusão com um arquivo SQLite individual; a restauração de pacotes antigos .db continua aceita.',
        'Banco de dados: adicionada exportação individual de central.db e daily.db para consulta em programas SQLite. A cópia individual do central.db não inclui configurações de segurança ou credenciais.',
        'Primeiro acesso: a tela de boas-vindas agora oferece Restaurar banco de dados em destaque, antes das opções para criar uma carteira e configurar PIN ou sincronização.'
      ]
    },
    {
      version: '1.4.12',
      date: '2026-11-24',
      notes: [
        'Banco de dados: separação concluída em central.db (carteira) e daily.db (histórico patrimonial), ambos iniciados vazios; dados e configurações anteriores não foram migrados nem guardados localmente, conforme a opção escolhida.',
        'Sincronização: os dois bancos agora são enviados e restaurados juntos, com manifesto, versões de schema e hashes de integridade; a cópia antiga do Google Drive permanece separada e não é sobrescrita.',
        'Backup e restauração: o arquivo local agora contém o conjunto completo dos dois bancos SQLite.'
      ]
    },
    {
      version: '1.4.11',
      date: '2026-11-24',
      notes: [
        'Banco de dados: preparada a migração segura para o novo schema SQLite, com cadastro central de ativos, integridade referencial e preservação dos dados anteriores.',
        'Patrimônio: criada a estrutura de histórico diário consolidado e detalhado por ativo, com backup pré-migração e validação antes da substituição do banco.'
      ]
    },
    {
      version: '1.4.10',
      date: '2026-11-22',
      notes: [
        'Navegação: a barra inferior agora acompanha automaticamente as cores dos temas Padrão, Escuro e Claro.',
        'Navegação: o Bottom Sheet, seu cabeçalho, botão de fechar e itens do menu também se adaptam ao tema selecionado, mantendo o destaque verde da seção ativa.'
      ]
    },
    {
      version: '1.4.9',
      date: '2026-11-22',
      notes: [
        'Navegação mobile: corrigido o posicionamento do Bottom Sheet para ocupar toda a largura e ficar ancorado na parte inferior.',
        'Navegação mobile: o painel e o backdrop ficam realmente invisíveis e sem interação quando o menu está fechado.',
        'Layout: reservado espaço adicional no final do conteúdo rolável para a barra inferior e a área segura do dispositivo.'
      ]
    },
    {
      version: '1.4.8',
      date: '2026-11-22',
      notes: [
        'Navegação mobile: removido o botão de menu do cabeçalho e adicionada uma barra inferior fixa com cinco ícones, sem legendas.',
        'Navegação mobile: o menu completo agora abre em um painel deslizante de baixo para cima, com fundo de fechamento, alça, botão fechar e destaque da seção ativa.',
        'Layout: adicionada margem inferior ao conteúdo para evitar que a barra fixa cubra os controles e o final das telas.',
        'Estrutura: padronizado o caminho do CSS de entrada em src/input.css e removidos arquivos residuais.'
      ]
    },
    {
      version: '1.4.7',
      date: '2026-11-21',
      notes: [
        'Relatório IRPF: incluído o preço médio de aquisição por ativo nas posições de 31/12 do ano anterior e do ano selecionado, na tela, no PDF e na planilha Excel. O custo total permanece como valor patrimonial de referência.',
        'Sincronização: o LED laranja agora pulsa somente durante uma sincronização efetiva. Quando há apenas alterações pendentes, o LED permanece laranja e estático.'
      ]
    },
    {
      version: '1.4.6',
      date: '2026-11-21',
      notes: [
        'Cabeçalho: o status textual foi substituído por um indicador LED discreto. Verde indica sincronização concluída, laranja indica processo ou alterações pendentes, vermelho indica erro ou conflito e cinza indica modo offline ou Google Drive desconectado.',
        'Ao tocar no LED, um painel mostra conexão com a internet, estado do Google Drive, situação dos dados, horário da última sincronização concluída e acesso para configurar ou tentar sincronizar novamente.'
      ]
    },
    {
      version: '1.4.5',
      date: '2026-11-19',
      notes: [
        'Menu lateral: removido o escurecimento da camada sobre a aplicação. O fundo ao redor do menu agora é totalmente transparente, mantendo o toque fora para fechar.'
      ]
    },
    {
      version: '1.4.4',
      date: '2026-11-19',
      notes: [
        'Menu lateral: corrigida a sobreposição para que o menu e o fundo escurecido apareçam sempre à frente dos cartões, gráficos e demais blocos da tela.'
      ]
    },
    {
      version: '1.4.3',
      date: '2026-11-19',
      notes: [
        'Menu lateral retrátil: a navegação principal saiu da barra inferior e agora abre pelo botão de menu no topo, com acesso a Carteira, Ativos, Adicionar ativos, Relatórios, Proventos e Configurações.',
        'Relatórios: o seletor de ano-calendário agora começa na primeira compra registrada e inclui o ano atual no topo como prévia do exercício seguinte.'
      ]
    },
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
