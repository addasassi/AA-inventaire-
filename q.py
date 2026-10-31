import urllib.request, re
UA={'User-Agent':'Mozilla/5.0'}
t=urllib.request.urlopen(urllib.request.Request('https://app.zrexpress.app/assets/index-CaC-NZSj.js',headers=UA),timeout=60).read().decode('utf-8','ignore')
for name in ('nhe','ahe'):
    for m in re.finditer(r'\b'+name+r'\s*,\s*\{', t):
        print('USE',name,'::', t[max(0,m.start()-400):m.end()+150].replace('\n',' ')); print()
for m in re.finditer(r'["`]([^"`]{0,60}(?:[Mm]eter|[Rr]isk)[^"`]{0,60})["`]', t):
    s=m.group(1)
    if '/' in s or '${' in s: print('STR', s)
for m in re.finditer(r'(?i)return_?meter|returnmeter', t):
    pass
print('count meter keys', len(re.findall(r'returnMeter', t)), len(re.findall(r'ReturnMeter', t)))
for m in re.finditer(r'[\w$]+\??\.(?:returnMeter|ReturnMeter|returnRisk|customerRisk|meter)\b', t):
    print('ACC', t[max(0,m.start()-200):m.end()+100].replace('\n',' '))
