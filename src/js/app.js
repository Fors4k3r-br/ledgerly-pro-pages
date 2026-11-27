// Ponto único de entrada do Ledgerly Pro.
// Arquitetura 100% em ES Modules (DAG sem ciclos, zero funções em globalThis, CSP sem unsafe-inline em scripts).
import '../../changelog.js';
import './portfolio/sectors-data.js';

import './core/state.js';
import './core/events.js';
import './core/utils.js';
import './ui/navigation.js';
import './ui/calculator.js';
import './core/database.js';
import './security/lock-screen.js';
import './sync/google-drive.js';
import './notes/notes-manager.js';
import './reports/reports-view.js';
import './pwa/updates-and-sw.js';
import './portfolio/positions.js';
import './portfolio/brapi.js';
import './dividends/proventos.js';
import './core/backup-restore.js';
import './core/refresh.js';
import './ui/actions.js';
import './core/bootstrap.js';
