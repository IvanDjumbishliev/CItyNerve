import { DEFAULT_CITY, distanceKm, pointAhead } from './engine.js';

// Illustrative road-approach placements, not surveyed municipal sign assets.
// Heading is the driver's onward travel direction (0=N, 90=E).
const approaches = [
  { id: 'east', road: 'Tsarigradsko shose', area: 'East / Trakia approach', latitude: 42.637, longitude: 23.410, heading: 315 },
  { id: 'northeast', road: 'Botevgradsko shose', area: 'Northeast / Hemus approach', latitude: 42.709, longitude: 23.431, heading: 270 },
  { id: 'west', road: 'Slivnitsa / Evropa', area: 'West / Kalotina approach', latitude: 42.739, longitude: 23.241, heading: 125 },
  { id: 'southwest', road: 'Tsar Boris III', area: 'Southwest / Knyazhevo approach', latitude: 42.656, longitude: 23.2333, heading: 55 },
];
const innerBoards = [
  { id: 'eagles', name: 'Eagles’ Bridge', road: 'Evlogi and Hristo Georgiev', latitude: 42.690317, longitude: 23.337487, heading: 52, direction: 'Northeast toward Oborishte' },
  { id: 'lions', name: 'Lions’ Bridge', road: 'Slivnitsa', latitude: 42.704835, longitude: 23.322966, heading: 99, direction: 'East toward Stochna gara' },
  { id: 'ndk', name: 'NDK / Bulgaria junction', road: 'Pencho Slaveykov', latitude: 42.682725, longitude: 23.318822, heading: 245, direction: 'Southwest toward Bulgaria Blvd.' },
  { id: 'bulgaria', name: 'Bulgaria Boulevard', road: 'Bulgaria', latitude: 42.673191, longitude: 23.295519, heading: 28, direction: 'Northeast toward the centre' },
];

export function demoBoards(city) {
  const sofia = distanceKm(city, DEFAULT_CITY) < 3;
  const rows = sofia ? [
    ...approaches.flatMap(a => ['entrance', 'exit'].map(kind => {
      const inbound = kind === 'entrance';
      // Separate opposite approaches along the corridor for map readability.
      const position = pointAhead(a, inbound ? -.22 : .22);
      return { ...a, ...position, id: `${a.id}-${kind}`, kind, heading: inbound ? a.heading : (a.heading + 180) % 360,
        name: `${a.area} · ${inbound ? 'inbound' : 'outbound'}`,
        direction: inbound ? 'Entering Sofia / toward the centre' : 'Leaving Sofia / away from the centre' };
    })),
    ...innerBoards.map(b => ({ ...b, kind: 'urban' })),
  ] : [0, 90, 180, 270].map((heading, i) => ({
    ...pointAhead({ ...city, heading }, 2), heading: (heading + 180) % 360, id: `approach-${i}`, kind: 'entrance',
    name: `${['North', 'East', 'South', 'West'][i]} illustrative approach`, road: 'Unsurveyed demo location', direction: `Toward ${city.label}`,
  }));
  return rows.map((b, i) => ({ ...b, id: `board:${city.id}:${b.id}`, cityId: city.id, number: i + 1, rangeKm: b.kind === 'urban' ? 2 : 4, halfAngle: 40, parkingRangeKm: 1.5,
    routineMessage: `${b.kind === 'entrance' ? `WELCOME TO ${city.label.toUpperCase()}` : b.kind === 'exit' ? `LEAVING ${city.label.toUpperCase()}` : b.road.toUpperCase()}\nNO ACTIVE LOCAL ADVISORY` }));
}

export function boardDemoLocation(board) {
  return { ...pointAhead(board), name: `${board.road} · 700 m ahead of board ${board.number}`, road: board.road, radiusKm: board.rangeKm, boardId: board.id };
}
