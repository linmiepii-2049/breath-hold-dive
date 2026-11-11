# 一口气 · Breath Hold

A freediving underwater-photography game. One dive is one day: optionally train on the beach, swim a coral reef, shoot five frames, and submit them to the Deep Sea Photography Association. Prize money buys fins, a lens, and a wetsuit.

Play the build at [https://linmiepii-2049.github.io/breath-hold-dive/](https://linmiepii-2049.github.io/breath-hold-dive/) after GitHub Pages is set to deploy from GitHub Actions.

界面默认简体中文，右上角可切到 English。

## Play

```bash
npm install
npm run dev
```

Open the URL Vite prints (`/breath-hold-dive/`). Then:

1. **岸上训练 Shore training** (optional). Two sessions per in-game day. The day advances when you submit a dive, so training cannot be ground forever.
2. **下潜 Dive.** Spend the breath. Deeper water burns oxygen faster. Leave enough to get back up.
3. At the surface, press **E**. The prompt in the meter panel says 按 E 结束下潜, with E drawn as a key cap. There is no on-screen button, because a locked pointer cannot click one. Putting your head on the surface refills oxygen to full at once, so you can breathe and dive again without returning to shore.
4. **提交协会 Submit.** Each frame gets a judge card. A photo under 60 that still has an animal is returned (退回 / Rejected), pays ¥0, and still enters the album. A frame with no animal says it is not added. Accepted frames pay the best one in full, plus 25% of the others, minus any rescue fines.
5. **装备店 Gear shop.** Buy an upgrade, then dive again. The Blue Hole site is only a teaser in v1.

`npm run build` typechecks and writes `dist/`. `npm run check` also runs the scoring assertions.

## Controls

| Input | Action |
| --- | --- |
| Mouse | Steer. Up looks up, right turns right. The diver swims the way the camera faces, including up and down. Pitch stays within about ±80°. |
| Space | Fin kick, thrust only forward along the look |
| F | Sprint kick (faster, burns oxygen faster) |
| Right click | Toggle the viewfinder. Steering stays the same; the overlay, wheel zoom, and shutter are added |
| Mouse wheel | Focal length, while the viewfinder is open |
| Left click | Shutter (5 frames), while the viewfinder is open |
| E at the surface | End the dive and keep the photos |
| Esc | Leave the viewfinder, release the mouse, and pause. Click the picture to steer again |
| P | Show or hide the frame-rate counter (off unless you press P or open `?fps=1`) |

Look sensitivity defaults to 1 and can be dragged from 0.45 to 2.1 on the shore. Above about 12 m the diver floats when the fins are still, up to about 0.72 m/s. Around 12 m is neutral. Below that the diver sinks slowly, and only reaches about 0.9 m/s well below 12 m. A Space tap is one fin stroke and coasts about 0.6–0.8 m. Holding Space strokes every 0.45 s and is up to about 2.45 m/s within a second, then letting go glides for about a second before the drift takes over. F is a one-second sprint at about 1.7× that speed. Straight ahead of the spawn the bottom drops past 12 m. A head at the surface refills oxygen instantly and the dive continues until E, a blackout, or a forced ascent. If the mouse unlocks, the dive pauses on a full-screen “click to steer” prompt.

Being hit by a shark or an orca, or running out of oxygen, forces you up and costs stamina and prize money. Photos already shot are kept.

## What is in the water

Reef Wall only. Eight animals: sardine school, clownfish (by the anemone), parrotfish, sea turtle, manta, octopus (changes color), shark, orca (deep only).

Three moments: a shark scattering the bait ball, the turtle surfacing to breathe, and an orca passing through the trench. The field guide in the album says where to look. Each species and each moment keeps your best-scoring thumbnail in `localStorage` (`breath-hold-dive-v1`). A new photo replaces that tile when it ties or beats the stored score, so an older thumbnail does not stick forever. Money, gear, and which slots you have already filled carry over from older saves.

## Decisions

Numbers below are the ones the build actually uses.

- **Camera and swim.** The mouse steers yaw and pitch whenever the pointer is locked, viewfinder open or closed. Mouse up looks up. Mouse right turns right (a rightward move decreases yaw, because positive yaw looks toward screen-left). Pitch is clamped to ±80°. Space and F thrust only along that look. There is no WASD, no strafe, and no separate descend key: look down and kick to go down, look up and kick to go up. Speed bleeds off with drag 0.65 per second (about a 1.1 s half-life), so letting go of Space glides before buoyancy takes over. The diver is prone along the look, with a fin kick while thrusting and a quiet glide otherwise. The third-person camera follows yaw only and holds one elevated rear three-quarter at every depth: 3.0 m behind, 1.7 m to the side (about 30° off the tail), and 3.45 m up, which is a 45° elevation. It looks at a point 0.65 m above the feet, on the torso. Near the sand or the surface it slides back along that same ray so the angle stays and the camera does not clip. Fins are about 0.28 m wide and 0.9 m long, and the kick lifts them toward the camera. Reef rocks use a collision sphere 0.75 m outside the visible mesh, plus a stack along the tall wall rocks, and the prone body is pushed on the chest, the shoulders, the belly, and the fins. On the sand the diver slides out sideways, so the visible suit does not sit inside a rock. The mouse-look clamp is a rate (80 px and 60 px per 1/60 s), so a turn covers the same angle per second at 15 FPS as at 60. Large animals push too; a turtle does not deal damage. Right click only toggles the viewfinder overlay. Esc releases the mouse and pauses; click to lock it again. Default look sensitivity is 1 (0.00115 rad/px yaw, 0.00095 rad/px pitch), adjustable on the shore from 0.45 to 2.1 and stored on the existing save.
- **Breath.** Drain is `0.82 + 0.04 × depth` oxygen per second, and it pauses shallower than 1.25 m. When the head reaches the surface (head y ≥ -0.45, which the surface clamp does), oxygen refills to full immediately, unless a blackout or a forced ascent is already in progress. Base pool is 100, before lung training. A wetsuit cuts drain 9% per level. Apnea training cuts it up to 15% more.
- **Buoyancy.** Neutral at 12 m. Shallower, upward acceleration is `0.47 × (12 − depth) / 12` m/s², so a still diver floats at about 0.72 m/s near the surface. Deeper, downward acceleration ramps to 0.585 m/s² over the next 24 m (full only around 36 m, about 0.3 m/s at 20 m) and the free-fall settles near 0.9 m/s. Drag stays 0.65 per second. Reaching the surface refills oxygen and does not end the dive; E does, and so does a blackout or a forced ascent once it has held them there.
- **Kick.** Space fires a fin stroke immediately (0.98 m/s along the look, before fins) and another every 0.45 s while held. After 0.12 s the hold settles on a 2.45 m/s cruise. A tap that ends before that is just the one stroke and coasts about 0.6–0.8 m. F snaps to 4.16 m/s (1.7×) for 1.0 s and multiplies oxygen drain by 7.5. The 3.4 s cooldown starts when that second ends, and the HUD shows the full 3.4 then, not a clock that was already running during the sprint. Both speeds scale with `1 + 0.14 × fin level`. The fins sweep together through about 60° on that same clock, with a small body undulation. Fish, sharks, turtles, and rays wag a tail or flap fins on top of the swim.
- **Film and money.** Five shots. A score under 60 that still has a subject is returned: the card and the settlement say 退回 / Rejected, the prize is ¥0, and the photo still enters the album. A frame with no animal says 没有拍到生物，不入图鉴 and is not stored. At 60 and above, prize for a score `t` (0–1) is `round(36t + 300t²)` in-game ¥. A 60 pays ¥130; a 100 pays ¥336. Payout is the best accepted frame plus 25% of the rest, minus ¥45 per hit and ¥70 for a blackout, floored at 0.
- **Score, out of 100.** The four lines on the judge card are integers, and the total is their sum. Composition 30 (rule of thirds 12, size in frame 10, fully inside 8). Rarity up to 25: sardine 8, the school treated as one subject 12, clownfish 10, parrotfish 11, turtle 16, manta 18, shark 20, octopus 18 while camouflaged and 25 while it is showing off, orca 25. The moment line has a base of 10 for a clear, framed shot of a creature that is actually moving (a stroke, a turn, feeding, a color show). The card labels that 动作中 +10 / In motion +10. The three special moments still score on top of that, up to 25, and the card says 特殊瞬间 / Special moment. A special moment scores only while that moment is actually happening and its animal is plainly in frame: center inside the picture, body at least 18% of the frame height (24% for an orca), and not hidden behind reef or lost in haze. That is 25 points when it also fills the frame and is composed, otherwise 12. A clear photo of a common animal in action lands around 60–70. A sloppy or idle frame stays under 60. Weed, rock, or fog in front of the subject cuts composition and rarity. A dark speck that is not a readable orca does not get rarity 25 or the pass. Distance and danger share 20. The obvious subject in the frame wins over a rarer speck. The payout screen is titled 结算 / Settlement and lists the best frame's score next to the money.
- **Training.** Breathing rhythm is about 46 s after a short unscored lead-in. Each beat the white dot crosses a bright band (the middle-to-late half of the beat, 50%–88%). Tap the matching key while the dot is in the band. An earlier tap does not fail the beat. Holding the right key into the band counts as a good hit; the center of the band (64%–78%) is a perfect. A perfect run is +8% lung, capped at +30%. Static apnea is about 42 s; a perfect hold is +5% efficiency, capped at +15%. Two sessions total per day.
- **Frame rate.** Movement, oxygen, buoyancy, the sprint clock, and shark timers step at a fixed 1/60 s. Each frame adds real elapsed time and catches up by at most 0.25 s, so a 20 FPS machine is not in slow motion. Mouse look and the camera ease once per frame. Press **P**, or load the page with `?fps=1`, to show a counter. It stays off in normal play. F is still the kick. Photo thumbnails are read back through a pixel-buffer so the shutter does not stall the GPU on the spot.
- **Moments.** The bait-ball, turtle-breath, and orca-pass lines appear only while that moment is happening and you are close enough to see it. They do not announce a distant event at the start of a dive.
- **Debug staging.** `?debug=1` adds a closed Debug disclosure on the shore and during a dive. It is absent otherwise. Each button puts you in front of one species or one special moment, aims the viewfinder, refills oxygen, and freezes that scene for about 8 seconds, or until the first photo, so it can be photographed without waiting. `?debug=1` also logs shark state changes (`[shark] patrol -> warn`) and the first push against a rock or a large animal. The click that opens that view does not immediately toggle it off. 虎鲸 and 虎鲸过境 frame the orca side-on in open water. 鲨鱼 is a three-quarter side view. 小丑鱼 sits in open water. 章鱼 is on open sand, a little higher in the frame, and cycles its colors. Left click shoots. Right click or Esc leaves the viewfinder.
- **Shop.** Long fins ¥60 / ¥160 / ¥380, +14% kick speed per level. Lens ¥90 / ¥200 / ¥420, viewfinder FOV 34–62°, then 26–72°, 20–82°, 15–90°. Wetsuit ¥110 / ¥240 / ¥500.
- **Danger.** Sharks patrol the reef wall and the trench, off the straight swim out from spawn, and they do not aggro for the first 20 s. Inside about 18 m a shark circles in view for 4.5 s (the HUD says 鲨鱼正在靠近, and a toast says 鲨鱼转过来了) before any charge, including the bait-ball run. The charge then locks a straight line at where you are and runs it at 2.5 m/s, under the 4.16 m/s sprint, for 4.2 s. The circle is wide enough that a sprint and a turn started within about a second of the warning, even at a low frame rate, leaves the line. Turning off the line by about 3 m, or opening the gap past about 14 m, calls the charge off. Holding still is still a hit (the shark connects inside about 2.2 m, which covers a diver who only drifts). A hit costs 36 stamina and shoves you upward. After that the shark waits about 12 s. The orca only crosses the deep trench, and only now and then. Stamina starts at 100; a blackout costs 50 and locks the ascent.
- **Bottom.** Straight ahead of the spawn (around x = 6, heading +Z) the sand falls away within a few metres, so a straight descent does not meet the floor at 8 m. The offshore lane still drops past 12 m, and the shelf to the left of that heading stays shallow. The garden around the anemone stays between 6 m and 20 m.
- **Look.** Shallow fog `#178f9c`, deep fog `#07131e`, above-water haze `#b7e0ec`. UI accent `#8ee0d6`. Pixel ratio is capped at 1.5. Large animals are judged on the body in frame, not nose-to-tail.
- **Site layout** is seeded (2049) so the anemone, the octopus crevice, and the trench stay put.

## Assets

No downloaded models, textures, or audio files. Terrain, animals, the diver, caustics, and light shafts are built from Three.js primitives. Ambience, heartbeat, shutter, bubbles, and shore wash are synthesized with WebAudio. Code and these generated visuals are original to this repository.

## Deploy

`.github/workflows/pages.yml` builds on every push to `main` and deploys with GitHub Pages. In the repo settings, set Pages → Build and deployment → Source to **GitHub Actions** once. Vite's `base` is `/breath-hold-dive/`.
