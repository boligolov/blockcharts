// Loads blockcharts from separate files (a CDN, a folder of files) instead of one kit: the core, then only the blocks the
// charts on the page use. Classic script, no dependencies.
//
//   <script src="https://cdn.example/blockcharts/loader.js" data-auto></script>
//   ... <script type="application/json" data-bc-chart>{...}</script>
//
// `data-auto` loads and mounts on its own. Without it: BCLoader.load({ blocks: [...], scan, mount, base, integrity }).
(function () {
  interface Options {
    base?: string;
    blocks?: string[];
    scan?: boolean;
    mount?: boolean;
    integrity?: boolean;
  }
  interface Entry { file: string; closure: string[]; sha384?: string }
  interface Release { core: { file: string; sha384?: string }; blocks: Record<string, Entry> }

  const g = globalThis as any;
  if (g.BCLoader) return;

  const self = typeof document !== 'undefined' ? (document.currentScript as HTMLScriptElement | null) : null;
  const here = self && self.src ? self.src.replace(/[^/]*$/, '') : '';
  const loaded = new Map<string, Promise<void>>();
  const manifests = new Map<string, Promise<Release>>();

  const join = (base: string, file: string) => base.replace(/\/*$/, '/') + file;

  function script(url: string, hash: string | undefined): Promise<void> {
    const seen = loaded.get(url);
    if (seen) return seen;
    const p = new Promise<void>((resolve, reject) => {
      const el = document.createElement('script');
      el.src = url;
      if (hash) {
        el.integrity = hash;
        el.crossOrigin = 'anonymous';
      }
      el.onload = () => resolve();
      el.onerror = () => {
        loaded.delete(url); // a failed file may be tried again
        reject(new Error('blockcharts loader: cannot load ' + url));
      };
      (document.head || document.documentElement).appendChild(el);
    });
    loaded.set(url, p);
    return p;
  }

  function manifest(base: string): Promise<Release> {
    let p = manifests.get(base);
    if (!p) {
      const url = join(base, 'manifest.json');
      p = fetch(url).then((r) => {
        if (!r.ok) throw new Error(`blockcharts loader: ${url} answered ${r.status}`);
        return r.json() as Promise<Release>;
      });
      p.catch(() => manifests.delete(base));
      manifests.set(base, p);
    }
    return p;
  }

  /** Blocks the charts of the page use; a chart whose spec cannot be read is left for BC.mount to report. */
  function scanned(): string[] {
    const out: string[] = [];
    document.querySelectorAll('script[data-bc-chart]').forEach((el) => {
      try {
        for (const n of g.BC.needs(JSON.parse(el.textContent || ''))) out.push(n);
      } catch (e) {
        /* reported when the chart is mounted */
      }
    });
    return out;
  }

  async function load(options?: Options): Promise<BC.Runtime> {
    const o = options || {};
    const base = o.base !== undefined ? o.base : here;
    if (!base) throw new Error('blockcharts loader: cannot tell where the files are; pass { base: "https://.../" }');
    const release = await manifest(base);
    const sri = (h: string | undefined) => (o.integrity && h ? h : undefined);

    if (!g.BC) {
      g.BC_CONFIG = Object.assign({}, g.BC_CONFIG, { autoMount: false });
      await script(join(base, release.core.file), sri(release.core.sha384));
    }

    const wanted = new Set<string>();
    const asked = o.blocks || [];
    const unknown = asked.filter((n) => !release.blocks[n]);
    if (unknown.length) throw new Error(`blockcharts loader: no such block: ${unknown.join(', ')}`);
    for (const n of asked) wanted.add(n);
    if (o.scan !== false) for (const n of scanned()) if (release.blocks[n]) wanted.add(n);

    const files = new Set<string>();
    wanted.forEach((n) => release.blocks[n].closure.forEach((c) => files.add(c)));
    await Promise.all(Array.from(files).map((n) => script(join(base, release.blocks[n].file), sri(release.blocks[n].sha384))));

    if (o.mount !== false) g.BC.mount();
    return g.BC;
  }

  g.BCLoader = { load } as { load: typeof load; ready?: Promise<BC.Runtime> };

  if (self && self.hasAttribute('data-auto')) {
    const go = () => {
      g.BCLoader.ready = load().catch((e: Error) => {
        console.error(e.message);
        throw e;
      });
      g.BCLoader.ready.catch(() => undefined);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
  }
})();
