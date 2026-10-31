import urllib.request, re
UA={'User-Agent':'Mozilla/5.0'}
def g(u):
    return urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=30).read().decode('utf-8','ignore')
base='https://app.zrexpress.app'
h=g(base+'/'); print('index len',len(h))
js=set(re.findall(r'(?:src|href)="([^"]+\.js)"',h)); print('js', list(js)[:20])
seen=set(); queue=[ (j if j.startswith('http') else base+('' if j.startswith('/') else '/')+j) for j in js]
hits=0
while queue and len(seen)<120:
    u=queue.pop(0)
    if u in seen: continue
    seen.add(u)
    try: t=g(u)
    except Exception as e: print('ERR',u,e); continue
    for m in re.findall(r'["\'](/?[a-zA-Z0-9_./-]*\.js)["\']', t):
        if 'chunk' in m or m.startswith('/_next') or m.startswith('assets') or m.startswith('/assets'):
            queue.append(base+('' if m.startswith('/') else '/')+m)
    for m in re.finditer(r'(?i)return[-_ ]?meter|returnRate|risk(?:Level|Score)', t):
        s=t[max(0,m.start()-300):m.end()+300].replace('\n',' ')
        print('HIT', u.split('/')[-1], '::', s); hits+=1
        if hits>40: break
    for m in re.finditer(r'["\'`](/api/v1/[^"\'`]{0,80}|/v1/[^"\'`]{0,80})["\'`]', t):
        if re.search(r'(?i)return|risk|meter|customer', m.group(1)): print('URL', m.group(1))
print('files scanned', len(seen))
