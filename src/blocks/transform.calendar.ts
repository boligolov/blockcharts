(function (BC: BC.Runtime) {
  const DAY = 86400000;
  /** 1970-01-01 was a Thursday. */
  const EPOCH_WEEKDAY = 4;

  function fail(message: string): never {
    throw new Error('transform.calendar: ' + message);
  }

  function names(spec: BC.TransformSpec) {
    const as = Array.isArray(spec.as) ? spec.as : [];
    const pick = (k: number, d: string) => (typeof as[k] === 'string' ? (as[k] as string) : d);
    return { week: pick(0, 'week'), weekEnd: pick(1, 'weekEnd'), day: pick(2, 'day') };
  }

  const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

  const def: BC.TransformDef = {
    role: 'transform',
    type: 'calendar',
    version: 3,
    doc: 'The columns of a calendar heatmap, one cell per row: `week` and `weekEnd` (where its week starts and ends, for `x` and `x2` of a rect on a time scale) and `day` (the name of the weekday, for `y` on a band scale). Rows are put in weekday order, so the band scale lists the days in the order of a week; a weekday with no rows gets one empty row, with no `week` to be drawn at, so that it keeps its place on the axis. Rows without a date are left out. A day that occurs twice gives two cells on one spot: aggregate first.',
    params: {
      field: { kind: 'field', reads: 'date', required: true, doc: 'The date of each row.' },
      weekStart: { kind: 'enum', values: ['monday', 'sunday'], default: 'monday', doc: 'The first day of a week.' },
      as: { kind: 'list', doc: 'Names of the three new columns. Default [week, weekEnd, day].' },
    },
    outputs(spec) {
      const n = names(spec);
      return [n.week, n.weekEnd, n.day];
    },
    apply(table, spec) {
      const n = names(spec);
      const has = (f: string) => Object.prototype.hasOwnProperty.call(table.columns, f);
      if (typeof spec.field !== 'string' || !has(spec.field)) fail(`unknown field "${String(spec.field)}" in "field"`);
      if (spec.weekStart !== undefined && spec.weekStart !== 'monday' && spec.weekStart !== 'sunday')
        fail('"weekStart" must be "monday" or "sunday"');
      for (const name of [n.week, n.weekEnd, n.day])
        if (has(name)) fail(`"${name}" is already a column of the data: give the new one another name with "as"`);
      if (new Set([n.week, n.weekEnd, n.day]).size < 3) fail('"as" must name three different columns');
      const first = spec.weekStart === 'sunday' ? 0 : 1;
      const dates = table.columns[spec.field];
      const writeDay = BC.formatter({ weekday: 'short' }, 'date');

      const rows: { row: number; day: number; into: number }[] = [];
      for (let row = 0; row < table.length; row++) {
        const ms = BC.time(dates[row]);
        if (typeof ms !== 'number' || !isFinite(ms)) continue;
        const day = Math.floor(ms / DAY) * DAY;
        const into = (((day / DAY + EPOCH_WEEKDAY - first) % 7) + 7) % 7;
        rows.push({ row, day, into });
      }
      // the band scale lists what it meets, so a weekday the data never falls on needs a row of its own to stay on the axis
      if (rows.length) {
        for (let into = 0; into < 7; into++)
          if (!rows.some((r) => r.into === into)) rows.push({ row: -1, day: (into + first + 3) * DAY, into });
      }
      rows.sort((a, b) => a.into - b.into || a.day - b.day || a.row - b.row);

      const columns: Record<string, BC.Column> = {};
      for (const name of Object.keys(table.columns)) {
        const from = table.columns[name];
        columns[name] = rows.map((r) => (r.row < 0 ? null : from[r.row])) as BC.Column;
      }
      columns[n.week] = rows.map((r) => (r.row < 0 ? null : isoDay(r.day - r.into * DAY))) as BC.Column;
      columns[n.weekEnd] = rows.map((r) => (r.row < 0 ? null : isoDay(r.day + (7 - r.into) * DAY))) as BC.Column;
      columns[n.day] = rows.map((r) => writeDay(r.day));
      return { length: rows.length, columns };
    },
  };

  BC.define(def);
})((globalThis as any).BC);
