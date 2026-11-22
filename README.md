# Lunar — Pulse & Blush

A React Three Fiber / WebGL experience on top of the ZED tracking library. The starfield
displaces particles around the **whole skeleton**, with per-joint distance to the projection
wall controlling the deformation. Particles animate in vertex shaders, with additive light,
depth-like particle layers, and bloom. The shared Lightbox color direction runs from cobalt
through lunar violet to rose, with **Lunar eclipse**, **Moonrise**, and **Blush** palette variants.
The default is 90,000 particles; the studio exposes
15,000–150,000, field strength/radius, sky rotation, exposure, palettes, and three presets.

The **canvas backing buffer is always 3840 × 1080** at DPR 1. The studio scales its preview
with CSS. **Launch output**, `H`, or `/?output` opens a clean 32:9 view, letterboxed to fit
other screen shapes. `Space` pauses; `H` returns to the studio. Fullscreen requires a click.

## Start here

```sh
npm install
npm run dev
```

Open the printed URL. **No camera permission or inference is required to start.** Fonts,
shaders, MediaPipe runtime, and pose models are local assets. After installing dependencies,
normal operation works offline. `npm run calib` needs the network to download factory data.

The verified OBS/NDI route and saved scene collection are in [etc/broadcast](etc/broadcast/README.md). The [Kinect v2 assessment](etc/broadcast/KINECT-V2.md) describes an alternative tracking source.

## Experiences

The **Pulse / Blush** switch above the preview selects the visual mode. Pulse retains the
starfield, moon and fragrance interactions below. Blush is a separate magenta / pale-pink
fluid field, based on the supplied Blush reference. `/?mode=blush&output` opens its clean
3840 × 1080 output directly; `/?mode=pulse&output` opens Pulse.

Pulse's rigged astronaut swims toward a guest with slow arm strokes, a reaching hand,
trailing legs, and gentle banking. A centre-to-edge crossing takes at least 15 seconds.
Following the same guest for about 30 seconds brings him to approximately six feet of
projected height (using the calibrated wall dimensions). He lingers for five seconds,
turns away and retreats for fourteen seconds, then rests for seven before another visit.
Small vapor puffs trail opposite his travel direction. Brief tracking gaps preserve his
target, and Space freezes the animation and vapor.

The eclipse pair responds to poses: with one guest, the two wrists control the two bodies;
with two guests, each person's shoulder centre controls one body. Bring them together to
create totality, then separate them to reveal the crescent. Ownership remains stable if
detection order changes; without guests, the pair resumes its slow automatic drift.
Both eclipse bodies are actual depth-tested sphere meshes (only the corona is a billboard),
and have a diameter of about 22% of the wall height. The colorful body
has a black fractured crust with slowly swirling gas visible beneath it, rotating around
both X and Y. Astronaut turns, pursuit, reaches, eclipse following, bottle transforms,
moon adjustments, and sky speed changes retain velocity and ease into new motion.
The astronaut’s leg cycle is slightly quicker than his arm strokes. His attitude uses
angular springs with a small settling overshoot, turn-driven banking, and independent
pitch and roll drift rather than a fixed upright yaw axis.

Blush replaces the dandelions with 64 white 3D feathers, each modelled with a curved
shaft, 180 individual round barbs, 1,080 branching barbules and loose down. They use
24% opacity and additive blending, with physical depth spanning z=-12 to z=8 (plus
slow drift), so perspective produces a much wider range of apparent sizes. A separate
feather render and depth pass adds circular bokeh without blurring the pink fluid.
They drift, flutter and accelerate smoothly with the tracked movement's airflow.
The astronaut's white suit has .24 roughness and smoothly dims to 22% lighting at
background distance. The colorful sphere uses larger black fragments with broad
blue / magenta / coral gaps, recreating the first broken-crust treatment.

A low-opacity RiiFFS / LUNAR lockup waits for a clear region in either mode. It avoids
tracked people, planets, bottles, the astronaut and feathers, fades in after two seconds
of clear space, and fades out before relocating when that area becomes occupied.
The original RiiFFS artwork is stored in `public/branding/riiffs-logo.png`.

Pulse → Blush uses a 2.6-second, eased 360° orbit of the actual 3D camera around
the world origin, with zero endpoint velocity and acceleration. Stars now project from
world-space depths for parallax. Both live scenes render from the same moving camera during a smooth 1.04-second
crossfade centered at the far side of the orbit; Pulse unmounts after the turn finishes.
The reverse transition retains the existing effect.

Blush uses a soft rose/pink palette and broad fractal clouds. A layer of 16,384 fine dust
particles samples the same fluid velocity using midpoint integration, following the ink
through guest-driven swirls without separate wind or gravity. Particles fade and respawn
gradually to keep their coverage even. **Dust amount** adjusts their visible density.

Blush advects a seeded, multiscale ink texture through a GPU velocity field. Pressure
projection keeps the flow incompressible, curl confinement preserves eddies, and bounded
MacCormack advection helps fine filaments survive. There is no gravity or directional
wind, and default drag is low. Ink uses 32-bit storage when float filtering is available,
with a half-float fallback. A slow ink source maintains texture over long sessions;
moving joints also mix fresh pigment into their wakes. Both are advected by the fluid.
Motion from seven joints per person (wrists, elbows, head,
hips) injects swept wakes; closer guests have more influence. Confidence gates, speed
limits and resets suppress jitter, tracking gaps and pose-loop discontinuities. It consumes
the same normalized joints from simulated bodies, pose playback and live/recorded stereo;
no additional image processing or inference runs in Blush. Scene/Field expose strength,
wake radius, swirl, drag, contrast, dust amount, skeleton overlay and **Reset fluid**. Pause freezes
both the fluid and skeletons. Switching modes preserves the selected input and tuning.

Velocity runs at 768 × 216 and ink at 2048 × 576, displayed at the native canvas resolution.
It requires WebGL2 floating-point render targets. Solver techniques and adapted pressure /
curl shaders reference [Pavel Dobryakov's WebGL Fluid Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation).
The MIT notice is included in [`public/licenses/webgl-fluid-simulation.txt`](public/licenses/webgl-fluid-simulation.txt).

**Scene → Experience** switches between Lunar encounter (moon + products), Moon study,
Wrist ritual, and the original starfield. All use the same live/simulated/recorded joints.

- The large moon uses local [NASA CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/) maps.
  It is a displaced 3D sphere with crater relief and dedicated, normal-based sunlight and
  blue/rose rim illumination. Its side lighting is independent of the bottles' studio
  environment, preserving a visible terminator. The default radius is 0.66 m, starting
  off-centre at X = 1.8 m. It moves right-to-left along a shallow arc, sharing the sky's drift
  and rotation. Scene controls adjust the starting anchor and size. There is no independent
  wobble, bounce, or hand-driven moon displacement. A stable manual camera/frustum prevents
  the view from changing projection during UI updates.
- Nearby, visible wrists attract bottles even below shoulder level, within a 1.5 m projected
  pickup radius and the tracking depth range. A spring follows the hand while up to 110
  nearby stars per bottle are recruited from the existing field. Each travels a slightly
  different figure-eight orbit around the hand and bottle, crossing in the middle, with
  varied phases, speeds and inclinations. This replaces the separate helical particle tube;
  total star count stays fixed. Membership stays stable while the hand moves. Lost or
  low-confidence hands release the bottle and ease those same stars back into the sky.
- Two concept fragrance bottles remain visible and drift near people. An offered wrist must
  stay at least 10 cm above its shoulder, with adequate tracking confidence, for 0.65 s.
  A bottle approaches, settles, emits a visual mist toward the wrist, and floats away.
  Holding the same pose cannot repeatedly trigger it. Lower the wrist and wait out the
  eight-second cooldown; subsequent invitations alternate products. A lost wrist cancels an
  approaching bottle. Two guests can receive different products simultaneously.
- In **Lunar encounter**, an empty room starts a retreat after a 0.75 s tracking-loss grace
  period. Each bottle approaches the moon, crosses its lower visible horizon in front, then
  completes a three-quarter orbit into a parked position behind it. The paths are staggered
  over roughly 10 seconds. The bottles keep their actual model scale: the perspective camera
  and real Z motion make them shrink as they recede, and the moon's depth buffer hides them.
  Parked bottles follow the drifting moon. Returning guests recall them along the route;
  partial retreats reverse continuously instead of teleporting. In Wrist ritual mode, where
  no moon is shown, the existing float-away behavior remains.
- **Offer wrist** demonstrates the fragrance interaction in simulation. The selected body comes
  from the Bodies tab. This button does not fabricate live gestures.
- Replace concept bottles with Blender GLBs in [`public/models/products/`](public/models/products/README.md):
  `product-01.glb` and `product-02.glb`. Refresh after export. Missing files retain their concept
  model. Each model is normalized to a consistent display size. Optional `SprayOrigin` empties
  position the mist at the exported nozzle. This is a screen animation, not physical dispensing.

The sky has shared axial rotation and leftward drift, controlled by **Field → Sky rotation**.
At the default speed, the accelerated telescope effect rotates by 7.2° and drifts 0.45 m in
30 seconds. Speed changes accumulate smoothly, without jumping to a different phase. The moon
traversal loops only after passing off-screen. Star brightness and size stay constant away
from bodies and hand vortices. Overscan and wrapping keep the backdrop filled. The shared sky
angle and drift continue across pose replay loops and source changes; pause freezes both.
There is no ambient noise warp, rhythmic shimmer, or travelling deformation ripple.

**Field → Nebula density** controls the white gas clouds. Their static six-octave fractal
structure has fine ridges and dark dust lanes, with restrained brightness and high internal
contrast. The clouds use the same sky coordinates, rotation and drift as the stars.

### 1. Simulated bodies — the everyday effects workflow

The default source generates up to six animated, 33-slot MediaPipe skeletons directly in world
space. Only the relevant body landmarks are populated; unused face/hand landmarks have no
position and zero confidence. Figures have different statures, slightly smaller proportions,
and a shared lower floor. No depth or pose modules load in this app.

- Open **Bodies** to change count, choose wandering/manual/reaching motion, or set distance.
- Drag a numbered person in the floor plan to move them along the wall and toward/away from it.
- Enable **Skeleton overlay** to inspect the joints driving the field.
- Increase **Distance to wall** past the influence cutoff to verify the deformation vanishes.

### 2. Pose recordings — real motion without inference

In **Bodies → Capture poses**, record the currently selected source, then **Stop & save poses**
to download JSON. This works with simulated, live, or stereo-replayed people. Select
**Pose playback → Load poses** to loop that JSON. Playback offers seeking and 0.25×–2× speed,
interpolates joints by persistent person ID, and uses no camera/pose/depth processing.

Capture samples at up to 30 Hz, retaining at most ten minutes / 18,000 frames in memory.
Save before closing the tab. This is the preferred development artifact after a tracking session.

### 3. A live ZED, or a multi-camera stereo recording

Click **Rescan cameras** in the visualization toolbar, or **Connect / rescan** under
**ZED / stereo session**. Allow camera access for the page. Camera controls open in a native
dialog above the visualization; Leva occupies its own column, without overlapping the feeds.
One ZED works by itself; multiple connected ZEDs are auto-selected.
Use the existing calibration, placement, and auto-alignment controls described below.

The inline bench publishes fused world joints through a versioned `BroadcastChannel` and
continues tracking when the settings dialog closes. Selecting simulation or pose playback
unmounts the bench and releases camera streams and inference. The separate `/tracker.html`
page remains available; if used, it must share the exact origin, including hostname and port.
The effect removes stale people after 500 ms. Close any separate bench tabs when using inline
capture, to avoid opening the same hardware twice.

To record and replay two cameras:

1. Connect both ZEDs, select their factory calibrations, and align camera placements.
2. Click **Record stereo session**, then **Stop & save stereo**. All live cameras are captured
   together into one ZIP containing side-by-side videos, software start offsets, resolved
   calibration, camera placements, and the processing settings.
3. On the development machine, open the bench and **Load stereo session**. No camera permission
   is needed. Every video passes through the same stereo-depth, pose, and fusion pipeline.
4. Playback uses a shared timeline with drift correction, common overlap, coordinated looping,
   pause, and seek. **Connect cameras** exits replay and returns to hardware.
5. Capture the resulting **poses** from the starfield studio to remove inference from subsequent
   effects development. Switching to pose playback stops the inline camera pipeline.

Stereo recording uses the browser's `MediaRecorder` (VP9/VP8 WebM, or MP4 when supported),
not SVO/SVO2. Use Chrome for the most consistent capture/decode behavior. Sessions are held
in memory, limited to two minutes, and imported ZIPs are capped at 1 GB; start with short clips.
These videos preserve **software timing**, not hardware synchronization. Browser compression
can affect stereo matching, so compare replay against a live session before judging depth quality.
Stereo playback still computes depth and pose: caching poses is what removes that cost.
Native SVO files require an SDK-side conversion/adapter and cannot be imported here.

## Wall calibration and the input contract

The existing world convention is preserved: **metres, X right, Y down, Z forward**, with camera 1
as the initial origin. Set **Wall calibration** in the studio: centre X/Y/Z, yaw, physical width
and height. Defaults describe an 8 × 2.25 m wall centred at `(0, 0, 4)`. The default floor is
world Y = 1 m; use camera placements / wall centre Y to match your installation. The synthetic
figures use that floor relative to the wall centre.

Each visible joint is projected onto the wall's horizontal/vertical axes. Its **perpendicular
distance to the plane**, including wall yaw, controls a smooth falloff between **Full influence**
(default 0.15 m) and **Influence cutoff** (2.8 m). Distance uses either side of the wall plane.
The nearest influential limb drives each particle, avoiding excessive accumulation at the torso.
Camera/depth errors remain observable rather than being silently rescaled.

The effects layer accepts the existing world-track structure:

```js
{
  id: 1,
  joints: Array(33), // each joint: { vis: 0..1, p3: { x, y, z } | null }
  cams: [0, 1]
}
```

The bridge channel is `lunar-tracking:world:v1`; messages are
`{ version: 1, type: 'frame', time, people }`. Maximum six people. Joint confidence below 0.4
does not drive the effect. Pose files use `format: 'lunar-poses-v1'`, `units: 'metres'`,
`coordinates: 'x-right,y-down,z-forward'`, optional wall calibration, and
`frames: [{ time: milliseconds, people }]`. Times must increase.

Key files: `src/experience/engine.js` owns interchangeable sources and pose capture/playback;
`body.js` owns skeletons and wall math; `Starfield.jsx` owns the R3F renderer/shaders;
`Blush.jsx` owns the fluid solver, `fluid-shaders.js` its GPU passes, and
`fluid-motion.js` translates timestamped skeleton observations into fluid impulses;
`scene-space.js` calibrates the perspective camera to the interaction plane and converts
between wall coordinates and display depths; `bottle-flight.js` defines the orbital retreat;
`src/session.js` handles stereo sessions. `src/main.js` remains the tracking-bench entry point.
`vite.config.js` builds both `index.html` and `tracker.html`.

## Visual references

Researched before implementation: Keijiro Takahashi's
[KvantSwarm](https://github.com/keijiro/KvantSwarm) (GPU particle motion),
[Smrvfx](https://github.com/keijiro/Smrvfx) (particles driven by animated bodies),
[PcxEffects3](https://github.com/keijiro/PcxEffects3) (point-cloud effects), and
[DofVfxSamples](https://github.com/keijiro/DofVfxSamples) (particle depth of field).
The visual interpretation here is an original WebGL implementation: fine layered light,
body-shaped negative space, violet/rose deformation rims, restrained bloom, and continuous motion.
It is not a port of the Unity projects. Related documentation:
[React Three Fiber](https://r3f.docs.pmnd.rs/getting-started/introduction),
[StereoLabs recording](https://docs.stereolabs.com/docs/development/zed-sdk/modules/camera/recording).

## Verification

```sh
npm test       # Node tests: wall projection/falloff, poses, stature, replay timing
npm run build # both experience and tracking bench
npm run preview
```

Browser QA covered the native canvas resolution, six bodies / 84 segments, near/far influence,
pose capture/export/import, same-origin live input and stale-frame expiry, and mobile layout.
Two synthetic canvas video streams were encoded through the real browser recording path,
exported, reimported, paused, sought, and looped together. Simulation made no camera, stereo,
MediaPipe, or pose-model requests. Real ZED capture and installation performance still need
hardware validation. Development builds expose `{ engine, gl, scene }` at `window.__LUNAR__`
for inspecting the renderer; this hook is omitted in production.

## Existing ZED tracking bench

Browser test bench for a ZED 2 on macOS (no ZED SDK / CUDA needed). The camera shows up as a
plain UVC webcam delivering side-by-side stereo; everything else runs in the browser:

- **Raw stereo** – the side-by-side feed.
- **Depth** – real-time GPU stereo matching (WebGL2): rectify → census transform → Hamming-cost
  matching with sub-pixel refinement → confidence filter + median. Views: depth, disparity,
  confidence, and an anaglyph for checking row alignment.
- **Pose** – MediaPipe Pose Landmarker (lite/full/heavy, up to 6 people) on the left eye. Each
  joint is lifted to 3D (metres, camera space) by sampling the disparity map.
- **Top-down** – people plotted in X/Z to sanity-check the 3D.

## Run

```
npm install
npm run dev
```

Open `/tracker.html` in Chrome, click **Connect cameras**, and allow camera access. The ZED is auto-selected.

Tracking defaults: **FHD stereo 3840×1080 @ 30**, **Heavy** pose model, up to **4 people**,
confidence **0.50**, input brightness **2.5**, contrast **0.7**, and fusion merge radius
**2.0 m**. Camera 1 defaults to an upside-down mount at **X = −0.4 m**; its remaining
placement values are zero. Other camera slots start upright at zero placement. Existing
saved per-device placement/orientation and recorded-session metadata take precedence.
Depth processing remains **480 px** wide, with the **5×5** matching window. Filtering,
raw/smoothed overlays, and the **1.5 / 0.6 Hz** cutoffs with **0.50** beta stay enabled.

## Calibration

`npm run calib` finds connected ZEDs (serials via macOS `system_profiler`), downloads their
factory calibration into `public/calibration/` and writes an index. Each camera then picks its
file automatically by model, or you can choose one in its Leva folder (custom .conf upload also
works). Without calibration it falls back to approximate intrinsics and no lens undistortion.

## Multiple cameras

Every connected ZED gets its own pose view, depth pipeline and pose model. Each camera has a
placement (x/y/z, yaw/pitch/roll) relative to camera 1, which defines the world origin. Set it by
hand or use **auto-align to cam 1**: have one person walk around where both cameras see them for
10 s, and it solves the yaw + offset. People from all cameras are merged on the floor plane and
tracked in world space, so IDs carry across camera hand-offs. The top-down view shows each
camera's view cone and the fused people.

For an inverted mount, enable **Camera 2 → upside down (180°)** (or the corresponding
camera folder). It rotates the pose input and previews upright, maps landmarks back to
the original sensor pixels for calibrated depth lookup, and corrects camera-space X/Y
before world placement. Stereo matching and recordings keep the original eye order;
the orientation flag is saved per device and included in stereo sessions. Placement roll
then represents only residual tilt: don't add another 180° there. Changing orientation
clears old per-camera/fused tracking state and is blocked during a stereo recording.

## Filtering + tracking

- **Duplicates** – two skeletons on one person (they agree joint by joint) are merged.
- **Odd sizes** – a skeleton whose torso length, measured from depth, stays outside the min/max
  range (default 0.15–0.9 m) for a few frames is ignored: drawn grey and dashed, labelled with its
  size, and left out of fusion. This catches projected giants and tiny phantoms, but not
  life-size projected people – there's no "flat against the wall" test, because the depth isn't
  precise enough to tell someone standing near the wall from the wall itself.
- **New people** must be detected 3 times before they're shown or fused, which drops one-frame ghosts.
- **Tracking** predicts where each person will be from their recent velocity (both per camera and
  in world space) and matches new detections against that, not their last position.

## Notes / limits

- ZED cameras are passive RGB stereo – no LiDAR, no IR. In the dark they get noisy, and
  changing projected light on people hurts both stereo and pose. Use the "input brightness"
  slider and the camera controls (exposure etc., Chrome only) to see how far it can be pushed.
- Depth precision falls off with distance squared – see the Stats panel for ±m per pixel of
  disparity at the current settings.
- Pose models and the MediaPipe WASM runtime are served locally (`public/`), so it works offline.

The live experience automatically alternates Pulse and Blush every 120 seconds of unpaused playback. Pulse → Blush uses a 2.6-second camera orbit; Blush → Pulse compresses the outgoing scene into a bright horizontal horizon, then lifts a bronze-star curtain over the incoming scene. Manual mode selection restarts the interval. Brand reference notes are saved in [etc/branding](etc/branding/README.md).

Feathers sample the movement-driven fluid flow at 15 Hz with bilinear interpolation,
stronger bounded drift/lift and flow-driven turning. Their render pass isolates them
from Pulse's studio environment throughout the crossfade, avoiding a brightness drop
when Pulse unmounts. Blush uses black RiiFFS and the supplied gray Lunar Blush artwork.

Idle bottles keep stable person assignments instead of switching every nine seconds;
people beyond the interaction range do not recall them. Idle drift is speed-limited,
and departure to the idle position takes 4.5 seconds. The astronaut only approaches
bodies whose confident torso joints average within 2 m of the calibrated wall. He
retreats smoothly when everyone leaves range, then fades away in the background.

Latest art direction: Blush now uses broad, cupped 3D rose petals with pink/cream
coloring and fine vein detail in place of the white feathers. Flow coupling and
foreground/background depth of field remain; petals use translucent normal blending
so the pink color is retained over the light background. Pulse's lava planet now has
physically raised dark plates over glowing violet/pink/orange lava and a tilted Y
rotation (about one revolution every 19.6 seconds after a smooth ramp-up).
The astronaut remains dimly visible at rest, retaining the 2 m approach gate.
During the Pulse-to-Blush orbit, a synthetic horizontal twist drives the fluid,
dust, and petals using the camera's eased angular-speed envelope.

The molten planet uses constant lava emission and derivative-filtered surface grain
to reduce rotation-induced shimmer, with its tilted spin slowed to .32 radians/sec.

The moon now sits at z=-40 with a 25% larger apparent radius. The astronaut's
rendered root stays forward of z=-24, keeping his limbs clear of the moon. Background
stars sit behind the moon, and bottle parking moved to z=-55 to preserve occlusion.

The astronaut has a separate depth-of-field pass focused six scene units from the
camera, with up to 12 output pixels of circular blur as he recedes. Scene depth keeps
nearer objects in front of the blurred character; the sky and moon remain sharp.

Blush petals now use cool rose / pale pink coloring, additive blending at 32%
opacity, and softened geometry edges. Their DOF composite adds light without
subtracting the background, avoiding dark alpha fringes. Both Blush wordmarks use
white artwork; the Lunar outlines remain those supplied in the brand assets.

Pulse bloom now extracts and blurs highlights in separate render targets and combines
into the composer's destination, never back into its source buffer. Full-screen output
and transition passes explicitly disable depth tests/writes. Live diagnostics reproduced
recurring black-region flashes in the previous bloom path; the replacement completed
3,840 moving frames without those recurring drops. Temporary instrumentation was removed.

Petals use stronger cool rose pigmentation at 48% opacity, with 40% background color
retention in their additive composite to keep their pink visible on the light fluid.
