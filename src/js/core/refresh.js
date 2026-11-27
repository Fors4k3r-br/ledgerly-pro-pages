// Orquestrador único de redesenho da interface (desacopla positions.js e database.js das demais abas).

import { setAllPositionsData } from './state.js';
import { registerRefreshHandler } from './events.js';
import { fillCorretoraSelects, updateDatabaseStats } from './database.js';
import { getConsolidatedPositions, renderPortfolioOverview } from '../portfolio/positions.js';
import { renderApiStatus } from '../portfolio/brapi.js';
import { renderSavedNotesHistory } from '../notes/notes-manager.js';
import { renderProventos } from '../dividends/proventos.js';
import { renderReports } from '../reports/reports-view.js';
import { updateSecurityUIState } from '../security/lock-screen.js';
import { renderThemeCard } from '../ui/navigation.js';

export function runRefreshAllViews() {
  const positions = getConsolidatedPositions();
  setAllPositionsData(positions);
  fillCorretoraSelects();
  renderApiStatus();
  renderThemeCard();
  renderPortfolioOverview(positions);
  renderSavedNotesHistory();
  renderProventos();
  if (document.getElementById('tab-relatorios') && !document.getElementById('tab-relatorios').classList.contains('hidden')) {
    renderReports();
  }
  updateDatabaseStats();
  updateSecurityUIState();
  lucide.createIcons();
}

registerRefreshHandler(runRefreshAllViews);
