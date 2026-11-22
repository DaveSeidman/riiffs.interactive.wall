import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { prepareBottleMaterials } from "../src/experience/bottle-materials.js";

const mesh = (material, role) => {
  const object = new THREE.Mesh(new THREE.BufferGeometry(), material);
  object.userData.role = role;
  return object;
};

test("colored cap and body render before the glass while retaining their artwork and lighting", () => {
  const texture = new THREE.Texture();
  const material = new THREE.MeshPhysicalMaterial({
    transmission: 0.1,
    map: texture,
    roughness: 0.13,
    clearcoat: 0.12,
    side: THREE.DoubleSide,
  });
  const cap = mesh(material, "liquid"),
    body = mesh(material, "liquid");
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    transmission: 1,
    transparent: true,
    opacity: 0.986,
  });
  const glass = mesh(glassMaterial, "glass");
  const root = new THREE.Group().add(cap, body, glass);
  let disposed = false;
  material.addEventListener("dispose", () => {
    disposed = true;
  });
  prepareBottleMaterials(root);
  assert.equal(cap.material, body.material);
  assert.equal(cap.material.transmission, 0);
  assert.equal(cap.material.transparent, false);
  assert.equal(cap.material.opacity, 1);
  assert.equal(cap.material.depthWrite, true);
  assert.equal(cap.material.depthTest, true);
  assert.equal(cap.material.map, texture);
  assert.equal(cap.material.roughness, 0.13);
  assert.equal(cap.material.clearcoat, 0.12);
  assert.equal(cap.material.side, THREE.DoubleSide);
  assert.equal(glass.material, glassMaterial);
  assert.equal(glass.material.transmission, 1);
  assert.equal(disposed, true);
  const stable = cap.material;
  prepareBottleMaterials(root);
  assert.equal(cap.material, stable);
});

test("a fill sharing a material with glass gets its own material without changing or disposing the glass", () => {
  const material = new THREE.MeshPhysicalMaterial({ transmission: 0.5 });
  const fill = mesh([material], "liquid"),
    glass = mesh(material, "glass");
  let disposed = false;
  material.addEventListener("dispose", () => {
    disposed = true;
  });
  prepareBottleMaterials(new THREE.Group().add(fill, glass));
  assert.notEqual(fill.material[0], material);
  assert.equal(fill.material[0].transmission, 0);
  assert.equal(glass.material.transmission, 0.5);
  assert.equal(disposed, false);
});

test("unclassified models and nontransmissive fills preserve their materials", () => {
  const material = new THREE.MeshPhysicalMaterial({ transmission: 0.5 });
  const unknown = mesh(material),
    solid = mesh(new THREE.MeshStandardMaterial(), "liquid");
  const solidMaterial = solid.material;
  prepareBottleMaterials(new THREE.Group().add(unknown, solid));
  assert.equal(unknown.material, material);
  assert.equal(material.transmission, 0.5);
  assert.equal(solid.material, solidMaterial);
});

test("bottle highlights broaden while glass and shimmer colors remain intact", () => {
  const glass = new THREE.MeshPhysicalMaterial({transmission:1,roughness:.035});
  const flecks = new THREE.MeshStandardMaterial({name:"Lunar • suspended champagne silver shimmer",roughness:.18,metalness:.78});
  const color=flecks.color.clone();
  prepareBottleMaterials(new THREE.Group().add(mesh(glass,"glass"),mesh(flecks,"shimmer")));
  assert.equal(glass.transmission,1);assert.equal(glass.roughness,.1);
  assert.equal(flecks.roughness,.38);assert.equal(flecks.metalness,.5);
  assert.ok(flecks.color.equals(color));
});
