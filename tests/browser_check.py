"""Drive the lab in Chromium, Firefox and WebKit.

The checks that matter are the ones a reading pass cannot make: that a pasted
URL becomes a clean link, that state survives a reload, that the route's maths
agrees with the task state, and that the page asks nothing of any other origin.
"""
import sys, threading, http.server, socketserver, functools, json
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
stations = data["stations"]
ntasks = sum(len(s["tasks"]) for s in stations)

def check(name, cond, msg):
    if not cond: fails.append(f"{name}: {msg}")

with sync_playwright() as pw:
    for name in ("chromium", "firefox", "webkit"):
        b = getattr(pw, name).launch()
        pg = b.new_context().new_page()
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        off = []
        pg.on("request", lambda r: off.append(r.url) if not r.url.startswith(origin) else None)
        pg.goto(origin + "/", wait_until="load")
        pg.wait_for_selector(".station", timeout=10000)
        pg.evaluate("window.__rdl.clearState()")

        check(name, pg.eval_on_selector_all(".station", "n=>n.length") == len(stations), "station count")
        check(name, pg.eval_on_selector_all(".task", "n=>n.length") == ntasks, "task count")

        # --- the route diagram ------------------------------------------------
        check(name, pg.eval_on_selector_all(".route .node", "n=>n.length") == len(stations),
              "route has one node per station")
        labels = pg.eval_on_selector_all(".route .node .lab", "ns=>ns.map(n=>n.textContent)")
        check(name, labels == [s["short"] for s in stations], f"route labels in talk order, got {labels}")
        check(name, pg.eval_on_selector_all(".route .node .strip .seg", "n=>n.length") == ntasks,
              "one strip segment per task")

        # --- station-level progress maths ------------------------------------
        first = stations[0]["id"]
        p = pg.evaluate(f"window.__rdl.stationProgress('{first}')")
        check(name, p["total"] == len(stations[0]["tasks"]) and p["resolved"] == 0 and not p["complete"],
              f"fresh station progress wrong: {p}")
        pg.evaluate(f"window.__rdl.setState('{stations[0]['tasks'][0]['id']}','done')")
        pg.evaluate(f"window.__rdl.setState('{stations[0]['tasks'][1]['id']}','skipped')")
        p = pg.evaluate(f"window.__rdl.stationProgress('{first}')")
        check(name, p["done"] == 1 and p["skipped"] == 1 and p["resolved"] == 2,
              f"done and skipped both count as resolved: {p}")
        check(name, p["remaining"] == p["total"] - 2, f"remaining: {p}")
        check(name, not p["complete"], "a part-finished station is not complete")

        # --- first unresolved station ----------------------------------------
        check(name, pg.evaluate("window.__rdl.nextStationId()") == first,
              "next station is the first with work left")
        for t in stations[0]["tasks"]:
            pg.evaluate(f"window.__rdl.setState('{t['id']}','skipped')")
        p = pg.evaluate(f"window.__rdl.stationProgress('{first}')")
        check(name, p["complete"], "a fully skipped station counts as resolved")
        check(name, pg.evaluate("window.__rdl.nextStationId()") == stations[1]["id"],
              "next station moves on once the first is resolved")
        check(name, pg.eval_on_selector_all(".route .node.complete", "n=>n.length") >= 1,
              "a resolved station is marked complete in the route")
        check(name, pg.inner_text("#progress-next").startswith("Next: " + stations[1]["name"]),
              "the next line names the next station")

        # every station resolved -> the completion line
        for s in stations:
            for t in s["tasks"]:
                pg.evaluate(f"window.__rdl.setState('{t['id']}','done')")
        check(name, pg.evaluate("window.__rdl.nextStationId()") is None, "no next station when all resolved")
        check(name, "complete" in pg.inner_text("#progress-next").lower(), "completion line shown")
        summ = pg.evaluate("window.__rdl.summary()")
        check(name, "29 of 29 steps resolved" in summ, f"summary counts: {summ[:60]}")
        pg.evaluate("window.__rdl.clearState()")

        # --- details: pasted ids are cleaned, links personalize ---------------
        pre_needs = pg.eval_on_selector_all("a.needs", "n=>n.length")
        check(name, pre_needs > 0, "links needing details are marked before typing")
        check(name, pg.eval_on_selector_all(".needsnote", "n=>n.length") > 0,
              "the missing-field note is shown underneath, not in the label")
        lbls = pg.eval_on_selector_all("a.needs", "ns=>ns.map(n=>n.textContent)")
        check(name, not any("add your" in l.lower() for l in lbls),
              "a link label keeps its normal wording when a field is missing")

        pg.fill("#f-orcid", "https://orcid.org/0000-0002-1825-0097")
        pg.fill("#f-site", "https://example.github.io/"); pg.dispatch_event("#f-site", "input")
        pg.wait_for_timeout(250)
        h = pg.eval_on_selector_all(".links a[href]", "ns=>ns.map(n=>n.getAttribute('href'))")
        check(name, "https://orcid.org/0000-0002-1825-0097" in h, "pasted ORCID URL became a clean link")
        check(name, "https://example.github.io/robots.txt" in h, "site field built the robots.txt link")
        check(name, "https://example.github.io/sitemap.xml" in h, "site field built the sitemap link")
        check(name, not any("%2F" in x for x in h if "example.github.io" in x), "site URL not percent-encoded")

        # every external link opens in a new tab, safely
        rels = pg.eval_on_selector_all('.links a[target="_blank"]', "ns=>ns.map(n=>n.getAttribute('rel'))")
        check(name, rels and all(r and "noopener" in r and "noreferrer" in r for r in rels),
              "external links carry noopener noreferrer")

        # --- link hierarchy ---------------------------------------------------
        check(name, pg.eval_on_selector_all(".links.primary", "n=>n.length") > 0, "primary link group")
        check(name, pg.eval_on_selector_all(".links.reference", "n=>n.length") > 0, "reference link group")

        # --- details collapse -------------------------------------------------
        check(name, pg.is_visible("#details-toggle"), "the collapse toggle appears once a field is filled")
        pg.click("#details-toggle")
        pg.wait_for_timeout(120)
        check(name, not pg.is_visible("#fields"), "details collapse")
        check(name, pg.inner_text("#details-summary") != "", "the compact summary line shows")
        pg.click("#details-toggle"); pg.wait_for_timeout(120)
        check(name, pg.is_visible("#fields"), "details expand again")

        # --- skipping, and that it survives a reload --------------------------
        pg.click(".task .rowbtns button"); pg.wait_for_timeout(120)
        check(name, pg.eval_on_selector_all(".task.skipped", "n=>n.length") >= 1, "skip marks the task")
        check(name, pg.eval_on_selector_all(".badge.skipped", "n=>n.length") >= 1, "skipped shows a status badge")
        pg.reload(wait_until="load"); pg.wait_for_selector(".station")
        check(name, pg.eval_on_selector_all(".task.skipped", "n=>n.length") >= 1, "skip survives a reload")
        check(name, pg.input_value("#f-orcid") == "0000-0002-1825-0097", "details survive a reload")

        pg.click(".station .skipall button"); pg.wait_for_timeout(150)
        check(name, pg.eval_on_selector_all("#station-records .task.skipped", "n=>n.length")
              == len(stations[0]["tasks"]), "skip station skips every task")

        # --- route nodes are reachable by keyboard ---------------------------
        check(name, pg.eval_on_selector_all(".route .node[aria-label]", "n=>n.length") == len(stations),
              "every route node has an accessible label")
        tag = pg.eval_on_selector(".route .node", "n=>n.tagName")
        check(name, tag == "BUTTON", f"route nodes are focusable controls, got {tag}")

        check(name, not errs, f"page errors {errs[:2]}")
        check(name, not off, f"requested an outside origin {off[:2]}")
        print(f"  {name}: " + ("FAIL" if any(f.startswith(name) for f in fails) else "ok"))
        b.close()

srv.shutdown()
print()
if fails:
    print(f"{len(fails)} failures")
    for f in fails: print("  " + f)
    sys.exit(1)
print("lab check passed")
