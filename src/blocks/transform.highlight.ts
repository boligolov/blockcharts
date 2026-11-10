(function () {
  const PICKS = ['max', 'min', 'first', 'last'];

  function fail(message: string): never {
    throw new Error('transform.highlight: ' + message);
  }

  const nameOf = (spec: BC.TransformSpec) => (typeof spec.as === 'string' && spec.as ? spec.as : 'highlight');
  const textOf = (v: unknown, fallback: string) => (typeof v === 'string' && v ? v : fallback);

  const def: BC.TransformDef = {
    role: 'transform',
    type: 'highlight',
    version: 2,
    doc: 'Marks the rows to set apart in a new column `as`: "yes" there and "no" elsewhere (or your own words, `yes` and `no`). Choose them by `pick` (the max or min of `field`, its first or last usable row; ties are all marked) or by `value` (the rows of `field` equal to it). Give the column to a color channel with a scale of two colors, and the best month stands out from the bars around it.',
    params: {
      field: { kind: 'field', required: true, doc: 'The field the rows are chosen by.' },
      pick: {
        kind: 'enum',
        values: PICKS,
        doc: 'Which rows: the largest or smallest number, the first or last row that has one. Or give `value`.',
      },
      value: { kind: 'any', doc: 'The rows of `field` equal to this, text or a number, instead of `pick`.' },
      as: { kind: 'string', default: 'highlight', doc: 'Name of the new column.' },
      yes: { kind: 'string', default: 'yes', doc: 'What a marked row holds; it is what a legend would show.' },
      no: { kind: 'string', default: 'no', doc: 'What the other rows hold.' },
    },
    outputs: (spec) => [nameOf(spec)],
    apply(table, spec) {
      const as = nameOf(spec);
      const has = (f: unknown) => typeof f === 'string' && Object.prototype.hasOwnProperty.call(table.columns, f);
      if (typeof spec.field !== 'string' || !spec.field) fail('"field" must be the name of a field');
      if (!has(spec.field)) fail(`unknown field "${spec.field}" in "field"`);
      if ((spec.pick === undefined) === (spec.value === undefined)) fail('give either "pick" or "value", not both or neither');
      if (spec.pick !== undefined && PICKS.indexOf(spec.pick as string) < 0) fail(`"pick" must be one of: ${PICKS.join(' ')}`);
      if (has(as)) fail(`"${as}" is already a column: name the new one with "as"`);

      const col = table.columns[spec.field];
      const usable = (i: number) => typeof col[i] === 'number' && isFinite(col[i] as number);
      let chosen: (i: number) => boolean;
      if (spec.pick === undefined) {
        chosen = (i) => col[i] === spec.value;
      } else {
        let best = NaN;
        let first = -1;
        let last = -1;
        for (let i = 0; i < table.length; i++) {
          if (!usable(i)) continue;
          const v = col[i] as number;
          if (first < 0) first = i;
          last = i;
          if (!(best === best) || (spec.pick === 'max' ? v > best : v < best)) best = v;
        }
        chosen =
          spec.pick === 'first' ? (i) => i === first : spec.pick === 'last' ? (i) => i === last : (i) => usable(i) && col[i] === best;
      }
      const yes = textOf(spec.yes, 'yes');
      const no = textOf(spec.no, 'no');
      const out = new Array<string>(table.length);
      for (let i = 0; i < table.length; i++) out[i] = chosen(i) ? yes : no;
      return { length: table.length, columns: { ...table.columns, [as]: out } };
    },
  };

  BC.define(def);
})();
