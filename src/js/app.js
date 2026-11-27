// Ponto único de entrada do Ledgerly Pro.
// Todos os módulos se comunicam via ES Modules (import/export explícitos);
// apenas as 75 funções chamadas por handlers inline permanecem em globalThis.
import '../../changelog.js';
import './portfolio/sectors-data.js';

import './core/state.js';
import './ui/navigation.js';
import './ui/calculator.js';
import './core/database.js';
import './security/lock-screen.js';
import './portfolio/positions.js';
import './portfolio/brapi.js';
import './notes/notes-manager.js';
import './reports/reports-view.js';
import './dividends/proventos.js';
import './sync/google-drive.js';
import './pwa/updates-and-sw.js';
import './core/bootstrap.js';
