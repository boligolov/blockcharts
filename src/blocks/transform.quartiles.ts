(function () {
  /** Linear-interpolation quantile (the common "R-7" method: matches Excel's QUARTILE.INC / numpy's default). */
  function quantile(sorted: number[], p: number): number {
    const m = sorted.length;
    if (m === 1) return sorted[0];
    const idx = p * (m - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  const OUT_COLS = ['low', 'q1', 'median', 'q3', 'high', 'value', 'count'];

  const def: BC.TransformDef = {
    role: 'transform',
    type: 'quartiles',
    version: 1,
    replacesColumns: true,
    doc: 'The five-number summary of `field` (min/max here mean the Tukey whiskers, not the raw extremes): one row of low/q1/median/q3/high/count per distinct value of `group` (default: one row for the whole dataset). With `outliers` (default true), a sample further than 1.5x the IQR from the box is left out of the whiskers and reported as its own row instead, with `value` set and the summary fields NaN — draw the box from a rect (q1 to q3) or mark.boxplot, and the outliers from a plain mark.point reading `value`, both keyed on the same `group` field; the two kinds of row tell themselves apart by which fields are NaN, the same way a hidden category already tells a mark not to draw a row.',
    params: {
      field: { kind: 'field', required: true, doc: 'Numeric field to summarize (the raw sample values). Missing and non-numeric values are ignored.' },
      group: { kind: 'field', doc: 'A separate summary per value of this field (the boxplot\'s category axis). A missing value is a group of its own, like transform.aggregate. Default: one summary.' },
      outliers: { kind: 'boolean', default: true, doc: 'true: whiskers stop at 1.5x IQR, points further out become their own "value" row. false: whiskers stretch to the true min/max, no outlier rows.' },
    },
    outputs(spec) {
      const group = typeof spec.group === 'string' ? spec.group : undefined;
      return group ? [group, ...OUT_COLS] : OUT_COLS.slice();
    },
    apply(table, spec) {
      const field = spec.field as string;
      const values = table.columns[field];
      if (!values) throw new Error(`transform.quartiles: unknown field "${field}"`);
      const groupField = typeof spec.group === 'string' ? spec.group : undefined;
      const groupCol = groupField ? table.columns[groupField] : undefined;
      if (groupField && !groupCol) throw new Error(`transform.quartiles: unknown field "${groupField}"`);
      const useOutliers = spec.outliers !== false;

      // samples per group, in first-appearance order of the group (a missing group value is its own group)
      const keys: unknown[] = [];
      const keyIndex = new Map<unknown, number>();
      const buckets: number[][] = [];
      let any = false;
      let notNumbers = false;
      for (let i = 0; i < table.length; i++) {
        const key = groupCol ? groupCol[i] : undefined;
        let gi = keyIndex.get(key);
        if (gi === undefined) {
          gi = keys.length;
          keyIndex.set(key, gi);
          keys.push(key);
          buckets.push([]);
        }
        const v = values[i];
        if (typeof v === 'number' && isFinite(v)) {
          buckets[gi].push(v);
          any = true;
        } else if (v != null) {
          notNumbers = true;
        }
      }
      const empty = (): BC.Table => {
        const columns: Record<string, BC.Column> = {
          low: new Float64Array(0), q1: new Float64Array(0), median: new Float64Array(0),
          q3: new Float64Array(0), high: new Float64Array(0), value: new Float64Array(0), count: new Float64Array(0),
        };
        if (groupField) columns[groupField] = [];
        return { length: 0, columns };
      };
      if (!any) {
        if (notNumbers) throw new Error(`transform.quartiles: field "${field}" has no numeric values`);
        return empty();
      }

      const outGroup: unknown[] = [];
      const outLow: number[] = [];
      const outQ1: number[] = [];
      const outMedian: number[] = [];
      const outQ3: number[] = [];
      const outHigh: number[] = [];
      const outValue: number[] = [];
      const outCount: number[] = [];
      const pushRow = (key: unknown, low: number, q1: number, median: number, q3: number, high: number, value: number, count: number) => {
        outGroup.push(key);
        outLow.push(low);
        outQ1.push(q1);
        outMedian.push(median);
        outQ3.push(q3);
        outHigh.push(high);
        outValue.push(value);
        outCount.push(count);
      };

      for (let gi = 0; gi < keys.length; gi++) {
        const samples = buckets[gi].slice().sort((a, b) => a - b);
        if (!samples.length) continue; // this group's field was always missing or non-numeric
        const q1 = quantile(samples, 0.25);
        const median = quantile(samples, 0.5);
        const q3 = quantile(samples, 0.75);
        let low = samples[0];
        let high = samples[samples.length - 1];
        const outliers: number[] = [];
        if (useOutliers) {
          const iqr = q3 - q1;
          const lowFence = q1 - 1.5 * iqr;
          const highFence = q3 + 1.5 * iqr;
          low = Infinity;
          high = -Infinity;
          for (const v of samples) {
            if (v < lowFence || v > highFence) outliers.push(v);
            else {
              if (v < low) low = v;
              if (v > high) high = v;
            }
          }
          // every sample fell outside the fence (a tight, spread-out group): the box has no whisker of its own
          if (low === Infinity) {
            low = q1;
            high = q3;
          }
        }
        pushRow(keys[gi], low, q1, median, q3, high, NaN, samples.length);
        for (const v of outliers) pushRow(keys[gi], NaN, NaN, NaN, NaN, NaN, v, samples.length);
      }

      const columns: Record<string, BC.Column> = {
        low: Float64Array.from(outLow), q1: Float64Array.from(outQ1), median: Float64Array.from(outMedian),
        q3: Float64Array.from(outQ3), high: Float64Array.from(outHigh), value: Float64Array.from(outValue),
        count: Float64Array.from(outCount),
      };
      if (groupField) columns[groupField] = outGroup;
      return { length: outLow.length, columns };
    },
  };

  BC.define(def);
})();
