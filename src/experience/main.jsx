import React, {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Circle,
  Crosshair,
  Expand,
  Film,
  Focus,
  Move,
  Pause,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Settings2,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import Starfield from "./Starfield.jsx";
import { ExperienceEngine, downloadBlob } from "./engine.js";
import { projectJoint } from "./body.js";
import { PALETTES } from "./palette.js";
import { SCENES } from "./interactions.js";
import InteractionControls from "./InteractionControls.jsx";
import { BLUSH_DEFAULTS } from "./Blush.jsx";
import "./style.css";

const DEFAULT_SETTINGS = {
  ...BLUSH_DEFAULTS,
  particles: 90000,
  strength: 1.35,
  radius: 0.46,
  drift: 0.8,
  bloom: 0.65,
  exposure: 1.25,
  nebula: 0.7,
  palette: "eclipse",
  skeletons: false,
};
const PRESETS = {
  "Quiet orbit": {
    strength: 0.65,
    radius: 0.6,
    drift: 0.35,
    bloom: 0.4,
    exposure: 1.1,
    palette: "moonrise",
  },
  Gravitational: { ...DEFAULT_SETTINGS },
  "Solar wind": {
    strength: 2.2,
    radius: 0.7,
    drift: 1.5,
    bloom: 1.1,
    exposure: 1.5,
    palette: "blush",
  },
};
const sources = [
  {
    id: "simulation",
    title: "Simulated bodies",
    detail: "No cameras. No inference.",
    icon: ScanLine,
  },
  {
    id: "poses",
    title: "Pose playback",
    detail: "Recorded joints, on loop.",
    icon: Play,
  },
  {
    id: "live",
    title: "ZED / stereo session",
    detail: "Live or recorded stereo.",
    icon: Radio,
  },
];
const timecode = (t) =>
  `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

class RenderBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch() {
    this.props.onError?.();
  }
  render() {
    return this.state.error ? (
      <div className="render-error">
        <h2>WebGL could not start</h2>
        <p>{this.state.error.message}</p>
        <p>
          Enable hardware acceleration and reload in a WebGL2-capable browser.
        </p>
      </div>
    ) : (
      this.props.children
    );
  }
}
function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  unit = "",
  format,
}) {
  return (
    <label className="slider-control">
      <span>
        {label}
        <output>
          {format ? format(value) : Number(value).toFixed(step >= 1 ? 0 : 2)}
          {unit}
        </output>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
function Toggle({ label, value, onChange }) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-track" />
    </label>
  );
}

function BlushControls({ settings, change, reset }) {
  return (
    <div className="inspector-content">
      <div className="control-section">
        <div className="control-title">
          BLUSH{" "}
          <span className="blush-swatches">
            <i />
            <i />
            <i />
          </span>
        </div>
        <Slider
          label="Motion strength"
          value={settings.fluidForce}
          min={0}
          max={20}
          step={0.1}
          onChange={(v) => change("fluidForce", v)}
        />
        <Slider
          label="Wake radius"
          value={settings.fluidRadius}
          min={0.08}
          max={0.6}
          unit=" m"
          onChange={(v) => change("fluidRadius", v)}
        />
        <Slider
          label="Swirl"
          value={settings.fluidCurl}
          min={0}
          max={45}
          step={1}
          onChange={(v) => change("fluidCurl", v)}
        />
        <Slider
          label="Drag"
          value={settings.fluidDrag}
          min={0}
          max={0.4}
          step={0.005}
          onChange={(v) => change("fluidDrag", v)}
        />
        <Slider
          label="Contrast"
          value={settings.fluidContrast}
          min={1}
          max={5}
          onChange={(v) => change("fluidContrast", v)}
        />
        <Slider
          label="Dust amount"
          value={settings.fluidDust}
          min={0}
          max={1}
          onChange={(v) => change("fluidDust", v)}
        />
        <Toggle
          label="Skeleton overlay"
          value={settings.skeletons}
          onChange={(v) => change("skeletons", v)}
        />
        <button className="capture-button" onClick={reset}>
          <RotateCcw size={13} /> Reset fluid
        </button>
      </div>
    </div>
  );
}

function FloorPlan({ engine, onChange }) {
  const ref = useRef();
  const [drag, setDrag] = useState(null);
  const sim = engine.sim;
  const pointAt = (event) => {
    const rect = ref.current.getBoundingClientRect();
    const limit = engine.wall.width / 2 - 0.1;
    return {
      x: Math.max(-limit, Math.min(limit, ((event.clientX - rect.left) / rect.width - .5) * engine.wall.width)),
      distance: Math.max(.05, Math.min(3.5, (event.clientY - rect.top - 27) / 100 * 3.5)),
    };
  };
  const update = (event) => {
    if (drag === null || engine.source !== "simulation") return;
    const body = sim.positions.find(p => p.id === drag);
    Object.assign(body, pointAt(event), { placed: true });
    onChange();
  };
  const addBody = (event) => {
    if (engine.source !== "simulation" || sim.count >= sim.positions.length) return;
    const body = sim.positions[sim.count++];
    Object.assign(body, pointAt(event), { placed: true });
    sim.selected = body.id;
    onChange();
  };
  const removeBody = (event, id) => {
    event.stopPropagation();
    if (engine.source !== "simulation") return;
    const index = sim.positions.findIndex(p => p.id === id);
    if (index < 0 || index >= sim.count) return;
    const [removed] = sim.positions.splice(index, 1);
    sim.positions.push(removed);
    sim.count--;
    delete sim.raised[id];
    if (sim.selected === id) sim.selected = sim.count ? sim.positions[0].id : null;
    setDrag(null);
    onChange();
  };
  return (
    <div
      className="floor-plan"
      ref={ref}
      onDoubleClick={addBody}
      onPointerMove={update}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
    >
      <div className="wall-line">
        <span>PROJECTION WALL</span>
        <span>{engine.wall.width.toFixed(1)} m</span>
      </div>
      {[1, 2, 3].map((n) => (
        <div
          key={n}
          className="floor-grid"
          style={{ top: `${27 + (n / 3.5) * 100}px` }}
        >
          <span>{n} m</span>
        </div>
      ))}
      <div className="floor-center" />
      {engine.people.map((person, i) => {
        const p = projectJoint(
          person.joints[23]?.p3 || person.center || { x: 0, y: 0, z: 0 },
          engine.wall,
        );
        const simulated = engine.source === "simulation" && sim.positions.find(body => body.id === person.id);
        if (simulated) {
          p.x = simulated.floorX ?? simulated.x;
          p.distance = simulated.floorDistance ?? simulated.distance;
        }
        return (
          <button
            onDoubleClick={event => removeBody(event, person.id)}
            key={person.id}
            aria-label={`Move body ${person.id}`}
            className={`body-marker ${engine.sim.selected === person.id ? "selected" : ""}`}
            style={{
              left: `${50 + (p.x / engine.wall.width) * 100}%`,
              top: `${27 + (Math.min(p.distance, 3.5) / 3.5) * 100}px`,
              "--body-color": i % 2 ? "#e8799e" : "#8298ff",
            }}
            onPointerDown={(e) => {
              if (engine.source !== "simulation") return;
              engine.sim.selected = person.id;
              const body = sim.positions.find(item => item.id === person.id);
              if (!body?.placed) {
                if (body) Object.assign(body, { placed: true, floorX: body.x, floorDistance: body.distance });
                sim.motion = "manual";
              } else {
                body.placed = false;
                sim.motion = "wander";
              }
              setDrag(person.id);
              e.currentTarget.setPointerCapture(e.pointerId);
              onChange();
            }}
          >
            <span>{String(person.id).padStart(2, "0")}</span>
          </button>
        );
      })}
      <span className="floor-axis">X / Z · metres</span>
    </div>
  );
}

function App() {
  const engine = useMemo(() => new ExperienceEngine(), []);
  const [mode, setMode] = useState(() =>
    new URLSearchParams(location.search).get("mode") === "blush"
      ? "blush"
      : "pulse",
  );
  const modeRequest = useRef(null);
  const commitMode = useCallback((id) => {
    setMode(id);
    const url = new URL(location.href);
    url.searchParams.set("mode", id);
    history.replaceState(null, "", url);
  }, []);
  const [fluidVersion, setFluidVersion] = useState(0);
  const advancedRef = useRef();
  const openControls = (id) => {
    setTab(id);
    if (advancedRef.current) {
      advancedRef.current.open = true;
      advancedRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };
  const [settings, setSettings] = useState(DEFAULT_SETTINGS),
    [source, setSource] = useState(() => new URLSearchParams(location.search).get("source")==="live" ? "live" : "simulation"),
    [tab, setTab] = useState("scene"),
    [preset, setPreset] = useState("Gravitational");
  const [ready, setReady] = useState(false),
    [ui, setUi] = useState(0),
    [error, setError] = useState(""),
    [presentation, setPresentation] = useState(
      new URLSearchParams(location.search).has("output"),
    );
  const [recording, setRecording] = useState(false),
    [clipName, setClipName] = useState(""),
    [wallOpen, setWallOpen] = useState(true);
  const fileRef = useRef(),
    stageRef = useRef(),
    nativeRef = useRef();
  const trackerRef = useRef(),
    trackerDialogRef = useRef(),
    trackerReady = useRef(false),
    pendingTrackerCommand = useRef(null);
  const [trackerMounted, setTrackerMounted] = useState(false),
    [trackerOpen, setTrackerOpen] = useState(false);
  const [trackerStatus, setTrackerStatus] = useState(null);
  const refresh = () => setUi((v) => v + 1);
  const onReady = useCallback(() => setReady(true), []);
  useEffect(() => {
    if (new URLSearchParams(location.search).get("source")==="live") engine.setSource("live");
    return engine.connect();
  }, [engine]);
  useEffect(() => {
    const dialog = trackerDialogRef.current;
    if (!dialog) return;
    if (trackerOpen && !dialog.open) dialog.showModal();
    else if (!trackerOpen && dialog.open) dialog.close();
  }, [trackerMounted, trackerOpen]);
  useEffect(() => {
    const receive = (event) => {
      if (
        event.origin !== location.origin ||
        event.source !== trackerRef.current?.contentWindow ||
        event.data?.type !== "lunar-tracker-status"
      )
        return;
      setTrackerStatus(event.data);
      if (event.data.error) {
        setError(event.data.error);
        setTrackerOpen(true);
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  useEffect(() => {
    const timer = setInterval(refresh, 120);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const node = stageRef.current;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const scale = width / 3840;
      nativeRef.current.style.transform = `scale(${scale})`;
      nativeRef.current.style.left = `${(width - 3840 * scale) / 2}px`;
      nativeRef.current.style.top = `${(height - 1080 * scale) / 2}px`;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const key = (e) => {
      if (
        ["INPUT", "SELECT", "TEXTAREA"].includes(
          document.activeElement?.tagName,
        )
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        engine.paused = !engine.paused;
        refresh();
      }
      if (e.key.toLowerCase() === "h") setPresentation((v) => !v);
      if (e.key === "Escape") setPresentation(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [engine]);
  const change = (key, value) => setSettings((s) => ({ ...s, [key]: value }));
  const selectSource = (id) => {
    setSource(id);
    engine.setSource(id);
    setError("");
    if (id === "live") {
      setTrackerMounted(true);
      setTrackerOpen(true);
    } else {
      setTrackerMounted(false);
      trackerReady.current = false;
      setTrackerOpen(false);
      setTrackerStatus(null);
    }
  };
  const rescanCameras = () => {
    if (source !== "live") {
      setSource("live");
      engine.setSource("live");
    }
    setError("");
    setTrackerStatus({ busy: true, cameras: [] });
    setTrackerMounted(true);
    setTrackerOpen(true);
    if (trackerReady.current && trackerRef.current)
      trackerRef.current.contentWindow.postMessage(
        { type: "lunar-tracker-command", command: "rescan" },
        location.origin,
      );
    else pendingTrackerCommand.current = "rescan";
  };
  const importClip = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      if (file.size > 80 * 1024 * 1024)
        throw new Error("Pose files must be smaller than 80 MB.");
      engine.loadClip(JSON.parse(await file.text()));
      setSource("poses");
      setClipName(file.name);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  };
  const record = () => {
    if (!recording) {
      engine.beginRecording();
      setRecording(true);
    } else {
      const clip = engine.endRecording();
      setRecording(false);
      if (clip.frames.length < 2) {
        setError("Record for at least a second before saving.");
        return;
      }
      downloadBlob(
        new Blob([JSON.stringify(clip)], { type: "application/json" }),
        `lunar-poses-${Date.now()}.json`,
      );
    }
  };
  const fullscreen = async () => {
    try {
      await stageRef.current.requestFullscreen();
    } catch {
      setPresentation(true);
    }
  };
  const live =
    source === "live" &&
    engine.liveCameraCount > 0 &&
    performance.now() - engine.liveAt < 500;
  const people = engine.people;
  const currentScene = SCENES.find(
    (scene) => scene.id === engine.interactions.config.scene,
  );
  return (
    <div
      className={`studio ${presentation ? "presentation" : ""}`}
      data-ui={ui}
    >
      
      <main className="workspace">
        <section className="main-column">
          <section className="preview-panel" aria-label="Stage preview">
            <div className="panel-toolbar">
              <div>
              <div
                className="experience-modes"
                role="group"
                aria-label="Visual mode"
              >
                {["pulse", "blush"].map((id) => (
                  <button
                    key={id}
                    className={mode === id ? "selected" : ""}
                    aria-pressed={mode === id}
                    onClick={() => {
                      modeRequest.current = id;
                    }}
                  >
                    {id === "pulse" ? "Pulse" : "Blush"}
                  </button>
                ))}
              </div>
                <span className="toolbar-dim">
                  / {mode === "blush" ? "Fluid" : currentScene.name}
                </span>
              </div>
              <div>
                <button
                  className="camera-rescan"
                  onClick={rescanCameras}
                  disabled={trackerStatus?.busy}
                >
                  <RefreshCw size={12} />
                  {trackerStatus?.busy ? "Scanning…" : "Rescan cameras"}
                </button>
                <span className="resolution">3840 × 1080</span>
                <span className="toolbar-separator" />
                <button
                  className={
                    settings.skeletons ? "icon-button active" : "icon-button"
                  }
                  title="Toggle skeleton overlay"
                  aria-label="Toggle skeleton overlay"
                  onClick={() => change("skeletons", !settings.skeletons)}
                >
                  <ScanLine size={15} />
                </button>
                <button
                  className="icon-button"
                  title="Fullscreen stage"
                  aria-label="Fullscreen stage"
                  onClick={fullscreen}
                >
                  <Expand size={15} />
                </button>
              </div>
            </div>
            <div className="stage" ref={stageRef}>
              <div className="native-surface" ref={nativeRef}>
                <RenderBoundary onError={onReady}>
                  <Starfield
                    engine={engine}
                    settings={settings}
                    mode={mode}
                    onModeChange={commitMode}
                    modeRequest={modeRequest}
                    fluidVersion={fluidVersion}
                    onReady={onReady}
                  />
                </RenderBoundary>
              </div>
              {!ready && <div className="loading">INITIALIZING FIELD</div>}

            </div>
            
          </section>
          
        </section>
        <section className="operator-panel" aria-label="Tracking and calibration">
          
          <div className="operator-grid">
            <div className="source-section"><h3>Input source</h3>          <section className="input-panel">
            <div className="source-grid">
              {sources.map(({ id, title, detail, icon: Icon }, i) => (
                <button
                  key={id}
                  className={`source-card ${source === id ? "selected" : ""}`}
                  onClick={() => selectSource(id)}
                >
                  <div className="source-card-top">
                    <Icon size={19} strokeWidth={1.5} />
                    <span className="radio-dot" />
                  </div>
                  <strong>{title}</strong>
                  <span>{detail}</span>
                  <small>
                    0{i + 1} <ArrowUpRight size={12} />
                  </small>
                </button>
              ))}
            </div>
            <div className="source-detail">
              {source === "simulation" ? (
                <>
                  <div className="detail-copy">
                    <Move size={16} />
                    <span>
                      Drag a body in the floor plan, or let them wander.
                      <small>
                        33-joint skeletons, generated in real time. Your GPU
                        stays focused on the field.
                      </small>
                    </span>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => openControls("bodies")}
                  >
                    Edit bodies <ChevronRight size={14} />
                  </button>
                </>
              ) : source === "poses" ? (
                <>
                  <div className="detail-copy">
                    <Film size={17} />
                    <span>
                      {clipName ||
                        "Replay world joints without running pose or depth."}
                      <small>
                        Import a .json recording, or use Capture poses to record
                        any source.
                      </small>
                    </span>
                  </div>
                  <button
                    className="outline-button"
                    onClick={() => fileRef.current.click()}
                  >
                    <Upload size={13} /> Load poses
                  </button>
                </>
              ) : (
                <>
                  <div className="detail-copy">
                    <Radio size={17} />
                    <span>
                      {live
                        ? `${trackerStatus?.cameras?.length || engine.liveCameraCount} camera(s) · ${people.length} ${people.length === 1 ? "person" : "people"}`
                        : trackerStatus?.busy
                          ? "Scanning cameras…"
                          : trackerStatus?.cameras?.length
                            ? `${trackerStatus.cameras.length} camera(s) · waiting for poses`
                            : "Connect your ZED or load a stereo session."}
                    </span>
                  </div>
                  <div className="camera-actions">
                    <button
                      className="outline-button"
                      onClick={rescanCameras}
                      disabled={trackerStatus?.busy}
                    >
                      <RefreshCw size={13} /> Connect / rescan
                    </button>
                    <button
                      className="text-button"
                      onClick={() => {
                        setTrackerMounted(true);
                        setTrackerOpen((v) => !v);
                      }}
                    >
                      Camera settings <ChevronDown size={13} />
                    </button>
                  </div>
                </>
              )}
            </div>
            {source === "poses" && engine.clip && (
              <div className="clip-transport">
                <Slider
                  label="Playhead"
                  value={engine.time}
                  min={0}
                  max={engine.clip.duration / 1000 - 0.001}
                  step={0.01}
                  format={timecode}
                  onChange={(v) => {
                    engine.time = v;
                    refresh();
                  }}
                />
                <label>
                  Speed{" "}
                  <select
                    value={engine.rate}
                    onChange={(e) => {
                      engine.rate = Number(e.target.value);
                      refresh();
                    }}
                  >
                    {[0.25, 0.5, 1, 2].map((v) => (
                      <option key={v} value={v}>
                        {v}×
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </section>
</div>
            <div className="tracking-section">          <div className="floor-section">
            <div className="control-title">
              SPACE PREVIEW <span>TOP VIEW</span>
            </div>
            <FloorPlan engine={engine} onChange={refresh} />
            <div className="floor-legend">
              <span>{source === "simulation" ? "Drag to move · Double-click an empty spot to add or a dot to remove" : "Tracked bodies"}</span>
              <span>{people.length} / 6</span>
            </div>
          </div>
          <div className="wall-section">
            <button
              className="disclosure"
              onClick={() => setWallOpen(!wallOpen)}
            >
              <span>
                <Crosshair size={13} /> Wall calibration
              </span>
              {wallOpen ? (
                <ChevronDown size={13} />
              ) : (
                <ChevronRight size={13} />
              )}
            </button>
            {wallOpen && (
              <div className="wall-controls">
                <p className="control-hint">
                  World metres, X right / Y down / Z forward. The wall origin is
                  its centre.
                </p>
                {[
                  ["x", "Centre X", -10, 10],
                  ["y", "Centre Y", -5, 5],
                  ["z", "Centre Z", -10, 10],
                  ["yaw", "Yaw", -180, 180],
                  ["width", "Width", 1, 20],
                  ["height", "Height", 0.5, 8],
                  ["near", "Full influence", 0, 1],
                  ["far", "Influence cutoff", 1.01, 5],
                ].map(([key, label, min, max]) => (
                  <Slider
                    key={key}
                    label={label}
                    value={engine.wall[key]}
                    min={min}
                    max={max}
                    step={key === "yaw" ? 1 : 0.05}
                    unit={key === "yaw" ? "°" : " m"}
                    onChange={(v) => {
                      engine.wall[key] = v;
                      refresh();
                    }}
                  />
                ))}
              </div>
            )}
          </div>
</div>
          </div>
        </section>
        <details className="advanced-panel" ref={advancedRef}>
          <summary>Scene, motion & simulation <span>Creative controls and rehearsal tools</span></summary>
          <aside className="inspector">
          <div className="inspector-tabs">
            <button
              className={tab === "scene" ? "active" : ""}
              onClick={() => setTab("scene")}
            >
              <Sparkles size={14} />
              Scene
            </button>
            <button
              className={tab === "field" ? "active" : ""}
              onClick={() => setTab("field")}
            >
              <Settings2 size={14} />
              Field
            </button>
            <button
              className={tab === "bodies" ? "active" : ""}
              onClick={() => setTab("bodies")}
            >
              <ScanLine size={14} />
              Bodies <span>{people.length}</span>
            </button>
          </div>
          {mode === "blush" && tab !== "bodies" ? (
            <BlushControls
              settings={settings}
              change={change}
              reset={() => setFluidVersion((v) => v + 1)}
            />
          ) : tab === "scene" ? (
            <InteractionControls engine={engine} onChange={refresh} />
          ) : tab === "field" ? (
            <div className="inspector-content">
              <div className="control-section">
                <div className="control-title">
                  LOOK & FEEL <Sparkles size={13} />
                </div>
                <label className="select-label">
                  Preset
                  <select
                    value={preset}
                    onChange={(e) => {
                      setPreset(e.target.value);
                      setSettings((s) => ({
                        ...s,
                        ...PRESETS[e.target.value],
                        ...Object.fromEntries(
                          Object.keys(BLUSH_DEFAULTS).map((key) => [
                            key,
                            s[key],
                          ]),
                        ),
                      }));
                    }}
                  >
                    {Object.keys(PRESETS).map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </label>
                <div className="palette-label">
                  Palette
                  <div className="palettes">
                    {PALETTES.map((p) => (
                      <button
                        key={p.id}
                        title={p.name}
                        aria-label={`${p.name} palette`}
                        className={settings.palette === p.id ? "selected" : ""}
                        onClick={() => change("palette", p.id)}
                      >
                        {[p.cold, p.mid, p.hot].map((c) => (
                          <span key={c} style={{ background: c }} />
                        ))}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="control-section">
                <div className="control-title">
                  DEFORMATION <Focus size={14} />
                </div>
                <Slider
                  label="Strength"
                  value={settings.strength}
                  min={0}
                  max={3}
                  onChange={(v) => change("strength", v)}
                />
                <Slider
                  label="Influence radius"
                  value={settings.radius}
                  min={0.1}
                  max={1.2}
                  unit=" m"
                  onChange={(v) => change("radius", v)}
                />
                <Slider
                  label="Sky rotation"
                  value={settings.drift}
                  min={0}
                  max={2}
                  onChange={(v) => change("drift", v)}
                />
              </div>
              <div className="control-section">
                <div className="control-title">
                  RENDERING <Circle size={12} />
                </div>
                <Slider
                  label="Particle count"
                  value={settings.particles}
                  min={15000}
                  max={150000}
                  step={5000}
                  format={(v) => `${v / 1000}K`}
                  onChange={(v) => change("particles", v)}
                />
                <Slider
                  label="Bloom"
                  value={settings.bloom}
                  min={0}
                  max={1.5}
                  onChange={(v) => change("bloom", v)}
                />
                <Slider
                  label="Exposure"
                  value={settings.exposure}
                  min={0.4}
                  max={2.5}
                  onChange={(v) => change("exposure", v)}
                />
                <Slider
                  label="Nebula density"
                  value={settings.nebula}
                  min={0}
                  max={1.5}
                  onChange={(v) => change("nebula", v)}
                />
                <Toggle
                  label="Skeleton overlay"
                  value={settings.skeletons}
                  onChange={(v) => change("skeletons", v)}
                />
              </div>
            </div>
          ) : (
            <div className="inspector-content">
              <div className="control-section">
                <div className="control-title">
                  SIMULATION <ScanLine size={14} />
                </div>
                <Slider
                  label="Body count"
                  value={engine.sim.count}
                  min={0}
                  max={6}
                  step={1}
                  onChange={(v) => {
                    engine.sim.count = v;
                    if (!engine.sim.positions.slice(0,v).some(p=>p.id===engine.sim.selected)) engine.sim.selected = v ? engine.sim.positions[0].id : null;
                    refresh();
                  }}
                />
                <label className="select-label">
                  Movement
                  <select
                    disabled={source !== "simulation"}
                    value={engine.sim.motion}
                    onChange={(e) => {
                      engine.sim.motion = e.target.value;
                      engine.sim.positions.forEach(body => { body.placed = false; });
                      refresh();
                    }}
                  >
                    <option value="wander">Wander</option>
                    <option value="manual">Manual position</option>
                    <option value="reach">Reach & wave</option>
                  </select>
                </label>
                <label className="select-label">
                  Selected body
                  <select
                    value={engine.sim.selected ?? ""}
                    onChange={(e) => {
                      engine.sim.selected = Number(e.target.value);
                      refresh();
                    }}
                  >
                    {engine.sim.positions
                      .slice(0, engine.sim.count)
                      .map(({id}) => (
                        <option key={id} value={id}>
                          Body {String(id).padStart(2, "0")}
                        </option>
                      ))}
                  </select>
                </label>
                <Slider
                  label="Distance to wall"
                  value={
                    engine.sim.positions.find(p=>p.id===engine.sim.selected)?.distance ||
                    0.65
                  }
                  min={0.05}
                  max={3.5}
                  unit=" m"
                  onChange={(v) => {
                    const body = engine.sim.positions.find(p=>p.id===engine.sim.selected);
                    if (!body) return;
                    body.distance = v;
                    engine.sim.motion = "manual";
                    refresh();
                  }}
                />
                <Toggle
                  label="Skeleton overlay"
                  value={settings.skeletons}
                  onChange={(v) => change("skeletons", v)}
                />
                <p className="control-hint">
                  Manual controls affect the simulation source. Switch to
                  simulated bodies to use them.
                </p>
              </div>
              <div className="control-section">
                <div className="control-title">
                  POSE CAPTURE <Circle size={12} />
                </div>
                <p className="control-hint">
                  Capture any source as a lightweight recording. Replay it
                  without camera processing.
                </p>
                <button
                  className={`capture-button ${recording ? "recording" : ""}`}
                  onClick={record}
                >
                  <Circle size={10} fill="currentColor" />
                  {recording ? "Stop & save poses" : "Capture poses"}
                  {recording && (
                    <span>{engine.recording?.frames.length || 0}f</span>
                  )}
                </button>
              </div>
            </div>
          )}
          <div className="inspector-footer">
            <span className="status-light" />{" "}
            {source === "simulation"
              ? "Simulation ready"
              : source === "poses"
                ? "Pose playback ready"
                : live
                  ? "Tracker connected"
                  : "Tracker disconnected"}
            <button
              className="icon-button"
              aria-label="Reset field settings"
              title="Reset field settings"
              onClick={() => {
                setSettings({ ...DEFAULT_SETTINGS });
                setPreset("Gravitational");
                setFluidVersion((v) => v + 1);
              }}
            >
              <RotateCcw size={12} />
            </button>
          </div>
          </aside>
        </details>
      </main>
      <footer className="app-footer">
        <span>LUNAR / INTERACTIVE ENVIRONMENTS</span>
        <span>WORLD SPACE → BODY FIELD → LIGHT</span>
        <span>
          <span className="status-light" /> ALL SYSTEMS LOCAL
        </span>
      </footer>
      <button
        className="exit-presentation"
        onClick={() => {
          setPresentation(false);
          if (document.fullscreenElement) document.exitFullscreen();
        }}
      >
        <X size={14} /> Exit output <kbd>H</kbd>
      </button>
      {error && (
        <div className="toast" role="alert">
          {error}
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {trackerMounted && (
        <dialog
          ref={trackerDialogRef}
          className="camera-dialog"
          onCancel={() => setTrackerOpen(false)}
          onClose={() => setTrackerOpen(false)}
        >
          <div className="embedded-tracker-toolbar">
            <span>CAMERAS & STEREO SESSIONS</span>
            <div className="camera-actions">
              <button className="text-button" onClick={rescanCameras}>
                <RefreshCw size={12} />
                Rescan cameras
              </button>
              <button
                className="icon-button"
                aria-label="Close camera settings"
                onClick={() => setTrackerOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
          </div>
          <iframe
            ref={trackerRef}
            title="Camera settings"
            src={`${import.meta.env.BASE_URL}tracker.html?embedded=1`}
            allow="camera"
            onLoad={() => {
              trackerReady.current = true;
              if (pendingTrackerCommand.current) {
                trackerRef.current.contentWindow.postMessage(
                  {
                    type: "lunar-tracker-command",
                    command: pendingTrackerCommand.current,
                  },
                  location.origin,
                );
                pendingTrackerCommand.current = null;
              }
            }}
          />
        </dialog>
      )}
      <input
        ref={fileRef}
        hidden
        type="file"
        accept=".json"
        onChange={importClip}
      />
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
