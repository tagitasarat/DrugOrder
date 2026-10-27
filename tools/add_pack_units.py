# Usage: python tools/add_pack_units.py data.js ../../ค้างส่งสินค้าสาขา/prajan-app/public/catalog.json
# Run after every data.js refresh. catalog.json is built by ค้างส่งสินค้าสาขา/build_catalog.py from the same CW export.
# Adds pack-size data to DrugOrder's data.js from the CW catalog (prajan-app/public/catalog.json):
#   BC.bc  += barcodes CW knows that DrugOrder lacks (box/carton barcodes)
#   BC.bu   = {barcode: unit}       only for barcodes of a pack bigger than CAT[code].u
#   BC.us   = {code: {unit: n}}     n = how many CAT[code].u are in that pack
import json, re, sys
do_path, cat_path = sys.argv[1], sys.argv[2]
src = open(do_path, encoding='utf-8').read()
cat = json.load(open(cat_path, encoding='utf-8'))['p']
m = re.search(r'^const BC=(.*?);?[ \t]*$', src, re.M)
BC = json.loads(m.group(1))
CAT = json.loads(re.search(r'^const CAT=(.*?);?[ \t]*$', src, re.M).group(1))
bc, bu, us = BC['bc'], {}, {}
added = conflicts = 0
for code, (name, gen, units) in cat.items():
    for un, sz, bcs in units:
        for b in bcs:
            if b not in bc: bc[b] = code; added += 1
            elif bc[b] != code: conflicts += 1
    d = CAT.get(code)
    if not d: continue
    base = d['u'].strip()
    osz = next((float(x[1] or 1) for x in units if x[0].strip() == base), None)
    if not osz: continue
    for un, sz, bcs in units:
        f = float(sz or 1) / osz
        if f <= 1 or un.strip() == base: continue
        f = int(f) if f == int(f) else round(f, 3)
        us.setdefault(code, {})[un.strip()] = f
        for b in bcs:
            if bc.get(b) == code: bu[b] = un.strip()
BC['bu'] = bu; BC['us'] = us
line = 'const BC=' + json.dumps(BC, ensure_ascii=False, separators=(',', ':')) + ';'
out = src[:m.start()] + line + src[m.end():]
open(do_path, 'w', encoding='utf-8', newline='').write(out)
print('added', added, 'conflicts kept', conflicts, 'bu', len(bu), 'us', len(us), 'size', len(out.encode('utf-8')))
