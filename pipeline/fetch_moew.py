"""Official Studena reservoir volumes from the МОСВ (Ministry of Environment and
Water) monthly bulletins „Информационен бюлетин за състоянието на водите“.

Each bulletin has a line like:
  ЯЗОВИР “СТУДЕНА” – 71,29% наличен полезен обем (16,253 млн. м3)
Total volume = useful volume + dead volume (2.4 Mm³). Used to calibrate the
Sentinel-2 area → volume relation.
"""
import io, json, re, time
from datetime import date
import requests
from pypdf import PdfReader
from config import RAW, START_DATE, END_DATE, USER_AGENT

BASE = "https://www.moew.government.bg/static/media/ups/tiny/Monthly%20Bulletiin/{}_Bulletin.pdf"
KNOWN = ["10122021", "06062022", "12102022", "10122022", "10012023", "10022023", "10052023", "10062023", "05012024", "09052024"]
DEAD = 2.4
CACHE = RAW / "moew"; CACHE.mkdir(exist_ok=True)
S = requests.Session(); S.headers["User-Agent"] = USER_AGENT


def get(stamp):
    f = CACHE / f"{stamp}.pdf"
    if f.exists():
        return f.read_bytes() if f.stat().st_size > 1000 else None
    try:
        r = S.get(BASE.format(stamp), timeout=60)
        ok = r.status_code == 200 and r.content[:4] == b"%PDF"
    except requests.RequestException:
        return None
    f.write_bytes(r.content if ok else b"")
    time.sleep(0.4)
    return r.content if ok else None


def parse(pdf, stamp):
    text = "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(pdf)).pages)
    m = re.search(r"СТУДЕНА[^\n]{0,8}[–-]\s*([\d,]+)\s*%\s*наличен полезен обем\s*\(([\d,]+)\s*млн", text)
    if not m:
        return None
    pct = float(m.group(1).replace(",", ".")); useful = float(m.group(2).replace(",", "."))
    ref = re.search(r"към\s+(\d{1,2})\.(\d{1,2})\.(\d{4})", text)
    ref_date = date(int(ref.group(3)), int(ref.group(2)), int(ref.group(1))).isoformat() if ref else None
    return {"bulletin": stamp, "ref_date": ref_date, "useful_pct": pct, "useful_mm3": useful, "total_mm3": round(useful + DEAD, 3)}


def main():
    found = {}
    for st in KNOWN:
        pdf = get(st)
        if pdf and (row := parse(pdf, st)):
            found[st[2:]] = row
    # other months: bulletins are published in the first ~2 weeks
    y, mth = START_DATE.year, START_DATE.month
    while date(y, mth, 1) <= END_DATE:
        key = f"{mth:02d}{y}"
        if key not in found:
            for day in range(1, 16):
                pdf = get(f"{day:02d}{key}")
                if pdf:
                    row = parse(pdf, f"{day:02d}{key}")
                    if row: found[key] = row
                    break
        mth += 1
        if mth == 13: y, mth = y + 1, 1
    rows = sorted(found.values(), key=lambda r: r["ref_date"] or r["bulletin"])
    rows.append({"bulletin": "BTA 29.11.2025", "ref_date": "2025-11-29", "useful_pct": None, "useful_mm3": None, "total_mm3": 23.71})
    (RAW / "studena_official.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    for r in rows:
        print(r["ref_date"], r["total_mm3"], "Mm³", r["bulletin"])


if __name__ == "__main__":
    main()
