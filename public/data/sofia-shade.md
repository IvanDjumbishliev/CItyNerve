# Sofia building shade

Footprints and height attributes copied from the existing floods branch Sofia district, derived from OpenStreetMap (ODbL). Each footprint records heightBasis. Many heights use levels × 3 m or an assumed 9 m.

src/heat/shadows.js uses SunCalc 1.9 solar altitude and south-based azimuth in radians. Footprints are translated by height / tan(altitude) away from the sun, with connecting walls projected onto a flat ground plane. The interface uses Sofia summer time UTC+3 and limits dates to June–August 2026. Exposure totals use the midpoint of each half-hour interval between 06:00 and 20:00. This measures direct-sun opportunity from buildings within this district. Trees, terrain, clouds, thermal storage and buildings beyond the extract are unmodeled.

Reference: https://github.com/mourner/suncalc/tree/v1.9.0
