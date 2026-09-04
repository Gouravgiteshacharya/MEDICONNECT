export interface Coordinates { latitude: number; longitude: number; }

export function validateCoordinates({ latitude, longitude }: Coordinates): void {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new RangeError("latitude must be a finite number from -90 through 90");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new RangeError("longitude must be a finite number from -180 through 180");
  }
}

const EARTH_RADIUS_KM = 6371.0088;
const radians = (degrees: number) => degrees * Math.PI / 180;

export function haversineDistanceKm(from: Coordinates, to: Coordinates): number {
  validateCoordinates(from);
  validateCoordinates(to);
  if (from.latitude === to.latitude && from.longitude === to.longitude) return 0;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const fromLatitude = radians(from.latitude);
  const toLatitude = radians(to.latitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
