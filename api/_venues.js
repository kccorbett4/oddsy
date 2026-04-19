// NFL stadium coordinates. Teams in domed/retractable-roof stadiums are
// marked outdoor:false — weather filters should skip them since conditions
// don't affect play. Approximate lat/lon (city-accurate, which is fine for
// Open-Meteo's 10km grid resolution).
export const NFL_VENUES = {
  "Arizona Cardinals":    { lat: 33.53, lon: -112.26, outdoor: false },
  "Atlanta Falcons":      { lat: 33.76, lon: -84.40,  outdoor: false },
  "Baltimore Ravens":     { lat: 39.28, lon: -76.62,  outdoor: true  },
  "Buffalo Bills":        { lat: 42.77, lon: -78.79,  outdoor: true  },
  "Carolina Panthers":    { lat: 35.23, lon: -80.85,  outdoor: true  },
  "Chicago Bears":        { lat: 41.86, lon: -87.62,  outdoor: true  },
  "Cincinnati Bengals":   { lat: 39.10, lon: -84.52,  outdoor: true  },
  "Cleveland Browns":     { lat: 41.51, lon: -81.70,  outdoor: true  },
  "Dallas Cowboys":       { lat: 32.75, lon: -97.09,  outdoor: false },
  "Denver Broncos":       { lat: 39.74, lon: -105.02, outdoor: true  },
  "Detroit Lions":        { lat: 42.34, lon: -83.05,  outdoor: false },
  "Green Bay Packers":    { lat: 44.50, lon: -88.06,  outdoor: true  },
  "Houston Texans":       { lat: 29.68, lon: -95.41,  outdoor: false },
  "Indianapolis Colts":   { lat: 39.76, lon: -86.16,  outdoor: false },
  "Jacksonville Jaguars": { lat: 30.32, lon: -81.64,  outdoor: true  },
  "Kansas City Chiefs":   { lat: 39.05, lon: -94.48,  outdoor: true  },
  "Las Vegas Raiders":    { lat: 36.09, lon: -115.18, outdoor: false },
  "Los Angeles Chargers": { lat: 33.95, lon: -118.34, outdoor: false },
  "Los Angeles Rams":     { lat: 33.95, lon: -118.34, outdoor: false },
  "Miami Dolphins":       { lat: 25.96, lon: -80.24,  outdoor: true  },
  "Minnesota Vikings":    { lat: 44.97, lon: -93.26,  outdoor: false },
  "New England Patriots": { lat: 42.09, lon: -71.26,  outdoor: true  },
  "New Orleans Saints":   { lat: 29.95, lon: -90.08,  outdoor: false },
  "New York Giants":      { lat: 40.81, lon: -74.07,  outdoor: true  },
  "New York Jets":        { lat: 40.81, lon: -74.07,  outdoor: true  },
  "Philadelphia Eagles":  { lat: 39.90, lon: -75.17,  outdoor: true  },
  "Pittsburgh Steelers":  { lat: 40.45, lon: -80.02,  outdoor: true  },
  "San Francisco 49ers":  { lat: 37.40, lon: -121.97, outdoor: true  },
  "Seattle Seahawks":     { lat: 47.60, lon: -122.33, outdoor: true  },
  "Tampa Bay Buccaneers": { lat: 27.98, lon: -82.50,  outdoor: true  },
  "Tennessee Titans":     { lat: 36.17, lon: -86.77,  outdoor: true  },
  "Washington Commanders":{ lat: 38.91, lon: -76.86,  outdoor: true  },
};

// MLB stadium coordinates (subset with outdoor flag).
export const MLB_VENUES = {
  "Arizona Diamondbacks": { lat: 33.45, lon: -112.07, outdoor: false },
  "Atlanta Braves":       { lat: 33.89, lon: -84.47,  outdoor: true  },
  "Baltimore Orioles":    { lat: 39.28, lon: -76.62,  outdoor: true  },
  "Boston Red Sox":       { lat: 42.35, lon: -71.10,  outdoor: true  },
  "Chicago Cubs":         { lat: 41.95, lon: -87.66,  outdoor: true  },
  "Chicago White Sox":    { lat: 41.83, lon: -87.63,  outdoor: true  },
  "Cincinnati Reds":      { lat: 39.10, lon: -84.51,  outdoor: true  },
  "Cleveland Guardians":  { lat: 41.50, lon: -81.69,  outdoor: true  },
  "Colorado Rockies":     { lat: 39.76, lon: -104.99, outdoor: true  },
  "Detroit Tigers":       { lat: 42.34, lon: -83.05,  outdoor: true  },
  "Houston Astros":       { lat: 29.76, lon: -95.36,  outdoor: false },
  "Kansas City Royals":   { lat: 39.05, lon: -94.48,  outdoor: true  },
  "Los Angeles Angels":   { lat: 33.80, lon: -117.88, outdoor: true  },
  "Los Angeles Dodgers":  { lat: 34.07, lon: -118.24, outdoor: true  },
  "Miami Marlins":        { lat: 25.78, lon: -80.22,  outdoor: false },
  "Milwaukee Brewers":    { lat: 43.03, lon: -87.97,  outdoor: false },
  "Minnesota Twins":      { lat: 44.98, lon: -93.28,  outdoor: true  },
  "New York Mets":        { lat: 40.76, lon: -73.85,  outdoor: true  },
  "New York Yankees":     { lat: 40.83, lon: -73.93,  outdoor: true  },
  "Oakland Athletics":    { lat: 37.75, lon: -122.20, outdoor: true  },
  "Philadelphia Phillies":{ lat: 39.91, lon: -75.17,  outdoor: true  },
  "Pittsburgh Pirates":   { lat: 40.45, lon: -80.01,  outdoor: true  },
  "San Diego Padres":     { lat: 32.71, lon: -117.16, outdoor: true  },
  "San Francisco Giants": { lat: 37.78, lon: -122.39, outdoor: true  },
  "Seattle Mariners":     { lat: 47.59, lon: -122.33, outdoor: false },
  "St. Louis Cardinals":  { lat: 38.62, lon: -90.19,  outdoor: true  },
  "Tampa Bay Rays":       { lat: 27.77, lon: -82.65,  outdoor: false },
  "Texas Rangers":        { lat: 32.75, lon: -97.08,  outdoor: false },
  "Toronto Blue Jays":    { lat: 43.64, lon: -79.39,  outdoor: false },
  "Washington Nationals": { lat: 38.87, lon: -77.01,  outdoor: true  },
};

// Look up home venue for a game. Returns {lat, lon, outdoor} or null.
export function venueFor(sportKey, homeTeam) {
  if (sportKey === "americanfootball_nfl") return NFL_VENUES[homeTeam] || null;
  if (sportKey === "baseball_mlb") return MLB_VENUES[homeTeam] || null;
  return null;
}
