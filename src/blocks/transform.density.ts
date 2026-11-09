(function () {
  const STEPS = 80;
  const MAX_STEPS = 1000;
  const SQRT2PI = Math.sqrt(2 * Math.PI);

  function fail(message: string): never {
    throw new Error('transform.density: ' + message);
  }

  function namesOf(spec: BC.TransformSpec): [string, string] {
    const as = spec.as;
    if (as === undefined) return ['value', 'density'];
    if (Array.isArray(as) && as.length === 2 && typeof as[0] === 'string' && typeof as[1] === 'string' && as[0] && as[1] && as[0] !== as[1])
      return [as[0], as[1]];
    return fail('"as" must be two different column names: [value, density]');
  }

  /** Silverman's rule of thumb: 0.9 · min(sd, IQR / 1.34) · n^-1/5. Samples all alike have no spread, so a width is made
   *  up from their size, and the curve is a narrow bump rather than a division by zero. */
  function bandwidthOf(sorted: number[]): number {
    const n = sorted.length;
    const mean = sorted.reduce((a, b) => a + b, 0) / n;
    const sd = n > 1 ? Math.sqrt(sorted.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1)) : 0;
    const at = (p: number) => {
      const i = p * (n - 1);
      const lo = Math.floor(i);
      return sorted[lo] + (sorted[Math.min(n - 1, lo + 1)] - sorted[lo]) * (i - lo);
    };
    const iqr = at(0.75) - at(0.25);
    const spread = iqr > 0 ? Math.min(sd, iqr / 1.34) : sd;
    if (spread > 0) return 0.9 * spread * Math.pow(n, -0.2);
    return Math.abs(sorted[0]) * 0.05 || 1;
  }

  const def: BC.TransformDef = {
    role: 'transform',
    type: 'density',
    version: 1,
    replacesColumns: true,
    doc: 'How the raw values of `field` are spread, as a smooth curve (a kernel density estimate): for every group, `steps` evenly spaced rows from a little below its smallest value to a little above its largest, each with the `value` and the `density` there. Draw it with mark.violin (violin plots, ridgelines), or with mark.area / mark.line on x = value, y = density. The curve of each group encloses an area of 1 (with `counts`, its number of samples, so bigger groups are bigger). Replaces the rows: the output has the group field, value, density and `count`, the number of samples of the group.',
    params: {
      field: { kind: 'field', required: true, doc: 'Numeric field with the raw samples. Missing and non-numeric values are ignored.' },
      group: {
        kind: 'field',
        doc: 'A curve per value of this field (the category of a violin or a ridge). A missing value is a group of its own. Default: one curve.',
      },
      bandwidth: {
        kind: 'number',
        doc: "How smooth the curve is, in the units of the field: the width of the bump each sample adds. Default: Silverman's rule, per group. Smaller shows more detail and more noise.",
      },
      steps: { kind: 'number', default: STEPS, doc: 'Rows per curve (2 to 1000).' },
      extent: {
        kind: 'list',
        doc: 'The range [low, high] the curves are cut to: [0, null] for values that cannot be negative (times, prices), so a curve does not run below 0. null leaves that end to the data.',
      },
      counts: { kind: 'boolean', default: false, doc: 'Multiply each curve by its number of samples, so a group of 500 is ten times a group of 50.' },
      as: { kind: 'list', doc: 'Names of the two new columns: [value, density].' },
    },
    outputs(spec) {
      const [v, d] = namesOf(spec);
      return typeof spec.group === 'string' ? [spec.group, v, d, 'count'] : [v, d, 'count'];
    },
    apply(table, spec) {
      if (typeof spec.field !== 'string' || !spec.field) fail('"field" must be the name of a numeric field');
      const values = table.columns[spec.field];
      if (!values) fail(`unknown field "${spec.field}"`);
      const groupField = typeof spec.group === 'string' ? spec.group : undefined;
      const groupCol = groupField ? table.columns[groupField] : undefined;
      if (groupField && !groupCol) fail(`unknown field "${groupField}"`);
      const [asValue, asDensity] = namesOf(spec);
      const steps = spec.steps === undefined ? STEPS : (spec.steps as number);
      if (!(typeof steps === 'number' && Math.floor(steps) === steps && steps >= 2 && steps <= MAX_STEPS))
        fail(`"steps" must be a whole number from 2 to ${MAX_STEPS}`);
      const given = spec.bandwidth;
      if (given !== undefined && !(typeof given === 'number' && isFinite(given) && given > 0)) fail('"bandwidth" must be a positive number');
      let lo = -Infinity;
      let hi = Infinity;
      if (spec.extent !== undefined) {
        const e = spec.extent as unknown[];
        const ok = (v: unknown) => v === null || (typeof v === 'number' && isFinite(v));
        if (!Array.isArray(e) || e.length !== 2 || !ok(e[0]) || !ok(e[1])) fail('"extent" must be [low, high]: two numbers, or null for an end the data decides');
        if (typeof e[0] === 'number') lo = e[0];
        if (typeof e[1] === 'number') hi = e[1];
        if (!(lo < hi)) fail('"extent" must run from low to high');
      }

      // samples per group, groups in first-appearance order; NaN and null are one missing group
      const keyIndex = new Map<unknown, number>();
      const keys: unknown[] = [];
      const buckets: number[][] = [];
      for (let i = 0; i < table.length; i++) {
        const raw = groupCol ? groupCol[i] : undefined;
        const key = raw == null || (typeof raw === 'number' && isNaN(raw)) ? null : raw;
        let gi = keyIndex.get(key);
        if (gi === undefined) {
          gi = keys.length;
          keyIndex.set(key, gi);
          keys.push(raw);
          buckets.push([]);
        }
        const v = values[i];
        // a sample outside the extent still counts: the extent cuts the curve, not the data
        if (typeof v === 'number' && isFinite(v)) buckets[gi].push(v);
      }

      const outGroup: unknown[] = [];
      const outValue: number[] = [];
      const outDensity: number[] = [];
      const outCount: number[] = [];
      for (let gi = 0; gi < keys.length; gi++) {
        const samples = buckets[gi].sort((a, b) => a - b);
        const n = samples.length;
        if (!n) continue;
        const bw = typeof given === 'number' ? given : bandwidthOf(samples);
        // the tails run three widths past the outermost samples, where a bump has all but vanished, unless the extent cuts them
        const from = Math.max(lo, samples[0] - 3 * bw);
        const to = Math.min(hi, samples[n - 1] + 3 * bw);
        if (!(to > from)) continue; // every sample lies beyond the extent
        const scale = (spec.counts === true ? n : 1) / (n * bw * SQRT2PI);
        // only the samples within a few widths of a point add to it: two pointers walk the sorted samples along the grid
        let left = 0;
        let right = 0;
        const reach = 6 * bw;
        for (let k = 0; k < steps; k++) {
          const x = from + ((to - from) * k) / (steps - 1);
          while (left < n && samples[left] < x - reach) left++;
          while (right < n && samples[right] <= x + reach) right++;
          let sum = 0;
          for (let j = left; j < right; j++) {
            const u = (x - samples[j]) / bw;
            sum += Math.exp(-0.5 * u * u);
          }
          outGroup.push(keys[gi]);
          outValue.push(x);
          outDensity.push(sum * scale);
          outCount.push(n);
        }
      }

      const columns: Record<string, BC.Column> = {
        [asValue]: Float64Array.from(outValue),
        [asDensity]: Float64Array.from(outDensity),
        count: Float64Array.from(outCount),
      };
      if (groupField) columns[groupField] = outGroup;
      return { length: outValue.length, columns };
    },
  };

  BC.define(def);
})();
