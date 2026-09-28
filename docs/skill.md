# Installing the skill

The skill is the folder [`skills/blockcharts/`](../skills/blockcharts/): `SKILL.md` (what the agent reads),
`recipes/` (complete example pages), `reference/blocks.md` (every block, generated from the code) and
`runtime/` (the composer with the minified core and blocks). It is self-contained — copy the folder and you
are done. It needs Node.js 18 or later on the machine where the agent runs commands; nothing else is
installed or fetched.

Agents find skills in known folders or in an uploaded package: they read each skill's `name` and
`description` from the `SKILL.md` front matter and load the rest only when a task matches. For Claude Code
the repository is also a **plugin marketplace** (`.claude-plugin/marketplace.json`) with one plugin: this
skill.

## Claude Code

**As a plugin** (recommended — updates arrive with `/plugin marketplace update`):

```
/plugin marketplace add boligolov/blockcharts
/plugin install blockcharts@blockcharts
```

The same from a shell: `claude plugin marketplace add boligolov/blockcharts`, then
`claude plugin install blockcharts@blockcharts`. Remove it with `/plugin uninstall blockcharts@blockcharts`.
Only a person can type `/plugin` into a session; an agent asked to install the skill runs the shell form.

**As a folder** — pick one:

| scope | folder | when to use |
|---|---|---|
| personal — every project on this machine | `~/.claude/skills/blockcharts/` (Windows: `%USERPROFILE%\.claude\skills\blockcharts\`) | you want it everywhere |
| project — everyone who works on one repository | `<project>/.claude/skills/blockcharts/` | commit it so the team gets it too |

Without a checkout, unpack the package from the site (a zip with the folder `blockcharts/` inside):

```sh
# personal, macOS / Linux
curl -fsSL https://blockcharts.online/blockcharts.skill -o /tmp/blockcharts.zip
mkdir -p ~/.claude/skills && unzip -o /tmp/blockcharts.zip -d ~/.claude/skills
```

```powershell
# personal, Windows (PowerShell; Expand-Archive wants the .zip extension)
Invoke-WebRequest https://blockcharts.online/blockcharts.skill -OutFile $env:TEMP\blockcharts.zip
Expand-Archive $env:TEMP\blockcharts.zip $env:USERPROFILE\.claude\skills -Force
```

From a checkout: copy `skills/blockcharts` to one of the folders above.

Start a new session so the skill is discovered. To check, ask for a report: *"make an HTML report of these
sales by region: North 42, South 58, East 31, West 47"*. The folder name must match the `name` in the front
matter (`blockcharts`).

## Claude.ai and Claude Desktop

Download **[blockcharts.skill](https://blockcharts.online/blockcharts.skill)** and upload it under
*Settings → Capabilities → Skills* (it needs a plan with skills and code execution enabled; the wording may
differ between versions). A `.skill` file is a zip archive: the folder `blockcharts/` with `SKILL.md`
directly inside. Claude runs the composer in its sandbox and gives you the HTML file to download.

To build it from a checkout: `npm run skill` writes `dist/blockcharts.skill`.

## Other agents

Any agent that can read files and run `node` can use the folder as it is: point it at `SKILL.md`. The
workflow is the same everywhere — write `page.json`, run
`node <skill folder>/runtime/compose.js page.json report.html`, fix what the error messages name, hand over
the HTML file.
