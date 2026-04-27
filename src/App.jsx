import React, { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, onValue, ref, set, update } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCLsaaD5pyRzk0YDfIuHt4f9l4ol0lzd2A",
  authDomain: "yiss-es-field-day.firebaseapp.com",
  databaseURL: "https://yiss-es-field-day-default-rtdb.firebaseio.com",
  projectId: "yiss-es-field-day",
  storageBucket: "yiss-es-field-day.firebasestorage.app",
  messagingSenderId: "39796709358",
  appId: "1:39796709358:web:4c518e203a722c1422a0ff",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getDatabase(app);
const EVENT_PATH = "events/default";

const TEAM_FLAGS = {
  green: "/greengators-flag.jpg",
  blue: "/bluesharks-flag.jpg",
  yellow: "/yellowhornets-flag.jpg",
  orange: "/orangetigers-flag.jpg",
};

const teams = [
  { id: "green", name: "Green Gators", color: "#16a34a", flag: TEAM_FLAGS.green },
  { id: "blue", name: "Blue Sharks", color: "#2563eb", flag: TEAM_FLAGS.blue },
  { id: "yellow", name: "Yellow Hornets", color: "#ca8a04", flag: TEAM_FLAGS.yellow },
  { id: "orange", name: "Orange Tigers", color: "#ea580c", flag: TEAM_FLAGS.orange },
];

const STATION_COUNT = 24;
const ROUND_COUNT = 12;
const ADMIN_PASSCODE = "2468";
const places = ["1st", "2nd", "3rd", "4th"];

function fmtTime(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  } catch {
    return "—";
  }
}

function teamName(id) {
  return teams.find((t) => t.id === id)?.name || "";
}

function TeamLabel({ teamId, dark = false }) {
  const team = teams.find((t) => t.id === teamId);
  if (!team) return <span>Unknown</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <img
        src={team.flag}
        alt={team.name}
        style={{
          width: 30,
          height: 20,
          objectFit: "cover",
          borderRadius: 4,
          border: dark ? "1px solid rgba(255,255,255,0.25)" : "1px solid rgba(15,23,42,0.12)",
        }}
      />
      <span>{team.name}</span>
    </span>
  );
}

function SummaryCard({ title, value, subvalue, color = "#f8fafc", dark = false, flash = false }) {
  return (
    <div
      style={{
        border: dark ? "1px solid #334155" : "1px solid #e5e7eb",
        borderRadius: 14,
        padding: 16,
        background: color,
        color: dark ? "#f8fafc" : "#0f172a",
        animation: flash ? "timerFlash 1s infinite" : "none",
      }}
    >
      <div style={{ fontSize: 13, color: dark ? "#94a3b8" : "#475569", marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 800 }}>{value}</div>
      {subvalue ? <div style={{ fontSize: 13, color: dark ? "#cbd5e1" : "#64748b", marginTop: 4 }}>{subvalue}</div> : null}
    </div>
  );
}

function createRoundData() {
  return { "1st": "", "2nd": "", "3rd": "", "4th": "", submitted: false };
}

function createInitialEvent() {
  const stations = {};
  for (let s = 1; s <= STATION_COUNT; s++) {
    const rounds = {};
    for (let r = 1; r <= ROUND_COUNT; r++) {
      rounds[r] = createRoundData();
    }
    stations[s] = {
      rounds,
      lastTouchedAt: null,
      lastSubmittedAt: null,
    };
  }
  return {
    currentRound: 1,
    lockedRounds: [],
    pauseEvent: false,
    timerDurationMinutes: 8,
    timerEndsAt: null,
    placePoints: { "1st": 4, "2nd": 3, "3rd": 2, "4th": 1 },
    bonuses: { green: 0, blue: 0, yellow: 0, orange: 0 },
    lastSubmission: null,
    history: [],
    stations,
  };
}

function availableTeamsForPlace(roundData, currentPlace) {
  const used = new Set(
    places
      .filter((p) => p !== currentPlace)
      .map((p) => roundData[p])
      .filter(Boolean)
  );
  return teams.filter((t) => !used.has(t.id) || roundData[currentPlace] === t.id);
}

function toCSV(rows) {
  return rows
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

function downloadText(filename, text, type = "text/csv;charset=utf-8;") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function FieldDayApp() {
  const [eventData, setEventData] = useState(null);
  const [adminPasscode, setAdminPasscode] = useState("");
  const [view, setView] = useState("station");
  const [stationId, setStationId] = useState(1);
  const [selectedAdminStation, setSelectedAdminStation] = useState(1);
  const [backfillRound, setBackfillRound] = useState(1);
  const [backfillStation, setBackfillStation] = useState(1);
  const [penaltyValue, setPenaltyValue] = useState(1);
  const [copiedLink, setCopiedLink] = useState("");
  const [submitFlash, setSubmitFlash] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [showAdmin, setShowAdmin] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
  const eventRef = ref(db, EVENT_PATH);
  const unsubscribe = onValue(eventRef, (snapshot) => {
    const value = snapshot.val();
    if (!value) {
      set(eventRef, createInitialEvent());
    } else {
      const base = createInitialEvent();
      setEventData({
        ...base,
        ...value,
        lockedRounds: value.lockedRounds || [],
        history: value.history || [],
        bonuses: { ...base.bonuses, ...(value.bonuses || {}) },
        placePoints: { ...base.placePoints, ...(value.placePoints || {}) },
        stations: value.stations || base.stations,
      });
    }
  });
  return () => unsubscribe();
}, []);

  const safeEventData = eventData || createInitialEvent();
const currentRound = safeEventData.currentRound || 1;
const roundLocked = (safeEventData.lockedRounds || []).includes(currentRound);
const currentValues =
  safeEventData.stations?.[stationId]?.rounds?.[currentRound] ||
  { "1st": "", "2nd": "", "3rd": "", "4th": "", submitted: false };
const stationComplete = places.every((p) => currentValues[p] !== "");
const stationSubmitted = currentValues.submitted;
const timerRemainingMs = safeEventData.timerEndsAt ? Math.max(0, safeEventData.timerEndsAt - now) : null;
const timerText =
  timerRemainingMs == null
    ? "No timer running"
    : `${String(Math.floor(timerRemainingMs / 60000)).padStart(2, "0")}:${String(
        Math.floor((timerRemainingMs % 60000) / 1000)
      ).padStart(2, "0")}`;

  const statusData = Array.from({ length: STATION_COUNT }, (_, i) => {
    const stationNumber = i + 1;
    const roundData = safeEventData.stations[stationNumber].rounds[currentRound];
    const hasAny = places.some((p) => !!roundData[p]);
    const submitted = roundData.submitted;
    const status = submitted ? "submitted" : hasAny ? "in_progress" : "not_started";
    return {
      stationNumber,
      status,
      lastTouchedAt: safeEventData.stations[stationNumber].lastTouchedAt,
      lastSubmittedAt: safeEventData.stations[stationNumber].lastSubmittedAt,
    };
  });

  const totals = useMemo(() => {
    const result = { green: 0, blue: 0, yellow: 0, orange: 0 };
    for (let s = 1; s <= STATION_COUNT; s++) {
      for (let r = 1; r <= ROUND_COUNT; r++) {
        const roundData = safeEventData.stations[s].rounds[r];
        places.forEach((place) => {
          const teamId = roundData[place];
          if (teamId) result[teamId] += Number(safeEventData.placePoints[place] || 0);
        });
      }
    }
    teams.forEach((t) => {
      result[t.id] += Number(safeEventData.bonuses[t.id] || 0);
    });
    return result;
  }, [safeEventData]);

  const ranking = useMemo(() => {
    return [...teams].map((t) => ({ ...t, total: totals[t.id] })).sort((a, b) => b.total - a.total);
  }, [totals]);

  const rankingMovement = useMemo(() => {
    const movement = {};
    ranking.forEach((t, idx) => {
      movement[t.id] = idx === 0 ? 0 : ranking[idx - 1].total === t.total ? 0 : 0;
    });
    return movement;
  }, [ranking]);

  const projectedWinner = ranking[0];
  const projectedLead = ranking.length > 1 ? ranking[0].total - ranking[1].total : 0;
  const remainingRounds = ROUND_COUNT - currentRound + 1;
  const perRoundMax = Math.max(...places.map((p) => Number(safeEventData.placePoints[p] || 0)));
  const maxRemainingPerTeam = STATION_COUNT * remainingRounds * perRoundMax;
  const stationDetail = safeEventData.stations[selectedAdminStation].rounds[currentRound];

  function addHistory(message, nextHistory) {
    const history = nextHistory || safeEventData.history || [];
    return [{ at: Date.now(), message }, ...history].slice(0, 200);
  }

  function missingStations() {
    const missing = [];
    for (let s = 1; s <= STATION_COUNT; s++) {
      const roundData = safeEventData.stations[s].rounds[currentRound];
      const complete = places.every((p) => roundData[p] !== "") && roundData.submitted;
      if (!complete) missing.push(s);
    }
    return missing;
  }

  function assignTeamToPlace(place, teamId, targetStationId = stationId, targetRound = currentRound) {
    const isAdminEditing = view === "admin";
   if (safeEventData.pauseEvent && !isAdminEditing) return;
if ((safeEventData.lockedRounds || []).includes(targetRound) && !isAdminEditing) return;

    const currentRoundData = safeEventData.stations[targetStationId].rounds[targetRound];
    const nextRoundData = { ...currentRoundData };
    places.forEach((p) => {
      if (p !== place && nextRoundData[p] === teamId) nextRoundData[p] = "";
    });
    nextRoundData[place] = teamId;
    if (!isAdminEditing || targetRound === safeEventData.currentRound) nextRoundData.submitted = false;

    update(ref(db), {
      [`${EVENT_PATH}/stations/${targetStationId}/rounds/${targetRound}`]: nextRoundData,
      [`${EVENT_PATH}/stations/${targetStationId}/lastTouchedAt`]: Date.now(),
    });
  }

  function submitScores() {
    if (!stationComplete || roundLocked || safeEventData.pauseEvent) return;
    update(ref(db), {
      [`${EVENT_PATH}/stations/${stationId}/rounds/${currentRound}/submitted`]: true,
      [`${EVENT_PATH}/stations/${stationId}/lastSubmittedAt`]: Date.now(),
      [`${EVENT_PATH}/lastSubmission`]: { stationId, round: currentRound, at: Date.now() },
      [`${EVENT_PATH}/history`]: addHistory(`Station ${stationId} submitted Round ${currentRound}`),
    });
    setSubmitFlash(true);
    window.setTimeout(() => setSubmitFlash(false), 1200);
  }

  function unlockAdmin() {
    if (adminPasscode !== ADMIN_PASSCODE) return;
    setShowAdmin(true);
    setView("admin");
    setAdminPasscode("");
  }

  function advanceRound(force = false) {
    if (currentRound >= ROUND_COUNT) return;
    const missing = missingStations();
    if (!force && missing.length > 0) {
      window.alert(`Cannot advance yet. Missing stations: ${missing.map((n) => `Station ${n}`).join(", ")}`);
      return;
    }
    const nextLocked = (safeEventData.lockedRounds || []).includes(currentRound)
  ? safeEventData.lockedRounds
  : [...(safeEventData.lockedRounds || []), currentRound];
    update(ref(db), {
      [`${EVENT_PATH}/lockedRounds`]: nextLocked,
      [`${EVENT_PATH}/currentRound`]: currentRound + 1,
      [`${EVENT_PATH}/timerEndsAt`]: null,
      [`${EVENT_PATH}/history`]: addHistory(`${force ? "Force advanced" : "Advanced"} to Round ${currentRound + 1}`),
    });
  }

  function togglePause() {
    update(ref(db), {
      [`${EVENT_PATH}/pauseEvent`]: !safeEventData.pauseEvent,
      [`${EVENT_PATH}/history`]: addHistory(safeEventData.pauseEvent ? "Event resumed" : "Event paused"),
    });
  }

  function startTimer() {
    update(ref(db), {
      [`${EVENT_PATH}/timerEndsAt`]: Date.now() + Number(safeEventData.timerDurationMinutes || 0) * 60000,
      [`${EVENT_PATH}/history`]: addHistory(`Started ${safeEventData.timerDurationMinutes}-minute round timer`),
    });
  }

  function stopTimer() {
    function resetFieldDay() {
  const confirmed = window.confirm(
    "Are you sure you want to reset Field Day?\n\nThis will erase all scores and restart at Round 1."
  );

  if (!confirmed) return;

  set(ref(db, EVENT_PATH), createInitialEvent());
}

function endFieldDay() {
  const confirmed = window.confirm(
    "Are you sure you want to end Field Day?\n\nScoring will be locked and the timer will stop."
  );

  if (!confirmed) return;

  update(ref(db, EVENT_PATH), {
    pauseEvent: true,
    timerEndsAt: null,
    lockedRounds: [],
  });
}
    update(ref(db), {
      [`${EVENT_PATH}/timerEndsAt`]: null,
      [`${EVENT_PATH}/history`]: addHistory("Stopped round timer"),
    });
  }

  function editLastSubmission() {
    if (!safeEventData.lastSubmission) return;
    const { stationId: sId, round } = safeEventData.lastSubmission;
    update(ref(db), {
      [`${EVENT_PATH}/stations/${sId}/rounds/${round}/submitted`]: false,
      [`${EVENT_PATH}/history`]: addHistory(`Reopened Station ${sId}, Round ${round}`),
    });
    setView("admin");
    setSelectedAdminStation(sId);
    setBackfillStation(sId);
    setBackfillRound(round);
  }

  function exportCSV() {
    const rows = [["Station", "Round", "1st", "2nd", "3rd", "4th", "Submitted"]];
    for (let s = 1; s <= STATION_COUNT; s++) {
      for (let r = 1; r <= ROUND_COUNT; r++) {
        const d = safeEventData.stations[s].rounds[r];
        rows.push([s, r, teamName(d["1st"]), teamName(d["2nd"]), teamName(d["3rd"]), teamName(d["4th"]), d.submitted ? "Yes" : "No"]);
      }
    }
    rows.push([]);
    rows.push(["Team", "Total Points"]);
    ranking.forEach((r) => rows.push([r.name, r.total]));
    downloadText("field-day-results.csv", toCSV(rows));
  }

  function copyStationLink(stationNumber) {
    const link = `${window.location.origin}${window.location.pathname}?station=${stationNumber}`;
    navigator.clipboard?.writeText(link);
    setCopiedLink(`Station ${stationNumber}`);
    window.setTimeout(() => setCopiedLink(""), 1400);
  }

  function applyBonus(teamId, delta) {
    update(ref(db), {
      [`${EVENT_PATH}/bonuses/${teamId}`]: Number(safeEventData.bonuses[teamId] || 0) + delta,
      [`${EVENT_PATH}/history`]: addHistory(`${delta >= 0 ? "Added" : "Subtracted"} ${Math.abs(delta)} point(s) for ${teamName(teamId)}`),
    });
  }

  return (
  <div style={{ padding: 24, fontFamily: "sans-serif", maxWidth: 1260, margin: "0 auto", color: "#0f172a" }}>
    {!eventData ? (
      <div style={{ marginBottom: 16, padding: 16, borderRadius: 12, background: "#eff6ff", border: "1px solid #bfdbfe" }}>
        Loading live Field Day data...
      </div>
    ) : null}

      <style>{`
        @keyframes timerFlash {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.2); }
          50% { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0.35); }
        }
        button {
          background-color: #334155;
          color: white;
          font-weight: 700;
          border: none;
        }
        button:hover:not(:disabled) {
          background-color: #1e293b;
        }
        button:disabled {
          background-color: #94a3b8;
          color: white;
          opacity: 0.7;
          cursor: not-allowed;
        }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Field Day Scoring</h1>
          <div style={{ color: "#64748b", marginTop: 6 }}>Round {currentRound} of {ROUND_COUNT}</div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => setView("station")} style={{ padding: "10px 14px", borderRadius: 10 }}>Station View</button>
          {showAdmin ? <button onClick={() => setView("admin")} style={{ padding: "10px 14px", borderRadius: 10 }}>Admin Board</button> : null}
        </div>
      </div>

      {safeEventData.pauseEvent ? (
        <div style={{ marginBottom: 16, padding: 16, borderRadius: 14, background: "#fee2e2", border: "1px solid #fecaca", fontWeight: 800 }}>
          Event paused by administrator. Scoring is temporarily locked.
        </div>
      ) : null}

      <div style={{ marginBottom: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <SummaryCard title="Current Round Timer" value={timerText} subvalue={safeEventData.timerEndsAt ? `Ends ${fmtTime(safeEventData.timerEndsAt)}` : "Start from Admin Board"} flash={timerRemainingMs === 0 && !!eventData.timerEndsAt} color={timerRemainingMs === 0 && !!eventData.timerEndsAt ? "#fee2e2" : "#f8fafc"} />
        <SummaryCard title="Stations Submitted" value={`${statusData.filter((s) => s.status === "submitted").length}/${STATION_COUNT}`} subvalue="current round" />
        <SummaryCard title="Stations Missing" value={missingStations().length} subvalue={missingStations().length ? missingStations().map((n) => `S${n}`).join(", ") : "none"} />
        <SummaryCard title="Projected Winner" value={projectedWinner ? <TeamLabel teamId={projectedWinner.id} /> : "—"} subvalue={`Lead: ${projectedLead} • Max remaining/team: ${maxRemainingPerTeam}`} />
      </div>

      {view === "station" ? (
        <div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
            <label>
              <strong>Station:</strong>{" "}
              <select value={stationId} onChange={(e) => setStationId(Number(e.target.value))} style={{ padding: 8, borderRadius: 8 }}>
                {Array.from({ length: STATION_COUNT }, (_, i) => <option key={i + 1} value={i + 1}>Station {i + 1}</option>)}
              </select>
            </label>
            <div><strong>Status:</strong> {roundLocked ? "Locked" : stationSubmitted ? "Submitted" : "Open"}</div>
            <div><strong>Autosave:</strong> Live</div>
          </div>

          <div style={{ border: "1px solid #ddd", borderRadius: 14, padding: 20 }}>
            <h2 style={{ marginTop: 0 }}>Station {stationId} Entry</h2>
            <p>Choose one team for each place. Once a team is assigned, it disappears from the other place options.</p>
            <div style={{ display: "grid", gap: 16 }}>
              {places.map((place) => {
                const options = availableTeamsForPlace(currentValues, place);
                return (
                  <div key={place} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
                    <div style={{ fontWeight: 800, marginBottom: 10 }}>{place} Place</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {options.map((team) => {
                        const selected = currentValues[place] === team.id;
                        return (
                          <button
                            type="button"
                            key={team.id}
                            disabled={roundLocked || safeEventData.pauseEvent}
                            onClick={() => assignTeamToPlace(place, team.id)}
                            style={{
                              padding: "12px 14px",
                              borderRadius: 12,
                              background: team.color,
                              color: team.id === "yellow" ? "#111827" : "white",
                              border: selected ? "3px solid #ffffff" : "1px solid #334155",
                              boxShadow: selected ? `0 0 0 3px ${team.color}55` : "none",
                              minWidth: 220,
                              textAlign: "left",
                              cursor: roundLocked || safeEventData.pauseEvent ? "not-allowed" : "pointer",
                              fontWeight: 800,
                            }}
                          >
                            <TeamLabel teamId={team.id} dark />
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ marginTop: 8, color: "#475569" }}>
                      Selected: {currentValues[place] ? <TeamLabel teamId={currentValues[place]} /> : "None"}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 18, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <button
                onClick={submitScores}
                disabled={!stationComplete || roundLocked || safeEventData.pauseEvent}
                style={{
                  padding: "14px 20px",
                  borderRadius: 12,
                  background: submitFlash ? "#15803d" : !stationComplete || roundLocked || safeEventData.pauseEvent ? "#94a3b8" : "#16a34a",
                  color: "white",
                  fontWeight: 800,
                  cursor: !stationComplete || roundLocked || safeEventData.pauseEvent ? "not-allowed" : "pointer",
                  boxShadow: submitFlash ? "0 0 0 4px rgba(34,197,94,0.25)" : "none",
                  transform: submitFlash ? "scale(1.03)" : "scale(1)",
                  transition: "all 180ms ease",
                }}
              >
                {submitFlash ? "✅ Submitted" : "📝 Submit Scores"}
              </button>
              <div>
                {roundLocked ? "This round has been locked by the admin." : stationSubmitted ? `Scores submitted at ${fmtTime(safeEventData.stations[stationId].lastSubmittedAt)}.` : stationComplete ? "All places selected. Press Submit Scores." : "Choose one team for each place."}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {!showAdmin && view !== "scoreboard" ? (
        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 20, marginTop: 16, marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Admin Access</h2>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="password"
              placeholder="Enter admin passcode"
              value={adminPasscode}
              onChange={(e) => setAdminPasscode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") unlockAdmin();
              }}
              style={{ padding: 10, borderRadius: 8, border: "1px solid #cbd5e1" }}
            />
            <button onClick={unlockAdmin} style={{ padding: "10px 14px", borderRadius: 10 }}>Open Admin Board</button>
          </div>
        </div>
      ) : null}

      {view === "scoreboard" && showAdmin ? (
        <div style={{ border: "1px solid #ddd", borderRadius: 14, padding: 20, background: "#0f172a", color: "white" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
            <h2 style={{ margin: 0 }}>Live Scoreboard</h2>
            <div style={{ fontWeight: 800 }}>Round {currentRound} • {timerText}</div>
          </div>
          <div style={{ display: "grid", gap: 16 }}>
            {ranking.map((team, idx) => (
              <div key={team.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 18, borderRadius: 16, background: idx === 0 ? `${team.color}33` : "#1e293b", border: `2px solid ${idx === 0 ? team.color : "transparent"}` }}>
                <div>
                  <div style={{ fontSize: 14, opacity: 0.8 }}>#{idx + 1}</div>
                  <div style={{ fontSize: 28, fontWeight: 900 }}><TeamLabel teamId={team.id} dark /></div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 36, fontWeight: 900 }}>{team.total}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {view === "admin" && showAdmin ? (
        <div style={{ display: "grid", gap: 18, background: "#020617", borderRadius: 20, padding: 20, color: "#f8fafc", border: "1px solid #1e293b" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            {ranking.map((t, idx) => (
              <SummaryCard key={t.id} title={`#${idx + 1} ${t.name}`} value={t.total} subvalue={rankingMovement[t.id] > 0 ? `Up ${rankingMovement[t.id]}` : rankingMovement[t.id] < 0 ? `Down ${Math.abs(rankingMovement[t.id])}` : "Steady"} color={`${t.color}22`} dark />
            ))}
          </div>

          <div style={{ border: "1px solid #334155", borderRadius: 14, padding: 18, background: "#0f172a" }}>
            <h2 style={{ marginTop: 0, marginBottom: 14, color: "#f8fafc" }}>Round Control</h2>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={() => advanceRound(false)} disabled={missingStations().length > 0 || currentRound >= ROUND_COUNT} style={{ padding: "10px 14px", borderRadius: 10, background: "#2563eb" }}>▶️ Advance Round</button>
                <button type="button" onClick={() => advanceRound(true)} disabled={currentRound >= ROUND_COUNT} style={{ padding: "10px 14px", borderRadius: 10, background: "#dc2626" }}>⏭️ Force Advance</button> 
                <button
  type="button"
  onClick={resetFieldDay}
  style={{
    padding: "10px 14px",
    borderRadius: 10,
    background: "#7f1d1d",
    color: "white",
    fontWeight: 700,
    cursor: "pointer",
  }}
>
  🔄 Reset Field Day
</button>

<button
  type="button"
  onClick={endFieldDay}
  style={{
    padding: "10px 14px",
    borderRadius: 10,
    background: "#111827",
    color: "white",
    fontWeight: 700,
    cursor: "pointer",
  }}
>
  🏁 End Field Day
</button>
                <button type="button" onClick={togglePause} style={{ padding: "10px 14px", borderRadius: 10, background: "#ea580c" }}>{safeEventData.pauseEvent ? "▶️ Resume Event" : "⏸️ Pause Event"}</button>
                <button type="button" onClick={editLastSubmission} disabled={!safeEventData.lastSubmission} style={{ padding: "10px 14px", borderRadius: 10 }}>Edit Last Submission</button>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <strong>Timer</strong>
                <input type="number" min="1" value={safeEventData.timerDurationMinutes} onChange={(e) => update(ref(db), { [`${EVENT_PATH}/timerDurationMinutes`]: Number(e.target.value) })} style={{ width: 70, padding: 8, borderRadius: 8 }} />
                <span>minutes</span>
                <button type="button" onClick={startTimer} style={{ padding: "10px 14px", borderRadius: 10 }}>Start</button>
                <button type="button" onClick={stopTimer} style={{ padding: "10px 14px", borderRadius: 10 }}>Stop</button>
                <span style={{ color: "#94a3b8" }}>{timerText}</span>
                <span style={{ color: "#94a3b8" }}>Missing this round: {missingStations().length ? missingStations().map((n) => `Station ${n}`).join(", ") : "None"}</span>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ border: "1px solid #334155", borderRadius: 14, padding: 18, background: "#0f172a" }}>
              <h2 style={{ marginTop: 0, marginBottom: 14, color: "#f8fafc" }}>Scoring Setup</h2>
              <div style={{ display: "grid", gap: 14 }}>
                <div>
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>Point Values</div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {places.map((p) => (
                      <label key={p} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span>{p}</span>
                        <input type="number" value={safeEventData.placePoints[p]} onChange={(e) => update(ref(db), { [`${EVENT_PATH}/placePoints/${p}`]: Number(e.target.value) })} style={{ width: 70, padding: 8, borderRadius: 8 }} />
                      </label>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" onClick={exportCSV} style={{ padding: "10px 14px", borderRadius: 10 }}>Export CSV</button>
                  <button type="button" onClick={() => setView("scoreboard")} style={{ padding: "10px 14px", borderRadius: 10 }}>Open Scoreboard</button>
                </div>
              </div>
            </div>

            <div style={{ border: "1px solid #334155", borderRadius: 14, padding: 18, background: "#0f172a" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                <h2 style={{ margin: 0, color: "#f8fafc" }}>Stations</h2>
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 13, color: "#cbd5e1" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 999, background: "#14532d", border: "1px solid #86efac", display: "inline-block" }}></span> Submitted</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 999, background: "#713f12", border: "1px solid #fde047", display: "inline-block" }}></span> In Progress</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 999, background: "#7f1d1d", border: "1px solid #fca5a5", display: "inline-block" }}></span> Not Started</div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                {statusData.map((s) => {
                  const label = s.status === "submitted" ? "Submitted" : s.status === "in_progress" ? "In Progress" : "Not Started";
                  return (
                    <button type="button" key={s.stationNumber} onClick={() => setSelectedAdminStation(s.stationNumber)} style={{ textAlign: "left", padding: 14, borderRadius: 12, border: selectedAdminStation === s.stationNumber ? "2px solid #60a5fa" : "1px solid #334155", background: selectedAdminStation === s.stationNumber ? "#1e3a8a" : s.status === "submitted" ? "#14532d" : s.status === "in_progress" ? "#713f12" : "#7f1d1d" }}>
                      <div style={{ fontWeight: 800 }}>Station {s.stationNumber}</div>
                      <div style={{ fontSize: 13, marginTop: 4, color: "#e2e8f0" }}>{label}</div>
                      <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 6 }}>Last submit: {fmtTime(s.lastSubmittedAt)}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ border: "1px solid #334155", borderRadius: 14, padding: 18, background: "#0f172a" }}>
              <h2 style={{ marginTop: 0, marginBottom: 14, color: "#f8fafc" }}>Station {selectedAdminStation}</h2>
              <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
                {places.map((place) => (
                  <div key={place} style={{ display: "flex", justifyContent: "space-between", border: "1px solid #334155", borderRadius: 10, padding: 12, background: "#111827", color: "#f8fafc" }}>
                    <strong>{place}</strong>
                    <span>{stationDetail[place] ? <TeamLabel teamId={stationDetail[place]} dark /> : "Not assigned"}</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 14, color: "#cbd5e1", marginBottom: 14 }}>
                Submitted: {stationDetail.submitted ? "Yes" : "No"} • Last touched: {fmtTime(safeEventData.stations[selectedAdminStation].lastTouchedAt)}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={() => { setBackfillStation(selectedAdminStation); setBackfillRound(currentRound); }} style={{ padding: "10px 14px", borderRadius: 10 }}>Edit This Station</button>
                <button type="button" onClick={() => copyStationLink(selectedAdminStation)} style={{ padding: "10px 14px", borderRadius: 10 }}>Copy Station Link</button>
              </div>
              {copiedLink ? <div style={{ marginTop: 10, color: "#86efac", fontWeight: 700 }}>Copied link for {copiedLink}</div> : null}
            </div>

            <div style={{ border: "1px solid #334155", borderRadius: 14, padding: 18, background: "#0f172a" }}>
              <h2 style={{ marginTop: 0, marginBottom: 14, color: "#f8fafc" }}>Backfill Editor</h2>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                <label>Round <select value={backfillRound} onChange={(e) => setBackfillRound(Number(e.target.value))} style={{ marginLeft: 6, padding: 8, borderRadius: 8 }}>{Array.from({ length: ROUND_COUNT }, (_, i) => <option key={i + 1} value={i + 1}>Round {i + 1}</option>)}</select></label>
                <label>Station <select value={backfillStation} onChange={(e) => setBackfillStation(Number(e.target.value))} style={{ marginLeft: 6, padding: 8, borderRadius: 8 }}>{Array.from({ length: STATION_COUNT }, (_, i) => <option key={i + 1} value={i + 1}>Station {i + 1}</option>)}</select></label>
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {places.map((place) => {
                  const roundData = safeEventData.stations[backfillStation].rounds[backfillRound];
                  const options = availableTeamsForPlace(roundData, place);
                  return (
                    <div key={place} style={{ border: "1px solid #334155", borderRadius: 10, padding: 10, background: "#111827" }}>
                      <div style={{ fontWeight: 800, marginBottom: 8 }}>{place}</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {options.map((team) => {
                          const selected = roundData[place] === team.id;
                          return (
                            <button type="button" key={team.id} onClick={() => assignTeamToPlace(place, team.id, backfillStation, backfillRound)} style={{ padding: "8px 10px", borderRadius: 10, background: team.color, color: team.id === "yellow" ? "#111827" : "white", border: selected ? "3px solid #ffffff" : "1px solid #334155", boxShadow: selected ? `0 0 0 3px ${team.color}55` : "none" }}>
                              <TeamLabel teamId={team.id} dark />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 12 }}>
                <button type="button" onClick={() => update(ref(db), { [`${EVENT_PATH}/stations/${backfillStation}/rounds/${backfillRound}/submitted`]: true, [`${EVENT_PATH}/history`]: addHistory(`Admin backfilled Station ${backfillStation}, Round ${backfillRound}`) })} style={{ padding: "10px 14px", borderRadius: 10 }}>Save Backfill</button>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ border: "1px solid #334155", borderRadius: 14, padding: 18, background: "#0f172a" }}>
              <h2 style={{ marginTop: 0, marginBottom: 14, color: "#f8fafc" }}>Bonuses / Penalties</h2>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
                <span>Amount</span>
                <input type="number" value={penaltyValue} onChange={(e) => setPenaltyValue(Number(e.target.value))} style={{ width: 70, padding: 8, borderRadius: 8 }} />
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {teams.map((team) => (
                  <div key={team.id} style={{ border: "1px solid #334155", borderRadius: 10, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", background: "#111827" }}>
                    <div>
                      <div style={{ fontWeight: 800 }}><TeamLabel teamId={team.id} dark /></div>
                      <div style={{ color: "#cbd5e1", fontSize: 14 }}>Adjustment: {safeEventData.bonuses[team.id]}</div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" onClick={() => applyBonus(team.id, penaltyValue)} style={{ padding: "8px 12px", borderRadius: 10 }}>Add</button>
                      <button type="button" onClick={() => applyBonus(team.id, -penaltyValue)} style={{ padding: "8px 12px", borderRadius: 10 }}>Subtract</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ border: "1px solid #334155", borderRadius: 14, padding: 18, background: "#0f172a" }}>
              <h2 style={{ marginTop: 0, marginBottom: 14, color: "#f8fafc" }}>Event Log</h2>
              <div style={{ maxHeight: 260, overflow: "auto", display: "grid", gap: 8 }}>
                {safeEventData.history && safeEventData.history.length ? (
                  safeEventData.history.map((item, idx) => (
                    <div key={`${item.at}-${idx}`} style={{ border: "1px solid #334155", borderRadius: 10, padding: 10, background: "#111827", color: "#f8fafc" }}>
                      <div style={{ fontWeight: 700 }}>{item.message}</div>
                      <div style={{ fontSize: 12, color: "#cbd5e1" }}>{fmtTime(item.at)}</div>
                    </div>
                  ))
                ) : (
                  <div style={{ color: "#cbd5e1" }}>No history yet.</div>
                )}
              </div>
            </div>
          </div>

          <div style={{ border: "1px solid #334155", borderRadius: 14, padding: 18, background: "#0f172a" }}>
            <h2 style={{ marginTop: 0, marginBottom: 14, color: "#f8fafc" }}>Quick Links</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, maxHeight: 380, overflow: "auto" }}>
              {Array.from({ length: STATION_COUNT }, (_, i) => {
                const s = i + 1;
                const url = `${window.location.origin}${window.location.pathname}?station=${s}`;
                return (
                  <div key={s} style={{ border: "1px solid #334155", borderRadius: 10, padding: 10, background: "#111827" }}>
                    <div style={{ fontWeight: 800, marginBottom: 8 }}>Station {s}</div>
                    <QRCodeSVG value={url} size={96} />
                    <div style={{ marginTop: 8 }}>
                      <button type="button" onClick={() => copyStationLink(s)} style={{ padding: "8px 10px", borderRadius: 8 }}>Copy Link</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
