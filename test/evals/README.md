# Evals of the skill

Four everyday tasks, each given to an independent agent with the skill and to another without it. The input files are
seeded (`generate.js`), the answers are in `expected.json`, and `grade.js` opens each report in real Chrome with the
network cut. `test-grade.js` proves the grader on pages broken on purpose.

    node test/evals/generate.js
    node test/evals/grade.js <run_dir> <eval_name>
    node test/evals/test-grade.js

## 2026-11-01, skill 0.18.1

One run per task, so these are observations, not statistics. Agents with the skill were also asked to report on it, which
adds to their tokens.

| Task | Checks with | Checks without | KB with | KB without | Tokens with | Tokens without | Seconds with | Seconds without |
|---|---|---|---|---|---|---|---|---|
| sales-from-csv | 17/17 | 16/17* | 74 | 8 | 81,200 | 57,237 | 116 | 98 |
| monthly-kpis | 10/10 | 10/10 | 66 | 16 | 107,454 | 65,457 | 213 | 156 |
| four-chart-dashboard | 12/12 | 11/12* | 93 | 22 | 111,580 | 89,967 | 135 | 268 |
| dirty-numbers | 17/17 | 16/17* | 72 | 7 | 86,346 | 55,977 | 123 | 83 |

\* A false failure: the chart check counts `svg` and `canvas`, and these pages draw bars in HTML and CSS. All the charts are
there. Counted by hand, every report passes every check.

### What this run showed

- The checks do not separate the two. Every report, with or without the skill, had every figure right, worked offline and
  fit a phone. They measure whether a report is correct, and these tasks are within reach of a plain agent.
- The skill cost more here: 44% more tokens in total and pages 3 to 10 times heavier. Time was about even.
- Reading the pages, the reports without the skill were as good or better. They wrote a sentence of findings, highlighted
  the best month, showed every month on the axis and put a table under the charts.
- What the skill gave: tooltips, crosshair and legend filtering without writing them, the same look on every page, and no
  chart code to maintain. These tasks are small. The skill should matter more where hand-written code does not reach: large
  data, zoom, facets, page-long dashboards. These evals do not test that yet.

### Gaps the agents hit

Reported by the agents using the skill and not reproduced one by one yet; the list is in `ROADMAP.md`.
