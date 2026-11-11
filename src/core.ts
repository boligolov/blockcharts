(function () {
  // Build switches. scripts/minify.js makes the cores a composed page carries by turning them off (the text of these two
  // lines is what it looks for), and the minifier then drops the code only they reach. CHECKS: BC.validate and BC.needs,
  // which the composer has already run on the very same specs and data. DECODE: gzip, base64 and binary columns, which
  // only a page with encoded data needs. They come first: the minifier inlines a constant only up to the first early return.
  const CHECKS = true;
  const DECODE = true;
  const VERSION = '0.1.0';
  const g = globalThis as any;

  if (g.BC) {
    if (g.BC.version !== VERSION) console.warn(`blockcharts core ${VERSION} ignored: ${g.BC.version} is already loaded`);
    return;
  }

  const ROLES: readonly BC.Role[] = ['lib', 'scale', 'transform', 'mark', 'guide', 'interaction', 'renderer'];
  const SIDES = ['top', 'right', 'bottom', 'left'] as const;
  const DEFAULT_PADDING: BC.Insets = { top: 16, right: 16, bottom: 16, left: 16 };
  const TITLE_HEIGHT = 24;

  const registry = new Map<string, BC.BlockDef>();
  const lake = new Map<string, BC.Table>();
  /** Datasets being decoded, and the reason a decode failed. A dataset is in at most one of lake-with-fresh-data / pending / failed. */
  const pending = new Map<string, Promise<void>>();
  const failed = new Map<string, string>();
  const fns = new Map<string, (...args: any[]) => unknown>();
  /** Decoded size limit of one dataset, everything in it together (its JSON and its binary columns): a few KB of gzip can
   *  expand to gigabytes, and the page would freeze or crash. */
  const MAX_DECODED_BYTES = 64 * 1024 * 1024;

  // ───────────────────────── registry ─────────────────────────

  function define(def: BC.BlockDef): void {
    if (!def || ROLES.indexOf(def.role) < 0 || typeof def.type !== 'string' || !def.type) {
      throw new Error('BC.define: a block needs a valid role and type');
    }
    const name = `${def.role}.${def.type}`;
    if (CHECKS) {
      // what a scale declares is all that marks, guides and interactions go by: one that declares nothing fits nothing
      const outputs = ['position', 'color', 'size'];
      const inputs = ['number', 'date', 'category'];
      if (def.role === 'scale' && !(outputs.indexOf(def.output) >= 0 && inputs.indexOf(def.input) >= 0))
        throw new Error(
          `BC.define: ${name} must declare its output ("position", "color" or "size") and its input ("number", "date" or "category")`,
        );
      if (def.role === 'mark')
        for (const ch of Object.keys(def.channels || {})) {
          const need = def.channels[ch].accepts;
          if (
            need &&
            !(
              outputs.indexOf(need.output) >= 0 &&
              (need.input === undefined || (Array.isArray(need.input) && need.input.every((i) => inputs.indexOf(i) >= 0)))
            )
          )
            throw new Error(
              `BC.define: channel "${ch}" of ${name} accepts { output: "position", "color" or "size", input: a list of "number", "date", "category" }`,
            );
        }
    }
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
    // a column of that name would become the prototype of the columns instead of one of them
    const named = (k: string) => {
      if (k === '__proto__') throw new Error('BC.data: a column cannot be named "__proto__"; rename it');
      return k;
    };
    if (Array.isArray(input)) {
      const keys = new Set<string>();
      input.forEach((row, i) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`BC.data: row ${i} is not an object`);
        for (const k of Object.keys(row)) keys.add(named(k));
      });
      for (const k of keys) columns[k] = toColumn(input.map((r) => r[k]));
      length = input.length;
    } else if (
      input &&
      typeof input === 'object' &&
      (input as { columns?: unknown }).columns &&
      typeof (input as { columns?: unknown }).columns === 'object'
    ) {
      const source = (input as { columns: Record<string, unknown[] | Float64Array> }).columns;
      const names = Object.keys(source).map(named);
      for (const k of names)
        if (!Array.isArray(source[k]) && !(source[k] instanceof Float64Array)) throw new Error(`BC.data: column "${k}" is not an array`);
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

  const fromBase64 = (
    DECODE
      ? function fromBase64(text: string): Uint8Array {
          const clean = text.replace(/\s+/g, '');
          if (clean.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error('the data is not valid base64');
          if (typeof atob !== 'function') throw new Error('this environment has no atob(), cannot decode base64');
          const bin = atob(clean);
          const out = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
          return out;
        }
      : undefined
  )!;

  /** `limit` is what is left of the dataset's MAX_DECODED_BYTES. */
  const gunzip = (
    DECODE
      ? async function gunzip(bytes: Uint8Array, limit: number): Promise<Uint8Array> {
          const DS = (globalThis as any).DecompressionStream;
          if (typeof DS !== 'function' || typeof Blob !== 'function') {
            throw new Error(
              'this browser cannot decompress gzip data (no DecompressionStream); store the dataset as plain rows or "base64"',
            );
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
      : undefined
  )!;

  // Binary columns: { dtype, encoding, data } inside `columns`: the raw little-endian values of a numeric column, base64 (and
  // gzip) encoded. Much smaller than JSON text for long series; always read as Float64 (NaN = missing for float types).
  const DTYPES: Record<
    string,
    { size: number; ctor: { new (buffer: ArrayBuffer, offset: number, length: number): ArrayLike<number> }; get: string }
  > = {
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
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    !(v instanceof Float64Array) &&
    typeof (v as { dtype?: unknown }).dtype === 'string';

  const hasBinaryColumns = (input: unknown): boolean => {
    const cols = input && typeof input === 'object' && !Array.isArray(input) ? (input as { columns?: unknown }).columns : undefined;
    return !!cols && typeof cols === 'object' && Object.keys(cols).some((k) => isBinaryColumn((cols as Record<string, unknown>)[k]));
  };

  const decodeBinaryColumn = (
    DECODE
      ? async function decodeBinaryColumn(name: string, col: BC.BinaryColumn, budget: { left: number }): Promise<Float64Array> {
          const t = DTYPES[col.dtype];
          if (!t) throw new Error(`column "${name}": unknown dtype "${col.dtype}" (use ${Object.keys(DTYPES).join(', ')})`);
          if (col.encoding !== 'base64' && col.encoding !== 'gzip+base64')
            throw new Error(`column "${name}": unknown encoding "${col.encoding}" (use "base64" or "gzip+base64")`);
          if (typeof col.data !== 'string') throw new Error(`column "${name}": a binary column needs a "data" string`);
          let bytes: Uint8Array;
          try {
            bytes = fromBase64(col.data);
            if (col.encoding === 'gzip+base64') bytes = await gunzip(bytes, budget.left);
          } catch (e) {
            throw new Error(`column "${name}": ${e instanceof Error ? e.message : String(e)}`);
          }
          if (bytes.length % t.size !== 0)
            throw new Error(`column "${name}": ${bytes.length} bytes is not a whole number of ${col.dtype} values`);
          const n = bytes.length / t.size;
          budget.left -= n * 8;
          if (budget.left < 0)
            throw new Error(`the decoded data is larger than ${MAX_DECODED_BYTES / 1024 / 1024} MB, refusing to unpack it`);
          const out = new Float64Array(n);
          if (LITTLE_ENDIAN) {
            // a view needs an aligned buffer; the bytes may sit anywhere inside a larger one
            const aligned = bytes.byteOffset % t.size === 0 ? (bytes.buffer as ArrayBuffer) : (bytes.slice().buffer as ArrayBuffer);
            const offset = bytes.byteOffset % t.size === 0 ? bytes.byteOffset : 0;
            out.set(new t.ctor(aligned, offset, n));
          } else {
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
            for (let i = 0; i < n; i++) out[i] = (view as any)[t.get](i * t.size, true);
          }
          return out;
        }
      : undefined
  )!;

  /** Replaces the binary columns of a { columns } dataset with Float64Arrays. */
  const withBinaryColumns = (
    DECODE
      ? async function withBinaryColumns(json: unknown, budget: { left: number }): Promise<unknown> {
          if (!hasBinaryColumns(json)) return json;
          const source = (json as { columns: Record<string, unknown> }).columns;
          const columns: Record<string, unknown> = Object.create(null); // a "__proto__" stays a column, for BC.data to refuse
          for (const k of Object.keys(source))
            columns[k] = isBinaryColumn(source[k]) ? await decodeBinaryColumn(k, source[k] as BC.BinaryColumn, budget) : source[k];
          return { columns };
        }
      : undefined
  )!;

  const decodeDataset = (
    DECODE
      ? async function decodeDataset(input: BC.EncodedDataset | { columns: Record<string, unknown> }): Promise<BC.Table> {
          const budget = { left: MAX_DECODED_BYTES };
          if (!isEncoded(input)) return toTable((await withBinaryColumns(input, budget)) as BC.DatasetInput);
          if (typeof input.data !== 'string') throw new Error('an encoded dataset needs a "data" string');
          if (input.encoding !== 'base64' && input.encoding !== 'gzip+base64') {
            throw new Error(`unknown encoding "${input.encoding}" (use "base64" or "gzip+base64")`);
          }
          let bytes = fromBase64(input.data);
          if (input.encoding === 'gzip+base64') bytes = await gunzip(bytes, budget.left);
          // the JSON and the binary columns inside it share one limit
          budget.left -= bytes.length;
          let json: unknown;
          try {
            json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
          } catch (e) {
            throw new Error('the decoded data is not UTF-8 JSON: ' + (e instanceof Error ? e.message : String(e)));
          }
          if (isEncoded(json)) throw new Error('an encoded dataset cannot contain another encoded dataset');
          return toTable((await withBinaryColumns(json, budget)) as BC.DatasetInput);
        }
      : undefined
  )!;

  function data(name: string, input: BC.DatasetInput): void {
    if (isEncoded(input) || hasBinaryColumns(input)) {
      if (!DECODE)
        throw new Error(`dataset "${name}" is encoded, and this page was composed without the code that decodes data: compose it again`);
      failed.delete(name);
      // a later data() call for the same name wins even if this decode finishes after it
      const job: Promise<void> = decodeDataset(input as BC.EncodedDataset)
        .then(
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
        )
        .then(() => {
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

  interface ChannelRef {
    field?: string;
    scale?: string;
    value?: unknown;
  }

  /** null = absent, undefined = malformed. */
  function channelRef(mark: BC.MarkSpec, name: string, cdef?: BC.ChannelDef): ChannelRef | null | undefined {
    const v = mark[name];
    if (v === undefined) return cdef && cdef.default !== undefined ? { value: cdef.default } : null;
    const dflt = cdef && cdef.unscaled ? undefined : (cdef && cdef.sharesScale) || name;
    if (typeof v === 'string') return { field: v, scale: dflt };
    if (v && typeof v === 'object') {
      const o = v as { field?: unknown; scale?: unknown; value?: unknown };
      if (typeof o.field === 'string') return { field: o.field, scale: typeof o.scale === 'string' ? o.scale : dflt };
      if (o.value !== undefined) {
        // a constant on a position is a value on its scale, like any other value there; a color or a size is itself
        const scale = typeof o.scale === 'string' ? o.scale : dflt === 'x' || dflt === 'y' ? dflt : undefined;
        return scale !== undefined ? { value: o.value, scale } : { value: o.value };
      }
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

  /** What is wrong with the dataset a spec names, or null. Also in a page composed without CHECKS: the composer has seen
   *  the data, but a browser can still fail to decode it (no DecompressionStream), and the page has to say why. */
  function dataProblem(spec: BC.ChartSpec): string | null {
    const name = spec && typeof spec === 'object' ? spec.data : undefined;
    if (typeof name !== 'string') return 'data must be the name of a dataset';
    if (pending.has(name)) return `dataset "${name}" is still being decoded (await BC.ready())`;
    if (failed.has(name)) return `dataset "${name}" could not be loaded: ${failed.get(name)}`;
    if (!lake.has(name)) return `dataset "${name}" is not in the data lake`;
    return null;
  }

  const needs = (
    CHECKS
      ? function needs(spec: BC.ChartSpec): BC.BlockName[] {
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
      : undefined
  )!;

  // ───────────────────────── validation ─────────────────────────

  /** The keys of a chart spec (BC.ChartSpec). */
  const SPEC_KEYS = CHECKS
    ? [
        'id',
        'data',
        'transforms',
        'size',
        'padding',
        'title',
        'scales',
        'guides',
        'marks',
        'interaction',
        'view',
        'responsive',
        'renderer',
        'locale',
      ]
    : [];

  const validate = (
    CHECKS
      ? function validate(spec: BC.ChartSpec): BC.Diagnostic[] {
          const out: BC.Diagnostic[] = [];
          const err = (path: string, message: string) => out.push({ level: 'error', path, message });
          const warn = (path: string, message: string) => out.push({ level: 'warn', path, message });
          if (!spec || typeof spec !== 'object') {
            err('', 'the spec must be an object');
            return out;
          }
          /** A scale block fits a channel by what it declares, never by its name. */
          const fits = (def: BC.ScaleDef, need: BC.ScaleNeed) =>
            def.output === need.output && (!need.input || need.input.indexOf(def.input) >= 0);
          /** The known name a mistyped one was meant to be: the same but for case, or at most two letters off. */
          const nearest = (name: string, known: readonly string[]): string | undefined => {
            const distance = (a: string, b: string) => {
              let row = Array.from({ length: b.length + 1 }, (_, j) => j);
              for (let i = 1; i <= a.length; i++) {
                const next = [i];
                for (let j = 1; j <= b.length; j++)
                  next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
                row = next;
              }
              return row[b.length];
            };
            let best: string | undefined;
            let bestDistance = 3;
            for (const k of known) {
              const d = k.toLowerCase() === name.toLowerCase() ? 0 : distance(name, k);
              if (d < bestDistance) [best, bestDistance] = [k, d];
            }
            return best;
          };
          const meant = (name: string, known: readonly string[]) => {
            const near = nearest(name, known);
            return near ? `; did you mean "${near}"?` : '';
          };
          // a key the spec does not have would be dropped without a word: "interactions" takes the tooltip with it
          for (const key of Object.keys(spec)) if (SPEC_KEYS.indexOf(key) < 0) warn(key, `unknown key "${key}"${meant(key, SPEC_KEYS)}`);
          // and each key it has holds what it says: anything else fails later, far from here, or draws nothing
          for (const key of ['transforms', 'guides', 'interaction'] as const)
            if (spec[key] !== undefined && !Array.isArray(spec[key])) err(key, `${key} must be a list: [{ "type": ... }]`);
          if (spec.scales !== undefined && (!spec.scales || typeof spec.scales !== 'object' || Array.isArray(spec.scales)))
            err('scales', 'scales must map names to scales: { "x": { "type": "band" } }');
          if (spec.padding !== undefined) {
            if (typeof spec.padding === 'number') {
              if (!isFinite(spec.padding) || spec.padding < 0) err('padding', 'padding must be a number of px, 0 or more, or one per side');
            } else if (!spec.padding || typeof spec.padding !== 'object' || Array.isArray(spec.padding))
              err('padding', 'padding must be { "top": 8, "right": 8, "bottom": 30, "left": 40 } in px, or one number for every side');
            else
              for (const side of Object.keys(spec.padding)) {
                const v = (spec.padding as Record<string, unknown>)[side];
                if ((SIDES as readonly string[]).indexOf(side) < 0) warn(`padding.${side}`, `unknown side "${side}"${meant(side, SIDES)}`);
                else if (typeof v !== 'number' || !isFinite(v) || v < 0)
                  err(`padding.${side}`, `padding.${side} must be a number of px, 0 or more`);
              }
          }
          if (spec.title !== undefined && typeof spec.title !== 'string') err('title', 'title must be text');
          if (spec.id !== undefined && typeof spec.id !== 'string') err('id', 'id must be text');
          if (spec.responsive !== undefined && typeof spec.responsive !== 'boolean') err('responsive', 'responsive must be true or false');
          if (spec.renderer !== undefined && typeof spec.renderer !== 'string')
            err('renderer', 'renderer must be the name of one: "svg", "canvas"');
          if (spec.locale !== undefined) {
            let canonical = false;
            try {
              canonical = typeof spec.locale === 'string' && Intl.getCanonicalLocales(spec.locale).length === 1;
            } catch (e) {
              canonical = false;
            }
            if (!canonical) err('locale', `locale ${JSON.stringify(spec.locale)} is not a language tag like "en-US", "de" or "ja"`);
          }
          /** A format is a preset or Intl options the formatter takes: one it refuses fails here, not when it is drawn. */
          const checkFormat = (path: string, what: string, v: unknown) => {
            try {
              formatter(v as BC.FormatSpec);
            } catch (e) {
              err(path, `${what}: ${(e as Error).message}`);
            }
          };

          /** A color a spec may give: one that draws and fetches nothing. Hex, rgb()/hsl() and their kin, a name, var(--x)
           *  with such a fallback; never url(…), which an SVG fill or a style loads from the network, nor a ";" that ends a style. */
          const isColor = (v: unknown) =>
            typeof v === 'string' &&
            /^\s*(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([-+\w.%,\s/]*\)|[a-z]+|var\(\s*--[\w-]+\s*(?:,\s*(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?)\([-+\w.%,\s/]*\)|[a-z]+)\s*)?\))\s*$/i.test(
              v,
            );
          /** "places numbers or dates", "colors categories", "sizes values". */
          const scaleWords = (need: BC.ScaleNeed) =>
            `${{ position: 'places', color: 'colors', size: 'sizes' }[need.output]} ${
              need.input ? need.input.map((i) => ({ number: 'numbers', date: 'dates', category: 'categories' })[i]).join(' or ') : 'values'
            }`;

          const table = typeof spec.data === 'string' && !pending.has(spec.data) ? lake.get(spec.data) : undefined;
          const problem = dataProblem(spec);
          if (problem) err('data', problem);
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
            if (known && !Object.prototype.hasOwnProperty.call(known, field))
              err(path, `unknown field "${field}" in dataset "${spec.data}"`);
          };
          const checkField = (path: string, field: string) => checkFieldIn(knownColumns, path, field);
          // the declared scales, looked up by names the spec gives: "constructor" is not one of them unless it is declared
          const scales: Record<string, BC.ScaleSpec> = Object.assign(Object.create(null), spec.scales);

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

          const checkParams = (
            path: string,
            s: BC.BlockSpec,
            def: BC.BlockDef,
            common: string[],
            fieldCheck: (path: string, field: string) => void = checkField,
          ) => {
            const name = `${def.role}.${def.type}`;
            const params = def.params || {};
            const channels = def.role === 'mark' ? def.channels : {};
            for (const key of Object.keys(s)) {
              if (key === 'type' || common.indexOf(key) >= 0 || Object.prototype.hasOwnProperty.call(channels, key)) continue;
              const p = Object.prototype.hasOwnProperty.call(params, key) ? params[key] : undefined;
              if (!p) {
                warn(
                  `${path}.${key}`,
                  `unknown parameter "${key}" for ${name}${meant(key, Object.keys(params).concat(Object.keys(channels)))}`,
                );
                continue;
              }
              const v = s[key];
              if (v === undefined) continue; // left out, as JSON would leave it
              const bad = (want: string) => err(`${path}.${key}`, `${key} of ${name} must be ${want}`);
              switch (p.kind) {
                case 'string':
                  if (typeof v !== 'string') bad('a string');
                  break;
                case 'number':
                  if (typeof v !== 'number') bad('a number');
                  break;
                case 'boolean':
                  if (typeof v !== 'boolean') bad('a boolean');
                  break;
                case 'list':
                  if (!Array.isArray(v)) bad('a list');
                  break;
                case 'color':
                  if (!isColor(v)) bad('a color: "#4e79a7", "rgb(78 121 167)", "steelblue" or "var(--bc-c0)"');
                  break;
                case 'enum':
                  if (typeof v !== 'string' || !p.values || p.values.indexOf(v) < 0) bad(`one of: ${(p.values || []).join(', ')}`);
                  break;
                case 'field':
                  if (typeof v !== 'string') bad('a field name');
                  else fieldCheck(`${path}.${key}`, v);
                  break;
                case 'scale':
                  if (typeof v !== 'string' || !scales[v]) bad('the name of a declared scale');
                  break;
                case 'format':
                  checkFormat(`${path}.${key}`, `${key} of ${name}`, v);
                  break;
                case 'formats':
                  if (!v || typeof v !== 'object' || Array.isArray(v))
                    bad('an object of field names and formats: { "revenue": "currency" }');
                  else
                    for (const f of Object.keys(v)) {
                      fieldCheck(`${path}.${key}.${f}`, f);
                      checkFormat(`${path}.${key}.${f}`, `the format of "${f}"`, (v as Record<string, unknown>)[f]);
                    }
                  break;
                case 'fields':
                  if (!Array.isArray(v) || v.some((f) => typeof f !== 'string')) bad('a list of field names');
                  else v.forEach((f: string, k: number) => fieldCheck(`${path}.${key}[${k}]`, f));
                  break;
              }
            }
            for (const key of Object.keys(params)) {
              if (params[key].required && params[key].default === undefined && s[key] === undefined)
                err(`${path}.${key}`, `${name} requires "${key}"`);
            }
          };

          // a chart draws something: a mark, or at least a guide (a KPI tile is a guide alone)
          const hasGuides = Array.isArray(spec.guides) && spec.guides.length > 0;
          if (!Array.isArray(spec.marks))
            err('marks', 'marks must be a list (an empty one is fine when the chart has a guide, such as a KPI)');
          else if (!spec.marks.length && !hasGuides) err('marks', 'at least one mark is required (or a guide, such as a KPI)');

          /** [from, to] as a scale of numbers or dates reads them: two different ends it can read, or it draws nothing. */
          const twoEnds = (input: BC.ScaleInput, v: unknown[]) => {
            const ends = v.map((x) => (input === 'date' ? time(x) : typeof x === 'number' ? x : NaN));
            return v.length === 2 && ends.every((e) => isFinite(e)) && ends[0] !== ends[1];
          };
          const endsWord = (input: BC.ScaleInput) => (input === 'date' ? 'dates ("2024-03-01" or ms)' : 'numbers');

          if (spec.view !== undefined) {
            if (!spec.view || typeof spec.view !== 'object') err('view', 'view must map scale names to domains');
            else {
              for (const name of Object.keys(spec.view)) {
                const v = spec.view[name];
                const block = scales[name] && (registry.get(`scale.${scales[name].type}`) as BC.ScaleDef | undefined);
                if (!scales[name]) err(`view.${name}`, `scale "${name}" is not declared in scales`);
                else if (!Array.isArray(v)) err(`view.${name}`, 'a view is a list (the visible domain)');
                else if (block && block.input === 'category') {
                  if (!v.length) err(`view.${name}`, 'a view of categories lists at least one of them');
                } else if (block && !twoEnds(block.input, v)) {
                  // from and to, as the scale reads them: a view it cannot read leaves the plot empty
                  err(
                    `view.${name}`,
                    `a view of "${name}" is [from, to]: two different ${endsWord(block.input)}, not ${JSON.stringify(v)}`,
                  );
                }
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
            const sd = def as BC.ScaleDef;
            if (s.domain !== undefined && !Array.isArray(s.domain))
              err(`${path}.domain`, 'domain must be a list: [min, max], or the categories in order');
            // a domain of numbers or dates the scale cannot read was dropped without a word ([-10, 0, 10]), or drew nothing
            else if (Array.isArray(s.domain) && sd.input !== 'category' && !twoEnds(sd.input, s.domain))
              err(
                `${path}.domain`,
                `the domain of scale "${name}" is [from, to]: two different ${endsWord(sd.input)}, not ${JSON.stringify(s.domain)}` +
                  (sd.output === 'color' && s.domain.length === 3
                    ? '; a diverging scale is three colors in "range" and a domain even around the middle, such as [-10, 10]'
                    : ''),
              );
            if (s.range !== undefined && s.range !== 'width' && s.range !== 'height' && !Array.isArray(s.range)) {
              err(`${path}.range`, 'range must be "width", "height" or a list');
            } else if (Array.isArray(s.range) && (def as BC.ScaleDef).output === 'color') {
              s.range.forEach((c: unknown, k: number) => {
                if (!isColor(c))
                  err(
                    `${path}.range[${k}]`,
                    `${JSON.stringify(c)} is not a color: "#4e79a7", "rgb(78 121 167)", "steelblue" or "var(--bc-c0)"`,
                  );
              });
            }
          }

          const unplaced = new Set<string>();
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
                  const block = sdef && (registry.get(`scale.${sdef.type}`) as BC.ScaleDef | undefined);
                  if (!sdef) err(`${path}.${ch}`, `scale "${ref.scale}" is not declared in scales`);
                  else if (block && cdef.accepts && !fits(block, cdef.accepts)) {
                    // the scales on the page that would do, by what they declare
                    const would: string[] = [];
                    registry.forEach((d, n) => {
                      if (d.role === 'scale' && fits(d, cdef.accepts as BC.ScaleNeed)) would.push(n.slice(6));
                    });
                    err(
                      `${path}.${ch}`,
                      `channel "${ch}" of ${name} needs a scale that ${scaleWords(cdef.accepts)}${would.length ? ` (${would.sort().join(', ')})` : ''}; "${sdef.type}" ${scaleWords({ output: block.output, input: [block.input] })}`,
                    );
                  } else if (block && block.output === 'position' && rangeSetting(ref.scale, sdef) === undefined) {
                    // only x and y have a range of their own; another scale of positions puts everything at one point
                    if (!unplaced.has(ref.scale)) {
                      unplaced.add(ref.scale);
                      err(
                        `scales.${ref.scale}`,
                        `scale "${ref.scale}" places values but has no range, so nothing it places is drawn: give it "range": "width" or "height" (only x and y have one by default)`,
                      );
                    }
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
              if (s.scale !== undefined && (typeof s.scale !== 'string' || !scales[s.scale]))
                err(`${path}.scale`, `scale "${String(s.scale)}" is not declared in scales`);
              // the four sides, unless the guide declares the places it takes (a legend also takes "auto")
              const declared = def.params && def.params.position;
              const places: readonly string[] = declared && declared.kind === 'enum' && declared.values ? declared.values : SIDES;
              if (s.position !== undefined && places.indexOf(s.position) < 0)
                err(`${path}.position`, `position must be one of: ${places.join(', ')}`);
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
      : undefined
  )!;

  // ───────────────────────── pipeline ─────────────────────────

  /** The light palette, the one place it is written: a chart falls back on it, and the composer and the site write their
   *  --bc-c<N> from BC.palette. One strong blue among calm colors, every one far enough from the others. */
  const PALETTE = [
    '#3a6fe4',
    '#16a39d',
    '#f29b38',
    '#e0527a',
    '#8a6be8',
    '#5d718f',
    '#2e9e62',
    '#ea7b4f',
    '#8c6d46',
    '#a3ad3a',
    '#1f7a9c',
    '#b0479a',
  ];

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

  /** Hangul, kana, CJK ideographs, full-width forms: a full em, against about half of one for Latin. */
  const wideCode = (c: number) =>
    (c >= 0x1100 && c <= 0x11ff) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe6f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xd840 && c <= 0xd87f); // the first half of an ideograph outside the basic plane

  function wide(text: string): boolean {
    for (let i = 0; i < text.length; i++) if (wideCode(text.charCodeAt(i))) return true;
    return false;
  }

  function measure(text: string, size: number = 11): { w: number; h: number } {
    let em = 0;
    for (let i = 0; i < text.length; i++) em += wideCode(text.charCodeAt(i)) ? 1 : 0.6;
    return { w: em * size, h: size * 1.2 };
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
  function build(
    host: HTMLElement,
    spec: BC.ChartSpec,
    cleanups: (() => void)[],
    keptView?: Record<string, unknown[]>,
    asked?: Record<string, unknown[] | null>,
  ): Built {
    // the language of the chart, for BC.formatter while the chart is built and drawn; after that, and in a page's own script,
    // BC.formatter writes the default. What a block writes outside drawing (an interaction, a card on hover) uses ctx.format.
    const language = typeof spec.locale === 'string' && spec.locale ? spec.locale : undefined;
    const speak = () => {
      chartLocale = language;
    };
    speak();
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
    cleanups.push(() => {
      disposed = true;
    });

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

    // A drag can mean a pan (interaction.zoom) or a selection (interaction.brush, with its modifier held). The one that
    // wants a particular drag claims it; the one that drags by default asks first, so neither has to know the other.
    // The claims are made anew with every build, as the interactions are attached anew.
    const dragClaims: ((ev: PointerEvent) => boolean)[] = [];

    // 1 table + transforms. Transforms before the first view-dependent one run once; that one and the rest run at every
    // redraw (see draw), on the table the static ones produced. Scale domains come from that static table: the full data.
    const transformSpecs = spec.transforms || [];
    const viewDependent = (ts: BC.TransformSpec) => {
      const v = (registry.get(`transform.${ts.type}`) as BC.TransformDef).viewDependent;
      return typeof v === 'function' ? v(ts) : !!v;
    };
    const firstDynamic = transformSpecs.findIndex(viewDependent);
    const staticCount = firstDynamic < 0 ? transformSpecs.length : firstDynamic;
    const said = (path: string, d: BC.Diagnostic | null) => {
      if (d) (d.level === 'error' ? fail : warn)(path, d.message);
    };
    const own = (t: BC.Table, field: unknown) =>
      typeof field === 'string' && Object.prototype.hasOwnProperty.call(t.columns, field) ? t.columns[field] : undefined;
    // a transform that reads numbers (or dates) from a field that has none makes nothing of it, without a word
    const readsChecked = new Set<number>();
    const checkReads = (at: number, t: BC.Table) => {
      if (readsChecked.has(at)) return; // a transform that reruns at every redraw is looked at once
      readsChecked.add(at);
      const ts = transformSpecs[at];
      const params = (registry.get(`transform.${ts.type}`) as BC.TransformDef).params || {};
      for (const key of Object.keys(params)) {
        const reads = params[key].reads;
        const field = ts[key];
        if (reads && typeof field === 'string')
          said(`transforms[${at}].${key}`, unreadable(`transform.${ts.type}`, field, own(t, field), reads));
      }
    };
    let table = lake.get(spec.data)!;
    transformSpecs.slice(0, staticCount).forEach((ts, i) => {
      const def = registry.get(`transform.${ts.type}`) as BC.TransformDef;
      const before = diagnostics.length;
      checkReads(i, table);
      try {
        table = def.apply(table, ts);
      } catch (e) {
        // a transform that fails on a field it cannot read: what it could not read is the reason, at its path; any other
        // failure is reported at the transform
        const cause = diagnostics.slice(before).find((d) => d.level === 'error');
        if (cause) throw Object.assign(new Error(cause.message), { path: cause.path });
        throw Object.assign(new Error(e instanceof Error ? e.message : String(e)), { path: `transforms[${i}]` });
      }
      if (!table) throw new Error(`transforms[${i}] returned no table`);
    });
    const baseTable = table;
    const dynamicSpecs = transformSpecs.slice(staticCount);
    // Scales take their domains from `table` next. A transform that needs a view only when asked to follow one can also run
    // without it, and what it writes may be what a scale reads; decimate cannot.
    for (const ts of dynamicSpecs) {
      const def = registry.get(`transform.${ts.type}`) as BC.TransformDef;
      if (def.viewDependent === true) break;
      table = def.apply(table, ts);
    }

    // 2 layout, first guess
    const size = { w: spec.size ? spec.size[0] : 640, h: spec.size ? spec.size[1] : 400 };
    // a number is every side, as in CSS: `padding: 0` is no padding (it used to be the default padding, without a word)
    const p = spec.padding;
    const pad = typeof p === 'number' ? { top: p, right: p, bottom: p, left: p } : { ...DEFAULT_PADDING, ...(p || {}) };
    if (spec.title) pad.top += TITLE_HEIGHT;
    let plot = insetsPlot(size, pad);

    // 3 scales: the domain of each is inferred from every channel that names it
    const scaleSpecs = spec.scales || {};
    // looked up by names from specs and from callers (setView): no name finds anything that was not put there
    const scales: Record<string, BC.Scale> = Object.create(null);
    const channelCache = new Map<BC.MarkSpec, Record<string, BC.ChannelData>>();
    const tickCache = new Map<string, BC.Tick[]>();
    const rowsCache = new Map<BC.MarkSpec, { from: number; to: number }>();
    /** Series per mark, for the xs they were split by: render and every pick of the frame ask for the same ones. */
    const seriesCache = new Map<BC.MarkSpec, { xs: ArrayLike<number>; out: { key: unknown; rows: number[] }[] }>();
    const markDef = (m: BC.MarkSpec) => registry.get(`mark.${m.type}`) as BC.MarkDef;
    const view: Record<string, unknown[]> = Object.create(null);
    const applyView = () => {
      for (const name of Object.keys(scales)) {
        scales[name].setDomain(view[name] || null);
        if (view[name]) view[name] = scales[name].domain();
      }
      channelCache.clear();
      tickCache.clear();
      rowsCache.clear();
      seriesCache.clear();
    };

    /** What a mark may know of its channels before the scales exist: the type of the scale each is on, and its column. */
    const reachAsk = (m: BC.MarkSpec): BC.MarkReachAsk => {
      const md = markDef(m);
      const refOf = (ch: string) => (md.channels[ch] ? channelRef(m, ch, md.channels[ch]) : null);
      return {
        scale(ch) {
          const ref = refOf(ch);
          const s =
            ref && ref.scale !== undefined && Object.prototype.hasOwnProperty.call(scaleSpecs, ref.scale)
              ? scaleSpecs[ref.scale]
              : undefined;
          const d = s ? (registry.get(`scale.${s.type}`) as BC.ScaleDef | undefined) : undefined;
          return s && d ? { input: d.input, even: d.even === true } : undefined;
        },
        column(ch) {
          const ref = refOf(ch);
          return ref && ref.field !== undefined ? own(table, ref.field) : undefined;
        },
      };
    };

    for (const name of Object.keys(scaleSpecs)) {
      const s = scaleSpecs[name];
      const def = registry.get(`scale.${s.type}`) as BC.ScaleDef;
      const sources: BC.Column[] = [];
      const reader = `scale "${name}"`;
      spec.marks.forEach((m, i) => {
        const md = markDef(m);
        for (const ch of Object.keys(md.channels)) {
          const ref = channelRef(m, ch, md.channels[ch]);
          if (!ref || ref.scale !== name) continue;
          if (ref.field !== undefined) {
            sources.push(table.columns[ref.field]);
            // a number scale given text puts nothing anywhere: "$1,750" and "1750" in quotes are not numbers
            said(`marks[${i}].${ch}`, unreadable(reader, ref.field, own(table, ref.field), def.input));
            // a mark that draws past its first and last value (a bar standing at a date) says what else the scale holds
            const more = md.reach ? md.reach(m, ch, reachAsk(m)) : null;
            if (more && more.length) sources.push(more as unknown as BC.Column);
          }
          // a constant has to be on the scale it is a value of, unless the scale takes its domain from fields alone (a band)
          else if (!def.fieldsOnly) sources.push([ref.value] as unknown as BC.Column);
        }
      });
      if (typeof s.field === 'string') {
        sources.push(table.columns[s.field]);
        said(`scales.${name}.field`, unreadable(reader, s.field, own(table, s.field), def.input));
      }
      // a scale that cannot be made (a domain it cannot read, numbers that are no dates) is reported at the scale
      let made: BC.ScaleMapping;
      try {
        made = def.create(s, { name, sources, range: resolveRange(name, s, plot), color: colorAt });
      } catch (e) {
        throw Object.assign(new Error(e instanceof Error ? e.message : String(e)), { path: `scales.${name}` });
      }
      // what the block declares goes on the scale itself: everything that reads a scale goes by it
      scales[name] = Object.defineProperties(made, {
        output: { value: def.output },
        input: { value: def.input },
      }) as BC.Scale;
    }
    const initial = spec.view || {};
    for (const name of Object.keys(initial)) view[name] = initial[name];
    // a zoom carried over from before an update(); a view the new spec sets itself wins
    for (const name of Object.keys(keptView || {})) {
      if (scales[name] && !Object.prototype.hasOwnProperty.call(initial, name)) view[name] = (keptView as Record<string, unknown[]>)[name];
    }
    // what the page asked for with setView while the chart waited for its data: it wins over the spec, as setView does
    for (const name of Object.keys(asked || {})) {
      const domain = (asked as Record<string, unknown[] | null>)[name];
      if (!scales[name]) continue;
      if (domain) view[name] = domain;
      else delete view[name];
    }
    applyView();

    // a constant the scale has no place for (a domain given by hand, a category that is not in the data) draws nothing
    spec.marks.forEach((m, i) => {
      const def = markDef(m);
      for (const ch of Object.keys(def.channels)) {
        const ref = channelRef(m, ch, def.channels[ch]);
        const scale = ref && ref.field === undefined && ref.scale !== undefined ? scales[ref.scale] : undefined;
        // only a scale along the width or the height of the plot has a place to miss
        const along = scale ? rangeSetting(ref!.scale as string, scaleSpecs[ref!.scale as string]) : undefined;
        if (!ref || !scale || (along !== 'width' && along !== 'height')) continue;
        const px = scale(ref.value) as number;
        const [a, b] = scale.range() as number[];
        if (!(px >= Math.min(a, b) - 0.5 && px <= Math.max(a, b) + 0.5))
          warn(
            `marks[${i}].${ch}`,
            `the constant ${String(ref.value)} is outside scale "${ref.scale}", so it is not drawn where you meant`,
          );
      }
    });

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
        // both ends must have a place on the scale (a log scale has none for zero): one without it cannot say which way
        // the scale points, and a binary search would stop on it. Sorted, such values can only sit at the ends.
        const p0 = scale(col[0]) as number;
        const p1 = scale(col[n - 1]) as number;
        let fast = 0;
        if (isFinite(p0) && isFinite(p1) && p0 !== p1) {
          const points = p1 > p0 ? 1 : -1;
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
      format: (f, kind) => formatter(f, kind, language),
      get table() {
        return table;
      },
      baseTable,
      size,
      get plot() {
        return plot;
      },
      scales,
      measure,
      wide,
      alongX: (spec.interaction || []).some((is) => {
        const def = registry.get(`interaction.${is.type}`) as BC.InteractionDef | undefined;
        return !!(def && def.alongX);
      }),
      orientation(name) {
        const r = scaleSpecs[name] && rangeSetting(name, scaleSpecs[name]);
        return r === 'width' ? 'horizontal' : r === 'height' ? 'vertical' : null;
      },
      ticks(name, approxCount) {
        const scale = scales[name];
        if (!scale || !scale.ticks) return [];
        const o = ctx.orientation(name);
        let count =
          approxCount !== undefined
            ? approxCount
            : Math.max(2, Math.round(o === 'vertical' ? plot.h / 40 : o === 'horizontal' ? plot.w / 80 : 6));
        // categories are named, not sampled: show every label that fits, as the guides that write them measure it, and
        // thin them only when they do not
        if (approxCount === undefined && scale.input === 'category' && o) {
          for (const g of spec.guides || []) {
            const gd = g.scale === name ? (registry.get(`guide.${g.type}`) as BC.GuideDef | undefined) : undefined;
            if (gd && gd.fits)
              count = Math.max(
                count,
                Math.min((scale.domain() as unknown[]).length, gd.fits(g, ctx, o === 'horizontal' ? plot.w : plot.h)),
              );
          }
        }
        const key = `${name}:${count}`;
        let t = tickCache.get(key);
        if (!t) tickCache.set(key, (t = scale.ticks(count)));
        return t;
      },
      edgeTaken(edge) {
        const taken = { left: 0, right: 0 };
        for (const s of spec.interaction || []) {
          const def = registry.get(`interaction.${s.type}`) as BC.InteractionDef | undefined;
          const c = def && def.corner ? def.corner(s, ctx) : null;
          if (c && c.edge === edge) taken[c.side] = Math.max(taken[c.side], c.width);
        }
        return taken;
      },
      rows(mark) {
        let r = rowsCache.get(mark);
        if (!r) rowsCache.set(mark, (r = visibleRows(mark)));
        return r;
      },
      series(mark, xs) {
        const known = seriesCache.get(mark);
        if (known && known.xs === xs) return known.out;
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
          // a row with no x (NaN) has no place on the line: it goes last, where it cannot break the order of the others
          // (a NaN in the comparator would make the whole sort inconsistent)
          if (!sorted) rows.sort((a, b) => (xs[a] !== xs[a] ? (xs[b] !== xs[b] ? 0 : 1) : xs[b] !== xs[b] ? -1 : xs[a] - xs[b]));
          out.push({ key, rows });
        });
        seriesCache.set(mark, { xs, out });
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
          result = { raw: [], mapped: [], half: 0 };
        } else if (ref.field === undefined) {
          const scale = ref.scale !== undefined ? scales[ref.scale] : undefined;
          const raw = new Array(table.length).fill(ref.value);
          const mapped = scale ? new Array(table.length).fill(scale(ref.value)) : raw;
          result = { raw, mapped, scale, half: scale && scale.bandwidth !== undefined ? scale.bandwidth / 2 : 0 };
        } else {
          const raw = table.columns[ref.field];
          const scale = ref.scale !== undefined ? scales[ref.scale] : undefined;
          if (!scale) {
            result = { field: ref.field, raw, mapped: raw, half: 0 };
          } else {
            const n = table.length;
            const { from, to } = ctx.rows(mark);
            const first = to > from ? scale(raw[from]) : 0;
            // rows outside the visible window are not mapped (NaN); marks read only from..to
            const mapped: ArrayLike<any> = typeof first === 'number' ? new Float64Array(n).fill(NaN) : new Array(n);
            for (let i = from; i < to; i++) (mapped as any)[i] = scale(raw[i]);
            result = { field: ref.field, scale, raw, mapped, half: scale.bandwidth !== undefined ? scale.bandwidth / 2 : 0 };
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
    if (inset('top') + inset('bottom') > size.h)
      warn(
        'size',
        `padding and guides need ${inset('top') + inset('bottom')} px of height and the chart has ${size.h}, so its bottom is cut off`,
      );
    for (const name of Object.keys(scales)) scales[name].setRange(resolveRange(name, scaleSpecs[name], plot));
    channelCache.clear();
    tickCache.clear();
    rowsCache.clear();
    seriesCache.clear();

    // 5 + 6: ticks are computed lazily through ctx.ticks; marks and guides emit primitives
    let list!: BC.DisplayList;
    function draw(): void {
      speak();
      if (dynamicSpecs.length) {
        let t = baseTable;
        dynamicSpecs.forEach((ts, i) => {
          try {
            checkReads(staticCount + i, t);
            const next = (registry.get(`transform.${ts.type}`) as BC.TransformDef).apply(t, ts, {
              plot,
              scales,
              warn: (m) => warn(`transforms[${staticCount + i}]`, m),
            });
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
      seriesCache.clear();
      const layers: Record<BC.LayerName, BC.Prim[]> = { grid: [], marks: [], axes: [], overlay: [] };
      spec.marks.forEach((m, i) => {
        try {
          const md = markDef(m);
          append(layers.marks, md.render(m, ctx, i));
          if (md.labels) append(layers.axes, md.labels(m, ctx, i));
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
        layers.axes.push({
          type: 'text',
          x: pad.left,
          y: TITLE_HEIGHT - 6,
          text: spec.title,
          size: 14,
          weight: 600,
          style: { fill: 'var(--bc-text, #444)' },
        });
      }
      // Marks may overhang the plot only while nothing is zoomed; a view needs the clip.
      const zoomed = Object.keys(view).length > 0;
      list = {
        size,
        plot,
        layers: (['grid', 'marks', 'axes', 'overlay'] as BC.LayerName[]).map((name) => ({
          name,
          prims: layers[name],
          clip: name === 'marks' && zoomed ? { ...plot } : undefined,
        })),
      };
      hush();
    }

    draw();

    // 7 render
    const renderer = registry.get(`renderer.${spec.renderer || 'svg'}`) as BC.RendererDef;
    const rendered = renderer.render(list, host);

    // view changes: merged per frame; only stages 5-7 rerun
    let redrawQueued = false;
    const setView = (name: string, domain: unknown[] | null) => {
      if (!scales[name]) {
        console.warn(`[blockcharts] setView: unknown scale "${name}"`);
        return;
      }
      if (domain) view[name] = domain;
      else delete view[name];
      if (redrawQueued) return;
      redrawQueued = true;
      nextFrame(() => {
        redrawQueued = false;
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
      const probe = (registry.get(`scale.${followSpec.type}`) as BC.ScaleDef).create(
        { ...followSpec, domain: scales[follow].baseDomain() },
        {
          name: follow,
          sources: [],
          range: scales[follow].range(),
          color: colorAt,
        },
      );
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
        name,
        sources,
        range: scales[name].range(),
        color: colorAt,
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
      cleanup: {
        value: (fn: () => void) => {
          cleanups.push(fn);
        },
      },
      setView: { value: setView },
      getView: { value: getView },
      fit: { value: fit },
      claimPosition: { value: claimPosition },
      claimDrag: { value: (when: (ev: PointerEvent) => boolean) => dragClaims.push(when) },
      dragClaimed: { value: (ev: PointerEvent) => dragClaims.some((when) => when(ev)) },
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

  /** What a core without CHECKS still tells: a spec that is not one, and data the browser could not load. */
  function leanChecks(spec: BC.ChartSpec): BC.Diagnostic[] {
    if (!spec || typeof spec !== 'object') return [{ level: 'error', path: '', message: 'the spec must be an object' }];
    const problem = dataProblem(spec);
    return problem ? [{ level: 'error', path: 'data', message: problem }] : [];
  }

  /** Narrowest width a chart is laid out at, px (unless its size is narrower): below it, it scales down as a drawing. */
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
    // setView calls made before there is a chart to take them (its data still decoding), for the build
    let asked: Record<string, unknown[] | null> = {};
    let settle!: () => void;
    const firstBuild = new Promise<void>((resolve) => {
      settle = resolve;
    });

    const all = () => (built ? checks.concat(built.diagnostics) : checks);

    function teardown(): void {
      for (const fn of cleanups) {
        try {
          fn();
        } catch (e) {
          console.error(e);
        }
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
      const wait = current && typeof current.data === 'string' ? pending.get(current.data) : undefined;
      if (wait) {
        showLoading();
        wait.then(() => {
          if (!destroyed && mine === epoch) start(mine);
        });
        return;
      }
      checks = CHECKS ? validate(current) : leanChecks(current);
      const carried = keptView;
      const wanted = asked;
      keptView = null;
      asked = {};
      if (!checks.some((d) => d.level === 'error')) {
        try {
          laidOut = widthFor(current);
          const effective =
            laidOut === null
              ? current
              : { ...current, size: [laidOut, Array.isArray(current.size) ? current.size[1] : 400] as [number, number] };
          built = build(host, effective, cleanups, carried || undefined, wanted);
        } catch (e) {
          hush();
          const at = e && typeof (e as { path?: unknown }).path === 'string' ? (e as { path: string }).path : '';
          checks.push({ level: 'error', path: at, message: e instanceof Error ? e.message : String(e) });
        }
      }
      const diagnostics = all();
      if (diagnostics.length) {
        for (const d of diagnostics)
          (d.level === 'error' ? console.error : console.warn)(`[blockcharts] ${d.path || '(spec)'}: ${d.message}`);
        if (checks.some((d) => d.level === 'error')) showErrors(host, diagnostics);
      }
      settle();
    }

    const run = () => start(++epoch);

    /** The width to lay the chart out at: the container's, narrower or wider than the chart's size, so text is drawn at
     *  its own size in any card; null for the size itself (no width known, or the same width). Never narrower than
     *  MIN_LAYOUT_WIDTH, or than the size when that is narrower still: below it the drawing scales down. */
    const widthFor = (s: BC.ChartSpec): number | null => {
      if (!s || typeof s !== 'object' || s.responsive === false) return null;
      const w = (host as { clientWidth?: unknown }).clientWidth;
      const design = Array.isArray(s.size) && typeof s.size[0] === 'number' ? s.size[0] : 640;
      if (typeof w !== 'number' || !isFinite(w) || w <= 0) return null;
      const at = Math.max(Math.round(w), Math.min(design, MIN_LAYOUT_WIDTH));
      return Math.abs(at - design) < 1 ? null : at;
    };
    // relayout when the container's width changes (a phone turned, a window resized), keeping the zoom. Watched whatever
    // the spec says: an update() may turn `responsive` on or off, and widthFor reads the spec of the moment.
    const G = globalThis as { ResizeObserver?: new (cb: () => void) => { observe(el: Element): void; disconnect(): void } };
    let observer: { disconnect(): void } | null = null;
    let queued = false;
    if (typeof G.ResizeObserver === 'function') {
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
      get spec() {
        return current;
      },
      get diagnostics() {
        return all();
      },
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
        // so is what was asked for before the data came: for a scale of the same type, unless the view starts again
        for (const name of Object.keys(asked)) {
          const before = (current && current.scales) || {};
          const after = (next && next.scales) || {};
          if ((options && options.resetView) || !before[name] || !after[name] || before[name].type !== after[name].type) delete asked[name];
        }
        current = next;
        keptView = kept;
        run();
      },
      setView(scale, domain) {
        if (destroyed) return;
        if (built) return built.setView(scale, domain);
        // no chart yet: kept for the build, said at once when the spec has no such scale
        if (!(current && current.scales && Object.prototype.hasOwnProperty.call(current.scales, scale))) {
          console.warn(`[blockcharts] setView: unknown scale "${scale}"`);
          return;
        }
        asked[scale] = domain;
      },
      getView() {
        if (built) return built.getView();
        // no chart yet: the view it will be built with, as build puts it together
        const out: Record<string, unknown[]> = { ...((current && current.view) || {}) };
        for (const name of Object.keys(keptView || {}))
          if (!Object.prototype.hasOwnProperty.call(out, name)) out[name] = (keptView as Record<string, unknown[]>)[name];
        for (const name of Object.keys(asked)) {
          const domain = asked[name];
          if (domain) out[name] = domain;
          else delete out[name];
        }
        return out;
      },
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
  /** Elements mount() has drawn a chart in. */
  const hosts = new WeakSet<Element>();

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
      const id = spec && typeof spec === 'object' && typeof spec.id === 'string' && spec.id ? spec.id : null;
      let host = id ? doc.getElementById(id) : null;
      // two specs with one id would draw into one element, the second wiping out the first: the second gets its own
      if (host && hosts.has(host)) {
        console.error(`[blockcharts] chart id "${id}" is used by another chart on the page; this one is drawn where its spec is`);
        host = null;
      } else if (host && /^script$/i.test(host.tagName || '')) {
        host = null; // an id that names a script (the data, a spec) is no place to draw in
      }
      if (!host) {
        host = doc.createElement('div');
        if (id && !doc.getElementById(id)) host.id = id;
        host.className = 'bc-chart';
        if (el.parentNode) el.parentNode.insertBefore(host, el.nextSibling);
      }
      // one chart that cannot be drawn never stops the others
      try {
        const handle = chart(host, spec);
        hosts.add(host);
        mounted.set(el, handle);
        handles.push(handle);
      } catch (e) {
        console.error('[blockcharts] chart could not be mounted:', e);
      }
    });
    return handles;
  }

  // ───────────────────────── times ─────────────────────────

  /** The last moment a Date can hold, ms either side of 1970. A number past it is not a time (nanoseconds, say). */
  const MAX_MS = 8.64e15;
  // A date with a time of day: ECMAScript reads one without an offset as the reader's local time, unlike a plain date,
  // which is UTC. Here both are UTC, so a report shows every reader the same hours. A space instead of the "T" (what CSV
  // exports write) is not ECMAScript's format at all, and browsers disagree about it; it is read like the "T".
  const DATE_TIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?)\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

  // A year, a month or a day, which ECMAScript reads as UTC. Anything else ("3/1/2024", "Mar 1, 2024", "2024-3-1") the
  // engine reads as the reader's local time, if at all, and "3/1" is March or January depending on who wrote it: not a
  // date here, so the chart says which values it could not read instead of drawing them on other days in other zones.
  const ISO_DATE = /^(?:\d{4}|[+-]\d{6})(?:-\d{2}(?:-\d{2})?)?$/;

  function time(v: unknown): number {
    if (typeof v === 'number') return Math.abs(v) <= MAX_MS ? v : NaN;
    if (typeof v === 'string') {
      const s = v.trim();
      const m = DATE_TIME.exec(s);
      if (!m) return ISO_DATE.test(s) ? Date.parse(s) : NaN;
      const zone =
        m[3] === undefined ? 'Z' : m[3].length === 3 ? m[3] + ':00' : m[3].length === 5 ? m[3].slice(0, 3) + ':' + m[3].slice(3) : m[3];
      return Date.parse(`${m[1]}T${m[2].replace(',', '.')}${zone.toUpperCase()}`);
    }
    if (v && typeof (v as Date).getTime === 'function') {
      const ms = (v as Date).getTime();
      return typeof ms === 'number' ? ms : NaN;
    }
    return NaN;
  }

  // ───────────────────────── what a field holds ─────────────────────────

  // a number written as text: what hand-typed JSON and a CSV column with a few odd cells hand a reader of numbers
  const QUOTED_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

  /**
   * What a reader of numbers or dates (a scale, a transform) cannot read in a field: an error when it can read none of
   * its values, so nothing of it is drawn; a warning when it leaves some out. Missing values (null, "", NaN) are not
   * counted. Null when it reads it all.
   */
  function unreadable(reader: string, field: string, col: BC.Column | undefined, kind: BC.ScaleInput | undefined): BC.Diagnostic | null {
    // a typed column holds numbers only; a time scale given numbers that are no dates says so itself
    if (!col || typeof col !== 'object' || ArrayBuffer.isView(col) || (kind !== 'number' && kind !== 'date')) return null;
    let present = 0;
    let ok = 0;
    const odd: unknown[] = [];
    const quoted: unknown[] = [];
    for (let i = 0; i < col.length; i++) {
      const v = col[i];
      if (v === null || v === undefined || v === '' || (typeof v === 'number' && isNaN(v))) continue;
      present++;
      if (kind === 'number' ? typeof v === 'number' && isFinite(v) : isFinite(time(v))) ok++;
      else {
        // the odd ones first: "n/a" says more than "1200" does
        const list = typeof v === 'string' && QUOTED_NUMBER.test(v.trim()) ? quoted : odd;
        if (list.length < 3 && list.indexOf(v) < 0) list.push(v);
      }
    }
    if (ok === present) return null;
    const what = kind === 'number' ? 'numbers' : 'dates';
    const like = odd
      .concat(quoted)
      .slice(0, 3)
      .map((v) => {
        const s = JSON.stringify(v) || String(v);
        return s.length > 28 ? s.slice(0, 27) + '…' : s;
      })
      .join(', ');
    const how =
      kind === 'number'
        ? 'A number is written as a number: 1750.5, not "1750.5", "1,750.50", "1750,5" or "$1,750"'
        : 'A date is ISO text ("2024-03-15", "2024-03-15T09:30") or epoch milliseconds';
    return ok
      ? {
          level: 'warn',
          path: '',
          message: `${reader} reads ${what} from "${field}", and ${present - ok} of its ${present} values ${present - ok === 1 ? `is not a ${what.slice(0, -1)}, so it is` : `are not ${what}, so they are`} left out: ${like}. ${how}; where there is no value, null`,
        }
      : {
          level: 'error',
          path: '',
          message: `${reader} reads ${what} from "${field}", and it has none: its values are like ${like}, so nothing of it is drawn. ${how}; where there is no value, null`,
        };
  }

  // ───────────────────────── formatting ─────────────────────────

  const DEFAULT_LOCALE = 'en-US';
  const DATE_OPTIONS = [
    'era',
    'year',
    'month',
    'day',
    'weekday',
    'hour',
    'minute',
    'second',
    'dayPeriod',
    'fractionalSecondDigits',
    'timeZoneName',
    'dateStyle',
    'timeStyle',
    'hour12',
    'hourCycle',
  ];
  const PRESETS: Record<string, BC.FormatSpec> = {
    percent: { kind: 'number', style: 'percent', maximumFractionDigits: 1 },
    compact: { kind: 'number', notation: 'compact', maximumFractionDigits: 1 },
    integer: { kind: 'number', maximumFractionDigits: 0 },
    year: { kind: 'date', year: 'numeric' },
    quarter: { kind: 'date', year: 'numeric' },
    month: { kind: 'date', month: 'short', year: 'numeric' },
    day: { kind: 'date', month: 'short', day: 'numeric' },
    date: { kind: 'date', dateStyle: 'medium' },
    datetime: { kind: 'date', dateStyle: 'medium', timeStyle: 'short' },
  };
  const formatters = new Map<string, (value: unknown) => string>();
  /** What the chart being built or drawn asks for, while it is; undefined (the default) the rest of the time. */
  let chartLocale: string | undefined;
  const hush = () => {
    chartLocale = undefined;
  };
  const NUMBER_OPTIONS = [
    'style',
    'currency',
    'currencyDisplay',
    'currencySign',
    'unit',
    'unitDisplay',
    'notation',
    'compactDisplay',
    'signDisplay',
    'useGrouping',
    'minimumIntegerDigits',
    'minimumFractionDigits',
    'maximumFractionDigits',
    'minimumSignificantDigits',
    'maximumSignificantDigits',
    'roundingMode',
    'roundingIncrement',
    'roundingPriority',
    'trailingZeroDisplay',
    'numberingSystem',
  ];
  /** Intl has no quarters. */
  const QUARTERS: Record<string, (q: number, y: number) => string> = {
    ko: (q, y) => `${y}년 ${q}분기`,
    zh: (q, y) => `${y}年第${q}季度`,
    ja: (q, y) => `${y}年第${q}四半期`,
  };

  function formatter(spec: string | BC.FormatSpec, kind?: 'number' | 'date', chart?: string): (value: unknown) => string {
    let o: BC.FormatSpec;
    if (typeof spec === 'string') {
      if (!Object.prototype.hasOwnProperty.call(PRESETS, spec))
        throw new Error(`unknown format "${spec}" (presets: ${Object.keys(PRESETS).join(', ')}; or an object of Intl options)`);
      o = PRESETS[spec];
    } else if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
      o = spec;
    } else {
      throw new Error('a format is a preset name or an object of Intl options');
    }
    // Intl has no quarters: the preset writes the year with Intl and puts "Q1".."Q4" before it
    const quarter = o === PRESETS.quarter;
    const language = (typeof o.locale === 'string' && o.locale) || chart || chartLocale || DEFAULT_LOCALE;
    const key = (kind || '') + '|' + language + '|' + (quarter ? 'quarter' : JSON.stringify(o));
    const known = formatters.get(key);
    if (known) return known;

    const { locale, kind: declared, prefix, suffix, ...options } = o;
    if (locale !== undefined && typeof locale !== 'string') throw new Error('format "locale" must be a string like "en-US"');
    for (const [name, v] of [
      ['prefix', prefix],
      ['suffix', suffix],
    ] as const)
      if (v !== undefined && typeof v !== 'string') throw new Error(`format "${name}" must be a string`);
    if (declared !== undefined && declared !== 'number' && declared !== 'date') throw new Error('format "kind" must be "number" or "date"');
    // Intl skips what it does not know, so a misspelled option would quietly do nothing
    for (const k of Object.keys(options))
      if (
        NUMBER_OPTIONS.indexOf(k) < 0 &&
        DATE_OPTIONS.indexOf(k) < 0 &&
        k !== 'timeZone' &&
        k !== 'calendar' &&
        k !== 'era' &&
        k !== 'dayPeriod'
      )
        throw new Error(
          `format option "${k}" is not known (a preset is written as the format itself, "quarter", and the language comes from "locale" or the chart)`,
        );
    const wantDate = (kind || declared || (Object.keys(options).some((k) => DATE_OPTIONS.indexOf(k) >= 0) ? 'date' : 'number')) === 'date';
    let nf: Intl.NumberFormat | undefined;
    let df: Intl.DateTimeFormat | undefined;
    try {
      if (wantDate) df = new Intl.DateTimeFormat(language, { timeZone: 'UTC', ...options } as Intl.DateTimeFormatOptions);
      else nf = new Intl.NumberFormat(language, options as Intl.NumberFormatOptions);
    } catch (e) {
      throw new Error(`invalid format ${JSON.stringify(spec)}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const quarterIn = QUARTERS[language.split('-')[0].toLowerCase()];
    const dated = (ms: number): string => {
      if (!quarter) return (df as Intl.DateTimeFormat).format(ms);
      const d = new Date(ms);
      const q = Math.floor(d.getUTCMonth() / 3) + 1;
      return quarterIn ? quarterIn(q, d.getUTCFullYear()) : 'Q' + q + ' ' + (df as Intl.DateTimeFormat).format(ms);
    };
    const fn = (v: unknown): string => {
      if (v == null || (typeof v === 'number' && isNaN(v))) return '';
      let text: string;
      if (nf) {
        text = typeof v === 'number' && isFinite(v) ? nf.format(v) : String(v);
      } else {
        const ms = time(v);
        text = isFinite(ms) ? dated(ms) : String(v);
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
    color: colorAt,
    palette: Object.freeze(PALETTE.slice()),
    data,
    ready,
    defineFn: (name, fn) => {
      if (typeof fn !== 'function') throw new Error('BC.defineFn: ' + name + ' is not a function');
      fns.set(name, fn);
    },
    getFn: (name) => fns.get(name),
    formatter: (spec, kind) => formatter(spec, kind),
    time,
    // without CHECKS they are not there at all: a page script that calls them fails loudly instead of being told "no problems"
    needs,
    validate,
    table: (name) => lake.get(name),
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
