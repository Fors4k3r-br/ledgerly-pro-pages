# 📊 Ledgerly Pro — Automação de Proventos (B3)

[![Atualizar Dividendos (Java)](https://github.com/Fors4k3r-br/ledgerly-pro-pages/actions/workflows/atualizar.yml/badge.svg)](https://github.com/Fors4k3r-br/ledgerly-pro-pages/actions/workflows/atualizar.yml)
![Java](https://img.shields.io/badge/Java-21-ED8B00?logo=openjdk&logoColor=white)
![Maven](https://img.shields.io/badge/Maven-Build-C71A36?logo=apachemaven&logoColor=white)
![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Ativo-222222?logo=githubpages&logoColor=white)

Repositório responsável pela hospedagem do **Ledgerly Pro** no GitHub Pages e pela atualização diária automatizada da agenda de dividendos e JCP da B3 (`dividendos.json`).

---

## ⚙️ Como Funciona

O pipeline de atualização opera de forma 100% automatizada e gratuita:

1. **Agendamento (`cron-job.org`):** Dispara diariamente uma requisição `POST` para a API do GitHub no horário configurado (`America/Sao_Paulo`).
2. **Coleta (`GitHub Actions`):** O workflow `atualizar.yml` compila e executa o scraper em **Java 21 + Maven** (`Scraper.java`).
3. **Publicação (`GitHub Pages`):** Havendo alterações nos dados, o robô faz commit e push automático do arquivo `dividendos.json` na branch `main`, disponibilizando o JSON atualizado na mesma origem do app.

---

## 📁 Estrutura do Repositório

```text
ledgerly-pro-pages/
├── .github/
│   └── workflows/
│       └── atualizar.yml     # Pipeline do GitHub Actions (workflow_dispatch)
├── src/                      # Código-fonte do Scraper em Java
├── pom.xml                   # Configuração e dependências do Maven
├── dividendos.json           # Base estática de proventos atualizada diariamente
└── README.md                 # Documentação do repositório
```

---

## 📄 Formato do `dividendos.json`

Os dados publicados na raiz do repositório seguem esta estrutura:

```json
{
  "atualizado_em": "2026-11-22T19:13:33.474612815Z",
  "quantidade": 94,
  "dividendos": [
    {
      "codigo": "BBDC3",
      "tipo": "JCP",
      "valor": "0,017250",
      "registro": "01/10/2026",
      "ex": "02/10/2026",
      "pagamento": "03/11/2026"
    }
  ]
}
```

| Campo | Descrição |
| :--- | :--- |
| `atualizado_em` | Data e hora da última atualização em UTC (ISO-8601). |
| `quantidade` | Quantidade total de proventos listados no arquivo. |
| `codigo` | Ticker do ativo na B3 (ex: `PETR4`, `TAEE11`, `BBDC3`). |
| `tipo` | Natureza do provento (`Dividendo` ou `JCP`). |
| `valor` | Valor unitário bruto por ação/cota (formato decimal com vírgula). |
| `registro` | Data Com (`DD/MM/AAAA`). |
| `ex` | Data Ex (`DD/MM/AAAA`). |
| `pagamento` | Data prevista de pagamento (`DD/MM/AAAA`). |

---

## 🚀 Automação (GitHub Actions + cron-job.org)

O workflow `.github/workflows/atualizar.yml` é acionado exclusivamente via `workflow_dispatch` (manualmente na aba **Actions** ou pelo agendador externo).

### Parâmetros configurados no `cron-job.org`

* **Método:** `POST`
* **Endpoint:**
  ```text
  https://api.github.com/repos/Fors4k3r-br/ledgerly-pro-pages/actions/workflows/atualizar.yml/dispatches
  ```
* **Headers:**
  * `Authorization`: `Bearer <FINE_GRAINED_PAT>` *(permissão `Actions: Read and write` restrita a este repositório)*
  * `Accept`: `application/vnd.github+json`
  * `Content-Type`: `application/json`
  * `X-GitHub-Api-Version`: `2026-03-10`
* **Body:**
  ```json
  {"ref":"main"}
  ```

---

## 💻 Execução Local

### Pré-requisitos
* **Java 21** (JDK)
* **Apache Maven**

### Rodar o Scraper localmente

```bash
mvn compile exec:java -Dexec.mainClass="Scraper"
```

Ao finalizar, o arquivo `dividendos.json` será gerado ou atualizado na raiz do projeto.

---

## 🔗 Consumo no App

O arquivo pode ser consumido diretamente via `fetch` relativo no GitHub Pages (com *cache-busting* para evitar versões antigas em cache):

```javascript
const resp = await fetch(`./dividendos.json?v=${Date.now()}`, {
  cache: 'no-cache'
});
const dados = await resp.json();
``` 
