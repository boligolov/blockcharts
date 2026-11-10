(function () {
  /** The spread of sorted numbers for a kernel width: the standard deviation, or the interquartile range / 1.34 when that is
   *  smaller (a long tail or two humps do not widen the kernel); 0 for numbers all alike. */
  function spread(sorted: ArrayLike<number>): number {
    const n = sorted.length;
    if (n < 2) return 0;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += sorted[i];
    mean /= n;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += (sorted[i] - mean) * (sorted[i] - mean);
    const sd = Math.sqrt(sum / (n - 1));
    const at = (p: number) => {
      const i = p * (n - 1);
      const lo = Math.floor(i);
      return sorted[lo] + (sorted[Math.min(n - 1, lo + 1)] - sorted[lo]) * (i - lo);
    };
    const iqr = at(0.75) - at(0.25);
    return iqr > 0 ? Math.min(sd, iqr / 1.34) : sd;
  }

  const def: BC.LibDef = {
    role: 'lib',
    type: 'stats',
    version: 1,
    doc: 'Statistics shared by transform.density and transform.contour. `spread(sorted)` is the spread of sorted numbers that the width of a smoothing kernel is made from: the standard deviation, or the interquartile range / 1.34 when that is smaller, and 0 for numbers all alike. A spec never names it.',
    exports: { spread },
  };

  BC.define(def);
})();
