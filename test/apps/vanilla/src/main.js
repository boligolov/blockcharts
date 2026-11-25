// No framework: the runtime itself (BC.data, BC.chart, a bc-click listener), the baseline the components are measured
// against. The smoke page, or every chart (?all): each imports its own kit.
if (new URLSearchParams(location.search).has('all')) import('./all.js');
else import('./smoke.js');
