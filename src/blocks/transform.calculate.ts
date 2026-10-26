(function () {
  const OPS = ['+', '-', '*', '/'];

  function fail(message: string): never {
    throw new Error('transform.calculate: ' + message);
  }

  function nameOf(spec: BC.TransformSpec): string {
    if (typeof spec.as !== 'string' || !spec.as) fail('"as" must name the new column');
    return spec.as;
  }

  const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : NaN);

  const def: BC.TransformDef = {
    role: 'transform',
    type: 'calculate',
    version: 1,
    doc: 'A new column `as` from two numbers of each row: field `a` and field `b` (or a constant `value`), joined by `op` (+, -, *, /). A margin is profit / revenue; a gap is actual - plan; a price with tax is net * 1.2. A row where either side is not a number, or the division is by zero, gets NaN (drawn as missing). Rows and the other columns stay as they are; the new column can be used by any transform after it. `as` may be `a` or `b` itself to replace that column (revenue / 1000 in thousands); any other existing column is an error.',
    params: {
      a: { kind: 'field', required: true, doc: 'Numeric field on the left.' },
      op: { kind: 'enum', values: OPS, required: true, doc: '+ | - | * | /.' },
      b: { kind: 'field', doc: 'Numeric field on the right; or give `value`.' },
      value: { kind: 'number', doc: 'A constant on the right instead of a field.' },
      as: { kind: 'string', required: true, doc: 'Name of the new column.' },
    },
    outputs: (spec) => [nameOf(spec)],
    apply(table, spec) {
      const as = nameOf(spec);
      const has = (f: unknown) => typeof f === 'string' && Object.prototype.hasOwnProperty.call(table.columns, f);
      if (typeof spec.a !== 'string' || !spec.a) fail('"a" must be the name of a numeric field');
      if (!has(spec.a)) fail(`unknown field "${spec.a}"`);
      if (typeof spec.op !== 'string' || OPS.indexOf(spec.op) < 0) fail(`"op" must be one of: ${OPS.join(' ')}`);
      if ((spec.b === undefined) === (spec.value === undefined)) fail('give either "b" (a field) or "value" (a number), not both or neither');
      if (spec.b !== undefined && !has(spec.b)) fail(`unknown field "${spec.b}"`);
      if (spec.value !== undefined && !(typeof spec.value === 'number' && isFinite(spec.value))) fail('"value" must be a finite number');
      if (has(as) && as !== spec.a && as !== spec.b) fail(`"${as}" is already a column: name the new one differently`);

      const left = table.columns[spec.a];
      const right = spec.b !== undefined ? table.columns[spec.b as string] : undefined;
      const constant = spec.value as number;
      const op = spec.op;
      const out = new Float64Array(table.length);
      for (let i = 0; i < table.length; i++) {
        const x = num(left[i]);
        const y = right ? num(right[i]) : constant;
        const r = op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : x / y;
        // a division by zero (Infinity, or NaN for 0 / 0) and an overflow are missing, like a side that is not a number
        out[i] = isFinite(r) ? r : NaN;
      }
      return { length: table.length, columns: { ...table.columns, [as]: out } };
    },
  };

  BC.define(def);
})();
