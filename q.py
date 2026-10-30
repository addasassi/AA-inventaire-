import json,urllib.request,os
K="AIzaSyAfMIEi1MynF82Jp1j1J1BFQM5w8182JTo"
base="https://firestore.googleapis.com/v1/projects/aa-inventaire/databases/(default)/documents/products?pageSize=300&mask.fieldPaths=name&mask.fieldPaths=cat&mask.fieldPaths=cost&mask.fieldPaths=qty&mask.fieldPaths=colors&mask.fieldPaths=code&mask.fieldPaths=colorName&key="+K
def val(v):
    if v is None: return None
    if 'nullValue' in v: return None
    for t in ('integerValue','doubleValue','stringValue','booleanValue'):
        if t in v: return v[t]
    if 'mapValue' in v: return {k:val(x) for k,x in v['mapValue'].get('fields',{}).items()}
    if 'arrayValue' in v: return [val(x) for x in v['arrayValue'].get('values',[])]
docs=[];tok=''
while True:
    r=json.load(urllib.request.urlopen(base+('&pageToken='+tok if tok else '')))
    docs+=r.get('documents',[]); tok=r.get('nextPageToken')
    if not tok: break
def z(x):
    try: return x is None or x=='' or float(x)<=0
    except: return True
out=[]
for d in docs:
    f={k:val(v) for k,v in d.get('fields',{}).items()}
    pc=f.get('cost')
    cols=f.get('colors') or []
    if z(pc):
        # vitrine has no cost; colors w/o own cost inherit 0 too
        out.append(('V',f.get('cat'),f.get('name'),f.get('colorName') or '',f.get('qty'),pc))
    for i,c in enumerate(cols):
        c=c or {}
        cc=c.get('cost')
        eff = cc if cc not in (None,'') else pc
        if z(eff): out.append(('C',f.get('cat'),f.get('name'),c.get('name') or '#%d'%(i+1),c.get('qty'),cc))
print(len(docs),'produits')
for o in sorted(out,key=lambda x:(str(x[1]),str(x[2]))): print(o)
