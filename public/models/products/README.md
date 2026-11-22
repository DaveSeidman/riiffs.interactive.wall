# Replace the concept bottles

Put your Blender exports in this folder:

- `product-01.glb` — first fragrance (blue concept bottle).
- `product-02.glb` — second fragrance (rose concept bottle).

Full local path:
`/Users/daveseidman/Documents/personal/lightbox/riffs/lunar-tracking/public/models/products/`

Export as **glTF 2.0 → glTF Binary (.glb)** with materials and textures embedded.
Export the bottle upright (Blender +Z becomes glTF +Y with Blender's standard export settings).
Face the label toward Blender -Y / glTF +Z, toward the viewer. Apply object transforms.
Use a single scene containing only the product; disable mesh compression for now.

Refresh the visualization after replacing a file. It automatically loads the matching GLB,
normalizes its height, centres it, and uses it for the existing wrist interaction. Each file is
independent; a missing file retains its procedural concept bottle. Existing concept bottles
are generated in `src/experience/InteractionScene.jsx`, not saved as mesh assets.

Optional: add an Empty named `SprayOrigin` at the nozzle before export. Its position drives
the mist origin. Without it the runtime uses a point near the top/front of the normalized model.
Product names in the Scene controls change the procedural label; imported models retain their
own artwork and materials. An exported cap can remain attached; automatic cap lift applies
only to the concept bottle.

For glass enclosing colored fill, use the Blender custom property `role = "liquid"`
on fill meshes and include custom properties in the GLB export (the current models already
have this). The runtime renders these fills as solid, depth-tested colored surfaces before
refractive glass. This prevents nested screen-space refraction from intermittently hiding
the top or bottom fill. Their textures and other surface properties are preserved; the GLB
files themselves are unchanged.
