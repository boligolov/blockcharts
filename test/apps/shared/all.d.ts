// Types of all.js, for the apps written in TypeScript (Angular).
export interface Item {
  key: string;
  spec: Record<string, unknown>;
  data: unknown;
}
export declare function loadAll(): Promise<Item[]>;
export declare const renewed: (items: Item[]) => Item[];
export declare const GRID_STYLE: string;
export declare const GRID: Record<string, string>;
