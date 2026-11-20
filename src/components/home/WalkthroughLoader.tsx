import { useEffect, useRef, type CSSProperties, type RefObject } from "react";

const MIN_DURATION = 4500;
const stages = [
  { at: 0, text: "Opening the doors" },
  { at: 0.16, text: "Laying the stone" },
  { at: 0.4, text: "Placing the furniture" },
  { at: 0.64, text: "Planting the garden" },
  { at: 0.86, text: "Letting in the light" },
];
// Each storey appears once the bar passes its threshold; the roof closes at 100%.
const floorThresholds = [0.18, 0.38, 0.58, 0.78, 0.99];

// The drawing is laid out on a 260 × 200 grid, positioned in percentages.
type Box = { x: number; y: number; w?: number; h?: number; d?: number };
const box = ({ x, y, w, h, d = 0 }: Box) =>
  ({
    left: `${(x / 260) * 100}%`,
    top: `${(y / 200) * 100}%`,
    ...(w !== undefined && { width: `${(w / 260) * 100}%` }),
    ...(h !== undefined && { height: `${(h / 200) * 100}%` }),
    "--d": `${d}s`,
  }) as CSSProperties;

function Floor({ index }: { index: number }) {
  const y = 180 - index * 34;
  return (
    <div className="wl-floor" data-floor={index}>
      <i className="wl-glow" style={box({ x: 72, y: y - 33, w: 116, h: 32 })} />
      <i className="wl-h wl-slab" style={box({ x: 64, y, w: 132 })} />
      {[70, 190, 150].map((x, i) => (
        <i key={x} className="wl-v" style={box({ x, y: y - 34, h: 34, d: 0.12 + i * 0.08 })} />
      ))}
      {[118, 134, 170].map((x, i) => (
        <i key={x} className="wl-v wl-fine" style={box({ x, y: y - 34, h: 34, d: 0.34 + i * 0.06 })} />
      ))}
      <svg className="wl-stair" viewBox="0 0 28 34" style={box({ x: 76, y: y - 34, w: 28, h: 34 })}>
        <path d="M0 34 v-5.67 h4.67 v-5.67 h4.67 v-5.67 h4.67 v-5.67 h4.67 v-5.67 h4.67 v-5.67 h4.67" />
      </svg>
    </div>
  );
}

/** Line drawing of the residence that builds as the walkthrough loads. Every
 * moving part animates transform or opacity, so it stays fluid on the
 * compositor while the 3D scene occupies the main thread. */
export function WalkthroughLoader({
  assets,
  ready,
  onDone,
}: {
  assets: RefObject<number | null>;
  ready: boolean;
  onDone: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const readyRef = useRef(ready);
  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);

  useEffect(() => {
    const node = root.current!;
    const percent = node.querySelector<HTMLElement>(".wl-percent")!;
    const bar = node.querySelector<HTMLElement>(".wl-bar span")!;
    const status = node.querySelector<HTMLElement>(".wl-status")!;
    const floors = Array.from(node.querySelectorAll<HTMLElement>("[data-floor]"));
    // rAF timestamps can precede this effect, so the clock starts on the first frame.
    let start = 0, last = 0, shown = 0, assetsDone = 0, stage = 0, built = -1, frame = 0, timer = 0;
    const tick = (now: number) => {
      start ||= now;
      const dt = Math.min(0.1, Math.max(0, (now - (last || now)) / 1000));
      last = now;
      const elapsed = now - start;
      const fraction = assets.current;
      let real: number;
      if (readyRef.current) real = 1;
      else if (fraction === null) real = 0.14 * (1 - Math.exp(-elapsed / 2500));
      else if (fraction < 1) real = 0.14 + 0.72 * fraction;
      else {
        assetsDone ||= now;
        real = 0.86 + 0.11 * (1 - Math.exp(-(now - assetsDone) / 3000));
      }
      // Never faster than the minimum duration, eased so it settles gracefully.
      const t = Math.min(1, elapsed / MIN_DURATION);
      const paced = 1 - (1 - t) ** 2;
      const target = Math.min(real, paced);
      shown += (target - shown) * (1 - Math.exp(-dt * 5));
      if (target === 1 && 1 - shown < 0.003) shown = 1;
      percent.textContent = String(Math.round(shown * 100));
      bar.style.transform = `scaleX(${shown})`;
      const nextStage = stages.reduce((found, s, i) => (shown >= s.at ? i : found), 0);
      if (nextStage !== stage) {
        stage = nextStage;
        status.textContent = stages[stage].text;
        status.animate(
          [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }],
          { duration: 600, easing: "cubic-bezier(.16,1,.3,1)" },
        );
      }
      const nextBuilt = floorThresholds.filter((threshold) => shown >= threshold).length;
      if (nextBuilt !== built) {
        built = nextBuilt;
        floors.forEach((floor, i) => floor.toggleAttribute("data-on", i < built));
      }
      if (shown === 1) {
        timer = window.setTimeout(() => {
          node.dataset.state = "done";
          timer = window.setTimeout(onDone, 1000);
        }, 450);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [assets, onDone]);

  return (
    <div ref={root} className="walkthrough-loader">
      <div className="wl-panel">
        <div className="wl-stage" aria-hidden="true">
          <i className="wl-h wl-ground" style={box({ x: 12, y: 182, w: 236 })} />
          <i className="wl-v wl-trunk" style={box({ x: 40, y: 162, h: 20, d: 0.5 })} />
          <i className="wl-ring" style={box({ x: 26, y: 136, w: 28, d: 0.75 })} />
          <i className="wl-v wl-trunk" style={box({ x: 222, y: 158, h: 24, d: 0.6 })} />
          <i className="wl-ring" style={box({ x: 205, y: 125, w: 34, d: 0.9 })} />
          {[0, 1, 2, 3].map((i) => (
            <Floor key={i} index={i} />
          ))}
          <div className="wl-floor" data-floor={4}>
            <i className="wl-h wl-slab" style={box({ x: 60, y: 44, w: 140 })} />
            {[150, 162, 174, 186].map((x, i) => (
              <i key={x} className="wl-v wl-fine" style={box({ x, y: 36, h: 8, d: 0.15 + i * 0.06 })} />
            ))}
            <i className="wl-h wl-fine" style={box({ x: 146, y: 36, w: 48, d: 0.4 })} />
            <i className="wl-ring wl-sun" style={box({ x: 226, y: 25, w: 18, d: 0.3 })} />
          </div>
          <i className="wl-scan" />
        </div>
        <div className="wl-meta">
          <p className="wl-eyebrow">Preparing the walkthrough</p>
          <p className="wl-figure">
            <span className="wl-percent">0</span>
            <em>%</em>
          </p>
        </div>
        <div className="wl-bar">
          <span />
        </div>
        <div className="wl-foot">
          <span className="wl-status" role="status" aria-live="polite">
            {stages[0].text}
          </span>
          <span>One residence · Four levels</span>
        </div>
      </div>
    </div>
  );
}
