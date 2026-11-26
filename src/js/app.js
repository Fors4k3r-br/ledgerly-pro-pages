// Ponto único de entrada do Ledgerly Pro.
// A ordem preserva a inicialização da build 49; cada módulo publica somente
// sua API de compatibilidade no globalThis para o HTML e módulos legados.
import '../../changelog.js';
import './portfolio/sectors-data.js';
import './portfolio/sectors.js';
import './portfolio/calculations.js';
import './notes/pdf-reader.js';
import './notes/note-parser.js';
import './security/encryption.js';
import './reports/excel-export.js';

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
