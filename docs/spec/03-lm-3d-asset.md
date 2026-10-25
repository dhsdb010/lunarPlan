# Spec 03 — LM 3D asset, views and player role

## 1. Asset found: NASA's official Apollo Lunar Module glTF

| Item | Value |
|---|---|
| Source | [nasa/NASA-3D-Resources → `3D Models/Apollo Lunar Module/Apollo Lunar Module.glb`](https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Apollo%20Lunar%20Module) (also listed on [data.nasa.gov](https://data.nasa.gov/dataset/nasa-3d-models-apollo-lunar-module)) |
| License | The NASA 3D Resources README says "free and without copyright", subject to the [NASA media usage guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media). Don't use the NASA insignia or logotype in a way that implies NASA endorses the game |
| Format | glTF 2.0 binary, exported with Blender glTF I/O 4.2 |
| Size | 717 KB |
| Geometry | ~97,600 triangles, 134 meshes, 135 nodes (generic names like `group13 g1`) |
| Materials | 12 flat-color Blinn→PBR materials, 3 textures (gold descent stage, grey ascent stage, US flag decal) |
| Interior | **None.** It is an exterior model only |
| Checked | Downloaded and parsed in Phase 0. The preview image shows the landing configuration (legs deployed, probes visible) |

**Verdict:** it is good enough for Phase 1 grey-box and the chase camera, and it renders right in Babylon. It is **not** realistic enough for Phase 3, because it has flat colors, no Kapton foil crinkle, and no MLI blanket detail.

### Prep work (Phase 1, in Blender, scripted)
1. Rename the nodes we need as anchors: `DPS_nozzle` (plume + gimbal), `RCS_quad_{1..4}` and the 16 `RCS_jet_*` emitters, `probe_{-Y,+Y,+Z}`, `footpad_{1..4}`, `window_CDR`, `window_LMP`.
2. Set the origin at the LM X-axis, with the footpads on the ground plane at Z = 0.
3. Verify the scale against spec 01: tread radius 4.256 m, probe 1.73 m.
4. Export with Draco/Meshopt compression and a 3-level LOD (100 % / 30 % / 8 %).

### Phase 3 upgrade (council decision later)
- Option A: re-material the NASA model with PBR. Kapton foil gets a normal map plus anisotropic gold; the ascent stage gets black/grey aluminised panels.
- Option B: model a new LM in Blender from the LM drawings, with the NASA model as the reference.
- Option C: a Smithsonian LM-2 scan. Not found in open access yet.

## 2. Views (all three chosen by you)

| View | Built from | Needs beyond the NASA model |
|---|---|---|
| **Commander window** (primary for Approach) | Camera at the CDR eye point, looking through the left triangular window | Custom interior frame + window mesh, **LPD reticle etched on the glass** (degrees scale), dust & sun glare |
| **Chase camera** | The NASA glTF | Plume + RCS puffs, shadow on the surface |
| **Instrument panel** | 2D/2.5D HTML/canvas overlay | DSKY (PROG/VERB/NOUN, 1201/1202), FDAI 8-ball, cross-pointer (horizontal velocity), altitude/altitude-rate tapes, propellant gauge, contact light, low-level light |

The window view and the panel can be on screen together, like the real crew station. Their layout is a Phase 2 design council topic, decided with you.

## 3. What the player is

The player is the **Commander**, standing at the left station. In the Approach mode the commander:
1. watches the LPD on the window while the computer flies P64, and **redesignates** the landing point with hand-controller clicks;
2. **takes over in P66**: tilts the LM with the hand controller to kill horizontal drift, and clicks the ROD switch to set the sink rate (the computer works the throttle);
3. calls **ENGINE STOP when the contact light** comes on (probe mode = bonus).

The LMP (Lunar Module Pilot) callouts ("forward 4, down 2½…", "60 seconds", "contact light") are played by the game as audio and text, the way Aldrin read numbers to Armstrong.
