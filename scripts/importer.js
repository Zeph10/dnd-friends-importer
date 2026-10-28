const MODULE_ID = "dnd-friends-character-importer";

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const SKILLS = {
  acr:"Acrobatics", ani:"Animal Handling", arc:"Arcana", ath:"Athletics", dec:"Deception", his:"History",
  ins:"Insight", itm:"Intimidation", inv:"Investigation", med:"Medicine", nat:"Nature", prc:"Perception",
  prf:"Performance", per:"Persuasion", rel:"Religion", slt:"Sleight of Hand", ste:"Stealth", sur:"Survival"
};
const HIT_DIE = {barbarian:12, fighter:10, paladin:10, ranger:10, artificer:8, bard:8, cleric:8, druid:8, monk:8, rogue:8, warlock:8, sorcerer:6, wizard:6, psion:6};
const DAMAGE_TYPES=["acid","bludgeoning","cold","fire","force","lightning","necrotic","piercing","poison","psychic","radiant","slashing","thunder"];
const CONDITION_TYPES=["blinded","charmed","deafened","frightened","grappled","incapacitated","invisible","paralyzed","petrified","poisoned","prone","restrained","stunned","unconscious"];
const SENSE_TYPES=["darkvision","blindsight","tremorsense","truesight"];
const PHYSICAL_TYPES=new Set(["weapon","equipment","consumable","tool","loot","container","backpack"]);
const SIZE_KEYS={tiny:"tiny",small:"sm",medium:"med",large:"lg",huge:"huge",gargantuan:"grg"};
function traitKey(v=""){ return String(v??"").trim().toLowerCase(); }

function esc(s="") { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c])); }
function norm(s="") { return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(); }
function deepClone(o) { return foundry.utils.deepClone(o); }
function plutoniumSourceKey(e){ return String(e?.plutonium?.source||"").trim(); }
function sourceDisplayName(code=""){ return String(code||"").replace(/^X(?=UA)/, ""); }

class PythonLiteralParser {
  constructor(text) { this.t=text; this.i=0; }
  parse() { this.ws(); const v=this.value(); this.ws(); if(this.i!==this.t.length) throw new Error(`Unexpected text at ${this.i}`); return v; }
  ws(){ while(/\s/.test(this.t[this.i]||"")) this.i++; }
  value(){ this.ws(); const c=this.t[this.i]; if(c==="{") return this.dict(); if(c==="[") return this.list(); if(c==="(" ) return this.tuple(); if(c==="'"||c==='"') return this.str(); const rest=this.t.slice(this.i); for(const [k,v] of [["None",null],["True",true],["False",false]]) if(rest.startsWith(k)){this.i+=k.length;return v;} const m=rest.match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/); if(m){this.i+=m[0].length;return Number(m[0]);} throw new Error(`Unexpected token at ${this.i}`); }
  str(){ const q=this.t[this.i++]; let out=""; while(this.i<this.t.length){ let c=this.t[this.i++]; if(c===q) return out; if(c==="\\"){ const n=this.t[this.i++]; out += ({n:"\n",r:"\r",t:"\t",b:"\b",f:"\f",v:"\v",a:"\x07"}[n] ?? n); } else out+=c; } throw new Error("Unterminated string"); }
  dict(){ const o={}; this.i++; this.ws(); if(this.t[this.i]==="}"){this.i++;return o;} while(true){ const k=this.value(); this.ws(); if(this.t[this.i++]!==":") throw new Error("Expected :"); o[String(k)]=this.value(); this.ws(); if(this.t[this.i]===","){this.i++;this.ws(); if(this.t[this.i]==="}"){this.i++;return o;} continue;} if(this.t[this.i]!=="}") throw new Error("Expected }"); this.i++; return o; } }
  list(){ return this.seq("[","]"); }
  tuple(){ return this.seq("(",")"); }
  seq(open,close){ const a=[]; this.i++; this.ws(); if(this.t[this.i]===close){this.i++;return a;} while(true){a.push(this.value());this.ws();if(this.t[this.i]===","){this.i++;this.ws();if(this.t[this.i]===close){this.i++;return a;}continue;}if(this.t[this.i]!==close) throw new Error(`Expected ${close}`);this.i++;return a;} }
}

function parseBotExport(text){
  let data;
  try { data=JSON.parse(text); } catch (_) { data=new PythonLiteralParser(text.replace(/^\uFEFF/,"")).parse(); }
  return normalizeBotExport(data);
}
/**
 * Bring the bot's export variations into one shape:
 * - Feats may be a list of names or an object keyed by feat name ({"Tadpole Host": {"Stat Bonuses": [...]}}).
 * - Stat Bonuses may sit on feats as well as magic items.
 * - Section values may be missing or null.
 */
function normalizeBotExport(data){
  if(!data||typeof data!=="object") return data;
  const featBonuses=[];
  const feats=data.Feats;
  if(Array.isArray(feats)) data.Feats=feats.map(f=>typeof f==="string"?f:(f?.Name||f?.name||"")).filter(Boolean);
  else if(feats&&typeof feats==="object"){
    data.Feats=Object.entries(feats).map(([name,v])=>{ for(const b of (v?.["Stat Bonuses"]||[])) featBonuses.push({...b,source:name}); return String(v?.Name||name).trim(); }).filter(Boolean);
  }
  else data.Feats=typeof feats==="string"&&feats.trim()?[feats.trim()]:[];
  for(const k of ["Class","Magic Items","Consumables","Inventory","Stats"]) if(!data[k]||typeof data[k]!=="object") data[k]={};
  for(const v of Object.values(data["Magic Items"])) if(v&&typeof v.Name==="string") v.Name=v.Name.trim();
  Object.defineProperty(data,"__featStatBonuses",{value:featBonuses,enumerable:false,writable:true});
  return data;
}

function canonicalFeatName(name=""){
  let s=String(name).trim().replace(/\s*\(Origin\)\s*$/i, "").trim();
  // Server export labels sometimes carry a category suffix which is not part of the 5eTools feat name.
  s=s.replace(/\s*\((?:Dragonmark|Wild Talent|Dark Gift)\)\s*$/i, "").trim();
  return s;
}
function getOriginFeat(data){ return canonicalFeatName(data.Background||""); }
function normalizeSpeciesName(name=""){ return String(name).trim().replace(/\s*\([^)]*\)\s*$/,"").trim(); }
/** Lineage/ancestry written in the species name, e.g. "Dragonborn (Blue)" -> "Blue". Sizes are not lineages. */
function speciesLineage(name=""){ const m=/\(([^)]*)\)\s*$/.exec(String(name)); const v=m?.[1]?.trim()||""; return /^(tiny|small|medium|large|huge|gargantuan)$/i.test(v)?"":v; }
function placementKindFromSource(kind=""){ return ({race:"species",class:"class",subclass:"subclass"})[kind]||"other"; }
const FEATURE_PLACEMENTS=["background","species","class","subclass","other"];
function placementLabel(k){ return ({background:"Background",species:"Species",class:"Class",subclass:"Subclass",other:"Other"})[k]||"Other"; }
function featurePlacementKey(prefix,name){ return `${prefix}:${norm(name)}`; }
function spellScrollInnerName(name="") { const m=/^Spell\s+Scroll\s*\((.+)\)\s*$/i.exec(String(name).trim()); return m?.[1]?.trim()||""; }
const QTY_GAIN=["BUY","CREATE","REWARD","FOUND","GAIN","LOOT"], QTY_LOSS=["USED","USE","SOLD","SELL","LOST","CONSUMED","SPENT","GIVEN"];
function acquisitionQty(v={}) { const up=k=>Number(v?.[k])||0; const keys=Object.keys(v||{}).map(k=>k.toUpperCase()); const gain=QTY_GAIN.reduce((n,k)=>n+up(k),0); if(!gain) return 1; const loss=QTY_LOSS.reduce((n,k)=>n+up(k),0); return keys.some(k=>QTY_LOSS.includes(k))?Math.max(0,gain-loss):gain; }
function consumableQty(v={}) { const keys=Object.keys(v||{}).map(k=>k.toUpperCase()); if(keys.some(k=>QTY_GAIN.includes(k)||QTY_LOSS.includes(k))) return acquisitionQty(v); return Object.values(v||{}).filter(x=>typeof x==="number").reduce((a,b)=>a+b,0)||1; }
function uniqueFeatNames(data){
  const out=[]; const seen=new Set();
  for(const raw of [getOriginFeat(data), ...(data.Feats||[])]){
    const name=canonicalFeatName(raw); const k=norm(name); if(!name||seen.has(k)) continue; seen.add(k); out.push(name);
  }
  return out;
}

function applyStatBonus(s,b){
  const a=String(b?.Stat||"").toLowerCase(); if(!ABILITIES.includes(a)) return;
  const v=Number(b?.Value||0), t=String(b?.Type||"BONUS").toUpperCase();
  if(t==="FIXED"||t==="SET") s[a]=Math.max(s[a],v); else s[a]+=v;  // BONUS, MAX and unknown types add
}
/** Exported scores plus feat Stat Bonuses (the importer skips feat ASI advancements, so the bonus is applied here). */
function baseStats(data){
  const s={}; for(const a of ABILITIES) s[a]=Number(data.Stats?.[a.toUpperCase()] ?? 10);
  if(!data.__featBonusesInStats) for(const b of (data.__featStatBonuses||[])) applyStatBonus(s,b);
  return s;
}
function rawStats(data){ const s={}; for(const a of ABILITIES) s[a]=Number(data.Stats?.[a.toUpperCase()] ?? 10); return s; }
/** Scores including the bot's magic-item Stat Bonuses. `include(key)` limits which items count (default: all). */
function effectiveStats(data, include=()=>true){
  const s=baseStats(data);
  for(const [key,item] of Object.entries(data["Magic Items"]||{})) if(include(key)) for(const b of (item["Stat Bonuses"]||[])) {
    applyStatBonus(s,b);
  }
  return s;
}

function defaultClassOrder(data){ return Object.entries(data.Class||{}).flatMap(([name,c]) => Array(Number(c.Level||0)).fill(name)); }
function averageHp(data, order=defaultClassOrder(data), overrideCon=null, dice={}){
  const stats=effectiveStats(data); const con=overrideCon ?? stats.con; const mod=Math.floor((con-10)/2);
  let hp=0; order.forEach((cls,idx)=>{ const die=dice[norm(cls)]||HIT_DIE[norm(cls)]||8; hp += (idx===0 ? die : Math.floor(die/2)+1) + mod; });
  // The server export includes Tough as a feat, but not its HP contribution in Stats.
  if(uniqueFeatNames(data).some(x=>norm(x)==="tough")) hp += 2*Number(data.Level||order.length||0);
  return Math.max(1,hp);
}

// Extra compendium index fields for Item packs. Foundry remembers every field ever requested from a pack for the rest of
// the session and re-applies all of them on later index reads, including other modules' and the sidebar's. A nested
// request below a property that another request returns whole throws for any entry where that property is not an
// object (dnd5e indexes "system.source" whole, so "system.source.rules" breaks on an entry whose source is a number).
// Fields therefore use exactly the shape dnd5e itself uses: "system.source" whole, "system.type.*" nested.
const INDEX_FIELDS=["system.advancement","system.source","system.identifier","system.level","system.type.value","system.type.subtype","system.type.baseItem","system.mastery","system.requirements","system.classIdentifier","flags.plutonium.spellClassNames","flags.plutonium.page","flags.plutonium.source","flags.plutonium.hash"];
class ContentResolver {
  constructor(){ this.entries=[]; this.excludedEntries=[]; this.packDiscoveries=[]; this.loaded=false; this.enabledPlutoniumSources=null; }
  /** One shared load per session; `force` re-reads everything (the "Refresh content" button). */
  async load(force=false){
    if(this.loaded&&!force) return;
    if(this._loading&&!force) return this._loading;
    this._loading=this._load(force).finally(()=>{ this._loading=null; });
    return this._loading;
  }
  async _load(force=false){
    if(force){this.entries=[];this.excludedEntries=[];this.packDiscoveries=[];this.loaded=false;}
    const add=(d,uuid,ctx={})=>{ const e=this.entry(d,uuid,ctx); (this.is2024(d,e)?this.entries:this.excludedEntries).push(e); return e; };
    for(const item of game.items) add(item,item.uuid,{location:"World Items"});
    // Re-use high-quality documents already embedded on actors as templates.
    for(const actor of game.actors) for(const item of actor.items) add(item,item.uuid,{location:`Actor: ${actor.name}`});

    // Scan every compendium, not just packs whose metadata advertises documentName === "Item".
    // DDB Importer and some other modules can organize imported subclasses in packs/folders whose
    // metadata is inconsistent even though the contained documents are usable Item documents.
    const packs=[...game.packs].filter(p=>p.visible!==false);  // players cannot read packs hidden from them
    this.packCount=packs.length;
    const readPack=async pack=>{
      const ctx={
        packCollection:pack.collection||pack.metadata?.id||"",
        packTitle:pack.title||pack.metadata?.label||pack.metadata?.name||pack.collection||"",
        packFolder:pack.folder?.name||pack.metadata?.folder?.name||"",
        packDocumentName:pack.documentName||pack.metadata?.type||"",
        location:`Compendium: ${pack.title||pack.metadata?.label||pack.collection||"Unknown"}`
      };
      // The index (a handful of fields per entry) is enough for matching and is far faster than
      // pack.getDocuments(), which loads every document of every compendium. Full documents are only
      // read for a pack whose index cannot be read.
      // Only Item packs get extra fields; other packs (actors, journals, scenes…) are read with Foundry's default index.
      const itemPack=ctx.packDocumentName==="Item";
      let docs=null;
      try { docs=[...(await (itemPack?pack.getIndex({fields:INDEX_FIELDS}):pack.getIndex()))]; }
      catch(indexErr){
        if(!itemPack){ console.warn(`${MODULE_ID} could not read the index of ${pack.collection}`,indexErr); return; }
        try { docs=await pack.getDocuments(); }
        catch(fullErr){ console.warn(`${MODULE_ID} could not read ${pack.collection}`,{indexErr,fullErr}); return; }
      }
      for(const d of docs||[]){
        const uuid=d.uuid||`Compendium.${pack.collection}.${d.id||d._id}`;
        const rawType=String(d.type||"");
        const docName=String(d.documentName||ctx.packDocumentName||"");
        const discovery={name:d.name||"",rawType,documentName:docName,uuid,...ctx};
        this.packDiscoveries.push(discovery);
        // Only index genuinely item-like records for character construction. A pack may advertise
        // the wrong type, so prefer the document itself when available.
        const itemLike = docName==="Item" || ctx.packDocumentName==="Item" || ["class","subclass","feat","spell","race","species","equipment","weapon","consumable","tool","loot","container","backpack"].includes(rawType);
        if(itemLike) add(d,uuid,ctx);
      }
    };
    for(let i=0;i<packs.length;i+=8) await Promise.all(packs.slice(i,i+8).map(p=>readPack(p).catch(e=>console.warn(`${MODULE_ID} could not index ${p.collection}`,e))));
    this.loaded=true;
  }
  inferType(d,ctx={}){
    const raw=String(d.type||"").toLowerCase();
    if(raw==="subclass") return "subclass";
    const context=norm(`${ctx.packTitle||""} ${ctx.packFolder||""} ${ctx.packCollection||""}`);
    // DDB Importer compendiums are often explicitly named/foldered "Subclasses". If an entry in
    // such a pack is stored as class/feat because of importer-version metadata differences, treat
    // it as a subclass for matching while preserving rawType for diagnostics.
    if(/\bsubclasses?\b/.test(context) && ["class","feat","subclass"].includes(raw)){
      const sys=d.system||{};
      // A document that names a parent class is a subclass wherever it is stored.
      if(sys.classIdentifier) return "subclass";
      // A real class stays a class even inside a pack named "Subclasses" (for example a UA Psion kept in
      // "DDB Subclasses"). Hit die and levels are model defaults on every class-type document, so only a
      // HitPoints advancement, which subclasses never have, marks a genuine class. bestClass() also falls
      // back to an exact-name match on raw type "class" for anything this misses.
      const adv=sys.advancement?(Array.isArray(sys.advancement)?sys.advancement:Object.values(sys.advancement)):[];
      if(raw==="class" && adv.some(a=>a?.type==="HitPoints")) return "class";
      return "subclass";
    }
    return raw;
  }
  entry(d,uuid,ctx={}){
    return {name:d.name,type:this.inferType(d,ctx),rawType:String(d.type||""),uuid,source:d.system?.source||{},identifier:d.system?.identifier||"",requirements:d.system?.requirements||"",level:d.system?.level,featType:d.system?.type?.value||"",featSubtype:d.system?.type?.subtype||"",itemTypeValue:d.system?.type?.value||"",itemBaseItem:d.system?.type?.baseItem||"",mastery:d.system?.mastery||"",classIdentifier:d.system?.classIdentifier||"",spellClasses:d.flags?.plutonium?.spellClassNames||[],plutonium:d.flags?.plutonium||{},packCollection:ctx.packCollection||"",packTitle:ctx.packTitle||"",packFolder:ctx.packFolder||"",packDocumentName:ctx.packDocumentName||"",location:ctx.location||""};
  }
  is2024(d,e=null){
    const rules=String(d.system?.source?.rules||"").trim(); const book=String(d.system?.source?.book||"").trim(); const ps=String(d.flags?.plutonium?.source||"").trim();
    const sourceText=`${book} ${ps} ${e?.packTitle||""} ${e?.packFolder||""}`;
    // UA/prerelease metadata is inconsistent across importers. Recognize both compact source codes
    // and human-readable labels such as "Unearthed Arcana" / "Playtest" before consulting rules.
    if(/unearthed\s+arcana|\bplaytest\b|\bprerelease\b|(?:^|[^A-Z0-9])X?UA(?:[^A-Z0-9]|$|20\d{2}|2\d)/i.test(sourceText) || /^X?UA/i.test(ps)) return true;
    if(/XPHB|XDMG|PHB\s*2024|DMG\s*2024|2024/i.test(sourceText)) return true;
    if(rules) return /2024/i.test(rules);
    if(/^(PHB|DMG|MM|XGE|TCE|SCAG|VGM|MTF|ERLW|EGW|VRGR|FTD|MPMM)$/i.test(ps)) return false;
    if(ps) return true;
    // Imported custom/UA subclass packs may omit all source metadata. If the pack itself identifies
    // the content as subclasses, keep it available; source filtering still applies when a source exists.
    if(e && ["subclass","class"].includes(e.type) && /\bsubclasses?\b/.test(norm(`${e.packTitle} ${e.packFolder}`))) return true;
    return false;
  }
  diagnostic(name,types=[]){
    const n=norm(name);
    const scoreRows=rows=>rows.filter(e=>!types.length||types.includes(e.type)).map(e=>({...e,score:this.score(n,norm(e.name),e.type)})).filter(e=>e.score>=0.52).sort((a,b)=>b.score-a.score);
    const eligible=scoreRows(this.entries);
    const disabled=eligible.filter(e=>!this.allowed(e));
    if(disabled.length){const src=[...new Set(disabled.map(e=>plutoniumSourceKey(e)).filter(Boolean))];return `found, but disabled source${src.length===1?'':'s'}: ${src.join(', ')}`;}
    const excluded=scoreRows(this.excludedEntries);
    if(excluded.length){const src=[...new Set(excluded.map(e=>plutoniumSourceKey(e)||e.source?.book||e.packTitle||'unknown').filter(Boolean))];return `found, but excluded by rules metadata (${src.join(', ')})`;}
    // Last-resort diagnostic: show close name matches even when their stored document/type metadata
    // prevented normal indexing. This is especially useful with DDB Importer compendium packs.
    const raw=this.packDiscoveries.map(e=>({...e,score:this.score(n,norm(e.name),String(e.rawType||""))})).filter(e=>e.score>=0.52).sort((a,b)=>b.score-a.score);
    if(raw.length){ const e=raw[0]; const where=[e.packFolder,e.packTitle].filter(Boolean).join(" / ")||e.packCollection||"compendium"; return `found in ${where}, but stored as ${e.documentName||'unknown document'} / ${e.rawType||'unknown type'}`; }
    return `not indexed in world items or compendium packs`;
  }
  setEnabledPlutoniumSources(set){ this.enabledPlutoniumSources=set===null?null:new Set(set||[]); }
  allowed(e){ const ps=plutoniumSourceKey(e); return !ps || this.enabledPlutoniumSources===null || this.enabledPlutoniumSources.has(ps); }
  plutoniumSources(){ const counts=new Map(); for(const e of this.entries){ const ps=plutoniumSourceKey(e); if(ps)counts.set(ps,(counts.get(ps)||0)+1); } return [...counts.entries()].map(([code,count])=>({code,count})).sort((a,b)=>a.code.localeCompare(b.code)); }
  priority(e){ if(String(e.uuid).startsWith("Compendium.dnd5e."))return 30; if(String(e.uuid).startsWith("Compendium."))return 20; if(String(e.uuid).startsWith("Actor."))return 15; return 10; }
  candidates(name, types=[]){
    const n=norm(name); const pool=this.entries.filter(e=>this.allowed(e)).filter(e=>!types.length||types.includes(e.type));
    const scored=pool.map(e=>({...e,score:this.score(n,norm(e.name),e.type)})).filter(e=>e.score>=0.52)
      .sort((a,b)=>(b.score-a.score)||(this.priority(b)-this.priority(a)));
    const out=[], seen=new Set();
    for(const e of scored){ const k=`${e.type}:${norm(e.name)}`; if(seen.has(k))continue; seen.add(k); out.push(e); if(out.length>=8)break; }
    return out;
  }
  score(a,b,type=""){
    if(a===b) return 1; if(!a||!b) return 0;
    const A=a.split(" "), B=b.split(" ");
    if(type==="subclass" && A.length<=2 && A.every(x=>B.includes(x))) return .97;
    if(a.includes(b)||b.includes(a)) return Math.min(a.length,b.length)/Math.max(a.length,b.length)*.93;
    const AS=new Set(A),BS=new Set(B); const inter=[...AS].filter(x=>BS.has(x)).length; const union=new Set([...AS,...BS]).size; return union?inter/union:0;
  }
  best(name,types=[]){ return this.candidates(name,types)[0]||null; }
  /**
   * Item matches including content the 2024 filter excluded. Most magic items (Xanathar's, Eberron, 2014 DMG)
   * were never reprinted, so equipment may come from 2014 sources; a 2024 version wins when both exist.
   */
  itemCandidates(name,types=[]){
    const n=norm(name);
    const rows=[...this.entries.filter(e=>this.allowed(e)).map(e=>({...e,legacy:false})),...this.excludedEntries.map(e=>({...e,legacy:true}))]
      .filter(e=>!types.length||types.includes(e.type)).map(e=>({...e,score:this.score(n,norm(e.name),e.type)})).filter(e=>e.score>=0.52)
      .sort((a,b)=>(b.score-a.score)||((a.legacy?1:0)-(b.legacy?1:0))||(this.priority(b)-this.priority(a)));
    const out=[],seen=new Set(); for(const e of rows){ const k=`${e.type}:${norm(e.name)}`; if(seen.has(k)) continue; seen.add(k); out.push(e); if(out.length>=8) break; }
    return out;
  }
  /** Class match; if none, an exact-name document whose raw type is "class" (e.g. re-labelled by pack heuristics). */
  bestClass(name){
    const hit=this.best(name,["class"]); if(hit) return hit;
    const n=norm(name); const rows=this.entries.filter(e=>this.allowed(e)&&String(e.rawType||"").toLowerCase()==="class"&&norm(e.name)===n).sort((a,b)=>this.priority(b)-this.priority(a));
    return rows[0]?{...rows[0],type:"class",score:1}:null;
  }
  bestSubclass(name,classIdentifier=""){
    const cs=this.candidates(name,["subclass"]); const id=norm(classIdentifier); if(!id) return cs[0]||null;
    return cs.find(e=>norm(e.classIdentifier)===id)||cs.find(e=>!e.classIdentifier)||null;
  }
}

async function getDoc(uuid){ if(!uuid) return null; try{return await fromUuid(uuid);}catch(_){return null;} }
function advancementEntries(doc, level=99, isPrimary=true){
  const raw=doc?.system?.advancement;
  if(!raw) return [];
  let adv=[];
  try {
    if(Array.isArray(raw)) adv=raw;
    else if(typeof raw.values==="function") adv=[...raw.values()];
    else if(typeof raw[Symbol.iterator]==="function" && typeof raw!=="string") adv=[...raw].map(x=>Array.isArray(x)&&x.length===2?x[1]:x);
    else adv=Object.values(raw);
  } catch(_) { adv=Object.values(raw||{}); }
  adv=adv.map(a=>a?.toObject?.()||a).filter(Boolean);
  return adv.filter(a=>{
    if(Number(a.level||0)>level) return false;
    const r=norm(a.classRestriction||"");
    if(!r) return true;
    if(r==="primary") return !!isPrimary;
    if(r==="secondary") return !isPrimary;
    return true;
  });
}
function traitLabel(code){
  const parts=String(code).split(":"); const kind=parts[0]; const id=parts.at(-1);
  if(kind==="skills") return SKILLS[id]||id;
  if(kind==="saves") return `${ABILITY_LABELS[id]||id?.toUpperCase()} Saving Throw`;
  if(kind==="languages") return languageLabel(id);
  if(kind==="tool") return toolLabel(id);
  if(kind==="armor") return ARMOR_LABELS[id]||id;
  if(kind==="weapon"){ if(id==="sim")return "Simple Weapons"; if(id==="mar")return "Martial Weapons"; const w=[...PHB24_WEAPONS.simple,...PHB24_WEAPONS.martial].find(([,x])=>x===id); return w?.[0]||id; }
  if(/weapon.*master/i.test(kind)){ const w=[...PHB24_WEAPONS.simple,...PHB24_WEAPONS.martial].find(([,x])=>x===id); return w?.[0]||id; }
  if(["dr","di","dv","ci"].includes(kind)) return String(id).replace(/\b\w/g,c=>c.toUpperCase());
  return id||code;
}
function originChoiceCanonicalName(name=""){
  const s=String(name).trim();
  if(/^Magic\s+Initiate(?:\s*[;(].*)?$/i.test(s)) return "Magic Initiate";
  return s;
}
function isOriginStyleChoice(e){
  if(e?.type!=="feat") return false;
  const name=String(e.name||"");
  const n=norm(name);
  const subtype=norm(e.featSubtype||"");
  const featType=norm(e.featType||"");
  const page=norm(e.plutonium?.page||"");
  const req=norm(e.requirements||"");
  const source=norm(e.plutonium?.source||e.source?.book||"");
  const uuid=String(e.uuid||"");

  // Generated class/optional-feature wrappers can inherit an Origin subtype from the feat
  // they grant. They are not legal Versatile choices themselves.
  if(/^lessons of the first ones\s*:/i.test(name)) return false;
  if(/^(eldritch invocation|pact boon|fighting style|primal order|elemental fury)\s*:/i.test(name)) return false;
  if(/classfeature|subclassfeature|optionalfeatures|optionalfeature/.test(page)) return false;

  // Native PHB 2024 Origin feats.
  if(uuid.startsWith("Compendium.dnd5e.feats24.") && subtype==="origin") return true;

  // Standalone feat-page entries explicitly typed as one of the server-allowed Origin-style
  // categories. 5etools/Plutonium versions are not fully consistent about subtype spelling.
  const categoryText=`${subtype} ${featType} ${req}`;
  if(/\borigin\b/.test(categoryText) && (!page || /feats?/.test(page))) return true;
  if(/wild\s*talent/.test(categoryText) && (!page || /feats?/.test(page))) return true;
  if(/dark\s*gift/.test(categoryText) && (!page || /feats?|char.*option/.test(page))) return true;
  if(/dragonmark/.test(categoryText) && (!page || /feats?/.test(page))) return true;

  // Dragonmark feat names are stable even when older/homebrew metadata omits a category.
  if((/\bmark of\b/.test(n) || /dragonmark/.test(n)) && (!page || /feats?/.test(page))) return true;

  // Some 2024 homebrew/prerelease feat documents use a standalone feats page but omit a
  // subtype. Only admit these when their requirements explicitly identify an allowed category.
  if(/feats?/.test(page) && /(origin|wild talent|dark gift|dragonmark)/.test(`${req} ${source}`)) return true;
  return false;
}
function preferredOriginChoice(a,b){
  // Prefer native dnd5e, then standalone Plutonium feat-page entries, then other compendiums,
  // and only then actor/world templates.
  const rank=e=>{
    if(String(e.uuid).startsWith("Compendium.dnd5e.")) return 50;
    if(/feats?/.test(norm(e.plutonium?.page||""))) return 40;
    return resolver.priority(e);
  };
  return rank(b)-rank(a);
}
function docAdvancements(doc){
  const raw=doc?.system?.advancement;if(!raw)return[];try{if(Array.isArray(raw))return raw.map(x=>x?.toObject?.()||x);if(typeof raw.values==="function")return [...raw.values()].map(x=>x?.toObject?.()||x);return Object.values(raw).map(x=>x?.toObject?.()||x);}catch(_){return[];}
}
function featHasAbilityIncrease(doc){return docAdvancements(doc).some(a=>a?.type==="AbilityScoreImprovement"&&Number(a?.configuration?.points||0)>0);}
function isStandaloneFeatEntry(e){if(e?.type!=="feat")return false;const page=norm(e.plutonium?.page||""),type=norm(e.featType||"");if(/classfeature|subclassfeature|optionalfeature|racefeature|backgroundfeature/.test(page))return false;if(["class","race","background"].includes(type))return false;if(/^lessons of the first ones\s*:/i.test(String(e.name||"")))return false;return true;}
function spellRefsFromHtml(html="",level=99){const out=[];try{const box=document.createElement("div");box.innerHTML=String(html||"");const rows=[...box.querySelectorAll("tr")];for(const row of rows){const cells=[...row.querySelectorAll("td,th")];if(cells.length<2)continue;const req=Number(String(cells[0].textContent||"").match(/\d+/)?.[0]);if(Number.isFinite(req)&&req>level)continue;const src=cells.slice(1).map(c=>c.innerHTML).join(" ");for(const m of src.matchAll(/@spell\[([^\]|]+)(?:\|([^\]]+))?\]/gi))out.push({name:m[1].trim(),source:(m[2]||"").trim(),level:req||0});}if(out.length)return out;if(/always\s+(?:have|prepared)|spells?\s+table/i.test(box.textContent||""))for(const m of String(html).matchAll(/@spell\[([^\]|]+)(?:\|([^\]]+))?\]/gi))out.push({name:m[1].trim(),source:(m[2]||"").trim(),level:0});}catch(_){}return out;}
function effectObjects(doc){const raw=doc?.effects||[];try{return Array.isArray(raw)?raw.map(x=>x?.toObject?.()||x):[...raw].map(x=>x?.toObject?.()||x);}catch(_){return[];}}
function splitTraitValues(v){if(Array.isArray(v))return v.map(String);const s=String(v??"").trim();if(!s)return[];try{const j=JSON.parse(s);if(Array.isArray(j))return j.map(String);}catch(_){}return s.split(/[;,|]/).map(x=>x.trim()).filter(Boolean);}
function configOptions(obj,fallback=[]){try{return Object.entries(obj||{}).map(([value,v])=>({value,label:game.i18n.localize(v?.label||v)||value})).sort((a,b)=>a.label.localeCompare(b.label));}catch(_){return fallback;}}
async function resolveChoicePool(adv){
  const cfg=adv?.configuration||{};
  const restriction=cfg.restriction||{};

  // On this server, Human Versatile accepts every available 2024 Origin-style choice:
  // standard Origin feats, Wild Talent feats, Dragonmarks, and Dark Gifts.
  if(restriction.type==="feat" && restriction.subtype==="origin"){
    const candidates=resolver.entries.filter(e=>resolver.allowed(e)).filter(isOriginStyleChoice).sort(preferredOriginChoice);
    const byName=new Map();
    for(const e of candidates){
      const label=originChoiceCanonicalName(e.name); const k=norm(label); if(!k) continue;
      if(!byName.has(k)) byName.set(k,{uuid:e.uuid,name:label,rawName:e.name});
      else if(label==="Magic Initiate" && norm(e.name)==="magic initiate") byName.set(k,{uuid:e.uuid,name:label,rawName:e.name});
    }
    const out=[...byName.values()].sort((a,b)=>String(a.name).localeCompare(String(b.name)));
    if(out.length) return out;
  }

  const pool=cfg.pool||[]; const out=[];
  for(const raw of pool){
    const uuid=typeof raw==="string"?raw:raw?.uuid; if(!uuid) continue;
    const d=await getDoc(uuid); const idx=resolver.entries.find(e=>e.uuid===uuid); out.push({uuid,name:d?.name||idx?.name||uuidLabelFallback(uuid)});
  }
  return out;
}

// Fallback lists use dnd5e's own language keys (CONFIG.DND5E.languages is preferred at runtime).
const STANDARD_LANGUAGES = [["Common","common"],["Common Sign Language","sign"],["Draconic","draconic"],["Dwarvish","dwarvish"],["Elvish","elvish"],["Giant","giant"],["Gnomish","gnomish"],["Goblin","goblin"],["Halfling","halfling"],["Orc","orc"]];
const EXOTIC_LANGUAGES = [["Abyssal","abyssal"],["Celestial","celestial"],["Deep Speech","deep"],["Infernal","infernal"],["Primordial","primordial"],["Sylvan","sylvan"],["Undercommon","undercommon"]];
const SPECIAL_LANGUAGES = [["Druidic","druidic"],["Thieves' Cant","cant"]];
function configLanguageGroups(){
  // Returns {standard:[[label,key]],exotic:[...],special:[...]} from CONFIG.DND5E.languages, or the fallback lists.
  try{
    const cfg=CONFIG?.DND5E?.languages; if(!cfg||!Object.keys(cfg).length) throw new Error("no config");
    const label=v=>game.i18n.localize(v?.label||v)||"";
    const flat=(obj)=>Object.entries(obj||{}).flatMap(([k,v])=>v?.children?[[label(v),k],...flat(v.children)]:[[label(v),k]]);
    const out={standard:[],exotic:[],special:[]};
    for(const [k,v] of Object.entries(cfg)){
      if(k==="standard") out.standard.push(...flat(v.children));
      else if(k==="exotic") out.exotic.push(...flat(v.children));
      else out.special.push(...(v?.children?flat({[k]:v}):[[label(v),k]]));
    }
    for(const g of Object.values(out)) g.sort((a,b)=>a[0].localeCompare(b[0]));
    if(!out.standard.length) throw new Error("empty");
    return out;
  }catch(_){ return {standard:STANDARD_LANGUAGES,exotic:EXOTIC_LANGUAGES,special:SPECIAL_LANGUAGES}; }
}
function languageLabel(key){ const k=traitKey(key).split(":").pop(); for(const g of Object.values(configLanguageGroups())) for(const [l,v] of g) if(v===k) return l; return k.replace(/\b\w/g,c=>c.toUpperCase()); }
const TOOL_OPTIONS_2024 = [
  ["Alchemist's Supplies","alchemist"],["Brewer's Supplies","brewer"],["Calligrapher's Supplies","calligrapher"],["Carpenter's Tools","carpenter"],["Cartographer's Tools","cartographer"],["Cobbler's Tools","cobbler"],["Cook's Utensils","cook"],["Glassblower's Tools","glassblower"],["Jeweler's Tools","jeweler"],["Leatherworker's Tools","leatherworker"],["Mason's Tools","mason"],["Painter's Supplies","painter"],["Potter's Tools","potter"],["Smith's Tools","smith"],["Tinker's Tools","tinker"],["Weaver's Tools","weaver"],["Woodcarver's Tools","woodcarver"],
  ["Playing Cards Set","card"],["Chess Set","chess"],["Dice Set","dice"],
  ["Bagpipes","bagpipes"],["Drum","drum"],["Dulcimer","dulcimer"],["Flute","flute"],["Horn","horn"],["Lute","lute"],["Lyre","lyre"],["Pan Flute","panflute"],["Shawm","shawm"],["Viol","viol"],
  ["Disguise Kit","disg"],["Forgery Kit","forg"],["Herbalism Kit","herb"],["Navigator's Tools","navg"],["Poisoner's Kit","pois"],["Thieves' Tools","thief"]
];
// dnd5e trait-key categories used by wildcard pools such as "tool:music:*".
const TOOL_CATEGORIES={
  art:["alchemist","brewer","calligrapher","carpenter","cartographer","cobbler","cook","glassblower","jeweler","leatherworker","mason","painter","potter","smith","tinker","weaver","woodcarver"],
  game:["card","chess","dice"],
  music:["bagpipes","drum","dulcimer","flute","horn","lute","lyre","panflute","shawm","viol"],
  vehicle:["air","land","space","water"]
};
const TOOL_STANDALONE=["disg","forg","herb","navg","pois","thief"];
const VEHICLE_LABELS={air:"Airships",land:"Land Vehicles",space:"Spelljammers",water:"Water Vehicles"};
function toolLabel(id){ const row=TOOL_OPTIONS_2024.find(([,v])=>v===id); if(row) return row[0]; if(VEHICLE_LABELS[id]) return VEHICLE_LABELS[id]; try{ const u=CONFIG?.DND5E?.tools?.[id]?.id; const e=u&&resolver.entries.find(x=>x.uuid===u); if(e) return e.name; }catch(_){} return String(id); }
const ARMOR_LABELS={lgt:"Light Armor",med:"Medium Armor",hvy:"Heavy Armor",shl:"Shields"};
const ABILITY_LABELS={str:"Strength",dex:"Dexterity",con:"Constitution",int:"Intelligence",wis:"Wisdom",cha:"Charisma"};
/** Expand dnd5e Trait pool keys ("skills:*", "tool:music:*", "languages:standard:*", "weapon:mar:*") into concrete choices. */
function expandTraitPool(pool=[]){
  const out=new Map(); const add=(value,label)=>{ if(!out.has(value)) out.set(value,{value,label}); };
  for(const raw of pool){
    const code=String(raw); const parts=code.split(":"); const kind=parts[0]; const last=parts.at(-1);
    if(last!=="*"){ add(code,traitLabel(code)); continue; }
    const cat=parts.length>2?parts[1]:"";
    if(kind==="skills") for(const [k,l] of Object.entries(SKILLS)) add(`skills:${k}`,l);
    else if(kind==="saves") for(const a of ABILITIES) add(`saves:${a}`,`${ABILITY_LABELS[a]} Saving Throw`);
    else if(kind==="tool"){
      const cats=cat?[cat]:Object.keys(TOOL_CATEGORIES);
      for(const c of cats) for(const id of (TOOL_CATEGORIES[c]||[])) add(`tool:${c}:${id}`,toolLabel(id));
      if(!cat) for(const id of TOOL_STANDALONE) add(`tool:${id}`,toolLabel(id));
    }
    else if(kind==="languages"){
      const g=configLanguageGroups(); const groups=cat?[cat]:["standard","exotic","special"];
      for(const k of groups) for(const [l,v] of (g[k]||[])) add(`languages:${k==="special"?"":k+":"}${v}`.replace(/:$/,""),l);
    }
    else if(kind==="weapon"){
      const cats=cat==="sim"?["simple"]:cat==="mar"?["martial"]:["simple","martial"];
      for(const c of cats) for(const [l,id] of PHB24_WEAPONS[c]) add(`weapon:${c==="simple"?"sim":"mar"}:${id}`,l);
    }
    else if(kind==="armor") for(const [k,l] of Object.entries(ARMOR_LABELS)) add(`armor:${k}`,l);
    else if(["dr","di","dv"].includes(kind)) for(const d of DAMAGE_TYPES) add(`${kind}:${d}`,d.replace(/\b\w/g,c=>c.toUpperCase()));
    else if(kind==="ci") for(const c of CONDITION_TYPES) add(`ci:${c}`,c.replace(/\b\w/g,x=>x.toUpperCase()));
    else add(code,traitLabel(code));
  }
  return [...out.values()];
}
function languagePoolOptions(pool=[]){ return null; } // Superseded by expandTraitPool (kept for API compatibility).
function maxSpellLevelForProgression(progression="none", level=0){
  const p=norm(progression), l=Math.max(0,Number(level)||0);
  if(!l||p==="none")return 0;
  if(["full","fullcaster","full caster"].includes(p))return Math.min(9,Math.ceil(l/2));
  if(["half","halfcaster","half caster"].includes(p))return Math.min(5,Math.ceil(l/4));
  if(["third","thirdcaster","third caster"].includes(p))return l<3?0:Math.min(4,Math.floor((l-1)/6)+1);
  if(["pact","pactmagic","pact magic"].includes(p))return l<=2?1:l<=4?2:l<=6?3:l<=8?4:5;
  return 0;
}
function defaultProgressionForClass(name=""){ const n=norm(name); if(["bard","cleric","druid","sorcerer","wizard","psion"].includes(n))return "full"; if(["artificer","paladin","ranger"].includes(n))return "half"; if(n==="warlock")return "pact"; return "none"; }
function defaultCastingAbility(name=""){ const n=norm(name); if(["artificer","wizard","psion"].includes(n))return "int"; if(["cleric","druid","ranger"].includes(n))return "wis"; if(["bard","paladin","sorcerer","warlock"].includes(n))return "cha"; return "int"; }

const PHB24_WEAPONS = {
  simple: [
    ["Club","club"],["Dagger","dagger"],["Greatclub","greatclub"],["Handaxe","handaxe"],["Javelin","javelin"],
    ["Light Hammer","light-hammer"],["Mace","mace"],["Quarterstaff","quarterstaff"],["Sickle","sickle"],["Spear","spear"],
    ["Dart","dart"],["Light Crossbow","light-crossbow"],["Shortbow","shortbow"],["Sling","sling"]
  ],
  martial: [
    ["Battleaxe","battleaxe"],["Flail","flail"],["Glaive","glaive"],["Greataxe","greataxe"],["Greatsword","greatsword"],
    ["Halberd","halberd"],["Lance","lance"],["Longsword","longsword"],["Maul","maul"],["Morningstar","morningstar"],
    ["Pike","pike"],["Rapier","rapier"],["Scimitar","scimitar"],["Shortsword","shortsword"],["Trident","trident"],
    ["War Pick","war-pick"],["Warhammer","warhammer"],["Whip","whip"],["Blowgun","blowgun"],["Hand Crossbow","hand-crossbow"],
    ["Heavy Crossbow","heavy-crossbow"],["Longbow","longbow"],["Musket","musket"],["Pistol","pistol"]
  ]
};
function weaponMasteryCategory(code, force=false){
  const parts=String(code||"").split(":"); const kind=norm(parts[0]||""); const id=norm(parts.at(-1)||"");
  if(!force && !/weapon.*master/.test(kind)) return null;
  if(["sim","simple"].includes(id)) return "simple";
  if(["mar","martial"].includes(id)) return "martial";
  if(["*","all","any"].includes(id)) return "all";
  return null;
}
function weaponCategoryFromEntry(e){
  const t=norm(e.itemTypeValue||"");
  if(t.startsWith("simple") || ["simplem","simpler"].includes(t)) return "simple";
  if(t.startsWith("martial") || ["martialm","martialr"].includes(t)) return "martial";
  const id=norm(e.itemBaseItem||e.identifier||"");
  for(const cat of ["simple","martial"]) if(PHB24_WEAPONS[cat].some(([,x])=>norm(x)===id)) return cat;
  return null;
}
function isValindraGunslingerSource(e){ const src=norm(plutoniumSourceKey(e)||e?.source?.book||""); return src.includes("valindra")&&src.includes("gunslinger"); }
function cleanWeaponBaseName(name=""){ return String(name).replace(/^[+\-]?\d+\s+/,'').replace(/\s*[—–-]\s*(?:Cleave|Graze|Nick|Push|Sap|Slow|Topple|Vex)\s*$/i,'').trim(); }
function weaponMasteryPoolOptions(pool=[], force=false){
  const cats=new Set(pool.map(x=>weaponMasteryCategory(x,force)).filter(Boolean));
  if(force && !cats.size){ cats.add("simple"); cats.add("martial"); }
  if(cats.has("all")){ cats.delete("all"); cats.add("simple"); cats.add("martial"); }
  if(!cats.size) return null;
  const out=new Map();
  // Exactly the mundane PHB 2024 weapons, plus mundane weapons from Valindra's Gunslinger source.
  for(const cat of cats) for(const [name,id] of (PHB24_WEAPONS[cat]||[])) out.set(norm(id),{value:`weaponMastery:${id}`,label:name});
  const rows=resolver.entries.filter(e=>resolver.allowed(e)&&e.type==="weapon"&&isValindraGunslingerSource(e));
  for(const e of rows){
    const cat=weaponCategoryFromEntry(e); if(cat&&!cats.has(cat))continue;
    const raw=String(e.name||""); if(!raw||/^\s*[+\-]?\d+\b/.test(raw))continue;
    if(/\b(?:of warning|berserker|dancing|flame|frost brand|thunderbolts|vicious)\b/i.test(raw))continue;
    const name=cleanWeaponBaseName(raw), base=String(e.itemBaseItem||e.identifier||norm(name)).trim(); if(!name||!base)continue;
    const k=norm(base); if(out.has(k))continue; const mastery=String(e.mastery||"").trim();
    out.set(k,{value:`weaponMastery:${base}`,label:`${name}${mastery?` — ${mastery.charAt(0).toUpperCase()+mastery.slice(1)}`:""}`});
  }
  return [...out.values()].sort((a,b)=>a.label.localeCompare(b.label));
}
const CORE_FIGHTING_STYLES = [
  "Archery","Blind Fighting","Defense","Dueling","Great Weapon Fighting","Interception",
  "Protection","Thrown Weapon Fighting","Two-Weapon Fighting","Unarmed Fighting"
];
const SYNTH_FIGHTING_STYLE_PREFIX="__fightingstyle__:";
function syntheticFightingStyleId(name=""){return `${SYNTH_FIGHTING_STYLE_PREFIX}${encodeURIComponent(canonicalFightingStyleName(name))}`;}
function syntheticFightingStyleName(id=""){if(!String(id).startsWith(SYNTH_FIGHTING_STYLE_PREFIX))return "";try{return decodeURIComponent(String(id).slice(SYNTH_FIGHTING_STYLE_PREFIX.length));}catch(_){return String(id).slice(SYNTH_FIGHTING_STYLE_PREFIX.length);}}
function canonicalFightingStyleName(name=""){
  const s=String(name).trim().replace(/^Fighting Style\s*:\s*/i,"").trim();
  if(/^(?:Fighting Style|Additional Fighting Style)$/i.test(s)) return "";
  return s;
}
function isFightingStyleEntry(e){
  if(e?.type!=="feat")return false; const name=canonicalFightingStyleName(e.name); if(!name)return false;
  const subtype=norm(e.featSubtype||""), id=norm(e.identifier||""), uuid=String(e.uuid||"");
  return /fighting\s*style/.test(subtype)||/fighting[- ]?style/.test(id)||/phbfst/i.test(uuid)||CORE_FIGHTING_STYLES.some(x=>norm(x)===norm(name));
}
function rawFeatLooksLikeFightingStyle(feat){
  if(!feat?.name)return false;
  const name=canonicalFightingStyleName(feat.name), k=norm(name);
  if(CORE_FIGHTING_STYLES.some(x=>norm(x)===k))return true;
  let meta="";
  try{meta=[feat.category,feat.featCategory,feat.type,feat._type,feat.prerequisite,feat.prerequisites,feat.requirements].map(x=>typeof x==="string"?x:JSON.stringify(x||"")).join(" ");}catch(_){meta="";}
  return /fighting\s*style/i.test(meta);
}
function fightingStyleOptions(nativeOptions=[]){
  const byName=new Map();
  const add=(value,label,source="")=>{label=canonicalFightingStyleName(label);const k=norm(label);if(!value||!k)return;const cur=byName.get(k);const rank=v=>String(v||"").startsWith(SYNTH_FIGHTING_STYLE_PREFIX)?0:String(v||"").startsWith("__rawfeat__")?2:3;if(!cur||rank(value)>rank(cur.value))byName.set(k,{value,label,source});};

  // Keep every option explicitly encoded on the class advancement first.
  for(const o of (nativeOptions||[])) add(o.uuid||o.value,o.name||o.label,"class advancement");

  // Fighting Style metadata varies substantially between dnd5e, DDB Importer, Plutonium,
  // prerelease data, and older packs. Search both accepted and rules-excluded documents here;
  // the owning 2024 class feature is what makes this a Fighting Style choice.
  const allIndexed=[...resolver.entries,...resolver.excludedEntries];
  const indexed=allIndexed.filter(e=>e?.type==="feat"||e?.rawType==="feat");
  const rows=indexed.filter(e=>isFightingStyleEntry(e)||/fighting\s*style/i.test(`${e.requirements||""} ${e.featType||""} ${e.featSubtype||""} ${e.packTitle||""} ${e.packFolder||""}`))
    .sort((a,b)=>(resolver.priority(b)-resolver.priority(a))||String(a.name).localeCompare(String(b.name)));
  for(const e of rows){
    const ps=plutoniumSourceKey(e);
    if(ps&&resolver.enabledPlutoniumSources&&!resolver.enabledPlutoniumSources.has(ps))continue;
    add(e.uuid,e.name,ps||e.source?.book||e.packTitle||"");
  }

  // Raw 5etools/Plutonium feats, including prerelease/UA.
  for(const feat of plutoniumBridge.rawFeats||[]){
    const src=String(feat?.source||"");
    if(resolver.enabledPlutoniumSources&&src&&!resolver.enabledPlutoniumSources.has(src))continue;
    if(!rawFeatLooksLikeFightingStyle(feat))continue;
    const e=plutoniumBridge.rawFeatEntry(feat); add(e.uuid,e.name,src);
  }

  // The 2024 Fighter/Paladin/Ranger advancement can be a generic “choose a Fighting Style
  // feat” restriction rather than an enumerated UUID pool. Always expose the standard style
  // names. If a real document exists anywhere, use it; otherwise use a synthetic resolver ID
  // which will try exact-name/raw-data resolution again at actor creation time.
  for(const name of CORE_FIGHTING_STYLES){
    const k=norm(name);if(byName.has(k))continue;
    const e=indexed.find(x=>norm(canonicalFightingStyleName(x.name))===k);
    if(e){add(e.uuid,name,plutoniumSourceKey(e)||e.source?.book||e.packTitle||"");continue;}
    const f=(plutoniumBridge.rawFeats||[]).find(x=>norm(canonicalFightingStyleName(x.name))===k && (!resolver.enabledPlutoniumSources||!x.source||resolver.enabledPlutoniumSources.has(String(x.source))));
    if(f){const re=plutoniumBridge.rawFeatEntry(f);add(re.uuid,name,String(f.source||""));continue;}
    add(syntheticFightingStyleId(name),name,"built-in fallback");
  }
  return [...byName.values()].sort((a,b)=>a.label.localeCompare(b.label));
}

function uuidLabelFallback(uuid=""){
  const u=String(uuid);
  const known=[
    [/BlindFight/i,"Blind Fighting"],[/Dueling/i,"Dueling"],[/Interception/i,"Interception"],
    [/Protection/i,"Protection"],[/ThrownWeap/i,"Thrown Weapon Fighting"],[/UnarmedFig/i,"Unarmed Fighting"],
    [/GreatWeapon/i,"Great Weapon Fighting"],[/TwoWeapon/i,"Two-Weapon Fighting"],[/Archery/i,"Archery"],[/Defense/i,"Defense"]
  ];
  for(const [re,label] of known) if(re.test(u)) return label;
  const tail=u.split(".").at(-1)||u;
  return tail.replace(/^phb(?:fst|ft|wep)/i,"").replace(/0+$/g,"").replace(/([a-z])([A-Z])/g,"$1 $2").trim()||u;
}
function traitChoiceCount(adv){ return (adv?.configuration?.choices||[]).reduce((n,c)=>n+Number(c.count||0),0); }
function itemChoiceCount(adv, level=0){
  // dnd5e stores the NEW picks gained at each level, so a level 5 Warlock has 1 + 2 + 2 invocations.
  const c=adv?.configuration?.choices||{}; let total=0;
  for(const [lvl,v] of Object.entries(c)) if(Number(lvl)<=level) total+=Number(v?.count||0);
  return total;
}
function parseTraitGrant(code, updates, mode="default"){
  const parts=String(code).split(":"); const kind=parts.shift(); const id=parts.pop();
  if(!id||id==="*") return;
  const push=(p,v)=>{ const a=updates[p]||[]; if(!a.includes(v))a.push(v); updates[p]=a; };
  const level=(prev)=>{ // dnd5e TraitAdvancement.apply: default -> 1, upgrade -> 1 or 2, expertise/forcedExpertise -> 2
    if(mode==="expertise"||mode==="forcedExpertise") return 2;
    if(mode==="upgrade") return prev>=1?2:1;
    return Math.max(1,prev);
  };
  if(kind==="saves") updates[`system.abilities.${id}.proficient`]=1;
  else if(kind==="skills"){ const p=`system.skills.${id}.value`; updates[p]=Math.max(Number(updates[p]||0),level(Number(updates[p]||0))); }
  else if(kind==="tool"){ const p=`system.tools.${id}.value`; updates[p]=Math.max(Number(updates[p]||0),level(Number(updates[p]||0))); }
  else if(mode==="mastery"||/weapon.*master/i.test(kind)) push("system.traits.weaponProf.mastery.value",id);
  else if(kind==="weapon") push("system.traits.weaponProf.value",id);
  else if(kind==="armor") push("system.traits.armorProf.value",id);
  else if(kind==="languages") push("system.traits.languages.value",id);
  else if(["dr","di","dv","ci"].includes(kind)) push(`system.traits.${kind}.value`,id);
}

// ---- 5etools item data -> native dnd5e item (used when Plutonium exposes data but no item converter)
const RARITY_KEYS={common:"common",uncommon:"uncommon",rare:"rare","very rare":"veryRare",veryrare:"veryRare",legendary:"legendary",artifact:"artifact"};
function rarityKey(r){ return RARITY_KEYS[String(r||"").trim().toLowerCase()]||""; }
const DMG_5ET={A:"acid",B:"bludgeoning",C:"cold",F:"fire",O:"force",L:"lightning",N:"necrotic",P:"piercing",I:"poison",Y:"psychic",R:"radiant",S:"slashing",T:"thunder"};
const PROP_5ET={A:"amm",AF:"amm",F:"fin",H:"hvy",L:"lgt",LD:"lod",R:"rch",RLD:"rel",S:"spc",T:"thr","2H":"two",V:"ver",BF:"fir"};
function code5et(v){ return String(v?.uid||v?.property||v||"").split("|")[0].toUpperCase(); }
function is2024Source(src){ return /^(XPHB|XDMG|XMM)$/i.test(String(src||"")); }
/** dnd5e item type for a 5etools item record. */
function rawItemFoundryType(it){
  const t=code5et(it?.type);
  if(["M","R"].includes(t)||it?.weapon||it?.weaponCategory) return "weapon";
  if(["LA","MA","HA","S"].includes(t)||it?.armor) return "equipment";
  if(["P","SC","WD","RD","A","AF","EXP","FD"].includes(t)) return "consumable";
  if(["INS","AT","T","GS"].includes(t)) return "tool";
  if(t==="RG"||it?.wondrous||it?.reqAttune||rarityKey(it?.rarity)) return "equipment";
  return "loot";
}
function equipmentMiscType(want){ const misc=CONFIG?.DND5E?.miscEquipmentTypes||CONFIG?.DND5E?.equipmentTypes||{}; return (want in misc)?want:("trinket" in misc?"trinket":want); }
/** Build a dnd5e item from 5etools JSON. Mechanics beyond damage, armor, rarity and attunement are kept as text. */
function rawItemToNative(it, html=""){
  const type=rawItemFoundryType(it), t=code5et(it.type), src=String(it.source||"");
  const sys={description:{value:html,chat:""},source:{book:src,custom:"",rules:is2024Source(src)?"2024":"2014"},quantity:1,
    weight:{value:Number(it.weight)||0,units:"lb"},price:{value:Number(it.value)?Number(it.value)/100:0,denomination:"gp"},
    rarity:rarityKey(it.rarity),attunement:it.reqAttune?"required":"",attuned:false,equipped:false,identified:true,properties:[]};
  const props=new Set((it.property||[]).map(code5et).map(c=>PROP_5ET[c]).filter(Boolean));
  if(sys.rarity&&sys.rarity!=="common"||it.wondrous||it.reqAttune) props.add("mgc");
  const out={name:it.name,type,img:"icons/svg/item-bag.svg",system:sys,effects:[],flags:{[MODULE_ID]:{rawItemFallback:true,rawItemSource:src}}};
  if(type==="weapon"){
    const m=/^(\d*)d(\d+)/i.exec(String(it.dmg1||"")); const ranged=t==="R";
    sys.type={value:`${it.weaponCategory==="martial"?"martial":"simple"}${ranged?"R":"M"}`,baseItem:String(it.baseItem||"").split("|")[0].toLowerCase()};
    sys.damage={base:{number:m?Number(m[1]||1):null,denomination:m?Number(m[2]):null,types:it.dmgType?[DMG_5ET[code5et(it.dmgType)]].filter(Boolean):[],bonus:m?"":String(it.dmg1||""),custom:{enabled:false}}};
    const v=/^(\d*)d(\d+)/i.exec(String(it.dmg2||"")); if(v) sys.damage.versatile={number:Number(v[1]||1),denomination:Number(v[2]),types:sys.damage.base.types,bonus:""};
    const r=/^(\d+)(?:\/(\d+))?/.exec(String(it.range||"")); if(r) sys.range={value:Number(r[1]),long:r[2]?Number(r[2]):null,units:"ft"};
    const bonus=parseInt(String(it.bonusWeapon||"").replace("+",""),10); if(bonus) sys.magicalBonus=bonus;
    const mastery=(it.mastery||[]).map(code5et)[0]; if(mastery) sys.mastery=mastery.toLowerCase();
    const id=foundry.utils.randomID?.()||Math.random().toString(36).slice(2).padEnd(16,"0").slice(0,16);
    sys.activities={[id]:{_id:id,type:"attack",sort:0,activation:{type:"action",value:1},attack:{ability:"",bonus:"",type:{value:ranged?"ranged":"melee",classification:"weapon"}},damage:{includeBase:true,parts:[]}}};
    out.img=ranged?"icons/weapons/bows/shortbow-recurve.webp":"icons/weapons/swords/sword-guard-steel.webp";
  }else if(type==="equipment"){
    if(["LA","MA","HA","S"].includes(t)){
      const kind={LA:"light",MA:"medium",HA:"heavy",S:"shield"}[t];
      sys.type={value:kind,baseItem:String(it.baseItem||"").split("|")[0].toLowerCase()};
      sys.armor={value:Number(it.ac)||0,magicalBonus:parseInt(String(it.bonusAc||"").replace("+",""),10)||null,dex:kind==="medium"?2:kind==="heavy"?0:null};
      if(it.strength) sys.strength=Number(it.strength)||null;
      if(it.stealth) props.add("stealthDisadvantage");
    }else sys.type={value:equipmentMiscType(t==="RG"?"ring":"wondrous")};
  }else if(type==="consumable"){
    sys.type={value:{P:"potion",SC:"scroll",WD:"wand",RD:"rod",A:"ammo",AF:"ammo",EXP:"trinket",FD:"food"}[t]||"trinket"};
    sys.uses={max:"1",spent:0,recovery:[],autoDestroy:t==="P"||t==="SC"};
  }else if(type==="tool"){
    sys.type={value:{INS:"music",AT:"art",GS:"game"}[t]||""};
  }
  sys.properties=[...props];
  return out;
}

class PlutoniumBridge {
  constructor(){this.version="";this.available=false;this.dataUtil=false;this.spellClassMap=new Map();this.rawFeats=[];this.rawFeatById=new Map();this.rawFeatLoaded=false;this.rawItems=[];this.rawItemById=new Map();this.rawItemLoaded=false;this.itemLoadInfo="";this.remoteUa={attempted:false,loaded:false,files:0,feats:0,error:""};}
  detect(){const m=game.modules.get("plutonium");this.available=!!m?.active;this.version=m?.version||m?.manifest?.version||"";this.dataUtil=!!globalThis.DataUtil;return this.available;}
  rawFeatId(feat){const src=String(feat?.source||"UNKNOWN"),name=String(feat?.name||"");return `__rawfeat__:${encodeURIComponent(src)}:${encodeURIComponent(name)}`;}
  rawFeatEntry(feat){const id=this.rawFeatId(feat);return {name:feat.name,type:"feat",uuid:id,source:{book:feat.source||"",rules:"2024"},identifier:norm(feat.name||""),requirements:"",level:0,featType:"feat",featSubtype:"",itemTypeValue:"feat",itemBaseItem:"",mastery:"",spellClasses:[],plutonium:{page:"feats.html",source:feat.source||"",hash:(globalThis.UrlUtil?.URL_TO_HASH_BUILDER?.[globalThis.UrlUtil?.PG_FEATS]?.(feat))||`${encodeURIComponent(feat.name||"")}_${String(feat.source||"").toLowerCase()}`},rawFeat:true};}
  async _fetchJson(url){
    const res=await fetch(url,{cache:"no-store"});
    if(!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  }
  _collectIndexedValues(node,sourceIndex,out){
    if(node==null)return;
    if(typeof node==="string"){
      if(/\.json$/i.test(node))out.add(node);
      else if(sourceIndex?.[node])out.add(sourceIndex[node]);
      return;
    }
    if(Array.isArray(node)){for(const v of node)this._collectIndexedValues(v,sourceIndex,out);return;}
    if(typeof node==="object")for(const [k,v] of Object.entries(node)){
      if(sourceIndex?.[k])out.add(sourceIndex[k]);
      this._collectIndexedValues(v,sourceIndex,out);
    }
  }
  _extractFeatArrays(node,addAll){
    if(!node||typeof node!=="object")return;
    if(Array.isArray(node)){for(const v of node)this._extractFeatArrays(v,addAll);return;}
    for(const [k,v] of Object.entries(node)){
      if(k==="feat"&&Array.isArray(v))addAll(v);
      else if(v&&typeof v==="object")this._extractFeatArrays(v,addAll);
    }
  }
  async _loadRemoteUaFeats(addAll){
    // Plutonium's processed prerelease cache only contains sources which have already been
    // loaded into the current session. The official Giddy prerelease repository is the
    // authoritative 5etools-compatible UA source set, so use it as a read-only fallback.
    const BASE="https://raw.githubusercontent.com/TheGiddyLimit/unearthed-arcana/master/";
    let enabled=false; try{ enabled=!!game.settings.get(MODULE_ID,"remoteUa"); }catch(_){}
    if(!enabled){ this.remoteUa={attempted:false,loaded:false,files:0,feats:0,error:"",disabled:true}; return; }
    // Fetch once per session; later exports reuse the cached feats.
    if(this.remoteUaFeats){ addAll(this.remoteUaFeats); return; }
    this.remoteUa={attempted:true,loaded:false,files:0,feats:0,error:""};
    const collected=[]; const addAllOuter=addAll; addAll=arr=>{ for(const f of (arr||[])) collected.push(f); addAllOuter(arr); };
    try{
      const [sourcesR,propsR]=await Promise.allSettled([
        this._fetchJson(`${BASE}_generated/index-sources.json`),
        this._fetchJson(`${BASE}_generated/index-props.json`),
      ]);
      const sourceIndex=sourcesR.status==="fulfilled"?sourcesR.value:{};
      const propIndex=propsR.status==="fulfilled"?propsR.value:{};
      const paths=new Set();

      // Include every modern-UA file which uses the 2024 rules, even when feats are embedded
      // in a class/collection JSON (e.g. XUA2025Psion -> Pyrokinesis).
      for(const [source,path] of Object.entries(sourceIndex||{})){
        if(/^XUA20(?:24|25|26)/i.test(source))paths.add(path);
      }
      // Also use the generated property index, where available, to catch any feat-bearing
      // prerelease file which is not named in the modern-UA pattern.
      this._collectIndexedValues(propIndex?.feat,sourceIndex,paths);

      const before=this.rawFeats.length;
      const jobs=[...paths].map(async path=>{
        try{
          const url=new URL(path,BASE).href;
          const json=await this._fetchJson(url);
          this._extractFeatArrays(json,arr=>addAll(arr));
          return true;
        }catch(e){console.warn(`${MODULE_ID} could not load UA source ${path}`,e);return false;}
      });
      const results=await Promise.all(jobs);
      this.remoteUa.files=results.filter(Boolean).length;
      this.remoteUa.feats=Math.max(0,this.rawFeats.length-before);
      this.remoteUa.loaded=this.remoteUa.files>0;
      if(this.remoteUa.loaded) this.remoteUaFeats=collected;
    }catch(e){
      this.remoteUa.error=String(e?.message||e);
      console.warn(`${MODULE_ID} could not load remote 5etools UA feat index`,e);
    }
  }
  async buildFeatIndex(force=false){
    if(this.rawFeatLoaded&&!force)return; this.rawFeats=[];this.rawFeatById.clear();this.detect();
    const addAll=arr=>{for(const f of (arr||[])){if(!f?.name)continue;const id=this.rawFeatId(f);if(this.rawFeatById.has(id))continue;this.rawFeatById.set(id,f);this.rawFeats.push(f);}};
    try{
      const du=globalThis.DataUtil;
      if(du?.feat?.pLoadAll){const out=await du.feat.pLoadAll();addAll(Array.isArray(out)?out:out?.feat);}
      else if(du?.feat?.loadJSON){const out=await du.feat.loadJSON();addAll(out?.feat);}
    }catch(e){console.warn(`${MODULE_ID} could not read base Plutonium feat data`,e);}
    for(const util of [globalThis.PrereleaseUtil,globalThis.BrewUtil2,globalThis.BrewUtil]){
      try{if(typeof util?.pGetBrewProcessed==="function"){const out=await util.pGetBrewProcessed();addAll(out?.feat);}}catch(e){console.warn(`${MODULE_ID} could not read prerelease/homebrew feat data`,e);}
    }
    await this._loadRemoteUaFeats(addAll);
    this.rawFeatLoaded=true;
  }
  // ---- 5etools items (magic items, mundane gear) from Plutonium's data layer
  rawItemId(it){ return `__rawitem__:${encodeURIComponent(String(it?.source||"UNKNOWN"))}:${encodeURIComponent(String(it?.name||""))}`; }
  rawItemEntry(it){ return {name:it.name,type:rawItemFoundryType(it),uuid:this.rawItemId(it),source:{book:it.source||"",rules:is2024Source(it.source)?"2024":"2014"},rarity:it.rarity||"",rawItem:true,plutonium:{source:it.source||""}}; }
  /** Load every item Plutonium/5etools knows about, including generic variants expanded into specific items (Byeshk Greatsword). */
  async buildItemIndex(force=false){
    if(this.rawItemLoaded&&!force) return; this.rawItems=[]; this.rawItemById=new Map(); this.itemLoadInfo=""; this.detect();
    const addAll=arr=>{ for(const it of (arr||[])){ if(!it?.name||it._isItemGroup) continue; const id=this.rawItemId(it); if(this.rawItemById.has(id)) continue; this.rawItemById.set(id,it); this.rawItems.push(it); } };
    const loaders=[
      ["Renderer.item.pBuildList",()=>globalThis.Renderer?.item?.pBuildList?.({isAddGroups:false,isBlocklistVariants:true})],
      ["DataUtil.item.loadJSON",()=>globalThis.DataUtil?.item?.loadJSON?.()],
      ["DataUtil.item.pLoadAll",()=>globalThis.DataUtil?.item?.pLoadAll?.()],
    ];
    for(const [label,fn] of loaders){
      try{ const out=await fn(); const arr=Array.isArray(out)?out:(out?.item||out?.items); if(Array.isArray(arr)&&arr.length){ addAll(arr); this.itemLoadInfo=label; break; } }
      catch(e){ console.warn(`${MODULE_ID} ${label} failed`,e); }
    }
    for(const util of [globalThis.PrereleaseUtil,globalThis.BrewUtil2,globalThis.BrewUtil]){
      try{ if(typeof util?.pGetBrewProcessed==="function"){ const out=await util.pGetBrewProcessed(); addAll(out?.item); } }catch(e){ console.warn(`${MODULE_ID} could not read prerelease/homebrew item data`,e); }
    }
    this.rawItemLoaded=true;
  }
  rawItemCandidates(name){
    const n=norm(name); if(!n) return [];
    return this.rawItems.map(it=>({it,score:resolver.score(n,norm(it.name),"")})).filter(x=>x.score>=0.52)
      .sort((a,b)=>(b.score-a.score)||((is2024Source(b.it.source)?1:0)-(is2024Source(a.it.source)?1:0)))
      .slice(0,6).map(x=>({...this.rawItemEntry(x.it),score:x.score}));
  }
  itemConverters(){ return [globalThis.DataConverterItem,globalThis.plutonium?.DataConverterItem,game.modules.get("plutonium")?.api?.importer?.DataConverterItem].filter(Boolean); }
  async rawItemToItemData(id){
    const it=this.rawItemById.get(id); if(!it) return null;
    // Prefer Plutonium's own converter (full activities and effects) when the running build exposes it.
    for(const c of this.itemConverters()) for(const fn of ["pGetItemItem","pGetDocumentJson","pGetDocumentData","pGetItem"]){
      if(typeof c?.[fn]!=="function") continue;
      try{ const out=await c[fn](it,{actor:null,isActorItem:true}); const d=out?.toObject?.()||out?.item?.toObject?.()||out?.item||out; if(d?.type&&d?.name) return deepClone(d); }
      catch(e){ console.warn(`${MODULE_ID} Plutonium item converter ${fn} failed`,e); }
    }
    let html="";
    try{ const R=globalThis.Renderer; if(R?.get) html=R.get().render({type:"entries",entries:it.entries||[]}); }catch(e){ console.warn(`${MODULE_ID} could not render raw item`,e); }
    if(!html){ try{ html=(it.entries||[]).map(x=>typeof x==="string"?`<p>${esc(x)}</p>`:`<p>${esc(JSON.stringify(x))}</p>`).join(""); }catch(_){ html=""; } }
    return rawItemToNative(it,html);
  }
  rawFeatSources(){const m=new Map();for(const f of this.rawFeats){const s=String(f.source||"").trim();if(s)m.set(s,(m.get(s)||0)+1);}return [...m.entries()].map(([code,count])=>({code,count}));}
  rawFeatEntries(enabledSources=null){return this.rawFeats.filter(f=>!enabledSources||enabledSources.has(String(f.source||""))).map(f=>this.rawFeatEntry(f));}
  rawFeatFromId(id){return this.rawFeatById.get(id)||null;}
  async rawFeatToItemData(id){
    const feat=this.rawFeatFromId(id);if(!feat)return null;
    // Prefer Plutonium's own converter if it is exposed by the running build.
    const converters=[globalThis.DataConverterFeat,globalThis.plutonium?.DataConverterFeat,game.modules.get("plutonium")?.api?.importer?.DataConverterFeat].filter(Boolean);
    for(const c of converters){for(const fn of ["pGetFeatItem","pGetFeatItemData","pGetDocumentData"]){if(typeof c?.[fn]!=="function")continue;try{const out=await c[fn](feat,{actor:null});const d=out?.toObject?.()||out?.item?.toObject?.()||out?.item||out;if(d?.type)return deepClone(d);}catch(e){console.warn(`${MODULE_ID} Plutonium feat converter ${fn} failed`,e);}}}
    // Safe fallback: build a native dnd5e feat preserving the 5etools text/source. This is only
    // used when Plutonium exposes its data layer but not its converter API.
    let html="";
    try{const R=globalThis.Renderer; if(R?.get){const r=R.get();html=r.render({type:"entries",entries:feat.entries||[]});}}catch(e){console.warn(`${MODULE_ID} could not render raw feat`,e);}
    if(!html){try{html=(feat.entries||[]).map(x=>typeof x==="string"?`<p>${esc(x)}</p>`:`<p>${esc(JSON.stringify(x))}</p>`).join("");}catch(_){html="";}}
    const subtype=/origin/i.test(String(feat.category||feat.featCategory||""))?"origin":"";
    return {name:feat.name,type:"feat",img:feat.img||"icons/svg/book.svg",system:{source:{custom:"",book:String(feat.source||""),page:"",license:"",rules:"2024",revision:1},description:{value:html,chat:""},requirements:"",prerequisites:{level:null,items:[],repeatable:false},uses:{max:"",spent:0,recovery:[]},type:{value:"feat",subtype},properties:[],advancement:{},activities:{},identifier:norm(feat.name||"").replace(/ /g,"-")},flags:{plutonium:{page:"feats.html",source:String(feat.source||""),hash:this.rawFeatEntry(feat).plutonium.hash},[MODULE_ID]:{rawPlutoniumFeat:true}},effects:[]};
  }
  async buildSpellClassMap(force=false){
    if(this.spellClassMapLoaded&&!force) return;
    this.detect(); this.spellClassMap.clear(); this.spellClassMapLoaded=true;
    // Prefer Plutonium/5eTools' already-loaded data layer. This keeps prerelease/homebrew compatibility when exposed.
    try{
      const du=globalThis.DataUtil; let spells=null;
      if(du?.spell?.pLoadAll) spells=await du.spell.pLoadAll();
      else if(du?.spell?.loadJSON) spells=(await du.spell.loadJSON())?.spell;
      if(Array.isArray(spells)) for(const sp of spells){
        const classes=[...(sp.classes?.fromClassList||[]),...(sp.classes?.fromClassListVariant||[])].map(x=>x.name).filter(Boolean);
        if(classes.length) this.spellClassMap.set(norm(sp.name),new Set(classes.map(norm)));
      }
    }catch(e){console.warn(`${MODULE_ID} could not read Plutonium spell metadata`,e);}
    // Enrich from any Plutonium-authored documents already materialized in Foundry.
    for(const e of resolver.entries) if(e.type==="spell"&&e.spellClasses?.length){
      const k=norm(e.name), set=this.spellClassMap.get(k)||new Set(); for(const c of e.spellClasses)set.add(norm(c)); this.spellClassMap.set(k,set);
    }
  }
  legalSpell(entry,classNames){ const set=this.spellClassMap.get(norm(entry.name)); if(!set?.size)return null; return classNames.some(c=>set.has(norm(c))); }
}
const plutoniumBridge=new PlutoniumBridge();

const resolver=new ContentResolver();

function flattenOwned(data){
  const out=[];
  for(const [key,v] of Object.entries(data["Magic Items"]||{})) out.push({category:"Magic Item", key, name:v.Name?.trim()||key, qty:acquisitionQty(v), attuned: v.Attuned===true, attunement:!!v.Attunement, raw:v});
  for(const [key,v] of Object.entries(data.Consumables||{})) out.push({category:"Consumable", key, name:key, qty:consumableQty(v), attuned:false,attunement:false,raw:v});
  for(const [key,v] of Object.entries(data.Inventory||{})) out.push({category:"Inventory", key, name:key, qty:acquisitionQty(v),attuned:false,attunement:false,raw:v});
  return out;
}

const MATCH_CONFIDENT=0.85;
const EQUIP_TYPES=["equipment","weapon","consumable","loot","tool","container"];

/** Write dnd5e 5.x spell preparation fields, plus the legacy fields for systems that still use them. */
function setSpellFields(d,{method,prepared,sourceItem,ability}={}){
  d.system=d.system||{};
  const legacy=("preparation" in d.system)&&!("method" in d.system);
  if(method!==undefined) d.system.method=method;
  if(prepared!==undefined) d.system.prepared=Number(prepared);
  if(sourceItem) d.system.sourceItem=sourceItem;
  if(ability!==undefined) d.system.ability=ability||"";
  if(legacy){
    d.system.preparation=d.system.preparation||{};
    if(prepared===2) d.system.preparation.mode="always";
    else if(method) d.system.preparation.mode=method==="spell"?"prepared":method;
    if(prepared!==undefined) d.system.preparation.prepared=Number(prepared)>0;
  }
  return d;
}
/** Apply an advancement's spell configuration the way dnd5e's SpellConfigurationData.applySpellChanges does. */
function applySpellConfig(d,cfg,ownerDoc,stats=null){
  if(!d||d.type!=="spell") return d;
  const c=cfg||{}; const abilities=[...(c.ability||[])].filter(Boolean);
  const method=c.method??(typeof c.preparation==="string"?(c.preparation==="prepared"?"spell":c.preparation):c.preparation?.mode);
  const prepared=c.prepared??(c.preparation?.prepared===true?1:undefined)??(method==="always"?2:undefined);
  const owner=ownerDoc?.type&&ownerDoc?.system?.identifier?`${ownerDoc.type}:${ownerDoc.system.identifier}`:undefined;
  setSpellFields(d,{method:method==="always"?"spell":(method||undefined),prepared:method==="always"?2:prepared,sourceItem:owner,ability:abilities.length===1?abilities[0]:(abilities.length>1&&stats)?abilities.reduce((a,b)=>(Number(stats[b])>Number(stats[a])?b:a)):undefined});
  const max=c.uses?.max;
  if(max!==undefined&&max!==null&&String(max)!==""){
    d.system.uses={...(d.system.uses||{}),max:String(max),spent:0,recovery:c.uses?.per?[{period:c.uses.per,type:"recoverAll"}]:[]};
  }
  return d;
}
function advancementList(doc){ const raw=doc?.system?.advancement; if(!raw) return []; return Array.isArray(raw)?raw:Object.values(raw); }

/**
 * 2024 PHB cantrip and prepared-spell limits by class level (index 0 = level 1).
 * Source: 5etools XPHB class data (cantripProgression / preparedSpellsProgression), cross-checked against the
 * dnd5e 5.3 classes24 ScaleValue advancements. Used only when the matched class document has no such scale values.
 */
const SPELL_LIMITS_2024={
  bard:{cantrips:[2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4],prepared:[4,5,6,7,9,10,11,12,14,15,16,16,17,17,18,18,19,20,21,22]},
  cleric:{cantrips:[3,3,3,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5],prepared:[4,5,6,7,9,10,11,12,14,15,16,16,17,17,18,18,19,20,21,22]},
  druid:{cantrips:[2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4],prepared:[4,5,6,7,9,10,11,12,14,15,16,16,17,17,18,18,19,20,21,22]},
  sorcerer:{cantrips:[4,4,4,5,5,5,5,5,5,6,6,6,6,6,6,6,6,6,6,6],prepared:[2,4,6,7,9,10,11,12,14,15,16,16,17,17,18,18,19,20,21,22]},
  wizard:{cantrips:[3,3,3,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5],prepared:[4,5,6,7,9,10,11,12,14,15,16,16,17,18,19,21,22,23,24,25]},
  warlock:{cantrips:[2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4],prepared:[2,3,4,5,6,7,8,9,10,10,11,11,12,12,13,13,14,14,15,15]},
  paladin:{cantrips:null,prepared:[2,3,4,5,6,6,7,7,9,9,10,10,11,11,12,12,14,14,15,15]},
  ranger:{cantrips:null,prepared:[2,3,4,5,6,6,7,7,9,9,10,10,11,11,12,12,14,14,15,15]},
  "eldritch knight":{cantrips:[0,0,2,2,2,2,2,2,2,3,3,3,3,3,3,3,3,3,3,3],prepared:[0,0,3,4,4,4,5,6,6,7,8,8,9,10,10,11,11,11,12,13]},
  "arcane trickster":{cantrips:[0,0,2,2,2,2,2,2,2,3,3,3,3,3,3,3,3,3,3,3],prepared:[0,0,3,4,4,4,5,6,6,7,8,8,9,10,10,11,11,11,12,13]}
};
function scaleValueAt(adv,level){
  const rows=Object.entries(adv?.configuration?.scale||{}).map(([k,v])=>[Number(k),v]).filter(([k])=>Number.isFinite(k)&&k<=level).sort((a,b)=>b[0]-a[0]);
  if(!rows.length) return 0; const v=rows[0][1]; const n=Number(v?.value??v); return Number.isFinite(n)?n:null;
}
/** Limits from a class/subclass document's own ScaleValue advancements (dnd5e 2024 classes, homebrew classes). */
function spellLimitsFromDoc(doc,level){
  const advs=advancementList(doc).filter(a=>a?.type==="ScaleValue"); if(!advs.length) return {};
  const idOf=a=>String(a.configuration?.identifier||norm(a.title||"").replace(/ /g,"-"));
  const prepId=(String(doc?.system?.spellcasting?.preparation?.formula||"").match(/@scale\.[^.\s]+\.([\w-]+)/)||[])[1];
  const prep=advs.find(a=>prepId&&idOf(a)===prepId)||advs.find(a=>/prepared/i.test(`${idOf(a)} ${a.title||""}`));
  const cant=advs.find(a=>/cantrip/i.test(`${idOf(a)} ${a.title||""}`));
  return {cantrips:cant?scaleValueAt(cant,level):undefined,prepared:prep?scaleValueAt(prep,level):undefined};
}

/* ===================================================================================== */
/* Shared services: recent errors, remembered item matches, diagnostics, Roll20 export   */
/* ===================================================================================== */
function moduleVersion(){ return game.modules.get(MODULE_ID)?.version||""; }
function moduleUrl(path){ const p=`modules/${MODULE_ID}/${path}`; try{ return foundry.utils.getRoute?.(p)??p; }catch(_){ return p; } }

/** The last few errors, so "Copy diagnostics" can include them. */
const recentErrors=[];
function logImportError(context,err){
  recentErrors.push({at:new Date().toISOString(),context,message:String(err?.message||err),stack:String(err?.stack||"").split("\n").slice(1,4).map(s=>s.trim()).join(" | ")});
  if(recentErrors.length>20) recentErrors.shift();
}

function isActiveGM(){ const gm=game.users?.activeGM; if(gm) return gm.isSelf??(gm.id===game.user?.id); return !!game.user?.isGM; }
const SOCKET=`module.${MODULE_ID}`;

/**
 * Item matches people chose by hand ("Cloak of Many Fashions" → some compendium item), reused for every later import.
 * Players cannot write world settings, so a player's pick is saved on their own user (used right away for their imports)
 * and sent to the active GM, who merges it into the world list. Newer picks win.
 */
const itemMemory={
  key(name){ return norm(name).replace(/ /g,"_"); },
  world(){ try{ return game.settings.get(MODULE_ID,"itemMatches")||{}; }catch(_){ return {}; } },
  mine(){ try{ return game.user?.getFlag?.(MODULE_ID,"itemMatches")||{}; }catch(_){ return {}; } },
  all(){ return {...this.world(),...this.mine()}; },
  get(name){ return this.all()[this.key(name)]||null; },
  newer(a,b){ return !a||Number(b?.at||0)>=Number(a?.at||0); },
  async remember(list){
    const rec={};
    for(const e of list||[]) if(e?.name&&e?.uuid&&e.uuid!=="__placeholder__") rec[this.key(e.name)]={name:e.name,uuid:e.uuid,label:e.label||"",by:game.user?.name||"",at:Date.now()};
    if(!Object.keys(rec).length) return;
    if(game.user?.isGM) return this.merge(rec);
    try{ await game.user.setFlag(MODULE_ID,"itemMatches",{...this.mine(),...rec}); }catch(e){ console.warn(`${MODULE_ID} | could not save item matches on your user`,e); }
    try{ game.socket?.emit(SOCKET,{type:"itemMatches",rec}); }catch(_){}
  },
  /** Only the active GM writes the world setting. */
  async merge(rec){
    if(!isActiveGM()) return; const cur={...this.world()}; let changed=false;
    for(const [k,v] of Object.entries(rec||{})) if(this.newer(cur[k],v)&&JSON.stringify(cur[k])!==JSON.stringify(v)){ cur[k]=v; changed=true; }
    if(changed) await game.settings.set(MODULE_ID,"itemMatches",cur);
  },
  /** Picks players made while no GM was online. */
  async collectFromUsers(){
    if(!isActiveGM()) return; const rec={};
    for(const u of (game.users?.contents||[...(game.users||[])])){ const f=u.getFlag?.(MODULE_ID,"itemMatches")||{}; for(const [k,v] of Object.entries(f)) if(this.newer(rec[k],v)) rec[k]=v; }
    await this.merge(rec);
  },
  async _dropFromUser(u,keys){ const f={...(u.getFlag?.(MODULE_ID,"itemMatches")||{})}; const before=Object.keys(f).length; for(const k of keys) delete f[k]; if(Object.keys(f).length===before) return; await u.unsetFlag(MODULE_ID,"itemMatches"); if(Object.keys(f).length) await u.setFlag(MODULE_ID,"itemMatches",f); },
  async forget(keys){
    if(game.user?.isGM){
      const cur={...this.world()}; for(const k of keys) delete cur[k]; await game.settings.set(MODULE_ID,"itemMatches",cur);
      for(const u of (game.users?.contents||[...(game.users||[])])) await this._dropFromUser(u,keys);
    } else await this._dropFromUser(game.user,keys);
  }
};

/** GM screen listing remembered item matches. */
class ItemMemoryApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS={ id:`${MODULE_ID}-item-memory`, window:{title:"Remembered Item Matches",resizable:true}, position:{width:680,height:540} };
  async _renderHTML(){
    const root=document.createElement("div"); root.className="cbi cbi-memory";
    const rows=Object.entries(itemMemory.world()).sort((a,b)=>String(a[1].name).localeCompare(String(b[1].name)));
    root.innerHTML=`<div class="cbi-body"><p>When anyone picks an item match by hand during an import, it is remembered here and used automatically for every later import in this world. Forget a row to go back to automatic matching.</p>
      ${rows.length?`<table class="memory-table"><thead><tr><th>Item in the export</th><th>Matched to</th><th>Picked by</th><th></th></tr></thead><tbody>${rows.map(([k,v])=>`<tr><td>${esc(v.name)}</td><td>${esc(v.label||uuidLabelFallback(v.uuid))}</td><td>${esc(v.by||"")}</td><td><button type="button" data-forget="${esc(k)}">Forget</button></td></tr>`).join("")}</tbody></table><p><button type="button" data-forget-all>Forget all</button></p>`:`<p class="muted">Nothing remembered yet.</p>`}</div>`;
    return root;
  }
  _replaceHTML(result,content){
    content.replaceChildren(result);
    content.querySelectorAll("[data-forget]").forEach(b=>b.addEventListener("click",async()=>{ await itemMemory.forget([b.dataset.forget]); this.render(); }));
    content.querySelector("[data-forget-all]")?.addEventListener("click",async()=>{ await itemMemory.forget(Object.keys(itemMemory.world())); this.render(); });
  }
}

/** Plain-text report for bug reports: versions, content found, this import's open questions and recent errors. */
async function diagnosticsReport(app=null){
  const L=[]; const mod=game.modules.get(MODULE_ID), pl=game.modules.get("plutonium"), ddb=game.modules.get("ddb-importer");
  L.push(`D&D Friends Character Importer ${mod?.version||"?"}`);
  L.push(`Foundry ${game.version||game.release?.version||"?"} · ${game.system?.id||"?"} ${game.system?.version||"?"} · ${game.user?.isGM?"GM":"player"}${game.user?.can?.("ACTOR_CREATE")?" (can create actors)":""}`);
  L.push(`Plutonium: ${pl?.active?`active ${pl.version||""}`:"not active"} · DDB Importer: ${ddb?.active?`active ${ddb.version||""}`:"not active"}`);
  L.push(`Index: ${resolver.loaded?"loaded":"not loaded yet"} · ${resolver.packCount??"?"} packs · ${resolver.entries.length} 2024 entries · ${resolver.excludedEntries.length} other entries`);
  L.push(`5etools items: ${plutoniumBridge.rawItems?.length||0} (${plutoniumBridge.itemLoadInfo||"none"}) · raw feats: ${plutoniumBridge.rawFeats?.length||0} · Plutonium item converter: ${plutoniumBridge.itemConverters().length?"yes":"no"}`);
  L.push(`Remembered item matches: ${Object.keys(itemMemory.world()).length} in the world, ${Object.keys(itemMemory.mine()).length} on your user`);
  if(app?.data){
    const d=app.data;
    L.push("",`Character: ${d.Name} · level ${d.Level} · ${d.Race} · ${Object.entries(d.Class||{}).map(([k,v])=>`${k} ${v.Level}${v.Subclass?` (${v.Subclass})`:""}`).join(" / ")}`);
    L.push(`File: ${app.fileName} · Mode: ${app.targetActorId?`update "${game.actors?.get(app.targetActorId)?.name||app.targetActorId}"`:"new character"}${app.savedFrom?" · saved choices restored":""}`);
    for(const x of app.coreDocs||[]) L.push(`  ${x.kind}: ${x.name} → ${x.doc?.name||"?"} [${x.uuid}]`);
    try{ const st=app.importStatus(); for(const [label,list] of [["Must choose",st.block],["Worth a look",st.warn]]) if(list.length){ L.push(`${label}:`); for(const r of list) L.push(`  - ${r.text}`); } }
    catch(e){ L.push(`(could not build the import status: ${e.message})`); }
  }
  if(recentErrors.length){ L.push("","Recent errors:"); for(const e of recentErrors) L.push(`  [${e.at}] ${e.context}: ${e.message}${e.stack?` | ${e.stack}`:""}`); }
  return L.join("\n");
}
async function copyDiagnostics(app=null){
  const text=await diagnosticsReport(app);
  try{ await navigator.clipboard.writeText(text); ui.notifications.info("Diagnostics copied. Paste them into Discord or a GitHub issue."); }
  catch(_){ await foundry.applications.api.DialogV2.prompt({window:{title:"Importer diagnostics"},content:`<p>Copy this text:</p><textarea readonly style="width:100%;height:320px">${esc(text)}</textarea>`,ok:{label:"Close"}}); }
  return text;
}

/* ---------------- Roll20 export: the converter's own Python code, run in the browser with Pyodide ---------------- */
const PYODIDE_DEFAULT="https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";
let pyodidePromise=null;
function loadRoll20Converter(){
  if(pyodidePromise) return pyodidePromise;
  pyodidePromise=(async()=>{
    let base=PYODIDE_DEFAULT; try{ base=game.settings.get(MODULE_ID,"pyodideUrl")||PYODIDE_DEFAULT; }catch(_){}
    base=base.replace(/\/?$/,"/");
    if(!globalThis.loadPyodide) await new Promise((res,rej)=>{ const s=document.createElement("script"); s.src=`${base}pyodide.js`; s.onload=res; s.onerror=()=>rej(new Error(`Could not load the Python runtime from ${base}. Check your internet connection, or set "Python runtime URL" in the module settings.`)); document.head.append(s); });
    const py=await globalThis.loadPyodide({indexURL:base});
    const {CONVERTER_PY:src}=await import("./roll20-converter.js");
    py.FS.writeFile("/home/pyodide/converter.py",src); await py.runPythonAsync("import sys\nif '/home/pyodide' not in sys.path: sys.path.insert(0,'/home/pyodide')\nimport converter");
    return py;
  })();
  pyodidePromise.catch(()=>{ pyodidePromise=null; });
  return pyodidePromise;
}
function actorExportJson(actor){
  const data=actor.toObject?actor.toObject():foundry.utils.deepClone(actor);
  data.flags=data.flags||{}; data.flags.exportSource={world:game.world?.id,system:game.system?.id,coreVersion:game.version,systemVersion:game.system?.version};
  return JSON.stringify(data);
}
function downloadText(name,text,type="application/json"){
  if(typeof globalThis.saveDataToFile==="function") return globalThis.saveDataToFile(text,type,name);
  if(foundry.utils?.saveDataToFile) return foundry.utils.saveDataToFile(text,type,name);
  const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement("a"); a.href=url; a.download=name; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function safeFileName(name){ return String(name||"character").replace(/[^\p{L}\p{N}._-]+/gu,"-").replace(/^-|-$/g,"")||"character"; }

class Roll20ExportApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS={ window:{title:"Export to Roll20",resizable:true}, position:{width:620,height:640} };
  constructor(actor,options={}){ super({...options,id:`${MODULE_ID}-roll20-${actor.id}`}); this.actor=actor; this.status="Loading the converter… The first time downloads the Python runtime (about 10 MB)."; this.manifest=null; this.ability=""; this.effects={}; this.report=""; this.busy=true; this.converterVersion=""; }
  get title(){ return `Export to Roll20: ${this.actor.name}`; }
  async _renderHTML(){
    const root=document.createElement("div"); root.className="cbi cbi-roll20"; const m=this.manifest; const AB={str:"Strength",dex:"Dexterity",con:"Constitution",int:"Intelligence",wis:"Wisdom",cha:"Charisma"};
    root.innerHTML=`<div class="cbi-body"><h2>${esc(this.actor.name)} → Roll20</h2>
      <p class="muted">Makes a JSON file for Roll20's 2014 character sheet, using the same converter as the website${this.converterVersion?` (converter ${esc(this.converterVersion)})`:""}.</p>
      ${m?`<div class="summary"><span>Level ${esc(m.summary?.level??"?")}</span><span>HP ${esc(m.summary?.hp_max??"?")}</span><span>AC ${esc(m.summary?.ac??"?")}</span><span>Speed ${esc(m.summary?.speed??"?")}</span><span>${m.attacks.length} attacks · ${m.spells.length} spells · ${m.resources.filter(r=>r.selected).length} resources</span></div>
        <div class="form-row r20-row"><label>Spellcasting ability</label><select data-r20-ability><option value="">Auto${m.spell_ability?` (${AB[m.spell_ability]||m.spell_ability})`:""}</option>${ABILITIES.map(a=>`<option value="${a}" ${this.ability===a?"selected":""}>${AB[a]}</option>`).join("")}</select></div>
        ${m.effects?.length?`<div class="review-section"><h4>Temporary effects active right now</h4><p class="muted">Ticked effects are baked into the Roll20 sheet. Usually leave Rage, Bless and similar unticked.</p>${m.effects.map(e=>`<label class="r20-effect"><input type="checkbox" data-r20-effect="${esc(e.id)}" ${(this.effects[e.id]??e.included)?"checked":""}> ${esc(e.name)}</label>`).join("")}</div>`:""}
        ${m.warnings?.length?`<div class="warning"><b>Check before converting</b><ul>${m.warnings.map(w=>`<li>${esc(w)}</li>`).join("")}</ul></div>`:""}`:""}
      <p class="cbi-busy-line ${this.error?"error":""}">${esc(this.status)}</p>
      ${this.report?`<details class="review-section"><summary>Conversion report</summary><pre class="r20-report">${esc(this.report)}</pre></details>`:""}
      <p class="muted">In Roll20, import the file with your usual character-import tool, then roll a skill, a weapon and a spell to check it.</p></div>
      <div class="cbi-nav"><span class="nav-left">${this.report?`<button type="button" data-r20-report>Download report</button>`:""}</span><span></span><button type="button" class="create" data-r20-convert ${!m||this.busy?"disabled":""}><i class="fa-solid fa-download"></i> Download Roll20 JSON</button></div>`;
    return root;
  }
  _replaceHTML(result,content){
    content.replaceChildren(result);
    content.querySelector("[data-r20-ability]")?.addEventListener("change",async e=>{ this.ability=e.target.value; await this.loadManifest(); });
    content.querySelectorAll("[data-r20-effect]").forEach(c=>c.addEventListener("change",e=>{ this.effects[e.target.dataset.r20Effect]=e.target.checked; }));
    content.querySelector("[data-r20-convert]")?.addEventListener("click",()=>this.convert());
    content.querySelector("[data-r20-report]")?.addEventListener("click",()=>downloadText(`${safeFileName(this.actor.name)}-roll20-report.txt`,this.report,"text/plain"));
  }
  async _onFirstRender(...args){ await super._onFirstRender?.(...args); this.loadManifest(); }
  async run(code,vars){ const py=await loadRoll20Converter(); for(const [k,v] of Object.entries(vars)) py.globals.set(k,v); return py.runPythonAsync(code); }
  async loadManifest(){
    this.busy=true; this.error=false; this.render();
    try{
      const py=await loadRoll20Converter(); this.converterVersion=py.runPython("import converter; converter.VERSION");
      const text=await this.run("import json, converter\n_m=converter.review_manifest(json.loads(actor_json), chosen_ability or None)\njson.dumps(_m, ensure_ascii=False)",{actor_json:actorExportJson(this.actor),chosen_ability:this.ability});
      this.manifest=JSON.parse(text); this.status="Ready."; 
    }catch(e){ console.error(e); logImportError("Roll20 export (reading the character)",e); this.error=true; this.status=`Could not read the character: ${String(e.message||e).split("\n").filter(Boolean).slice(-1)[0]}`; }
    finally{ this.busy=false; this.render(); }
  }
  async convert(){
    if(this.busy||!this.manifest) return; this.busy=true; this.error=false; this.status="Converting…"; this.render();
    try{
      const effects=Object.fromEntries((this.manifest.effects||[]).map(e=>[e.id,this.effects[e.id]??!!e.included]));
      const out=JSON.parse(await this.run("import json, converter\n_a=json.loads(actor_json)\n_o,_r=converter.convert(_a, chosen_ability or None, None, review=json.loads(review_json))\njson.dumps({'output':json.dumps(_o,ensure_ascii=False,indent=2),'report':converter.report_text(_r),'warnings':len(_r['warnings'])},ensure_ascii=False)",
        {actor_json:actorExportJson(this.actor),chosen_ability:this.ability,review_json:JSON.stringify({effects})}));
      downloadText(`${safeFileName(this.actor.name)}-roll20.json`,out.output); this.report=out.report;
      this.status=`Downloaded ${safeFileName(this.actor.name)}-roll20.json${out.warnings?`. ${out.warnings} item(s) to check are listed in the report`:""}.`;
    }catch(e){ console.error(e); logImportError("Roll20 export",e); this.error=true; this.status=`Conversion failed: ${String(e.message||e).split("\n").filter(Boolean).slice(-1)[0]}`; }
    finally{ this.busy=false; this.render(); }
  }
}
function openRoll20Export(actor){ if(!actor) return; if(actor.type!=="character") return ui.notifications.warn("Only player characters can be exported to Roll20."); new Roll20ExportApp(actor).render({force:true}); }

class ImportWizard extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS={ id:"dnd-friends-character-importer", window:{title:"D&D Friends Character Importer",resizable:true}, position:{width:980,height:760} };
  constructor(options={}){ super(options); this.enabledSources=null; this.sourceSearch=""; this.creating=false; this.busy=""; this.backup=true; this.resetForNewExport(); }
  /** Everything that belongs to one character. Source-filter preferences survive between exports. */
  resetForNewExport(){
    this.step=0; this.data=null; this.fileName=""; this.skills=[]; this.classOrder=[]; this.hpOverride=""; this.matches=new Map(); this.spells=new Set();
    this.equipment=new Map(); this.warnings=[]; this.advChoiceDefs=[]; this.advChoices=new Map(); this.coreDocs=[]; this.featDocs=[]; this.magicInitiateList="wizard";
    this.advSearch=new Map(); this.casterProfiles=new Map(); this.spellClassAssignments=new Map(); this.speciesUuid=null; this.featurePlacementDefs=[];
    this.featurePlacements=new Map(); this.choicePlacements=new Map(); this.grantedSpells=new Map(); this.resilientSave=""; this.ownerId="";
    this.finalTraits={dr:new Set(),di:new Set(),dv:new Set(),ci:new Set(),languages:new Set(),tools:new Set(),senses:{darkvision:"",blindsight:"",tremorsense:"",truesight:""}};
    this.traitsSignature=null; this.spellLevelFilter="all"; this._low=new Set(); this.confirmed=new Set();
    this.remembered=new Set(); this.savedFrom=null; this._pendingSpells=null; this.targetActorId=""; this.sourceText="";
  }
  async _renderHTML(){ const root=document.createElement("div"); root.className="cbi"; root.innerHTML=this.view(); return root; }
  _replaceHTML(result,content){ content.replaceChildren(result); this.bind(content); }
  /** Re-render without jumping back to the top of the step. */
  async rerender(){ const top=this.element?.querySelector(".cbi-body")?.scrollTop||0; await this.render(); const body=this.element?.querySelector(".cbi-body"); if(body) body.scrollTop=top; }
  setBusy(msg=""){ this.busy=msg; const el=this.element?.querySelector(".cbi-busy"); if(el) el.textContent=msg; this.element?.querySelectorAll("[data-act]").forEach(b=>b.disabled=!!msg||(b.dataset.act==="next"&&!this.data)); }
  /** Hit die per class from the matched class documents, e.g. {psion: 6}. */
  hitDiceByClass(){ const out={}; for(const x of this.coreDocs||[]) if(x.kind==="class"){ const n=parseInt(String(x.doc?.system?.hd?.denomination||x.doc?.system?.hitDice||"").replace(/^d/i,""),10); if(n) out[norm(x.name)]=n; } return out; }
  characterLevel(){ return Number(this.data?.Level||0)||defaultClassOrder(this.data||{}).length||1; }

  speciesCandidates(){
    if(!this.data)return[]; const base=normalizeSpeciesName(this.data.Race), bn=norm(base);
    const rows=resolver.entries.filter(e=>resolver.allowed(e)&&e.type==="race").filter(e=>{const n=norm(normalizeSpeciesName(e.name)),raw=norm(e.name);return n===bn||raw.startsWith(`${bn} (`)||raw.startsWith(`${bn} -`);}).sort((a,b)=>(resolver.priority(b)-resolver.priority(a))||a.name.localeCompare(b.name));
    const out=[],seen=new Set();for(const e of rows){const k=`${norm(e.name)}:${plutoniumSourceKey(e)||e.source?.book||""}`;if(seen.has(k))continue;seen.add(k);out.push(e);}return out;
  }
  selectedSpeciesEntry(){const cs=this.speciesCandidates();if(this.speciesUuid){const e=cs.find(x=>x.uuid===this.speciesUuid);if(e)return e;}const lin=norm(speciesLineage(this.data?.Race));if(lin){const e=cs.find(x=>norm(x.name).split(" ").includes(lin.split(" ")[0]));if(e)return e;}const exact=cs.find(x=>norm(normalizeSpeciesName(x.name))===norm(normalizeSpeciesName(this.data?.Race)));return exact||cs[0]||(this.data?.Race?resolver.best(normalizeSpeciesName(this.data.Race),["race"]):null);}
  /** Size written in the bot's species name, e.g. "Human (Small)". */
  botSize(){ const m=/\((tiny|small|medium|large|huge|gargantuan)\)\s*$/i.exec(String(this.data?.Race||"")); return m?SIZE_KEYS[m[1].toLowerCase()]:""; }
  placementSelect(key,guess="other"){const v=this.featurePlacements.get(key)||guess;if(!this.featurePlacements.has(key))this.featurePlacements.set(key,v);return `<select data-feature-placement="${esc(key)}">${FEATURE_PLACEMENTS.map(k=>`<option value="${k}" ${v===k?'selected':''}>${placementLabel(k)}</option>`).join("")}</select>`;}
  choicePlacementSelect(def){const guess=placementKindFromSource(def.sourceKind==="feat"?"other":def.sourceKind),v=this.choicePlacements.get(def.id)||guess;if(!this.choicePlacements.has(def.id))this.choicePlacements.set(def.id,v);return `<select data-choice-placement="${esc(def.id)}" title="Controls where this imported feature is grouped on the character sheet. This is display/organization only and does not change the feature's rules.">${FEATURE_PLACEMENTS.map(k=>`<option value="${k}" ${v===k?'selected':''}>Group under ${placementLabel(k)}</option>`).join("")}</select>`;}
  choiceHelp(def){
    if(def.type==="fighting-style")return `Choose one Fighting Style. The importer now shows the full standard Fighting Style list even when Foundry's class advancement only exposes a partial UUID pool, then prefers a real compendium/UA feat document when one exists. “Group under” only changes sheet organization.`;
    if(def.type==="weapon-mastery")return `Choose the weapon(s) this feature gives you Mastery with. You cannot select the same mastery weapon twice across these choices. “Group under” only changes sheet organization.`;
    if(def.type==="spell-choice")return `Choose the spell(s) granted by this feature. The importer filters the enabled spell data using the feature's level/list restrictions when those restrictions are available.`;
    if(def.type==="trait")return `Choose the proficiency, language, resistance, or other trait granted by this feature. Select exactly the number shown.`;
    return `Choose exactly ${def.count} option${Number(def.count)===1?"":"s"} granted by this feature. “Group under” only changes where the imported feature is organized on the sheet; it does not change its mechanics.`;
  }
  async rebuildFeaturePlacementDefs(){
    const defs=[],seen=new Set(),add=(key,name,guess,ownerName="")=>{if(!name||seen.has(key))return;seen.add(key);defs.push({key,name,guess,ownerName});if(!this.featurePlacements.has(key))this.featurePlacements.set(key,guess);};
    for(const src of this.coreDocs)for(const adv of advancementEntries(src.doc,src.level,src.isPrimary))if(adv.type==="ItemGrant")for(const it of (adv.configuration?.items||[])){const d=await this.advancementDocData(src.doc,it.uuid);if(d&&d.type!=="spell")add(featurePlacementKey(`${src.kind}:${src.name}`,d.name),d.name,placementKindFromSource(src.kind),src.doc?.name||src.name);}
    const origin=getOriginFeat(this.data);if(origin)add(featurePlacementKey("server-origin",origin),origin,"background","");
    for(const raw of (this.data.Feats||[])){const f=canonicalFeatName(raw);if(f&&norm(f)!==norm(origin))add(featurePlacementKey("feat",f),f,"other","");}
    this.featurePlacementDefs=defs;
  }
  featurePlacementView(){if(!this.featurePlacementDefs.length)return"";return `<details class="feature-placement"><summary>Feature Placement <small>display organization only</small></summary><p class="muted">These choices control where the finished Foundry sheet displays each feature. Rules, effects, activities, and uses are unchanged.</p><div class="placement-list">${this.featurePlacementDefs.map(d=>`<div class="placement-row"><span><b>${esc(d.name)}</b>${d.ownerName?`<small>Detected from ${esc(d.ownerName)}</small>`:""}</span>${this.placementSelect(d.key,d.guess)}</div>`).join("")}</div></details>`;}

  /** Spellcasting may come from the class or, for Eldritch Knight / Arcane Trickster, from the subclass. */
  castingSourceFor(cn){
    const cls=this.coreDocs.find(x=>x.kind==="class"&&norm(x.name)===norm(cn)); const sub=this.coreDocs.find(x=>x.kind==="subclass"&&norm(x.className)===norm(cn));
    const csc=cls?.doc?.system?.spellcasting||{}, ssc=sub?.doc?.system?.spellcasting||{};
    const hasClass=csc.progression&&csc.progression!=="none", hasSub=ssc.progression&&ssc.progression!=="none";
    const subName=norm(sub?.doc?.name||sub?.name||"");
    const knownThird=/eldritch knight|arcane trickster/.test(subName);
    if(!hasClass&&(hasSub||knownThird)){
      const ident=sub?.doc?.system?.identifier||subName.replace(/ /g,"-");
      return {key:ident?`subclass:${ident}`:"",progression:hasSub?ssc.progression:"third",ability:(hasSub&&ssc.ability)||"int",listClass:"wizard",via:sub?.doc?.name||sub?.name};
    }
    const ident=cls?.doc?.system?.identifier||norm(cn).replace(/ /g,"-");
    return {key:`class:${ident}`,progression:hasClass?csc.progression:"",ability:csc.ability||"",listClass:cn,via:""};
  }
  ensureCasterProfiles(){
    const valid=new Set(Object.keys(this.data?.Class||{}).map(norm));
    for(const key of [...this.casterProfiles.keys()]) if(!valid.has(norm(key)))this.casterProfiles.delete(key);
    for(const [cn,c] of Object.entries(this.data?.Class||{})){
      const src=this.castingSourceFor(cn); const old=this.casterProfiles.get(cn)||{};
      const progression=old.progression??(src.progression||defaultProgressionForClass(cn)); const ability=old.ability??(src.ability||defaultCastingAbility(cn));
      this.casterProfiles.set(cn,{casterLevel:old.casterLevel??Number(c.Level||0),progression,ability,maxOverride:old.maxOverride??"",listClass:src.listClass||cn,via:src.via});
    }
  }
  casterProfileRows(){
    return [...this.casterProfiles.entries()].map(([cn,p])=>{ const auto=maxSpellLevelForProgression(p.progression,p.casterLevel), max=p.maxOverride!==""?Number(p.maxOverride):auto; return `<div class="caster-profile"><b>${esc(cn)}${p.via?`<small>via ${esc(p.via)} (${esc(p.listClass)} list)</small>`:""}</b><label>Class Level <input data-caster-level="${esc(cn)}" type="number" min="0" max="20" value="${Number(p.casterLevel||0)}"></label><label>Progression <select data-caster-progression="${esc(cn)}">${["none","full","half","third","pact"].map(v=>`<option value="${v}" ${p.progression===v?'selected':''}>${v[0].toUpperCase()+v.slice(1)}</option>`).join("")}</select></label><label>Ability <select data-caster-ability="${esc(cn)}">${ABILITIES.map(a=>`<option value="${a}" ${p.ability===a?'selected':''}>${a.toUpperCase()}</option>`).join("")}</select></label><label>Max Spell Level <input data-caster-max="${esc(cn)}" type="number" min="0" max="9" placeholder="Auto ${auto}" value="${esc(p.maxOverride)}"></label><small>Current cap: ${max}${(()=>{const lim=this.spellLimitsFor(cn);return lim?`<br>Limits: ${lim.cantrips??0} cantrips, ${lim.prepared??"?"} prepared <span class="muted">(${lim.source})</span>`:"";})()}</small></div>`; }).join("");
  }
  async buildGrantedSpells(){
    this.grantedSpells=new Map();
    for(const src of this.coreDocs.filter(x=>x.kind==="subclass")){
      for(const adv of advancementEntries(src.doc,src.level,src.isPrimary))if(adv.type==="ItemGrant")for(const it of (adv.configuration?.items||[])){
        const feat=await this.advancementDocData(src.doc,it.uuid);if(!feat||feat.type==="spell")continue;
        const refs=spellRefsFromHtml(feat.system?.description?.value||"",src.level);if(!refs.length)continue;
        const ownerClass=src.className||Object.keys(this.data.Class||{})[0];
        for(const r of refs){const matches=resolver.candidates(r.name,["spell"]);const e=matches.find(x=>!r.source||norm(x.plutonium?.source||x.source?.book||"").includes(norm(r.source)))||matches[0];if(e)this.grantedSpells.set(e.uuid,{uuid:e.uuid,name:e.name,source:r.source,ownerClass,ownerSubclass:src.name,subclassIdentifier:src.doc?.system?.identifier||"",feature:feat.name});}
      }
    }
  }
  choicesSignature(){ return JSON.stringify([[...this.advChoices.entries()],this.skills,[...this.matches.entries()].filter(([k])=>k.startsWith("feat:")||k.startsWith("eq:")),this.speciesUuid]); }
  async refreshDetectedTraits(){
    // Re-detect whenever earlier choices changed; manual edits on this step are kept otherwise.
    const sig=this.choicesSignature(); if(this.traitsSignature===sig) return; this.traitsSignature=sig;
    this.finalTraits={dr:new Set(),di:new Set(),dv:new Set(),ci:new Set(),languages:new Set(),tools:new Set(),senses:{darkvision:"",blindsight:"",tremorsense:"",truesight:""}};
    const add=(kind,v)=>{for(const x of splitTraitValues(v)){const k=traitKey(x).split(":").pop();if(k&&k!=="*")this.finalTraits[kind]?.add(k);}};
    const scanDoc=d=>{if(!d)return;for(const ef of effectObjects(d))for(const ch of (ef.changes||ef.system?.changes||[])){const k=String(ch.key||"");const t=k.match(/^system\.traits\.(dr|di|dv|ci|languages)\.value$/);if(t)add(t[1],ch.value);else{const m=k.match(/system\.attributes\.senses\.(?:ranges\.)?(darkvision|blindsight|tremorsense|truesight)/);if(m){const n=Number(ch.value);if(Number.isFinite(n)&&n>0)this.finalTraits.senses[m[1]]=String(Math.max(n,Number(this.finalTraits.senses[m[1]]||0)));}}}};
    const native=await this.collectNativeAdvancementData();
    for(const [k,v] of Object.entries(native.updates||{})){const t=k.match(/^system\.traits\.(dr|di|dv|ci|languages)\.value$/);if(t)add(t[1],v);const m=k.match(/^system\.tools\.([^.]+)\.value$/);if(m&&Number(v)>0)this.finalTraits.tools.add(m[1]);}
    for(const d of native.embeds) scanDoc(d);
    for(const src of [...this.coreDocs,...this.featDocs]) scanDoc(src.doc);
    for(const f of uniqueFeatNames(this.data)){const u=this.matches.get(`feat:${f}`);if(u&&!String(u).startsWith("__"))scanDoc(await this.docData(u));}
    const owned=flattenOwned(this.data);for(let i=0;i<owned.length;i++){const u=this.matches.get(`eq:${i}`);if(u&&!String(u).startsWith("__"))scanDoc(await this.docData(u));}
  }
  traitChecklist(title,kind,options){const set=this.finalTraits[kind];const known=new Set(options.map(o=>typeof o==="string"?o:o.value));const extra=[...set].filter(v=>!known.has(v));return `<div class="trait-editor-group"><h4>${title}</h4><div class="trait-grid">${[...options,...extra].map(o=>{const value=typeof o==="string"?o:o.value,label=typeof o==="string"?o.replace(/\b\w/g,c=>c.toUpperCase()):o.label;return `<label><input type="checkbox" data-final-trait="${kind}" value="${esc(value)}" ${set.has(traitKey(value))?'checked':''}> ${esc(label)}</label>`;}).join("")}</div></div>`;}
  finalTraitsView(){
    const groups=configLanguageGroups(); const toOpts=g=>g.map(([label,value])=>({label,value}));
    const allLang=new Set(Object.values(groups).flat().map(([,v])=>v)); const extraLang=[...this.finalTraits.languages].filter(v=>!allLang.has(v)).map(v=>({label:languageLabel(v),value:v}));
    const langGrid=opts=>`<div class="trait-grid">${opts.map(o=>`<label><input type="checkbox" data-final-trait="languages" value="${esc(o.value)}" ${this.finalTraits.languages.has(traitKey(o.value))?'checked':''}> ${esc(o.label)}</label>`).join("")}</div>`;
    const tools=TOOL_OPTIONS_2024.map(([label,value])=>({label,value}));
    return `<section><h2>Final Traits</h2><p>Detected values are preselected. Add or remove anything needed before the actor is created. Changing earlier choices re-detects this page.</p>${this.traitChecklist("Damage Resistances","dr",DAMAGE_TYPES)}${this.traitChecklist("Damage Immunities","di",DAMAGE_TYPES)}${this.traitChecklist("Damage Vulnerabilities","dv",DAMAGE_TYPES)}${this.traitChecklist("Condition Immunities","ci",CONDITION_TYPES)}<div class="trait-editor-group"><h4>Senses</h4><div class="sense-grid">${SENSE_TYPES.map(k=>`<label>${k.replace(/\b\w/g,c=>c.toUpperCase())} <input type="number" min="0" data-final-sense="${k}" value="${esc(this.finalTraits.senses[k]||"")}" placeholder="ft"></label>`).join("")}</div></div><div class="trait-editor-group"><h4>Languages</h4><h5>Standard Languages</h5>${langGrid(toOpts(groups.standard))}<h5>Exotic Languages</h5>${langGrid(toOpts(groups.exotic))}${groups.special.length?`<h5>Secret Languages</h5>${langGrid(toOpts(groups.special))}`:""}${extraLang.length?`<h5>Other Detected</h5>${langGrid(extraLang)}`:""}</div><div class="trait-editor-group"><h4>Tool Proficiencies</h4><p class="muted">Select every tool proficiency the character should have. Unticking a detected tool removes it.</p><div class="trait-grid tool-grid">${tools.map(o=>`<label><input type="checkbox" data-final-trait="tools" value="${esc(o.value)}" ${this.finalTraits.tools.has(traitKey(o.value))?'checked':''}> ${esc(o.label)}</label>`).join("")}</div></div></section>`;
  }

  async prepareCharacterMetadata(){
    if(!this.data) return;
    this.setBusy("Matching species, classes and subclasses…");
    try{
      this.coreDocs=[];
      const first=norm(this.classOrder[0]||""); const charLevel=this.characterLevel();
      const race=this.selectedSpeciesEntry(); if(race){this.speciesUuid=race.uuid;const d=await getDoc(race.uuid);if(d)this.coreDocs.push({kind:"race",name:normalizeSpeciesName(this.data.Race),doc:d,uuid:race.uuid,level:charLevel,isPrimary:true});}
      for(const [cn,c] of Object.entries(this.data.Class||{})){
        const m=resolver.bestClass(cn); let classDoc=null;
        if(m){classDoc=await getDoc(m.uuid);if(classDoc)this.coreDocs.push({kind:"class",name:cn,doc:classDoc,uuid:m.uuid,level:Number(c.Level||1),isPrimary:norm(cn)===first});}
        if(c.Subclass){const sm=resolver.bestSubclass(c.Subclass,classDoc?.system?.identifier||norm(cn).replace(/ /g,"-"));if(sm){const sd=await getDoc(sm.uuid);if(sd)this.coreDocs.push({kind:"subclass",name:c.Subclass,className:cn,doc:sd,uuid:sm.uuid,level:Number(c.Level||1),isPrimary:norm(cn)===first});}}
      }
      this.ensureCasterProfiles();
      this.setBusy("Loading feat and spell data…");
      await plutoniumBridge.buildFeatIndex();
      await plutoniumBridge.buildItemIndex();
      await plutoniumBridge.buildSpellClassMap();
      await this.rebuildChoiceDefs();
      await this.buildGrantedSpells();
      await this.rebuildFeaturePlacementDefs();
    } finally { this.setBusy(""); }
  }
  /** Advancement choice definitions for species, classes, subclasses and every matched feat. */
  async rebuildChoiceDefs(){
    const defs=[]; for(const src of this.coreDocs) defs.push(...await this.choiceDefsFor(src));
    this.advChoiceDefs=defs; await this.buildFeatDocs();
    for(const src of this.featDocs) defs.push(...await this.choiceDefsFor(src));
    this.advChoiceDefs=defs;
    const ids=new Set(defs.map(d=>d.id)); for(const k of [...this.advChoices.keys()]) if(!ids.has(k)) this.advChoices.delete(k);
    const lin=norm(speciesLineage(this.data?.Race));
    if(lin) for(const d of defs) if(d.sourceKind==="race"&&!this.advChoices.has(d.id)){
      const hits=(d.options||[]).filter(o=>norm(o.label).split(" ").includes(lin.split(" ")[0])).slice(0,d.count);
      if(hits.length) this.advChoices.set(d.id,hits.map(o=>o.value));
    }
  }
  /** Feats whose own advancements must run: the server Origin feat, bot feats, and feats picked through advancement choices. */
  /** Default database matches for the bot's feats (exact name for the Origin feat, best candidate otherwise). */
  ensureFeatMatches(){
    const origin=getOriginFeat(this.data);
    for(const f of uniqueFeatNames(this.data)){
      const id=`feat:${f}`; if(this.matches.has(id)) continue;
      if(norm(f)===norm(origin)){ const exact=this.featSearchCandidates(origin,true).find(r=>r._searchScore>=120); if(exact) this.matches.set(id,exact.uuid); }
      else { const top=this.matchCandidates(f,["feat"])[0]; this.matches.set(id,top?.uuid||"__placeholder__"); }
    }
  }
  async buildFeatDocs(){
    this.ensureFeatMatches();
    const out=[], seen=new Set(), level=this.characterLevel();
    const push=async(name,uuid,key)=>{ if(!uuid||String(uuid).startsWith("__")||seen.has(key)) return; seen.add(key); const doc=await getDoc(uuid); if(doc&&doc.type==="feat"&&advancementList(doc).length) out.push({kind:"feat",name,doc,uuid:doc.uuid,level,isPrimary:true,key}); };
    for(const f of uniqueFeatNames(this.data)) await push(f,this.magicInitiateVariantUuid(this.matches.get(`feat:${f}`)),`feat:${norm(f)}`);
    for(const d of this.advChoiceDefs) if(["origin-search","item"].includes(d.type)) for(const u of (this.advChoices.get(d.id)||[])){ const e=this.featEntryById(u); if(e?.type==="feat") await push(originChoiceCanonicalName(e.name),this.magicInitiateVariantUuid(u),`choice:${d.id}:${u}`); }
    this.featDocs=out;
  }
  async choiceDefsFor(src){
    const defs=[];
    for(const adv of advancementEntries(src.doc,src.level,src.isPrimary)){
      const base={id:`${src.kind}:${src.name}:${adv._id}`,sourceKind:src.kind,sourceName:src.doc?.name||src.name,level:Number(adv.level??0),mode:adv.configuration?.mode||"default",isMagicInitiate:/^magic initiate/i.test(String(src.doc?.name||""))};
      if(adv.type==="Trait" && traitChoiceCount(adv)>0){
        const pool=[...new Set((adv.configuration?.choices||[]).flatMap(c=>c.pool||[]))];
        const isMastery=base.mode==="mastery"||/weapon\s*mastery/i.test(String(adv.title||""))||(pool.length>0&&pool.every(x=>/weapon.*master/i.test(String(x).split(":")[0])));
        let options;
        if(isMastery){ options=weaponMasteryPoolOptions(pool,true); if(!options?.length) options=weaponMasteryPoolOptions(["*"],true); }
        else options=expandTraitPool(pool);
        const title=adv.title||(base.mode==="expertise"?"Expertise":"Trait Choice");
        defs.push({...base,type:isMastery?"weapon-mastery":"trait",title,count:traitChoiceCount(adv),options});
      }else if(adv.type==="ItemChoice"){
        const count=itemChoiceCount(adv,src.level); if(!count)continue;
        const restriction=adv?.configuration?.restriction||{};
        if(restriction.type==="feat" && restriction.subtype==="origin"){
          defs.push({...base,type:"origin-search",title:adv.title||"Origin Feat",count,options:[]});
        }else if(/fighting\s*style/i.test(String(adv.title||""))){
          // Merge the advancement's own pool with indexed and raw-UA Fighting Style feats.
          // Resolve relative advancement UUID labels against the owning class/subclass document.
          const native=await resolveChoicePool(adv);
          for(const raw of (adv?.configuration?.pool||[])){
            const uuid=typeof raw==="string"?raw:raw?.uuid;if(!uuid||!String(uuid).startsWith("."))continue;
            if(native.some(x=>x.uuid===uuid && x.name && x.name!==uuidLabelFallback(uuid)))continue;
            const d=await this.advancementDocData(src.doc,uuid);if(!d?.name)continue;
            const hit=native.find(x=>x.uuid===uuid);if(hit)hit.name=d.name;else native.push({uuid,name:d.name});
          }
          defs.push({...base,type:"fighting-style",title:adv.title||"Fighting Style",count,options:fightingStyleOptions(native)});
        }else{
          let opts=(await resolveChoicePool(adv)).map(x=>({value:x.uuid,label:x.name}));
          let type="item";
          if(!opts.length&&restriction.type==="spell"){ opts=this.spellChoiceOptions(restriction,base.isMagicInitiate); type="spell-choice"; }
          defs.push({...base,type,title:adv.title||"Feature Choice",count,options:opts,spellConfig:adv.configuration?.spell||null});
        }
      }
    }
    return defs;
  }
  /** Spell options for an ItemChoice restricted by spell level / spell list (e.g. Magic Initiate). */
  spellChoiceOptions(restriction={},magicInitiate=false){
    const lvl=restriction.level===""||restriction.level===undefined||restriction.level==="available"?null:Number(restriction.level);
    let lists=[...(restriction.list||[])].map(x=>norm(String(x).split(":").pop()));
    if(magicInitiate) lists=[norm(this.magicInitiateList||"wizard")];
    const byName=new Map();
    for(const e of resolver.entries.filter(x=>resolver.allowed(x)&&x.type==="spell").sort((a,b)=>resolver.priority(b)-resolver.priority(a))){
      if(lvl!==null&&Number(e.level||0)!==lvl) continue;
      if(lists.length){ const set=plutoniumBridge.spellClassMap.get(norm(e.name)); if(set?.size&&!lists.some(l=>set.has(l))) continue; if(!set?.size&&plutoniumBridge.spellClassMap.size) continue; }
      const k=norm(e.name); if(!byName.has(k)) byName.set(k,{value:e.uuid,label:e.name});
    }
    return [...byName.values()].sort((a,b)=>a.label.localeCompare(b.label));
  }

  featSearchCandidates(query="",versatile=false){
    // Live search over every indexed 2024 feat; 5etools/Plutonium category metadata is too inconsistent to pre-filter.
    const q=norm(query); if(q.length<2)return [];
    const base=[...resolver.entries.filter(e=>resolver.allowed(e)&&e.type==="feat"),...plutoniumBridge.rawFeatEntries(this.enabledSources)];
    const stop=new Set(["a","an","the","of","and","or"]); const toks=q.split(" ").filter(t=>t&&!stop.has(t));
    const rows=base.map(e=>{const n=norm(e.name||"");let score=0;if(n===q)score=120;else if(n.startsWith(q))score=105;else if(n.includes(q))score=95;else if(toks.length&&toks.every(t=>n.includes(t)))score=80+toks.filter(t=>n.split(" ").includes(t)).length;return {...e,_searchScore:score};}).filter(e=>e._searchScore>0);
    rows.sort((a,b)=>(b._searchScore-a._searchScore)||((String(a.uuid).startsWith("__rawfeat__")?1:0)-(String(b.uuid).startsWith("__rawfeat__")?1:0))||(resolver.priority(b)-resolver.priority(a))||String(a.name).localeCompare(String(b.name)));
    const out=[],seen=new Set();
    for(const e of rows){const label=originChoiceCanonicalName(e.name),src=String(e.plutonium?.source||e.source?.book||"");const k=`${norm(label)}|${norm(src)}`;if(!label||seen.has(k))continue;seen.add(k);out.push({...e,displayName:label});if(out.length>=30)break;}
    return out;
  }
  featEntryById(id){const synth=syntheticFightingStyleName(id);if(synth)return {name:synth,type:"feat",uuid:id,source:{book:"Fighting Style fallback",rules:"2024"}};return resolver.entries.find(e=>e.uuid===id)||resolver.excludedEntries.find(e=>e.uuid===id)||(String(id||"").startsWith("__rawfeat__")?plutoniumBridge.rawFeatEntry(plutoniumBridge.rawFeatFromId(id)||{}):null);}
  sourceGroupLabel(kind){ return ({race:"Species Features",class:"Class Features",subclass:"Subclass Features",feat:"Feat Choices"})[kind]||"Other Features"; }
  choiceHeading(def){ const lvl=Number(def.level||0); return `${esc(def.title)}${def.mode==="expertise"?' <span class="adv-level">Expertise</span>':""}${lvl>0?` <span class="adv-level">Level ${lvl}</span>`:""}`; }
  choiceSelectionLabels(def){
    const sel=this.advChoices.get(def.id)||[];
    return sel.map(v=>{ const o=def.options?.find(x=>x.value===v); if(o?.label)return o.label; const e=resolver.entries.find(x=>x.uuid===v); if(e?.name)return originChoiceCanonicalName(e.name); return traitLabel(v)||String(v); });
  }
  requiredCount(def){ return def.type==="origin-search"?def.count:Math.min(def.count,def.options?.length||0); }
  advancementGroupsView(){
    const order=["race","class","subclass","feat","other"]; const groups=new Map();
    for(const d of this.advChoiceDefs){ const k=order.includes(d.sourceKind)?d.sourceKind:"other"; if(!groups.has(k))groups.set(k,[]); groups.get(k).push(d); }
    return order.filter(k=>groups.has(k)).map(k=>`<div class="feature-source-group"><h3>${this.sourceGroupLabel(k)}</h3>${groups.get(k).map(d=>`<div class="feature-source"><div class="feature-source-title">${esc(d.sourceName||"")}</div>${this.choiceBlock(d)}</div>`).join("")}</div>`).join("");
  }
  originSearchBlock(def){
    const sel=this.advChoices.get(def.id)||[]; const selected=sel[0]?this.featEntryById(sel[0]):null;
    const q=this.advSearch.get(def.id)||""; const results=this.featSearchCandidates(q,true);
    return `<div class="adv-choice origin-search-choice"><h4>${this.choiceHeading(def)} <small>Choose ${def.count}</small></h4><div class="choice-placement">${this.choicePlacementSelect(def)}</div><p class="muted">Type the feat name to search every indexed 2024 feat from the enabled sources, then choose the result that is legal on your server.</p><div class="origin-selected" data-origin-selected="${esc(def.id)}">${selected?`<b>Selected:</b> ${esc(originChoiceCanonicalName(selected.name))}<small>${esc(selected.plutonium?.source||selected.source?.book||selected.uuid)}</small>`:`<b>No feat selected.</b>`}</div><input class="search" data-origin-search="${esc(def.id)}" value="${esc(q)}" placeholder="Search feat name, e.g. Mark of Warding"><div class="origin-results" data-origin-results="${esc(def.id)}"></div></div>`;
  }
  magicInitiateSelect(){ return `<div class="form-row mi-row"><label>Magic Initiate spell list</label><select data-magic-initiate-list>${["cleric","druid","wizard"].map(v=>`<option value="${v}" ${this.magicInitiateList===v?'selected':''}>${v[0].toUpperCase()+v.slice(1)}</option>`).join("")}</select></div>`; }
  choiceBlock(def){
    if(def.type==="origin-search") return this.originSearchBlock(def);
    const sel=this.advChoices.get(def.id)||[]; const required=this.requiredCount(def);
    const mi=def.options.find(o=>o.label==="Magic Initiate"); const miSelected=!!mi&&sel.includes(mi.value);
    const empty=!def.options.length?`<div class="warning">No options were found for this choice in the enabled sources. It will be listed for manual follow-up after import.</div>`:def.options.length<def.count?`<div class="warning">Only ${def.options.length} option(s) found for ${def.count} picks. The rest will be listed for manual follow-up.</div>`:"";
    const help=this.choiceHelp(def);
    return `<div class="adv-choice" data-choice-def="${esc(def.id)}"><h4>${this.choiceHeading(def)} <small>Choose ${def.count}</small> <span class="choice-help" title="${esc(help)}" aria-label="${esc(help)}" tabindex="0"><i class="fa-solid fa-circle-question"></i></span></h4><div class="choice-placement">${this.choicePlacementSelect(def)}</div><p class="choice-instructions">${esc(help)}</p>${def.isMagicInitiate&&def.type==="spell-choice"?this.magicInitiateSelect():""}${empty}<div class="skill-grid">${def.options.map(o=>`<label title="Select ${esc(o.label)} for ${esc(def.title||'this feature')}"><input data-adv-choice="${esc(def.id)}" value="${esc(o.value)}" type="checkbox" ${sel.includes(o.value)?'checked':''} ${!sel.includes(o.value)&&sel.length>=required?'disabled':''}> ${esc(o.label)}</label>`).join("")}</div>${mi?`<div data-mi-wrap="${esc(def.id)}" style="${miSelected?'':'display:none'}">${this.magicInitiateSelect()}</div>`:""}</div>`;
  }
  view(){ const heads=["Upload","Core & HP","Skills & Feats","Spells","Equipment","Final Traits","Review"]; return `<div class="cbi-steps">${heads.map((h,i)=>`<div class="${i===this.step?'active':''} ${i<this.step?'done':''}">${i+1}. ${h}</div>`).join("")}</div><div class="cbi-body">${[this.uploadView,this.coreView,this.choiceView,this.spellView,this.equipView,this.finalTraitsView,this.reviewView][this.step].call(this)}</div><div class="cbi-nav">${this.step?`<span class="nav-left"><button type="button" data-act="back"><i class="fa-solid fa-arrow-left"></i> Back</button>${this.data?'<button type="button" data-act="overview">Overview</button>':""}</span>`:'<span></span>'}<span class="cbi-busy" role="status">${esc(this.busy)}</span>${this.step<6?`<button type="button" data-act="next" ${!this.data||this.busy?'disabled':''}>Next <i class="fa-solid fa-arrow-right"></i></button>`:`<button type="button" class="create" data-act="create" ${this.creating?'disabled':''}><i class="fa-solid ${this.targetActorId?"fa-arrows-rotate":"fa-user-plus"}"></i> ${this.targetActorId?"Update Actor":"Create Actor"}</button>`}</div>`; }
  sourceFilterView(){
    const merged=new Map();for(const x of [...resolver.plutoniumSources(),...plutoniumBridge.rawFeatSources()])merged.set(x.code,(merged.get(x.code)||0)+x.count);const sources=[...merged.entries()].map(([code,count])=>({code,count})).sort((a,b)=>a.code.localeCompare(b.code)); if(!sources.length)return"";
    if(this.enabledSources===null){ this.enabledSources=new Set(sources.map(x=>x.code)); resolver.setEnabledPlutoniumSources(this.enabledSources); }
    const q=norm(this.sourceSearch); const shown=sources.filter(x=>!q||norm(x.code).includes(q));
    return `<details class="source-filter" ${this.data?'':'open'}><summary>5etools / Plutonium Sources <small>${this.enabledSources.size}/${sources.length} enabled</small></summary><p class="muted">Native dnd5e 2024 content is always available. These switches control Plutonium/5etools material used for feats, spells, items, subclasses, and matching.</p><div class="source-toolbar"><input class="search" data-source-search value="${esc(this.sourceSearch)}" placeholder="Filter source codes…"><button type="button" data-source-all>Enable All</button><button type="button" data-source-none>Disable All</button></div><div class="source-grid">${shown.map(x=>`<label data-source-row="${esc(norm(x.code))}"><input type="checkbox" data-source-code="${esc(x.code)}" ${this.enabledSources.has(x.code)?"checked":""}><span>${esc(sourceDisplayName(x.code))}</span><small>${x.count}</small></label>`).join("")}</div></details>`;
  }
  /** Everything chosen in the wizard, saved on the actor so a re-import or level-up starts from it. */
  snapshotChoices(){
    const owned=flattenOwned(this.data||{}); const equipment={};
    owned.forEach((x,i)=>{ const id=`eq:${i}`, st=this.equipment.get(id)||{}, rec={};
      if(this.confirmed.has(id)||this.remembered.has(id)) rec.uuid=this.matches.get(id)||"";
      if("equipped" in st) rec.equipped=!!st.equipped; if("attuned" in st) rec.attuned=!!st.attuned;
      if(Object.keys(rec).length) equipment[x.key]=rec; });
    const sets=k=>[...this.finalTraits[k]];
    return { module:moduleVersion(), savedAt:Date.now(), level:this.characterLevel(), skills:[...this.skills], classOrder:[...this.classOrder], hpOverride:this.hpOverride||"",
      featMatches:Object.fromEntries([...this.matches].filter(([k])=>k.startsWith("feat:"))), equipment,
      spells:[...this.spells], spellClassAssignments:Object.fromEntries(this.spellClassAssignments), advChoices:Object.fromEntries(this.advChoices),
      magicInitiateList:this.magicInitiateList, casterProfiles:Object.fromEntries([...this.casterProfiles].map(([k,p])=>[k,{progression:p.progression,ability:p.ability,maxOverride:p.maxOverride??""}])),
      speciesUuid:this.speciesUuid||"", featurePlacements:Object.fromEntries(this.featurePlacements), choicePlacements:Object.fromEntries(this.choicePlacements),
      resilientSave:this.resilientSave||"", featBonusesInStats:!!this.data?.__featBonusesInStats,
      finalTraits:{dr:sets("dr"),di:sets("di"),dv:sets("dv"),ci:sets("ci"),languages:sets("languages"),tools:sets("tools"),senses:{...this.finalTraits.senses}} };
  }
  /** Restore a snapshot before matching runs. Choices whose source no longer exists are dropped by the normal rebuild. */
  applySavedChoices(saved){
    if(!saved||typeof saved!=="object"||!this.data) return false;
    this.savedFrom=saved;
    if(Array.isArray(saved.skills)&&saved.skills.length===2&&saved.skills.every(k=>SKILLS[k])) this.skills=[...saved.skills];
    if(Array.isArray(saved.classOrder)&&saved.classOrder.length){
      // Keep the saved order for the levels the character already had, then add any new levels.
      const left=Object.fromEntries(Object.entries(this.data.Class||{}).map(([cn,c])=>[cn,Number(c.Level||0)])); const out=[];
      for(const cn of saved.classOrder) if(left[cn]>0){ out.push(cn); left[cn]--; }
      for(const cn of defaultClassOrder(this.data)) if(left[cn]>0){ out.push(cn); left[cn]--; }
      if(out.length) this.classOrder=out;
    }
    if(saved.hpOverride&&Number(saved.level)===this.characterLevel()) this.hpOverride=saved.hpOverride;
    const feats=new Set(uniqueFeatNames(this.data).map(f=>`feat:${f}`));
    for(const [k,v] of Object.entries(saved.featMatches||{})) if(feats.has(k)&&v){ this.matches.set(k,v); this.confirmed.add(k); }
    if(saved.featBonusesInStats) Object.defineProperty(this.data,"__featBonusesInStats",{value:true,enumerable:false,writable:true,configurable:true});
    if(saved.speciesUuid) this.speciesUuid=saved.speciesUuid;
    if(saved.magicInitiateList) this.magicInitiateList=saved.magicInitiateList;
    if(saved.resilientSave) this.resilientSave=saved.resilientSave;
    for(const [k,v] of Object.entries(saved.advChoices||{})) if(Array.isArray(v)&&v.length) this.advChoices.set(k,[...v]);
    for(const [k,v] of Object.entries(saved.featurePlacements||{})) this.featurePlacements.set(k,v);
    for(const [k,v] of Object.entries(saved.choicePlacements||{})) this.choicePlacements.set(k,v);
    for(const [cn,p] of Object.entries(saved.casterProfiles||{})) if(this.data.Class?.[cn]&&p) this.casterProfiles.set(cn,{progression:p.progression,ability:p.ability,maxOverride:p.maxOverride??""});
    flattenOwned(this.data).forEach((x,i)=>{ const r=saved.equipment?.[x.key]; if(!r) return; const id=`eq:${i}`;
      if(r.uuid){ this.matches.set(id,r.uuid); this.confirmed.add(id); }
      const st={}; if("equipped" in r) st.equipped=!!r.equipped; if("attuned" in r) st.attuned=!!r.attuned; if(Object.keys(st).length) this.equipment.set(id,st); });
    this._pendingSpells={spells:Array.isArray(saved.spells)?saved.spells:[],assign:saved.spellClassAssignments||{}};
    return true;
  }
  restorePendingSpells(){
    const p=this._pendingSpells; this._pendingSpells=null; if(!p) return;
    const known=new Set(resolver.entries.map(e=>e.uuid));
    for(const u of p.spells) if(known.has(u)){ this.spells.add(u); const cn=p.assign[u]; if(cn&&this.data.Class?.[cn]) this.spellClassAssignments.set(u,cn); }
  }
  /** Characters this user may update: their own player characters. Backups are never offered automatically. */
  updateCandidates(){ return (game.actors?.contents||[...(game.actors||[])]).filter(a=>a.type==="character"&&(a.isOwner??true)); }
  findExistingActor(){
    const name=norm(this.data?.Name||""); if(!name) return null;
    const cs=this.updateCandidates().filter(a=>a.flags?.[MODULE_ID]&&!a.flags[MODULE_ID].backupOf);
    return cs.find(a=>norm(a.flags[MODULE_ID].rawExport?.Name||"")===name)||cs.find(a=>norm(a.name)===name)||null;
  }
  /** Read an export, pick the character to update (if any), restore its saved choices and match everything. */
  async loadExport(text,fileName,{targetId}={}){
    const data=parseBotExport(text); if(!data||typeof data!=="object"||!Object.keys(data.Class||{}).length) throw new Error("This file has no Class section. Choose a D&D Friends bot export.");
    this.resetForNewExport(); this.data=data; this.fileName=fileName; this.sourceText=text; this.classOrder=defaultClassOrder(this.data); await this.render();
    this.setBusy("Indexing compendiums and world items…"); await resolver.load();
    this.setBusy("Loading feat data…"); await plutoniumBridge.buildFeatIndex();
    const allSrc=[...new Set([...resolver.plutoniumSources().map(x=>x.code),...plutoniumBridge.rawFeatSources().map(x=>x.code)])]; if(this.enabledSources===null)this.enabledSources=new Set(allSrc); else this.enabledSources=new Set([...this.enabledSources].filter(x=>allSrc.includes(x))); resolver.setEnabledPlutoniumSources(this.enabledSources);
    const target=targetId===undefined?this.findExistingActor():(targetId?game.actors?.get(targetId):null);
    this.targetActorId=target?.id||"";
    const saved=target?.getFlag?.(MODULE_ID,"choices"); if(saved) this.applySavedChoices(saved);
    await this.prepareCharacterMetadata(); this.restorePendingSpells();
    await this.render();
  }
  targetActor(){ return this.targetActorId?game.actors?.get(this.targetActorId)||null:null; }
  targetView(){
    const cs=this.updateCandidates(); const t=this.targetActor(); const lvl=a=>{ const l=Number(a.system?.details?.level||0); return l?` (level ${l})`:""; };
    const when=this.savedFrom?.savedAt?new Date(this.savedFrom.savedAt).toLocaleDateString():"";
    return `<div class="ov-target"><label>Import as <select data-target-actor><option value="">New character</option>${cs.map(a=>`<option value="${esc(a.id)}" ${a.id===this.targetActorId?"selected":""}>Update ${esc(a.name)}${esc(lvl(a))}${a.flags?.[MODULE_ID]?.backupOf?" — backup":""}</option>`).join("")}</select></label>
      ${t?`<label class="inline-check"><input type="checkbox" data-backup ${this.backup?"checked":""}> Keep a backup copy first</label>
        <p class="muted">Adds new levels, features, feats, spells and items to ${esc(t.name)} and updates ability scores, gold and item quantities. Nothing already on the sheet is removed.${this.savedFrom?` Choices from the last import${when?` (${esc(when)})`:""} were filled in.`:""}</p>`:""}</div>`;
  }
  /** Default database matches for every inventory row, without rendering the Equipment step. */
  ensureEquipmentMatches(){ const owned=flattenOwned(this.data||{}); owned.forEach((x,i)=>{ if(!this.matches.has(`eq:${i}`)) this.matchSelect(`eq:${i}`,x.name,EQUIP_TYPES,[x.key]); }); }
  /** Everything the overview needs: what blocks Create, what deserves a look, and what was matched automatically. */
  importStatus(){
    const block=[],warn=[],done=[]; if(!this.data) return {block,warn,done};
    const go=(list,text,step)=>list.push({text,step});
    // Character
    const species=this.coreDocs.find(x=>x.kind==="race");
    if(species) go(done,`Species: ${species.doc?.name||species.name}`,1); else go(warn,`Species “${normalizeSpeciesName(this.data.Race)}” not found`,1);
    for(const [cn,c] of Object.entries(this.data.Class||{})){
      const cls=this.coreDocs.find(x=>x.kind==="class"&&x.name===cn); if(cls) go(done,`${cn} ${c.Level}`,1); else go(warn,`Class “${cn}” not found`,1);
      if(c.Subclass){ const sub=this.coreDocs.find(x=>x.kind==="subclass"&&x.name===c.Subclass); if(sub) go(done,`Subclass: ${sub.doc?.name||c.Subclass}`,1); else go(warn,`Subclass “${c.Subclass}” not found`,1); }
    }
    go(done,this.hpOverride?`HP fixed at ${this.hpOverride}`:`HP calculated by Foundry (about ${averageHp(this.data,this.classOrder.length?this.classOrder:undefined,null,this.hitDiceByClass())})`,1);
    // Choices
    if(this.skills.length!==2) go(block,`Choose 2 free skill proficiencies (${this.skills.length}/2)`,2); else go(done,`Free skills: ${this.skills.map(s=>SKILLS[s]).join(", ")}`,2);
    const origin=getOriginFeat(this.data);
    if(origin){ const u=this.matches.get(`feat:${origin}`); if(!u) go(block,`Choose the Origin feat “${origin}”`,2); else if(u==="__placeholder__") go(warn,`Origin feat “${origin}” will be a placeholder`,2); else go(done,`Origin feat: ${origin}`,2); }
    for(const d of this.advChoiceDefs){ const have=(this.advChoices.get(d.id)||[]).length, need=this.requiredCount(d);
      if(have<need) go(block,`${d.sourceName} — ${d.title}: choose ${need-have} more`,2); else if(need) go(done,`${d.sourceName} — ${d.title}`,2);
      if(need<d.count) go(warn,`${d.sourceName} — ${d.title}: only ${need} of ${d.count} options found; finish on the sheet`,2); }
    if(!block.some(b=>b.step===2)){ const problem=this.validateChoices(); if(problem) go(block,problem,2); }
    for(const f of uniqueFeatNames(this.data)){ if(norm(f)===norm(origin)) continue; const u=this.matches.get(`feat:${f}`); if(u==="__placeholder__") go(warn,`Feat “${f}” will be a placeholder`,2); }
    // Spells
    for(const [cn,r] of this.spellTally()){ if(cn==="Unassigned") continue; const lim=this.spellLimitsFor(cn);
      if(!r.c&&!r.l){ if(this.targetActorId) go(done,`${cn}: no new spells chosen (spells already on the sheet are kept)`,3); else go(warn,`${cn}: no spells chosen yet${lim?` (up to ${lim.cantrips??0} cantrips, ${lim.prepared??"?"} prepared)`:""}`,3); }
      else go(done,lim?`${cn} spells: ${r.c}/${lim.cantrips??0} cantrips, ${r.l}/${lim.prepared??"?"} prepared`:`${cn} spells: ${r.c} cantrips, ${r.l} leveled`,3); }
    for(const p of this.spellLimitProblems()) go(warn,`Over the spell limits: ${p}`,3);
    // Equipment
    this.ensureEquipmentMatches();
    const owned=flattenOwned(this.data); let matched=0,legacy=0,raw=0;
    owned.forEach((x,i)=>{ const id=`eq:${i}`, u=this.matches.get(id);
      if(!u||u==="__placeholder__") go(warn,`${x.name}: no match, will be a placeholder`,4);
      else if(this.lowConfidence.has(id)) go(warn,`${x.name}: check the match (${this.itemEntryFor(u)?.name||"?"})`,4);
      else { matched++; if(String(u).startsWith("__rawitem__")) raw++; else if(this.itemEntryFor(u)?.legacy||resolver.excludedEntries.some(e=>e.uuid===u)) legacy++; } });
    if(owned.length) go(done,`${matched} of ${owned.length} items matched${raw?`, ${raw} from 5etools`:""}${legacy?`, ${legacy} from 2014 sources`:""}${this.remembered.size?`, ${this.remembered.size} from remembered picks`:""}`,4);
    const t=this.targetActor(); if(t){ const from=Number(t.system?.details?.level||0); go(done,`Updating ${t.name}${from?`: level ${from} → ${this.characterLevel()}`:""}`,0); }
    go(done,"Resistances, senses, languages and tools are detected from your choices",5);
    return {block,warn,done};
  }
  overviewView(){
    const {block,warn,done}=this.importStatus();
    const row=(r,cls)=>r.step===0?`<li class="${cls}"><span>${esc(r.text)}</span></li>`:`<li class="${cls}"><span>${esc(r.text)}</span><button type="button" class="link-button" data-goto-step="${r.step}">${["","Character","Choices","Spells","Equipment","Traits"][r.step]||"Open"} →</button></li>`;
    const t=this.targetActor(); const verb=t?`Update ${esc(t.name)}`:"Create character";
    return `<div class="overview">
      ${this.targetView()}
      <h3>${block.length?`${block.length} thing${block.length===1?"":"s"} to choose before importing`:"Ready to import"}</h3>
      ${block.length?`<ul class="ov-list ov-block">${block.map(r=>row(r,"ov-block")).join("")}</ul>`:""}
      ${this.skills.length!==2?`<div class="ov-skills"><small class="muted">Pick the 2 free skills here:</small><div class="skill-grid">${Object.entries(SKILLS).map(([k,v])=>`<label><input data-skill value="${k}" type="checkbox" ${this.skills.includes(k)?'checked':''} ${!this.skills.includes(k)&&this.skills.length>=2?'disabled':''}> ${v}</label>`).join("")}</div></div>`:""}
      ${warn.length?`<h4>Worth a look</h4><ul class="ov-list ov-warn ov-warn-list">${warn.map(r=>row(r,"ov-warn")).join("")}</ul>`:""}
      <details class="ov-done"><summary>Matched automatically (${done.length})</summary><ul class="ov-list">${done.map(r=>row(r,"ov-ok")).join("")}</ul></details>
      <div class="ov-actions"><button type="button" class="create" data-act="create" ${block.length||this.creating||this.busy?"disabled":""}><i class="fa-solid ${t?"fa-arrows-rotate":"fa-user-plus"}"></i> ${verb}</button><button type="button" data-goto-step="1">Review step by step</button></div>
      ${block.length?`<p class="muted">Create unlocks when the choices above are made. Everything else can be fixed on the sheet afterwards.</p>`:""}
    </div>`;
  }
  uploadView(){ return `<section><h2>Import Discord Character Export</h2><p>Upload the bot's <code>.json</code> export. Standard JSON and the server bot's Python-style dictionary format are both accepted. Choosing a new file starts a fresh import.</p><span class="upload-links"><button type="button" class="link-button" data-refresh-content title="Re-read compendiums after importing new content">Refresh content</button><button type="button" class="link-button" data-copy-diagnostics title="Copy a report to paste into Discord or a bug report">Copy diagnostics</button></span><label class="drop${this.data?" compact":""}"><i class="fa-solid fa-file-arrow-up"></i><strong>${this.data?esc(this.fileName):"Choose export file"}</strong><input data-file type="file" accept=".json,.txt,application/json,text/plain"></label>${this.data?`<div class="summary"><b>${esc(this.data.Name)}</b><span>Level ${Number(this.data.Level||0)}</span><span>${esc(this.data.Race||"Unknown species")}</span><span>${Object.entries(this.data.Class||{}).map(([k,v])=>`${esc(k)} ${v.Level}${v.Subclass?` (${esc(v.Subclass)})`:""}`).join(" / ")}</span></div>`:""}${this.data&&!this.busy&&this.coreDocs.length?this.overviewView():""}${this.sourceFilterView()}</section>`; }
  coreView(){
    if(!this.data)return""; const base=baseStats(this.data), eff=effectiveStats(this.data); const avg=averageHp(this.data,this.classOrder.length?this.classOrder:undefined,null,this.hitDiceByClass());
    const speciesOptions=this.speciesCandidates(),selectedSpecies=this.selectedSpeciesEntry();
    const matched=this.coreDocs.filter(x=>x.kind==="class"||x.kind==="subclass").map(x=>`<li><b>${esc(x.name)}</b> → ${esc(x.doc?.name||"?")}${x.kind==="subclass"?` <small>(${esc(x.className)} subclass)</small>`:""}</li>`).join("");
    const missing=Object.entries(this.data.Class||{}).flatMap(([cn,c])=>[...(this.coreDocs.some(x=>x.kind==="class"&&x.name===cn)?[]:[{name:cn,type:"class"}]),...(c.Subclass&&!this.coreDocs.some(x=>x.kind==="subclass"&&x.name===c.Subclass)?[{name:c.Subclass,type:"subclass"}]:[])]);
    const missingText=missing.map(x=>`${x.name} — ${resolver.diagnostic(x.name,[x.type])}`);
    return `<section><h2>Core Character</h2><div class="grid6">${ABILITIES.map(a=>`<div class="stat"><label>${a.toUpperCase()}</label><strong>${base[a]}</strong>${eff[a]!==base[a]?`<small>${eff[a]} with items</small>`:""}</div>`).join("")}</div><p class="muted">${this.featBonusNote()}Magic items that change a score apply their own effect in Foundry; the bot's bonus is only added when an item becomes a placeholder.</p>${speciesOptions.length?`<h3>Species</h3><p class="muted">Size suffixes such as (Medium) are used for the species size choice. If multiple 2024 versions or legacies are available, choose the intended one.</p><select data-species-choice>${speciesOptions.map(e=>`<option value="${esc(e.uuid)}" ${selectedSpecies?.uuid===e.uuid?'selected':''}>${esc(e.name)} — ${esc(e.plutonium?.source||e.source?.book||'2024')}</option>`).join("")}</select>`:""}${matched||missing.length?`<h3>Class Matches</h3><ul class="match-list">${matched}</ul>${missing.length?`<div class="warning">${missingText.map(esc).join("<br>")}</div>`:""}`:""}<h3>Hit Points</h3><p>Foundry calculates maximum HP from each class's hit die (maximum at level 1, average after), Constitution, and features such as Tough or Dwarven Toughness. Enter a number only if this character's HP must be a fixed total.</p><div class="form-row"><label>Estimated HP</label><input value="${avg}" disabled><label>Fixed HP (optional)</label><input data-hp type="number" min="1" autocomplete="off" placeholder="Calculated" value="${esc(this.hpOverride)}"></div>${Object.keys(this.data.Class||{}).length>1?this.classOrderView():""}<div class="notice">2024 rules plus enabled UA/custom sources. No Background document will be imported.</div></section>`;
  }
  featBonusNote(){
    const fb=this.data?.__featStatBonuses||[]; if(!fb.length) return "Base scores are imported as-is. ";
    const list=fb.map(b=>`${esc(b.source)} ${Number(b.Value)>=0?"+":""}${esc(b.Value)} ${esc(String(b.Stat||"").toUpperCase())}`).join(", ");
    return `Feat bonuses from the export (${list}) are added to the base scores. <label class="inline-check"><input type="checkbox" data-feat-bonuses-included ${this.data.__featBonusesInStats?"checked":""}> The exported scores already include these</label><br>`;
  }
  classOrderView(){ const opts=Object.keys(this.data.Class); if(!this.classOrder.length)this.classOrder=defaultClassOrder(this.data); const start=this.classOrder[0]||opts[0]; return `<h3>Starting Class</h3><p>The class taken at character level 1 gets maximum hit points and its full starting proficiencies. Other classes use their multiclass proficiencies.</p><select data-start-class>${opts.map(o=>`<option ${o===start?'selected':''}>${esc(o)}</option>`).join("")}</select>`; }
  orderStartingWith(name){ const order=defaultClassOrder(this.data); const i=order.indexOf(name); if(i>0){ order.splice(i,1); order.unshift(name); } return order; }
  serverOriginSearchBlock(origin){
    const id=`server-origin:${origin}`, matchId=`feat:${origin}`;
    if(!this.advSearch.has(id))this.advSearch.set(id,origin); const q=this.advSearch.get(id)||origin;
    // Pick the exact name match automatically so the Origin feat never silently becomes a placeholder.
    if(!this.matches.has(matchId)){ const exact=this.featSearchCandidates(origin,true).find(r=>r._searchScore>=120); if(exact) this.matches.set(matchId,exact.uuid); }
    const chosen=this.matches.get(matchId); const selected=chosen&&chosen!=="__placeholder__"?this.featEntryById(chosen):null;
    return `<div class="adv-choice origin-search-choice"><div class="origin-selected" data-origin-selected="${esc(id)}">${selected?`<b>Selected:</b> ${esc(originChoiceCanonicalName(selected.name))}<small>${esc(selected.plutonium?.source||selected.source?.book||selected.uuid)}</small>`:chosen==="__placeholder__"?`<b>Placeholder:</b> a blank “${esc(origin)}” feat will be created.`:`<b>No database feat selected.</b> Choose a result below, or use a placeholder.`}</div><input class="search" data-origin-search="${esc(id)}" value="${esc(q)}" placeholder="Type feat name"><div class="origin-results" data-origin-results="${esc(id)}"></div><button type="button" class="link-button" data-origin-placeholder="${esc(id)}">Use a placeholder instead</button></div>`;
  }
  choiceView(){
    if(!this.data)return"";
    const origin=getOriginFeat(this.data); const originKey=norm(origin);
    const otherFeats=[]; const seen=new Set();
    for(const raw of (this.data.Feats||[])){ const f=canonicalFeatName(raw), k=norm(f); if(!f||k===originKey||seen.has(k))continue; seen.add(k); otherFeats.push(f); }
    const resilientHandled=this.advChoiceDefs.some(d=>d.sourceKind==="feat"&&/resilient/i.test(d.sourceName)&&d.options.some(o=>String(o.value).startsWith("saves:")));
    return `<section><h2>Skills & Features</h2>
      <div class="feature-source-group server-group"><h3>Server Origin Choices</h3><h4>Two Free Skill Proficiencies</h4><div class="skill-grid">${Object.entries(SKILLS).map(([k,v])=>`<label><input data-skill value="${k}" type="checkbox" ${this.skills.includes(k)?'checked':''} ${!this.skills.includes(k)&&this.skills.length>=2?'disabled':''}> ${v}</label>`).join("")}</div>${origin?`<h4>Free Origin Feat</h4><p class="muted">Read from the bot's Background field; no Background document is created.</p>${this.serverOriginSearchBlock(origin)}`:""}</div>
      <div class="feature-source-group"><h3>Other Feats</h3>${otherFeats.length?otherFeats.map(f=>this.matchRow(`feat:${f}`,f,["feat"])).join(""):'<p class="muted">No additional feats in the bot export.</p>'}${uniqueFeatNames(this.data).some(f=>norm(f)==="resilient")&&!resilientHandled?`<div class="resilient-choice"><h4>Resilient — Saving Throw Proficiency</h4><p class="muted">The bot ability scores are already final, so the +1 ability score is not applied again.</p><select data-resilient-save><option value="">Choose ability…</option>${ABILITIES.map(a=>`<option value="${a}" ${this.resilientSave===a?'selected':''}>${a.toUpperCase()}</option>`).join("")}</select></div>`:""}</div>
      ${this.advChoiceDefs.length?`<p class="muted source-note">The choices below are grouped by the document that owns each Foundry Advancement. Feat choices appear once the feat is matched above.</p>${this.advancementGroupsView()}`:""}
      ${this.featurePlacementView()}
      <p class="muted">Ability scores from the bot are treated as final, so Ability Score Improvement advancements are not re-applied.</p></section>`;
  }
  spellView(){
    if(!this.data)return"";
    const activeProfiles=[...this.casterProfiles.entries()].filter(([,p])=>norm(p.progression)!=="none"&&Number(p.casterLevel)>0);
    const profileBlock=`<h3>Spellcasting Profiles</h3><p class="muted">Each class's level, progression and casting ability are read from the matched class (or its subclass, for Eldritch Knight and Arcane Trickster). Override them for multiclass or homebrew characters, then click Apply to refresh the list.</p><div class="caster-profiles">${this.casterProfileRows()}</div><button type="button" data-act="apply-caster">Apply Caster Settings</button>`;
    if(!activeProfiles.length)return`<section><h2>Spells</h2>${profileBlock}<div class="notice">No active spellcasting progression is currently configured.</div></section>`;
    const caps=new Map(activeProfiles.map(([cn,p])=>[cn,p.maxOverride!==""?Number(p.maxOverride):maxSpellLevelForProgression(p.progression,p.casterLevel)]));
    const listOf=cn=>norm(this.casterProfiles.get(cn)?.listClass||cn);
    const legalClassesFor=e=>{ const set=plutoniumBridge.spellClassMap.get(norm(e.name)); if(!set?.size)return[]; return activeProfiles.filter(([cn])=>set.has(listOf(cn))&&Number(e.level||0)<=Number(caps.get(cn)||0)).map(([cn])=>cn); };
    let raw=resolver.entries.filter(e=>resolver.allowed(e)&&e.type==="spell").filter(e=>legalClassesFor(e).length); const fallback=!raw.length;
    if(fallback)raw=resolver.entries.filter(e=>resolver.allowed(e)&&e.type==="spell").filter(e=>Number(e.level||0)<=Math.max(0,...caps.values()));
    raw.sort((a,b)=>resolver.priority(b)-resolver.priority(a)); const byName=new Map(); for(const e of raw){const k=norm(e.name);if(!byName.has(k))byName.set(k,e);}
    const display=[...byName.values()].sort((a,b)=>(a.level||0)-(b.level||0)||a.name.localeCompare(b.name));
    const allNames=activeProfiles.map(([cn])=>cn);
    const rows=display.map(sp=>{
      const legal=legalClassesFor(sp); const choices=legal.length?legal:allNames.filter(cn=>Number(sp.level||0)<=Number(caps.get(cn)||0));
      const assigned=this.spellClassAssignments.get(sp.uuid)||choices[0]||allNames[0]||""; if(assigned&&!this.spellClassAssignments.has(sp.uuid))this.spellClassAssignments.set(sp.uuid,assigned);
      const granted=this.grantedSpells.has(sp.uuid);
      return `<label data-spell-row="${esc(sp.name.toLowerCase())}" data-spell-level="${Number(sp.level||0)}"><input data-spell value="${esc(sp.uuid)}" type="checkbox" ${this.spells.has(sp.uuid)?'checked':''} ${granted?'disabled title="Granted automatically"':''}><span class="level">${sp.level===0?'C':sp.level}</span><span>${esc(sp.name)}${granted?' <small>(granted)</small>':''}</span><small>${esc(sp.source?.book||"")}</small>${choices.length>1?`<select data-spell-class="${esc(sp.uuid)}">${choices.map(c=>`<option ${c===assigned?'selected':''}>${esc(c)}</option>`).join("")}</select>`:`<span class="spell-class">${esc(assigned)}</span>`}</label>`;
    }).join("");
    const levels=[...new Set(display.map(s=>Number(s.level||0)))].sort((a,b)=>a-b);
    return `<section><h2>Select Spells</h2>${profileBlock}<div class="notice">${fallback?`Class spell-list data was unavailable, so every spell up to the highest configured level is shown. Choose the casting class for each spell you select.`:`Spell access is filtered by each class's list and configured maximum spell level.`}</div><div class="spell-toolbar"><input data-spell-search class="search" placeholder="Filter spells..."><select data-spell-level-filter><option value="all">All levels</option>${levels.map(l=>`<option value="${l}" ${String(this.spellLevelFilter)===String(l)?'selected':''}>${l===0?'Cantrips':`Level ${l}`}</option>`).join("")}</select></div><div class="spell-actions"><button type="button" data-act="clear-spells">Clear</button><span class="spell-counts ${this.spellLimitProblems().length?'over':''}" data-spell-counts>${this.spellCountsText()}</span></div><div class="spell-list">${rows}</div>${this.grantedSpells.size?`<div class="granted-spells"><h3>Granted Subclass Spells</h3><p class="muted">Imported automatically as always prepared; not counted against your choices.</p>${[...this.grantedSpells.values()].map(g=>`<div class="granted-spell"><b>${esc(g.name)}</b><span>${esc(g.ownerSubclass)} — ${esc(g.feature)}</span></div>`).join("")}</div>`:""}<p class="muted">Spells granted by species, subclass, and feat advancements are added with their own settings and are not listed here.</p></section>`;
  }
  /** Cantrip and prepared-spell limits for a class profile: the class's own scale values first, then the 2024 PHB table. */
  spellLimitsFor(cn){
    const p=this.casterProfiles.get(cn); if(!p||norm(p.progression)==="none") return null;
    const level=Math.max(1,Math.min(20,Number(p.casterLevel)||0)); if(!Number(p.casterLevel)) return null;
    const doc=p.via?this.coreDocs.find(x=>x.kind==="subclass"&&norm(x.className)===norm(cn))?.doc:this.coreDocs.find(x=>x.kind==="class"&&norm(x.name)===norm(cn))?.doc;
    const fromDoc=spellLimitsFromDoc(doc,level); const table=SPELL_LIMITS_2024[norm(p.via||cn)];
    const cantrips=fromDoc.cantrips??(table?(table.cantrips?table.cantrips[level-1]:0):null);
    const prepared=fromDoc.prepared??(table?table.prepared[level-1]:null);
    if(cantrips===null&&prepared===null) return null;
    return {cantrips,prepared,source:(fromDoc.cantrips!==undefined||fromDoc.prepared!==undefined)?"class data":"2024 PHB"};
  }
  spellTally(){
    const per=new Map(); for(const u of this.spells){ const e=resolver.entries.find(x=>x.uuid===u); const cn=this.spellClassAssignments.get(u)||"Unassigned"; const r=per.get(cn)||{c:0,l:0}; if(Number(e?.level||0)===0)r.c++; else r.l++; per.set(cn,r); }
    for(const [cn,p] of this.casterProfiles) if(norm(p.progression)!=="none"&&Number(p.casterLevel)>0&&!per.has(cn)) per.set(cn,{c:0,l:0});
    return per;
  }
  /** Classes whose picks exceed their limits, as readable strings. */
  spellLimitProblems(){
    const out=[];
    for(const [cn,r] of this.spellTally()){ const lim=this.spellLimitsFor(cn); if(!lim) continue;
      if(lim.cantrips!==null&&r.c>lim.cantrips) out.push(`${cn}: ${r.c} cantrips (limit ${lim.cantrips})`);
      if(lim.prepared!==null&&r.l>lim.prepared) out.push(`${cn}: ${r.l} prepared spells (limit ${lim.prepared})`); }
    return out;
  }
  spellCountsText(){
    const per=this.spellTally(); if(!per.size) return "0 selected";
    return [...per.entries()].map(([cn,r])=>{ const lim=this.spellLimitsFor(cn);
      const c=lim&&lim.cantrips!==null?`${r.c}/${lim.cantrips} cantrips`:`${r.c} cantrip${r.c===1?"":"s"}`;
      const l=lim&&lim.prepared!==null?`${r.l}/${lim.prepared} prepared`:`${r.l} spell${r.l===1?"":"s"}`;
      return `${cn}: ${c}, ${l}`; }).join(" · ");
  }
  /** Index entry for a chosen item: 2024 or 2014 Foundry content, or a 5etools item not yet in Foundry. */
  itemEntryFor(u){
    if(!u||u==="__placeholder__"||String(u).startsWith("__scroll__")) return null;
    if(String(u).startsWith("__rawitem__")){ const it=plutoniumBridge.rawItemById.get(u); if(!it) return null; const e=plutoniumBridge.rawItemEntry(it); const t=code5et(it.type); return {...e,itemTypeValue:{LA:"light",MA:"medium",HA:"heavy",S:"shield"}[t]||""}; }
    return resolver.entries.find(r=>r.uuid===u)||resolver.excludedEntries.find(r=>r.uuid===u)||null;
  }
  /** Armor, shields and weapons start equipped; one body armor and one shield at most. */
  defaultEquipment(owned){
    const out=new Map(); let armor=false, shield=false;
    owned.forEach((x,i)=>{ const u=this.matches.get(`eq:${i}`); const e=this.itemEntryFor(u); let equipped=false;
      if(e?.type==="weapon") equipped=true;
      else if(e?.type==="equipment"){ const t=norm(e.itemTypeValue); if(["light","medium","heavy"].includes(t)){ equipped=!armor; armor=true; } else if(t==="shield"){ equipped=!shield; shield=true; } else equipped=x.category==="Magic Item"; }
      out.set(`eq:${i}`,{equipped,attuned:x.attuned,qty:x.qty}); });
    return out;
  }
  equipState(i,x,defaults){ const id=`eq:${i}`; return {...(defaults?.get(id)||{equipped:false,attuned:x.attuned,qty:x.qty}),...(this.equipment.get(id)||{})}; }
  equipView(){
    if(!this.data)return""; const owned=flattenOwned(this.data);
    const html=owned.map((x,i)=>{ const id=`eq:${i}`; const sel=this.matchSelect(id,x.name,EQUIP_TYPES,[x.key]); return {i,x,id,sel,low:this.lowConfidence.has(id)}; });
    const defaults=this.defaultEquipment(owned);
    const rows=html.sort((a,b)=>(b.low-a.low)||(a.i-b.i)).map(({i,x,id,sel,low})=>{ const st=this.equipState(i,x,defaults); return `<div class="equip ${low?'needs-check':''}"><div><b>${esc(x.name)}</b><small>${x.category}${low?' · check match':''}${x.qty===0?' · used up':''}</small></div>${sel}<label>Qty <input data-eq-qty="${id}" type="number" min="0" value="${st.qty}"></label><label><input data-eq-equipped="${id}" type="checkbox" ${st.equipped?'checked':''}> Equipped</label>${x.attunement||x.attuned?`<label><input data-eq-attuned="${id}" type="checkbox" ${st.attuned?'checked':''}> Attuned</label>`:'<span></span>'}</div>`; }).join("");
    const lows=html.filter(r=>r.low).length;
    return `<section><h2>Equipment & Inventory</h2><p>Confirm each match, quantity, equipped state, and attunement. Armor, shields and weapons start equipped.</p>${lows?`<div class="warning">${lows} item(s) matched with low confidence and are listed first. Check that each is the right item (for example a +1 weapon rather than the mundane one).</div>`:""}<div class="equip-list">${rows}</div></section>`;
  }
  reviewView(){
    if(!this.data)return"";
    const hp=Number(this.hpOverride)||averageHp(this.data,this.classOrder.length?this.classOrder:undefined,null,this.hitDiceByClass()), base=baseStats(this.data);
    const owned=flattenOwned(this.data); const eqName=k=>owned[Number(k.slice(3))]?.name||k;
    const placeholders=[...this.matches.entries()].filter(([,v])=>v==="__placeholder__").map(([k])=>k.startsWith("eq:")?eqName(k):k.replace(/^feat:/,""));
    const lows=[...this.lowConfidence].filter(k=>this.matches.get(k)!=="__placeholder__").map(eqName);
    const origin=getOriginFeat(this.data), originKey=norm(origin); const originMatch=this.matches.get(`feat:${origin}`); const originEntry=originMatch&&originMatch!=="__placeholder__"?this.featEntryById(originMatch):null;
    const otherFeats=[...new Set((this.data.Feats||[]).map(canonicalFeatName).filter(f=>f&&norm(f)!==originKey))];
    const featLabel=f=>{const u=this.matches.get(`feat:${f}`);const e=u&&u!=="__placeholder__"?this.featEntryById(u):null;return e?`${esc(f)} → ${esc(e.name)}`:`${esc(f)} <em>(placeholder)</em>`;};
    const incomplete=this.advChoiceDefs.filter(d=>(this.advChoices.get(d.id)||[]).length<d.count);
    const groupSummary=["race","class","subclass","feat"].map(kind=>{ const defs=this.advChoiceDefs.filter(d=>d.sourceKind===kind); if(!defs.length)return""; return `<div class="review-section"><h4>${this.sourceGroupLabel(kind)}</h4>${defs.map(d=>`<p><b>${esc(d.sourceName)} — ${esc(d.title)}${Number(d.level||0)>0?` (Level ${d.level})`:""}:</b> ${this.choiceSelectionLabels(d).map(esc).join(", ")||"No choice"}</p>`).join("")}</div>`; }).join("");
    const users=(game.users?.contents||[...(game.users||[])]).filter(u=>!u.isGM);
    const langs=[...this.finalTraits.languages].map(languageLabel).join(", ");
    return `<section><h2>Review</h2><div class="review-card"><h3>${esc(this.data.Name)}</h3><p><b>Species:</b> ${esc(this.data.Race)}</p><p><b>Classes:</b> ${Object.entries(this.data.Class||{}).map(([k,v])=>`${esc(k)} ${v.Level}${v.Subclass?` / ${esc(v.Subclass)}`:""}`).join(" • ")}</p><p><b>HP ${this.hpOverride?`${hp} (fixed)`:`about ${hp} (calculated by Foundry)`}</b> • ${ABILITIES.map(a=>`${a.toUpperCase()} ${base[a]}`).join(" • ")}</p></div>
      <div class="review-section"><h4>Server Origin Choices</h4><p><b>Free skills:</b> ${this.skills.map(s=>SKILLS[s]).join(", ")||"None selected"}</p><p><b>Free Origin feat:</b> ${origin?(originEntry?`${esc(origin)} → ${esc(originEntry.name)} <small>${esc(originEntry.plutonium?.source||originEntry.source?.book||"")}</small>`:`${esc(origin)} <em>(placeholder)</em>`):"None"}</p></div>
      ${groupSummary}<div class="review-section"><h4>Other Feats</h4><p>${otherFeats.map(featLabel).join(", ")||"None"}</p></div>
      <div class="review-section"><h4>Spellcasting</h4>${[...this.casterProfiles.entries()].map(([cn,p])=>`<p><b>${esc(cn)}:</b> level ${Number(p.casterLevel||0)}, ${esc(p.progression)} progression${p.via?` via ${esc(p.via)}`:""}, ${esc(String(p.ability||"").toUpperCase())}, max spell level ${p.maxOverride!==""?Number(p.maxOverride):maxSpellLevelForProgression(p.progression,p.casterLevel)}</p>`).join("")}<p>${esc(this.spellCountsText())}; ${this.grantedSpells.size} granted subclass spell(s).</p>${this.spellLimitProblems().length?`<div class="warning"><b>Over the spell limits:</b> ${this.spellLimitProblems().map(esc).join("; ")}.</div>`:""}</div>
      <div class="review-section"><h4>Final Traits</h4><p><b>Resistances:</b> ${[...this.finalTraits.dr].join(", ")||"None"}</p><p><b>Damage Immunities:</b> ${[...this.finalTraits.di].join(", ")||"None"}</p><p><b>Condition Immunities:</b> ${[...this.finalTraits.ci].join(", ")||"None"}</p><p><b>Languages:</b> ${esc(langs)||"None"}</p><p><b>Tools:</b> ${[...this.finalTraits.tools].map(toolLabel).join(", ")||"None"}</p></div>
      ${game.user.isGM?`<div class="review-section"><h4>Owner</h4><select data-owner><option value="">GM only</option>${users.map(u=>`<option value="${esc(u.id)}" ${this.ownerId===u.id?'selected':''}>${esc(u.name)}</option>`).join("")}</select><p class="muted">The selected player gets Owner permission on the new actor.</p></div>`:""}
      ${placeholders.length?`<div class="warning"><b>${placeholders.length} placeholder(s)</b> will be created: ${placeholders.map(esc).join(", ")}.</div>`:""}
      ${lows.length?`<div class="warning"><b>Low-confidence matches:</b> ${lows.map(esc).join(", ")}. Go back to Equipment to confirm them.</div>`:""}
      ${incomplete.length?`<div class="warning"><b>Choices to finish by hand after import:</b> ${incomplete.map(d=>`${esc(d.sourceName)} — ${esc(d.title)}`).join("; ")}.</div>`:""}
      <div class="notice">Species, class, subclass, feat and server-origin choices are shown separately so source-mapping mistakes are visible before the actor is created.</div></section>`;
  }
  matchRow(id,name,types){ return `<div class="match-row ${this.lowConfidence.has(id)?'needs-check':''}"><b>${esc(name)}</b>${this.matchSelect(id,name,types)}</div>`; }
  /** Candidate list, also trying common magic-item spellings ("Longsword +1" vs "+1 Longsword" vs "Weapon, +1"). */
  matchCandidates(name,types,alts=[]){
    const variants=[name,...alts.filter(a=>a&&norm(a)!==norm(name))]; const m=/^\s*\+(\d)\s+(.+)$/.exec(name)||/^(.+?),?\s*\+(\d)\s*$/.exec(name);
    if(m){ const bonus=/^\s*\+/.test(name)?m[1]:m[2], base=/^\s*\+/.test(name)?m[2]:m[1]; variants.push(`+${bonus} ${base}`,`${base} +${bonus}`,`${base}, +${bonus}`); }
    const physical=types.some(t=>PHYSICAL_TYPES.has(t));
    const best=new Map(); for(const v of variants) for(const c of (physical?resolver.itemCandidates(v,types):resolver.candidates(v,types))){ const prev=best.get(c.uuid); if(!prev||c.score>prev.score) best.set(c.uuid,c); }
    if(physical){
      // Items Plutonium knows about but nobody has imported into Foundry yet. Skip names already available in Foundry.
      const have=new Set([...best.values()].map(c=>norm(c.name)));
      for(const v of variants) for(const c of plutoniumBridge.rawItemCandidates(v)){ if(have.has(norm(c.name))) continue; const prev=best.get(c.uuid); if(!prev||c.score>prev.score) best.set(c.uuid,c); }
    }
    const rank=c=>c.rawItem?1:c.legacy?2:3;
    return [...best.values()].sort((a,b)=>(Math.round(b.score*100)-Math.round(a.score*100))||(rank(b)-rank(a))||(resolver.priority(b)-resolver.priority(a))).slice(0,10);
  }
  get lowConfidence(){ if(!this._low)this._low=new Set(); return this._low; }
  matchLabel(c){ const src=c.plutonium?.source||c.source?.book||""; return `${c.name}${c.rawItem?` — create from 5etools${src?` (${src})`:""}`:c.legacy?` (2014${src?` · ${src}`:""})`:""}${c.score<1?` (${Math.round(c.score*100)}%)`:""}`; }
  /** A remembered match for this item name that still exists in this world, or null. */
  rememberedMatch(name,types=[]){
    const m=itemMemory.get(name); const u=m?.uuid; if(!u) return null;
    if(String(u).startsWith("__rawitem__")) return plutoniumBridge.rawItemById?.has(u)?{uuid:u,label:m.label}:null;
    const e=resolver.entries.find(x=>x.uuid===u)||resolver.excludedEntries.find(x=>x.uuid===u);
    return e&&(!types.length||types.includes(e.type))?{uuid:u,label:m.label||e.name,entry:e}:null;
  }
  matchSelect(id,name,types,alts=[]){
    const cs=this.matchCandidates(name,types,alts);
    if(!this.matches.has(id)&&id.startsWith("eq:")){ const mem=this.rememberedMatch(name,types); if(mem){ this.matches.set(id,mem.uuid); this.remembered.add(id); if(!cs.some(c=>c.uuid===mem.uuid)) cs.unshift({...(mem.entry||{}),uuid:mem.uuid,name:mem.label||name,score:1}); } } const inner=spellScrollInnerName(name); const sp=inner?resolver.best(inner,["spell"]):null; const scrollVal=sp?`__scroll__:${sp.uuid}`:null;
    const chosen=this.matches.get(id) || scrollVal || cs[0]?.uuid || "__placeholder__"; this.matches.set(id,chosen);
    const top=cs.find(c=>c.uuid===chosen); if(top&&top.score<MATCH_CONFIDENT&&!this.confirmed?.has(id)&&!this.remembered.has(id)) this.lowConfidence.add(id); else this.lowConfidence.delete(id);
    return `<select data-match="${esc(id)}"><option value="__placeholder__" ${chosen==='__placeholder__'?'selected':''}>Create placeholder</option>${scrollVal?`<option value="${esc(scrollVal)}" ${chosen===scrollVal?'selected':''}>Create native Spell Scroll from ${esc(sp.name)}</option>`:""}${cs.map(c=>`<option value="${esc(c.uuid)}" ${chosen===c.uuid?'selected':''}>${esc(this.matchLabel(c))}</option>`).join("")}</select>`;
  }
  validateChoices(){
    if(this.skills.length!==2) return "Select exactly two free skill proficiencies.";
    const origin=getOriginFeat(this.data); if(origin&&!this.matches.get(`feat:${origin}`)) return `Choose the database feat for the Origin feat “${origin}”, or use a placeholder.`;
    for(const d of this.advChoiceDefs){ const need=this.requiredCount(d); if((this.advChoices.get(d.id)||[]).length!==need) return `Complete choice: ${d.sourceName} — ${d.title} (choose ${need}).`; }
    if(uniqueFeatNames(this.data).some(f=>norm(f)==="resilient")&&!this.resilientSave&&this.element?.querySelector("[data-resilient-save]")) return "Choose the saving throw proficiency granted by Resilient.";
    // Skill proficiencies: no duplicates; expertise only on proficient skills.
    const fixed=new Set(), picked=[];
    for(const src of [...this.coreDocs,...this.featDocs]) for(const adv of advancementEntries(src.doc,src.level,src.isPrimary)) if(adv.type==="Trait"&&["default","upgrade",undefined].includes(adv.configuration?.mode)) for(const g of (adv.configuration?.grants||[])) if(String(g).startsWith("skills:")) fixed.add(String(g).split(":").pop());
    for(const d of this.advChoiceDefs) if(d.type==="trait"&&d.mode==="default") for(const v of (this.advChoices.get(d.id)||[])) if(String(v).startsWith("skills:")) picked.push({skill:String(v).split(":").pop(),def:d});
    const have=new Set([...fixed,...this.skills]);
    for(const p of picked){ if(have.has(p.skill)) return `${SKILLS[p.skill]} is already proficient; choose a different skill for ${p.def.sourceName} — ${p.def.title}.`; have.add(p.skill); }
    for(const d of this.advChoiceDefs) if(d.mode==="expertise") for(const v of (this.advChoices.get(d.id)||[])){ const k=String(v).split(":").pop(); if(String(v).startsWith("skills:")&&!have.has(k)) return `${d.sourceName} — ${d.title}: Expertise needs a proficient skill, and ${SKILLS[k]||k} is not proficient.`; }
    return "";
  }
  async bind(root){
    root.querySelector("[data-file]")?.addEventListener("change",async e=>{ const f=e.target.files[0]; if(!f)return; try{ await this.loadExport(await f.text(),f.name); }
      catch(err){ console.error(err); logImportError("Reading export",err); this.setBusy(""); ui.notifications.error(`Could not read export: ${err.message}`); } });
    root.querySelector("[data-copy-diagnostics]")?.addEventListener("click",()=>copyDiagnostics(this));
    root.querySelector("[data-target-actor]")?.addEventListener("change",async e=>{ if(this.busy) return; const id=e.target.value;
      try{ const t=id?game.actors?.get(id):null;
        // A character with saved choices reloads them; otherwise keep what has been chosen so far.
        if(t?.getFlag?.(MODULE_ID,"choices")) await this.loadExport(this.sourceText,this.fileName,{targetId:id}); else { this.targetActorId=id; await this.render(); } }
      catch(err){ console.error(err); logImportError("Switching import target",err); this.setBusy(""); ui.notifications.error(err.message); } });
    root.querySelector("[data-backup]")?.addEventListener("change",e=>{ this.backup=e.target.checked; });
    root.querySelector("[data-source-search]")?.addEventListener("input",e=>{ this.sourceSearch=e.target.value||""; const q=norm(this.sourceSearch); root.querySelectorAll("[data-source-row]").forEach(r=>r.style.display=!q||r.dataset.sourceRow.includes(q)?"":"none"); });
    const sourcesChanged=async()=>{ resolver.setEnabledPlutoniumSources(this.enabledSources); const s=root.querySelector(".source-filter summary small"); if(s) s.textContent=`${this.enabledSources.size}/${root.querySelectorAll("[data-source-code]").length} enabled`; if(this.data) await this.prepareCharacterMetadata(); };
    root.querySelectorAll("[data-source-code]").forEach(c=>c.addEventListener("change",async e=>{ if(this.enabledSources===null)this.enabledSources=new Set([...resolver.plutoniumSources(),...plutoniumBridge.rawFeatSources()].map(x=>x.code)); e.target.checked?this.enabledSources.add(e.target.value):this.enabledSources.delete(e.target.value); await sourcesChanged(); }));
    root.querySelector("[data-source-all]")?.addEventListener("click",async()=>{this.enabledSources=new Set([...resolver.plutoniumSources(),...plutoniumBridge.rawFeatSources()].map(x=>x.code));root.querySelectorAll("[data-source-code]").forEach(x=>x.checked=true);await sourcesChanged();});
    root.querySelector("[data-source-none]")?.addEventListener("click",async()=>{this.enabledSources=new Set();root.querySelectorAll("[data-source-code]").forEach(x=>x.checked=false);await sourcesChanged();});
    root.querySelectorAll("[data-act]").forEach(b=>b.addEventListener("click",async()=>{
      const a=b.dataset.act; if(this.busy) return;
      if(a==="back"){this.step--;await this.render();}
      else if(a==="next"){
        if(this.step===1) await this.prepareCharacterMetadata();
        if(this.step===3){
          // 2024 limits are a maximum. Warn once per selection; a second Next continues (homebrew, feats, DM rulings).
          const over=this.spellLimitProblems();
          if(over.length){ const sig=JSON.stringify([[...this.spells].sort(),[...this.spellClassAssignments.entries()]]); if(this.limitWarned!==sig){ this.limitWarned=sig; ui.notifications.warn(`Over the spell limits: ${over.join("; ")}. Remove spells, or click Next again to keep them.`); return; } }
        }
        if(this.step===2){ const problem=this.validateChoices(); if(problem){ ui.notifications.warn(problem); return; } }
        if(this.step===4){ this.setBusy("Detecting traits…"); try{ await this.refreshDetectedTraits(); } finally { this.setBusy(""); } }
        this.step++; await this.render();
      }
      else if(a==="apply-caster"){await this.rerender();}
      else if(a==="clear-spells"){this.spells.clear();root.querySelectorAll("[data-spell]").forEach(x=>x.checked=false);const count=root.querySelector("[data-spell-counts]");if(count){count.textContent=this.spellCountsText();count.classList.remove("over");}}
      else if(a==="create") await this.createActor(b);
      else if(a==="overview"){ this.step=0; await this.render(); }
    }));
    root.querySelectorAll("[data-goto-step]").forEach(b=>b.addEventListener("click",async()=>{ if(this.busy) return; const to=Number(b.dataset.gotoStep);
      if(to>=2&&this.step<2&&!this.advChoiceDefs.length) await this.prepareCharacterMetadata();
      if(to===5){ this.setBusy("Detecting traits…"); try{ await this.refreshDetectedTraits(); } finally { this.setBusy(""); } }
      this.step=to; await this.render(); }));
    root.querySelector("[data-refresh-content]")?.addEventListener("click",async()=>{ if(this.busy) return; this.setBusy("Re-reading compendiums…"); try{ await resolver.load(true); await plutoniumBridge.buildFeatIndex(true); await plutoniumBridge.buildItemIndex(true); await plutoniumBridge.buildSpellClassMap(true); if(this.data) await this.prepareCharacterMetadata(); } finally { this.setBusy(""); } await this.render(); });
    const hpInput=root.querySelector("[data-hp]"); if(hpInput){ if(this.hpOverride==="")hpInput.value=""; hpInput.addEventListener("input",e=>this.hpOverride=e.target.value); }
    root.querySelector("[data-feat-bonuses-included]")?.addEventListener("change",async e=>{ Object.defineProperty(this.data,"__featBonusesInStats",{value:e.target.checked,enumerable:false,writable:true,configurable:true}); await this.rerender(); });
    root.querySelector("[data-start-class]")?.addEventListener("change",async e=>{ this.classOrder=this.orderStartingWith(e.target.value); await this.prepareCharacterMetadata(); await this.rerender(); });
    root.querySelector("[data-species-choice]")?.addEventListener("change",async e=>{this.speciesUuid=e.target.value;await this.prepareCharacterMetadata();await this.rerender();});
    root.querySelectorAll("[data-feature-placement]").forEach(x=>x.addEventListener("change",e=>this.featurePlacements.set(e.target.dataset.featurePlacement,e.target.value)));
    root.querySelectorAll("[data-choice-placement]").forEach(x=>x.addEventListener("change",e=>this.choicePlacements.set(e.target.dataset.choicePlacement,e.target.value)));
    root.querySelector("[data-resilient-save]")?.addEventListener("change",e=>this.resilientSave=e.target.value);
    root.querySelector("[data-owner]")?.addEventListener("change",e=>this.ownerId=e.target.value);
    root.querySelectorAll("[data-final-trait]").forEach(x=>x.addEventListener("change",e=>{const set=this.finalTraits[e.target.dataset.finalTrait],v=traitKey(e.target.value);e.target.checked?set.add(v):set.delete(v);}));
    root.querySelectorAll("[data-final-sense]").forEach(x=>x.addEventListener("input",e=>this.finalTraits.senses[e.target.dataset.finalSense]=e.target.value));
    root.querySelectorAll("[data-caster-level]").forEach(i=>i.addEventListener("input",e=>{const p=this.casterProfiles.get(e.target.dataset.casterLevel);if(p)p.casterLevel=Number(e.target.value)||0;}));
    root.querySelectorAll("[data-caster-progression]").forEach(i=>i.addEventListener("change",e=>{const p=this.casterProfiles.get(e.target.dataset.casterProgression);if(p)p.progression=e.target.value;}));
    root.querySelectorAll("[data-caster-ability]").forEach(i=>i.addEventListener("change",e=>{const p=this.casterProfiles.get(e.target.dataset.casterAbility);if(p)p.ability=e.target.value;}));
    root.querySelectorAll("[data-caster-max]").forEach(i=>i.addEventListener("input",e=>{const p=this.casterProfiles.get(e.target.dataset.casterMax);if(p)p.maxOverride=e.target.value;}));
    const updateCounts=()=>{const c=root.querySelector("[data-spell-counts]");if(c){c.textContent=this.spellCountsText();c.classList.toggle("over",this.spellLimitProblems().length>0);}};
    root.querySelectorAll("[data-spell-class]").forEach(i=>i.addEventListener("change",e=>{this.spellClassAssignments.set(e.target.dataset.spellClass,e.target.value);updateCounts();}));
    root.querySelectorAll("[data-skill]").forEach(c=>c.addEventListener("change",e=>{
      const v=e.target.value;
      if(e.target.checked&&!this.skills.includes(v))this.skills.push(v);
      if(!e.target.checked)this.skills=this.skills.filter(x=>x!==v);
      // Update disabled states in place; re-rendering resets scroll position in Foundry v14.
      root.querySelectorAll("[data-skill]").forEach(x=>x.disabled=!x.checked&&this.skills.length>=2);
      if(this.step===0&&this.skills.length===2) this.render();  // refresh the overview once both are picked
    }));
    const featChanged=async()=>{ this.setBusy("Loading feat choices…"); try{ await this.rebuildChoiceDefs(); await this.rebuildFeaturePlacementDefs(); } finally { this.setBusy(""); } await this.rerender(); };
    root.querySelectorAll("[data-match]").forEach(s=>s.addEventListener("change",async e=>{ const id=e.target.dataset.match; this.matches.set(id,e.target.value); (this.confirmed??=new Set()).add(id); this.lowConfidence.delete(id); e.target.closest(".needs-check")?.classList.remove("needs-check"); if(id.startsWith("feat:")) await featChanged(); else if(id.startsWith("eq:")){ const i=Number(id.slice(3)); const st=this.equipment.get(id)||{}; if(!("equipped" in st)){ const d=this.defaultEquipment(flattenOwned(this.data)).get(id); this.updateEq(id,{equipped:d?.equipped??false}); const box=root.querySelector(`[data-eq-equipped="${CSS.escape(id)}"]`); if(box) box.checked=!!this.equipment.get(id).equipped; } } }));
    const refreshOriginResults=(id,input)=>{
      const q=input.value||""; this.advSearch.set(id,q); const host=root.querySelector(`[data-origin-results="${CSS.escape(id)}"]`); if(!host)return;
      const results=this.featSearchCandidates(q,true);
      host.innerHTML=results.map(r=>`<button type="button" data-origin-result="${esc(id)}" data-origin-uuid="${esc(r.uuid)}"><span>${esc(r.displayName)}</span><small>${esc(r.plutonium?.source||r.source?.book||"")}</small></button>`).join("") || (norm(q).length>=2?'<p class="muted">No matching 2024 feat documents found. Check the source filter on Upload.</p>':'<p class="muted">Enter at least 2 characters.</p>');
      host.querySelectorAll("[data-origin-result]").forEach(b=>b.addEventListener("click",()=>selectOriginResult(id,b.dataset.originUuid)));
    };
    const selectOriginResult=async(id,uuid)=>{
      if(id.startsWith("server-origin:")){ const origin=id.slice("server-origin:".length); this.matches.set(`feat:${origin}`,uuid); } else this.advChoices.set(id,[uuid]);
      await featChanged();
    };
    root.querySelectorAll("[data-origin-placeholder]").forEach(b=>b.addEventListener("click",async()=>{ const origin=b.dataset.originPlaceholder.slice("server-origin:".length); this.matches.set(`feat:${origin}`,"__placeholder__"); await featChanged(); }));
    root.querySelectorAll("[data-origin-search]").forEach(input=>{const id=input.dataset.originSearch;input.addEventListener("input",()=>refreshOriginResults(id,input));refreshOriginResults(id,input);});
    root.querySelectorAll("[data-adv-choice]").forEach(c=>c.addEventListener("change",async e=>{
      const id=e.target.dataset.advChoice,def=this.advChoiceDefs.find(d=>d.id===id); if(!def) return; const need=this.requiredCount(def); let a=[...(this.advChoices.get(id)||[])];
      if(e.target.checked&&!a.includes(e.target.value))a.push(e.target.value);
      if(!e.target.checked)a=a.filter(x=>x!==e.target.value);
      if(a.length>need){ const removed=a.shift(); const other=[...root.querySelectorAll(`[data-adv-choice="${CSS.escape(id)}"]`)].find(x=>x.value===removed); if(other)other.checked=false; }
      this.advChoices.set(id,a);
      root.querySelectorAll(`[data-adv-choice="${CSS.escape(id)}"]`).forEach(x=>x.disabled=!x.checked&&a.length>=need);
      if(def.type==="weapon-mastery") {
        const used=new Set(this.advChoiceDefs.filter(d=>d.type==="weapon-mastery").flatMap(d=>this.advChoices.get(d.id)||[]));
        root.querySelectorAll('[data-adv-choice]').forEach(x=>{ const d=this.advChoiceDefs.find(q=>q.id===x.dataset.advChoice); if(d?.type==="weapon-mastery"&&!x.checked&&used.has(x.value)) x.disabled=true; });
      }
      const miOpt=def.options?.find(o=>o.label==="Magic Initiate"); const wrap=root.querySelector(`[data-mi-wrap="${CSS.escape(id)}"]`);
      if(wrap&&miOpt) wrap.style.display=a.includes(miOpt.value)?"":"none";
      // A feat picked here may have its own choices (e.g. Human Versatile -> Skilled).
      if(["item","origin-search"].includes(def.type)&&def.options.some(o=>this.featEntryById(o.value)?.type==="feat")) await featChanged();
    }));
    root.querySelectorAll("[data-magic-initiate-list]").forEach(s=>s.addEventListener("change",async e=>{ this.magicInitiateList=e.target.value; await featChanged(); }));
    root.querySelectorAll("[data-spell]").forEach(c=>c.addEventListener("change",e=>{ e.target.checked?this.spells.add(e.target.value):this.spells.delete(e.target.value); updateCounts(); }));
    const filterSpells=()=>{ const q=(root.querySelector("[data-spell-search]")?.value||"").toLowerCase(); const lvl=String(this.spellLevelFilter); root.querySelectorAll("[data-spell-row]").forEach(r=>r.style.display=(r.dataset.spellRow.includes(q)&&(lvl==="all"||r.dataset.spellLevel===lvl))?"":"none"); };
    root.querySelector("[data-spell-search]")?.addEventListener("input",filterSpells);
    root.querySelector("[data-spell-level-filter]")?.addEventListener("change",e=>{ this.spellLevelFilter=e.target.value; filterSpells(); });
    if(root.querySelector("[data-spell-level-filter]")) filterSpells();
    root.querySelectorAll("[data-eq-qty]").forEach(i=>i.addEventListener("change",e=>this.updateEq(e.target.dataset.eqQty,{qty:Math.max(0,Number(e.target.value)||0)})));
    root.querySelectorAll("[data-eq-equipped]").forEach(i=>i.addEventListener("change",e=>this.updateEq(e.target.dataset.eqEquipped,{equipped:e.target.checked})));
    root.querySelectorAll("[data-eq-attuned]").forEach(i=>i.addEventListener("change",e=>this.updateEq(e.target.dataset.eqAttuned,{attuned:e.target.checked})));
  }
  updateEq(id,patch){this.equipment.set(id,{...(this.equipment.get(id)||{}),...patch});}
  async docData(uuid){ if(!uuid||uuid==="__placeholder__")return null; if(String(uuid).startsWith("__rawfeat__"))return plutoniumBridge.rawFeatToItemData(uuid); if(String(uuid).startsWith("__rawitem__"))return plutoniumBridge.rawItemToItemData(uuid); try{const d=await fromUuid(uuid); return d?.toObject?.()||null;}catch(_){return null;} }
  async nativeScrollData(value,qty=1){
    if(!String(value||"").startsWith("__scroll__:")) return null;
    const uuid=String(value).slice("__scroll__:".length); const spell=await getDoc(uuid); if(!spell)return null;
    const candidates=[game.dnd5e?.documents?.Item5e, CONFIG.Item?.documentClass, spell.constructor].filter(Boolean);
    for(const cls of candidates){
      for(const fn of ["createScrollFromSpell","createScroll"]){
        if(typeof cls?.[fn]!=="function")continue;
        try{ const out=await cls[fn](spell,{level:Number(spell.system?.level||0),prompt:false,create:false}); const d=out?.toObject?.()||out; if(d&&typeof d==="object"){foundry.utils.setProperty(d,"system.quantity",qty||1);return d;} }catch(e){console.warn(`${MODULE_ID} native scroll via ${fn} failed`,e);}
      }
    }
    const generic=resolver.best("Spell Scroll",["consumable"]); let d=generic?await this.docData(generic.uuid):null;
    if(d){ d.name=`Spell Scroll (${spell.name})`; foundry.utils.setProperty(d,"system.quantity",qty||1); const old=foundry.utils.getProperty(d,"system.description.value")||""; foundry.utils.setProperty(d,"system.description.value",`${old}<hr><p><b>Contained spell:</b> @UUID[${spell.uuid}]{${esc(spell.name)}}</p>`); d.flags=d.flags||{}; d.flags[MODULE_ID]={generatedScroll:true,spellUuid:spell.uuid}; return d; }
    return null;
  }
  async fightingStyleDocData(sourceDoc, uuid){
    const synthName=syntheticFightingStyleName(uuid);
    if(!synthName) return this.advancementDocData(sourceDoc,uuid);
    const k=norm(synthName);
    // Prefer any exact-name Foundry feat, even if its source metadata was classified as legacy.
    const all=[...resolver.entries,...resolver.excludedEntries].filter(e=>(e.type==="feat"||e.rawType==="feat")&&norm(canonicalFightingStyleName(e.name))===k)
      .sort((a,b)=>resolver.priority(b)-resolver.priority(a));
    for(const e of all){const d=await this.docData(e.uuid);if(d)return d;}
    // Then try raw 5etools/UA data.
    const raw=(plutoniumBridge.rawFeats||[]).find(f=>norm(canonicalFightingStyleName(f.name))===k);
    if(raw)return plutoniumBridge.rawFeatToItemData(plutoniumBridge.rawFeatId(raw));
    // Last resort: create a visible native feat instead of silently deleting a legal choice.
    return {name:synthName,type:"feat",img:"icons/svg/sword.svg",system:{source:{custom:"D&D Friends Character Importer fallback",book:"",page:"",license:"",rules:"2024",revision:1},description:{value:`<p><b>${esc(synthName)}</b> Fighting Style.</p><p>The source Fighting Style document was not available in the indexed compendiums when this character was imported. Replace this fallback with your server's full feat document if it contains automation or effects.</p>`,chat:""},requirements:"Fighting Style feature",prerequisites:{level:null,items:[],repeatable:false},uses:{max:"",spent:0,recovery:[]},type:{value:"feat",subtype:"fightingStyle"},properties:[],advancement:{},activities:{},identifier:norm(synthName).replace(/ /g,"-")},flags:{[MODULE_ID]:{fightingStyleFallback:true}},effects:[]};
  }

  async advancementDocData(sourceDoc, uuid){
    if(!uuid) return null;
    // Plutonium actor-owned subclass/class advancements commonly use relative sibling UUIDs (e.g. ".abc123").
    if(String(uuid).startsWith(".")){
      const id=String(uuid).slice(1); const parent=sourceDoc?.parent;
      const sibling=parent?.items?.get?.(id) || parent?.items?.find?.(it=>it.id===id || it._id===id);
      if(sibling) return sibling.toObject?.()||null;
      if(parent?.uuid){ try{const d=await fromUuid(`${parent.uuid}.Item.${id}`); if(d)return d.toObject?.()||null;}catch(_){} }
      return null;
    }
    return this.docData(uuid);
  }
  placeholder(name,type="loot",qty=1,raw=null){
    const sys={quantity:qty,description:{value:`<p>Placeholder created by D&D Friends Character Importer. Original export name: <b>${esc(name)}</b>.</p>`},source:{custom:"D&D Friends Character Importer",rules:"2024"}};
    // Keep what the export knows: rarity and attunement (magic item placeholders become equipment so attunement works).
    if(raw&&typeof raw==="object"){ const r=rarityKey(raw.Rarity); if(r) sys.rarity=r; if(raw.Attunement){ sys.attunement="required"; sys.attuned=raw.Attuned===true; }
      if(type==="equipment") sys.type={value:equipmentMiscType("wondrous")}; }
    return {name,type,img:"icons/svg/item-bag.svg",system:sys};
  }
  magicInitiateVariantUuid(baseUuid){
    const base=resolver.entries.find(e=>e.uuid===baseUuid); if(originChoiceCanonicalName(base?.name||"")!=="Magic Initiate") return baseUuid;
    const list=norm(this.magicInitiateList||"wizard");
    const matches=resolver.entries.filter(e=>resolver.allowed(e)).filter(e=>e.type==="feat" && /^magic\s+initiate/i.test(String(e.name||"")) && norm(e.name).includes(list)).sort(preferredOriginChoice);
    return matches[0]?.uuid||baseUuid;
  }

  /** Walk species, class, subclass and feat advancements: trait grants, granted items and chosen items. */
  async collectNativeAdvancementData(){
    const embeds=[]; const updates={}; const warnings=[]; const unresolved=[];
    const seen=new Set(); const pushDoc=(d,owner,placementKey=null,guess="other",ownerName="")=>{if(!d)return;const k=`${d.type}:${norm(d.name)}:${owner}`;if(seen.has(k))return;seen.add(k);d.flags=d.flags||{};d.flags[MODULE_ID]={...(d.flags[MODULE_ID]||{}),placementKey,placementGuess:guess,placementOwnerName:ownerName,owner};embeds.push(d);};
    for(const src of [...this.coreDocs,...this.featDocs]){
      const owner=`${src.kind}:${src.name}`;
      for(const adv of advancementEntries(src.doc,src.level,src.isPrimary)){
        const id=`${src.kind}:${src.name}:${adv._id}`; const mode=adv.configuration?.mode||"default";
        if(adv.type==="Trait"){
          for(const g of (adv.configuration?.grants||[])) parseTraitGrant(g,updates,mode);
          for(const g of (this.advChoices.get(id)||[])) parseTraitGrant(g,updates,mode);
        }else if(adv.type==="Size"){
          const sizes=[...(adv.configuration?.sizes||[])]; const want=this.botSize();
          const size=sizes.includes(want)?want:sizes.length===1?sizes[0]:sizes.includes("med")?"med":sizes[0];
          if(size) updates["system.traits.size"]=size;
        }else if(adv.type==="ItemGrant"){
          for(const it of (adv.configuration?.items||[])){
            if(it.optional) continue;
            const d=await this.advancementDocData(src.doc,it.uuid);
            if(d){ if(d.type==="spell") applySpellConfig(d,adv.configuration?.spell,src.doc,effectiveStats(this.data)); const key=featurePlacementKey(owner,d.name); pushDoc(d,owner,key,placementKindFromSource(src.kind),src.doc?.name||src.name); }
            else warnings.push(`Could not resolve granted feature: ${it.uuid}`);
          }
        }else if(adv.type==="ItemChoice"){
          const picks=this.advChoices.get(id)||[];
          const def=this.advChoiceDefs.find(d=>d.id===id); if(def&&picks.length<def.count) unresolved.push(`${def.sourceName} — ${def.title}: ${def.count-picks.length} choice(s) left to make on the sheet`);
          for(const uuid0 of picks){const uuid=this.magicInitiateVariantUuid(uuid0);const d=def?.type==="fighting-style"?await this.fightingStyleDocData(src.doc,uuid):await this.docData(uuid);if(d){ if(d.type==="spell") applySpellConfig(d,adv.configuration?.spell,src.doc,effectiveStats(this.data)); const place=this.choicePlacements.get(id)||placementKindFromSource(src.kind==="feat"?"other":src.kind);pushDoc(d,owner,`choice:${id}:${norm(d.name)}`,place,src.doc?.name||src.name);}else warnings.push(`Could not resolve chosen feature: ${uuid}`);}
        }
      }
    }
    for(const d of this.advChoiceDefs) if(d.type==="trait"&&(this.advChoices.get(d.id)||[]).length<d.count) unresolved.push(`${d.sourceName} — ${d.title}: ${d.count-(this.advChoices.get(d.id)||[]).length} choice(s) left (not enough options were found)`);
    return {embeds,updates,warnings,unresolved};
  }
  /** Populate each class's HitPoints advancement so Foundry derives HP (and adds Tough, CON changes, level-ups). */
  async backupActor(actor){
    const data=actor.toObject(); delete data._id; data.name=`${actor.name} (backup ${new Date().toLocaleDateString()})`;
    data.flags=data.flags||{}; data.flags[MODULE_ID]={...(data.flags[MODULE_ID]||{}),backupOf:actor.id}; delete data.flags[MODULE_ID].choices;
    return Actor.implementation.create(data);
  }
  /**
   * Update mode: new items are created; class levels and item quantities are updated in place; species, subclasses,
   * features, feats and spells already on the sheet are left untouched. Returns what still needs creating.
   */
  async mergeIntoActor(actor,embeds,fixedHp,startClass){
    const key=d=>`${d.type}:${norm(d.name)}`; const items=[...actor.items];
    const have=new Map(); for(const it of items){ const k=key(it); if(!have.has(k)) have.set(k,it); }
    const create=[], updates=[], summary={added:[],levels:[],qty:[],notInExport:[]};
    for(const d of embeds){
      const ident=d.system?.identifier;
      const ex=have.get(key(d))||(ident&&["class","subclass"].includes(d.type)?items.find(i=>i.type===d.type&&i.system?.identifier===ident):null);
      if(!ex){ create.push(d); summary.added.push(`${d.name}${d.type==="class"?` ${d.system?.levels||""}`:""}`); continue; }
      if(d.type==="class"){
        const from=Number(ex.system?.levels||0), to=Number(d.system?.levels||0); if(to===from) continue;
        const obj=ex.toObject(); foundry.utils.setProperty(obj,"system.levels",to);
        if(!fixedHp){ // keep the HP already rolled or chosen for earlier levels
          const old=Object.fromEntries(advancementList(ex.toObject()).filter(a=>a?.type==="HitPoints").map(a=>[a._id,a.value||{}]));
          this.applyHitPointAdvancement(obj,to,norm(d.name)===startClass);
          for(const a of advancementList(obj)) if(a?.type==="HitPoints") a.value={...a.value,...Object.fromEntries(Object.entries(old[a._id]||{}).filter(([l])=>Number(l)<=to))};
        }
        updates.push({_id:ex.id,"system.levels":to,"system.advancement":obj.system.advancement}); summary.levels.push(`${ex.name} ${from} → ${to}`); continue;
      }
      if(PHYSICAL_TYPES.has(d.type)){ const q=Number(d.system?.quantity||1), oq=Number(ex.system?.quantity||1); if(q!==oq){ updates.push({_id:ex.id,"system.quantity":q}); summary.qty.push(`${ex.name}: ${oq} → ${q}`); } }
    }
    if(updates.length) await Item.implementation.updateDocuments(updates,{parent:actor});
    const inExport=new Set(embeds.filter(d=>PHYSICAL_TYPES.has(d.type)).map(key));
    summary.notInExport=items.filter(i=>PHYSICAL_TYPES.has(i.type)&&i.flags?.[MODULE_ID]?.fromExport&&!inExport.has(key(i))).map(i=>i.name);
    return {create,summary};
  }
  /** Update mode never lowers a proficiency, removes a trait or shrinks a sense. */
  mergeWithExisting(actor,updates){
    const src=actor.toObject?actor.toObject():actor;
    for(const [k,v] of Object.entries(updates)){
      const cur=foundry.utils.getProperty(src,k);
      if(typeof v==="number"&&typeof cur==="number") updates[k]=Math.max(cur,v);
      else if(Array.isArray(v)&&cur&&typeof cur!=="string") updates[k]=[...new Set([...(cur instanceof Set?[...cur]:Array.isArray(cur)?cur:[]),...v])];
      else if(v===null&&cur!=null) delete updates[k];
    }
    if(foundry.utils.getProperty(src,"system.details.originalClass")) delete updates["system.details.originalClass"];
    return updates;
  }
  applyHitPointAdvancement(d,levels,isStartingClass){
    for(const adv of advancementList(d)){ if(adv?.type!=="HitPoints") continue; const value={}; for(let l=1;l<=levels;l++) value[String(l)]=(l===1&&isStartingClass)?"max":"avg"; adv.value=value; }
  }
  async createActor(button){
    if(this.creating) return;
    const problem=this.validateChoices(); if(problem){ ui.notifications.warn(problem); return; }
    this.creating=true; if(button) button.disabled=true;
    this.ensureEquipmentMatches(); try{ await this.refreshDetectedTraits(); }catch(e){ console.warn(`${MODULE_ID} trait detection failed`,e); }
    let actor=null; const target=this.targetActor(); const updating=!!target; let backup=null, summary=null;
    if(this.targetActorId&&!target){ ui.notifications.error("The character to update no longer exists. Choose it again or import as a new character."); this.creating=false; if(button) button.disabled=false; return; }
    try{
      this.setBusy(updating?`Updating ${target.name}…`:"Creating character…");
      const owned=flattenOwned(this.data);
      const placeholderMagic=new Set(owned.map((x,i)=>x.category==="Magic Item"&&(!this.matches.get(`eq:${i}`)||this.matches.get(`eq:${i}`)==="__placeholder__")?x.key:null).filter(Boolean));
      // Matched magic items apply their own active effects; only placeholder items fall back to the bot's stat bonus.
      const stats=effectiveStats(this.data,key=>placeholderMagic.has(key));
      const fixedHp=Number(this.hpOverride)||0;
      // Explicit ownership replaces Foundry's default, so always keep the importing user as owner;
      // otherwise a player could not add items to the actor they just created.
      const OWNER=CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER; const ownership={default:0}; if(game.user?.id) ownership[game.user.id]=OWNER; if(this.ownerId) ownership[this.ownerId]=OWNER;
      const history=entry=>[...((target?.getFlag?.(MODULE_ID,"history"))||[]),entry].slice(-10);
      const histEntry={at:Date.now(),file:this.fileName,level:this.characterLevel(),mode:updating?"update":"create",by:game.user?.name||"",module:moduleVersion()};
      let oldHp=null;
      if(updating){
        actor=target; oldHp={value:Number(actor.system?.attributes?.hp?.value)||0,max:Number(actor.system?.attributes?.hp?.max)||0};
        if(this.backup){ this.setBusy("Saving a backup copy…"); backup=await this.backupActor(actor); this.setBusy(`Updating ${actor.name}…`); }
        const up={"system.currency.gp":Number(this.data.GP||0)}; for(const a of ABILITIES) up[`system.abilities.${a}.value`]=stats[a];
        if(fixedHp) up["system.attributes.hp.max"]=fixedHp;
        await actor.unsetFlag?.(MODULE_ID,"rawExport");
        up[`flags.${MODULE_ID}.sourceFile`]=this.fileName; up[`flags.${MODULE_ID}.rawExport`]=this.data; up[`flags.${MODULE_ID}.classOrder`]=this.classOrder; up[`flags.${MODULE_ID}.history`]=history(histEntry);
        await actor.update(up);
      } else
      actor=await Actor.implementation.create({name:this.data.Name,type:"character",ownership,system:{abilities:Object.fromEntries(ABILITIES.map(a=>[a,{value:stats[a]}])),currency:{gp:Number(this.data.GP||0)},attributes:{hp:{value:fixedHp||1,max:fixedHp||null,temp:0,tempmax:0}},details:{alignment:"",background:null}},flags:{[MODULE_ID]:{sourceFile:this.fileName,rawExport:this.data,classOrder:this.classOrder,history:history(histEntry)}}});
      const embeds=[]; const warnings=[];
      const startClass=norm(this.classOrder[0]||Object.keys(this.data.Class||{})[0]||"");
      // Species, classes and subclasses: reuse the documents matched on the Core step.
      const race=this.coreDocs.find(x=>x.kind==="race"); if(race){ const d=race.doc?.toObject?.()||await this.docData(race.uuid); if(d)embeds.push(foundry.utils.deepClone(d)); } else warnings.push(`Species not found: ${normalizeSpeciesName(this.data.Race)}`);
      for(const [cn,c] of Object.entries(this.data.Class||{})){
        const cls=this.coreDocs.find(x=>x.kind==="class"&&x.name===cn);
        if(cls){ const d=foundry.utils.deepClone(cls.doc?.toObject?.()||await this.docData(cls.uuid)); foundry.utils.setProperty(d,"system.levels",Number(c.Level||1)); if(!fixedHp) this.applyHitPointAdvancement(d,Number(c.Level||1),norm(cn)===startClass); embeds.push(d); }
        else warnings.push(`Class not found: ${cn}`);
        if(c.Subclass){ const sub=this.coreDocs.find(x=>x.kind==="subclass"&&x.name===c.Subclass&&x.className===cn); if(sub){ const sd=sub.doc?.toObject?.()||await this.docData(sub.uuid); if(sd)embeds.push(foundry.utils.deepClone(sd)); } else warnings.push(`Subclass not found: ${c.Subclass} (${cn})`); }
      }
      const nativeAdv=await this.collectNativeAdvancementData(); embeds.push(...nativeAdv.embeds); warnings.push(...nativeAdv.warnings);
      const featNames=new Set(nativeAdv.embeds.filter(d=>d.type==="feat").map(d=>norm(originChoiceCanonicalName(d.name))));
      // Feats from the bot (Origin feat first). Skip any the advancements already granted.
      for(const f of uniqueFeatNames(this.data)){
        if(featNames.has(norm(f))) continue;
        const id=`feat:${f}`; const u=this.magicInitiateVariantUuid(this.matches.get(id)); let d=await this.docData(u);
        if(!d){d=this.placeholder(f,"feat",1);warnings.push(`Feat placeholder: ${f}`);}
        const isOrigin=norm(f)===norm(getOriginFeat(this.data)); const pk=isOrigin?featurePlacementKey("server-origin",f):featurePlacementKey("feat",f);
        d.flags=d.flags||{};d.flags[MODULE_ID]={...(d.flags[MODULE_ID]||{}),placementKey:pk,placementGuess:this.featurePlacements.get(pk)||(isOrigin?"background":"other")};embeds.push(d); featNames.add(norm(f));
      }
      // Subclass spells detected from feature tables: always prepared, linked to the subclass.
      for(const g of this.grantedSpells.values()){const d=await this.docData(g.uuid);if(!d)continue;const p=this.casterProfiles.get(g.ownerClass);const src=this.castingSourceFor(g.ownerClass);setSpellFields(d,{method:"spell",prepared:2,sourceItem:g.subclassIdentifier?`subclass:${g.subclassIdentifier}`:src.key,ability:p?.ability&&p.ability!==src.ability?p.ability:undefined});d.flags=d.flags||{};d.flags[MODULE_ID]={...(d.flags[MODULE_ID]||{}),grantedBySubclass:g.ownerSubclass,grantedByFeature:g.feature,spellcastingClass:g.ownerClass};embeds.push(d);}
      // Hand-picked spells: link to their class (sourceItem), prepare leveled spells, pact method for Warlocks.
      for(const u of this.spells){const d=await this.docData(u);if(!d)continue;const cn=this.spellClassAssignments.get(u);const p=cn?this.casterProfiles.get(cn):null;const src=cn?this.castingSourceFor(cn):null;const level=Number(d.system?.level||0);
        setSpellFields(d,{method:p?.progression==="pact"?"pact":"spell",prepared:level>0?1:0,sourceItem:src?.key||undefined,ability:p?.ability&&(!src?.ability||p.ability!==src.ability)?p.ability:undefined});
        d.flags=d.flags||{};d.flags[MODULE_ID]={...(d.flags[MODULE_ID]||{}),spellcastingClass:cn||null,spellcastingAbility:p?.ability||null};embeds.push(d);}
      // Equipment: merge duplicate items by adding quantities; skip items with nothing left.
      const defaults=this.defaultEquipment(owned);
      for(let i=0;i<owned.length;i++){const x=owned[i],id=`eq:${i}`,u=this.matches.get(id),state=this.equipState(i,x,defaults); if(Number(state.qty)<=0) continue; let d=String(u||"").startsWith("__scroll__:")?await this.nativeScrollData(u,state.qty):await this.docData(u);if(!d){d=this.placeholder(x.name,x.category==="Consumable"?"consumable":x.category==="Magic Item"?"equipment":"loot",state.qty,x.raw);warnings.push(`Item placeholder: ${x.name}`);} else if(d?.flags?.[MODULE_ID]?.rawItemFallback){warnings.push(`Created from 5etools text, check its mechanics: ${d.name}`);} foundry.utils.setProperty(d,"system.quantity",Number(state.qty)||1); // Converted 5etools items may omit these fields, so set them on every physical item.
        if(PHYSICAL_TYPES.has(d.type)||foundry.utils.hasProperty(d,"system.equipped"))foundry.utils.setProperty(d,"system.equipped",!!state.equipped); if(foundry.utils.hasProperty(d,"system.attuned")||d.system?.attunement)foundry.utils.setProperty(d,"system.attuned",!!state.attuned); d.flags=d.flags||{}; d.flags[MODULE_ID]={...(d.flags[MODULE_ID]||{}),fromExport:true}; embeds.push(d);}
      const deduped=[]; const byKey=new Map();
      for(const d of embeds){
        const owner=d?.flags?.[MODULE_ID]?.owner||"";
        const k=PHYSICAL_TYPES.has(d?.type)?`${d.type}:${norm(d.name)}`:d?.type==="spell"?`spell:${norm(d.name)}`:`${d?.type}:${norm(d?.name)}:${owner}`;
        const prev=byKey.get(k);
        if(prev){ if(PHYSICAL_TYPES.has(d.type)) prev.system.quantity=Number(prev.system.quantity||1)+Number(d.system?.quantity||1); continue; }
        byKey.set(k,d); deduped.push(d);
      }
      for(const d of deduped){delete d._id;delete d.folder;delete d.ownership;delete d.sort;delete d._stats;}
      let toCreate=deduped;
      if(updating){ this.setBusy("Comparing with the sheet…"); const res=await this.mergeIntoActor(actor,deduped,fixedHp,startClass); toCreate=res.create; summary=res.summary; }
      this.setBusy(`Adding ${toCreate.length} items…`);
      const created=toCreate.length?await Item.implementation.createDocuments(toCreate,{parent:actor}):[];
      // Display-only feature placement against the local species/class/subclass documents.
      const parents={species:actor.items.find(i=>i.type==="race"),class:actor.items.find(i=>i.type==="class"&&norm(i.name)===startClass),subclass:actor.items.find(i=>i.type==="subclass")};
      const firstGrantId=doc=>{const a=advancementEntries(doc,99,true).find(x=>x.type==="ItemGrant");return a?._id||"cbiPlacement";}; const placementUpdates=[];
      for(const item of created){const meta=item.flags?.[MODULE_ID];if(!meta?.placementKey)continue;const place=this.featurePlacements.get(meta.placementKey)||meta.placementGuess||"other";let typeValue=item.system?.type?.value||"feat",origin=null;
        if(place==="species"){if(typeValue!=="feat")typeValue="race";const p=parents.species;if(p)origin=`${p.id}.${firstGrantId(p)}`;}
        else if(place==="class"){if(typeValue!=="feat")typeValue="class";const p=parents.class;if(p)origin=`${p.id}.${firstGrantId(p)}`;}
        else if(place==="subclass"){if(typeValue!=="feat")typeValue="class";const p=parents.subclass;if(p)origin=`${p.id}.${firstGrantId(p)}`;}
        else if(place==="background"){typeValue="background";origin=null;}
        else {if(["race","class","background"].includes(typeValue))typeValue="feat";origin=null;}
        placementUpdates.push({_id:item.id,"system.type.value":typeValue,"flags.dnd5e.advancementOrigin":origin});
      }
      if(placementUpdates.length)await Item.implementation.updateDocuments(placementUpdates,{parent:actor});
      // Proficiencies from advancements, the server's two free skills, and the Final Traits page.
      const updates={...nativeAdv.updates};
      for(const sk of this.skills){ const p=`system.skills.${sk}.value`; updates[p]=Math.max(1,Number(updates[p]||0)); }
      if(this.resilientSave)updates[`system.abilities.${this.resilientSave}.proficient`]=1;
      for(const k of ["dr","di","dv","ci","languages"]) updates[`system.traits.${k}.value`]=[...this.finalTraits[k]];
      for(const k of Object.keys(updates)) if(/^system\.tools\.[^.]+\.value$/.test(k)&&!this.finalTraits.tools.has(k.split(".")[2])) delete updates[k];
      for(const tool of this.finalTraits.tools){ const p=`system.tools.${tool}.value`; updates[p]=Math.max(1,Number(updates[p]||0)); }
      let darkvision=0;
      for(const [sense,val] of Object.entries(this.finalTraits.senses)){const n=Number(val);updates[`system.attributes.senses.ranges.${sense}`]=Number.isFinite(n)&&n>0?n:null;if(sense==="darkvision"&&n>0)darkvision=n;}
      const startItem=actor.items.find(i=>i.type==="class"&&norm(i.name)===startClass); if(startItem) updates["system.details.originalClass"]=startItem.id;
      if(darkvision){ updates["prototypeToken.sight.range"]=darkvision; updates["prototypeToken.sight.visionMode"]="darkvision"; }
      if(updating) this.mergeWithExisting(actor,updates);
      await actor.update(updates);
      // Fill every spell slot, then set current HP to the calculated (or fixed) maximum.
      actor.prepareData(); const slotUpdates={};
      if(updating){ // keep current HP and slots; add any increase in maximum HP to current HP
        const newMax=Number(actor.system?.attributes?.hp?.max)||fixedHp||oldHp.max||1; slotUpdates["system.attributes.hp.value"]=Math.max(0,Math.min(newMax,oldHp.value+Math.max(0,newMax-oldHp.max)));
      } else {
        for(const [k,v] of Object.entries(actor.system?.spells||{})){const max=Number(v?.max);if(Number.isFinite(max)&&max>0)slotUpdates[`system.spells.${k}.value`]=max;}
        slotUpdates["system.attributes.hp.value"]=Number(actor.system?.attributes?.hp?.max)||fixedHp||1;
      }
      await actor.update(slotUpdates);
      // Save every choice for the next import of this character, and remember hand-picked item matches for everyone.
      try{ await actor.unsetFlag?.(MODULE_ID,"choices"); await actor.setFlag(MODULE_ID,"choices",this.snapshotChoices()); }catch(e){ console.warn(`${MODULE_ID} | could not save import choices`,e); logImportError("Saving import choices",e); }
      try{ await itemMemory.remember([...this.confirmed].filter(id=>id.startsWith("eq:")).map(id=>{ const x=owned[Number(id.slice(3))]; const u=this.matches.get(id); return {name:x?.name,uuid:u,label:this.itemEntryFor(u)?.name||""}; })); }catch(e){ console.warn(`${MODULE_ID} | could not remember item matches`,e); }
      await actor.sheet?.render(true);
      const followUp=[...warnings,...nativeAdv.unresolved];
      const did=updating?"Updated":"Created";
      ui.notifications[followUp.length?"warn":"info"](followUp.length?`${did} ${actor.name}. ${followUp.length} item(s) need review.`:`${did} ${actor.name}.`);
      const list=(title,arr)=>arr?.length?`<p><b>${title}</b></p><ul>${arr.map(w=>`<li>${esc(w)}</li>`).join("")}</ul>`:"";
      if(updating) await foundry.applications.api.DialogV2.prompt({window:{title:"Update Summary"},content:`<div>${list("Class levels",summary?.levels)}${list(`Added (${summary?.added?.length||0})`,summary?.added)}${list("Quantities changed",summary?.qty)}${list("Still on the sheet but no longer in the export (left as they are)",summary?.notInExport)}${list("Needs attention",followUp)}${!summary?.levels?.length&&!summary?.added?.length&&!summary?.qty?.length?"<p>Nothing new was found in this export.</p>":""}${backup?`<p class="muted">A backup copy was saved as <b>${esc(backup.name)}</b>. Delete it once you are happy with the update.</p>`:""}</div>`,ok:{label:"Done"}});
      else if(followUp.length) await foundry.applications.api.DialogV2.prompt({window:{title:"Import Review"},content:`<div><p>The actor was created. These items still need attention on the sheet:</p><ul>${followUp.map(w=>`<li>${esc(w)}</li>`).join("")}</ul><p>Everything else chosen in the wizard was applied.</p></div>`,ok:{label:"Done"}});
      this.close();
    }catch(err){
      console.error(err); logImportError(updating?"Updating a character":"Creating a character",err);
      if(updating) ui.notifications.error(`The update stopped partway: ${err.message}.${backup?` The backup copy "${backup.name}" has the character as it was.`:""} Use Copy diagnostics on the first screen to report it.`,{permanent:true});
      else { if(actor){ try{ await actor.delete(); }catch(_){} } ui.notifications.error(`Import failed, so the partial actor was removed: ${err.message}. Use Copy diagnostics on the first screen to report it.`); }
    }finally{ this.creating=false; this.setBusy(""); if(button&&this.rendered) button.disabled=false; }
  }
}

function canImport(){ return game.user?.isGM||game.user?.can?.("ACTOR_CREATE"); }
async function openImporter(){
  if(game.system.id!=="dnd5e") return ui.notifications.error("D&D Friends Character Importer requires the dnd5e system.");
  if(!canImport()) return ui.notifications.warn("You need permission to create actors to use the importer.");
  const app=new ImportWizard(); await app.render({force:true});
  // Index in the background while the user picks a file; the file handler waits for the same load.
  if(!resolver.loaded){ app.setBusy("Indexing compendiums and world items…"); const msg="Indexing compendiums and world items…"; resolver.load().catch(e=>console.error(e)).finally(()=>{ if(app.busy===msg&&!app.data){ app.setBusy(""); if(app.rendered) app.render(); } }); }
}

Hooks.once("init",()=>{
  game.settings.registerMenu(MODULE_ID,"importer",{name:"Open D&D Friends Character Importer",label:"Open Importer",hint:"Import a Discord character bot export into a 2024 D&D 5e actor.",icon:"fas fa-file-import",type:ImportWizard,restricted:true});
  game.settings.register(MODULE_ID,"itemMatches",{scope:"world",config:false,type:Object,default:{}});
  game.settings.registerMenu(MODULE_ID,"itemMemoryMenu",{name:"Remembered item matches",label:"Manage",hint:"Item matches people picked by hand. They are reused automatically for every later import.",icon:"fas fa-link",type:ItemMemoryApp,restricted:true});
  game.settings.register(MODULE_ID,"pyodideUrl",{name:"Python runtime URL (Roll20 export)",hint:"Where Export to Roll20 downloads the Python runtime (Pyodide 0.27.7) from. Leave as is unless your server cannot reach jsDelivr.",scope:"world",config:true,type:String,default:PYODIDE_DEFAULT});
  game.settings.register(MODULE_ID,"remoteUa",{name:"Load Unearthed Arcana feats from GitHub",hint:"When Plutonium's prerelease cache is incomplete, fetch 2024–2026 Unearthed Arcana feat data from TheGiddyLimit/unearthed-arcana on GitHub. Off by default; requires internet access.",scope:"world",config:true,type:Boolean,default:false});
});
Hooks.once("ready",()=>{
  try{ game.socket?.on(SOCKET,msg=>{ if(msg?.type==="itemMatches") itemMemory.merge(msg.rec).catch(e=>console.warn(e)); }); }catch(e){ console.warn(`${MODULE_ID} | socket unavailable`,e); }
  itemMemory.collectFromUsers().catch(e=>console.warn(`${MODULE_ID} | could not collect item matches`,e));
});
Hooks.once("ready",()=>{ const mod=game.modules.get(MODULE_ID); if(mod) mod.api={openImporter,parseBotExport,plutoniumBridge,copyDiagnostics,diagnosticsReport,openRoll20Export,itemMemory,openItemMemory:()=>new ItemMemoryApp().render({force:true}),diagnostics:async()=>{ if(!resolver.loaded) await resolver.load(); const api=game.modules.get("plutonium")?.api||{};return {plutonium:{active:plutoniumBridge.detect(),version:plutoniumBridge.version,apiKeys:Object.keys(api),importerKeys:Object.keys(api.importer||{})},resolverEntries:resolver.entries.length,rawPlutoniumFeats:plutoniumBridge.rawFeats.length,remoteUa:plutoniumBridge.remoteUa,plutoniumSources:resolver.plutoniumSources(),rawFeatSources:plutoniumBridge.rawFeatSources(),rawItems:plutoniumBridge.rawItems.length,rawItemLoader:plutoniumBridge.itemLoadInfo||"none",plutoniumItemConverter:plutoniumBridge.itemConverters().length>0,enabledPlutoniumSources:[...(resolver.enabledPlutoniumSources||[])],originChoicePreview:resolver.entries.filter(e=>resolver.allowed(e)).filter(isOriginStyleChoice).map(e=>({name:e.name,subtype:e.featSubtype,page:e.plutonium?.page||"",source:e.plutonium?.source||e.source?.book||"",uuid:e.uuid})).slice(0,100)};}}; });
Hooks.on("renderActorDirectory",(app,html)=>{
  if(!canImport()) return;
  const root=html instanceof HTMLElement?html:html?.[0]; if(!root||root.querySelector(".cbi-open"))return;
  const host=root.querySelector(".header-actions")||root.querySelector(".directory-header"); if(!host)return;
  const b=document.createElement("button");b.type="button";b.className="cbi-open";b.innerHTML='<i class="fas fa-file-import"></i> D&amp;D Friends Import';b.addEventListener("click",openImporter);host.appendChild(b);
});

// Export to Roll20: a button in the character sheet header and an entry in the Actors sidebar's right-click menu.
function roll20HeaderControl(app,controls){
  const actor=app.document||app.actor; if(!actor||actor.type!=="character"||controls.some?.(c=>c.action==="cbiRoll20")) return;
  controls.push({action:"cbiRoll20",icon:"fa-solid fa-dice-d20",label:"Export to Roll20",ownership:"OWNER",onClick:()=>openRoll20Export(actor)});
}
Hooks.on("getHeaderControlsActorSheetV2",roll20HeaderControl);
Hooks.on("getActorContextOptions",(app,options)=>{
  const idOf=li=>{ const el=li?.dataset?li:li?.[0]; return el?.dataset?.entryId||el?.dataset?.documentId||el?.closest?.("[data-entry-id]")?.dataset?.entryId; };
  const actorOf=li=>game.actors?.get(idOf(li));
  options.push({name:"Export to Roll20",label:"Export to Roll20",icon:'<i class="fa-solid fa-dice-d20"></i>',
    condition:li=>{ const a=actorOf(li); return !!a&&a.type==="character"&&a.isOwner; }, visible:li=>{ const a=actorOf(li); return !!a&&a.type==="character"&&a.isOwner; },
    callback:li=>openRoll20Export(actorOf(li)), onClick:(event,li)=>openRoll20Export(actorOf(li||event?.currentTarget))});
});

export { openImporter, parseBotExport, ImportWizard, openRoll20Export, copyDiagnostics };
