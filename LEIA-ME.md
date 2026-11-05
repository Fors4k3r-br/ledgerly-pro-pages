# Ledgerly Pro – deploy no GitHub Pages
1. Copie todo o conteúdo deste zip para a raiz do repositório (mantenha sua pasta `icons/`).
2. Commit + push. Não precisa de build no servidor.
3. A cada deploy, troque `CACHE_NAME` em `service-worker.js` (ex.: v8) para os usuários receberem o aviso de atualização.
4. Se mudar classes Tailwind no index.html: `npm i && npm run build:css` e suba `assets/tailwind.css`.
