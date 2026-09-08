function createBatter(random) {
  return { batterHeight: 165 + Math.floor(random() * 41), batterHand: random() < 0.5 ? 'R' : 'L' };
}

export function batterZone(height = 180) {
  // Standing SVG landmarks: feet at 370, shoulders at 243, knees around 333.
  const scale = height / 180;
  return { x: 440, y: 370 - 127 * scale, width: 100, height: 90 * scale };
}

export const ZONE = Object.freeze(batterZone());

export function pitcherPoint(point, height = 180) {
  // Scale around planted feet, preserving the arm slot relative to the body.
  return { x: point.x, y: 580 + (point.y - 580) * height / 180 };
}

export const SCENARIOS = Object.freeze({
  exhibition: Object.freeze({ label: 'Exhibition', inning: 'Top of the 1st', playerScore: 0, opponentScore: 0, description: 'The original challenge. Record three outs without allowing a run.' }),
  cgso: Object.freeze({ label: 'CGSO', inning: 'Top of the 9th', playerScore: 1, opponentScore: 0, description: 'Hard mode. Your home team leads 1-0 after eight scoreless innings. These batters chase less, miss less, and hit harder.' }),
  relief: Object.freeze({ label: 'Relief pitching', inning: 'Bottom of the 9th', playerScore: 4, opponentScore: 3, description: 'Your team leads 4-3. Close the ninth and earn the save. A tying run blows it.' }),
});

export const RELEASE = Object.freeze({ x: 450, y: 455 });
export const RELEASE_BOUNDS = Object.freeze({ minX: 420, maxX: 550, minY: 405, maxY: 515 });
export const PITCH_TYPES = Object.freeze({
  fastball: Object.freeze({ speed: 92, minSpeed: 60, maxSpeed: 120, spin: 1200, breakX: -12, breakY: 0, late: 0, maxX: 10, maxY: 35 }),
  curveball: Object.freeze({ speed: 78, minSpeed: 30, maxSpeed: 90, spin: -2400, breakX: 80, breakY: -65, late: 0.8, maxX: 90, maxY: 300 }),
  slider: Object.freeze({ speed: 86, minSpeed: 60, maxSpeed: 99, spin: 1900, breakX: -70, breakY: -10, late: 1.2, maxX: 70, maxY: 170 }),
});

export function buildPitchFlight(type, target, bend = { x: 0, y: 0 }, spin = 0, release = RELEASE, speed = PITCH_TYPES[type]?.speed, pitcherHand = 'R') {
  if (!Object.hasOwn(PITCH_TYPES, type)) throw new RangeError(`Unknown pitch type: ${type}`);
  const pitch = PITCH_TYPES[type];
  const velocity = clamp(Number.isFinite(speed) ? speed : pitch.speed, pitch.minSpeed, pitch.maxSpeed);
  const loft = type === 'curveball' ? 180 * ((65 - Math.min(65, velocity)) / (65 - pitch.minSpeed)) ** 2 : 0;
  const points = Array.from({ length: 61 }, (_, index) => {
    const t = index / 60;
    if (index === 0) return { ...release };
    if (index === 60) return { ...target };
    const weight = Math.sin(Math.PI * t);
    const shape = weight * (1 + pitch.late * (t - 0.5));
    return {
      x: release.x + (target.x - release.x) * t + pitch.breakX * (pitcherHand === 'L' ? -1 : 1) * shape + clamp(bend.x, -pitch.maxX, pitch.maxX) * weight,
      y: release.y + (target.y - release.y) * t + pitch.breakY * shape + (clamp(bend.y, -pitch.maxY, pitch.maxY) - loft) * weight,
    };
  });
  // Scale the whole vertical bend, rather than clipping its apex into a flat line.
  let verticalScale = 1;
  points.forEach((point, index) => {
    const straightY = release.y + (target.y - release.y) * index / 60;
    const deviation = point.y - straightY;
    if (point.y < 45) verticalScale = Math.min(verticalScale, (45 - straightY) / deviation);
    if (point.y > 600) verticalScale = Math.min(verticalScale, (600 - straightY) / deviation);
  });
  if (verticalScale < 1) points.forEach((point, index) => {
    if (index === 0 || index === points.length - 1) return;
    const straightY = release.y + (target.y - release.y) * index / 60;
    point.y = straightY + (point.y - straightY) * verticalScale;
  });
  return buildFlight(points, spin);
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const validPoint = (point) => Number.isFinite(point?.x) && Number.isFinite(point?.y);
const hitDistances = { single: 1, double: 2, triple: 3, 'home-run': 4 };
const titles = {
  ball: 'Ball',
  'called-strike': 'Called strike',
  'swinging-strike': 'Swing and miss',
  foul: 'Foul ball',
  single: 'Single',
  double: 'Double',
  triple: 'Triple',
  'home-run': 'Home run',
  'in-play-out': 'In-play out',
};

export function createGame(scenario = 'exhibition', pitcherHand = 'R', random = Math.random) {
  if (!Object.hasOwn(SCENARIOS, scenario)) throw new RangeError(`Unknown scenario: ${scenario}`);
  if (pitcherHand !== 'R' && pitcherHand !== 'L') throw new RangeError(`Unknown pitcher hand: ${pitcherHand}`);
  return {
    scenario,
    pitcherHand,
    playerScore: SCENARIOS[scenario].playerScore,
    opponentScore: SCENARIOS[scenario].opponentScore,
    save: null,
    balls: 0,
    strikes: 0,
    outs: 0,
    runs: 0,
    hits: 0,
    pitches: 0,
    strikeouts: 0,
    batters: 0,
    ...createBatter(random),
    bases: [false, false, false],
    history: [],
    over: false,
    win: null,
    lastResult: null,
  };
}

export function resolvePitch(game, outcome, metadata = {}, random = Math.random) {
  if (game.over) return game;
  if (!Object.hasOwn(titles, outcome)) throw new RangeError(`Unknown pitch outcome: ${outcome}`);

  const next = { ...game, bases: [...game.bases], history: [...game.history], pitches: game.pitches + 1 };
  let title = titles[outcome];
  let detail;
  let completed = false;

  if (outcome === 'ball') {
    next.balls += 1;
    if (next.balls === 4) {
      // Only a contiguous chain of occupied bases is forced by a walk.
      for (let base = 0; base < 3; base += 1) {
        if (!next.bases[base]) {
          next.bases[base] = true;
          break;
        }
        if (base === 2) next.runs += 1;
      }
      title = 'Walk';
      detail = 'Four balls. Batter takes first; only forced runners advance.';
      completed = true;
    }
  } else if (outcome === 'called-strike' || outcome === 'swinging-strike') {
    next.strikes += 1;
    if (next.strikes === 3) {
      next.outs += 1;
      next.strikeouts += 1;
      title = 'Strikeout';
      detail = 'Strike three. One out; runners hold.';
      completed = true;
    }
  } else if (outcome === 'foul') {
    next.strikes = Math.min(2, next.strikes + 1);
    detail = next.strikes === game.strikes ? 'Foul with two strikes. The count stays alive.' : 'Foul ball counts as a strike.';
  } else if (outcome === 'in-play-out') {
    next.outs += 1;
    completed = true;
    detail = 'Batter retired. Runners hold.';
  } else {
    const distance = hitDistances[outcome];
    next.bases = [false, false, false];
    // Every runner advances exactly the hit distance; no steals or extra bases.
    for (let base = 0; base < 3; base += 1) {
      if (!game.bases[base]) continue;
      if (base + distance >= 3) next.runs += 1;
      else next.bases[base + distance] = true;
    }
    if (distance === 4) next.runs += 1;
    else next.bases[distance - 1] = true;
    next.hits += 1;
    completed = true;
    detail = distance === 4 ? 'Batter and all runners score.' : `Batter and runners advance ${distance} base${distance === 1 ? '' : 's'}.`;
  }

  if (completed) {
    next.balls = 0;
    next.strikes = 0;
    next.batters += 1;
  }
  if (!detail) detail = `${next.balls} ball${next.balls === 1 ? '' : 's'}, ${next.strikes} strike${next.strikes === 1 ? '' : 's'}.`;
  const scored = next.runs - game.runs;
  next.opponentScore += scored;
  if (scored) detail += ` ${scored} run${scored === 1 ? '' : 's'} scored.`;

  next.over = next.outs >= 3;
  if (completed && !next.over) {
    Object.assign(next, createBatter(random));
  }
  next.win = next.over && next.runs === 0
    ? (next.strikeouts === 3 && next.pitches === 9 ? 'perfect' : 'normal')
    : null;
  if (next.scenario === 'relief') {
    next.save = next.opponentScore >= next.playerScore ? 'blown-save' : next.over ? 'save' : null;
  }
  const immaculateAlive = next.pitches === next.strikeouts * 3 + next.strikes && next.batters === next.strikeouts && next.pitches <= 9;
  next.lastResult = {
    ...metadata, pitcherHand: game.pitcherHand, batterHand: game.batterHand,
    batterHeight: game.batterHeight, batterNumber: game.batters + 1,
    ballsBefore: game.balls, strikesBefore: game.strikes, immaculateAlive,
    title, detail, outcome,
  };
  next.history.push({ speed: undefined, spin: undefined, ...next.lastResult, number: next.pitches, pitches: next.pitches });
  return next;
}

export function isStrike(point, zone = ZONE) {
  if (!validPoint(point)) return false;
  const x = clamp(point.x, zone.x, zone.x + zone.width);
  const y = clamp(point.y, zone.y, zone.y + zone.height);
  return (point.x - x) ** 2 + (point.y - y) ** 2 <= 4 ** 2;
}

export function buildFlight(points, spin = 0) {
  if (!Array.isArray(points)) return [];
  const path = points.filter(validPoint);
  if (path.length < 2) return path.map((point) => ({ ...point }));
  const bend = clamp(Number.isFinite(spin) ? spin : 0, -3000, 3000) / 3000 * 55;
  const count = Math.max(61, path.length);
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return { ...path[0] };
    if (index === count - 1) return { ...path[path.length - 1] };
    const t = index / (count - 1);
    const position = t * (path.length - 1);
    const start = Math.floor(position);
    const fraction = position - start;
    return {
      x: path[start].x + (path[start + 1].x - path[start].x) * fraction + Math.sin(Math.PI * t) * bend,
      y: path[start].y + (path[start + 1].y - path[start].y) * fraction,
    };
  });
}

export function judgePitch({ points, speed = 85, spin = 0, game, pitchType }, random = Math.random) {
  const zone = batterZone(game?.batterHeight);
  const end = Array.isArray(points) ? points[points.length - 1] : null;
  if (!validPoint(end)) return 'ball';
  const path = points.filter(validPoint);
  const start = path[0];
  const chord = Math.hypot(end.x - start.x, end.y - start.y);
  let length = 0;
  let deviation = 0;
  for (let index = 1; index < path.length; index += 1) {
    const point = path[index];
    length += Math.hypot(point.x - path[index - 1].x, point.y - path[index - 1].y);
    if (chord > 0) {
      deviation = Math.max(deviation, Math.abs(
        (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x),
      ) / chord);
    }
  }
  const pitch = PITCH_TYPES[pitchType];
  const velocity = clamp(Number.isFinite(speed) ? speed : 85, pitch?.minSpeed ?? 30, pitch?.maxSpeed ?? 120);
  const rotation = clamp(Math.abs(Number.isFinite(spin) ? spin : 0) / 3000, 0, 1);
  const curvature = clamp(deviation / 80 + (chord > 0 ? length / chord - 1 : length / 160), 0, 1);
  const previousSpeed = game?.history?.[game.history.length - 1]?.speed;
  const variation = Number.isFinite(previousSpeed) ? clamp(Math.abs(velocity - previousSpeed) / 25, 0, 1) : 0;
  const edge = clamp(Math.max(
    Math.abs(end.x - (zone.x + zone.width / 2)) / (zone.width / 2),
    Math.abs(end.y - (zone.y + zone.height / 2)) / (zone.height / 2),
  ), 0, 1);
  const difficulty = 0.30 * Math.max(0, (velocity - 65) / 55) + 0.22 * rotation + 0.18 * curvature + 0.20 * edge + 0.10 * variation;
  const strike = isStrike(end, zone);
  const distance = Math.hypot(
    end.x - clamp(end.x, zone.x, zone.x + zone.width),
    end.y - clamp(end.y, zone.y, zone.y + zone.height),
  );
  // Separate swing, contact, and hit rolls keep every pitch beatable.
  const hard = game?.scenario === 'cgso';
  const swingChance = strike
    ? (hard ? 0.94 - 0.08 * edge : 0.78 - 0.14 * edge)
    : (0.10 + 0.30 * Math.exp(-distance / 45) + 0.12 * difficulty) * (hard ? 0.4 : 1);
  if (random() >= swingChance) return strike ? 'called-strike' : 'ball';
  // Arcade matchup tuning, not empirical platoon statistics.
  const sameHand = (game?.pitcherHand ?? 'R') === (game?.batterHand ?? 'R');
  const missChance = clamp((0.08 + 0.48 * difficulty + (strike ? 0 : 0.22)) * (hard ? 0.45 : 1) * (sameHand ? 1.15 : 0.85), 0, 1);
  if (random() < missChance) return 'swinging-strike';
  const contact = random();
  const foulChance = hard ? 0.22 + 0.08 * difficulty : 0.28 + 0.12 * difficulty;
  if (contact < foulChance) return 'foul';
  if (contact < foulChance + (hard ? 0.12 + 0.08 * difficulty : 0.24 + 0.12 * difficulty) + (sameHand ? 0.03 : -0.03)) return 'in-play-out';
  const hit = random();
  if (hit < (hard ? 0.46 + 0.10 * difficulty : 0.62 + 0.12 * difficulty)) return 'single';
  if (hit < (hard ? 0.74 + 0.06 * difficulty : 0.86 + 0.06 * difficulty)) return 'double';
  if (hit < (hard ? 0.82 + 0.04 * difficulty : 0.92 + 0.04 * difficulty)) return 'triple';
  return 'home-run';
}
