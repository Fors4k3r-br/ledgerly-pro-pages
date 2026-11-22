# Ledgerly Pro

O **Ledgerly Pro** é um aplicativo web progressivo (PWA) desenvolvido para o controle, acompanhamento e organização de carteiras de investimentos na bolsa brasileira (B3). Ele foi projetado com foco em privacidade total, funcionamento offline e automação das tarefas mais repetitivas do investidor.

---

## Para que serve

Acompanhar uma carteira de ações na B3 normalmente exige escolher entre dois extremos: manter planilhas manuais que dão trabalho para atualizar a cada compra ou usar plataformas de terceiros que cobram mensalidade e armazenam todo o seu patrimônio em servidores externos.

O **Ledgerly Pro** resolve esse problema oferecendo uma ferramenta pessoal e independente para:

* **Centralizar movimentações:** registrar compras, vendas e custos operacionais em um histórico organizado.
* **Acompanhar a evolução da carteira:** visualizar rapidamente a quantidade de ativos, o preço médio de aquisição, o valor investido e a posição atualizada.
* **Prever o fluxo de proventos:** saber exatamente quanto e quando você vai receber em dividendos e Juros sobre Capital Próprio (JCP), sem precisar consultar site por site.
* **Manter controle total dos dados:** guardar suas informações financeiras apenas no seu próprio aparelho, sem depender de cadastros ou contas em nuvens de terceiros.

---

## Como funciona na prática

O aplicativo segue a filosofia **local-first** (primeiro no dispositivo). Isso significa que toda a inteligência e o armazenamento acontecem diretamente no seu celular ou computador, usando a internet apenas para buscar dados públicos de mercado ou realizar o seu backup pessoal.

### 1. Banco de dados local (SQLite)
Em vez de enviar suas transações para um servidor remoto, o aplicativo executa um banco de dados **SQLite** diretamente dentro do navegador.
* **Acesso instantâneo:** consultas, filtros e cálculos de carteira acontecem localmente, sem lentidão de rede.
* **Uso 100% offline:** você pode abrir o app no avião, no metrô ou sem sinal de internet e consultar toda a sua carteira e histórico normalmente.

### 2. Importação de notas de corretagem (Padrão SINACOR)
Lançar operações manualmente gera erros de digitação e toma tempo. O Ledgerly Pro lê notas de corretagem no padrão SINACOR (como as emitidas pelo BB Investimentos e demais corretoras brasileiras) e extrai automaticamente:
* Os códigos dos ativos negociados (tickers);
* As quantidades compradas ou vendidas;
* Os preços unitários, taxas e emolumentos;
* A data da operação.

A partir desses dados, o aplicativo recalcula automaticamente o **preço médio** de cada papel e unifica ações compradas no mercado padrão e no mercado fracionário (por exemplo, somando posições de `PETR4` e `PETR4F` sob o mesmo ativo).

### 3. Cruzamento automático de dividendos e JCP
Uma rotina automatizada atualiza diariamente a agenda de proventos anunciados na B3. Quando você abre o aplicativo com conexão à internet, ele baixa essa lista atualizada (e guarda uma cópia local para consultas offline) e faz o cruzamento direto com os ativos presentes na sua carteira:
* **Filtragem inteligente:** exibe apenas os proventos referentes aos papéis que você realmente possui.
* **Datas completas:** mostra a Data Com (data de registro para ter direito ao provento), a Data Ex e a data prevista de pagamento.
* **Cálculo líquido automático:** multiplica o valor unitário pela sua quantidade de ações e já aplica o desconto obrigatório de **15% de Imposto de Renda** sobre eventos classificados como **JCP**, diferenciando claramente o valor bruto do valor líquido que vai cair na conta.
* **Ordenação cronológica:** organiza o calendário pelos próximos pagamentos para facilitar o acompanhamento do fluxo de caixa mensal.

### 4. Atualização de cotações
Sempre que há conexão disponível, o aplicativo atualiza as cotações dos ativos da carteira para refletir a rentabilidade e o saldo patrimonial do dia. Caso você esteja sem internet, o sistema continua exibindo a última cotação salva em cache, sem travar a interface.

---

## Segurança e privacidade

A privacidade financeira é um pilar central do projeto:

* **Sem cadastro e sem servidor central:** o aplicativo não pede e-mail, senha ou CPF para funcionar, e nenhum dado da sua carteira trafega por servidores próprios do app.
* **Bloqueio por biometria:** suporta autenticação biométrica nativa do dispositivo (impressão digital ou reconhecimento facial via WebAuthn), impedindo que terceiros visualizem seus valores caso tenham acesso ao seu celular desbloqueado.
* **Backup em nuvem sob seu controle:** para evitar perda de dados em caso de troca ou perda do aparelho, o app permite salvar e restaurar o arquivo do banco de dados diretamente no seu próprio Google Drive. O arquivo permanece exclusivamente na sua conta pessoal.

---

## Experiência como aplicativo (PWA)

Por ser um **Progressive Web App (PWA)**, o Ledgerly Pro pode ser instalado diretamente na tela inicial do Android, iOS ou computador sem precisar passar por lojas de aplicativos. Depois de instalado, ele abre em tela cheia, possui ícone próprio e se comporta como um aplicativo nativo leve e rápido.

---

## Resumo dos principais recursos

* Controle completo de carteira de ações da B3 (lote padrão e fracionário).
* Cálculo automático de preço médio e consolidação de posições.
* Importação automatizada de notas de corretagem no padrão SINACOR.
* Agenda diária de dividendos e JCP cruzada com a sua carteira.
* Cálculo automático de valor bruto e valor líquido (com retenção de 15% de IR no JCP).
* Funcionamento offline-first com banco de dados SQLite local.
* Proteção de acesso via biometria do dispositivo.
* Backup e restauração opcionais diretamente no seu Google Drive pessoal.
