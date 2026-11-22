# Working wall broadcast

Saved 2026-11-17 after the user confirmed successful wall output.

Chrome fullscreen Blush → OBS native macOS window capture → DistroAV NDI main output → WATCHOUT.

- App URL is http://127.0.0.1:8081/?mode=blush&source=live&output
- OBS profile is Lunar NDI 3840x1080.
- OBS scene collection and scene are Lunar Wall Output.
- Source is Chrome Blush canvas, using macOS Screen Capture in Window mode.
- Base canvas and output are 3840 × 1080, 30 fps.
- Source bounds scale to the outer bounds and crop to 3840 × 1080.
- Cursor capture is disabled and source audio is muted.
- DistroAV Main Output is enabled with name OBS PGM.
- WATCHOUT source is DAVES-MACBOOK-PRO-2.LOCAL (OBS PGM).

The saved scene collection is Lunar-Wall-Output.json. It can be imported through OBS Scene Collection → Import. The captured macOS window ID is session-specific. After restarting Chrome, select the current fullscreen Lunar — Pulse & Blush window in the source properties.

## Restore

1. Start the dev server with `npm run dev -- --port 8081 --strictPort`.
2. Open http://127.0.0.1:8081/tracker.html and connect the cameras. Confirm live camera frames and tracking.
3. Open the Blush URL above in Chrome. Use Launch output from the studio to enter fullscreen, or use Chrome fullscreen with the clean output URL.
4. Select the OBS profile and scene collection above. Import the saved collection if it is missing.
5. Select the fullscreen Blush window in Chrome Blush canvas properties. Keep the Blush window visible in front. Check the OBS program picture for edge-to-edge Blush.
6. Confirm the Video settings above and enable DistroAV Main Output named OBS PGM through OBS Tools.
7. Select OBS PGM in WATCHOUT and verify motion on the wall.

The successful capture was received locally as 3840 × 1080 UYVY at 30 fps, and the user confirmed the wall looked correct. Native window capture scales the visible Chrome image into the output. The app has a 3840 × 1080 backing canvas, but the captured desktop image can be smaller, so this route does not guarantee a one-to-one capture of all canvas pixels.

During setup OBS crashed in Qt accessibility while closing an import dialog, and another report involved embedded Chromium. The working scene uses native window capture. NDI Scan Converter was running but OBS PGM was the verified sender.

A restart of the dev server may reload the tracker and require reconnecting cameras. A persisted OBS startup collection may differ from the active scene, so explicitly choose Lunar Wall Output after launching.
