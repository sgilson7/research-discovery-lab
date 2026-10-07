import sys, threading, http.server, socketserver, functools, json, re
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PORT = 8711

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

class T(socketserver.ThreadingTCPServer):
    daemon_threads = True; allow_reuse_address = True

srv = T(("127.0.0.1", PORT), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
origin = f"http://127.0.0.1:{PORT}"
fails = []
data = json.loads((ROOT / "data/stations.json").read_text())
ntasks = sum(len(s["tasks"]) for s in data["stations"])

with sync_playwright() as pw:
    for name in ("chromium", "firefox", "webkit"):
        b = getattr(pw, name).launch()
        pg = b.new_context().new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        off = []
        pg.on("request", lambda r: off.append(r.url) if not r.url.startswith(origin) else None)
        pg.goto(origin + "/", wait_until="load")
        pg.wait_for_selector(".station", timeout=10000)

        got = pg.eval_on_selector_all(".station", "n=>n.length")
        if got != len(data["stations"]): fails.append(f"{name}: {got} stations, want {len(data['stations'])}")
        got = pg.eval_on_selector_all(".task", "n=>n.length")
        if got != ntasks: fails.append(f"{name}: {got} tasks, want {ntasks}")

        # links that need a field are marked, not broken
        pre = pg.eval_on_selector_all("a.needs", "n=>n.length")
        if pre == 0: fails.append(f"{name}: no link marked as needing details before typing")

        # typing an ORCID as a full URL should still build the right link
        pg.fill("#f-orcid", "https://orcid.org/0000-0002-1825-0097")
        pg.fill("#f-name", "Jane Q. Researcher")
        pg.fill("#f-site", "https://example.github.io/")
        pg.dispatch_event("#f-site", "input")
        pg.wait_for_timeout(250)
        hrefs = pg.eval_on_selector_all(".links a[href]", "ns=>ns.map(n=>n.getAttribute('href'))")
        if not any(h == "https://orcid.org/0000-0002-1825-0097" for h in hrefs):
            fails.append(f"{name}: ORCID pasted as a URL did not become a clean link")
        if not any(h == "https://example.github.io/robots.txt" for h in hrefs):
            fails.append(f"{name}: site field did not build the robots.txt link")
        if any("example.github.io/" in h and "%2F" in h for h in hrefs):
            fails.append(f"{name}: site URL was percent-encoded into nonsense")

        # skipping works and survives a reload
        pg.click(".task .rowbtns button")
        pg.wait_for_timeout(120)
        if pg.eval_on_selector_all(".task.skipped", "n=>n.length") < 1:
            fails.append(f"{name}: skip did not mark the task")
        pg.reload(wait_until="load")
        pg.wait_for_selector(".station")
        if pg.eval_on_selector_all(".task.skipped", "n=>n.length") < 1:
            fails.append(f"{name}: skip did not survive a reload")
        if pg.input_value("#f-orcid") != "0000-0002-1825-0097":
            fails.append(f"{name}: details did not survive a reload")

        # skip a whole station
        pg.click(".station .skipall button")
        pg.wait_for_timeout(150)
        if pg.eval_on_selector_all("#station-records .task.skipped", "n=>n.length") != len(data["stations"][0]["tasks"]):
            fails.append(f"{name}: skip-whole-station did not skip every task")

        if errs: fails.append(f"{name}: page errors {errs[:2]}")
        if off: fails.append(f"{name}: requested an outside origin {off[:2]}")
        print(f"  {name}: ok" if not any(f.startswith(name) for f in fails) else f"  {name}: FAIL")
        b.close()
srv.shutdown()
print()
if fails:
    print(f"{len(fails)} failures"); [print("  "+f) for f in fails]; sys.exit(1)
print("lab check passed")
