import BC from 'blockcharts/kits/basic.mjs';
import { Component, CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { ROWS3, ROWS4, SHARED, SHARED_ROWS, spec, picked } from '../../shared/smoke.js';

// the dataset charts b and c share, given once, before they mount
BC.data(SHARED, SHARED_ROWS);

@Component({
  selector: 'app-root',
  // <block-chart> is a custom element, not an Angular component
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <main>
      <p>
        <button id="update" (click)="rows.set(ROWS4)">Update</button>
        <button id="retitle" (click)="title.set('Revenue')">Retitle</button>
        <button id="remove-b" (click)="showB.set(false)">Remove b</button>
        <button id="hide" (click)="show.set(false)">Hide</button>
        <output id="picked">{{ pick() }}</output>
      </p>
      @if (show()) {
        <div data-chart="a"><block-chart [spec]="specA()" [data]="rows()" (bc-click)="onPick('a', $event)"></block-chart></div>
        @if (showB()) {
          <div data-chart="b"><block-chart [spec]="specB" (bc-click)="onPick('b', $event)"></block-chart></div>
        }
        <div data-chart="c"><block-chart [spec]="specC" (bc-click)="onPick('c', $event)"></block-chart></div>
      }
    </main>
  `,
})
export class App {
  readonly ROWS4 = ROWS4;
  readonly rows = signal(ROWS3);
  readonly title = signal('Sales');
  readonly showB = signal(true);
  readonly show = signal(true);
  readonly pick = signal('');
  // the element adds no click interaction by itself: the spec has it
  specA = () => spec(this.title(), { click: true });
  readonly specB = spec('B', { data: SHARED, click: true });
  readonly specC = spec('C', { data: SHARED, click: true });

  onPick(name: string, event: Event): void {
    this.pick.set(picked(name, (event as CustomEvent<{ values: Record<string, unknown> }>).detail));
  }
}
