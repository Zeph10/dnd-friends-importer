// Smoke test: a small fake Foundry with dnd5e 6.0-shaped data, enough to drive the wizard from a file to a finished actor.
// Run with: npm test   (needs "npm install" once, for jsdom)
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><body></body>");
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.CSS = { escape: s => String(s).replace(/["\\\]\[:.]/g, "\\$&") };
Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async () => {} } }, configurable: true });

const getProperty = (o, k) => k.split(".").reduce((a, p) => (a == null ? undefined : a[p]), o);
const setProperty = (o, k, v) => { const ps = k.split("."); let a = o; for (const p of ps.slice(0, -1)) a = (a[p] ??= {}); a[ps.at(-1)] = v; return true; };
const hasProperty = (o, k) => getProperty(o, k) !== undefined;
const clone = o => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
let idn = 0; const randomID = () => "id" + String(++idn).padStart(14, "0");

class ApplicationV2 {
  constructor(o = {}) { this.options = o; this.rendered = false; }
  async render() { const el = await this._renderHTML(); this.element ??= document.createElement("div"); this._replaceHTML(el, this.element); this.rendered = true; return this; }
  close() { this.closed = true; }
}
const dialogs = [];
globalThis.foundry = { applications: { api: { ApplicationV2, DialogV2: { prompt: async o => { dialogs.push(o); return true; }, confirm: async () => true } }, instances: new Map() },
  utils: { deepClone: clone, getProperty, setProperty, hasProperty, randomID, isNewerVersion: (a, b) => a.localeCompare(b, undefined, { numeric: true }) > 0 } };
globalThis.Hooks = { once() {}, on() {} };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
globalThis.CONFIG = { DND5E: {} };
const notes = []; globalThis.ui = { notifications: { info: m => notes.push(["info", m]), warn: m => notes.push(["warn", m]), error: m => notes.push(["error", m]) } };

// dnd5e keeps advancements on live documents in a Map-based collection.
class AdvCollection extends Map { constructor(list) { super(list.map(a => [a._id, { ...a, toObject: () => clone(a) }])); } }
const docs = new Map();
function mkDoc(uuid, data) {
  const adv = data.system?.advancement || [];
  const d = { ...data, uuid, id: uuid.split(".").at(-1), _id: uuid.split(".").at(-1), system: { ...data.system, advancement: new AdvCollection(adv) },
    toObject() { const o = clone({ ...data, _id: this._id }); o.system = { ...clone(data.system), advancement: Object.fromEntries(adv.map(a => [a._id, clone(a)])) }; return o; } };
  docs.set(uuid, d); return d;
}
globalThis.fromUuid = async u => docs.get(u) || null;
const U = n => `Compendium.dnd5e.test.Item.${n}`;
const src = { rules: "2024", book: "PHB 2024" };
const feature = (n, extra = {}) => mkDoc(U(n), { name: extra.name || n, type: "feat", system: { source: src, type: { value: "class" }, description: { value: "" } }, effects: [] });
// dnd5e 6.0: advancements carry `name`, not `title`.
const hp = id => ({ _id: id, type: "HitPoints", configuration: {}, value: {} });
mkDoc(U("fighter"), { name: "Fighter", type: "class", system: { source: src, identifier: "fighter", levels: 1, hd: { denomination: "d10" }, spellcasting: { progression: "none" }, advancement: [
  hp("fhp"), { _id: "fsk", type: "Trait", name: "Skill Proficiencies", level: 1, classRestriction: "primary", configuration: { mode: "default", grants: [], choices: [{ count: 2, pool: ["skills:acr", "skills:ath", "skills:his", "skills:prc"] }] } },
  { _id: "fgr", type: "ItemGrant", name: "Class Features", level: 1, configuration: { items: [{ uuid: U("second-wind") }] } },
  { _id: "ffs", type: "ItemChoice", name: "Fighting Style", level: 1, configuration: { choices: { 1: { count: 1 } }, pool: [{ uuid: U("archery") }], restriction: { type: "feat", subtype: "fightingStyle" } } },
  { _id: "fwm", type: "Trait", name: "Weapon Mastery", level: 1, configuration: { mode: "mastery", grants: [], choices: [{ count: 1, pool: ["weapon:sim:*"] }] } }] } });
mkDoc(U("wizard"), { name: "Wizard", type: "class", system: { source: src, identifier: "wizard", levels: 1, hd: { denomination: "d6" }, spellcasting: { progression: "full", ability: "int" }, advancement: [
  hp("whp"), { _id: "wgr", type: "ItemGrant", name: "Class Features", level: 1, configuration: { items: [{ uuid: U("arcane-recovery") }] } },
  { _id: "wcs", type: "ScaleValue", name: "Cantrips", configuration: { identifier: "cantrips-known", scale: { 1: { value: 3 } } } },
  { _id: "wps", type: "ScaleValue", name: "Prepared Spells", configuration: { identifier: "max-prepared", scale: { 1: { value: 4 }, 2: { value: 5 } } } }] } });
mkDoc(U("champion"), { name: "Champion", type: "subclass", system: { source: src, identifier: "champion", classIdentifier: "fighter", advancement: [
  { _id: "cgr", type: "ItemGrant", name: "Subclass Features", level: 3, configuration: { items: [{ uuid: U("improved-critical") }] } }] } });
mkDoc(U("evoker"), { name: "Evoker", type: "subclass", system: { source: src, identifier: "evoker", classIdentifier: "wizard", advancement: [
  { _id: "egr", type: "ItemGrant", name: "Subclass Features", level: 3, configuration: { items: [{ uuid: U("evocation-savant") }] } }] } });
mkDoc(U("human"), { name: "Human", type: "race", system: { source: src, identifier: "human", advancement: [
  { _id: "hsz", type: "Size", configuration: { sizes: ["med", "sm"] } }, { _id: "hgr", type: "ItemGrant", name: "Traits", level: 0, configuration: { items: [{ uuid: U("resourceful") }] } }] } });
for (const n of ["second-wind", "arcane-recovery", "improved-critical", "evocation-savant", "resourceful"]) feature(n, { name: n.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()) });
const feat = (n, name, adv = [], extra = {}) => mkDoc(U(n), { name, type: "feat", system: { source: src, type: { value: "feat", subtype: extra.subtype || "" }, advancement: adv, description: { value: "" } }, effects: [] });
feat("archery", "Archery", [], { subtype: "fightingStyle" });
feat("skilled", "Skilled", [{ _id: "sk1", type: "Trait", name: "Skilled", level: 0, configuration: { mode: "default", grants: [], choices: [{ count: 3, pool: ["skills:*"] }] } }]);
feat("alert", "Alert", [], { subtype: "origin" }); feat("weapon-master", "Weapon Master"); feat("resilient", "Resilient");
const spell = (n, name, level) => mkDoc(U(n), { name, type: "spell", system: { source: src, level, method: "", prepared: 0 }, effects: [] });
spell("fire-bolt", "Fire Bolt", 0); spell("shield", "Shield", 1);
const item = (n, name, type, tv) => mkDoc(U(n), { name, type, system: { source: src, type: { value: tv }, quantity: 1, equipped: false, attunement: "", attuned: false }, effects: [] });
item("longsword", "Longsword", "weapon", "martialM"); item("chain-mail", "Chain Mail", "equipment", "heavy"); item("potion", "Potion of Healing", "consumable", "potion");
item("ring.one", "St. Elmo's Ring", "equipment", "ring");

const indexRows = [...docs.values()].map(d => ({ _id: d._id, uuid: d.uuid, name: d.name, type: d.type, system: d.toObject().system, flags: {} }));
class FakeItem { constructor(data, parent) { Object.assign(this, clone(data)); this.id = this._id = randomID(); this.parent = parent; this.uuid = `Actor.${parent.id}.Item.${this.id}`; this.system.advancement = Array.isArray(this.system.advancement) ? this.system.advancement : this.system.advancement || {}; }
  toObject() { const { parent, ...rest } = this; return clone(rest); } }
class Items extends Array { get(id) { return this.find(i => i.id === id); } }
class FakeActor {
  constructor(data) { Object.assign(this, clone(data)); this.id = this._id = randomID(); this.items = new Items(); this.flags ??= {}; this.system ??= {}; this.isOwner = true; this.sheet = { render: async () => {} }; this.uuid = `Actor.${this.id}`; }
  async update(u) { for (const [k, v] of Object.entries(u)) setProperty(this, k, clone(v)); return this; }
  getFlag(s, k) { return this.flags?.[s]?.[k]; } async setFlag(s, k, v) { (this.flags[s] ??= {})[k] = clone(v); } async unsetFlag(s, k) { delete this.flags?.[s]?.[k]; }
  toObject() { const { items, sheet, ...rest } = this; return { ...clone(rest), items: items.map(i => i.toObject()) }; }
  prepareData() { const lv = this.items.filter(i => i.type === "class").reduce((n, c) => n + Number(c.system.levels || 0), 0); setProperty(this, "system.attributes.hp.max", 10 * lv); setProperty(this, "system.details.level", lv); }
  async delete() { actors.contents.splice(actors.contents.indexOf(this), 1); this.deleted = true; }
}
const actors = { contents: [], get(id) { return this.contents.find(a => a.id === id); }, [Symbol.iterator]() { return this.contents[Symbol.iterator](); } };
globalThis.Actor = { implementation: { create: async d => { const a = new FakeActor(d); actors.contents.push(a); return a; } } };
globalThis.Item = { implementation: {
  createDocuments: async (arr, { parent }) => { const out = arr.map(d => new FakeItem(d, parent)); parent.items.push(...out); return out; },
  updateDocuments: async (ups, { parent }) => { for (const u of ups) { const it = parent.items.get(u._id); for (const [k, v] of Object.entries(u)) if (k !== "_id") setProperty(it, k, clone(v)); } } } };
const settings = new Map([["dnd-friends-character-importer.itemMatches", {}]]);
globalThis.game = { items: [], actors, version: "14.367", system: { id: "dnd5e", version: process.env.SYS || "6.0.6" }, i18n: { localize: x => x },
  packs: [{ visible: true, collection: "dnd5e.test", title: "Test", documentName: "Item", metadata: {}, getIndex: async () => indexRows, getDocuments: async () => [...docs.values()] }],
  modules: { get: id => (id === "dnd-friends-character-importer" ? { version: "0.21.0" } : undefined) },
  settings: { get: (m, k) => settings.get(`${m}.${k}`), set: async (m, k, v) => settings.set(`${m}.${k}`, v), register() {}, registerMenu() {} },
  user: { id: "u1", name: "GM", isGM: true, can: () => true, getFlag: () => undefined, setFlag: async () => {} }, users: { contents: [], activeGM: { isSelf: true } }, socket: { on() {}, emit() {} } };

const { __test, parseBotExport } = await import(new URL("../scripts/importer.js", import.meta.url));
const { ImportWizard, resolver } = __test;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };

const EXPORT = "{'Name': 'Caf\\xe9 Test', 'Level': 6, 'Race': 'Human (Medium)', 'Background': 'Alert', 'GP': 25, 'Stats': {'STR': 16, 'DEX': 12, 'CON': 14, 'INT': 15, 'WIS': 10, 'CHA': 8}," +
  " 'Class': {'Fighter': {'Level': 3, 'Subclass': 'Champion'}, 'Wizard': {'Level': 3, 'Subclass': 'Evoker'}}, 'Feats': ['Skilled', 'Resilient', 'Great Weapon Master']," +
  " 'Magic Items': {'St. Elmo\\'s Ring': {'Name': 'St. Elmo\\'s Ring', 'Attunement': True, 'Attuned': True, 'BUY': 1}}, 'Consumables': {'Potion of Healing': {'Buy': 3, 'Used': 1}}," +
  " 'Inventory': {'Longsword': {'BUY': 1}, 'Chain Mail': {'BUY': 1}, 'Mystery Box': {'FOUND': 1}}}";

const app = new ImportWizard(); await app.render();
await app.loadExport(EXPORT, "test.txt");
ok(app.data.Name === "Café Test", "python \\x escape decoded: " + app.data.Name);
ok(app.prepared && app.coreDocs.length === 5, "species, 2 classes, 2 subclasses matched: " + app.coreDocs.map(x => x.kind + ":" + x.doc.name).join(", "));
const defs = app.advChoiceDefs;
console.log("choice defs:", defs.map(d => `${d.sourceKind}/${d.type}/${d.title}/${d.count}`).join(" | "));
ok(defs.some(d => d.type === "fighting-style" && d.title === "Fighting Style" && d.options.length >= 10), "Fighting Style recognised from 6.0 `name`, with the full list");
ok(defs.some(d => d.type === "weapon-mastery" && d.title === "Weapon Mastery"), "Weapon Mastery titled from `name`");
ok(defs.some(d => d.sourceKind === "feat" && d.sourceName === "Skilled" && d.count === 3), "feat advancements are read from the live (Map-based) collection");
const lim = app.spellLimitsFor("Wizard"); ok(lim?.source === "class data" && lim.cantrips === 3 && lim.prepared === 5, "spell limits from the class's own scale values: " + JSON.stringify(lim));

let st = app.importStatus();
console.log("block:", st.block.map(r => r.text)); console.log("warn:", st.warn.map(r => r.text));
ok(st.block.some(r => /Resilient/.test(r.text)), "Resilient blocks the overview until its save is chosen");
ok(st.warn.some(r => /Great Weapon Master/.test(r.text) && /check the match/.test(r.text)), "low-confidence feat match is flagged on the overview");
ok(st.warn.some(r => /Mystery Box/.test(r.text)), "unmatched item flagged");
ok(app.validateChoices() !== "", "validateChoices blocks without the wizard step on screen: " + app.validateChoices());

// render every step and bind it
for (let i = 0; i <= 6; i++) { app.step = i; if (i >= 5) await app.refreshDetectedTraits(); await app.render(); }
ok(true, "all seven steps render and bind");
app.step = 0; await app.render();
ok(!!app.element.querySelector('.cbi-steps [data-goto-step="4"]'), "step bar is clickable once a file is loaded");
ok(app.element.querySelector('[data-act="create"]')?.dataset.blocked === "1" && app.element.querySelector('[data-act="create"]').disabled, "Create is blocked while choices are missing");
app.setBusy("x"); app.setBusy("");
ok(app.element.querySelector('[data-act="create"]').disabled, "Create stays disabled after a busy message clears");

// make the choices
app.skills = ["ins", "med"]; app.resilientSave = "con";
const used = new Set(['ins', 'med']); for (const d of app.advChoiceDefs) { const need = app.requiredCount(d); const pick = []; for (const o of d.options) { const k = String(o.value).split(':').pop(); if (pick.length >= need || used.has(k)) continue; used.add(k); pick.push(o.value); } app.advChoices.set(d.id, pick); }
app.matches.set("feat:Great Weapon Master", "__placeholder__");
app.spells.add(U("fire-bolt")); app.spells.add(U("shield")); app.spellClassAssignments.set(U("shield"), "Wizard"); app.spellClassAssignments.set(U("fire-bolt"), "Wizard");
await app.refreshDetectedTraits(); app.finalTraits.languages.add("elvish"); app.finalTraits.senses.darkvision = "60";
st = app.importStatus(); ok(st.block.length === 0, "no blockers left: " + JSON.stringify(st.block));
ok(app.validateChoices() === "", "choices valid: " + app.validateChoices());
app.step = 0; await app.render();
await app.createActor(null);
const actor = actors.contents[0];
ok(!!actor && !notes.some(n => n[0] === "error"), "actor created without errors " + JSON.stringify(notes.filter(n => n[0] !== "info")));
const byName = n => actor.items.find(i => i.name === n);
const origin = n => byName(n)?.flags?.dnd5e?.advancementOrigin?.split(".")[0];
const cls = n => actor.items.find(i => i.type === "class" && i.name === n)?.id, sub = n => actor.items.find(i => i.type === "subclass" && i.name === n)?.id;
ok(origin("Second Wind") === cls("Fighter"), "Second Wind grouped under Fighter");
ok(origin("Arcane Recovery") === cls("Wizard"), "Arcane Recovery grouped under Wizard (multiclass)");
ok(origin("Improved Critical") === sub("Champion") && origin("Evocation Savant") === sub("Evoker"), "subclass features grouped under their own subclass");
ok(actor.items.find(i => i.name === "Potion of Healing")?.system.quantity === 2, "mixed-case quantity keys: 3 bought, 1 used = 2");
ok(actor.items.find(i => i.name === "Mystery Box")?.flags["dnd-friends-character-importer"].placeholder === true, "placeholder is flagged");
ok(actor.system.abilities && actor.system.traits?.languages?.value.includes("elvish"), "manual language applied");
const f = actor.flags["dnd-friends-character-importer"];
ok(f.exportName === "Café Test" && typeof f.exportText === "string" && !f.rawExport, "export stored as text with its name");
ok(Array.isArray(f.choices.spellClassAssignments) && f.choices.spellClassAssignments.every(p => p.length === 2) && f.choices.format === 2, "saved choices use [key, value] pairs");
ok(f.choices.traitEdits?.added?.languages?.includes("elvish") && f.choices.traitEdits.senses.darkvision === "60", "manual trait edits saved: " + JSON.stringify(f.choices.traitEdits));
ok(actor.system.abilities?.con?.proficient === 1, "Resilient save applied");
ok(byName("Shield")?.system.sourceItem === "class:wizard" && byName("Shield")?.system.prepared === 1, "picked spell linked to its class and prepared");
console.log("items:", actor.items.map(i => `${i.type}:${i.name}`).join(", "));

// re-import: the placeholder must not be offered as a match, saved choices come back
await resolver.load(true);
ok(!resolver.entries.some(e => e.name === "Mystery Box") && !resolver.excludedEntries.some(e => e.name === "Mystery Box"), "placeholder on an actor is not indexed");
const app2 = new ImportWizard(); await app2.render(); await app2.loadExport(EXPORT, "test.txt");
ok(app2.targetActorId === actor.id, "existing character found by export name");
ok(app2.skills.join() === "ins,med" && app2.resilientSave === "con", "saved skills and Resilient restored");
ok(app2.spellClassAssignments.get(U("shield")) === "Wizard" && app2.spells.size === 2, "spell class assignments restored (UUID keys survive)");
await app2.refreshDetectedTraits();
ok(app2.finalTraits.languages.has("elvish") && app2.finalTraits.senses.darkvision === "60", "manual trait edits restored after detection");
st = app2.importStatus(); ok(st.block.length === 0, "re-import has no blockers: " + JSON.stringify(st.block.map(r => r.text)));
app2.step = 0; await app2.render(); await app2.createActor(null);
ok(!notes.some(n => n[0] === "error") && actors.contents.some(a => a.flags["dnd-friends-character-importer"]?.backupOf === actor.id), "update ran and kept a backup: " + JSON.stringify(notes.filter(n => n[0] === "error")));
ok(dialogs.some(d => /Update Summary/.test(d.window.title) && /cbi-dialog/.test(d.content)), "update summary shown");

// a saved snapshot in the old object format still loads
const old = clone(f.choices); old.spellClassAssignments = Object.fromEntries(old.spellClassAssignments); old.advChoices = Object.fromEntries(old.advChoices); old.equipment = Object.fromEntries(old.equipment); delete old.format;
actor.flags["dnd-friends-character-importer"].choices = old;
const app3 = new ImportWizard(); await app3.render(); await app3.loadExport(EXPORT, "test.txt");
ok(app3.spellClassAssignments.get(U("shield")) === "Wizard" && app3.advChoices.size > 0, "old-format saved choices still load");

// bad input
for (const [label, text, re] of [["empty file", "  ", /empty/], ["not an export", "hello world", /not a D&D Friends bot export/], ["bad level", "{'Class': {'Fighter': {'Level': 'five'}}}", /not a whole number/], ["array", "[1,2]", /not a D&D Friends/]]) {
  let msg = ""; try { parseBotExport(text); } catch (e) { msg = e.message; } ok(re.test(msg), `${label}: "${msg}"`); }
const app4 = new ImportWizard(); await app4.render(); let threw = ""; try { await app4.loadExport("{'Name':'x','Class':{}}", "x.txt"); } catch (e) { threw = e.message; }
ok(/no Class section/.test(threw) && app4.data === null, "export without classes rejected and nothing left loaded");
