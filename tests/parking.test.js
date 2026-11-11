import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRows, normalizeZurich, validFacilities } from "../server/parkingProviders.js";
test("provider adapters preserve zero availability and explicit closure", () => {
  const ghent = normalizeRows("ghent", {
    results: [
      {
        id: "p",
        name: "Parking",
        location: { lon: 3.7, lat: 51 },
        availablecapacity: 0,
        totalcapacity: 100,
        isopennow: 0,
        temporaryclosed: 1,
        lastupdate: "2026-11-11T12:00:00Z",
      },
    ],
  });
  assert.equal(validFacilities(ghent).length, 1);
  assert.equal(ghent[0].free, 0);
  assert.equal(ghent[0].status, "closed");
  const sg = normalizeRows("stgallen", {
    results: [
      {
        ph_id: "1",
        ph_name: "Rathaus",
        koordinaten: { lon: 9.3, lat: 47.4 },
        frei: 8,
        anzahl_parkplatze: 10,
        ph_status: "offen",
        letzte_aktualisierung: "2026-11-11T12:00:00Z",
      },
    ],
  });
  assert.equal(sg[0].capacity, 10);
  assert.equal(sg[0].status, "open");
  assert.equal(validFacilities([{ ...sg[0], free: 11 }]).length, 0);
  assert.equal(validFacilities([{ ...sg[0], lon: undefined }]).length, 0);
});
test("Zurich joins normalized names and uses official per-garage timestamps", () => {
  const xml =
    "<rss><channel><item><title>Parkhaus Opéra / Street</title><description>open / 0</description><dc:date>2026-11-11T12:00:00Z</dc:date></item><item><title>Unknown</title><description>???? / ???</description></item></channel></rss>";
  const rows = normalizeZurich(xml, {
    lots: [{ id: "opera", name: "Opéra", total: 100, coords: { lng: 8.5, lat: 47.3 } }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].free, 0);
  assert.equal(rows[0].measuredAt, "2026-11-11T12:00:00Z");
  assert.equal(rows[0].lon, 8.5);
});
