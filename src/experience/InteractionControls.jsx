import React from "react";
import { SCENES, moonVisible, productsVisible } from "./interactions.js";

export default function InteractionControls({ engine, onChange }) {
  const system = engine.interactions,
    c = system.config;
  const selected = engine.sim.selected,
    offering = !!engine.sim.raised[selected];
  const toggleWrist = () => {
    engine.sim.raised[selected] = !offering;
    onChange();
  };
  return (
    <div className="inspector-content interaction-controls">
      <div className="control-section">
        <label className="select-label">
          Experience
          <select
            value={c.scene}
            onChange={(e) => {
              system.setScene(e.target.value);
              onChange();
            }}
          >
            {SCENES.map((scene) => (
              <option key={scene.id} value={scene.id}>
                {scene.name}
              </option>
            ))}
          </select>
        </label>
        <p className="control-hint">
          {SCENES.find((s) => s.id === c.scene).description}
        </p>
      </div>
      {moonVisible(c.scene) && (
        <div className="control-section">
          <div className="control-title">MOON</div>
          <label className="slider-control">
            <span>
              Moon size<output>{c.moonRadius.toFixed(2)} m</output>
            </span>
            <input
              aria-label="Moon size"
              type="range"
              min="0.4"
              max="1"
              step="0.02"
              value={c.moonRadius}
              onChange={(e) => {
                c.moonRadius = Number(e.target.value);
                onChange();
              }}
            />
          </label>
          {[
            [
              "moonX",
              "Moon position X",
              -engine.wall.width * 0.5,
              engine.wall.width * 0.5,
            ],
            [
              "moonY",
              "Moon position Y",
              -engine.wall.height * 0.5,
              engine.wall.height * 0.5,
            ],
          ].map(([key, label, min, max]) => (
            <label className="slider-control" key={key}>
              <span>
                {label}
                <output>{c[key].toFixed(2)} m</output>
              </span>
              <input
                aria-label={label}
                type="range"
                min={min}
                max={max}
                step="0.02"
                value={c[key]}
                onChange={(e) => {
                  c[key] = Number(e.target.value);
                  onChange();
                }}
              />
            </label>
          ))}
        </div>
      )}
      {productsVisible(c.scene) && (
        <div className="control-section">
          <div className="control-title">
            FRAGRANCE RITUAL <span>{system.spritzes} SPRITZES</span>
          </div>
          <label className="slider-control">
            <span>
              Hold to invite<output>{c.dwell.toFixed(2)} s</output>
            </span>
            <input
              aria-label="Hold to invite"
              type="range"
              min="0.4"
              max="1.8"
              step="0.05"
              value={c.dwell}
              onChange={(e) => {
                c.dwell = Number(e.target.value);
                onChange();
              }}
            />
          </label>
          {engine.source === "simulation" && (
            <button
              className={`capture-button ${offering ? "offering" : ""}`}
              disabled={!engine.sim.count}
              onClick={toggleWrist}
            >
              {offering ? "Lower wrist" : "Offer wrist"} · Body{" "}
              {String(selected).padStart(2, "0")}
            </button>
          )}
          <label className="toggle-row">
            <span>Bottles drift near guests</span>
            <input
              type="checkbox"
              checked={c.ambient}
              onChange={(e) => {
                c.ambient = e.target.checked;
                onChange();
              }}
            />
            <span className="toggle-track" />
          </label>
          <div className="ritual-status">
            {system.bottles.map((b) => (
              <div key={b.product}>
                <span style={{ color: system.products[b.product].color }}>
                  ●
                </span>
                <span>{system.products[b.product].name}</span>
                <small>
                  {
                    {
                      ambient: "Drifting",
                      attract: "Following hand",
                      arrive: "Approaching",
                      settle: "At wrist",
                      spritz: "Spritzing",
                      depart: "Floating away",
                      retreat: "Orbiting moon",
                      hidden: "Behind moon",
                      emerge: "Returning",
                    }[b.phase]
                  }
                </small>
              </div>
            ))}
          </div>
        </div>
      )}
      {productsVisible(c.scene) && (
        <div className="control-section">
          <div className="control-title">
            PRODUCTS{" "}
            <span>
              {system.products.every((p) => p.asset === "glb")
                ? "GLB MODELS"
                : "CONCEPT / GLB"}
            </span>
          </div>
          {system.products.map((product, i) => (
            <label className="select-label" key={i}>
              Product {i + 1}
              <input
                className="product-name"
                aria-label={`Product ${i + 1} name`}
                value={product.name}
                maxLength={24}
                onChange={(e) => {
                  product.name = e.target.value;
                  onChange();
                }}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
