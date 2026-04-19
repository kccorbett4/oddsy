import { Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import StrategyBuilder from './StrategyBuilder.jsx'
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
import ShopPage from './ShopPage.jsx'
import HomeRunsPage from './HomeRunsPage.jsx'

export default function AppRoutes() {
  return (
    <Routes>
      {/* Main app — tab state is driven by the URL */}
      <Route path="/" element={<App />} />
      <Route path="/picks" element={<App />} />
      <Route path="/picks/:filter" element={<App />} />
      <Route path="/parlays" element={<App />} />
      <Route path="/games" element={<App />} />
      <Route path="/games/:sub" element={<App />} />
      <Route path="/record" element={<App />} />
      <Route path="/record/:strategy" element={<App />} />

      {/* Custom strategy builder */}
      <Route path="/strategy-builder" element={<StrategyBuilder />} />
      <Route path="/strategy-builder/:id" element={<StrategyBuilder />} />

      {/* Interactive book shop — live odds side by side */}
      <Route path="/shop" element={<ShopPage />} />

      {/* Home run prop hunter */}
      <Route path="/homeruns" element={<HomeRunsPage />} />

      {/* SEO landing pages */}
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
