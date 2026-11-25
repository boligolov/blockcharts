import { bootstrapApplication } from '@angular/platform-browser';
import { provideZonelessChangeDetection } from '@angular/core';
// <block-chart>: Angular sets its properties ([spec], [data]) and listens to its events ((bc-click))
import 'blockcharts/element';

// the smoke page, or every chart (?all): each imports its own kit, so a page loads only the blocks it draws with
const page = new URLSearchParams(location.search).has('all') ? import('./all') : import('./smoke');
page.then(({ App }) => bootstrapApplication(App, { providers: [provideZonelessChangeDetection()] })).catch((e) => console.error(e));
