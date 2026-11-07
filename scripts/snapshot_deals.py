"""Save the Adrenaline Ofertas RSS feed to data/ for the Deals page (run by .github/workflows/snapshot-feeds.yml).

Route 1: the feed itself. Route 2 (the forum often challenges cloud servers): rss2json.com, rebuilt as minimal RSS
with the same fields the page uses (title, link, description, pubDate, creator). Exit code 0 even when both fail,
so the previous snapshot simply stays in place.
"""
import datetime
import json
import pathlib
import sys
import urllib.parse
import urllib.request

FEED = "https://forum.adrenaline.com.br/forums/ofertas.221/index.rss"
UA = "Mozilla/5.0 (compatible; CalendraFeedSnapshot/1.0; +https://lcarlini.github.io/Calendra/)"
OUT = pathlib.Path("data/deals-adrenaline-ofertas.xml")
STAMP = pathlib.Path("data/deals-adrenaline-ofertas.updated")


def get(url, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/rss+xml, application/json, */*"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read().decode("utf-8", "replace")


def cdata(text):
    return "<![CDATA[" + str(text or "").replace("]]>", "]]]]><![CDATA[>") + "]]>"


def direct():
    xml = get(FEED)
    if "<rss" not in xml or "<item>" not in xml:
        raise ValueError("no RSS items (bot challenge?)")
    return xml, "direct"


def via_rss2json():
    data = json.loads(get("https://api.rss2json.com/v1/api.json?rss_url=" + urllib.parse.quote(FEED, safe="")))
    if data.get("status") != "ok" or not data.get("items"):
        raise ValueError(data.get("message") or "no items")
    items = []
    for i in data["items"]:
        when = ""
        try:
            d = datetime.datetime.strptime(i.get("pubDate", ""), "%Y-%m-%d %H:%M:%S").replace(tzinfo=datetime.timezone.utc)
            when = "<pubDate>" + d.strftime("%a, %d %b %Y %H:%M:%S GMT") + "</pubDate>"
        except ValueError:
            pass
        items.append(
            "<item><title>" + cdata(i.get("title")) + "</title><link>" + cdata(i.get("link")) + "</link><description>"
            + cdata(i.get("description") or i.get("content")) + "</description>" + when
            + ("<dc:creator>" + cdata(i.get("author")) + "</dc:creator>" if i.get("author") else "") + "</item>"
        )
    xml = '<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>' + "".join(items) + "</channel></rss>\n"
    return xml, "rss2json"


def main():
    for route in (direct, via_rss2json):
        try:
            xml, how = route()
        except Exception as error:  # noqa: BLE001 - report and try the next route
            print(f"::warning::{route.__name__} failed: {error}")
            continue
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(xml, encoding="utf-8")
        STAMP.write_text(datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") + "\n", encoding="utf-8")
        print(f"Saved {xml.count('<item>')} items via {how}.")
        return 0
    print("::warning::Every route failed; keeping the previous snapshot.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
