# Ledgerly Pro – deploy no GitHub Pages
1. Copie todo o conteúdo deste zip para a raiz do repositório (mantenha sua pasta `icons/`).
2. Commit + push. Não precisa de build no servidor.
3. A cada entrega, edite apenas `changelog.js`: suba `version` e `build` (o build vira o nome do cache) e escreva as novidades no início de `entries`. O app mostra essas notas ao atualizar e em Configurações → Versão.
4. Se mudar classes Tailwind no index.html: `npm i && npm run build:css` e suba `assets/tailwind.css`.

## Sincronização com Google Drive
- Configurações → "Conectar ao Google Drive". Na primeira vez, crie a senha de sincronização (não é recuperável).
- No Google Cloud, a credencial precisa da origem `https://fors4k3r-br.github.io`, da Drive API ativada e do seu e-mail como usuário de teste.
- Em outro aparelho, use a mesma conta Google e a mesma senha.
