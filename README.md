# D&D Friends Character Importer

A Foundry VTT module that turns a D&D Friends Discord bot export into a dnd5e character, updates that character when it levels up, and exports characters to Roll20.

## Requirements

- Foundry VTT 14
- dnd5e system 5.3 or 6.0. dnd5e 6.1 moved some choices (Fighting Style, Weapon Mastery) onto the feature itself; the importer does not offer those yet.
- Optional: Plutonium, for 5etools feats, items and spell lists. DDB Importer compendiums are read too.

## Install

In Foundry VTT: **Setup → Add-on Modules → Install Module**, then paste this into **Manifest URL**:

```
https://github.com/Zeph10/dnd-friends-importer/releases/latest/download/module.json
```

## Using it

- **Import a character:** Actors sidebar → **D&D Friends Import** → choose the bot's export file, or drop it on the file box. Standard JSON and the bot's Python-style text both work. The overview lists only what needs a decision; **Create character** works straight from there. The step bar at the top opens any step.
- **Level up / re-import:** import the new export the same way. If you already imported that character, the overview picks it under **Import as → Update <name>** and fills in every choice from last time, so usually only the new level's choices are left. New levels, features, feats, spells and items are added; ability scores, gold and item quantities are updated; nothing on the sheet is removed. **Keep a backup copy first** (on by default) saves a copy before changing anything.
- **Item matches are remembered:** when anyone picks an item match by hand, every later import in the world uses it automatically. GMs can review or forget them under **Configure Settings → D&D Friends Character Importer → Remembered item matches**.
- **Something went wrong?** Click **Copy diagnostics** on the first screen and paste the text into Discord or a GitHub issue.
- **Export to Roll20:** in a character sheet's header menu, or by right-clicking the character in the Actors sidebar. It runs the same converter as the website and downloads the Roll20 JSON. The first export in a session downloads the Python runtime (about 10 MB) from jsDelivr.

## Server rules built in

- Two free skill proficiencies for every character.
- The bot's Background field is the free Origin feat; no Background document is created.
- Ability scores in the export are final, so Ability Score Improvement advancements are not applied again.
- 2024 rules for classes, subclasses, species, feats and spells. Equipment may also come from 2014 sources.

## Settings

- **Remembered item matches:** review or forget matches picked by hand.
- **Python runtime URL (Roll20 export):** where the Roll20 export downloads Pyodide from.
- **Load Unearthed Arcana feats from GitHub:** off by default.

## For maintainers

- `scripts/importer.js` is the module. `scripts/roll20-converter.js` is generated; see [RELEASING.md](RELEASING.md).
- `npm install` once, then `npm test` before a release. Tests also run on GitHub for every push.
- Version history: [CHANGELOG.md](CHANGELOG.md).

For scripts and macros: `game.modules.get("dnd-friends-character-importer").api` has `openImporter()`, `openRoll20Export(actor)`, `copyDiagnostics()` and `diagnostics()`.
