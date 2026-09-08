import test from 'node:test';
import { projectPitchPoint, pitchPlaneTransform } from './view.js';
import assert from 'node:assert/strict';
import { createGame, resolvePitch, SCENARIOS, RELEASE, PITCH_TYPES, buildPitchFlight, ZONE, isStrike, buildFlight, judgePitch, BATTER_HEIGHTS, batterZone, pitcherPoint } from './engine.js';

const pitchMany = (game, outcomes) => outcomes.reduce((state, outcome) => resolvePitch(state, outcome), game);
const strikeOuts = (game, count = 3) => pitchMany(game, Array(count * 3).fill('called-strike'));
const rolls = (...values) => () => {
  assert.ok(values.length, 'Unexpected extra random roll');
  return values.shift();
};
const center = { x: ZONE.x + ZONE.width / 2, y: ZONE.y + ZONE.height / 2 };
const straight = [{ x: center.x, y: 600 }, center];
const easyPitch = { points: straight, speed: 65, spin: 0, game: createGame() };

test('createGame supplies fresh state with the exact initial fields', () => {
  assert.deepEqual(createGame(), {
    scenario: 'exhibition', playerScore: 0, opponentScore: 0, save: null,
    balls: 0, strikes: 0, outs: 0, runs: 0, hits: 0, pitches: 0,
    strikeouts: 0, batters: 0, batterHeight: 180, bases: [false, false, false],
    history: [], over: false, win: null, lastResult: null,
  });
  assert.notEqual(createGame().bases, createGame().bases);
  assert.notEqual(createGame().history, createGame().history);
});

test('three strikeouts in exactly nine pitches give a perfect win', () => {
  const game = strikeOuts(createGame());
  assert.equal(game.win, 'perfect');
  assert.equal(game.over, true);
  assert.equal(game.outs, 3);
  assert.equal(game.strikeouts, 3);
  assert.equal(game.pitches, 9);
  assert.equal(game.batters, 3);
  assert.equal(game.balls, 0);
  assert.equal(game.strikes, 0);
  assert.equal(game.history.length, 9);
});

test('each scenario starts with its own score and an empty, fresh inning', () => {
  for (const [scenario, playerScore, opponentScore] of [['exhibition', 0, 0], ['cgso', 1, 0], ['relief', 4, 3]]) {
    const game = createGame(scenario);
    assert.equal(game.scenario, scenario);
    assert.equal(game.playerScore, playerScore);
    assert.equal(game.opponentScore, opponentScore);
    assert.equal(game.runs, 0);
    assert.equal(game.outs, 0);
    assert.equal(game.save, null);
    assert.deepEqual(game.bases, [false, false, false]);
  }
  assert.throws(() => createGame('unknown'), RangeError);
});

test('normal and perfect wins award saves only in relief mode', () => {
  for (const scenario of Object.keys(SCENARIOS)) {
    const perfect = strikeOuts(createGame(scenario));
    assert.equal(perfect.win, 'perfect');
    assert.equal(perfect.save, scenario === 'relief' ? 'save' : null);
    const normal = strikeOuts(resolvePitch(createGame(scenario), 'single'));
    assert.equal(normal.win, 'normal');
    assert.equal(normal.save, scenario === 'relief' ? 'save' : null);
    assert.equal(normal.opponentScore, SCENARIOS[scenario].opponentScore);
  }
});

test('tying and go-ahead runs lose the challenge but never end the inning early', () => {
  for (const scenario of ['cgso', 'relief']) {
    const initial = createGame(scenario);
    let game = resolvePitch(initial, 'home-run');
    assert.equal(game.opponentScore, initial.playerScore);
    assert.equal(game.runs, 1);
    assert.equal(game.over, false);
    assert.equal(game.win, null);
    assert.equal(game.save, scenario === 'relief' ? 'blown-save' : null);
    const tiedEnd = strikeOuts(game);
    assert.equal(tiedEnd.over, true);
    assert.equal(tiedEnd.win, null);
    assert.equal(tiedEnd.save, scenario === 'relief' ? 'blown-save' : null);
    game = resolvePitch(game, 'home-run');
    assert.equal(game.opponentScore, initial.playerScore + 1);
    assert.equal(game.over, false);
    game = strikeOuts(game);
    assert.equal(game.over, true);
    assert.equal(game.win, null);
    assert.equal(game.save, scenario === 'relief' ? 'blown-save' : null);
    assert.equal(initial.opponentScore, SCENARIOS[scenario].opponentScore);
  }
});

test('a bases-loaded walk blows a save and replay starts a new opportunity', () => {
  let game = pitchMany(createGame('relief'), Array(12).fill('ball'));
  assert.equal(game.opponentScore, 3);
  assert.equal(game.save, null);
  game = pitchMany(game, Array(4).fill('ball'));
  assert.equal(game.opponentScore, 4);
  assert.equal(game.save, 'blown-save');
  assert.equal(game.over, false);
  const fresh = createGame(game.scenario);
  assert.equal(fresh.opponentScore, 3);
  assert.equal(fresh.save, null);
  assert.equal(fresh.pitches, 0);
});

test('hits with no runs still allow a normal win', () => {
  const game = strikeOuts(resolvePitch(createGame(), 'double'));
  assert.equal(game.win, 'normal');
  assert.equal(game.hits, 1);
  assert.equal(game.runs, 0);
  assert.deepEqual(game.bases, [false, true, false]);
  assert.equal(game.batters, 4);
});

test('two-strike fouls do not strike out the batter and spoil a nine-pitch perfect win', () => {
  let game = pitchMany(createGame(), ['foul', 'foul', 'foul']);
  assert.equal(game.strikes, 2);
  assert.equal(game.outs, 0);
  assert.equal(game.batters, 0);
  game = resolvePitch(game, 'swinging-strike');
  assert.equal(game.strikes, 0);
  assert.equal(game.strikeouts, 1);
  game = strikeOuts(game, 2);
  assert.equal(game.pitches, 10);
  assert.equal(game.win, 'normal');
});

test('runs never end the inning; a scored-on inning ends only at three outs', () => {
  let game = pitchMany(createGame(), ['home-run', 'home-run']);
  assert.equal(game.runs, 2);
  assert.equal(game.over, false);
  assert.equal(game.win, null);
  game = pitchMany(game, ['in-play-out', 'in-play-out']);
  assert.equal(game.over, false);
  game = resolvePitch(game, 'in-play-out');
  assert.equal(game.over, true);
  assert.equal(game.win, null);
  assert.equal(game.outs, 3);
  assert.equal(game.strikeouts, 0);
  assert.equal(game.pitches, 5);
});

test('a walk forces only contiguous runners for all eight base configurations', () => {
  const cases = [
    [[false, false, false], [true, false, false], 0],
    [[true, false, false], [true, true, false], 0],
    [[false, true, false], [true, true, false], 0],
    [[false, false, true], [true, false, true], 0],
    [[true, true, false], [true, true, true], 0],
    [[true, false, true], [true, true, true], 0],
    [[false, true, true], [true, true, true], 0],
    [[true, true, true], [true, true, true], 1],
  ];
  for (const [bases, expected, runs] of cases) {
    const game = pitchMany({ ...createGame(), bases, strikes: 2 }, Array(4).fill('ball'));
    assert.deepEqual(game.bases, expected, `Walking with bases ${bases}`);
    assert.equal(game.runs, runs);
    assert.equal(game.balls, 0);
    assert.equal(game.strikes, 0);
    assert.equal(game.batters, 1);
    assert.equal(game.hits, 0);
    assert.equal(game.pitches, 4);
    assert.equal(game.over, false);
    assert.equal(game.lastResult.title, 'Walk');
  }
});

test('all hit distances advance every runner and the batter exactly', () => {
  for (const [outcome, distance] of [['single', 1], ['double', 2], ['triple', 3], ['home-run', 4]]) {
    for (let mask = 0; mask < 8; mask += 1) {
      const bases = [0, 1, 2].map((index) => Boolean(mask & (1 << index)));
      const occupied = [0, ...bases.flatMap((occupied, index) => occupied ? [index + 1] : [])];
      const advanced = occupied.map((base) => base + distance);
      const game = resolvePitch({ ...createGame(), bases, balls: 3, strikes: 2 }, outcome);
      assert.deepEqual(game.bases, [1, 2, 3].map((base) => advanced.includes(base)), `${outcome}, bases ${bases}`);
      assert.equal(game.runs, advanced.filter((base) => base >= 4).length);
      assert.equal(game.hits, 1);
      assert.equal(game.batters, 1);
      assert.equal(game.balls, 0);
      assert.equal(game.strikes, 0);
      assert.equal(game.pitches, 1);
      assert.equal(game.outs, 0);
    }
  }
});

test('an in-play out clears the count without moving runners', () => {
  const game = resolvePitch({ ...createGame(), bases: [true, false, true], balls: 2, strikes: 1 }, 'in-play-out');
  assert.deepEqual(game.bases, [true, false, true]);
  assert.equal(game.outs, 1);
  assert.equal(game.strikeouts, 0);
  assert.equal(game.batters, 1);
  assert.equal(game.balls, 0);
  assert.equal(game.strikes, 0);
});

test('resolution never mutates frozen input and records pitch metadata', () => {
  const initial = resolvePitch(createGame(), 'ball', { speed: 80, spin: -600 });
  Object.freeze(initial.bases);
  Object.freeze(initial.lastResult);
  initial.history.forEach(Object.freeze);
  Object.freeze(initial.history);
  Object.freeze(initial);
  const before = structuredClone(initial);
  const metadata = Object.freeze({ speed: 97, spin: 2400, label: 'Fastball' });
  for (const outcome of ['ball', 'called-strike', 'swinging-strike', 'foul', 'single', 'double', 'triple', 'home-run', 'in-play-out']) {
    const next = resolvePitch(initial, outcome, metadata);
    assert.notEqual(next, initial);
    assert.notEqual(next.bases, initial.bases);
    assert.notEqual(next.history, initial.history);
    assert.deepEqual(initial, before);
    assert.equal(next.pitches, 2);
    assert.equal(next.history.length, 2);
    assert.deepEqual(next.history[1], { ...next.lastResult, number: 2, pitches: 2 });
    assert.equal(next.lastResult.speed, 97);
    assert.equal(next.lastResult.spin, 2400);
    assert.equal(next.lastResult.label, 'Fastball');
    assert.equal(next.lastResult.outcome, outcome);
    assert.equal(typeof next.lastResult.title, 'string');
    assert.ok(next.lastResult.detail.length > 0);
  }
});

test('no pitch can be resolved after the inning is over', () => {
  const game = strikeOuts(createGame());
  assert.equal(resolvePitch(game, 'home-run'), game);
  assert.equal(resolvePitch(game, 'unknown'), game);
  assert.equal(game.pitches, 9);
  assert.throws(() => resolvePitch(createGame(), 'unknown'), RangeError);
});

test('strike zone uses inclusive radius-four circle intersection, including corners', () => {
  assert.deepEqual(ZONE, { x: 440, y: 243, width: 100, height: 90 });
  for (const point of [center, { x: 436, y: 270 }, { x: 544, y: 270 }, { x: 490, y: 239 }, { x: 490, y: 337 }]) {
    assert.equal(isStrike(point), true);
  }
  for (const point of [{ x: 435.999, y: 270 }, { x: 544.001, y: 270 }, { x: 490, y: 238.999 }, { x: 490, y: 337.001 }]) {
    assert.equal(isStrike(point), false);
  }
  for (const x of [440, 540]) {
    for (const y of [243, 333]) {
      const dx = x === 440 ? -1 : 1;
      const dy = y === 243 ? -1 : 1;
      assert.equal(isStrike({ x: x + dx * 2.4, y: y + dy * 3.2 }), true);
      assert.equal(isStrike({ x: x + dx * 3, y: y + dy * 3 }), false);
    }
  }
  for (const point of [null, undefined, {}, { x: '440', y: 232 }, { x: NaN, y: 232 }, { x: 440, y: Infinity }]) {
    assert.equal(isStrike(point), false);
  }
});

test('flight samples preserve exact endpoints and signed smooth displacement', () => {
  const points = Object.freeze([Object.freeze({ x: 300, y: 600 }), Object.freeze({ x: 490, y: 295 })]);
  const flat = buildFlight(points, 0);
  const positive = buildFlight(points, 3000);
  const negative = buildFlight(points, -3000);
  for (const flight of [flat, positive, negative]) {
    assert.ok(flight.length >= 60);
    assert.deepEqual(flight[0], points[0]);
    assert.deepEqual(flight.at(-1), points.at(-1));
    assert.notEqual(flight[0], points[0]);
  }
  for (let index = 0; index < flat.length; index += 1) {
    const displacement = Math.sin(Math.PI * index / (flat.length - 1)) * 55;
    assert.ok(Math.abs(positive[index].x - flat[index].x - displacement) < 1e-10);
    assert.ok(Math.abs(negative[index].x - flat[index].x + displacement) < 1e-10);
    assert.equal(positive[index].y, flat[index].y);
  }
  assert.deepEqual(buildFlight(points, 9000), positive);
  assert.deepEqual(buildFlight(points, NaN), flat);
  const bent = buildFlight([points[0], { x: 600, y: 450 }, points[1]], 0);
  assert.deepEqual(bent[30], { x: 600, y: 450 });
});

test('flight handles empty, singleton, invalid, and repeated points safely', () => {
  assert.deepEqual(buildFlight([]), []);
  assert.deepEqual(buildFlight(null), []);
  assert.deepEqual(buildFlight([null, { x: NaN, y: 0 }]), []);
  assert.deepEqual(buildFlight([center], 2000), [center]);
  const repeated = buildFlight([center, center], 0);
  assert.ok(repeated.every((point) => point.x === center.x && point.y === center.y));
});

test('judge allows inside takes and outside takes or swinging misses', () => {
  assert.equal(judgePitch(easyPitch, rolls(0.99)), 'called-strike');
  const outside = { ...easyPitch, points: [straight[0], { x: 550, y: 295 }] };
  assert.equal(judgePitch(outside, rolls(0.99)), 'ball');
  assert.equal(judgePitch(outside, rolls(0, 0)), 'swinging-strike');
  assert.equal(judgePitch(easyPitch, rolls(0, 0)), 'swinging-strike');
  assert.equal(judgePitch({ points: [] }, rolls()), 'ball');
  assert.equal(judgePitch({ points: [center, null] }, rolls()), 'ball');
});

test('judge contact includes fouls, outs, and every base-hit distance', () => {
  assert.equal(judgePitch(easyPitch, rolls(0, 0.99, 0)), 'foul');
  assert.equal(judgePitch(easyPitch, rolls(0, 0.99, 0.4)), 'in-play-out');
  for (const [roll, outcome] of [[0.1, 'single'], [0.75, 'double'], [0.9, 'triple'], [0.99, 'home-run']]) {
    assert.equal(judgePitch(easyPitch, rolls(0, 0.99, 0.99, roll)), outcome);
  }
});

test('speed, absolute spin, curvature, edges, and speed variation affect contact', () => {
  const result = (pitch, contactRoll) => judgePitch(pitch, rolls(0, contactRoll, 0.99, 0.1));
  assert.equal(result(easyPitch, 0.15), 'single');
  assert.equal(result({ ...easyPitch, speed: 105 }, 0.15), 'swinging-strike');
  for (const spin of [-3000, 3000]) {
    assert.equal(result({ ...easyPitch, spin }, 0.15), 'swinging-strike');
    assert.equal(judgePitch({ ...easyPitch, speed: 105, spin }, rolls(0, 0.99, 0.99, 0.99)), 'home-run');
  }
  assert.equal(result({ ...easyPitch, points: [straight[0], { x: 650, y: 450 }, center] }, 0.15), 'swinging-strike');
  assert.equal(result({ ...easyPitch, points: [straight[0], { x: 440, y: 295 }] }, 0.15), 'swinging-strike');
  assert.equal(result(easyPitch, 0.1), 'single');
  assert.equal(result({ ...easyPitch, game: resolvePitch(createGame(), 'ball', { speed: 100 }) }, 0.1), 'swinging-strike');
});

test('judge bases zone calls on the endpoint and does not mutate its inputs', () => {
  const pitch = { ...easyPitch, points: [{ x: 0, y: 0 }, center] };
  const before = structuredClone(pitch);
  assert.equal(judgePitch(pitch, rolls(0.99)), 'called-strike');
  assert.deepEqual(pitch, before);
  assert.equal(judgePitch({ ...pitch, points: [center, { x: 0, y: 0 }] }, rolls(0.99)), 'ball');
});

test('CGSO is the home starter finishing the top of the ninth with a 1-0 lead', () => {
  assert.equal(SCENARIOS.cgso.label, 'CGSO');
  assert.equal(SCENARIOS.cgso.inning, 'Top of the 9th');
  assert.equal(SCENARIOS.relief.inning, 'Bottom of the 9th');
  assert.equal(createGame('cgso').playerScore, 1);
  assert.equal(createGame('cgso').opponentScore, 0);
});

test('pitch-type curves preserve the default release and exact target at any bend or spin', () => {
  const target = Object.freeze({ x: 531, y: 322 });
  const bend = Object.freeze({ x: 40, y: -20 });
  for (const type of Object.keys(PITCH_TYPES)) {
    for (const spin of [-3000, 0, 3000]) {
      const flight = buildPitchFlight(type, target, bend, spin);
      assert.equal(flight.length, 61);
      assert.deepEqual(flight[0], RELEASE);
      assert.deepEqual(flight.at(-1), target);
      assert.notEqual(flight[0], RELEASE);
      assert.notEqual(flight.at(-1), target);
      assert.ok(flight.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
    }
  }
});

test('adjustable release changes every pitch origin without shifting the target or mutating inputs', () => {
  const target = Object.freeze({ x: 531, y: 322 });
  const bend = Object.freeze({ x: 15, y: -10 });
  for (const type of Object.keys(PITCH_TYPES)) {
    for (const spin of [-3000, 0, 3000]) {
      for (const release of [Object.freeze({ x: 420, y: 405 }), Object.freeze({ x: 550, y: 515 })]) {
        const flight = buildPitchFlight(type, target, bend, spin, release);
        assert.deepEqual(flight[0], release);
        assert.notEqual(flight[0], release);
        assert.deepEqual(flight.at(-1), target);
        assert.notDeepEqual(flight, buildPitchFlight(type, target, bend, spin));
        assert.equal(isStrike(flight.at(-1)), isStrike(target));
      }
    }
  }
});

test('each pitch type has a distinct curve and bounded bend adjustment', () => {
  const shapes = Object.keys(PITCH_TYPES).map((type) => buildPitchFlight(type, center));
  assert.notDeepEqual(shapes[0], shapes[1]);
  assert.notDeepEqual(shapes[1], shapes[2]);
  assert.notDeepEqual(shapes[0], shapes[2]);
  for (const [type, pitch] of Object.entries(PITCH_TYPES)) {
    const base = buildPitchFlight(type, center);
    const bent = buildPitchFlight(type, center, { x: 10, y: -10 });
    assert.equal(bent[30].x - base[30].x, 10);
    assert.equal(bent[30].y - base[30].y, -10);
    assert.deepEqual(buildPitchFlight(type, center, { x: 10000, y: -10000 }), buildPitchFlight(type, center, { x: pitch.maxX, y: -pitch.maxY }));
  }
  assert.throws(() => buildPitchFlight('unknown', center), RangeError);
});

test('batter height changes only on completed appearances and remains on the final batter', () => {
  for (const outcome of ['single', 'double', 'triple', 'home-run', 'in-play-out']) {
    const game = resolvePitch(createGame(), outcome);
    assert.equal(game.batterHeight, BATTER_HEIGHTS[1]);
    assert.equal(game.lastResult.batterHeight, BATTER_HEIGHTS[0]);
  }
  let game = createGame();
  for (const outcome of ['ball', 'foul', 'called-strike', 'foul']) {
    game = resolvePitch(game, outcome);
    assert.equal(game.batterHeight, BATTER_HEIGHTS[0]);
  }
  game = resolvePitch(game, 'swinging-strike');
  assert.equal(game.batterHeight, BATTER_HEIGHTS[1]);
  game = pitchMany(game, Array(4).fill('ball'));
  assert.equal(game.batterHeight, BATTER_HEIGHTS[2]);
  const finished = strikeOuts(createGame());
  assert.equal(finished.batterHeight, BATTER_HEIGHTS[2]);
  assert.equal(resolvePitch(finished, 'single'), finished);
  const lineup = pitchMany(createGame(), Array(9).fill('single'));
  assert.equal(lineup.batterHeight, BATTER_HEIGHTS[0]);
});

test('every zone matches standing shoulders and knees with inclusive ball-radius boundaries', () => {
  for (const height of BATTER_HEIGHTS) {
    const zone = batterZone(height);
    const shoulder = 370 + (243 - 370) * height / 180;
    const knees = 370 + (333 - 370) * height / 180;
    assert.ok(Math.abs(zone.y - shoulder) < 1e-10);
    assert.ok(Math.abs(zone.y + zone.height - knees) < 1e-10);
    assert.equal(zone.width, 100);
    assert.equal(isStrike({ x: 490, y: zone.y - 4 }, zone), true);
    assert.equal(isStrike({ x: 490, y: zone.y - 4.01 }, zone), false);
    assert.equal(isStrike({ x: 490, y: zone.y + zone.height + 4 }, zone), true);
    assert.equal(isStrike({ x: 490, y: zone.y + zone.height + 4.01 }, zone), false);
  }
  const pitch = { ...easyPitch, points: [RELEASE, { x: 490, y: 240 }] };
  assert.equal(judgePitch({ ...pitch, game: { ...createGame(), batterHeight: 165 } }, rolls(0.99)), 'ball');
  assert.equal(judgePitch({ ...pitch, game: { ...createGame(), batterHeight: 205 } }, rolls(0.99)), 'called-strike');
  const lowPitch = { ...easyPitch, points: [RELEASE, { x: 490, y: 320 }] };
  assert.equal(judgePitch(lowPitch, rolls(0.99)), 'called-strike');
  assert.equal(judgePitch({ ...lowPitch, points: [RELEASE, { x: 490, y: 338 }] }, rolls(0.99)), 'ball');
});

test('pitcher height raises the body and release and changes flight without changing aim', () => {
  const short = pitcherPoint(RELEASE, 160);
  const tall = pitcherPoint(RELEASE, 210);
  assert.ok(tall.y < short.y);
  assert.equal(tall.x, short.x);
  assert.deepEqual(pitcherPoint({ x: 350, y: 580 }, 210), { x: 350, y: 580 });
  const shortFlight = buildPitchFlight('fastball', center, undefined, 1200, short);
  const tallFlight = buildPitchFlight('fastball', center, undefined, 1200, tall);
  assert.notDeepEqual(shortFlight[30], tallFlight[30]);
  assert.deepEqual(shortFlight.at(-1), tallFlight.at(-1));
});

test('slow curveballs develop an eephus arc continuously below 65 MPH', () => {
  const curve = (speed) => buildPitchFlight('curveball', center, { x: 0, y: 0 }, 0, RELEASE, speed);
  const apex = (flight) => Math.min(...flight.map((point) => point.y));
  assert.deepEqual(curve(78), curve(65));
  assert.ok(apex(curve(30)) < apex(curve(50)) - 50);
  assert.ok(apex(curve(50)) < apex(curve(65)));
  assert.ok(apex(curve(30)) < center.y - 100);
  assert.ok(Math.abs(curve(64.99)[30].y - curve(65)[30].y) < 0.001);
  for (const type of ['fastball', 'slider']) {
    assert.deepEqual(buildPitchFlight(type, center, undefined, 0, RELEASE, 35), buildPitchFlight(type, center, undefined, 0, RELEASE, 90));
  }
});

test('all pitches can ride upward late; breaking pitches also allow high loops', () => {
  for (const [type, pitch] of Object.entries(PITCH_TYPES)) {
    for (const speed of [pitch.minSpeed, 65, pitch.maxSpeed]) {
      const rising = buildPitchFlight(type, center, { x: 0, y: pitch.maxY }, 0, RELEASE, speed);
      const looping = buildPitchFlight(type, center, { x: 0, y: -pitch.maxY }, 0, RELEASE, speed);
      assert.ok(rising[50].y > center.y + 10, `${type} at ${speed} has a late upward finish`);
      if (type !== 'fastball') assert.ok(Math.min(...looping.map((point) => point.y)) < center.y - 40);
      for (const flight of [rising, looping]) {
        assert.deepEqual(flight[0], RELEASE);
        assert.deepEqual(flight.at(-1), center);
        assert.equal(judgePitch({ points: flight, speed, game: createGame() }, rolls(0.99)), 'called-strike');
      }
    }
  }
});

test('fastball bend is much tighter than breaking pitches and clamps both axes', () => {
  const fastball = PITCH_TYPES.fastball;
  assert.equal(fastball.maxX, 10);
  assert.equal(fastball.maxY, 35);
  for (const type of ['slider', 'curveball']) {
    assert.ok(fastball.maxX < PITCH_TYPES[type].maxX / 4);
    assert.ok(fastball.maxY < PITCH_TYPES[type].maxY / 4);
  }
  const base = buildPitchFlight('fastball', center);
  for (const sign of [-1, 1]) {
    const path = buildPitchFlight('fastball', center, { x: sign * 1000, y: sign * 1000 });
    assert.equal(path[30].x - base[30].x, sign * 10);
    assert.equal(path[30].y - base[30].y, sign * 35);
    assert.deepEqual(path[0], RELEASE);
    assert.deepEqual(path.at(-1), center);
  }
});

test('extreme vertical paths stay visible and preserve endpoints across height and aim limits', () => {
  for (const type of Object.keys(PITCH_TYPES)) {
    for (const release of [pitcherPoint({ x: 420, y: 405 }, 210), pitcherPoint({ x: 550, y: 515 }, 160)]) {
      for (const target of [{ x: 350, y: 180 }, { x: 650, y: 410 }]) {
        for (const y of [-10000, 10000]) {
          const path = buildPitchFlight(type, target, { x: 0, y }, 3000, release, 35);
          assert.deepEqual(path[0], release);
          assert.deepEqual(path.at(-1), target);
          assert.ok(path.every((point) => point.y >= 45 - 1e-10 && point.y <= 600 + 1e-10));
        }
      }
    }
  }
});

test('35 MPH still permits misses, contact, and correct taken calls', () => {
  assert.equal(judgePitch({ ...easyPitch, speed: 35 }, rolls(0, 0)), 'swinging-strike');
  assert.equal(judgePitch({ ...easyPitch, speed: 35 }, rolls(0, 0.99, 0.99, 0.99)), 'home-run');
  assert.equal(judgePitch({ ...easyPitch, speed: 35 }, rolls(0.99)), 'called-strike');
  assert.equal(judgePitch({ ...easyPitch, speed: 35, points: [RELEASE, { x: 650, y: 300 }] }, rolls(0.99)), 'ball');
});

test('CGSO batters chase less, attack strikes, miss less, and punish contact', () => {
  const normal = { ...easyPitch, game: createGame('exhibition') };
  const hard = { ...easyPitch, game: createGame('cgso') };
  const outside = [RELEASE, { x: 550, y: center.y }];
  assert.equal(judgePitch({ ...normal, points: outside }, rolls(0.2, 0)), 'swinging-strike');
  assert.equal(judgePitch({ ...hard, points: outside }, rolls(0.2)), 'ball');
  assert.equal(judgePitch(normal, rolls(0.85)), 'called-strike');
  assert.equal(judgePitch(hard, rolls(0.85, 0.99, 0.99, 0.1)), 'single');
  assert.equal(judgePitch(normal, rolls(0, 0.06)), 'swinging-strike');
  assert.equal(judgePitch(hard, rolls(0, 0.06, 0.99, 0.1)), 'single');
  assert.equal(judgePitch(normal, rolls(0, 0.99, 0.45)), 'in-play-out');
  assert.equal(judgePitch(hard, rolls(0, 0.99, 0.45, 0.1)), 'single');
  assert.equal(judgePitch(normal, rolls(0, 0.99, 0.99, 0.85)), 'double');
  assert.equal(judgePitch(hard, rolls(0, 0.99, 0.99, 0.85)), 'home-run');
  assert.equal(judgePitch(hard, rolls(0, 0)), 'swinging-strike');
  assert.equal(judgePitch(hard, rolls(0.99)), 'called-strike');
});

test('Relief and Exhibition keep identical batting behavior over seeded pitches', () => {
  for (let seed = 1; seed <= 500; seed++) {
    const random = () => {
      let state = seed;
      return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    };
    const pitch = { points: [RELEASE, { x: 430 + seed % 130, y: 230 + seed % 90 }], speed: 35 + seed % 71, spin: -3000 + seed * 12 };
    assert.equal(judgePitch({ ...pitch, game: createGame('relief') }, random()), judgePitch({ ...pitch, game: createGame('exhibition') }, random()));
  }
});

test('pitch-specific speed limits apply to flight and batting, including 120 MPH', () => {
  for (const [type, min, max] of [['fastball', 60, 120], ['slider', 60, 99], ['curveball', 30, 90]]) {
    assert.equal(PITCH_TYPES[type].minSpeed, min);
    assert.equal(PITCH_TYPES[type].maxSpeed, max);
    for (const [input, expected] of [[0, min], [200, max]]) {
      assert.deepEqual(buildPitchFlight(type, center, undefined, 0, RELEASE, input), buildPitchFlight(type, center, undefined, 0, RELEASE, expected));
      const params = { ...easyPitch, pitchType: type };
      assert.equal(judgePitch({ ...params, speed: input }, rolls(0, 0.25, 0.99, 0.1)), judgePitch({ ...params, speed: expected }, rolls(0, 0.25, 0.99, 0.1)));
    }
  }
  assert.equal(judgePitch({ ...easyPitch, pitchType: 'fastball', speed: 105 }, rolls(0, 0.20, 0.99, 0.1)), 'single');
  assert.equal(judgePitch({ ...easyPitch, pitchType: 'fastball', speed: 120 }, rolls(0, 0.20)), 'swinging-strike');
});

test('view projection agrees with SVG control planes and preserves upright height', () => {
  for (const t of [0, 0.5, 1]) {
    const [a, b, c, d, e, f] = pitchPlaneTransform(t).slice(7, -1).split(' ').map(Number);
    for (const point of [RELEASE, center, { x: 550, y: 405 }]) {
      const projected = projectPitchPoint(point, t);
      assert.ok(Math.abs(projected.x - (a * point.x + c * point.y + e)) < 1e-10);
      assert.ok(Math.abs(projected.y - (b * point.x + d * point.y + f)) < 1e-10);
      const higher = projectPitchPoint({ ...point, y: point.y - 30 }, t);
      assert.equal(higher.x, projected.x);
      assert.ok(higher.y < projected.y);
    }
  }
  assert.ok(projectPitchPoint(center, 1).x > projectPitchPoint(RELEASE, 0).x + 300);
});

test('pitch history records batter, pre-pitch count and first immaculate-bid failure', () => {
  let game = pitchMany(createGame(), ['foul', 'foul', 'foul', 'swinging-strike', 'ball']);
  assert.deepEqual(game.history.map((p) => p.batterNumber), [1, 1, 1, 1, 2]);
  assert.deepEqual(game.history.map((p) => [p.ballsBefore, p.strikesBefore]), [[0, 0], [0, 1], [0, 2], [0, 2], [0, 0]]);
  assert.deepEqual(game.history.map((p) => p.immaculateAlive), [true, true, false, false, false]);
  assert.equal(game.history.find((p) => !p.immaculateAlive).number, 3);
  for (const outcome of ['ball', 'single', 'home-run', 'in-play-out']) {
    game = resolvePitch(createGame(), outcome);
    assert.equal(game.lastResult.immaculateAlive, false);
    assert.equal(game.lastResult.batterNumber, 1);
  }
  assert.ok(strikeOuts(createGame()).history.every((p) => p.immaculateAlive));
});
