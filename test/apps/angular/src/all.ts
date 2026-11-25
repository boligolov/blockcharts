import 'blockcharts/kits/full.mjs';
import { Component, CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { loadAll, renewed, GRID_STYLE } from '../../shared/all.js';
import type { Item } from '../../shared/all.js';

@Component({
  selector: 'app-root',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @if (items(); as list) {
      <main>
        <p>
          <button id="mount" (click)="shown.set(true)">Mount</button>
          <button id="update" (click)="items.set(renew(list))">Update</button>
          <button id="unmount" (click)="shown.set(false)">Unmount</button>
        </p>
        <div id="all" [style]="grid">
          @if (shown()) {
            @for (it of list; track it.key) {
              <div class="cell"><block-chart [spec]="it.spec" [data]="it.data"></block-chart></div>
            }
          }
        </div>
      </main>
    } @else {
      <p id="loading">Loading…</p>
    }
  `,
})
export class App {
  readonly items = signal<Item[] | null>(null);
  readonly shown = signal(false);
  readonly grid = GRID_STYLE;
  readonly renew = renewed;

  constructor() {
    loadAll().then((list) => this.items.set(list));
  }
}
