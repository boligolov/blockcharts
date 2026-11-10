(function () {
  /** The fields a transform reads must exist, and the columns it writes must not replace one of the data's own (except
   *  those in `keep`, which the new column stands for) nor each other: a silent overwrite changes what another mark
   *  reads. `reads` and `writes` pair the name of a parameter with the field it names; a read left undefined is not
   *  asked for. Throws an Error that starts with the name of the block. */
  function check(block: string, table: BC.Table, reads: [string, unknown][], writes: [string, string][], keep: unknown[]): void {
    const fail = (message: string) => {
      throw new Error(block + ': ' + message);
    };
    const has = (f: string) => Object.prototype.hasOwnProperty.call(table.columns, f);
    for (const [param, f] of reads)
      if (f !== undefined && (typeof f !== 'string' || !has(f))) fail(`unknown field "${String(f)}" in "${param}"`);
    const seen = new Map<string, string>();
    for (const [param, name] of writes) {
      if (name === '__proto__') fail(`a column cannot be named "__proto__": give "${param}" another name`);
      if (seen.has(name)) fail(`"${seen.get(name)}" and "${param}" both name the new column "${name}"`);
      seen.set(name, param);
      if (has(name) && keep.indexOf(name) < 0)
        fail(`"${name}" is already a column of the data: give the new one another name with "${param}"`);
    }
  }

  const def: BC.LibDef = {
    role: 'lib',
    type: 'columns',
    version: 2,
    doc: "The check of the columns a transform reads and writes, shared by transform.contour, transform.funnel, transform.hexbin, transform.sankey, transform.treemap and transform.waterfall. `check(block, table, reads, writes, keep)` throws when a field it reads is not in the data, or when a column it writes would replace one of the data's own (other than those in `keep`) or another new one, naming the parameter to change. A spec never names it.",
    exports: { check },
  };

  BC.define(def);
})();
