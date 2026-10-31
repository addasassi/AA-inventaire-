import urllib.request, re
UA={'User-Agent':'Mozilla/5.0'}
g=lambda u: urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=60).read().decode('utf-8','ignore')
t=g('https://app.zrexpress.app/assets/index-CaC-NZSj.js')
names=sorted(set(re.findall(r'([\w.-]+-[\w-]{8}\.js)', t)))
print('chunks', len(names))
for n in names:
    try: c=g('https://app.zrexpress.app/assets/'+n)
    except Exception as e: continue
    if 'eturnMeter' not in c and 'eturnmeter' not in c.lower(): continue
    print('== CHUNK', n, len(c))
    for m in re.finditer(r'[\w$]+\??\.\w*[Rr]eturn[Mm]eter\w*|[Rr]eturn[Mm]eter\w*\s*:', c):
        print('  ACC', c[max(0,m.start()-250):m.end()+150].replace('\n',' '))
    for m in re.finditer(r'["`](/[^"`]{0,100})["`]', c):
        if re.search(r'(?i)meter|risk|customer|parcel', m.group(1)): print('  URL', m.group(1))
