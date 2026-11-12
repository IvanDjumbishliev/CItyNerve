import { PARKING_CITIES } from '../../shared/parkingCities.js';
import { distanceKm } from './engine.js';

export function parkingCityFor(city) {
  return Object.entries(PARKING_CITIES).find(([, p]) => distanceKm(city, { longitude: p.center[0], latitude: p.center[1] }) < 3)?.[0] ?? null;
}

export function operatorParkingRows(city, snapshot) {
  if (!snapshot || snapshot.stale || !Array.isArray(snapshot.facilities)) return [];
  return snapshot.facilities.map(p => ({
    id: p.id, name: p.name, cityId: city.id, latitude: p.lat, longitude: p.lon,
    live: true, simulated: false, free: p.free, capacity: p.capacity, status: p.status,
    fetchedAt: snapshot.fetchedAt, measuredAt: p.measuredAt, source: snapshot.attribution,
  }));
}
