(function (BC: BC.Runtime) {
  const r2 = (v: number) => Math.round(v * 100) / 100;

  /** Tangents of a monotone cubic through the points (x ascending): the curve never overshoots a point (Fritsch–Carlson). */
  function tangents(px: number[], py: number[]): number[] {
    const n = px.length;
    const d: number[] = [];
    for (let k = 0; k < n - 1; k++) {
      const h = px[k + 1] - px[k];
      d.push(h ? (py[k + 1] - py[k]) / h : 0);
    }
    const m: number[] = new Array(n);
    m[0] = d[0] || 0;
    m[n - 1] = d[n - 2] || 0;
    for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2;
    for (let k = 0; k < n - 1; k++) {
      if (!d[k]) {
        m[k] = 0;
        m[k + 1] = 0;
        continue;
      }
      const a = m[k] / d[k];
      const b = m[k + 1] / d[k];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        m[k] = t * a * d[k];
        m[k + 1] = t * b * d[k];
      }
    }
    return m;
  }

  /** Path commands through the points after the first one: straight segments, a smooth monotone curve, or steps (a value
   *  holds until the next point, then jumps). `back` walks them from the last point to the first (the lower edge of an
   *  area). The caller has already moved to the start. `true` is "smooth", as the first version took it. */
  function through(px: number[], py: number[], curve: string | boolean, back: boolean): string {
    const n = px.length;
    let d = '';
    if (curve === 'step') {
      // forwards: along at the old value, then up or down to the new one; backwards the same corners in reverse
      if (back) for (let k = n - 1; k > 0; k--) d += 'V' + r2(py[k - 1]) + 'H' + r2(px[k - 1]);
      else for (let k = 1; k < n; k++) d += 'H' + r2(px[k]) + 'V' + r2(py[k]);
      return d;
    }
    const smooth = curve === true || curve === 'smooth';
    if (!smooth || n < 3) {
      if (back) for (let k = n - 2; k >= 0; k--) d += 'L' + r2(px[k]) + ' ' + r2(py[k]);
      else for (let k = 1; k < n; k++) d += 'L' + r2(px[k]) + ' ' + r2(py[k]);
      return d;
    }
    const m = tangents(px, py);
    if (back) {
      for (let k = n - 1; k > 0; k--) {
        const h = (px[k] - px[k - 1]) / 3;
        d +=
          'C' +
          r2(px[k] - h) +
          ' ' +
          r2(py[k] - m[k] * h) +
          ' ' +
          r2(px[k - 1] + h) +
          ' ' +
          r2(py[k - 1] + m[k - 1] * h) +
          ' ' +
          r2(px[k - 1]) +
          ' ' +
          r2(py[k - 1]);
      }
    } else {
      for (let k = 0; k < n - 1; k++) {
        const h = (px[k + 1] - px[k]) / 3;
        d +=
          'C' +
          r2(px[k] + h) +
          ' ' +
          r2(py[k] + m[k] * h) +
          ' ' +
          r2(px[k + 1] - h) +
          ' ' +
          r2(py[k + 1] - m[k + 1] * h) +
          ' ' +
          r2(px[k + 1]) +
          ' ' +
          r2(py[k + 1]);
      }
    }
    return d;
  }

  const def: BC.LibDef = {
    role: 'lib',
    type: 'curve',
    version: 2,
    doc: 'The path of a line through points, shared by mark.line and mark.area: straight segments, a monotone cubic that passes through every point and never overshoots between two of them, or steps (each value holds until the next point). `through(px, py, curve, back)` returns the path commands after the first point for curve "linear", "smooth" or "step"; `back` walks the points from the last to the first. A spec never names it.',
    exports: { through },
  };

  BC.define(def);
})((globalThis as any).BC);
