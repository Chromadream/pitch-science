# Pitch Science

A one-inning baseball game with SVG artwork, adjustable pitch-type curves, and velocity and spin controls. Built with vanilla JavaScript and Vite.

## Run locally

Use Node.js 22.12 or later.

```sh
npm install
npm run dev
```

Open the local URL that Vite prints, usually `http://localhost:5173`.

## Play

1. Choose Fastball, Curveball, or Slider.
2. Drag RELEASE at the foreground pitcher's hand to set arm height and reach.
3. Drag TARGET to aim at the plate.
4. Drag BEND, or the curve itself, to adjust the pitch shape.
5. Set velocity and spin with the sliders.
6. Select **Throw pitch**, or press Space.

The SVG scene uses an angled, parallel-projection ballpark view inspired by an offset broadcast camera, not a 3D physics engine.
The pitcher stands on a raised mound to the left, with home plate farther back to the right.
Players, release guides, strike zones, and pitch paths share the same projection. Drag controls map back to the unchanged pitching coordinates.
The arm follows the release handle. A dashed height guide and ground shadow show where the hand sits above the mound.
Up and down adjusts arm height; left and right adjusts reach within the release area. There is no freehand drawing.
The target marks where the ball crosses the plate. Spin bends the flight without changing either endpoint.

Fastball has a small break, Curveball has a looping drop, and Slider breaks sideways later in flight.
Each type limits how far you can move its bend. Changing pitch type preserves your release and target and loads that type's velocity and spin.
Slider adjustments keep the pitch type selected. Reset curve restores its bend without changing your release, target, velocity, or spin.
Restarting the inning restores the default release position.

Mouse, pen, touch, and keyboard controls are supported. A focused release, target, or bend handle moves with the arrow keys. Shift increases the step.

The batter can take, miss, or make contact. Velocity, spin, path shape, target location, and speed changes affect the outcome.

Completed pitches remain as dashed trails with numbered endpoints during the current at-bat. The solid gold line previews your next pitch.
Endpoint colors adapt the [Baseball Savant Gamefeed](https://baseballsavant.mlb.com/gamefeed) pitch-result palette:

- Orange **S**: called strikes, swinging strikes, and fouls that add a strike.
- Blue **B**: balls, including ball four.
- Red **H**: hits, including home runs.
- Green **F**: fouls when the batter already has two strikes. The count does not change.
- Purple **O**: automatic in-play outs.

This is an adaptation, not a universal standard. Savant distinguishes called and swinging strikes and uses green for all fouls.
The game groups strikes together and highlights two-strike fouls separately. Each marker also has a result letter and accessible description.

Adjusting controls does not change previous trails. Each completed at-bat pauses with all its pitches, including the final pitch, visible.
Select **Next batter** to clear the trails and continue. The old batter and strike zone stay visible until then, and pitching controls are disabled.
After the third out, select **View results** when you finish reviewing. Restart or scenario change also clears the trails.

The results screen includes every pitch in a table grouped by batter. Rows show pitch number, type, velocity, spin, pre-pitch count, and result.
The first pitch that ends the immaculate bid is highlighted and identified above the table.
A ball, hit, in-play out, or foul with two strikes ends the bid. Earlier fouls can still contribute to a nine-pitch immaculate inning.

### Eephus and upward ride

Velocity depends on pitch type: fastballs **60-120 MPH**, sliders **60-99 MPH**, and curveballs **30-90 MPH**.
Selecting a pitch type updates the slider limits and loads its default velocity.
Curveballs below 65 MPH gain a progressively larger eephus-style arc, largest at 30 MPH.
Drag BEND up to exaggerate the loop. A slower pitch also takes longer to reach the plate.

Every pitch type supports a late upward ride. Drag BEND down to lower the middle of the flight so it climbs into the target.
Fastballs have a tight bend range for subtle adjustments and upward ride, rather than large loops.
Sliders and curveballs retain their broader bend ranges. Drag BEND up for a high arc on these breaking pitches.
Spin controls sideways movement independently of the bend handle.
These are arcade-style paths, not a realistic aerodynamic simulation. Extreme bends scale smoothly to stay within the field view.
The preview and thrown ball use the same path. Release and target positions do not change with speed or bend adjustments.

## Rules

### Player height

The pitcher-height slider ranges from 160 to 210 cm. It scales the body around the planted feet and changes the release height.
Your chosen arm slot stays relative to the body. A taller pitcher releases higher, changing the flight angle without changing the target or speed.
Set pitcher height before the inning's first pitch. The slider locks after that pitch. Restarting or changing scenarios keeps the selected height. You can change it before the next inning's first pitch.

Every new batter gets a random whole-centimeter height from 165 to 205 cm, with each height equally likely.
This includes the first batter of each inning, restart, and replay. There is no fixed or repeating lineup.
Height stays fixed through balls, strikes, fouls, and at-bat review. The game generates the next batter after hits, walks, and outs, except the final out.

The arcade strike zone extends from the standing batter's shoulders to their knees. Its width stays fixed over the plate.
The SVG body, zone drawing, target preview, and umpire share the same geometry. This is a game rule, not the MLB strike-zone definition.
Your target stays fixed when the next batter arrives, so check its position against the new zone.

### Platoon matchups

Choose **Pitcher handedness** below the field. Each new batter has an independently random batting side, with equal chances of right or left.
Height and handedness do not depend on the batter number or pitcher hand. Consecutive batters can share either attribute.
The matchup display identifies the batter's side and which player has the advantage.
Same-handed matchups favor the pitcher; opposite-handed matchups favor the batter in every scenario.
The game multiplies swing-and-miss probability by 1.15 for same-handed matchups and 0.85 for opposite-handed matchups.
It also adds or subtracts three percentage points from in-play-out probability on contact, without changing foul probability.
These are arcade balance settings, not measured MLB splits. Taken ball/strike calls and scoring rules stay unchanged.

Changing hands mirrors the pitcher, release reach, horizontal bend, and spin without moving the target.
Pitch presets mirror their sideways movement for left-handers. Manual spin and bend controls keep their labeled directions.
Left-handed batters stand on the opposite side of the plate. Batting side stays fixed during the at-bat and review.
Pitch history records both hands for each throw, even if you change hands during an at-bat.

You can change pitching hands between pitches, an arcade option rather than an MLB rule.
The selector locks during flight, at-bat review, and after the inning ends.
Your chosen hand stays selected across restarts, replays, and scenario changes.

### Scenarios

The difficulty selector offers four scenarios. All start with empty bases and no outs.
CGSO uses much harder batters. Exhibition and both Relief scenarios use the standard batting difficulty.
CGSO batters chase fewer balls, attack more strikes, miss less often, and produce more hits and extra bases on contact.
Pitch location, movement, and speed changes still affect their chances. Ball/strike rules and win conditions stay the same.

| Scenario | Starting score | Goal |
| --- | --- | --- |
| Exhibition | Your team 0, opponent 0 | Complete a scoreless inning. |
| CGSO | Your team 1, opponent 0 | Finish the top of the ninth for a complete-game shutout. |
| Relief pitching | Your team 4, opponent 3 | Close the bottom of the ninth for a save. |
| Relief pitching (easy) | Your team 4, opponent 1 | Protect the lead and earn a save. |

The game score includes the starting scores. Runs allowed counts only runs scored during your inning.

CGSO assumes that you already pitched eight scoreless innings for the home team. Only the final inning is playable.
A scoreless top of the ninth ends the game with your team ahead 1-0. The bottom of the ninth is not needed.
Both Relief scenarios place you on the visiting team for the bottom of the ninth. Standard Relief starts with a 4-3 lead. Easy Relief starts with a 4-1 lead, the largest ninth-inning lead that qualifies as a save opportunity without other conditions.

In either Relief scenario, a scoreless Normal Win or Perfect Win also earns a **Save**. Easy Relief gives you room to allow one or two runs. If you protect the lead, the result is a **Relief Win** and a **Save**. Allowing the tying run produces a **Blown Save**.
The inning continues until three outs, even after a tying or go-ahead run. A tied final score loses the challenge; there are no extra innings.

Changing scenarios during an inning requires confirmation. Restart and replay keep the selected scenario and restore its starting score.

- A taken pitch that touches the strike zone counts as a strike. A taken pitch outside the zone counts as a ball.
- A swing and miss always counts as a strike.
- Three strikes produce an out. Four balls produce a walk.
- A foul adds a strike unless the batter already has two strikes.
- Contact can produce a foul, an automatic out, or a single, double, triple, or home run.
- Hits advance every runner by the hit distance. Runners hold on automatic outs. Walks advance only forced runners.
- The inning ends at three outs, even if the opponent scores earlier.

**Normal Win:** complete the inning without allowing a run. Hits and walks do not prevent this win.

**Perfect Win:** record three strikeouts on exactly nine pitches. A foul before the second strike can count toward this total.

**Relief Win:** in Easy Relief, allow one or two runs, record three outs, and keep the lead.

Runs allowed end the win in Exhibition, CGSO, and standard Relief. There is no manual fielding, stealing, or double-play system.

## Checks

```sh
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

If Google Chrome is already installed, the browser tests can use it instead:

```sh
PLAYWRIGHT_CHROME=1 npm run test:browser
```

The rules tests cover scoring, walks, strike-zone boundaries, pitch outcomes, and win conditions. Browser tests cover full innings and desktop and mobile controls.

## Deploy

The GitHub Pages workflow runs the rules tests, builds the game, and deploys `dist/` whenever a commit reaches `main`. You can also run it manually from the repository's Actions tab.

Before the first deployment, open **Settings > Pages** in the GitHub repository and set **Source** to **GitHub Actions**. The workflow reads the Pages base path during the build, so both project URLs such as `https://<user>.github.io/pitch-science/` and custom domains resolve assets correctly.

To test a project Pages build locally:

```sh
BASE_PATH=/pitch-science npm run build
npm run preview
```

The workflow publishes the generated files as a Pages artifact. It does not commit `dist/` to the repository.

## Files

- `src/engine.js`: pure baseball rules and pitch simulation.
- `src/main.js`: SVG ballpark, controls, flight animation, and game state.
- `src/style.css`: responsive layouts and light and dark themes.
- `src/engine.test.js`: rules tests with Node's test runner.
- `tests/game.spec.js`: Playwright browser tests.

All artwork and fonts load locally. The game requires no backend and does not persist innings after a page reload.
