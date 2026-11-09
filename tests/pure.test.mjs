// Tests for the importer's standalone functions. Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";

// The module only touches Foundry when its classes are defined and its hooks are registered.
globalThis.foundry = { applications: { api: { ApplicationV2: class {} } }, utils: { deepClone: o => structuredClone(o) } };
globalThis.Hooks = { once() {}, on() {} };
globalThis.game = {}; globalThis.CONFIG = {};
const { __test: t } = await import(new URL("../scripts/importer.js", import.meta.url));

test("reads JSON and the bot's Python-style text", () => {
  assert.equal(t.parseBotExport('{"Name":"A","Class":{"Fighter":{"Level":2}}}').Class.Fighter.Level, 2);
  const d = t.parseBotExport("{'Name': 'B', 'Flag': True, 'Nothing': None, 'Class': {'Wizard': {'Level': 5, 'Subclass': 'Evoker'}}, 'Feats': ('Alert',),}");
  assert.equal(d.Flag, true); assert.equal(d.Nothing, null); assert.deepEqual(d.Feats, ["Alert"]);
});

test("decodes Python escapes", () => {
  const d = t.parseBotExport("{'Name': 'Caf\\xe9\\xa0Bob\\u2019s \\U0001F600 it\\'s', 'Class': {'Bard': {'Level': 1}}}");
  assert.equal(d.Name, "Café Bob’s \u{1F600} it's");
});

test("rejects files that are not exports with a readable message", () => {
  assert.throws(() => t.parseBotExport(""), /empty/);
  assert.throws(() => t.parseBotExport("hello world"), /not a D&D Friends bot export/);
  assert.throws(() => t.parseBotExport("[1, 2]"), /not a D&D Friends bot export/);
});

test("class levels must be whole numbers", () => {
  for (const bad of ["'five'", "2.5", "-1", "0", "400"]) assert.throws(() => t.parseBotExport(`{'Class': {'Fighter': {'Level': ${bad}}}}`), /not a whole number/, bad);
  assert.equal(t.parseBotExport("{'Class': {'Fighter': {'Level': '5'}}}").Class.Fighter.Level, 5);
  assert.equal(t.defaultClassOrder(t.parseBotExport("{'Class': {'Fighter': {'Level': 2}, 'Rogue': {'Level': 1}}}")).join(), "Fighter,Fighter,Rogue");
});

test("feats may be a list, an object with stat bonuses, or missing", () => {
  const d = t.parseBotExport(`{"Class":{"Psion":{"Level":1}},"Stats":{"INT":15},"Feats":{"Tadpole Host":{"Stat Bonuses":[{"Stat":"INT","Value":1,"Type":"BONUS"}]}}}`);
  assert.deepEqual(d.Feats, ["Tadpole Host"]); assert.equal(t.baseStats(d).int, 16);
  assert.deepEqual(t.parseBotExport(`{"Class":{"Psion":{"Level":1}}}`).Feats, []);
});

test("stat bonuses: BONUS adds, FIXED never lowers", () => {
  const s = { str: 20, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  t.applyStatBonus(s, { Stat: "STR", Value: 19, Type: "FIXED" }); assert.equal(s.str, 20);
  t.applyStatBonus(s, { Stat: "DEX", Value: 2, Type: "BONUS" }); assert.equal(s.dex, 12);
  t.applyStatBonus(s, { Stat: "luck", Value: 2 }); assert.equal(s.dex, 12);
});

test("quantities count keys in any letter case", () => {
  assert.equal(t.acquisitionQty({ BUY: 3, USED: 1 }), 2);
  assert.equal(t.acquisitionQty({ Buy: 3, Used: 1 }), 2);
  assert.equal(t.acquisitionQty({ buy: 1, sold: 4 }), 0);
  assert.equal(t.acquisitionQty({ Attuned: true }), 1);
  assert.equal(t.consumableQty({ Found: 2, used: 2 }), 0);
  assert.equal(t.consumableQty({ Count: 4 }), 4);
});

test("advancements are read from arrays, id-keyed objects and Map-based collections", () => {
  const a = { _id: "a1", type: "Trait", level: 1, name: "Skill Proficiencies" }, b = { _id: "b1", type: "ItemChoice", level: 5, title: "Old Title" };
  const live = new Map([["a1", { ...a, toObject: () => ({ ...a }) }], ["b1", { ...b, toObject: () => ({ ...b }) }]]);
  for (const container of [[a, b], { a1: a, b1: b }, live]) {
    const doc = { system: { advancement: container } };
    assert.equal(t.advancementList(doc).length, 2);
    assert.deepEqual(t.advancementEntries(doc, 3).map(x => x._id), ["a1"]);
  }
  assert.equal(t.advTitle(a), "Skill Proficiencies"); assert.equal(t.advTitle(b), "Old Title"); assert.equal(t.advTitle({}), "");
});

test("primary and secondary class advancements", () => {
  const doc = { system: { advancement: [{ _id: "p", level: 1, classRestriction: "primary" }, { _id: "s", level: 1, classRestriction: "secondary" }, { _id: "x", level: 1 }] } };
  assert.deepEqual(t.advancementEntries(doc, 1, true).map(x => x._id), ["p", "x"]);
  assert.deepEqual(t.advancementEntries(doc, 1, false).map(x => x._id), ["s", "x"]);
});

test("item choice counts add up across levels", () => {
  const adv = { configuration: { choices: { 1: { count: 1 }, 2: { count: 2 }, 5: { count: 2 }, 9: { count: 1 } } } };
  assert.equal(t.itemChoiceCount(adv, 5), 5);
});

test("trait grants: expertise, upgrade, mastery", () => {
  const u = {};
  t.parseTraitGrant("skills:ath", u); t.parseTraitGrant("skills:ath", u, "upgrade"); t.parseTraitGrant("skills:ste", u, "expertise");
  t.parseTraitGrant("saves:con", u); t.parseTraitGrant("weapon:mar:longsword", u, "mastery"); t.parseTraitGrant("languages:standard:elvish", u);
  assert.equal(u["system.skills.ath.value"], 2); assert.equal(u["system.skills.ste.value"], 2); assert.equal(u["system.abilities.con.proficient"], 1);
  assert.deepEqual(u["system.traits.weaponProf.mastery.value"], ["longsword"]); assert.deepEqual(u["system.traits.languages.value"], ["elvish"]);
});

test("highest spell level by progression", () => {
  const m = t.maxSpellLevelForProgression;
  assert.deepEqual([m("full", 1), m("full", 17), m("half", 1), m("half", 10), m("third", 2), m("third", 7), m("third", 19), m("pact", 9), m("none", 20)], [1, 9, 1, 3, 0, 2, 4, 5, 0]);
});

test("name matching scores", () => {
  const score = (a, b, type = "") => t.resolver.score(t.norm(a), t.norm(b), type);
  assert.equal(score("Longsword", "longsword"), 1);
  assert.ok(score("Great Weapon Master", "Weapon Master") < 0.85, "a partial feat name is never a confident match");
  assert.ok(score("Potion of Healing", "Potion of Superior Healing") < 1);
  assert.ok(score("Titan", "Circle of the Titan", "subclass") > 0.9);
  assert.equal(score("Cloak of Protection", "Ring of Protection") >= 0.52, false);
});

test("saved choices load from pairs and from the older object form", () => {
  assert.deepEqual(t.fromPairs([["Compendium.a.b.Item.c", "Wizard"], "junk", ["x"]]), [["Compendium.a.b.Item.c", "Wizard"]]);
  assert.deepEqual(t.fromPairs({ a: 1 }), [["a", 1]]); assert.deepEqual(t.fromPairs(null), []);
});

test("text helpers", () => {
  assert.equal(t.esc(`<b a="1">&'`), "&lt;b a=&quot;1&quot;&gt;&amp;&#039;");
  assert.equal(t.canonicalFeatName("Mark of Warding (Dragonmark)"), "Mark of Warding");
  assert.equal(t.speciesLineage("Dragonborn (Blue)"), "Blue"); assert.equal(t.speciesLineage("Human (Small)"), "");
});
