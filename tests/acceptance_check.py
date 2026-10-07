import threading, http.server, socketserver, functools, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent; PORT=8713
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
class T(socketserver.ThreadingTCPServer): daemon_threads=True; allow_reuse_address=True
srv=T(("127.0.0.1",PORT),functools.partial(Q,directory=str(ROOT)))
threading.Thread(target=srv.serve_forever,daemon=True).start()
O=f"http://127.0.0.1:{PORT}"; fails=[]
with sync_playwright() as pw:
    b=pw.chromium.launch()
    # 1. state saved by the PREVIOUS version of the lab still loads
    ctx=b.new_context(); pg=ctx.new_page()
    pg.goto(O+"/",wait_until="load")
    pg.evaluate("""localStorage.setItem('rdl.state.v1', JSON.stringify({'orcid-public':'done','robots':'skipped'}));
                   localStorage.setItem('rdl.details.v1', JSON.stringify({orcid:'0000-0002-1825-0097',name:'Old User'}));""")
    pg.reload(wait_until="load"); pg.wait_for_selector(".station")
    if pg.input_value("#f-orcid")!="0000-0002-1825-0097": fails.append("old details did not load")
    if pg.input_value("#f-name")!="Old User": fails.append("old name did not load")
    p=pg.evaluate("window.__rdl.stationProgress('records')")
    if p["done"]!=1: fails.append(f"old done state not honoured: {p}")
    p=pg.evaluate("window.__rdl.stationProgress('crawl')")
    if p["skipped"]!=1: fails.append(f"old skipped state not honoured: {p}")
    print("  old localStorage state: ok" if not fails else "  old state: FAIL")

    # 2. snake order on desktop, vertical on mobile
    pg.set_viewport_size({"width":1280,"height":900}); pg.wait_for_timeout(200)
    rows=pg.eval_on_selector_all(".route .node","ns=>ns.map(n=>Math.round(n.getBoundingClientRect().top))")
    xs=pg.eval_on_selector_all(".route .node","ns=>ns.map(n=>Math.round(n.getBoundingClientRect().left))")
    top=sorted(set(rows))
    if len(top)!=2: fails.append(f"desktop route is not two rows: {len(top)}")
    else:
        r1=[x for x,y in zip(xs,rows) if y==top[0]]; r2=[x for x,y in zip(xs,rows) if y==top[1]]
        if r1!=sorted(r1): fails.append("row 1 does not run left to right")
        if r2!=sorted(r2,reverse=True): fails.append(f"row 2 does not snake back right to left: {r2}")
        print(f"  desktop snake: row1 {len(r1)} nodes L->R, row2 {len(r2)} nodes R->L: ok")
    pg.set_viewport_size({"width":380,"height":800}); pg.wait_for_timeout(250)
    xs=pg.eval_on_selector_all(".route .node","ns=>ns.map(n=>Math.round(n.getBoundingClientRect().left))")
    ys=pg.eval_on_selector_all(".route .node","ns=>ns.map(n=>Math.round(n.getBoundingClientRect().top))")
    if len(set(xs))!=1: fails.append(f"mobile route is not one column: {sorted(set(xs))}")
    if ys!=sorted(ys): fails.append("mobile route is not in numerical order")
    body_w=pg.evaluate("document.body.scrollWidth"); vw=pg.evaluate("window.innerWidth")
    if body_w>vw+1: fails.append(f"page scrolls sideways at 380px ({body_w} > {vw})")
    print("  mobile: one column, no sideways scroll: ok")

    # 3. clicking a node moves to its station
    pg.set_viewport_size({"width":1280,"height":900}); pg.wait_for_timeout(150)
    pg.eval_on_selector_all(".route .node","ns=>ns[3].click()"); pg.wait_for_timeout(2000)
    y=pg.eval_on_selector("#station-bots","n=>Math.round(n.getBoundingClientRect().top)")
    if abs(y)>160: fails.append(f"clicking a node did not scroll to its station (top {y})")
    print("  node click scrolls to the station: ok")
    b.close()
srv.shutdown()
print()
if fails:
    print(f"{len(fails)} failures"); [print("  "+f) for f in fails]; sys.exit(1)
print("acceptance checks passed")
