import test from 'node:test';
import { projectPitchPoint, pitchPlaneTransform } from './view.js';
import assert from 'node:assert/strict';
import { createGame as engineCreateGame, resolvePitch as engineResolvePitch, SCENARIOS, RELEASE, PITCH_TYPES, buildPitchFlight, ZONE, isStrike, buildFlight, judgePitch, batterZone, pitcherPoint } from './engine.js';

const createGame = (scenario, pitcherHand) => engineCreateGame(scenario, pitcherHand, () => 0.375);
const resolvePitch = (game, outcome, metadata) => engineResolvePitch(game, outcome, metadata, () => 0.375);
const batterHeights = Array.from({ length: 41 }, (_, index) => 165 + index);
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
    scenario: 'exhibition', pitcherHand: 'R', playerScore: 0, opponentScore: 0, save: null,
    balls: 0, strikes: 0, outs: 0, runs: 0, hits: 0, pitches: 0,
    strikeouts: 0, batters: 0, batterHeight: 180, batterHand: 'R', bases: [false, false, false],
    history: [], over: false, win: null, lastResult: null,
  });
  assert.notEqual(createGame().bases, createGame().bases);
  assert.notEqual(createGame().history, createGame().history);
});

test('games validate pitcher hand and sample a fresh first batter in every scenario', (t) => {
  for (const scenario of Object.keys(SCENARIOS)) {
    assert.equal(createGame(scenario).pitcherHand, 'R');
    for (const pitcherHand of ['R', 'L']) {
      const random = t.mock.fn(rolls(0, 0, 1 - Number.EPSILON, 0.5));
      const game = engineCreateGame(scenario, pitcherHand, random);
      const before = structuredClone(game);
      assert.equal(game.pitcherHand, pitcherHand);
      assert.equal(game.batterHeight, 165);
      assert.equal(game.batterHand, 'R');
      assert.equal(random.mock.callCount(), 2);
      const replay = engineCreateGame(scenario, game.pitcherHand, random);
      assert.deepEqual(replay, { ...game, batterHeight: 205, batterHand: 'L' });
      assert.equal(random.mock.callCount(), 4);
      assert.notEqual(replay, game);
      assert.notEqual(replay.bases, game.bases);
      assert.notEqual(replay.history, game.history);
      assert.deepEqual(game, before);
    }
    for (const invalid of ['r', 'l', '', 'switch', null, 0, {}, ['R']]) {
      assert.throws(() => createGame(scenario, invalid), RangeError);
    }
  }
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

test('all four hand matchups apply exact arcade miss and out advantages across scenarios', () => {
  for (const scenario of Object.keys(SCENARIOS)) {
    const hard = scenario === 'cgso';
    for (const pitcherHand of ['R', 'L']) {
      for (const batterHand of ['R', 'L']) {
        const sameHand = pitcherHand === batterHand;
        const game = { ...createGame(scenario, pitcherHand), batterHand, history: [{ speed: 95 }] };
        for (const [speed, spin, points, difficulty, strike] of [
          [65, 0, straight, 0.10, true],
          [120, 3000, straight, 0.62, true],
          [120, 3000, [{ x: 550, y: 600 }, { x: 550, y: center.y }], 0.82, false],
        ]) {
          const pitch = { points, speed, spin, game };
          const baseMiss = (0.08 + 0.48 * difficulty + (strike ? 0 : 0.22)) * (hard ? 0.45 : 1);
          const miss = Math.min(1, Math.max(0, baseMiss * (sameHand ? 1.15 : 0.85)));
          const foul = hard ? 0.22 + 0.08 * difficulty : 0.28 + 0.12 * difficulty;
          const baseOut = foul + (hard ? 0.12 + 0.08 * difficulty : 0.24 + 0.12 * difficulty);
          const out = baseOut + (sameHand ? 0.03 : -0.03);
          const label = `${scenario} ${pitcherHand}/${batterHand}, ${speed} MPH, strike=${strike}`;
          assert.equal(judgePitch(pitch, rolls(0, baseMiss, 0.99, 0)), sameHand ? 'swinging-strike' : 'single', label);
          assert.equal(judgePitch(pitch, rolls(0, miss - 1e-8)), 'swinging-strike', label);
          assert.equal(judgePitch(pitch, rolls(0, miss + 1e-8, 0.99, 0)), 'single', label);
          assert.equal(judgePitch(pitch, rolls(0, 0.99, baseOut, 0)), sameHand ? 'in-play-out' : 'single', label);
          assert.equal(judgePitch(pitch, rolls(0, 0.99, out - 1e-8)), 'in-play-out', label);
          assert.equal(judgePitch(pitch, rolls(0, 0.99, out + 1e-8, 0)), 'single', label);
          assert.equal(judgePitch(pitch, rolls(0, 0.99, foul - 1e-8)), 'foul', label);
          assert.equal(judgePitch(pitch, rolls(0, 0.99, foul + 1e-8)), 'in-play-out', label);
          assert.equal(judgePitch(pitch, rolls(0.99)), strike ? 'called-strike' : 'ball', label);
        }
      }
    }
  }
  assert.equal(judgePitch({ ...easyPitch, game: undefined }, rolls(0, 0.08)), 'swinging-strike');
});

test('hand matchups leave swing decisions and height-dependent taken calls unchanged', () => {
  for (const scenario of Object.keys(SCENARIOS)) {
    for (const pitcherHand of ['R', 'L']) {
      for (const batterHand of ['R', 'L']) {
        for (const batterHeight of batterHeights) {
          const game = { ...createGame(scenario, pitcherHand), batterHand, batterHeight };
          const zone = batterZone(batterHeight);
          for (const [x, strike] of [[490, true], [550, false]]) {
            const target = { x, y: zone.y + zone.height / 2 };
            const pitch = { points: [{ x, y: 600 }, target], speed: 65, game };
            const swing = strike ? (scenario === 'cgso' ? 0.94 : 0.78)
              : (0.10 + 0.30 * Math.exp(-10 / 45) + 0.12 * 0.20) * (scenario === 'cgso' ? 0.4 : 1);
            assert.equal(judgePitch(pitch, rolls(swing - 1e-8, 0)), 'swinging-strike');
            assert.equal(judgePitch(pitch, rolls(swing + 1e-8)), strike ? 'called-strike' : 'ball');
          }
        }
      }
    }
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

test('batter sampling floors every height from 165 to 205 independently of the hand threshold', (t) => {
  for (const height of batterHeights) {
    for (const heightRoll of [(height - 165) / 41 + (height === 165 ? 0 : Number.EPSILON), (height - 164) / 41 - Number.EPSILON]) {
      for (const [handRoll, hand] of [[0, 'R'], [0.5 - Number.EPSILON, 'R'], [0.5, 'L'], [1 - Number.EPSILON, 'L']]) {
        const random = t.mock.fn(rolls(heightRoll, handRoll, heightRoll, handRoll));
        const first = engineCreateGame(undefined, undefined, random);
        assert.equal(random.mock.callCount(), 2);
        const next = engineResolvePitch(first, 'single', {}, random);
        assert.equal(random.mock.callCount(), 4);
        for (const game of [first, next]) {
          assert.equal(game.batterHeight, height);
          assert.equal(game.batterHand, hand);
        }
      }
    }
  }
});

test('every completed outcome samples exactly one next batter, never during the at-bat', (t) => {
  for (const scenario of Object.keys(SCENARIOS)) {
    for (const pitcherHand of ['R', 'L']) {
      for (const outcomes of [
        ['single'], ['double'], ['triple'], ['home-run'], ['in-play-out'],
        Array(4).fill('ball'), Array(3).fill('called-strike'), Array(3).fill('swinging-strike'),
      ]) {
        let game = createGame(scenario, pitcherHand);
        const random = t.mock.fn(rolls(0.99, 0.75));
        for (const [index, outcome] of outcomes.entries()) {
          const completed = index === outcomes.length - 1;
          game = engineResolvePitch(game, outcome, {}, random);
          assert.equal(random.mock.callCount(), completed ? 2 : 0);
          assert.equal(game.batters, completed ? 1 : 0);
          assert.equal(game.batterHand, completed ? 'L' : 'R');
          assert.equal(game.batterHeight, completed ? 205 : 180);
          assert.equal(game.pitcherHand, pitcherHand);
          assert.equal(game.lastResult.batterHand, 'R');
          assert.equal(game.lastResult.batterHeight, 180);
          assert.equal(game.history.at(-1).batterHand, 'R');
          assert.equal(game.history.at(-1).batterHeight, 180);
        }
      }
    }
  }
});

test('unfinished at-bats and final batters hold both traits without consuming RNG', () => {
  for (const scenario of Object.keys(SCENARIOS)) {
    for (const batterHand of ['R', 'L']) {
      const initial = { ...createGame(scenario), batterHeight: 193, batterHand };
      let game = initial;
      for (const outcome of ['ball', 'ball', 'ball', 'called-strike', 'swinging-strike', 'foul', 'foul']) {
        game = engineResolvePitch(game, outcome, {}, rolls());
        assert.equal(game.batters, 0);
        assert.equal(game.batterHand, batterHand);
        assert.equal(game.batterHeight, 193);
      }
      for (const outcomes of [['in-play-out'], Array(3).fill('called-strike'), Array(3).fill('swinging-strike')]) {
        const finished = outcomes.reduce((state, outcome) => engineResolvePitch(state, outcome, {}, rolls()), { ...initial, outs: 2 });
        assert.equal(finished.over, true);
        assert.equal(finished.batters, initial.batters + 1);
        assert.equal(finished.batterHand, initial.batterHand);
        assert.equal(finished.batterHeight, initial.batterHeight);
        assert.equal(finished.lastResult.batterHand, initial.batterHand);
        assert.equal(finished.lastResult.batterHeight, initial.batterHeight);
        for (const outcome of ['single', 'ball', 'called-strike', 'unknown']) {
          assert.equal(engineResolvePitch(finished, outcome, {}, rolls()), finished);
        }
      }
    }
  }
});

test('sampling continues beyond nine batters without wrapping or mutating pre-pitch snapshots', (t) => {
  for (const pitcherHand of ['R', 'L']) {
    const samples = Array.from({ length: 13 }, (_, index) => [165 + index, index % 3 === 0 ? 'L' : 'R']);
    const random = t.mock.fn(rolls(...samples.flatMap(([height, hand]) => [(height - 165 + 0.5) / 41, hand === 'R' ? 0.25 : 0.75])));
    let game = engineCreateGame('relief', pitcherHand, random);
    for (let batter = 0; batter < 12; batter += 1) {
      const before = structuredClone(game);
      Object.freeze(game.bases);
      game.history.forEach(Object.freeze);
      Object.freeze(game.history);
      if (game.lastResult) Object.freeze(game.lastResult);
      Object.freeze(game);
      const metadata = Object.freeze({ pitcherHand: 'spoofed', batterHand: 'spoofed', batterHeight: -1, speed: 92 });
      const next = engineResolvePitch(game, 'single', metadata, random);
      assert.equal(random.mock.callCount(), (batter + 2) * 2);
      assert.equal(next.batters, batter + 1);
      assert.deepEqual([next.batterHeight, next.batterHand], samples[batter + 1]);
      assert.deepEqual(game, before);
      assert.equal(next.lastResult.pitcherHand, pitcherHand);
      assert.deepEqual([next.lastResult.batterHeight, next.lastResult.batterHand], samples[batter]);
      assert.deepEqual(next.history.at(-1), { spin: undefined, ...next.lastResult, number: batter + 1, pitches: batter + 1 });
      assert.deepEqual(next.history.slice(0, -1), before.history);
      game = next;
    }
    assert.deepEqual(game.history.map((pitch) => [pitch.batterHeight, pitch.batterHand]), samples.slice(0, -1));
    assert.ok(game.history.every((pitch) => pitch.pitcherHand === pitcherHand));
  }
});

test('left-handed flight mirrors only intrinsic break and leaves manual bend and spin world-relative', () => {
  const target = Object.freeze({ x: 521, y: 306 });
  for (const [type, pitch] of Object.entries(PITCH_TYPES)) {
    const right = buildPitchFlight(type, target);
    assert.deepEqual(buildPitchFlight(type, target, undefined, 0, RELEASE, undefined, 'R'), right);
    const left = buildPitchFlight(type, target, undefined, 0, RELEASE, undefined, 'L');
    for (const hand of ['R', 'L']) {
      const base = hand === 'R' ? right : left;
      for (const sign of [-1, 1]) {
        const bend = Object.freeze({ x: sign * 10000, y: 0 });
        const manual = buildPitchFlight(type, target, bend, sign * 3000, RELEASE, undefined, hand);
        assert.deepEqual(manual[0], RELEASE);
        assert.deepEqual(manual.at(-1), target);
        for (let index = 1; index < manual.length - 1; index += 1) {
          const weight = Math.sin(Math.PI * index / 60);
          assert.ok(Math.abs(manual[index].x - base[index].x - sign * (pitch.maxX + 55) * weight) < 1e-10);
          assert.equal(manual[index].y, base[index].y);
        }
      }
    }
    for (let index = 0; index < right.length; index += 1) {
      const t = index / 60;
      const shape = Math.sin(Math.PI * t) * (1 + pitch.late * (t - 0.5));
      assert.ok(Math.abs(right[index].x - left[index].x - 2 * pitch.breakX * shape) < 1e-10);
      assert.equal(right[index].y, left[index].y);
    }
  }
});

test('mirrored release, target, spin, and bend produce reflected flights across heights and speed limits', () => {
  for (const [type, pitch] of Object.entries(PITCH_TYPES)) {
    for (const height of [160, 180, 210]) {
      const release = Object.freeze(pitcherPoint(RELEASE, height));
      const mirroredRelease = Object.freeze({ ...release, x: 2 * 379 - release.x });
      for (const batterHeight of batterHeights) {
        const zone = batterZone(batterHeight);
        const target = Object.freeze({ x: 521, y: zone.y + zone.height / 2 });
        const mirroredTarget = Object.freeze({ ...target, x: 2 * 490 - target.x });
        for (const speed of [pitch.minSpeed, pitch.speed, pitch.maxSpeed]) {
          for (const sign of [-1, 0, 1]) {
            const bend = Object.freeze({ x: sign * pitch.maxX, y: sign * pitch.maxY });
            const mirroredBend = Object.freeze({ ...bend, x: -bend.x });
            const right = buildPitchFlight(type, target, bend, sign * 3000, release, speed, 'R');
            const left = buildPitchFlight(type, mirroredTarget, mirroredBend, -sign * 3000, mirroredRelease, speed, 'L');
            assert.deepEqual(right[0], release);
            assert.deepEqual(left[0], mirroredRelease);
            assert.deepEqual(right.at(-1), target);
            assert.deepEqual(left.at(-1), mirroredTarget);
            for (let index = 0; index < right.length; index += 1) {
              const t = index / 60;
              // The body and plate use different mirror axes; interpolate along the pitch plane.
              const axis = 379 + (490 - 379) * t;
              assert.ok(Math.abs(left[index].x + right[index].x - 2 * axis) < 1e-10);
              assert.equal(left[index].y, right[index].y);
              assert.ok(left[index].y >= 45 - 1e-10 && left[index].y <= 600 + 1e-10);
            }
          }
        }
      }
    }
  }
});

test('every zone matches standing shoulders and knees with inclusive ball-radius boundaries', () => {
  for (const height of batterHeights) {
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
  assert.equal(judgePitch({ ...easyPitch, pitchType: 'fastball', speed: 105 }, rolls(0, 0.23, 0.99, 0.1)), 'single');
  assert.equal(judgePitch({ ...easyPitch, pitchType: 'fastball', speed: 120 }, rolls(0, 0.23)), 'swinging-strike');
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
