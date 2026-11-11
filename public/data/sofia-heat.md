# Sofia summer surface temperatures

NASA Terra MOD11A2 daytime land surface temperature, downloaded from the ORNL DAAC REST subset service. The 12 eight-day composites start June 1 through August 28, 2024. The last composite extends into September. Each value represents a clear-sky satellite estimate of surface temperature.

To reproduce the subset, request MOD11A2/subset at https://modis.ornl.gov/rst/api/v1 with latitude 42.69, longitude 23.32, kmAboveBelow 10, kmLeftRight 12 and bands LST_Day_1km and QC_Day separately. Request ranges A2024153–A2024185, A2024193–A2024225 and A2024233–A2024241. Match composites by date. Exclude fill values, require mandatory QA bits 0–1 equal to zero and estimated LST error bits 6–7 at most one. Convert Kelvin using raw × 0.02 − 273.15 and round to tenths before aggregation.

Cell records contain the north-first row-major pixel index, mean, highest composite temperature, valid composite count, and count at or above 35 °C. Require at least six valid composites. Coordinates refer to the MODIS sinusoidal grid (radius 6371007.181 m).
