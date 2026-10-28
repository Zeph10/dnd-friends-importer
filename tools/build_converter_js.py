   # Regenerates scripts/roll20-converter.js from the converter's converter.py.
   import json,re,sys
   src=open(sys.argv[1],encoding="utf-8").read(); out=sys.argv[2]
   ver=re.search(r'^VERSION\s*=\s*"([^"]+)"',src,re.M).group(1)
   open(out,"w",encoding="utf-8").write(f"// Generated from the Foundry → Roll20 Converter's converter.py (version {ver}). Do not edit by hand.\n// To update: python3 tools/build_converter_js.py path/to/converter.py scripts/roll20-converter.js\nexport const CONVERTER_VERSION = {json.dumps(ver)};\nexport const CONVERTER_PY = {json.dumps(src,ensure_ascii=False)};\n")
   print("wrote",out,ver)
