# D&D Friends Character Importer v0.18.1

## Install

In Foundry VTT: **Setup → Add-on Modules → Install Module**, then paste this into **Manifest URL**:

```
https://github.com/Zeph10/dnd-friends-character-importer/releases/latest/download/module.json
```

Requires Foundry VTT 14 and the dnd5e system 5.x. Maintainers: see [RELEASING.md](RELEASING.md).

Foundry VTT 14 / dnd5e 5.x character importer for the Discord character-bot export format.

## v0.4 fixes
- Resolves Plutonium relative advancement UUIDs (such as `.pJdME4q946V9OaCi`) against the source actor, allowing actor-owned Plutonium subclasses such as Circle of the Titan to grant their subclass features.
- Expands Foundry's `skills:*` advancement wildcard into all actual skills.
- Stops re-rendering the entire wizard when selecting skills or Advancement options, preventing the wizard from jumping back to the top.
- Spell selection count updates in-place and Clear no longer resets scroll.
- Forces a fresh content index when a new bot export is loaded, so newly imported/reference content can be discovered in the same Foundry session.


## v0.6.0
- Human Versatile and any other Advancement restricted to `feat/origin` now offers every indexed 2024 Origin feat, rather than only the small recommended pool embedded in the Human species document.
- Origin feat choices are deduplicated and prefer native dnd5e sources over secondary copies.

## 0.10.0 test build
- Human Versatile now uses the server's expanded Origin-style pool: Origin feats, Wild Talent feats, Dragonmarks, and Dark Gifts.
- Filters generated wrapper features such as `Lessons of the First Ones: X` and class/subclass/optional-feature documents from that pool.
- Collapses Magic Initiate variants into one `Magic Initiate` choice and asks for Cleric, Druid, or Wizard afterward.
- Diagnostics now include Plutonium `api.importer` keys and an Origin-choice preview for troubleshooting.


## v0.10.0
Human Versatile / any-Origin-feat choices now use a manual database search instead of trying to enumerate every legal Origin-style category from inconsistent content metadata. Type the desired feat name and choose the matching indexed 2024 feat document.


## v0.10.0
- Expands Fighter Weapon Mastery category pools into actual 2024 weapon choices instead of `sim`/`mar`.
- Shows each weapon's mastery property where available.
- Applies selected mastery weapon identifiers to the actor.
- Prevents choosing the same mastery weapon twice across multiple Fighter mastery advancements.
- Resolves ItemChoice labels from the indexed compendium when direct UUID loading fails, preventing raw UUID text such as Blind Fighting.


## v0.10.0
- Separates Server Origin Choices, Species Features, Class Features, Subclass Features, and Other Feats in the wizard.
- Labels advancement choices with their true owning document and advancement level.
- Review page mirrors the same source separation before actor creation.


## v0.11.0
- Fixes Fighter Weapon Mastery advancements whose pools are encoded as bare `sim` / `mar` categories by expanding them into actual indexed 2024 weapons.
- Adds a per-import 5etools/Plutonium source filter with source codes and indexed-document counts. Native dnd5e 2024 content remains always available.
- Broadens prerelease recognition to UA-era sources from 2024 through 2026.
- Improves unresolved Fighting Style labels so raw compendium UUIDs are not shown to users.


## v0.12.0
- Weapon Mastery no longer trusts `sim` / `mar` as selectable values. Those codes now determine eligibility, while choices are built from actual indexed weapons plus a PHB 2024 weapon fallback catalog.
- Fighting Style advancements no longer trust incomplete advancement pools. They dynamically enumerate indexed Fighting Style feats from enabled sources, with core 2024 styles used to fill native indexing gaps.
- Champion's additional Fighting Style uses the same resolver as the Fighter class choice.


## v0.13.0
- Normalizes `(Wild Talent)` and `(Dark Gift)` suffixes in the bot's free feat field and uses manual indexed-feat search for the server Origin choice.
- Indexes Plutonium documents with missing rules metadata so enabled homebrew/prerelease feat sources can be searched through the source filter.
- Corrects half-caster spell-level progression: Artificer/Paladin/Ranger use max spell level `ceil(caster level / 4)` (Artificer 10 => 3rd-level spells).
- Adds per-class Spellcasting Profiles: caster level, full/half/third/pact progression, casting ability, and optional max-spell-level override. Multiclass characters get one profile per class.
- Selected multiclass spells retain the chosen casting class and ability.
- Expands Ranger/Fighter Weapon Mastery wildcards to actual weapons and expands standard/exotic language buckets into actual languages.


## v0.14.0
- Honors primary vs secondary multiclass advancements, preventing duplicate/split level-1 skill choices.
- Normalizes species size suffixes and adds a 2024 species/legacy selector when multiple matches exist.
- Restricts Weapon Mastery to canonical PHB 2024 mundane weapons plus enabled Valindra Gunslinger weapons.
- Canonicalizes Fighting Style names and removes duplicate/wrapper entries.
- Adds display-only Feature Placement controls (Background, Species, Class, Subclass, Other) and rebuilds local advancement-origin metadata after import without changing mechanics.
- Initializes spell slots as full/unexpended after class construction.
- Avoids double-counting Tough in base HP.


## v0.15.0
- Human Versatile now browses all enabled 2024 standalone feats that do not contain an AbilityScoreImprovement advancement. Dragonmark ancestry restrictions are intentionally ignored for the server rule.
- Detects subclass spell tables inside granted subclass features and automatically imports eligible always-prepared spells by class level.
- Adds a Final Traits step for damage resistance/immunity/vulnerability, condition immunity, senses, languages, and tool proficiencies, with detected values preselected.
- Resilient prompts for the saving throw proficiency it grants without re-applying its +1 ability score.


## v0.16.0
- Human Versatile and server-origin feat picking no longer use a precomputed feat eligibility index. Type at least two characters to live-search every indexed 2024 feat from enabled sources.
- Search requires the full meaningful query tokens to match, preventing unrelated results for names such as `Mark of Warding`.
- Dragonmarks, Wild Talents, Dark Gifts, and other special feat families are no longer excluded by category/ASI metadata during manual search.
- Final Traits now provides explicit Standard and Exotic/Special language lists.
- Final Traits now provides the full standard dnd5e 2024 tool proficiency list.


## v0.16.1
- Renamed the module to **D&D Friends Character Importer**.
- Updated author to **ESONJ**.
- v0.16.1 retained the legacy internal ID temporarily; v0.17.1 completes the rename with the new package ID `dnd-friends-character-importer`.


## v0.17.0
- Versatile/server Origin feat search now searches Plutonium/5etools raw feat data in addition to Foundry Item indexes.
- Loads base, prerelease, and homebrew feat data from Plutonium globals when available.
- Raw-only feats such as Dragonmarks which have not previously been imported into Foundry can now appear in live search.
- Prefers Plutonium's feat converter when exposed; otherwise creates a native dnd5e feat preserving source/text instead of a placeholder.
- 5etools source filter now includes sources discovered only in raw feat data.

## v0.17.1
- Completed the package rename: internal Foundry module ID is now `dnd-friends-character-importer`.
- Application/window ID and CSS selectors now use the same new ID.
- Package folder is now `dnd-friends-character-importer`.
- This is intentionally installed as a new Foundry module rather than migrated from the legacy `character-bot-importer` package.



## v0.17.2
- Fixes incomplete UA feat search by loading modern 2024-rules prerelease sources directly from TheGiddyLimit/unearthed-arcana as a fallback when Plutonium's processed prerelease cache is incomplete.
- Loads XUA2024, XUA2025, and XUA2026 source files, including feats embedded in class/collection files such as Pyrokinesis in the 2025 Psion UA.
- Uses the generated prerelease property index as an additional feat-file discovery path.
- Adds remote UA loading status to importer diagnostics.


## v0.18.0
Spells
- Hand-picked spells are linked to their class through dnd5e 5.x `system.sourceItem` (`class:wizard`), leveled spells start prepared, and Warlock spells use the `pact` method. `system.ability` is only written when the Spellcasting Profile overrides the class ability.
- Subclass spells found in feature tables are imported as always prepared (`method: "spell"`, `prepared: 2`) with `sourceItem: "subclass:<id>"`. The legacy `preparation.mode` field was ignored by dnd5e 5.x.
- Spells granted or chosen through ItemGrant/ItemChoice advancements (domain spells, species spells, Magic Initiate) apply the advancement's spell settings: ability, method, prepared state, uses and source.
- Eldritch Knight and Arcane Trickster read spellcasting from the subclass and use the Wizard spell list.
- Spell picker: level filter, a class dropdown on every spell when class-list data is unavailable, and 2024 cantrip/prepared-spell limits per class (for example "Bard: 1/2 cantrips, 3/5 prepared"). Limits come from the matched class's own ScaleValue advancements (so homebrew classes work), falling back to a built-in 2024 PHB table covering Bard, Cleric, Druid, Sorcerer, Wizard, Warlock, Paladin, Ranger, Eldritch Knight and Arcane Trickster. Going over a limit highlights the count and warns once on Next; clicking Next again keeps the picks.

Features and choices
- Multi-level ItemChoice counts are added up (a level 5 Warlock chooses 5 invocations, not 2).
- Wildcard Trait pools (`tool:music:*`, `tool:*`, `languages:*`, `weapon:mar:*`, `saves:*`, damage types) expand into real options. A Bard can finish the wizard again.
- Trait advancement modes are honoured: Expertise, forced Expertise and Upgrade set skill/tool value 2.
- Matched feats run their own advancements (Skilled, Magic Initiate spell picks, Resilient, feats chosen through Human Versatile). Magic Initiate spell lists come from the list selector.
- The server Origin feat is selected automatically on an exact name match; Next is blocked until a feat or an explicit placeholder is chosen.
- Validation stops duplicate skill proficiencies and Expertise on skills the character is not proficient in.
- Subclasses are matched only among subclasses of their own class.
- Species advancements are read at character level (level 3/5 species features), and the Size advancement is applied using the bot's "(Small)/(Medium)" suffix.
- Features with the same name from different classes (Spellcasting, Channel Divinity, Unarmored Defense) are no longer merged.

Items, HP and traits
- Duplicate physical items are merged by adding quantities instead of dropping one.
- Armor, one shield and weapons start equipped. Attunement is only offered for items that need it.
- Low-confidence item matches (under 85%) are flagged, listed first, and shown on Review. "+1 Longsword" and "Longsword +1" spellings are both tried.
- Base ability scores are imported as-is; the bot's magic-item Stat Bonuses are only added for items that become placeholders (matched items apply their own effects).
- HP is calculated by Foundry: each class's HitPoints advancement is filled (maximum at level 1 of the starting class, average after), so Tough, Dwarven Toughness, CON changes and later level-ups all work. A Fixed HP value is still available.
- Languages use dnd5e keys from `CONFIG.DND5E.languages` (`deep`, `cant`, `sign`); senses are written to `senses.ranges.*` and to the prototype token's darkvision; unticking a detected tool removes it.
- Consumable quantities subtract used/sold counts when the export records them.

Workflow
- Loading a new export resets every per-character choice.
- A status line shows indexing/loading progress, and buttons are disabled while work is running.
- Create Actor cannot run twice, and a failed import deletes the partial actor.
- "Starting Class" replaces the per-level Multiclass Level Order dropdowns; the actor's `originalClass` is set to it.
- Review shows the matched Origin feat, placeholders by name, low-confidence matches, choices left to finish, and an Owner selector.
- Content is indexed when a GM opens the importer instead of for every user at login. The directory button reads "D&D Friends Import" and only appears for users who can create actors.
- Remote Unearthed Arcana loading from GitHub is now an opt-in world setting (off by default) and is cached for the session.
- `game.modules.get("dnd-friends-character-importer").api.diagnostics()` is now async.

## v0.18.1
- Fixes "Could not read export: (data.Feats || []) is not iterable". Exports that store `Feats` as an object keyed by feat name (with per-feat `Stat Bonuses`) now load, as do lists of names. Missing or null sections are treated as empty.
- Feat Stat Bonuses (for example Tadpole Host +1 INT) are added to the base ability scores, because feat ASI advancements are not re-applied. The Core step lists them and has an opt-out, "The exported scores already include these".
- Magic-item Stat Bonuses of type `BONUS` are now counted (previously only `MAX` and `FIXED`). `FIXED` (Belt of Giant Strength) no longer lowers a higher score.
- Species with a lineage suffix, such as "Dragonborn (Blue)", match the base species. The lineage pre-selects a matching species choice (for example a Blue Draconic Ancestry) when one exists.
- Psion (Unearthed Arcana) defaults to a full Intelligence caster when its class document does not say otherwise.
- Magic item names are trimmed ("Byeshk Greatsword ").
