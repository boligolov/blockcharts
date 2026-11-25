// Types of smoke.js, for the apps written in TypeScript (Angular).
export interface Row {
  k: string;
  v: number;
}
export declare const ROWS3: Row[];
export declare const ROWS4: Row[];
export declare const SHARED: string;
export declare const SHARED_ROWS: Row[];
export declare function spec(title: string, options?: { data?: string; click?: boolean }): Record<string, unknown> & { data?: string };
export declare const picked: (name: string, detail: { values: Record<string, unknown> }) => string;
