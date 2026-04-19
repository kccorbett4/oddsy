// Schematic baseball field with live wind overlay.
// The diamond is always oriented plate-at-bottom, center-field-up. The
// wind arrow rotates to show direction relative to CF, and a compass
// rose in the corner shows how the park actually points on earth.
//
// Color key: green = tailwind (helps HRs), red = headwind (kills them),
// amber = crosswind (neutral to slightly negative). Dome/indoor games
// render a closed-roof stylization with a "no wind effect" note.

function tailwindComponent(windDirDeg, windMph, cfBearingDeg) {
  if (windDirDeg == null || windMph == null || cfBearingDeg == null) return 0;
  const blowingToward = (windDirDeg + 180) % 360;
  const diff = ((blowingToward - cfBearingDeg + 540) % 360) - 180;
  return windMph * Math.cos((diff * Math.PI) / 180);
}

function windAngleRelativeToCF(windDirDeg, cfBearingDeg) {
  // Returns 0-360 deg. 0 = blowing straight to CF (up on diagram).
  // 180 = blowing straight to home (down). 90 = blowing right-to-left.
  const blowingToward = (windDirDeg + 180) % 360;
  return ((blowingToward - cfBearingDeg) + 360) % 360;
}

export default function StadiumWindSvg({ weather, park, outdoor }) {
  const indoor = outdoor === false;
  const W = 260, H = 260;
  const cx = W / 2, cy = H / 2 + 40;  // home plate anchor
  const arcRadius = 150;

  const wind = !indoor && weather && weather.windDirDeg != null && weather.windMph != null && park?.cfBearing != null
    ? {
        mph: weather.windMph,
        relAngle: windAngleRelativeToCF(weather.windDirDeg, park.cfBearing),
        component: tailwindComponent(weather.windDirDeg, weather.windMph, park.cfBearing),
      }
    : null;

  const windColor = (() => {
    if (!wind) return "#94a3b8";
    if (wind.component > 3) return "#10b981";   // tailwind >3 mph
    if (wind.component < -3) return "#ef4444";  // headwind
    return "#f59e0b";                            // crosswind
  })();

  const windLabel = (() => {
    if (indoor) return "Indoor — weather neutral";
    if (!wind) return "No wind data";
    const c = wind.component;
    if (c > 8) return `${wind.mph.toFixed(0)} mph blowing OUT to CF — big HR boost`;
    if (c > 3) return `${wind.mph.toFixed(0)} mph tailwind toward CF — modest HR boost`;
    if (c < -8) return `${wind.mph.toFixed(0)} mph blowing IN — HRs get knocked down`;
    if (c < -3) return `${wind.mph.toFixed(0)} mph headwind — slight HR penalty`;
    return `${wind.mph.toFixed(0)} mph crosswind — neutral for HRs`;
  })();

  // Wind arrow: we draw it from the outside of the field toward the
  // point where the wind is blowing toward, across the plate. Length
  // scales with mph.
  const windArrow = wind ? (() => {
    const angle = wind.relAngle; // 0 = up (toward CF from plate's perspective)
    // In SVG, 0° is east by default. We want 0° = up (north on the diagram).
    // Convert: x = sin(angle), y = -cos(angle). Angle in radians.
    const rad = (angle * Math.PI) / 180;
    const lenScale = Math.min(90, 30 + wind.mph * 3);
    const tipX = cx + Math.sin(rad) * lenScale * 0.55;
    const tipY = cy - Math.cos(rad) * lenScale * 0.55;
    const tailX = cx - Math.sin(rad) * lenScale * 0.45;
    const tailY = cy + Math.cos(rad) * lenScale * 0.45;
    return { tipX, tipY, tailX, tailY, lenScale };
  })() : null;

  return (
    <div style={{ background: "#0f172a", borderRadius: 10, padding: "12px 12px 10px" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto" style={{ maxWidth: 280, display: "block", margin: "0 auto" }}>
        {/* outfield grass */}
        <path
          d={`M ${cx} ${cy} L ${cx - arcRadius} ${cy - arcRadius} A ${arcRadius} ${arcRadius} 0 0 1 ${cx + arcRadius} ${cy - arcRadius} Z`}
          fill={indoor ? "#475569" : "#14532d"}
          stroke="#064e3b"
          strokeWidth="1"
        />
        {/* infield dirt triangle */}
        <path
          d={`M ${cx} ${cy} L ${cx - 55} ${cy - 55} L ${cx} ${cy - 78} L ${cx + 55} ${cy - 55} Z`}
          fill={indoor ? "#64748b" : "#b45309"}
          stroke={indoor ? "#334155" : "#78350f"}
          strokeWidth="1"
        />
        {/* bases */}
        <rect x={cx - 4} y={cy - 82} width="8" height="8" fill="#fff" transform={`rotate(45 ${cx} ${cy - 78})`} />
        <rect x={cx - 59} y={cy - 59} width="8" height="8" fill="#fff" transform={`rotate(45 ${cx - 55} ${cy - 55})`} />
        <rect x={cx + 51} y={cy - 59} width="8" height="8" fill="#fff" transform={`rotate(45 ${cx + 55} ${cy - 55})`} />
        {/* home plate */}
        <polygon points={`${cx - 6},${cy} ${cx + 6},${cy} ${cx + 6},${cy - 6} ${cx},${cy - 12} ${cx - 6},${cy - 6}`} fill="#fff" />

        {/* foul lines */}
        <line x1={cx} y1={cy} x2={cx - arcRadius * 0.95} y2={cy - arcRadius * 0.95} stroke="#fff" strokeWidth="0.8" />
        <line x1={cx} y1={cy} x2={cx + arcRadius * 0.95} y2={cy - arcRadius * 0.95} stroke="#fff" strokeWidth="0.8" />

        {/* CF label */}
        <text x={cx} y={cy - arcRadius - 6} textAnchor="middle" fontSize="10" fontWeight="700" fill="#94a3b8">CF</text>
        <text x={cx - arcRadius + 4} y={cy - arcRadius + 4} fontSize="9" fill="#94a3b8">LF</text>
        <text x={cx + arcRadius - 16} y={cy - arcRadius + 4} fontSize="9" fill="#94a3b8">RF</text>

        {/* dome roof overlay */}
        {indoor && (
          <g opacity="0.6">
            <path
              d={`M ${cx - arcRadius} ${cy - arcRadius} Q ${cx} ${cy - arcRadius - 40} ${cx + arcRadius} ${cy - arcRadius}`}
              stroke="#cbd5e1" strokeWidth="2" fill="none" strokeDasharray="4 3"
            />
            <text x={cx} y={cy - arcRadius - 22} textAnchor="middle" fontSize="8" fill="#cbd5e1" fontStyle="italic">roof</text>
          </g>
        )}

        {/* wind arrow */}
        {windArrow && (
          <g>
            <defs>
              <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto">
                <path d="M 0 0 L 6 3 L 0 6 z" fill={windColor} />
              </marker>
            </defs>
            <line
              x1={windArrow.tailX} y1={windArrow.tailY}
              x2={windArrow.tipX} y2={windArrow.tipY}
              stroke={windColor}
              strokeWidth={3 + Math.min(5, wind.mph / 6)}
              strokeLinecap="round"
              markerEnd="url(#arrowhead)"
              opacity="0.95"
            />
            <circle cx={windArrow.tailX} cy={windArrow.tailY} r="3" fill={windColor} />
          </g>
        )}

        {/* compass rose — small, in corner */}
        <g transform={`translate(${W - 32}, 28)`}>
          <circle cx="0" cy="0" r="18" fill="#1e293b" stroke="#334155" strokeWidth="1" />
          {park?.cfBearing != null && (
            <g transform={`rotate(${park.cfBearing})`}>
              <line x1="0" y1="0" x2="0" y2="-14" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
              <polygon points="-3,-11 3,-11 0,-16" fill="#fbbf24" />
            </g>
          )}
          <text x="0" y="-19" textAnchor="middle" fontSize="7" fill="#94a3b8" fontWeight="700">N</text>
          <text x="0" y="3" textAnchor="middle" fontSize="6" fill="#cbd5e1">CF→</text>
        </g>
      </svg>
      <div style={{
        textAlign: "center", fontSize: 11, fontWeight: 700,
        color: windColor, marginTop: 8, lineHeight: 1.4,
      }}>
        {windLabel}
      </div>
      {wind && !indoor && (
        <div style={{
          display: "flex", justifyContent: "center", gap: 10, marginTop: 4,
          fontSize: 10, color: "#94a3b8",
        }}>
          <span>to-CF: {wind.component >= 0 ? "+" : ""}{wind.component.toFixed(1)} mph</span>
          {park?.cfBearing != null && <span>park CF: {park.cfBearing}°</span>}
        </div>
      )}
    </div>
  );
}
