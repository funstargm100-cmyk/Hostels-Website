// Verify rotation knob no longer jumps: leftover travel must be reset per drag.
export default async function run(page) {
  const drag = (px, steps) => page.evaluate(({ px, steps }) => {
    const knob = document.getElementById('mapRotateKnob');
    const icon = knob.querySelector('svg, i');
    const opts = (mx) => ({ bubbles: true, cancelable: true, pointerId: 1, clientX: 100, clientY: 100, movementX: mx });
    let err = null;
    try {
      knob.dispatchEvent(new PointerEvent('pointerdown', opts(0)));
      for (let i = 0; i < steps; i++) knob.dispatchEvent(new PointerEvent('pointermove', opts(px / steps)));
      knob.dispatchEvent(new PointerEvent('pointerup', opts(0)));
    } catch (e) { err = e.message; }
    const pane = document.querySelector('.leaflet-map-pane');
    const m = pane ? /translate3d\([^)]+\)\s*(?:rotate\((-?\d+(?:\.\d+)?)deg\))?/.exec(pane.style.transform) : null;
    return { err, transform: pane ? pane.style.transform : null, bearing: m && m[2] !== undefined ? m[2] : '0' };
  }, { px, steps });
  const out = {};
  out.drag1_100px = await drag(100, 10);   // expect ~20deg
  out.drag2_1px = await drag(1, 1);        // expect ~20deg (NOT ~40: leftover reset)
  out.drag3_minus50 = await drag(-50, 5);  // expect ~10deg
  return out;
}
