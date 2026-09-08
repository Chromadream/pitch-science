import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-700.css';
import './style.css';
import { createGame, resolvePitch, SCENARIOS, PITCH_TYPES, RELEASE, RELEASE_BOUNDS, buildPitchFlight, judgePitch, isStrike, batterZone, pitcherPoint } from './engine.js';
import { projectPitchPoint, pitchPlaneTransform } from './view.js';

// Adapted from Baseball Savant's pitch-result palette; early fouls count as strikes.
const trailResults = {
  strike: { color: '#FF7F0E', label: 'Strike', code: 'S' },
  ball: { color: '#1F77B4', label: 'Ball', code: 'B' },
  hit: { color: '#D62728', label: 'Hit', code: 'H' },
  'two-strike-foul': { color: '#2CA02C', label: 'Foul with two strikes', code: 'F' },
  out: { color: '#9467BD', label: 'In-play out', code: 'O' },
};

function pitchResultType(outcome, strikesBefore) {
  return outcome === 'ball' ? 'ball' : outcome === 'foul' && strikesBefore === 2 ? 'two-strike-foul' : ['called-strike', 'swinging-strike', 'foul'].includes(outcome) ? 'strike' : outcome === 'in-play-out' ? 'out' : 'hit';
}

const baseball = `<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><circle cx="20" cy="20" r="16" stroke="currentColor" stroke-width="1.5"/><path d="M10 7q15 13 0 26M30 7q-15 13 0 26M12 12l5-2m-1 10 5-1m-7 9 5 2m9-19-5-2m1 10-5-1m7 9-5 2" stroke="currentColor" stroke-width="1.5"/></svg>`;

document.querySelector('#app').innerHTML = `
  <header class="site-header">
    <a class="brand" href="./" aria-label="Pitch Science home">${baseball}<span>PITCH<span class="brand-light">SCIENCE</span><small>THE ONE-INNING CHALLENGE</small></span></a>
    <div class="header-actions"><span class="made-for">A little control. A lot of baseball.</span><button class="text-button" id="help-button"><span class="help-icon">?</span> How to play</button><button class="theme-button" id="theme-button" aria-label="Switch color theme">◐</button></div>
  </header>
  <main>
    <section class="intro"><div><div class="edition"><span></span> YOUR MOUND. YOUR RULES.</div><h1>Own the inning<span>.</span></h1><p>Pick your pitch. Shape the break. Paint the corners.</p></div><div class="inning-label"><span>EXHIBITION</span><strong>01 <span>/</span> 01</strong><small>ONE INNING. THREE OUTS.</small></div></section>
    <section class="scenario-bar" aria-label="Game difficulty">
      <div class="scenario-select"><label for="difficulty">Difficulty / scenario</label><select id="difficulty" aria-describedby="scenario-description">${Object.entries(SCENARIOS).map(([id, scenario]) => `<option value="${id}">${scenario.label}</option>`).join('')}</select></div>
      <p id="scenario-description"></p>
      <div class="team-score" aria-label="Game score" aria-live="polite"><span>YOUR TEAM <strong id="player-score">0</strong></span><span>OPPONENT <strong id="opponent-score">0</strong></span><small id="save-status" hidden></small></div>
    </section>
    <section class="scoreboard" aria-label="Live scoreboard">
      <div class="inning-indicator"><span class="live-dot"></span><div><small>ON THE MOUND</small><strong id="inning-name">Top of the 1st</strong></div></div>
      <div class="score-stat"><small>BALLS</small><div id="balls" class="count-dots"></div></div>
      <div class="score-stat"><small>STRIKES</small><div id="strikes" class="count-dots"></div></div>
      <div class="score-stat"><small>OUTS</small><div id="outs" class="count-dots out-dots"></div></div>
      <div class="score-stat numeric"><small>RUNS ALLOWED</small><strong id="runs">0</strong></div>
      <div class="score-stat numeric"><small>HITS</small><strong id="hits">0</strong></div>
      <div class="base-state"><svg viewBox="0 0 90 68" role="img" aria-label="Bases empty" id="bases"><path d="M45 12 73 37 45 61 17 37Z" fill="none" stroke="#77968a" stroke-width="1"/><path id="base-1" d="m73 29 8 8-8 8-8-8Z"/><path id="base-2" d="m45 4 8 8-8 8-8-8Z"/><path id="base-3" d="m17 29 8 8-8 8-8-8Z"/><path d="m41 56 8 0 0 5-4 4-4-4Z" fill="#d5dfc9"/></svg><small id="base-label">BASES EMPTY</small></div>
    </section>
    <div class="game-layout">
      <aside class="inning-strip" aria-label="Inning progress"><div class="log-heading"><h2>The inning so far</h2><span id="total-pitches">0 PITCHES</span></div><div id="pitch-log" class="pitch-log"><span class="log-empty">A fresh inning. Make the first pitch count.</span></div><div class="challenge-progress"><span id="perfect-label">IMMACULATE WATCH</span><div id="perfect-dots"></div><small id="perfect-status">9 pitches. 9 strikes. A little baseball magic.</small></div></aside>
      <section class="field-panel" aria-label="Pitching field">
        <div class="field-heading"><span><span class="live-dot"></span> LIVE FROM THE MOUND</span><span id="pitch-number">PITCH 01</span></div>
        <div class="field-wrap">
          <svg id="field" viewBox="0 0 1000 640" role="group" aria-label="Angled ballpark view. Pitcher on the left, home plate on the right. Drag RELEASE, TARGET, or BEND to adjust the pitch.">
            <defs>
              <linearGradient id="sky" x2="0" y2="1"><stop stop-color="#d3e0d3"/><stop offset="1" stop-color="#f0eed6"/></linearGradient>
              <linearGradient id="grass" x2="0" y2="1"><stop stop-color="#6a8960"/><stop offset="1" stop-color="#7b9464"/></linearGradient>
              <pattern id="seats" width="22" height="18" patternUnits="userSpaceOnUse"><path d="M4 7h10v5H4z" fill="#476452"/><path d="M4 6h10" stroke="#879180" stroke-width="2"/></pattern>
              <pattern id="net" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" fill="none" stroke="#e4e7cd" stroke-width="0.7" opacity=".23"/></pattern>
              <filter id="shadow"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-opacity=".15"/></filter>
            </defs>
            <g id="ballpark" pointer-events="none">
              <rect width="1000" height="640" fill="#dbe4d5"/>
              <path d="M0 75 1000 155V285L0 205Z" fill="#6b806c"/>
              <path d="M0 87 1000 167V267L0 187Z" fill="url(#seats)"/>
              <path d="M0 116 1000 196M0 148 1000 228M0 180 1000 260" stroke="#b1baa1" stroke-width="5"/>
              <path d="M0 199 1000 279V329L0 249Z" fill="#2c5440"/>
              <path d="M0 199 1000 279" stroke="#d5d1a7" stroke-width="5"/>
              <g transform="matrix(1 .08 0 1 0 0)" fill="#bdcba9" font-family="Arial,sans-serif" font-size="11" font-weight="700" letter-spacing="3"><text x="80" y="232">PITCH SCIENCE BALLPARK</text><text x="710" y="232">THE ONE-INNING CHALLENGE</text></g>
              <path d="M0 249 1000 329V640H0Z" fill="#819b6a"/>
              <g fill="#a3b780" opacity=".3"><path d="M0 340 252 269 375 279 0 391ZM0 465 537 292 660 302 0 517ZM38 640 1000 331V383L188 640ZM360 640 1000 436V489L510 640ZM680 640 1000 542V594L830 640Z"/></g>
              <path d="M0 260 570 302Q720 277 839 354L1000 402V456L794 397Q710 425 579 349L0 302Z" fill="#b49a73"/>
              <path d="M0 269 579 313Q716 291 828 361L1000 414V443L790 386Q711 410 583 339L0 294Z" fill="#c7ae85"/>
              <ellipse cx="694" cy="365" rx="110" ry="42" transform="rotate(15 694 365)" fill="#c7ae85"/>
              <g fill="none" stroke="#f0e8ca" stroke-width="2.5"><path d="M0 280 680 370 1000 446"/><path d="m597 321 48 13-41 18-48-13Zm120 33 48 13-41 18-48-13Z"/></g>
              <path id="home-plate" d="m672 363 19 5 0 7-13 3-13-9Z" fill="#faf5dc" stroke="#d7c5a1"/>
              <g stroke="#4c6755" stroke-width="3"><path d="M80 183V41m816 207V105"/><path d="m64 42 34 3m782 61 34 3" stroke-width="10"/></g>
              <path d="M555 273 839 296V382L555 359Z" fill="url(#net)" opacity=".6"/>
            </g>
            <g id="mound-plane" transform="${pitchPlaneTransform(0)}">
            <g id="pitching-mound" aria-label="Raised pitching mound in the foreground">
              <ellipse cx="418" cy="584" rx="155" ry="39" fill="#536342" opacity=".25"/>
              <path d="M268 565Q278 612 418 612T568 565L558 550H278Z" fill="#aa8b60"/>
              <ellipse cx="418" cy="562" rx="150" ry="40" fill="#d0b78c"/>
              <ellipse cx="418" cy="560" rx="119" ry="28" fill="none" stroke="#bda078"/>
              <path d="m342 560 81 0 10 12h-103Z" fill="#f5eedb" stroke="#ac9874"/>
              <path d="M280 573Q418 614 556 573" fill="none" stroke="#dfc9a2" stroke-width="2"/>
            </g>
            </g>
            <g id="plate-plane" transform="${pitchPlaneTransform(1)}">
            <g id="catcher" stroke="#253d34" stroke-linecap="round" stroke-linejoin="round">
              <ellipse cx="493" cy="361" rx="44" ry="9" fill="#605d43" opacity=".25" stroke="none"/>
              <path d="m482 322-23 19-6 18m49-37 21 22 5 13" fill="none" stroke="#e4dfcc" stroke-width="15"/>
              <path d="m471 339-14 19m59-16 10 16" stroke-width="11"/>
              <path d="m475 294-9 35q25 15 49 0l-9-35" fill="#e6dfc9" stroke-width="2"/>
              <path d="M478 293h26v35h-26z" fill="#3b5146" stroke-width="3"/><path d="M479 303h24m-24 9h24m-24 9h24" stroke="#8b9c87" stroke-width="2"/>
              <circle cx="490" cy="279" r="16" fill="#364d42" stroke-width="3"/><path d="M479 272h22v15h-22zm0 7h22m-14-7v15m7-15v15" fill="none" stroke="#b2baa3" stroke-width="2"/>
              <path d="m472 303-14 17 20 5m31-21 14 18-20 4" fill="none" stroke="#e4dfcc" stroke-width="11"/><ellipse cx="486" cy="326" rx="13" ry="11" fill="#9e6e41" stroke-width="2"/>
            </g>
            <g id="batter" stroke-linecap="round" stroke-linejoin="round">
              <ellipse cx="382" cy="370" rx="45" ry="8" fill="#605d43" opacity=".25"/>
              <path d="m380 298-10 35-14 32m39-65 11 31 14 33" fill="none" stroke="#f1ecdc" stroke-width="16"/>
              <path d="m355 365-10 4h19m60-5 9 4h-20" stroke="#273f35" stroke-width="9"/>
              <path d="m374 243-10 51q18 19 38 6l-2-51Z" fill="#f0eddf" stroke="#d4d7c4" stroke-width="2"/><path d="m384 248 0 47" stroke="#71836e" stroke-width="2"/><text x="375" y="281" fill="#375647" font-family="Arial" font-weight="bold" font-size="19">7</text><path d="m365 298 37 4" stroke="#2f473b" stroke-width="5"/>
              <path d="m374 251-17 17 32 8m10-19 9 20-18-2" fill="none" stroke="#eee9d8" stroke-width="12"/>
              <g id="bat"><path d="m390 275-34-76" stroke="#976c42" stroke-width="9"/><path d="m365 218-9-19" stroke="#bb925d" stroke-width="11"/><path d="m385 263 5 12" stroke="#ede2be" stroke-width="8"/></g>
              <path d="m379 237 0 10 13 1 0-13" fill="#b98862"/><circle cx="385" cy="225" r="16" fill="#c39770"/><path d="M367 225q-1-24 20-21 18 1 17 21h-37m27-1h18" fill="#294f3d" stroke="#294f3d" stroke-width="5"/><path d="m371 223 0 10" stroke="#294f3d" stroke-width="7"/>
            </g>
            <g id="strike-zone"><rect rx="2" fill="#faf9e4" fill-opacity=".09" stroke="#fff9dd" stroke-width="2" stroke-dasharray="7 5"/><path id="zone-grid" stroke="#fff9dd" stroke-opacity=".35" stroke-width="1"/><path id="body-zone-guides" fill="none" stroke="#fff9dd" stroke-opacity=".6" stroke-dasharray="3 4"/><text x="490" text-anchor="middle" fill="#fffbea" font-size="10" letter-spacing="2" font-family="Arial">STRIKE ZONE</text></g>
            </g>
            <g id="pitcher-plane" transform="${pitchPlaneTransform(0)}">
            <g id="pitcher" aria-label="Pitcher seen from behind, throwing toward home plate" stroke-linecap="round" stroke-linejoin="round" pointer-events="none">
              <g id="pitcher-handedness">
              <ellipse cx="397" cy="572" rx="72" ry="14" fill="#645d43" opacity=".3"/>
              <path d="m371 508-15 35 0 29m37-63 17 29 22 18" fill="none" stroke="#eae5d3" stroke-width="23"/>
              <path d="m390 520 15 22 20 17" fill="none" stroke="#c6cbb7" stroke-width="7"/>
              <path d="m349 570-10 9h26m65-21 15 7-21 1" fill="none" stroke="#243f33" stroke-width="11"/>
              <path d="M361 444Q380 434 403 447L409 505Q379 521 352 506Z" fill="#f0ecdc" stroke="#c1c9b1" stroke-width="2"/>
              <path d="M398 450 409 505 395 510 389 447Z" fill="#cbd0bc"/>
              <path d="m354 505 53 0" stroke="#264d39" stroke-width="6"/>
              <text x="377" y="485" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" font-weight="700" fill="#31513d">1</text>
              <path d="m362 453-24 25 20 13" fill="none" stroke="#eeead8" stroke-width="16"/>
              <ellipse cx="360" cy="490" rx="15" ry="19" transform="rotate(-25 360 490)" fill="#a67a4e" stroke="#7d5838" stroke-width="2"/>
              <path d="m354 480 6 17m-1-20 7 17" stroke="#c49b66" stroke-width="2"/>
              <path d="M378 436v10" stroke="#bd916e" stroke-width="16"/>
              <ellipse cx="379" cy="421" rx="20" ry="24" fill="#c59a76"/>
              <path d="M357 421Q354 395 379 395 403 397 400 421Z" fill="#244d38"/>
              <path d="m392 410 21 5-17 5" fill="#244d38"/><path d="M366 401q10-5 19-2" fill="none" stroke="#54735b" stroke-width="3"/>
              <path id="throwing-arm" fill="none" stroke="#d3a17a" stroke-width="13"/>
              <path id="throwing-sleeve" fill="none" stroke="#eae6d4" stroke-width="18"/>
              <circle id="throwing-hand" r="9" fill="#d3a17a"/>
              </g>
            </g>
            <g id="release-depth" pointer-events="none" aria-hidden="true">
              <ellipse id="release-shadow" rx="13" ry="4" fill="#6c5e41" opacity=".5"/>
              <path id="release-height-guide" fill="none" stroke="#f6e6b2" stroke-width="1.5" stroke-dasharray="4 5"/>
            </g>
            </g>
            <g id="at-bat-trails" pointer-events="none" aria-label="Completed pitches in this at-bat"></g>
            <path id="flight-path" fill="none" stroke="#f5df91" stroke-width="3" stroke-linecap="round"/>
            <path id="curve-hit-area" fill="none" stroke="transparent" stroke-width="34" pointer-events="stroke"/>
            <g id="release-plane" transform="${pitchPlaneTransform(0)}">
            <g id="release-handle" class="path-handle" tabindex="0" role="button" aria-label="Release at the throwing hand. Drag or use arrow keys to change arm height and reach."><circle class="hit-area" r="32" fill="transparent"/><circle r="16" fill="#f7f2da" fill-opacity=".2" stroke="#fff0b5" stroke-width="2"/><circle r="7" fill="#fffbed" stroke="#c5c3a9"/><path d="M-3-6q4 6 0 12M3-6q-4 6 0 12" fill="none" stroke="#b6604f" stroke-width="1"/><text x="25" y="4">RELEASE</text></g>
            </g>
            <g id="bend-plane" transform="${pitchPlaneTransform(0.5)}">
            <g id="bend-handle" class="path-handle" tabindex="0" role="button" aria-label="Pitch bend. Drag or use arrow keys to adjust the curve."><circle class="hit-area" r="32" fill="transparent"/><circle r="15" fill="#294a38" stroke="#f9e6a2" stroke-width="2"/><path d="M-7 4Q0-10 7 4" fill="none" stroke="#fff0b5" stroke-width="2"/><text x="24" y="4">BEND</text></g>
            </g>
            <g id="target-plane" transform="${pitchPlaneTransform(1)}">
            <g id="target-handle" class="path-handle" tabindex="0" role="button" aria-label="Target point. Drag or use arrow keys to aim."><circle class="hit-area" r="32" fill="transparent"/><circle r="13" fill="#f7e6a0" fill-opacity=".25" stroke="#f9e6a2" stroke-width="2"/><circle r="4" fill="#fff0b5"/><path d="M-19 0h8m22 0h8M0-19v8m0 22v8" stroke="#fff0b5" stroke-width="1.5"/><text x="23" y="4">TARGET</text></g>
            </g>
            <g id="moving-ball" visibility="hidden"><circle r="10" fill="#fffbed" stroke="#d6d3ba"/><path d="M-5-8q8 8 0 16M5-8q-8 8 0 16" fill="none" stroke="#b6604f" stroke-width="1.5"/></g>
          </svg>
          <div class="field-instruction" id="field-instruction"><span>RELEASE: arm position</span><span class="instruction-divider"></span><span>BEND: curve · TARGET: aim</span></div>
          <div class="pitch-call" id="pitch-call" aria-live="polite" hidden><small id="call-label">THE CALL</small><strong id="call-title"></strong><span id="call-detail"></span></div>
          <div class="end-screen" id="end-screen" hidden><span class="end-ball">${baseball}</span><small>THREE OUTS. THAT'S THE INNING.</small><h2 id="end-title"></h2><span id="end-save" class="save-badge" hidden></span><p id="end-detail"></p><div id="end-stats"></div><button id="play-again" class="primary-button">Pitch another inning <span>↗</span></button><section class="results-history" aria-label="Full inning pitch history"><h3>Every pitch, every batter</h3><p id="bid-summary"></p><div class="results-table-scroll" tabindex="0" role="region" aria-label="Pitch table, scroll horizontally on small screens"><table id="results-table"><caption>All pitches in inning order. Count is balls-strikes before the pitch.</caption><thead><tr><th scope="col">Pitch</th><th scope="col">Type</th><th scope="col">MPH</th><th scope="col">RPM</th><th scope="col">Count</th><th scope="col">Result</th></tr></thead></table></div></section></div>
        </div>
        <div class="field-footer"><span><i class="legend-line"></i> Pitch trajectory</span><span><i class="legend-zone"></i> Strike zone</span><span class="view-label">ANGLED VIEW <span>↗</span></span></div>
        <div id="at-bat-review" class="at-bat-review" hidden><div aria-live="polite"><strong id="review-title"></strong><p id="review-detail"></p></div><button id="next-batter" class="primary-button">Next batter <span>↗</span></button></div>
        <div class="trail-legend" aria-label="Pitch outcome colors">${Object.values(trailResults).map(({ color, label, code }) => `<span><i style="background:${color}" aria-hidden="true"></i><b>${code}</b> ${label}</span>`).join('')}<small>Fouls before two strikes count as strikes.</small></div>
        <div class="body-controls">
          <div class="pitcher-controls"><div class="scenario-select hand-control"><label for="pitcher-hand">Pitcher handedness</label><select id="pitcher-hand" aria-describedby="matchup-help"><option value="R">Right-handed</option><option value="L">Left-handed</option></select></div><div class="height-control"><label for="pitcher-height">Pitcher height <output id="pitcher-height-value" for="pitcher-height">180 cm</output></label><input id="pitcher-height" type="range" min="160" max="210" value="180" aria-describedby="height-help pitcher-height-status"/><span id="pitcher-height-status" role="status" hidden>Locked for this inning</span><p id="height-help">Set before the inning's first pitch. It changes body height and release angle while preserving your arm slot.</p></div></div>
          <div class="batter-info" aria-live="polite"><span id="batter-number">BATTER 01</span><strong id="batter-height"></strong><span id="batter-hand"></span><small id="platoon-matchup"></small><small id="matchup-help">Same hand favors the pitcher. Opposite hands favor the batter.</small><small>Strike zone: shoulders to knees.<br>Each new batter gets a random height and batting side.</small></div>
        </div>
      </section>
      <aside class="pitch-panel">
        <div class="panel-heading"><h2>Your next pitch</h2><span class="pill" id="ready-status">READY</span></div>
        <div class="control-label"><label for="speed">Velocity</label><span class="setting-value"><output id="speed-value" for="speed">92</output><small>MPH</small></span></div>
        <input id="speed" type="range" min="60" max="120" value="92" aria-describedby="speed-help"/>
        <div class="range-labels" id="speed-limits"></div><p class="control-help" id="speed-help">Change speeds to keep the batter guessing.</p>
        <div class="control-label spin-label"><label for="spin">Spin</label><span class="setting-value"><output id="spin-value" for="spin">1,200</output><small>RPM</small></span></div>
        <input id="spin" type="range" min="-3000" max="3000" step="100" value="1200" aria-describedby="spin-help"/>
        <div class="range-labels"><span>↶ LEFT BREAK</span><span>RIGHT BREAK ↷</span></div><p class="control-help" id="spin-help">Spin bends sideways. BEND up: high arc. BEND down: late upward ride.</p>
        <div class="trajectory-heading"><span>Pitch type</span><button id="reset-path" class="small-button">↺ Reset curve</button></div>
        <div class="pitch-presets" role="group" aria-label="Pitch presets"><button data-preset="fastball" class="selected" aria-pressed="true">Fastball</button><button data-preset="curveball" aria-pressed="false">Curveball</button><button data-preset="slider" aria-pressed="false">Slider</button></div>
        <div class="trajectory-note"><span class="mini-target">⊙</span><p id="target-description">Target is inside the strike zone.<br><span>Try the corners to make contact harder.</span></p></div>
        <button class="primary-button throw-button" id="throw-button">Throw pitch <span>↗</span></button><span class="keyboard-hint">or press <kbd>SPACE</kbd> to throw</span>
        <div class="objective"><span class="objective-icon">${baseball}</span><div><strong>Keep a clean sheet.</strong><p>Three outs. Zero runs. That's a win.<br> Nine pitches, three K's? That's perfect.</p></div></div>
      </aside>
    </div>
    <footer class="page-footer"><span>BASEBALL, WITH A LITTLE SCIENCE.</span><span>No fielding. No shortcuts. Just you and the strike zone.</span><button id="restart-button" class="small-button">↺ Restart inning</button></footer>
  </main>
  <dialog id="help-dialog"><button class="dialog-close" id="close-help" aria-label="Close instructions">×</button><div class="edition">THE ONE-INNING CHALLENGE</div><h2>Aim small. Pitch big.</h2><p>You're the pitcher. Retire three batters before the inning ends.</p>
    <ol><li><strong>Pick a pitch type.</strong> Fastball has a small break, curveball has a looping drop, and slider breaks sideways later in flight.</li><li><strong>Set your release.</strong> Drag RELEASE at the foreground pitcher's throwing hand. Up and down changes arm height; left and right changes reach. The arm follows your hand. The dashed guide connects your release to its ground shadow on the raised mound.</li><li><strong>Aim and shape.</strong> Drag TARGET to aim at the plate. Drag BEND, or the curve itself, to adjust the break within the pitch type's range. Focus any handle and use arrow keys for fine adjustments. Shift makes larger adjustments.</li><li><strong>Let it fly.</strong> Set velocity and spin, then press Throw pitch or Space. Spin bends the preview without moving the target or release. Reset curve restores the selected type's bend while keeping your release, aim, and slider settings.</li></ol>
    <h3>The umpire has the last word.</h3><p>A taken pitch touching the strike zone is a strike; outside is a ball. A swing and miss is always a strike. Four balls means a walk. Three strikes means an out. Fouls cannot add a third strike.</p><p>Contact can be a foul, an automatic out, or a hit. Hits advance every runner by the hit distance. On outs, runners hold. Walks advance only forced runners. No fielding, steals, or double plays.</p><div class="rules-wins"><p><strong>Normal Win</strong><br>Finish with zero runs allowed. Hits are okay.</p><p><strong>Perfect Win</strong><br>An immaculate inning: three strikeouts on exactly nine pitches.</p></div><p class="final-rule">A run does not end the game. Keep pitching until you record three outs.</p><button id="start-playing" class="primary-button">Back to the mound <span>↗</span></button></dialog>
  <dialog id="restart-dialog"><h2>Start a fresh inning?</h2><p>Your current inning and pitch history will be cleared.</p><div class="dialog-actions"><button id="cancel-restart" class="secondary-button">Keep pitching</button><button id="confirm-restart" class="primary-button">Restart inning</button></div></dialog>
`;

const $ = (selector) => document.querySelector(selector);
let game = createGame();
let busy = false;
let reviewing = false;
let frame;
let callTimer;
let target = { x: 511, y: 264 };
let release = { ...RELEASE };
let pitcherHeight = 180;
let bend = { x: 0, y: 0 };
let flight = [];
let gesture = null;
let currentPreset = 'fastball';
let pendingScenario = null;
function updatePath() {
  flight = buildPitchFlight(currentPreset, target, bend, Number($('#spin').value), release, Number($('#speed').value), game.pitcherHand);
  const pathData = (path) => path.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const projected = flight.map((point, index) => projectPitchPoint(point, index / (flight.length - 1)));
  $('#flight-path').setAttribute('d', pathData(projected));
  $('#curve-hit-area').setAttribute('d', pathData(projected));
  for (const [id, point] of [['release', release], ['bend', flight[30]], ['target', target]]) {
    $(`#${id}-handle`).setAttribute('transform', `translate(${point.x} ${point.y})`);
  }
  // The artwork uses a right-handed pose centered on x=379.
  const leftHanded = game.pitcherHand === 'L';
  const hand = { x: leftHanded ? 758 - release.x : release.x, y: 580 + (release.y - 580) * 180 / pitcherHeight };
  $('#pitcher').setAttribute('transform', `translate(0 580) scale(1 ${pitcherHeight / 180}) translate(0 -580)`);
  $('#pitcher-handedness').setAttribute('transform', leftHanded ? 'translate(758 0) scale(-1 1)' : '');
  $('#pitcher-handedness text').setAttribute('transform', leftHanded ? 'translate(754 0) scale(-1 1)' : '');
  $('#pitcher').setAttribute('aria-label', `${leftHanded ? 'Left' : 'Right'}-handed pitcher seen from behind, throwing toward home plate`);
  const elbow = { x: 403 + (hand.x - 403) * 0.48, y: 466 + (hand.y - 466) * 0.3 };
  $('#throwing-arm').setAttribute('d', `M400 452 Q${elbow.x} ${elbow.y} ${hand.x} ${hand.y}`);
  $('#throwing-sleeve').setAttribute('d', `M400 452 L${400 + (elbow.x - 400) * 0.5} ${452 + (elbow.y - 452) * 0.5}`);
  $('#throwing-hand').setAttribute('cx', hand.x);
  $('#throwing-hand').setAttribute('cy', hand.y);
  $('#release-height-guide').setAttribute('d', `M${release.x} ${release.y + 17}V568`);
  $('#release-shadow').setAttribute('cx', release.x);
  $('#release-shadow').setAttribute('cy', 568);
  const inside = isStrike(target, batterZone(reviewing ? game.lastResult.batterHeight : game.batterHeight));
  $('#target-description').innerHTML = inside ? 'Target is inside the strike zone.<br><span>Try the corners to make contact harder.</span>' : 'Target is outside the strike zone.<br><span>A taken pitch here will be a ball.</span>';
  $('#throw-button').disabled = busy || game.over || reviewing;
}

function updateControls() {
  const preset = PITCH_TYPES[currentPreset];
  $('#speed-limits').innerHTML = `<span>${preset.minSpeed} <span>${currentPreset === 'curveball' ? 'LOB' : 'OFF-SPEED'}</span></span><span><span>HEAT</span> ${preset.maxSpeed}</span>`;
  $('#speed-value').textContent = $('#speed').value;
  $('#speed-help').textContent = currentPreset === 'curveball'
    ? Number($('#speed').value) < 65 ? 'Eephus range. Slower speed adds a higher lob. Drag BEND to exaggerate or reverse it.' : 'Drop below 65 MPH for an eephus arc. The slowest lobs are at 30 MPH.'
    : currentPreset === 'fastball' ? '60-120 MPH. Tight bend control for small placement changes and upward ride.' : `${preset.minSpeed}-${preset.maxSpeed} MPH. Drag BEND up for a loop or down for a late climb into the zone.`;
  $('#spin-value').textContent = Number($('#spin').value).toLocaleString('en-US');
  $('#pitcher-height-value').textContent = `${pitcherHeight} cm`;
  for (const id of ['speed', 'spin', 'pitcher-height']) {
    const slider = $(`#${id}`);
    slider.style.setProperty('--progress', `${(slider.value - slider.min) / (slider.max - slider.min) * 100}%`);
  }
  document.querySelectorAll('[data-preset]').forEach((button) => {
    button.classList.toggle('selected', button.dataset.preset === currentPreset);
    button.setAttribute('aria-pressed', String(button.dataset.preset === currentPreset));
  });
  updatePath();
}

function selectPreset(name) {
  currentPreset = name;
  const preset = PITCH_TYPES[name];
  bend = { x: 0, y: 0 };
  $('#speed').min = preset.minSpeed;
  $('#speed').max = preset.maxSpeed;
  $('#speed').value = preset.speed;
  $('#spin').value = preset.spin * (game.pitcherHand === 'L' ? -1 : 1);
  hideCall();
  updateControls();
}

function renderGame() {
  const batterHeight = reviewing ? game.lastResult.batterHeight : game.batterHeight;
  const batterHand = reviewing ? game.lastResult.batterHand : game.batterHand;
  const pitcherHand = reviewing ? game.lastResult.pitcherHand : game.pitcherHand;
  const zone = batterZone(batterHeight);
  $('#batter').setAttribute('transform', `translate(0 370) scale(1 ${batterHeight / 180}) translate(0 -370)${batterHand === 'L' ? ' translate(980 0) scale(-1 1)' : ''}`);
  $('#batter text').setAttribute('transform', batterHand === 'L' ? 'translate(760 0) scale(-1 1)' : '');
  $('#batter').setAttribute('aria-label', `${batterHand === 'L' ? 'Left' : 'Right'}-handed standing batter, ${batterHeight} centimeters tall`);
  $('#pitcher-hand').value = pitcherHand;
  $('#batter-hand').textContent = `${batterHand === 'L' ? 'Left' : 'Right'}-handed batter`;
  $('#platoon-matchup').textContent = `${pitcherHand}HP vs ${batterHand}HB: ${pitcherHand === batterHand ? 'Pitcher advantage' : 'Batter advantage'}`;
  $('#batter-height').textContent = `${batterHeight} cm`;
  $('#batter-number').textContent = `BATTER ${String(game.batters + (game.over || reviewing ? 0 : 1)).padStart(2, '0')}`;
  for (const [attribute, value] of Object.entries(zone)) $('#strike-zone rect').setAttribute(attribute, value);
  $('#zone-grid').setAttribute('d', `M${zone.x + zone.width / 3} ${zone.y}v${zone.height}m${zone.width / 3} ${-zone.height}v${zone.height}M${zone.x} ${zone.y + zone.height / 3}h${zone.width}m${-zone.width} ${zone.height / 3}h${zone.width}`);
  $('#body-zone-guides').setAttribute('d', batterHand === 'L' ? `M578 ${zone.y}H540M578 ${zone.y + zone.height}H540` : `M402 ${zone.y}H440M402 ${zone.y + zone.height}H440`);
  $('#strike-zone text').setAttribute('y', zone.y - 14);
  const scenario = SCENARIOS[game.scenario];
  $('#difficulty').value = game.scenario;
  $('#scenario-description').textContent = scenario.description;
  $('#inning-name').textContent = scenario.inning;
  $('.inning-label > span').textContent = scenario.label.toUpperCase();
  $('.inning-label strong').innerHTML = game.scenario === 'exhibition' ? '01 <span>/</span> 01' : '09 <span>/</span> 09';
  $('#player-score').textContent = game.playerScore;
  $('#opponent-score').textContent = game.opponentScore;
  $('#save-status').hidden = game.scenario !== 'relief';
  $('#save-status').textContent = game.save === 'save' ? 'Save' : game.save === 'blown-save' ? 'Blown Save' : 'Save opportunity';
  $('#save-status').classList.toggle('blown-save', game.save === 'blown-save');
  $('.objective strong').textContent = game.scenario === 'relief' ? "Don't blow the save." : game.scenario === 'cgso' ? 'Finish the shutout.' : 'Keep a clean sheet.';
  $('.objective p').textContent = game.scenario === 'exhibition' ? "Three outs. Zero runs. That's a win. Nine pitches, three K's? That's perfect." : 'No runs to spare. A tying run loses the challenge. Finish all three outs.';
  for (const [name, max] of [['balls', 4], ['strikes', 3], ['outs', 3]]) {
    $(`#${name}`).innerHTML = Array.from({ length: max }, (_, i) => `<i class="${i < game[name] ? 'filled' : ''}"></i>`).join('');
    $(`#${name}`).setAttribute('aria-label', `${game[name]} ${name}`);
  }
  for (const name of ['runs', 'hits']) $(`#${name}`).textContent = game[name];
  game.bases.forEach((occupied, index) => $(`#base-${index + 1}`).classList.toggle('occupied', occupied));
  const runners = game.bases.filter(Boolean).length;
  $('#base-label').textContent = runners ? `${runners} ON BASE` : 'BASES EMPTY';
  $('#bases').setAttribute('aria-label', game.bases.map((occupied, index) => `${['First', 'Second', 'Third'][index]} base ${occupied ? 'occupied' : 'empty'}`).join(', '));
  $('#pitch-number').textContent = game.over ? 'INNING COMPLETE' : `PITCH ${String(game.pitches + 1).padStart(2, '0')}`;
  $('#total-pitches').textContent = `${game.pitches} PITCH${game.pitches === 1 ? '' : 'ES'}`;
  const possible = game.lastResult?.immaculateAlive ?? true;
  $('#perfect-dots').innerHTML = Array.from({ length: 9 }, (_, i) => `<i class="${i < game.pitches && possible ? 'filled' : ''} ${!possible ? 'unavailable' : ''}"></i>`).join('');
  $('#perfect-status').textContent = game.win === 'perfect' ? 'Nine pitches. Three strikeouts. Perfection.' : possible ? '9 pitches. 9 strikes. A little baseball magic.' : 'Immaculate bid over. Keep pitching for three outs.';
  $('#perfect-label').classList.toggle('muted', !possible);
  if (game.history.length) {
    $('#pitch-log').innerHTML = game.history.slice(-5).reverse().map((pitch) => {
      const type = pitchResultType(pitch.outcome, pitch.strikesBefore);
      const result = trailResults[type];
      return `<div class="log-pitch" data-result="${type}"><span class="log-number">${String(pitch.number).padStart(2, '0')}</span><div><strong><span class="log-outcome" style="--outcome-color:${result.color}" aria-label="${result.label}"><i aria-hidden="true"></i>${result.code}</span> ${pitch.title}</strong><small>${pitch.speed} MPH <span>·</span> ${Number(pitch.spin).toLocaleString('en-US')} RPM<br>${pitch.pitcherHand}HP vs ${pitch.batterHand}HB</small></div></div>`;
    }).join('');
  } else $('#pitch-log').innerHTML = '<span class="log-empty">A fresh inning. Make the first pitch count.</span>';
  if (game.over && !reviewing) showEnd();
  updatePath();
}

function hideCall() {
  clearTimeout(callTimer);
  $('#pitch-call').hidden = true;
}

function setBusy(value) {
  busy = value;
  $('#ready-status').textContent = value ? 'IN FLIGHT' : reviewing ? 'REVIEW' : game.over ? 'COMPLETE' : 'READY';
  $('#field').classList.toggle('in-flight', value);
  $('#field').classList.toggle('reviewing', reviewing);
  $('#field-instruction').classList.toggle('invisible', value || game.over || reviewing);
  $('#at-bat-review').hidden = !reviewing;
  $('#throw-button').innerHTML = value ? 'Pitching<span class="throw-dots">...</span>' : 'Throw pitch <span>↗</span>';
  document.querySelectorAll('#speed, #spin, #pitcher-hand, [data-preset], #reset-path').forEach((el) => { el.disabled = value || game.over || reviewing; });
  const heightLocked = game.pitches > 0;
  $('#pitcher-height').disabled = value || heightLocked || game.over || reviewing;
  $('#pitcher-height-status').hidden = !heightLocked;
  $('#difficulty').disabled = value;
  document.querySelectorAll('.path-handle').forEach((el) => { el.setAttribute('tabindex', value || game.over || reviewing ? '-1' : '0'); });
  updatePath();
}

function throwPitch() {
  if (busy || game.over || reviewing || gesture) return;
  hideCall();
  setBusy(true);
  const speed = Number($('#speed').value);
  const spin = Number($('#spin').value);
  const outcome = judgePitch({ points: flight, speed, spin, game, pitchType: currentPreset });
  const resultType = pitchResultType(outcome, game.strikes);
  const result = trailResults[resultType];
  const ball = $('#moving-ball');
  const path = $('#flight-path');
  const trajectory = path.getAttribute('d');
  const endpoint = projectPitchPoint(flight.at(-1), 1);
  const length = path.getTotalLength();
  const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 80 : 1400 * 85 / speed;
  const start = performance.now();
  ball.setAttribute('visibility', 'visible');
  function animate(now) {
    const t = Math.min((now - start) / duration, 1);
    const p = path.getPointAtLength(t * length);
    ball.setAttribute('transform', `translate(${p.x},${p.y}) scale(0.7) rotate(${t * spin / 3})`);
    if (t < 1) { frame = requestAnimationFrame(animate); return; }
    ball.setAttribute('visibility', 'hidden');
    const swung = !['ball', 'called-strike'].includes(outcome);
    $('#batter').classList.toggle('swinging', swung);
    const previousBatter = game.batters;
    game = resolvePitch(game, outcome, { speed, spin, pitchType: currentPreset, pitcherHeight });
    reviewing = game.batters !== previousBatter;
    {
      const number = $('#at-bat-trails').childElementCount + 1;
      $('#at-bat-trails').insertAdjacentHTML('beforeend', `<g class="pitch-trail" data-result="${resultType}" role="img" aria-label="Pitch ${number}: ${result.label}, ${game.lastResult.title}, ${speed} MPH"><title>Pitch ${number}: ${result.label}, ${game.lastResult.title}, ${speed} MPH</title><path d="${trajectory}" fill="none" stroke="#eef3dc" stroke-opacity=".65" stroke-width="2" stroke-dasharray="5 5"/><circle cx="${endpoint.x}" cy="${endpoint.y}" r="8" fill="${result.color}" stroke="#fff8dc" stroke-width="2"/><text x="${endpoint.x + 12}" y="${endpoint.y - 9}" fill="#fff8dc" stroke="#35533f" stroke-width="2" paint-order="stroke" font-size="11" font-family="Arial,sans-serif">${number}${result.code}</text></g>`);
    }
    renderGame();
    setBusy(false);
    $('#call-title').textContent = game.lastResult.title;
    if (reviewing) {
      $('#review-title').textContent = game.lastResult.title;
      $('#review-detail').textContent = `${game.lastResult.detail} Review your pitches before continuing.`;
      $('#next-batter').innerHTML = `${game.over ? 'View results' : 'Next batter'} <span>↗</span>`;
    } else if (!game.over) {
      $('#call-label').textContent = swung ? 'THE BATTER SWINGS' : 'THE BATTER TAKES';
      $('#call-detail').textContent = game.lastResult.detail;
      $('#pitch-call').hidden = false;
      callTimer = setTimeout(hideCall, 3500);
    }
  }
  $('#batter').classList.remove('swinging');
  frame = requestAnimationFrame(animate);
}

function showEnd() {
  hideCall();
  $('#end-title').textContent = game.win === 'perfect' ? 'Perfect Win.' : game.win === 'normal' ? 'Normal Win.' : 'Inning complete.';
  $('#end-detail').textContent = game.win === 'perfect' ? 'An immaculate inning. Nine pitches, three strikeouts. You owned every inch of that plate.' : game.win === 'normal' ? 'Three outs and a zero on the board. That is how you shut an inning down.' : `${game.runs} run${game.runs === 1 ? '' : 's'} allowed, but you finished the job. A fresh inning is a chance to leave a zero.`;
  $('#end-save').hidden = game.scenario !== 'relief';
  $('#end-save').textContent = game.save === 'save' ? 'Save' : 'Blown Save';
  $('#end-save').classList.toggle('blown-save', game.save === 'blown-save');
  if (game.scenario !== 'exhibition') {
    const score = `Your team ${game.playerScore}, opponent ${game.opponentScore}.`;
    $('#end-detail').textContent = game.win ? `${score} ${game.win === 'perfect' ? 'An immaculate inning.' : 'Three outs, no runs allowed.'} ${game.scenario === 'relief' ? 'You secured the save.' : 'Complete-game shutout. No bottom of the ninth needed.'}` : `${score} ${game.opponentScore === game.playerScore ? 'The tying run cost you the challenge.' : 'The lead got away.'} You finished all three outs.`;
  }
  $('#end-stats').innerHTML = `<span><strong>${game.pitches}</strong>PITCHES</span><span><strong>${game.strikeouts}</strong>STRIKEOUTS</span><span><strong>${game.runs}</strong>RUNS</span>`;
  const bidEnded = game.history.find((pitch) => !pitch.immaculateAlive);
  $('#bid-summary').textContent = bidEnded
    ? `Immaculate bid ended on pitch ${bidEnded.number}, batter ${bidEnded.batterNumber}: ${bidEnded.outcome === 'foul' ? 'foul with two strikes' : bidEnded.title.toLowerCase()}.`
    : 'Immaculate inning achieved: nine pitches, three strikeouts. The bid never ended.';
  $('#results-table').querySelectorAll('tbody').forEach((body) => body.remove());
  let batterNumber = 0;
  let body;
  for (const pitch of game.history) {
    if (pitch.batterNumber !== batterNumber) {
      batterNumber = pitch.batterNumber;
      body = $('#results-table').createTBody();
      body.dataset.batter = batterNumber;
      body.insertAdjacentHTML('beforeend', `<tr class="batter-group"><th scope="rowgroup" colspan="6">Batter ${batterNumber} <span>${pitch.batterHeight} cm / ${pitch.batterHand}HB</span></th></tr>`);
    }
    const ended = pitch === bidEnded;
    const result = pitch.outcome === 'foul'
      ? pitch.strikesBefore === 2 ? 'Foul with two strikes' : 'Foul (strike)'
      : pitch.title === 'Strikeout' ? `Strikeout (${pitch.outcome === 'called-strike' ? 'called' : 'swinging'})` : pitch.title;
    const row = body.insertRow();
    row.className = `result-pitch${ended ? ' bid-ended' : ''}`;
    row.dataset.pitch = pitch.number;
    const values = [pitch.number, pitch.pitchType ? pitch.pitchType[0].toUpperCase() + pitch.pitchType.slice(1) : 'Not recorded', pitch.speed ?? '-', pitch.spin?.toLocaleString('en-US') ?? '-', `${pitch.ballsBefore}-${pitch.strikesBefore}`, result];
    values.forEach((value) => { row.insertCell().textContent = value; });
    const matchup = document.createElement('small');
    matchup.className = 'result-matchup';
    matchup.textContent = `${pitch.pitcherHand}HP vs ${pitch.batterHand}HB`;
    row.cells[1].append(matchup);
    if (ended) {
      const note = document.createElement('strong');
      note.className = 'bid-ended-note';
      note.textContent = 'Immaculate bid ended';
      row.lastElementChild.append(note);
    }
  }
  $('#end-screen').hidden = false;
  $('#play-again').focus({ preventScroll: true });
}

function resetGame(scenario = game.scenario) {
  cancelAnimationFrame(frame);
  hideCall();
  game = createGame(scenario, game.pitcherHand);
  reviewing = false;
  $('#at-bat-trails').replaceChildren();
  target = { x: 511, y: 264 };
  release = pitcherPoint(RELEASE, pitcherHeight);
  if (game.pitcherHand === 'L') release.x = 758 - release.x;
  bend = { x: 0, y: 0 };
  gesture = null;
  $('#moving-ball').setAttribute('visibility', 'hidden');
  $('#end-screen').hidden = true;
  $('#batter').classList.remove('swinging');
  setBusy(false);
  selectPreset('fastball');
  renderGame();
}

const field = $('#field');
function fieldPoint(event, mode) {
  const plane = mode === 'release-handle' ? $('#release-plane') : mode === 'target-handle' ? $('#target-plane') : $('#bend-plane');
  return new DOMPoint(event.clientX, event.clientY).matrixTransform(plane.getScreenCTM().inverse());
}
field.addEventListener('pointerdown', (event) => {
  if (busy || game.over || reviewing || gesture || event.button !== 0) return;
  const handle = event.target.closest('.path-handle');
  if (!handle && event.target.id !== 'curve-hit-area') return;
  event.preventDefault();
  hideCall();
  const mode = handle?.id ?? 'bend-handle';
  gesture = { id: event.pointerId, mode, start: fieldPoint(event, mode), release: { ...release }, target: { ...target }, bend: { ...bend } };
  field.setPointerCapture(event.pointerId);
});
function moveHandle(mode, point) {
  if (mode === 'target-handle') {
    target = { x: Math.max(350, Math.min(650, point.x)), y: Math.max(180, Math.min(410, point.y)) };
  } else if (mode === 'release-handle') {
    const upper = pitcherPoint({ x: 0, y: RELEASE_BOUNDS.minY }, pitcherHeight).y;
    const lower = pitcherPoint({ x: 0, y: RELEASE_BOUNDS.maxY }, pitcherHeight).y;
    const minX = game.pitcherHand === 'L' ? 758 - RELEASE_BOUNDS.maxX : RELEASE_BOUNDS.minX;
    const maxX = game.pitcherHand === 'L' ? 758 - RELEASE_BOUNDS.minX : RELEASE_BOUNDS.maxX;
    release = { x: Math.max(minX, Math.min(maxX, point.x)), y: Math.max(upper, Math.min(lower, point.y)) };
  } else {
    const pitch = PITCH_TYPES[currentPreset];
    bend = { x: Math.max(-pitch.maxX, Math.min(pitch.maxX, point.x)), y: Math.max(-pitch.maxY, Math.min(pitch.maxY, point.y)) };
  }
  updatePath();
}
field.addEventListener('pointermove', (event) => {
  if (!gesture || gesture.id !== event.pointerId) return;
  const p = fieldPoint(event, gesture.mode);
  const original = gesture.mode === 'target-handle' ? gesture.target : gesture.mode === 'release-handle' ? gesture.release : gesture.bend;
  moveHandle(gesture.mode, { x: original.x + p.x - gesture.start.x, y: original.y + p.y - gesture.start.y });
});
function finishGesture(event) {
  if (!gesture || gesture.id !== event.pointerId) return;
  if (event.type === 'pointercancel') {
    target = gesture.target;
    release = gesture.release;
    bend = gesture.bend;
  }
  gesture = null;
  if (field.hasPointerCapture(event.pointerId)) field.releasePointerCapture(event.pointerId);
  updatePath();
}
field.addEventListener('pointerup', finishGesture);
field.addEventListener('pointercancel', finishGesture);
document.querySelectorAll('.path-handle').forEach((handle) => handle.addEventListener('keydown', (event) => {
  if (busy || game.over || reviewing || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const point = handle.id === 'target-handle' ? target : handle.id === 'release-handle' ? release : bend;
  const amount = event.shiftKey ? 15 : 3;
  hideCall();
  moveHandle(handle.id, {
    x: point.x + (event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0),
    y: point.y + (event.key === 'ArrowDown' ? amount : event.key === 'ArrowUp' ? -amount : 0),
  });
}));
for (const id of ['speed', 'spin']) $(`#${id}`).addEventListener('input', updateControls);
$('#pitcher-hand').addEventListener('change', () => {
  if (busy || game.over || reviewing || gesture) {
    $('#pitcher-hand').value = game.pitcherHand;
    return;
  }
  const pitcherHand = $('#pitcher-hand').value;
  if (pitcherHand === game.pitcherHand) return;
  game = { ...game, pitcherHand };
  release = { ...release, x: 758 - release.x };
  bend = { ...bend, x: -bend.x };
  $('#spin').value = -Number($('#spin').value);
  hideCall();
  updateControls();
  renderGame();
});
$('#pitcher-height').addEventListener('input', () => {
  const hand = { x: release.x, y: 580 + (release.y - 580) * 180 / pitcherHeight };
  pitcherHeight = Number($('#pitcher-height').value);
  release = pitcherPoint(hand, pitcherHeight);
  hideCall();
  updateControls();
});
document.querySelectorAll('[data-preset]').forEach((button) => button.addEventListener('click', () => selectPreset(button.dataset.preset)));
$('#reset-path').addEventListener('click', () => { bend = { x: 0, y: 0 }; hideCall(); updateControls(); });
$('#throw-button').addEventListener('click', throwPitch);
$('#next-batter').addEventListener('click', () => {
  if (!reviewing || busy) return;
  reviewing = false;
  hideCall();
  $('#at-bat-trails').replaceChildren();
  $('#batter').classList.remove('swinging');
  setBusy(false);
  renderGame();
  if (!game.over) $('#throw-button').focus({ preventScroll: true });
});
document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.repeat || document.querySelector('dialog[open]') || event.target.closest('button, input, select, a, [role="button"]')) return;
  event.preventDefault();
  throwPitch();
});
$('#play-again').addEventListener('click', () => { resetGame(); $('#throw-button').focus(); });
$('#help-button').addEventListener('click', () => $('#help-dialog').showModal());
for (const id of ['close-help', 'start-playing']) $(`#${id}`).addEventListener('click', () => $('#help-dialog').close());
$('#restart-button').addEventListener('click', () => {
  pendingScenario = null;
  $('#restart-dialog h2').textContent = 'Start a fresh inning?';
  if (game.pitches || busy) $('#restart-dialog').showModal();
  else resetGame();
});
$('#cancel-restart').addEventListener('click', () => {
  pendingScenario = null;
  $('#restart-dialog').close();
});
$('#confirm-restart').addEventListener('click', () => {
  const scenario = pendingScenario ?? game.scenario;
  pendingScenario = null;
  $('#restart-dialog').close();
  resetGame(scenario);
});
$('#difficulty').addEventListener('change', () => {
  const scenario = $('#difficulty').value;
  if (scenario === game.scenario) return;
  if (game.pitches && !game.over) {
    pendingScenario = scenario;
    $('#difficulty').value = game.scenario;
    $('#restart-dialog h2').textContent = `Switch to ${SCENARIOS[scenario].label}?`;
    $('#restart-dialog').showModal();
  } else resetGame(scenario);
});
$('#restart-dialog').addEventListener('cancel', () => {
  pendingScenario = null;
});
$('#help-dialog .final-rule').insertAdjacentHTML('beforebegin', '<h3>Choose your situation.</h3><p>Exhibition is the original scoreless challenge. CGSO means complete-game shutout: you already pitched eight scoreless innings, and your home team leads 1-0 in the top of the ninth. Three more scoreless outs finish the game without a bottom half. Only this final inning is playable.</p><p>CGSO is hard mode. Batters chase fewer balls, attack more strikes, miss less often, and turn more contact into hits and extra bases. Location, movement, and speed changes still help.</p><p>Relief pitching starts in the bottom of the ninth with your visiting team ahead 4-3 and a save opportunity. Every mode starts with empty bases and no outs. Exhibition and Relief use the standard batting difficulty.</p><p>In relief mode, a Normal Win or Perfect Win also earns a Save. Allowing the tying run is a Blown Save, even if the score stays tied. Finish all three outs in every mode, including after a tying or go-ahead run.</p>');
$('#help-dialog ol').insertAdjacentHTML('afterend', '<h3>Height changes the matchup.</h3><p>Set pitcher height from 160 to 210 cm. Your feet stay on the mound, while your body, arm, and release height change together. This changes the flight angle, not the target or pitch speed. Height stays selected when you restart.</p><p>Every new batter, including the first batter, gets a random whole-centimeter height from 165 to 205 cm and an independently random batting side. Both sides are equally likely. There is no repeating lineup; consecutive batters can share either attribute. Both attributes stay fixed during the at-bat and its review. Restarting generates a fresh batter.</p><p>The arcade strike zone runs from the standing batter\'s shoulders to their knees, with a fixed plate width. The drawn zone and umpire use exactly the same boundaries. Your target does not move when a new batter arrives, so check your aim.</p>');
$('#help-dialog ol').insertAdjacentHTML('afterend', '<h3>Lob it or let it rise.</h3><p>Fastballs range from 60 to 120 MPH, sliders from 60 to 99 MPH, and curveballs from 30 to 90 MPH. Curveballs below 65 MPH gain an eephus-style arc, largest at 30 MPH. Drag BEND up for an even higher loop that drops into the target.</p><p>Every pitch type supports upward ride. Drag BEND down to place the middle of the flight below the target, then watch the ball climb into the zone. This is arcade-style movement. Spin still bends sideways. The release and target stay fixed, and extreme bends stay within the field view.</p>');
$('#help-dialog ol').insertAdjacentHTML('afterend', '<p>Dashed trails with numbered endpoints show completed pitches in the current at-bat. After a hit, walk, or out, review all pitches and select Next batter to continue. The batter and strike zone stay in place until you advance. After the third out, select View results when you finish reviewing.</p>');
$('#help-dialog ol').insertAdjacentHTML('afterend', '<h3>Play the platoon matchup.</h3><p>Choose a right- or left-handed pitcher. Matching the batter\'s hand favors the pitcher with more misses and in-play outs. Opposite-handed batters make contact more often and turn more contact into hits. These are small arcade adjustments, not guaranteed outcomes or measured MLB splits. Taken ball and strike calls never change.</p><p>The lineup includes right- and left-handed batters. Their batting side stays fixed through each at-bat and its review. You can change pitching hands between pitches, an arcade option rather than an MLB rule. Your selection stays through restarts and scenario changes.</p><p>Changing hands mirrors the throwing arm, release reach, horizontal bend, and spin while keeping your target. Pitch presets also mirror their sideways movement. The spin slider still controls left or right break as labeled.</p>');
$('#theme-button').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
});
selectPreset('fastball');
renderGame();
