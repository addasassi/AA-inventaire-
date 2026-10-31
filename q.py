import json, urllib.request, urllib.parse
K="AIzaSyAfMIEi1MynF82Jp1j1J1BFQM5w8182JTo"
B="https://firestore.googleapis.com/v1/projects/aa-inventaire/databases/(default)/documents"
W="https://atelier-zr.mohammedsassiadda.workers.dev"
def lst(col):
    docs=[];tok=''
    while True:
        r=json.load(urllib.request.urlopen(f"{B}/{col}?pageSize=300&mask.fieldPaths=zr&mask.fieldPaths=createdAt&mask.fieldPaths=id&key={K}"+('&pageToken='+urllib.parse.quote(tok) if tok else '')))
        docs+=r.get('documents',[]); tok=r.get('nextPageToken')
        if not tok: return docs
def val(v):
    if v is None or 'nullValue' in v: return None
    for t in ('integerValue','doubleValue','stringValue','booleanValue','timestampValue'):
        if t in v: return v[t]
    if 'mapValue' in v: return {k:val(x) for k,x in v['mapValue'].get('fields',{}).items()}
    if 'arrayValue' in v: return [val(x) for x in v['arrayValue'].get('values',[])]
O=[]
for d in lst('orders'):
    f={k:val(v) for k,v in d.get('fields',{}).items()}
    z=f.get('zr') or {}
    if z.get('parcelId'): O.append((f.get('createdAt') or '', d['name'].split('/')[-1], z))
O.sort(reverse=True)
oid=O[0][1]; print('order', oid, O[0][2].get('tracking'))
def raw(probes):
    req=urllib.request.Request(W+'/raw', data=json.dumps({'id':oid,'probe':probes}).encode(), headers={'Content-Type':'application/json','User-Agent':'Mozilla/5.0'})
    return json.load(urllib.request.urlopen(req))
r=raw([])
p=r.get('parcel') or {}
print('PARCEL KEYS', list(p.keys()))
def find(o, path=''):
    if isinstance(o, dict):
        for k,v in o.items():
            kl=k.lower()
            if any(s in kl for s in ('return','risk','meter','score','customer','stat','count','order')): print('  FIELD', path+'.'+k, '=', json.dumps(v)[:300])
            find(v, path+'.'+k)
    elif isinstance(o, list):
        for i,v in enumerate(o[:3]): find(v, path+f'[{i}]')
find(p)
cust=p.get('customer') or {}
cid=cust.get('id') or cust.get('customerId') or p.get('customerId') or ''
phone=((cust.get('phone') or {}).get('number1') if isinstance(cust.get('phone'),dict) else cust.get('phone')) or ''
print('cid', cid, 'phone', phone)
probes=[f'/customers/{cid}', f'/customers/{cid}/statistics', f'/customers/{cid}/stats', f'/customers/{cid}/return-meter', f'/customers/{cid}/returnmeter', f'/customers/{cid}/risk',
 f'/customers/individual/{cid}', '/parcels/{id}/return-meter', '/parcels/{id}/returnmeter', '/parcels/{id}/customer-stats',
 f'/return-meter/{phone}', f'/returnmeter/{phone}', f'/customers/return-meter/{phone}', f'/customers/by-phone/{phone}', f'/customers/phone/{phone}',
 'POST /customers/search', 'POST /customers/individual/search', f'/return-meter?phone={phone}', f'/customers/risk?phone={phone}', f'/customers/{cid}/parcels']
r=raw(probes)
for k in probes: print('PROBE', k, '->', (r.get(k) or '')[:1500])
