import urllib.request, re, json, urllib.parse
UA={'User-Agent':'Mozilla/5.0'}
t=urllib.request.urlopen(urllib.request.Request('https://app.zrexpress.app/assets/index-CaC-NZSj.js',headers=UA),timeout=60).read().decode('utf-8','ignore')
seen=set()
for pat in [r'\.returnMeter\b', r'returnMeter\s*:\s*[a-zA-Z_$]', r'meter\s*:\s*[a-zA-Z_$][\w$.?]*', r'["`/][\w/-]*return-?meter[\w/-]*', r'["`/][\w/-]*ReturnMeter[\w/-]*']:
    for m in re.finditer(pat, t):
        s=t[max(0,m.start()-250):m.end()+250]
        k=s[200:300]
        if k in seen: continue
        seen.add(k); print('CTX', pat, '::', s.replace('\n',' ')); print()
# API probe via worker
K="AIzaSyAfMIEi1MynF82Jp1j1J1BFQM5w8182JTo"
B="https://firestore.googleapis.com/v1/projects/aa-inventaire/databases/(default)/documents"
r=json.load(urllib.request.urlopen(f"{B}/orders?pageSize=50&mask.fieldPaths=zr&key={K}"))
oid=None
for d in r.get('documents',[]):
    z=d.get('fields',{}).get('zr',{}).get('mapValue',{}).get('fields',{})
    if 'parcelId' in z: oid=d['name'].split('/')[-1]; break
probes=['POST /parcels/search','/parcels/{id}?includeReturnMeter=true','/parcels/{id}/details','/parcels/by-tracking-number/{tn}','/parcels/tracking/{tn}']
req=urllib.request.Request("https://atelier-zr.mohammedsassiadda.workers.dev/raw", data=json.dumps({'id':oid,'probe':probes}).encode(), headers={'Content-Type':'application/json','User-Agent':'Mozilla/5.0'})
out=json.load(urllib.request.urlopen(req))
for k in probes:
    v=out.get(k) or ''
    i=v.lower().find('meter')
    print('PROBE',k,'len',len(v),'meter@',i, '::', v[max(0,i-300):i+500] if i>=0 else v[:400])
