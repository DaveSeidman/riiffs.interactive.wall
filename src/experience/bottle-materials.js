/** Keep pigmented interiors in the opaque pass, ahead of their refractive glass shells. */
export function prepareBottleMaterials(root) {
  const replacements = new Map();
  const solidFill = (material) => {
    if (!(material?.transmission > 0)) return material;
    if (!replacements.has(material)) {
      const fill = material.clone();
      // Screen-space transmission cannot reliably resolve glass enclosing another
      // transmissive surface. Preserve the fill's texture/lighting, and let the
      // outer glass refract the already rendered color instead.
      fill.transmission = 0;
      fill.transparent = false;
      fill.opacity = 1;
      fill.depthWrite = true;
      fill.depthTest = true;
      replacements.set(material, fill);
    }
    return replacements.get(material);
  };
  root.traverse((object) => {
    if (!object.isMesh || object.userData.role !== "liquid") return;
    object.material = Array.isArray(object.material)
      ? object.material.map(solidFill)
      : solidFill(object.material);
  });
  // Broaden subpixel reflections without changing the glass transmission or
  // printed artwork. Tiny metallic flecks should shimmer, not act as strobes.
  const polished = new Set();
  root.traverse(object => {
    if (!object.isMesh) return;
    for (const material of [object.material].flat().filter(Boolean)) {
      if (polished.has(material)) continue;
      polished.add(material);
      if (material.transmission > 0) material.roughness = Math.max(material.roughness, .10);
      if (material.clearcoat > 0) material.clearcoatRoughness = Math.max(material.clearcoatRoughness, .18);
      if (/suspended.*shimmer/i.test(material.name)) {
        material.roughness = Math.max(material.roughness, .38);
        material.metalness = Math.min(material.metalness, .5);
        material.envMapIntensity = Math.min(material.envMapIntensity, .6);
      }
    }
  });
  // Imported scenes own their materials. Release replaced originals unless another
  // mesh still uses them; textures stay shared with their replacement until unload.
  const used = new Set();
  root.traverse((object) => {
    for (const material of [object.material].flat())
      if (material) used.add(material);
  });
  for (const original of replacements.keys())
    if (!used.has(original)) original.dispose();
  return root;
}
