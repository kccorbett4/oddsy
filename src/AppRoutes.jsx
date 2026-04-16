import { Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import EvBettingPage from './seo-pages/EvBettingPage.jsx'
import OddsComparisonPage from './seo-pages/OddsComparisonPage.jsx'
import ParlayCalculatorPage from './seo-pages/ParlayCalculatorPage.jsx'
import SharpBettingPage from './seo-pages/SharpBettingPage.jsx'
import BettingAlertsPage from './seo-pages/BettingAlertsPage.jsx'
import LiveScoresPage from './seo-pages/LiveScoresPage.jsx'
import ReverseLineMovementPage from './seo-pages/ReverseLineMovementPage.jsx'
import CorrelationParlayPage from './seo-pages/CorrelationParlayPage.jsx'
import StaleLineDetectorPage from './seo-pages/StaleLineDetectorPage.jsx'
import NarrativeRegressionPage from './seo-pages/NarrativeRegressionPage.jsx'

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<App />} />
      <Route path="/ev-betting" element={<EvBettingPage />} />
      <Route path="/odds-comparison" element={<OddsComparisonPage />} />
      <Route path="/parlay-calculator" element={<ParlayCalculatorPage />} />
      <Route path="/sharp-betting" element={<SharpBettingPage />} />
      <Route path="/betting-alerts" element={<BettingAlertsPage />} />
      <Route path="/live-scores" element={<LiveScoresPage />} />
      <Route path="/reverse-line-movement" element={<ReverseLineMovementPage />} />
      <Route path="/correlated-parlays" element={<CorrelationParlayPage />} />
      <Route path="/stale-line-detector" element={<StaleLineDetectorPage />} />
      <Route path="/narrative-regression" element={<NarrativeRegressionPage />} />
    </Routes>
  )
}
