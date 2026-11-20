/** Inertial mouse-wheel scrolling on desktop. It eases the real document scroll
 * position, so ScrollTrigger pins, anchors, keyboard and scrollbar stay native.
 */
const query = "(pointer: fine) and (prefers-reduced-motion: no-preference)";
const response = 9;

function nestedScroller(event: WheelEvent) {
  for (const node of event.composedPath()) {
    if (!(node instanceof HTMLElement) || node === document.body || node === document.documentElement) continue;
    const style = getComputedStyle(node);
    if (!/(auto|scroll|overlay)/.test(style.overflowY) || node.scrollHeight <= node.clientHeight) continue;
    const room = event.deltaY > 0 ? node.scrollHeight - node.clientHeight - node.scrollTop : node.scrollTop;
    if (room > 1) return true;
  }
  return false;
}

export function installSmoothWheel() {
  if (!matchMedia(query).matches) return () => {};
  let target = window.scrollY;
  let frame = 0;
  let last = 0;
  let written = -1;
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };
  const write = (y: number) => {
    window.scrollTo(0, y);
    written = window.scrollY;
  };
  const step = (time: number) => {
    const dt = Math.min(0.05, (time - last) / 1000 || 1 / 60);
    last = time;
    const current = window.scrollY;
    // Scrollbar drags, scripts and pin realignment move the page too: yield to them.
    if (written >= 0 && Math.abs(current - written) > 2) {
      frame = 0;
      return;
    }
    const gap = target - current;
    if (Math.abs(gap) < 0.6) {
      write(target);
      frame = 0;
      return;
    }
    write(current + gap * (1 - Math.exp(-response * dt)));
    frame = requestAnimationFrame(step);
  };
  const wheel = (event: WheelEvent) => {
    if (event.defaultPrevented || event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const root = getComputedStyle(document.documentElement).overflowY, body = getComputedStyle(document.body).overflowY;
    if (root === "hidden" || body === "hidden" || nestedScroller(event)) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
    if (!frame) target = window.scrollY;
    const max = document.documentElement.scrollHeight - innerHeight;
    target = Math.max(0, Math.min(max, target + event.deltaY * unit));
    if (!frame) {
      last = performance.now();
      written = -1;
      frame = requestAnimationFrame(step);
    }
  };
  // Any other navigation takes over from the wheel immediately.
  const interrupt = () => stop();
  const interrupts = ["keydown", "pointerdown", "touchstart", "studio:scroll-to"];
  window.addEventListener("wheel", wheel, { passive: false });
  interrupts.forEach(name => window.addEventListener(name, interrupt, { passive: true }));
  return () => {
    stop();
    window.removeEventListener("wheel", wheel);
    interrupts.forEach(name => window.removeEventListener(name, interrupt));
  };
}
