import json, urllib.request, urllib.parse
K="AIzaSyAfMIEi1MynF82Jp1j1J1BFQM5w8182JTo"
B="https://firestore.googleapis.com/v1/projects/aa-inventaire/databases/(default)/documents"
def lst(col):
    docs=[];tok=''
    while True:
        r=json.load(urllib.request.urlopen(f"{B}/{col}?pageSize=300&key={K}"+('&pageToken='+urllib.parse.quote(tok) if tok else '')))
        docs+=r.get('documents',[]); tok=r.get('nextPageToken')
        if not tok: return docs
def val(v):
    if v is None or 'nullValue' in v: return None
    for t in ('integerValue','doubleValue'):
        if t in v: return float(v[t])
    for t in ('stringValue','booleanValue','timestampValue'):
        if t in v: return v[t]
    if 'mapValue' in v: return {k:val(x) for k,x in v['mapValue'].get('fields',{}).items()}
    if 'arrayValue' in v: return [val(x) for x in v['arrayValue'].get('values',[])]
def N(x):
    try: return float(x or 0)
    except: return 0.0
num=lambda x: {'integerValue':str(int(x))} if float(x).is_integer() else {'doubleValue':x}
P={d['name'].split('/')[-1]:{k:val(v) for k,v in d.get('fields',{}).items()} for d in lst('products')}
def curCost(it):
    p=P.get(it.get('productId'))
    if not p: return None
    ci=it.get('colorIndex')
    if ci is not None:
        cols=p.get('colors') or []; ci=int(ci)
        if ci<len(cols) and cols[ci]:
            c=cols[ci]; return c.get('cost') if c.get('cost') not in (None,'') else p.get('cost')
    return p.get('cost')
nO=0; nI=0; add=0; skipped=0
for d in lst('orders'):
    f=d.get('fields',{}); items=f.get('items',{}).get('arrayValue',{}).get('values',[])
    ch=False; tot=0
    for it in items:
        m=it.get('mapValue',{}).setdefault('fields',{}); pl={k:val(v) for k,v in m.items()}
        c=N(pl.get('cost')); q=N(pl.get('qty')) or 1
        if c<=0:
            cc=curCost(pl)
            if cc is not None and N(cc)>0:
                c=N(cc); m['cost']=num(c); ch=True; nI+=q; add+=c*q
            else: skipped+=q
        tot+=c*q
    if not ch: continue
    total=N(val(f.get('total')))
    body={'fields':{'items':f['items'],'costTotal':num(tot),'profit':num(total-tot)}}
    req=urllib.request.Request(f"https://firestore.googleapis.com/v1/{d['name']}?updateMask.fieldPaths=items&updateMask.fieldPaths=costTotal&updateMask.fieldPaths=profit&key={K}",
        data=json.dumps(body).encode(), method='PATCH', headers={'Content-Type':'application/json'})
    urllib.request.urlopen(req).read(); nO+=1
print('commandes corrigees', nO, 'pieces', nI, 'cout ajoute', add, 'pieces sans cout restantes', skipped)
