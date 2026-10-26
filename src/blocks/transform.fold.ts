(function () {
  function fail(message: string): never {
    throw new Error('transform.fold: ' + message);
  }

  /** A typed numeric column (Float64Array, or another typed array from binary data). */
  const typed = (c: unknown) => ArrayBuffer.isView(c);

  function namesOf(spec: BC.TransformSpec): { key: string; value: string } {
    for (const p of ['key', 'value']) {
      if (spec[p] !== undefined && (typeof spec[p] !== 'string' || !spec[p])) fail(`"${p}" must be a column name`);
    }
    const key = (spec.key as string | undefined) || 'key';
    const value = (spec.value as string | undefined) || 'value';
    if (key === value) fail(`"key" and "value" are both "${key}": give them different names`);
    return { key, value };
  }

  const def: BC.TransformDef = {
    role: 'transform',
    type: 'fold',
    version: 1,
    doc: 'Turns a wide table (one column per series: month, online, retail) into a long one (month, key, value): every row becomes one row per field of `fields`, with the field\'s name in `key` and its value in `value`, so the series can be colored, stacked or grouped by `key`. The other columns are repeated on each new row; the folded columns stay too. Rows keep their order, and the fields theirs within each row.',
    params: {
      fields: { kind: 'list', required: true, doc: 'Columns to fold into rows, in the order of the series.' },
      key: { kind: 'string', default: 'key', doc: 'Name of the new column with the folded field\'s name.' },
      value: { kind: 'string', default: 'value', doc: 'Name of the new column with its value.' },
    },
    outputs: (spec) => {
      const { key, value } = namesOf(spec);
      return [key, value];
    },
    apply(table, spec) {
      const fields = spec.fields;
      if (!Array.isArray(fields) || !fields.length) fail('"fields" must be a list of the columns to fold');
      const { key, value } = namesOf(spec);
      const seen: Record<string, true> = {};
      for (const f of fields) {
        if (typeof f !== 'string' || !f) fail('"fields" must be a list of column names');
        if (!Object.prototype.hasOwnProperty.call(table.columns, f)) fail(`unknown field "${f}"`);
        if (seen[f]) fail(`"${f}" is listed twice in "fields"`);
        seen[f] = true;
      }
      for (const name of [key, value]) {
        if (Object.prototype.hasOwnProperty.call(table.columns, name)) fail(`"${name}" is already a column: name the new one differently`);
      }

      const k = fields.length;
      const n = table.length * k;
      const sources = (fields as string[]).map((f) => table.columns[f]);
      // numbers stay a typed column when every folded column is one
      const numeric = sources.every(typed);
      const values: { [i: number]: unknown } = numeric ? new Float64Array(n) : new Array(n);
      const keys = new Array<string>(n);
      for (let i = 0, r = 0; i < table.length; i++) {
        for (let j = 0; j < k; j++, r++) {
          keys[r] = fields[j];
          values[r] = sources[j][i];
        }
      }

      const columns: Record<string, BC.Column> = {};
      for (const name of Object.keys(table.columns)) {
        const col = table.columns[name];
        const out: { [i: number]: unknown } = typed(col) ? new Float64Array(n) : new Array(n);
        for (let i = 0, r = 0; i < table.length; i++) {
          const v = col[i];
          for (let j = 0; j < k; j++, r++) out[r] = v;
        }
        columns[name] = out as BC.Column;
      }
      columns[key] = keys;
      columns[value] = values as BC.Column;
      return { length: n, columns };
    },
  };

  BC.define(def);
})();
