# Sofia building shade

Footprints and height attributes copied from the existing floods branch Sofia district, derived from OpenStreetMap (ODbL). Each footprint records heightBasis. Many heights use levels × 3 m or an assumed 9 m.

src/heat/shadows.js uses SunCalc 1.9 solar altitude and south-based azimuth in radians. Footprints are translated by height / tan(altitude) away from the sun, with connecting walls projected onto a flat ground plane. The interface uses Sofia summer time UTC+3 and limits dates to June–August 2026. Exposure totals use the midpoint of each half-hour interval between 06:00 and 20:00. This measures direct-sun opportunity from buildings within this district. Trees, terrain, clouds, thermal storage and buildings beyond the extract are unmodeled.

Reference: https://github.com/mourner/suncalc/tree/v1.9.0

## Multiple towns and neighborhood loading

Heat now shares a town registry in src/heat/towns.js. Sofia, Bratislava, Michalovce, Košice, Prešov, Nitra, Žilina and Banská Bystrica start with the existing OSM building extracts from the floods branch. These files retain their original attribution and heightBasis. Their boundary is the extent of available footprints, not the administrative city boundary.

The map's Load buildings here button requests a roughly 2 km neighborhood from the public OSM map API. The query is bounded to ±0.012 degrees longitude and ±0.008 degrees latitude. Closed building ways are converted into footprints. Relation-only buildings and courtyard holes are omitted. Heights use OSM height, levels × 3 m, or 9 m if absent. Failed requests retain the previous loaded geometry. Switching town aborts pending requests. Other Sofia neighborhoods can be loaded by panning and requesting their buildings.

Solar angles use the loaded area's coordinates and the selected town's IANA time zone. The date control is limited to summer 2026. Direct-sun estimates sample half-hour interval midpoints. Shadow accuracy is reduced near the edge by missing neighboring buildings. Satellite heat records remain available only for Sofia.
