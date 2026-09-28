(function () {
  function names(spec: BC.TransformSpec): { from: string; to: string; rate: string; step: string } {
    const field = String(spec.field);
    const as = Array.isArray(spec.as) ? spec.as : [];
    return {
      from: typeof as[0] === 'string' ? as[0] : field + '0',
      to: typeof as[1] === 'string' ? as[1] : field + '1',
      rate: typeof spec.rateAs === 'string' ? spec.rateAs : 'rate',
      step: typeof spec.stepAs === 'string' ? spec.stepAs : 'stepRate',
    };
  }

  const def: BC.TransformDef = {
    role: 'transform',
    type: 'funnel',
    version: 1,
    doc: 'A conversion funnel: stages in row order (visits, sign-ups, trials, purchases), each drawn as a bar centered on zero so the shape narrows. Writes the bar\'s two ends (`<field>0` = -value/2, `<field>1` = +value/2), the share of the first stage (`rate`) and of the stage before (`stepRate`). Draw with mark.rect (x = `<field>0`, x2 = `<field>1`, y = the stage on a band scale) and label with mark.text formatted as percent.',
    params: {
      field: { kind: 'field', required: true, doc: 'How many reached the stage.' },
      as: { kind: 'list', doc: 'Names of the two end columns. Default [<field>0, <field>1].' },
      rateAs: { kind: 'string', default: 'rate', doc: 'Name of the column with the share of the first stage (0..1).' },
      stepAs: { kind: 'string', default: 'stepRate', doc: 'Name of the column with the share of the previous stage (0..1; the first stage has none).' },
    },
    outputs(spec) {
      const n = names(spec);
      return [n.from, n.to, n.rate, n.step];
    },
    apply(table, spec) {
      const n = names(spec);
      const values = table.columns[String(spec.field)] || [];
      const from = new Float64Array(table.length);
      const to = new Float64Array(table.length);
      const rate = new Float64Array(table.length);
      const step = new Float64Array(table.length);
      let first = NaN;
      let previous = NaN;
      for (let i = 0; i < table.length; i++) {
        const v = values[i];
        if (typeof v !== 'number' || !isFinite(v) || v < 0) {
          from[i] = to[i] = rate[i] = step[i] = NaN;
          continue;
        }
        from[i] = -v / 2;
        to[i] = v / 2;
        if (!isFinite(first)) first = v;
        rate[i] = first > 0 ? v / first : NaN;
        step[i] = isFinite(previous) && previous > 0 ? v / previous : NaN;
        previous = v;
      }
      const columns: Record<string, BC.Column> = { ...table.columns };
      columns[n.from] = from;
      columns[n.to] = to;
      columns[n.rate] = rate;
      columns[n.step] = step;
      return { length: table.length, columns };
    },
  };

  BC.define(def);
})();
