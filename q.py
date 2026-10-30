import json, urllib.request, urllib.parse, sys
K="AIzaSyAfMIEi1MynF82Jp1j1J1BFQM5w8182JTo"
B="https://firestore.googleapis.com/v1/projects/aa-inventaire/databases/(default)/documents"
def get(url):
    return json.load(urllib.request.urlopen(url))
def lst(col):
    docs=[];tok=''
    while True:
        r=get(f"{B}/{col}?pageSize=300&key={K}"+('&pageToken='+urllib.parse.quote(tok) if tok else ''))
        docs+=r.get('documents',[]); tok=r.get('nextPageToken')
        if not tok: return docs
def val(v):
    if v is None or 'nullValue' in v: return None
    for t in ('integerValue','doubleValue','stringValue','booleanValue','timestampValue'):
        if t in v:
            x=v[t]
            return float(x) if t in('integerValue','doubleValue') else x
    if 'mapValue' in v: return {k:val(x) for k,x in v['mapValue'].get('fields',{}).items()}
    if 'arrayValue' in v: return [val(x) for x in v['arrayValue'].get('values',[])]
def plain(d): return {k:val(v) for k,v in d.get('fields',{}).items()}
def z(x):
    try: return x is None or x=='' or float(x)<=0
    except: return True
WRITE = '--write' in sys.argv
# ---- 1) couleurs sans prix d'achat -> 600
prods=lst('products'); fixed=[]
for d in prods:
    f=d.get('fields',{}); cols=f.get('colors',{}).get('arrayValue',{}).get('values',[])
    pc=val(f.get('cost')); ch=False
    for i,c in enumerate(cols):
        m=c.get('mapValue',{}).setdefault('fields',{})
        cc=val(m.get('cost')); eff=cc if cc not in (None,'') else pc
        if z(eff):
            m['cost']={'integerValue':'600'}; ch=True
            fixed.append((val(f.get('name')), val(m.get('name')) or '#%d'%(i+1)))
    if not z(pc) and False: pass
    if ch and WRITE:
        req=urllib.request.Request(f"https://firestore.googleapis.com/v1/{d['name']}?updateMask.fieldPaths=colors&key={K}",
            data=json.dumps({'fields':{'colors':f['colors']}}).encode(), method='PATCH', headers={'Content-Type':'application/json'})
        urllib.request.urlopen(req).read()
print('COULEURS MISES A 600:', len(fixed), 'ecrit' if WRITE else '(simulation)')
for x in fixed: print('  ', x)
# coûts actuels (après correction)
P={}
for d in lst('products'):
    p=plain(d); P[d['name'].split('/')[-1]]=p
def curCost(it):
    p=P.get(it.get('productId'))
    if not p: return None
    ci=it.get('colorIndex')
    if ci is not None:
        cols=p.get('colors') or []; ci=int(ci)
        if ci<len(cols) and cols[ci]:
            c=cols[ci]; return c.get('cost') if c.get('cost') not in (None,'') else p.get('cost')
    return p.get('cost')
# ---- 2) bénéfice réel depuis le début (même formule que Stats)
TARIF = {1:[1400,980],2:[750,530],3:[950,680],4:[800,530],5:[800,530],6:[800,530],7:[950,680],8:[1050,730],9:[750,530],10:[800,530],11:[1600,1130],12:[850,530],13:[700,530],14:[750,530],15:[800,530],16:[650,480],17:[950,680],18:[800,530],19:[800,530],20:[750,580],21:[800,530],22:[700,530],23:[850,530],24:[850,530],25:[800,530],26:[750,530],27:[700,530],28:[900,580],29:[700,530],30:[950,730],31:[500,380],32:[1000,680],34:[800,530],35:[800,530],36:[850,530],38:[750,530],39:[950,730],40:[800,530],41:[800,530],42:[800,530],43:[800,530],44:[750,530],45:[1000,680],46:[650,530],47:[950,680],48:[750,530],49:[1050,980],51:[950,680],52:[1600,980],53:[1600,1130],54:[1600,0],55:[950,730],57:[950,0],58:[950,730]}
O=[plain(d) for d in lst('orders')]
O=[o for o in O if not o.get('swap')]
def N(x):
    try: return float(x or 0)
    except: return 0.0
cust=lambda o:o.get('customer') or {}
isHand=lambda o: cust(o).get('deliveryType')=='main'
def stage(o):
    if isHand(o): return 'planned' if (o.get('deferred') and o.get('deferredDate') and not o.get('handDone')) else 'delivered'
    return (o.get('zr') or {}).get('stage') or ''
def dfee(o):
    if isHand(o): return 0
    zz=o.get('zr') or {}
    if N(zz.get('deliveryPrice'))>0: return N(zz.get('deliveryPrice'))
    t=TARIF.get(int(N(cust(o).get('wilayaCode'))))
    return (t[1] or t[0]) if t and cust(o).get('deliveryType')=='stopdesk' else (t[0] if t else 0)
sp=plain(get(f"{B}/meta/sponsor?key={K}"))
try: ex=plain(get(f"{B}/meta/expenses?key={K}")).get('items') or {}
except Exception: ex={}
usdt=N(sp.get('usdt')) or 254; retDef=sp.get('retDefault'); retDef=200 if retDef in (None,'') else N(retDef); lastRate=N(sp.get('lastRate'))
learned={}
for o in O:
    rp=N((o.get('zr') or {}).get('returnPrice'))
    if rp>0:
        c=cust(o); learned[f"{c.get('wilayaCode')}|{c.get('deliveryType')}"]=rp; learned.setdefault(str(c.get('wilayaCode')),rp)
def rfee(o):
    rp=N((o.get('zr') or {}).get('returnPrice'))
    if rp>0: return rp
    c=cust(o); return learned.get(f"{c.get('wilayaCode')}|{c.get('deliveryType')}") or learned.get(str(c.get('wilayaCode'))) or retDef
def costApp(o):
    if o.get('costTotal') is not None: return N(o.get('costTotal'))
    if o.get('profit') is not None: return N(o.get('total'))-N(o.get('profit'))
    return 0
miss=0; fixedItems=0
def costReal(o):
    global miss, fixedItems
    t=0
    for it in o.get('items') or []:
        c=N(it.get('cost')); q=N(it.get('qty')) or 1
        if c<=0:
            cc=curCost(it)
            if cc is not None and N(cc)>0: c=N(cc); fixedItems+=q
            else: miss+=q
        t+=c*q
    return t
dl=[o for o in O if stage(o)=='delivered']; rt=[o for o in O if stage(o)=='returned']
pend=[o for o in O if stage(o) not in('delivered','returned')]
sales=sum(N(o.get('total')) for o in dl)
cA=sum(costApp(o) for o in dl); cR=sum(costReal(o) for o in dl)
deliv=sum(dfee(o) for o in dl); ret=sum(rfee(o) for o in rt)
spD=sum(round(N(e.get('eur'))*(N(e.get('rate')) or lastRate or 1.17)*usdt) for e in (sp.get('days') or {}).values() if e and N(e.get('eur'))>0)
spE=sum(N(e.get('eur')) for e in (sp.get('days') or {}).values() if e and N(e.get('eur'))>0)
exT=sum(N(e.get('amount')) for e in ex.values() if e and N(e.get('amount'))>0)
dates=sorted(o.get('createdAt') for o in O if o.get('createdAt'))
print('PERIODE', dates[0] if dates else '', '->', dates[-1] if dates else '')
print('commandes', len(O), 'livrees', len(dl), 'retours', len(rt), 'en cours', len(pend))
print('ventes', round(sales)); print('achat app', round(cA), 'achat reel', round(cR), 'pieces corrigees', fixedItems, 'pieces sans cout', miss)
print('livraison', round(deliv)); print('retours', round(ret)); print('sponsor', round(spD), 'eur', spE, 'jours', len([1 for e in (sp.get('days') or {}).values() if e and N(e.get('eur'))>0]))
print('depenses', round(exT))
print('BENEF APP', round(sales-cA-deliv-ret-spD-exT)); print('BENEF REEL', round(sales-cR-deliv-ret-spD-exT))
pc=sum(N(o.get('total'))-costReal(o)-dfee(o) for o in pend)
print('en cours potentiel', round(pc))
# par mois
from collections import defaultdict
M=defaultdict(lambda:[0,0,0,0,0])
for o in dl:
    m=(o.get('createdAt') or '')[:7]; M[m][0]+=N(o.get('total')); M[m][1]+=costReal(o); M[m][2]+=dfee(o); M[m][4]+=1
for o in rt: M[(o.get('createdAt') or '')[:7]][3]+=rfee(o)
for m in sorted(M): print('MOIS', m, [round(x) for x in M[m]])
SPM=defaultdict(float)
for d,e in (sp.get('days') or {}).items():
    if e and N(e.get('eur'))>0: SPM[d[:7]]+=round(N(e.get('eur'))*(N(e.get('rate')) or lastRate or 1.17)*usdt)
EXM=defaultdict(float)
for e in ex.values():
    if e and N(e.get('amount'))>0: EXM[str(e.get('date'))[:7]]+=N(e.get('amount'))
print('SPM', dict(SPM)); print('EXM', dict(EXM))
