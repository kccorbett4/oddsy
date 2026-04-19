// MLB ballpark data for HR modeling.
//
// `hrFactor` — 3-yr rolling HR park factor (1.00 = league average).
// Sourced from Statcast / FanGraphs park factors, 2022-2024 average.
// A factor of 1.20 means the park yields 20% more HRs than neutral.
//
// `cfBearing` — compass bearing (degrees, 0=N, 90=E) from home plate
// toward dead center field. Used with wind direction to compute the
// tailwind/headwind-to-CF component. Outfield HRs concentrate in a ~60°
// arc centered on CF, so this is the axis that matters most.
//
// `outdoor` — true if games are played open-air (weather applies).
// Retractable roofs are marked `true` because they're usually open
// except in extreme weather; the ones we mark `false` are true domes
// or almost always closed (Tropicana, Rogers Centre in playoffs, etc.).
export const MLB_PARKS = {
  "Arizona Diamondbacks":  { lat: 33.45, lon: -112.07, outdoor: false, hrFactor: 1.02, cfBearing: 20 },
  "Atlanta Braves":        { lat: 33.89, lon: -84.47,  outdoor: true,  hrFactor: 0.99, cfBearing: 45 },
  "Baltimore Orioles":     { lat: 39.28, lon: -76.62,  outdoor: true,  hrFactor: 0.95, cfBearing: 350 },
  "Boston Red Sox":        { lat: 42.35, lon: -71.10,  outdoor: true,  hrFactor: 1.06, cfBearing: 45 },
  "Chicago Cubs":          { lat: 41.95, lon: -87.66,  outdoor: true,  hrFactor: 1.05, cfBearing: 20 },
  "Chicago White Sox":     { lat: 41.83, lon: -87.63,  outdoor: true,  hrFactor: 1.02, cfBearing: 30 },
  "Cincinnati Reds":       { lat: 39.10, lon: -84.51,  outdoor: true,  hrFactor: 1.18, cfBearing: 140 },
  "Cleveland Guardians":   { lat: 41.50, lon: -81.69,  outdoor: true,  hrFactor: 0.98, cfBearing: 20 },
  "Colorado Rockies":      { lat: 39.76, lon: -104.99, outdoor: true,  hrFactor: 1.26, cfBearing: 0  },
  "Detroit Tigers":        { lat: 42.34, lon: -83.05,  outdoor: true,  hrFactor: 0.92, cfBearing: 15 },
  "Houston Astros":        { lat: 29.76, lon: -95.36,  outdoor: false, hrFactor: 1.03, cfBearing: 0  },
  "Kansas City Royals":    { lat: 39.05, lon: -94.48,  outdoor: true,  hrFactor: 0.91, cfBearing: 15 },
  "Los Angeles Angels":    { lat: 33.80, lon: -117.88, outdoor: true,  hrFactor: 1.00, cfBearing: 0  },
  "Los Angeles Dodgers":   { lat: 34.07, lon: -118.24, outdoor: true,  hrFactor: 1.04, cfBearing: 20 },
  "Miami Marlins":         { lat: 25.78, lon: -80.22,  outdoor: false, hrFactor: 0.87, cfBearing: 0  },
  "Milwaukee Brewers":     { lat: 43.03, lon: -87.97,  outdoor: false, hrFactor: 1.00, cfBearing: 10 },
  "Minnesota Twins":       { lat: 44.98, lon: -93.28,  outdoor: true,  hrFactor: 0.97, cfBearing: 100 },
  "New York Mets":         { lat: 40.76, lon: -73.85,  outdoor: true,  hrFactor: 0.92, cfBearing: 0  },
  "New York Yankees":      { lat: 40.83, lon: -73.93,  outdoor: true,  hrFactor: 1.11, cfBearing: 30 },
  "Oakland Athletics":     { lat: 37.75, lon: -122.20, outdoor: true,  hrFactor: 0.91, cfBearing: 30 },
  "Philadelphia Phillies": { lat: 39.91, lon: -75.17,  outdoor: true,  hrFactor: 1.10, cfBearing: 85 },
  "Pittsburgh Pirates":    { lat: 40.45, lon: -80.01,  outdoor: true,  hrFactor: 0.96, cfBearing: 100 },
  "San Diego Padres":      { lat: 32.71, lon: -117.16, outdoor: true,  hrFactor: 0.92, cfBearing: 30 },
  "San Francisco Giants":  { lat: 37.78, lon: -122.39, outdoor: true,  hrFactor: 0.75, cfBearing: 100 },
  "Seattle Mariners":      { lat: 47.59, lon: -122.33, outdoor: false, hrFactor: 0.92, cfBearing: 45 },
  "St. Louis Cardinals":   { lat: 38.62, lon: -90.19,  outdoor: true,  hrFactor: 0.97, cfBearing: 0  },
  "Tampa Bay Rays":        { lat: 27.77, lon: -82.65,  outdoor: false, hrFactor: 0.88, cfBearing: 70 },
  "Texas Rangers":         { lat: 32.75, lon: -97.08,  outdoor: false, hrFactor: 1.07, cfBearing: 20 },
  "Toronto Blue Jays":     { lat: 43.64, lon: -79.39,  outdoor: false, hrFactor: 1.00, cfBearing: 5  },
  "Washington Nationals":  { lat: 38.87, lon: -77.01,  outdoor: true,  hrFactor: 0.97, cfBearing: 65 },
};

export function parkFor(homeTeam) {
  return MLB_PARKS[homeTeam] || null;
}

// Expected plate appearances by batting order position (1-9), based on
// league-wide averages. Leadoff batter gets ~1 PA more per game than
// the #9 hitter — that's a 25% multiplier on game-level HR probability.
export const PA_BY_LINEUP = {
  1: 4.65, 2: 4.55, 3: 4.45, 4: 4.35, 5: 4.25,
  6: 4.15, 7: 4.05, 8: 3.95, 9: 3.80,
};
export const AVG_PA = 4.25;
