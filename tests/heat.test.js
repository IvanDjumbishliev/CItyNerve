import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import SunCalc from "suncalc";
import { HEAT_TOWNS, coverageOf, boundary } from "../src/heat/towns.js";
import { sunPosition, buildingShadows, inRing, inShade } from "../src/heat/shadows.js";

test("each town has usable building geometry and the correct local summer clock", () => {
  for (const town of HEAT_TOWNS) {
    const buildings = JSON.parse(
      fs.readFileSync("public/data/" + town.id + "-shade-buildings.geojson"),
    );
    assert.ok(buildings.features.length > 0, town.id);
    const bounds = coverageOf(buildings);
    assert.ok(inRing(town.center, boundary(bounds)), town.id + " center inside coverage");
    const offset = town.id === "sofia" ? 3 : 2;
    const expected = SunCalc.getPosition(
      new Date(Date.UTC(2026, 6, 15, 12 - offset)),
      town.center[1],
      town.center[0],
    );
    assert.equal(sunPosition("2026-07-15", 12, town).altitude, expected.altitude);
    assert.ok(
      buildings.features.every(
        (f) => Number.isFinite(f.properties.heightM) && f.properties.heightM > 0,
      ),
    );
  }
});

test("shadows extend away from the sun, lengthen with height, and disappear at night", () => {
  const town = HEAT_TOWNS[0];
  const make = (heightM) => ({
    features: [
      {
        properties: { heightM },
        geometry: {
          coordinates: [
            [
              [23.338, 42.692],
              [23.3381, 42.692],
              [23.3381, 42.6921],
              [23.338, 42.6921],
              [23.338, 42.692],
            ],
          ],
        },
      },
    ],
  });
  const short = buildingShadows(make(10), "2026-07-15", 13, town);
  const tall = buildingShadows(make(20), "2026-07-15", 13, town);
  const end = short.features[0].geometry.coordinates[0][0][0];
  const farther = tall.features[0].geometry.coordinates[0][0][0];
  assert.ok(end[1] > 42.692);
  assert.ok(farther[1] > end[1]);
  assert.ok(inShade([(end[0] + 23.33805) / 2, (end[1] + 42.69205) / 2], tall));
  assert.equal(buildingShadows(make(20), "2026-07-15", 0, town).features.length, 0);
});
