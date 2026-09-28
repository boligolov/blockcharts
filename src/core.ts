(function () {
  const VERSION = '0.1.0';
  const g = globalThis as any;

  if (g.BC) {
    if (g.BC.version !== VERSION) console.warn(`blockcharts core ${VERSION} ignored: ${g.BC.version} is already loaded`);
    return;
  }

  const ROLES: readonly BC.Role[] = ['scale', 'transform', 'mark', 'guide', 'interaction', 'renderer'];
  const SIDES = ['top', 'right', 'bottom', 'left'] as const;
  const DEFAULT_PADDING: BC.Insets = { top: 16, right: 16, bottom: 16, left: 16 };
  const TITLE_HEIGHT = 24;

  const registry = new Map<string, BC.BlockDef>();
  const lake = new Map<string, BC.Table>();
  /** Datasets being decoded, and the reason a decode failed. A dataset is in at most one of lake-with-fresh-data / pending / failed. */
  const pending = new Map<string, Promise<void>>();
  const failed = new Map<string, string>();
  const fns = new Map<string, (...args: any[]) => unknown>();
  /** Decoded size limit: a few KB of gzip can expand to gigabytes, and the page would freeze or crash. */
  const MAX_DECODED_BYTES = 64 * 1024 * 1024;

  // ───────────────────────── registry ─────────────────────────

  function define(def: BC.BlockDef): void {
    if (!def || ROLES.indexOf(def.role) < 0 || typeof def.type !== 'string' || !def.type) {
      throw new Error('BC.define: a block needs a valid role and type');
    }
    const name = `${def.role}.${def.type}`;
    const prev = registry.get(name);
    if (prev) {
      if (prev.version !== def.version) {
        console.warn(`BC.define: ${name} v${def.version} ignored, v${prev.version} is already registered`);
      }
      return;
    }
    registry.set(name, def);
  }

  // ───────────────────────── data lake ─────────────────────────

  function toColumn(values: unknown[] | Float64Array): BC.Column {
    if (values instanceof Float64Array) return values;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (typeof v !== 'number' && v != null) return values;
    }
    const out = new Float64Array(values.length);
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      out[i] = typeof v === 'number' ? v : NaN;
    }
    return out;
  }

  function toTable(input: BC.DatasetInput): BC.Table {
    const columns: Record<string, BC.Column> = {};
    let length = 0;
    if (Array.isArray(input)) {
      const keys: Record<string, true> = {};
      input.forEach((row, i) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`BC.data: row ${i} is not an object`);
        for (const k of Object.keys(row)) keys[k] = true;
      });
      for (const k of Object.keys(keys)) columns[k] = toColumn(input.map((r) => r[k]));
      length = input.length;
    } else if (input && typeof input === 'object' && (input as { columns?: unknown }).columns && typeof (input as { columns?: unknown }).columns === 'object') {
      const source = (input as { columns: Record<string, unknown[] | Float64Array> }).columns;
      const names = Object.keys(source);
      for (const k of names) if (!Array.isArray(source[k]) && !(source[k] instanceof Float64Array)) throw new Error(`BC.data: column "${k}" is not an array`);
      length = names.length ? source[names[0]].length : 0;
      for (const k of names) {
        if (source[k].length !== length) throw new Error(`BC.data: column "${k}" has ${source[k].length} values, expected ${length}`);
        columns[k] = toColumn(source[k]);
      }
    } else {
      throw new Error('BC.data: a dataset is an array of rows or { columns }');
    }
    return { length, columns };
  }

  const isEncoded = (input: unknown): input is BC.EncodedDataset =>
    !!input && typeof input === 'object' && !Array.isArray(input) && typeof (input as { encoding?: unknown }).encoding === 'string';

  function fromBase64(text: string): Uint8Array {
    const clean = text.replace(/\s+/g, '');
    if (clean.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error('the data is not valid base64');
    if (typeof atob !== 'function') throw new Error('this environment has no atob(), cannot decode base64');
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function gunzip(bytes: Uint8Array, limit: number = MAX_DECODED_BYTES): Promise<Uint8Array> {
    const DS = (globalThis as any).DecompressionStream;
    if (typeof DS !== 'function' || typeof Blob !== 'function') {
      throw new Error('this browser cannot decompress gzip data (no DecompressionStream); store the dataset as plain rows or "base64"');
    }
    const reader = (new Blob([bytes as BlobPart]).stream().pipeThrough(new DS('gzip')) as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      let step: ReadableStreamReadResult<Uint8Array>;
      try {
        step = await reader.read();
      } catch (e) {
        // the type of a decompression error differs between browsers; whatever it is, the input is not a whole gzip stream
        throw new Error('the data is not valid gzip');
      }
      const { done, value } = step;
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        throw new Error(`the decoded data is larger than ${MAX_DECODED_BYTES / 1024 / 1024} MB, refusing to unpack it`);
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }

  // Binary columns: { dtype, encoding, data } inside `columns`: the raw little-endian values of a numeric column, base64 (and
  // gzip) encoded. Much smaller than JSON text for long series; always read as Float64 (NaN = missing for float types).
  const DTYPES: Record<string, { size: number; ctor: { new (buffer: ArrayBuffer, offset: number, length: number): ArrayLike<number> }; get: string }> = {
    float32: { size: 4, ctor: Float32Array, get: 'getFloat32' },
    float64: { size: 8, ctor: Float64Array, get: 'getFloat64' },
    int8: { size: 1, ctor: Int8Array, get: 'getInt8' },
    int16: { size: 2, ctor: Int16Array, get: 'getInt16' },
    int32: { size: 4, ctor: Int32Array, get: 'getInt32' },
    uint8: { size: 1, ctor: Uint8Array, get: 'getUint8' },
    uint16: { size: 2, ctor: Uint16Array, get: 'getUint16' },
    uint32: { size: 4, ctor: Uint32Array, get: 'getUint32' },
  };
  const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

  const isBinaryColumn = (v: unknown): v is BC.BinaryColumn =>
    !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Float64Array) && typeof (v as { dtype?: unknown }).dtype === 'string';

  const hasBinaryColumns = (input: unknown): boolean => {
    const cols = input && typeof input === 'object' && !Array.isArray(input) ? (input as { columns?: unknown }).columns : undefined;
    return !!cols && typeof cols === 'object' && Object.keys(cols).some((k) => isBinaryColumn((cols as Record<string, unknown>)[k]));
  };

  async function decodeBinaryColumn(name: string, col: BC.BinaryColumn, budget: { left: number }): Promise<Float64Array> {
    const t = DTYPES[col.dtype];
    if (!t) throw new Error(`column "${name}": unknown dtype "${col.dtype}" (use ${Object.keys(DTYPES).join(', ')})`);
    if (col.encoding !== 'base64' && col.encoding !== 'gzip+base64') throw new Error(`column "${name}": unknown encoding "${col.encoding}" (use "base64" or "gzip+base64")`);
    if (typeof col.data !== 'string') throw new Error(`column "${name}": a binary column needs a "data" string`);
    let bytes: Uint8Array;
    try {
      bytes = fromBase64(col.data);
      if (col.encoding === 'gzip+base64') bytes = await gunzip(bytes, budget.left);
    } catch (e) {
      throw new Error(`column "${name}": ${e instanceof Error ? e.message : String(e)}`);
    }
    if (bytes.length % t.size !== 0) throw new Error(`column "${name}": ${bytes.length} bytes is not a whole number of ${col.dtype} values`);
    const n = bytes.length / t.size;
    budget.left -= n * 8;
    if (budget.left < 0) throw new Error(`the decoded columns are larger than ${MAX_DECODED_BYTES / 1024 / 1024} MB, refusing to unpack them`);
    const out = new Float64Array(n);
    if (LITTLE_ENDIAN) {
      // a view needs an aligned buffer; the bytes may sit anywhere inside a larger one
      const aligned = bytes.byteOffset % t.size === 0 ? bytes.buffer as ArrayBuffer : (bytes.slice().buffer as ArrayBuffer);
      const offset = bytes.byteOffset % t.size === 0 ? bytes.byteOffset : 0;
      out.set(new t.ctor(aligned, offset, n));
    } else {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      for (let i = 0; i < n; i++) out[i] = (view as any)[t.get](i * t.size, true);
    }
    return out;
  }

  /** Replaces the binary columns of a { columns } dataset with Float64Arrays. */
  async function withBinaryColumns(json: unknown): Promise<unknown> {
    if (!hasBinaryColumns(json)) return json;
    const source = (json as { columns: Record<string, unknown> }).columns;
    const budget = { left: MAX_DECODED_BYTES };
    const columns: Record<string, unknown> = {};
    for (const k of Object.keys(source)) columns[k] = isBinaryColumn(source[k]) ? await decodeBinaryColumn(k, source[k] as BC.BinaryColumn, budget) : source[k];
    return { columns };
  }

  async function decodeDataset(input: BC.EncodedDataset | { columns: Record<string, unknown> }): Promise<BC.Table> {
    if (!isEncoded(input)) return toTable((await withBinaryColumns(input)) as BC.DatasetInput);
    if (typeof input.data !== 'string') throw new Error('an encoded dataset needs a "data" string');
    if (input.encoding !== 'base64' && input.encoding !== 'gzip+base64') {
      throw new Error(`unknown encoding "${input.encoding}" (use "base64" or "gzip+base64")`);
    }
    let bytes = fromBase64(input.data);
    if (input.encoding === 'gzip+base64') bytes = await gunzip(bytes);
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch (e) {
      throw new Error('the decoded data is not UTF-8 JSON: ' + (e instanceof Error ? e.message : String(e)));
    }
    if (isEncoded(json)) throw new Error('an encoded dataset cannot contain another encoded dataset');
    return toTable((await withBinaryColumns(json)) as BC.DatasetInput);
  }

  function data(name: string, input: BC.DatasetInput): void {
    if (isEncoded(input) || hasBinaryColumns(input)) {
      failed.delete(name);
      // a later data() call for the same name wins even if this decode finishes after it
      const job: Promise<void> = decodeDataset(input as BC.EncodedDataset).then(
        (table) => {
          if (pending.get(name) !== job) return;
          lake.set(name, table);
        },
        (e) => {
          if (pending.get(name) !== job) return;
          const reason = e instanceof Error ? e.message : String(e);
          failed.set(name, reason);
          console.error(`[blockcharts] dataset "${name}": ${reason}`);
        },
      ).then(() => {
        if (pending.get(name) === job) pending.delete(name);
      });
      pending.set(name, job);
      return;
    }
    const table = toTable(input);
    pending.delete(name);
    failed.delete(name);
    lake.set(name, table);
  }

  function ready(): Promise<void> {
    return Promise.all(Array.from(pending.values())).then(() => undefined);
  }

  // ───────────────────────── spec helpers ─────────────────────────

  interface ChannelRef { field?: string; scale?: string; value?: unknown }

  /** null = absent, undefined = malformed. */
  function channelRef(mark: BC.MarkSpec, name: string, cdef?: BC.ChannelDef): ChannelRef | null | undefined {
    const v = mark[name];
    if (v === undefined) return cdef && cdef.default !== undefined ? { value: cdef.default } : null;
    const dflt = cdef && cdef.unscaled ? undefined : (cdef && cdef.sharesScale) || name;
    if (typeof v === 'string') return { field: v, scale: dflt };
    if (v && typeof v === 'object') {
      const o = v as { field?: unknown; scale?: unknown; value?: unknown };
      if (typeof o.field === 'string') return { field: o.field, scale: typeof o.scale === 'string' ? o.scale : dflt };
      if (o.value !== undefined) return { value: o.value };
    }
    return undefined;
  }

  function rangeSetting(name: string, s: BC.ScaleSpec): 'width' | 'height' | unknown[] | undefined {
    return s.range !== undefined ? s.range : name === 'x' ? 'width' : name === 'y' ? 'height' : undefined;
  }

  function resolveRange(name: string, s: BC.ScaleSpec, plot: BC.Rect): unknown[] {
    const r = rangeSetting(name, s);
    if (r === 'width') return [plot.x, plot.x + plot.w];
    if (r === 'height') return [plot.y + plot.h, plot.y];
    return Array.isArray(r) ? r : [];
  }

  function needs(spec: BC.ChartSpec): BC.BlockName[] {
    const out: BC.BlockName[] = [];
    const add = (role: BC.Role, s: unknown) => {
      const t = s && (s as BC.BlockSpec).type;
      if (typeof t === 'string') {
        const n = `${role}.${t}` as BC.BlockName;
        if (out.indexOf(n) < 0) out.push(n);
      }
    };
    if (!spec) return out;
    if (Array.isArray(spec.transforms)) spec.transforms.forEach((s) => add('transform', s));
    if (spec.scales) for (const k of Object.keys(spec.scales)) add('scale', spec.scales[k]);
    if (Array.isArray(spec.marks)) spec.marks.forEach((s) => add('mark', s));
    if (Array.isArray(spec.guides)) spec.guides.forEach((s) => add('guide', s));
    if (Array.isArray(spec.interaction)) spec.interaction.forEach((s) => add('interaction', s));
    add('renderer', { type: spec.renderer || 'svg' });
    return out;
  }

  // ───────────────────────── validation ─────────────────────────

  function validate(spec: BC.ChartSpec): BC.Diagnostic[] {
    const out: BC.Diagnostic[] = [];
    const err = (path: string, message: string) => out.push({ level: 'error', path, message });
    const warn = (path: string, message: string) => out.push({ level: 'warn', path, message });
    if (!spec || typeof spec !== 'object') {
      err('', 'the spec must be an object');
      return out;
    }

    const table = typeof spec.data === 'string' && !pending.has(spec.data) ? lake.get(spec.data) : undefined;
    if (typeof spec.data !== 'string') err('data', 'data must be the name of a dataset');
    else if (pending.has(spec.data)) err('data', `dataset "${spec.data}" is still being decoded (await BC.ready())`);
    else if (failed.has(spec.data)) err('data', `dataset "${spec.data}" could not be loaded: ${failed.get(spec.data)}`);
    else if (!table) err('data', `dataset "${spec.data}" is not in the data lake`);
    // Transforms add columns. Each declares them through `outputs`; one that does not makes the field list
    // unknowable before it runs, and field checks are skipped rather than guessed.
    // `stages[i]` = the columns that exist before transform i, and the last one after all of them; undefined = unknown.
    const stages: (Record<string, unknown> | undefined)[] = [table ? { ...table.columns } : undefined];
    if (Array.isArray(spec.transforms)) {
      for (const ts of spec.transforms) {
        let next: Record<string, unknown> | undefined = stages[stages.length - 1];
        const tdef = ts && typeof ts.type === 'string' ? registry.get(`transform.${ts.type}`) : undefined;
        if (next) {
          if (tdef && tdef.role === 'transform' && tdef.outputs) {
            try {
              const added = tdef.outputs(ts);
              next = tdef.replacesColumns ? {} : { ...next };
              for (const name of added) next[name] = true;
            } catch (e) {
              next = undefined;
            }
          } else {
            next = undefined;
          }
        }
        stages.push(next);
      }
    }
    const knownColumns = stages[stages.length - 1];
    const checkFieldIn = (known: Record<string, unknown> | undefined, path: string, field: string) => {
      if (known && !Object.prototype.hasOwnProperty.call(known, field)) err(path, `unknown field "${field}" in dataset "${spec.data}"`);
    };
    const checkField = (path: string, field: string) => checkFieldIn(knownColumns, path, field);
    const scales = spec.scales || {};

    if (spec.size !== undefined && !(Array.isArray(spec.size) && spec.size.length === 2 && spec.size[0] > 0 && spec.size[1] > 0)) {
      err('size', 'size must be [width, height] with positive numbers');
    }

    const firstPath = new Map<string, string>();
    const blockOf = (role: BC.Role, s: unknown, path: string): BC.BlockDef | undefined => {
      const t = s && (s as BC.BlockSpec).type;
      if (typeof t !== 'string' || !t) {
        err(`${path}.type`, `${role} needs a "type"`);
        return undefined;
      }
      const name = `${role}.${t}`;
      if (!firstPath.has(name)) firstPath.set(name, path);
      const def = registry.get(name);
      if (!def) err(`${path}.type`, `block "${name}" is not loaded`);
      return def;
    };

    const checkParams = (path: string, s: BC.BlockSpec, def: BC.BlockDef, common: string[], fieldCheck: (path: string, field: string) => void = checkField) => {
      const name = `${def.role}.${def.type}`;
      const params = def.params || {};
      const channels = def.role === 'mark' ? def.channels : {};
      for (const key of Object.keys(s)) {
        if (key === 'type' || common.indexOf(key) >= 0 || Object.prototype.hasOwnProperty.call(channels, key)) continue;
        const p = params[key];
        if (!p) {
          warn(`${path}.${key}`, `unknown parameter "${key}" for ${name}`);
          continue;
        }
        const v = s[key];
        const bad = (want: string) => err(`${path}.${key}`, `${key} of ${name} must be ${want}`);
        switch (p.kind) {
          case 'string': if (typeof v !== 'string') bad('a string'); break;
          case 'number': if (typeof v !== 'number') bad('a number'); break;
          case 'boolean': if (typeof v !== 'boolean') bad('a boolean'); break;
          case 'list': if (!Array.isArray(v)) bad('a list'); break;
          case 'enum': if (typeof v !== 'string' || !p.values || p.values.indexOf(v) < 0) bad(`one of: ${(p.values || []).join(', ')}`); break;
          case 'field': if (typeof v !== 'string') bad('a field name'); else fieldCheck(`${path}.${key}`, v); break;
          case 'scale': if (typeof v !== 'string' || !scales[v]) bad('the name of a declared scale'); break;
        }
      }
      for (const key of Object.keys(params)) {
        if (params[key].required && params[key].default === undefined && s[key] === undefined) err(`${path}.${key}`, `${name} requires "${key}"`);
      }
    };

    // a chart draws something: a mark, or at least a guide (a KPI tile is a guide alone)
    const hasGuides = Array.isArray(spec.guides) && spec.guides.length > 0;
    if (!Array.isArray(spec.marks)) err('marks', 'marks must be a list (an empty one is fine when the chart has a guide, such as a KPI)');
    else if (!spec.marks.length && !hasGuides) err('marks', 'at least one mark is required (or a guide, such as a KPI)');

    if (spec.view !== undefined) {
      if (!spec.view || typeof spec.view !== 'object') err('view', 'view must map scale names to domains');
      else {
        for (const name of Object.keys(spec.view)) {
          if (!scales[name]) err(`view.${name}`, `scale "${name}" is not declared in scales`);
          else if (!Array.isArray(spec.view[name])) err(`view.${name}`, 'a view is a list (the visible domain)');
        }
      }
    }

    if (Array.isArray(spec.transforms)) {
      spec.transforms.forEach((s, i) => {
        const def = blockOf('transform', s, `transforms[${i}]`);
        // a transform reads the columns that exist before it, not the ones that exist at the end
        if (def) checkParams(`transforms[${i}]`, s, def, [], (p, field) => checkFieldIn(stages[i], p, field));
      });
    }

    for (const name of Object.keys(scales)) {
      const s = scales[name];
      const path = `scales.${name}`;
      const def = blockOf('scale', s, path);
      if (!def) continue;
      checkParams(path, s, def, ['field', 'domain', 'range']);
      if (typeof s.field === 'string') checkField(`${path}.field`, s.field);
      if (s.range !== undefined && s.range !== 'width' && s.range !== 'height' && !Array.isArray(s.range)) {
        err(`${path}.range`, 'range must be "width", "height" or a list');
      }
    }

    if (Array.isArray(spec.marks)) {
      spec.marks.forEach((m, i) => {
        const path = `marks[${i}]`;
        const def = blockOf('mark', m, path);
        if (!def || def.role !== 'mark') return;
        const name = `mark.${def.type}`;
        checkParams(path, m, def, []);
        for (const ch of Object.keys(def.channels)) {
          const cdef = def.channels[ch];
          const ref = channelRef(m, ch, cdef);
          if (ref === null) {
            if (cdef.required) err(`${path}.${ch}`, `${name} requires channel "${ch}"`);
            continue;
          }
          if (ref === undefined) {
            err(`${path}.${ch}`, `channel "${ch}" must be a field name, { field, scale } or { value }`);
            continue;
          }
          if (ref.field !== undefined) checkField(`${path}.${ch}`, ref.field);
          if (cdef.unscaled) {
            if (ref.scale !== undefined) err(`${path}.${ch}`, `channel "${ch}" of ${name} is read as it is and does not use a scale`);
          } else if (ref.scale !== undefined) {
            const sdef = scales[ref.scale];
            if (!sdef) err(`${path}.${ch}`, `scale "${ref.scale}" is not declared in scales`);
            else if (cdef.scales && cdef.scales.indexOf(sdef.type) < 0) {
              err(`${path}.${ch}`, `channel "${ch}" of ${name} does not accept a "${sdef.type}" scale (accepts: ${cdef.scales.join(', ')})`);
            }
          }
        }
      });
    }

    if (Array.isArray(spec.guides)) {
      spec.guides.forEach((s, i) => {
        const path = `guides[${i}]`;
        const def = blockOf('guide', s, path);
        if (!def) return;
        checkParams(path, s, def, ['scale', 'position']);
        if (s.scale !== undefined && (typeof s.scale !== 'string' || !scales[s.scale])) err(`${path}.scale`, `scale "${String(s.scale)}" is not declared in scales`);
        if (s.position !== undefined && SIDES.indexOf(s.position) < 0) err(`${path}.position`, `position must be one of: ${SIDES.join(', ')}`);
      });
    }

    if (Array.isArray(spec.interaction)) {
      spec.interaction.forEach((s, i) => {
        const def = blockOf('interaction', s, `interaction[${i}]`);
        if (def) checkParams(`interaction[${i}]`, s, def, []);
      });
    }
    blockOf('renderer', { type: spec.renderer || 'svg' }, 'renderer');

    // Declared dependencies of everything loaded (transitively).
    const visited = new Set<string>();
    const walk = (name: string, path: string) => {
      if (visited.has(name)) return;
      visited.add(name);
      const def = registry.get(name);
      if (!def || !def.requires) return;
      for (const req of def.requires) {
        if (!registry.has(req)) err(path, `${name} requires ${req}, which is not loaded`);
        else walk(req, path);
      }
    };
    firstPath.forEach((path, name) => walk(name, path));

    return out;
  }

  // ───────────────────────── pipeline ─────────────────────────

  const PALETTE = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7'];

  function colorAt(index: number): string {
    const i = ((index % PALETTE.length) + PALETTE.length) % PALETTE.length;
    return `var(--bc-c${i}, ${PALETTE[i]})`;
  }

  interface Built {
    rendered: BC.Rendered;
    diagnostics: BC.Diagnostic[];
    setView(scale: string, domain: unknown[] | null): void;
    getView(): Record<string, unknown[]>;
    /** Only the scales that are zoomed, as requested. */
    viewState(): Record<string, unknown[]>;
  }

  function measure(text: string, size: number = 11): { w: number; h: number } {
    return { w: text.length * size * 0.6, h: size * 1.2 };
  }

  function insetsPlot(size: { w: number; h: number }, ins: BC.Insets): BC.Rect {
    return { x: ins.left, y: ins.top, w: Math.max(1, size.w - ins.left - ins.right), h: Math.max(1, size.h - ins.top - ins.bottom) };
  }

  function append<T>(dst: T[], src: T[]): void {
    for (let i = 0; i < src.length; i++) dst.push(src[i]);
  }

  function nextFrame(fn: () => void): void {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn());
    else setTimeout(fn, 0);
  }

  /** Stages 1-4 run once (table, transforms, scales, layout — frozen afterwards); `draw` is stages 5-7 and reruns on every view change. */
  function build(host: HTMLElement, spec: BC.ChartSpec, cleanups: (() => void)[], keptView?: Record<string, unknown[]>): Built {
    const diagnostics: BC.Diagnostic[] = [];
    const fail = (path: string, e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      // a failure that repeats at every redraw is reported once
      if (!diagnostics.some((d) => d.path === path && d.message === message)) diagnostics.push({ level: 'error', path, message });
    };
    const warn = (path: string, message: string) => {
      if (!diagnostics.some((d) => d.path === path && d.message === message)) diagnostics.push({ level: 'warn', path, message });
    };
    let disposed = false;
    cleanups.push(() => { disposed = true; });

    // Shared by every interaction that needs `host` to be a positioning context for an absolutely-positioned overlay
    // (a tooltip marker, a drag box, a button bar). More than one may want this at once; a claim/release count is
    // the only way that composes, because whichever released last with a plain "restore what I found" would undo
    // whatever another interaction is still relying on.
    let positionClaims = 0;
    let positionWasStatic = false;
    const claimPosition = (): (() => void) => {
      if (!positionClaims) {
        positionWasStatic = typeof getComputedStyle === 'function' && getComputedStyle(host).position === 'static';
        if (positionWasStatic) host.style.position = 'relative';
      }
      positionClaims++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        positionClaims--;
        if (positionClaims <= 0) {
          positionClaims = 0;
          if (positionWasStatic) host.style.position = '';
        }
      };
    };

    // 1 table + transforms. Transforms before the first view-dependent one run once; that one and the rest run at every
    // redraw (see draw), on the table the static ones produced. Scale domains come from that static table: the full data.
    const transformSpecs = spec.transforms || [];
    const viewDependent = (ts: BC.TransformSpec) => !!(registry.get(`transform.${ts.type}`) as BC.TransformDef).viewDependent;
    const firstDynamic = transformSpecs.findIndex(viewDependent);
    const staticCount = firstDynamic < 0 ? transformSpecs.length : firstDynamic;
    let table = lake.get(spec.data)!;
    transformSpecs.slice(0, staticCount).forEach((ts, i) => {
      const def = registry.get(`transform.${ts.type}`) as BC.TransformDef;
      table = def.apply(table, ts);
      if (!table) throw new Error(`transforms[${i}] returned no table`);
    });
    const baseTable = table;
    const dynamicSpecs = transformSpecs.slice(staticCount);

    // 2 layout, first guess
    const size = { w: spec.size ? spec.size[0] : 640, h: spec.size ? spec.size[1] : 400 };
    const pad = { ...DEFAULT_PADDING, ...(spec.padding || {}) };
    if (spec.title) pad.top += TITLE_HEIGHT;
    let plot = insetsPlot(size, pad);

    // 3 scales: the domain of each is inferred from every channel that names it
    const scaleSpecs = spec.scales || {};
    const scales: Record<string, BC.Scale> = {};
    const channelCache = new Map<BC.MarkSpec, Record<string, BC.ChannelData>>();
    const tickCache = new Map<string, BC.Tick[]>();
    const rowsCache = new Map<BC.MarkSpec, { from: number; to: number }>();
    const markDef = (m: BC.MarkSpec) => registry.get(`mark.${m.type}`) as BC.MarkDef;
    const view: Record<string, unknown[]> = {};
    const applyView = () => {
      for (const name of Object.keys(scales)) {
        scales[name].setDomain(view[name] || null);
        if (view[name]) view[name] = scales[name].domain();
      }
      channelCache.clear();
      tickCache.clear();
      rowsCache.clear();
    };

    for (const name of Object.keys(scaleSpecs)) {
      const s = scaleSpecs[name];
      const sources: BC.Column[] = [];
      for (const m of spec.marks) {
        const def = markDef(m);
        for (const ch of Object.keys(def.channels)) {
          const ref = channelRef(m, ch, def.channels[ch]);
          if (ref && ref.scale === name && ref.field !== undefined) sources.push(table.columns[ref.field]);
        }
      }
      if (typeof s.field === 'string') sources.push(table.columns[s.field]);
      const def = registry.get(`scale.${s.type}`) as BC.ScaleDef;
      scales[name] = def.create(s, { name, sources, range: resolveRange(name, s, plot), color: colorAt });
    }
    const initial = spec.view || {};
    for (const name of Object.keys(initial)) view[name] = initial[name];
    // a zoom carried over from before an update(); a view the new spec sets itself wins
    for (const name of Object.keys(keptView || {})) {
      if (scaleSpecs[name] && !(name in initial)) view[name] = (keptView as Record<string, unknown[]>)[name];
    }
    applyView();

    // Culling. A column that runs in one direction through a scale (sorted data, the usual shape of a time series)
    // lets the rows inside the visible window be found by binary search instead of visiting every row. The direction
    // is worked out once per column and scale, in pixel space, so it holds for numbers, dates and categories alike.
    const CULL_MARGIN = 12; // px kept around the plot: the radius of a dot, half a stroke
    const directions = new WeakMap<BC.Column, { scale: BC.Scale; dir: number }>();
    const directionOf = (col: BC.Column, scale: BC.Scale, n: number): number => {
      const known = directions.get(col);
      if (known && known.scale === scale) return known.dir;
      if (col instanceof Float64Array && scale.invert && n >= 2) {
        // numbers through a continuous scale (linear, time): the mapping is monotone, so the order can be read off the
        // raw values, which is much cheaper than mapping every row; the scale only says which way it points
        let rawUp = true;
        let rawDown = true;
        for (let i = 1; i < n && (rawUp || rawDown); i++) {
          const v = col[i];
          const u = col[i - 1];
          if (v !== v || u !== u) {
            rawUp = false;
            rawDown = false;
          } else {
            if (v < u) rawUp = false;
            if (v > u) rawDown = false;
          }
        }
        let fast = 0;
        if (col[0] !== col[0]) fast = 0;
        else if (col[0] === col[n - 1]) fast = 0;
        else {
          const points = (scale(col[n - 1]) as number) > (scale(col[0]) as number) ? 1 : -1;
          fast = rawUp ? points : rawDown ? -points : 0;
        }
        directions.set(col, { scale, dir: fast });
        return fast;
      }
      let up = true;
      let down = true;
      let prev = 0;
      for (let i = 0; i < n && (up || down); i++) {
        const p = scale(col[i]);
        // a missing or hidden value (NaN) means the order cannot be relied on: no culling
        if (typeof p !== 'number' || p !== p) {
          up = false;
          down = false;
          break;
        }
        if (i > 0) {
          if (p < prev) up = false;
          if (p > prev) down = false;
        }
        prev = p;
      }
      const dir = n < 2 ? 0 : up ? 1 : down ? -1 : 0;
      directions.set(col, { scale, dir });
      return dir;
    };
    /** First index in [0, n) for which `test` holds, given that it is false and then true. */
    const firstWhere = (n: number, test: (i: number) => boolean): number => {
      let lo = 0;
      let hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (test(mid)) hi = mid;
        else lo = mid + 1;
      }
      return lo;
    };
    const visibleRows = (mark: BC.MarkSpec): { from: number; to: number } => {
      const n = table.length;
      let from = 0;
      let to = n;
      if (!Object.keys(view).length) return { from, to };
      const def = markDef(mark);
      for (const ch of Object.keys(def.channels)) {
        const ref = channelRef(mark, ch, def.channels[ch]);
        if (!ref || ref.field === undefined || ref.scale === undefined || !view[ref.scale]) continue;
        const scale = scales[ref.scale];
        const col = table.columns[ref.field];
        const range = scale.range() as unknown[];
        if (!col || typeof range[0] !== 'number' || typeof range[1] !== 'number') continue;
        const dir = directionOf(col, scale, n);
        if (!dir) continue;
        const lo = Math.min(range[0], range[1] as number) - CULL_MARGIN;
        const hi = Math.max(range[0], range[1] as number) + CULL_MARGIN;
        const px = (i: number) => scale(col[i]) as number;
        // the rows inside the window are contiguous: [start, end)
        const start = dir === 1 ? firstWhere(n, (i) => px(i) >= lo) : firstWhere(n, (i) => px(i) <= hi);
        const end = dir === 1 ? firstWhere(n, (i) => px(i) > hi) : firstWhere(n, (i) => px(i) < lo);
        // one row more on each side, so a line still runs to the edge and a window between two rows draws its segment
        from = Math.max(from, start - 1, 0);
        to = Math.min(to, end + 1, n);
      }
      if (to < from) to = from;
      return { from, to };
    };

    const ctx: BC.ChartCtx = {
      spec,
      get table() { return table; },
      size,
      get plot() { return plot; },
      scales,
      measure,
      orientation(name) {
        const r = scaleSpecs[name] && rangeSetting(name, scaleSpecs[name]);
        return r === 'width' ? 'horizontal' : r === 'height' ? 'vertical' : null;
      },
      ticks(name, approxCount) {
        const scale = scales[name];
        if (!scale || !scale.ticks) return [];
        const o = ctx.orientation(name);
        let count = approxCount !== undefined ? approxCount : Math.max(2, Math.round(o === 'vertical' ? plot.h / 40 : o === 'horizontal' ? plot.w / 80 : 6));
        // categories are named, not sampled: show every label that fits (measured), thin them only when they do not
        if (approxCount === undefined && scale.kind === 'band' && o) {
          const labels = scale.domain() as unknown[];
          let widest = 0;
          for (const v of labels) {
            const text = String(v);
            if (o === 'vertical') {
              widest = Math.max(widest, ctx.measure(text, 11).h);
              continue;
            }
            // a horizontal axis wraps a long label onto two lines, so what has to fit is about half of it (or its longest word)
            const full = ctx.measure(text, 11).w;
            const word = text.split(/\s+/).reduce((m, part) => Math.max(m, ctx.measure(part, 11).w), 0);
            widest = Math.max(widest, Math.min(full, Math.max(word, full / 2)));
          }
          // measure() is deliberately generous (layout must never clip), so real labels are narrower than it says: allow for that
          const fit = Math.floor((o === 'horizontal' ? plot.w : plot.h) / (o === 'horizontal' ? widest * 0.9 + 4 : widest + 3));
          count = Math.max(count, Math.min(labels.length, fit));
        }
        const key = `${name}:${count}`;
        let t = tickCache.get(key);
        if (!t) tickCache.set(key, (t = scale.ticks(count)));
        return t;
      },
      rows(mark) {
        let r = rowsCache.get(mark);
        if (!r) rowsCache.set(mark, (r = visibleRows(mark)));
        return r;
      },
      series(mark, xs) {
        const colorCh = mark.color !== undefined ? ctx.channel(mark, 'color') : null;
        const field = typeof mark.group === 'string' ? mark.group : colorCh && colorCh.field;
        const groupCol = field ? table.columns[field] : undefined;
        const { from, to } = ctx.rows(mark);
        const groups = new Map<unknown, number[]>();
        for (let i = from; i < to; i++) {
          const key = groupCol ? groupCol[i] : 0;
          const rows = groups.get(key);
          if (rows) rows.push(i);
          else groups.set(key, [i]);
        }
        const out: { key: unknown; rows: number[] }[] = [];
        groups.forEach((rows, key) => {
          let sorted = true;
          for (let k = 1; k < rows.length; k++) {
            if (xs[rows[k]] < xs[rows[k - 1]]) {
              sorted = false;
              break;
            }
          }
          if (!sorted) rows.sort((a, b) => xs[a] - xs[b]);
          out.push({ key, rows });
        });
        return out;
      },
      color: colorAt,
      channel(mark, name) {
        let byName = channelCache.get(mark);
        if (!byName) channelCache.set(mark, (byName = {}));
        if (byName[name]) return byName[name];

        const cdef = markDef(mark).channels[name];
        const ref = channelRef(mark, name, cdef);
        let result: BC.ChannelData;
        if (!ref) {
          if (cdef && cdef.required) throw new Error(`mark.${mark.type}: channel "${name}" is required`);
          result = { raw: [], mapped: [] };
        } else if (ref.field === undefined) {
          const fill = new Array(table.length);
          for (let i = 0; i < fill.length; i++) fill[i] = ref.value;
          result = { raw: fill, mapped: fill };
        } else {
          const raw = table.columns[ref.field];
          const scale = ref.scale !== undefined ? scales[ref.scale] : undefined;
          if (!scale) {
            result = { field: ref.field, raw, mapped: raw };
          } else {
            const n = table.length;
            const { from, to } = ctx.rows(mark);
            const first = to > from ? scale(raw[from]) : 0;
            // rows outside the visible window are not mapped (NaN); marks read only from..to
            const mapped: ArrayLike<any> = typeof first === 'number' ? new Float64Array(n).fill(NaN) : new Array(n);
            for (let i = from; i < to; i++) (mapped as any)[i] = scale(raw[i]);
            result = { field: ref.field, scale, raw, mapped };
          }
        }
        return (byName[name] = result);
      },
    };

    // 4 layout: guides claim space per side in spec.guides order, and remember what was claimed before them
    const guides = spec.guides || [];
    const claimed: BC.Insets = { top: 0, right: 0, bottom: 0, left: 0 };
    const offsets: BC.Insets[] = [];
    const overhang: BC.Insets = { top: 0, right: 0, bottom: 0, left: 0 };
    guides.forEach((gs, i) => {
      offsets.push({ ...claimed });
      try {
        const def = registry.get(`guide.${gs.type}`) as BC.GuideDef;
        const m = def.measure ? def.measure(gs, ctx) : {};
        for (const side of SIDES) {
          claimed[side] += m[side] || 0;
          if (m.overhang) overhang[side] = Math.max(overhang[side], m.overhang[side] || 0);
        }
      } catch (e) {
        fail(`guides[${i}]`, e);
      }
    });
    // padding and stacked guides first; an overhang only widens a margin that is still too small for it
    const inset = (side: keyof BC.Insets) => Math.max(pad[side] + claimed[side], overhang[side]);
    plot = insetsPlot(size, { top: inset('top'), right: inset('right'), bottom: inset('bottom'), left: inset('left') });
    for (const name of Object.keys(scales)) scales[name].setRange(resolveRange(name, scaleSpecs[name], plot));
    channelCache.clear();
    tickCache.clear();
    rowsCache.clear();

    // 5 + 6: ticks are computed lazily through ctx.ticks; marks and guides emit primitives
    let list!: BC.DisplayList;
    function draw(): void {
      if (dynamicSpecs.length) {
        let t = baseTable;
        dynamicSpecs.forEach((ts, i) => {
          try {
            const next = (registry.get(`transform.${ts.type}`) as BC.TransformDef).apply(t, ts, { plot, scales, warn: (m) => warn(`transforms[${staticCount + i}]`, m) });
            if (!next) throw new Error('returned no table');
            t = next;
          } catch (e) {
            fail(`transforms[${staticCount + i}]`, e);
          }
        });
        table = t;
      }
      channelCache.clear();
      tickCache.clear();
      rowsCache.clear();
      const layers: Record<BC.LayerName, BC.Prim[]> = { grid: [], marks: [], axes: [], overlay: [] };
      spec.marks.forEach((m, i) => {
        try {
          append(layers.marks, markDef(m).render(m, ctx, i));
        } catch (e) {
          fail(`marks[${i}]`, e);
        }
      });
      guides.forEach((gs, i) => {
        try {
          const em = (registry.get(`guide.${gs.type}`) as BC.GuideDef).render(gs, ctx, offsets[i]);
          for (const layer of Object.keys(em) as BC.LayerName[]) append(layers[layer], em[layer] || []);
        } catch (e) {
          fail(`guides[${i}]`, e);
        }
      });
      if (spec.title) {
        layers.axes.push({ type: 'text', x: pad.left, y: TITLE_HEIGHT - 6, text: spec.title, size: 14, weight: 600, style: { fill: 'var(--bc-text, #444)' } });
      }
      // Marks may overhang the plot only while nothing is zoomed; a view needs the clip.
      const zoomed = Object.keys(view).length > 0;
      list = {
        size,
        plot,
        layers: (['grid', 'marks', 'axes', 'overlay'] as BC.LayerName[]).map((name) => ({ name, prims: layers[name], clip: name === 'marks' && zoomed ? { ...plot } : undefined })),
      };
    }

    draw();

    // 7 render
    const renderer = registry.get(`renderer.${spec.renderer || 'svg'}`) as BC.RendererDef;
    const rendered = renderer.render(list, host);

    // view changes: merged per frame; only stages 5-7 rerun
    let pending = false;
    const setView = (name: string, domain: unknown[] | null) => {
      if (!scales[name]) {
        console.warn(`[blockcharts] setView: unknown scale "${name}"`);
        return;
      }
      if (domain) view[name] = domain;
      else delete view[name];
      if (pending) return;
      pending = true;
      nextFrame(() => {
        pending = false;
        if (disposed) return;
        try {
          applyView();
          draw();
          rendered.update(list);
        } catch (e) {
          fail('view', e);
          console.error(e);
        }
      });
    };
    const getView = () => {
      const out: Record<string, unknown[]> = {};
      for (const name of Object.keys(scales)) out[name] = view[name] ? view[name].slice() : scales[name].baseDomain();
      return out;
    };

    const fit = (name: string, follow: string): unknown[] | null => {
      const spec2 = scaleSpecs[name];
      const followSpec = scaleSpecs[follow];
      const requested = view[follow];
      if (!spec2 || !followSpec || !scales[follow] || !requested) return null;
      const range = scales[follow].range() as unknown[];
      const numeric = typeof range[0] === 'number' && typeof range[1] === 'number';
      const lo = numeric ? Math.min(range[0] as number, range[1] as number) : 0;
      const hi = numeric ? Math.max(range[0] as number, range[1] as number) : 0;
      // `follow` as it will look once the requested view is applied. It is rebuilt from the block with the base
      // domain fixed (so categories are known), and a row is visible if the probe puts it inside the plot
      // (positional scales: judged in pixels, so a time scale never parses its own strings here) or gives it a
      // color (color scales: a hidden category has none).
      const probe = (registry.get(`scale.${followSpec.type}`) as BC.ScaleDef).create({ ...followSpec, domain: scales[follow].baseDomain() }, {
        name: follow, sources: [], range: scales[follow].range(), color: colorAt,
      });
      probe.setDomain(requested);
      const isVisible = (v: unknown): boolean => {
        const p = probe(v);
        return typeof p === 'number' ? !numeric || (p >= lo && p <= hi) : !!p;
      };
      const sources: BC.Column[] = [];
      let seen = 0;
      for (const m of spec.marks) {
        const def = markDef(m);
        const bound = (ch: string) => channelRef(m, ch, def.channels[ch]);
        const followCols: BC.Column[] = [];
        const ownCols: BC.Column[] = [];
        for (const ch of Object.keys(def.channels)) {
          const ref = bound(ch);
          if (!ref || ref.field === undefined) continue;
          if (ref.scale === follow) followCols.push(table.columns[ref.field]);
          else if (ref.scale === name) ownCols.push(table.columns[ref.field]);
        }
        if (!ownCols.length) continue;
        for (const col of ownCols) {
          const kept: unknown[] = [];
          for (let i = 0; i < table.length; i++) {
            let visible = true;
            for (const fc of followCols) {
              if (!isVisible(fc[i])) {
                visible = false;
                break;
              }
            }
            if (visible) kept.push(col[i]);
          }
          seen += kept.length;
          sources.push(kept);
        }
      }
      if (!seen) return null;
      const fitted = (registry.get(`scale.${spec2.type}`) as BC.ScaleDef).create(spec2, {
        name, sources, range: scales[name].range(), color: colorAt,
      });
      return fitted.baseDomain();
    };

    // 8 interactions
    const hit = (ev: Event): BC.DatumRef | null => {
      const t = ev.target as Element | null;
      const el = t && t.closest ? t.closest('[data-bc-mark]') : null;
      return el ? { mark: Number(el.getAttribute('data-bc-mark')), row: Number(el.getAttribute('data-bc-row')) } : null;
    };
    // primitives with `data` are written as data-* attributes by DOM renderers; one without elements says it itself
    const dataAt = (ev: MouseEvent): Record<string, string> | null => {
      if (rendered.dataAt) return rendered.dataAt(ev);
      let el = ev.target as Element | null;
      while (el && el !== rendered.root.parentNode) {
        const out: Record<string, string> = {};
        let any = false;
        const attrs = (el as Element).attributes;
        for (let i = 0; attrs && i < attrs.length; i++) {
          if (attrs[i].name.indexOf('data-') === 0) {
            out[attrs[i].name.slice(5)] = attrs[i].value;
            any = true;
          }
        }
        if (any) return out;
        el = el.parentNode as Element | null;
      }
      return null;
    };
    const live = Object.create(ctx, {
      host: { value: host },
      dataAt: { value: dataAt },
      root: { value: rendered.root },
      list: { get: () => list },
      hit: { value: hit },
      cleanup: { value: (fn: () => void) => { cleanups.push(fn); } },
      setView: { value: setView },
      getView: { value: getView },
      fit: { value: fit },
      claimPosition: { value: claimPosition },
    }) as BC.LiveCtx;
    (spec.interaction || []).forEach((is, i) => {
      try {
        (registry.get(`interaction.${is.type}`) as BC.InteractionDef).attach(is, live);
      } catch (e) {
        fail(`interaction[${i}]`, e);
      }
    });

    const viewState = () => {
      const out: Record<string, unknown[]> = {};
      for (const name of Object.keys(view)) out[name] = view[name].slice();
      return out;
    };

    return { rendered, diagnostics, setView, getView, viewState };
  }

  function showErrors(host: HTMLElement, diagnostics: readonly BC.Diagnostic[]): void {
    const box = document.createElement('div');
    box.setAttribute('class', 'bc-error');
    box.setAttribute('style', 'font:12px/1.5 monospace;color:#b00020;border:1px solid #b00020;padding:8px;white-space:pre-wrap');
    box.textContent = 'blockcharts:\n' + diagnostics.map((d) => `${d.level} ${d.path || '(spec)'}: ${d.message}`).join('\n');
    host.appendChild(box);
  }

  /** Narrowest width a chart is laid out at, px: below it, it scales down as a drawing. */
  const MIN_LAYOUT_WIDTH = 200;

  function chart(host: HTMLElement, spec: BC.ChartSpec): BC.ChartHandle {
    let current = spec;
    /** The width the chart is built at now (null: its own size). */
    let laidOut: number | null = null;
    let checks: BC.Diagnostic[] = [];
    let built: Built | null = null;
    let cleanups: (() => void)[] = [];
    let epoch = 0;
    let destroyed = false;
    let keptView: Record<string, unknown[]> | null = null;
    let settle!: () => void;
    const firstBuild = new Promise<void>((resolve) => { settle = resolve; });

    const all = () => (built ? checks.concat(built.diagnostics) : checks);

    function teardown(): void {
      for (const fn of cleanups) {
        try { fn(); } catch (e) { console.error(e); }
      }
      cleanups = [];
      if (built) built.rendered.destroy();
      built = null;
      host.textContent = '';
    }

    function showLoading(): void {
      const box = document.createElement('div');
      box.setAttribute('class', 'bc-loading');
      box.setAttribute('style', 'font:12px system-ui,sans-serif;color:#777;padding:8px');
      box.textContent = 'Loading data…';
      host.appendChild(box);
    }

    function start(mine: number): void {
      teardown();
      // a dataset that is still being decoded: show a placeholder and build when it has settled
      const wait = typeof current.data === 'string' ? pending.get(current.data) : undefined;
      if (wait) {
        showLoading();
        wait.then(() => {
          if (!destroyed && mine === epoch) start(mine);
        });
        return;
      }
      checks = validate(current);
      const carried = keptView;
      keptView = null;
      if (!checks.some((d) => d.level === 'error')) {
        try {
          laidOut = widthFor(current);
          const effective = laidOut === null ? current : { ...current, size: [laidOut, Array.isArray(current.size) ? current.size[1] : 400] as [number, number] };
          built = build(host, effective, cleanups, carried || undefined);
        } catch (e) {
          checks.push({ level: 'error', path: '', message: e instanceof Error ? e.message : String(e) });
        }
      }
      const diagnostics = all();
      if (diagnostics.length) {
        for (const d of diagnostics) (d.level === 'error' ? console.error : console.warn)(`[blockcharts] ${d.path || '(spec)'}: ${d.message}`);
        if (checks.some((d) => d.level === 'error')) showErrors(host, diagnostics);
      }
      settle();
    }

    const run = () => start(++epoch);

    /** The width to lay the chart out at: the container's, when it is narrower than the chart's size; else null. */
    const widthFor = (s: BC.ChartSpec): number | null => {
      if (!s || s.responsive === false) return null;
      const w = (host as { clientWidth?: unknown }).clientWidth;
      const design = Array.isArray(s.size) && typeof s.size[0] === 'number' ? s.size[0] : 640;
      if (typeof w !== 'number' || !isFinite(w) || w <= 0 || w >= design - 1) return null;
      return Math.max(MIN_LAYOUT_WIDTH, Math.round(w));
    };
    // relayout when the container's width changes (a phone turned, a window resized), keeping the zoom
    const G = globalThis as { ResizeObserver?: new (cb: () => void) => { observe(el: Element): void; disconnect(): void } };
    let observer: { disconnect(): void } | null = null;
    let queued = false;
    if (typeof G.ResizeObserver === 'function' && spec.responsive !== false) {
      const ro = new G.ResizeObserver(() => {
        if (queued || destroyed) return;
        queued = true;
        const later = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn: () => void) => setTimeout(fn, 16);
        later(() => {
          queued = false;
          if (destroyed || widthFor(current) === laidOut) return;
          keptView = built ? built.viewState() : keptView;
          run();
        });
      });
      ro.observe(host);
      observer = ro;
    }

    run();
    return {
      host,
      get spec() { return current; },
      get diagnostics() { return all(); },
      ready: firstBuild,
      update(next, options) {
        if (destroyed) return;
        // the zoom to carry over: what is requested now (or, while waiting for data, what an earlier update carried)
        const previous = built ? built.viewState() : keptView || {};
        const kept: Record<string, unknown[]> = {};
        if (!(options && options.resetView)) {
          const before = (current && current.scales) || {};
          const after = (next && next.scales) || {};
          for (const name of Object.keys(previous)) {
            if (before[name] && after[name] && before[name].type === after[name].type) kept[name] = previous[name];
          }
        }
        current = next;
        keptView = kept;
        run();
      },
      setView(scale, domain) { if (built) built.setView(scale, domain); },
      getView() { return built ? built.getView() : {}; },
      destroy() {
        destroyed = true;
        if (observer) observer.disconnect();
        epoch++;
        teardown();
        settle();
      },
    };
  }

  // ───────────────────────── mount ─────────────────────────

  const mounted = new WeakMap<Element, BC.ChartHandle>();

  function mount(root?: ParentNode): BC.ChartHandle[] {
    const scope: ParentNode = root || document;
    const doc: Document = (scope as Node).ownerDocument || (scope as Document);
    const handles: BC.ChartHandle[] = [];

    scope.querySelectorAll('script#bc-data').forEach((el) => {
      try {
        const lakeInput = JSON.parse(el.textContent || '{}') as BC.DataLake;
        for (const name of Object.keys(lakeInput)) data(name, lakeInput[name]);
      } catch (e) {
        console.error('[blockcharts] #bc-data:', e);
      }
    });

    scope.querySelectorAll('script[data-bc-chart]').forEach((el) => {
      if (mounted.has(el)) return;
      let spec: BC.ChartSpec;
      try {
        spec = JSON.parse(el.textContent || '');
      } catch (e) {
        console.error('[blockcharts] chart spec is not valid JSON:', e);
        return;
      }
      let host = spec && spec.id ? doc.getElementById(spec.id) : null;
      if (!host) {
        host = doc.createElement('div');
        if (spec && spec.id) host.id = spec.id;
        host.className = 'bc-chart';
        if (el.parentNode) el.parentNode.insertBefore(host, el.nextSibling);
      }
      const handle = chart(host, spec);
      mounted.set(el, handle);
      handles.push(handle);
    });
    return handles;
  }

  // ───────────────────────── formatting ─────────────────────────

  const DEFAULT_LOCALE = 'en-US';
  const DATE_OPTIONS = ['era', 'year', 'month', 'day', 'weekday', 'hour', 'minute', 'second', 'dayPeriod', 'fractionalSecondDigits', 'timeZoneName', 'dateStyle', 'timeStyle', 'hour12', 'hourCycle'];
  const PRESETS: Record<string, BC.FormatSpec> = {
    percent: { kind: 'number', style: 'percent', maximumFractionDigits: 1 },
    compact: { kind: 'number', notation: 'compact', maximumFractionDigits: 1 },
    integer: { kind: 'number', maximumFractionDigits: 0 },
    year: { kind: 'date', year: 'numeric' },
    month: { kind: 'date', month: 'short', year: 'numeric' },
    day: { kind: 'date', month: 'short', day: 'numeric' },
    date: { kind: 'date', dateStyle: 'medium' },
    datetime: { kind: 'date', dateStyle: 'medium', timeStyle: 'short' },
  };
  const formatters = new Map<string, (value: unknown) => string>();

  function formatter(spec: string | BC.FormatSpec, kind?: 'number' | 'date'): (value: unknown) => string {
    let o: BC.FormatSpec;
    if (typeof spec === 'string') {
      if (!PRESETS[spec]) throw new Error(`unknown format "${spec}" (presets: ${Object.keys(PRESETS).join(', ')}; or an object of Intl options)`);
      o = PRESETS[spec];
    } else if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
      o = spec;
    } else {
      throw new Error('a format is a preset name or an object of Intl options');
    }
    const key = (kind || '') + '|' + JSON.stringify(o);
    const known = formatters.get(key);
    if (known) return known;

    const { locale, kind: declared, prefix, suffix, ...options } = o;
    if (locale !== undefined && typeof locale !== 'string') throw new Error('format "locale" must be a string like "en-US"');
    for (const [name, v] of [['prefix', prefix], ['suffix', suffix]] as const) if (v !== undefined && typeof v !== 'string') throw new Error(`format "${name}" must be a string`);
    if (declared !== undefined && declared !== 'number' && declared !== 'date') throw new Error('format "kind" must be "number" or "date"');
    const wantDate = (kind || declared || (Object.keys(options).some((k) => DATE_OPTIONS.indexOf(k) >= 0) ? 'date' : 'number')) === 'date';
    let nf: Intl.NumberFormat | undefined;
    let df: Intl.DateTimeFormat | undefined;
    try {
      if (wantDate) df = new Intl.DateTimeFormat(locale || DEFAULT_LOCALE, { timeZone: 'UTC', ...options } as Intl.DateTimeFormatOptions);
      else nf = new Intl.NumberFormat(locale || DEFAULT_LOCALE, options as Intl.NumberFormatOptions);
    } catch (e) {
      throw new Error(`invalid format ${JSON.stringify(spec)}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const fn = (v: unknown): string => {
      if (v == null || (typeof v === 'number' && isNaN(v))) return '';
      let text: string;
      if (nf) {
        text = typeof v === 'number' && isFinite(v) ? nf.format(v) : String(v);
      } else {
        const ms = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : v && typeof (v as Date).getTime === 'function' ? (v as Date).getTime() : NaN;
        text = isFinite(ms) ? (df as Intl.DateTimeFormat).format(ms) : String(v);
      }
      return (prefix || '') + text + (suffix || '');
    };
    formatters.set(key, fn);
    return fn;
  }

  const runtime: BC.Runtime = {
    version: VERSION,
    define,
    has: (name) => registry.has(name),
    get: (name) => registry.get(name),
    blocks: () => Array.from(registry.keys()) as BC.BlockName[],
    data,
    ready,
    defineFn: (name, fn) => { if (typeof fn !== 'function') throw new Error('BC.defineFn: ' + name + ' is not a function'); fns.set(name, fn); },
    getFn: (name) => fns.get(name),
    formatter,
    needs,
    validate,
    chart,
    mount,
  };
  g.BC = runtime;

  // a page that loads blocks by itself (loader.js) sets BC_CONFIG = { autoMount: false } first and mounts when they are in
  const config = g.BC_CONFIG as { autoMount?: boolean } | undefined;
  if (typeof document !== 'undefined' && !(config && config.autoMount === false)) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mount());
    else setTimeout(() => mount(), 0);
  }
})();
