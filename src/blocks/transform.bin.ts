(function () {
  const MAX_BINS = 5000;

  function niceStep(span: number, count: number): number {
    const raw = span / Math.max(1, count);
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / pow;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow;
  }

  function outputNames(spec: BC.TransformSpec): [string, string, string] {
    const as = spec.as;
    if (as === undefined) return ['bin0', 'bin1', 'count'];
    if (Array.isArray(as) && as.length === 3 && as.every((n) => typeof n === 'string' && n) && new Set(as).size === 3) return [as[0], as[1], as[2]];
    throw new Error('transform.bin: "as" must be three different column names, e.g. ["bin0", "bin1", "count"]');
  }

  const def: BC.TransformDef = {
    role: 'transform',
    type: 'bin',
    version: 2,
    replacesColumns: true,
    doc: 'Counts the values of `field` in equal-width bins with round edges and returns one row per bin: its start, its end and the count (`as`, default bin0 / bin1 / count). Empty bins are kept, so a histogram has no gaps. Bins are [start, end) except the last, which includes its end. With `group` there is a row per bin and group, for stacking or side-by-side comparison. Draw it as a rect with x = start, x2 = end and y = count.',
    params: {
      field: { kind: 'field', required: true, doc: 'Numeric field to count. Missing and non-numeric values are ignored.' },
      bins: { kind: 'number', default: 10, doc: 'Approximate number of bins; the width is rounded to 1, 2, 5 × 10^n.' },
      width: { kind: 'number', doc: 'Exact bin width; overrides `bins`.' },
      extent: { kind: 'list', doc: '[min, max] to bin; values outside are ignored. Default: the range of the data.' },
      group: { kind: 'field', doc: 'Count separately for every value of this field.' },
      as: { kind: 'list', doc: 'Names of the three new columns: [start, end, count].' },
    },
    outputs(spec) {
      const [a, b, c] = outputNames(spec);
      return typeof spec.group === 'string' ? [a, b, c, spec.group] : [a, b, c];
    },
    apply(table, spec) {
      const field = spec.field as string;
      const values = table.columns[field];
      if (!values) throw new Error(`transform.bin: unknown field "${field}"`);
      const groupField = typeof spec.group === 'string' ? spec.group : undefined;
      const groups = groupField ? table.columns[groupField] : undefined;
      if (groupField && !groups) throw new Error(`transform.bin: unknown field "${groupField}"`);
      const [as0, as1, asN] = outputNames(spec);

      let lo = Infinity;
      let hi = -Infinity;
      let any = false;
      let notNumbers = false;
      for (let i = 0; i < table.length; i++) {
        const v = values[i];
        if (typeof v !== 'number') {
          if (v != null) notNumbers = true;
          continue;
        }
        if (!isFinite(v)) continue;
        any = true;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (Array.isArray(spec.extent)) {
        const [a, b] = spec.extent.map(Number);
        if (!isFinite(a) || !isFinite(b) || a >= b) throw new Error('transform.bin: "extent" must be [min, max] with min < max');
        lo = a;
        hi = b;
      } else if (!any) {
        if (notNumbers) throw new Error(`transform.bin: field "${field}" has no numeric values`);
        return { length: 0, columns: { [as0]: new Float64Array(0), [as1]: new Float64Array(0), [asN]: new Float64Array(0), ...(groupField ? { [groupField]: [] } : {}) } };
      }
      if (lo === hi) {
        lo -= 0.5;
        hi += 0.5;
      }

      let step: number;
      if (spec.width !== undefined) {
        step = Number(spec.width);
        if (!isFinite(step) || step <= 0) throw new Error('transform.bin: "width" must be a positive number');
      } else {
        const wanted = spec.bins === undefined ? 10 : Number(spec.bins);
        if (!isFinite(wanted) || wanted < 1) throw new Error('transform.bin: "bins" must be a number of at least 1');
        step = niceStep(hi - lo, wanted);
      }
      // with an explicit extent the edges start exactly there; otherwise they are rounded outward to multiples of the step
      const explicit = Array.isArray(spec.extent);
      const first = explicit ? lo : Math.floor(lo / step + 1e-9) * step;
      const count = Math.max(1, Math.ceil((hi - first) / step - 1e-9));
      if (count > MAX_BINS) throw new Error(`transform.bin: ${count} bins is too many (at most ${MAX_BINS}); use a larger width`);

      // an explicit extent is a hard limit even when its last bin reaches past it
      const upper = explicit ? hi : first + count * step;

      // series in order of first appearance
      const keys: unknown[] = [];
      const keyIndex = new Map<unknown, number>();
      if (groups) {
        for (let i = 0; i < table.length; i++) {
          if (!keyIndex.has(groups[i])) {
            keyIndex.set(groups[i], keys.length);
            keys.push(groups[i]);
          }
        }
      } else {
        keys.push(undefined);
      }
      const counts = new Float64Array(count * keys.length);
      for (let i = 0; i < table.length; i++) {
        const v = values[i];
        if (typeof v !== 'number' || !isFinite(v) || v < first || v > upper + 1e-9 * step) continue;
        let bin = Math.floor((v - first) / step + 1e-9);
        if (bin >= count) bin = count - 1; // the top edge belongs to the last bin
        if (bin < 0) continue;
        counts[bin * keys.length + (groups ? (keyIndex.get(groups[i]) as number) : 0)]++;
      }

      const rows = count * keys.length;
      const c0 = new Float64Array(rows);
      const c1 = new Float64Array(rows);
      const cn = new Float64Array(rows);
      const cg: unknown[] = new Array(groups ? rows : 0);
      for (let b = 0; b < count; b++) {
        for (let k = 0; k < keys.length; k++) {
          const r = b * keys.length + k;
          // multiplication (not accumulation) keeps 0.1-wide edges from drifting
          c0[r] = +(first + b * step).toPrecision(12);
          c1[r] = +(first + (b + 1) * step).toPrecision(12);
          cn[r] = counts[r];
          if (groups) cg[r] = keys[k];
        }
      }
      const columns: Record<string, BC.Column> = { [as0]: c0, [as1]: c1, [asN]: cn };
      if (groupField) columns[groupField] = cg;
      return { length: rows, columns };
    },
  };

  BC.define(def);
})();
