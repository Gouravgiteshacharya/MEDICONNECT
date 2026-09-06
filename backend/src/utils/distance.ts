export const EARTH_RADIUS_KM = 6_371.0088;

const DEGREES_PER_RADIAN = 180 / Math.PI;
const RADIANS_PER_DEGREE = Math.PI / 180;

export type LongitudeRange = {
  min: number;
  max: number;
};

export type GeographicBoundingBox = {
  minLatitude: number;
  maxLatitude: number;
  longitudeRanges: LongitudeRange[] | null;
};

export function normalizeLongitude(longitude: number) {
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}

export function haversineDistanceKm(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number,
) {
  const latitudeDelta = (latitude2 - latitude1) * RADIANS_PER_DEGREE;
  const longitudeDelta =
    normalizeLongitude(longitude2 - longitude1) * RADIANS_PER_DEGREE;
  const latitude1Radians = latitude1 * RADIANS_PER_DEGREE;
  const latitude2Radians = latitude2 * RADIANS_PER_DEGREE;

  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitude1Radians) *
      Math.cos(latitude2Radians) *
      Math.sin(longitudeDelta / 2) ** 2;
  const centralAngle = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));

  return EARTH_RADIUS_KM * centralAngle;
}

export function roundDistanceKm(distanceKm: number) {
  return Math.round((distanceKm + Number.EPSILON) * 1_000) / 1_000;
}

export function calculateGeographicBoundingBox(
  latitude: number,
  longitude: number,
  radiusKm: number,
): GeographicBoundingBox {
  const angularRadius = radiusKm / EARTH_RADIUS_KM;
  const latitudeRadians = latitude * RADIANS_PER_DEGREE;
  const latitudeDelta = angularRadius * DEGREES_PER_RADIAN;
  const minLatitude = Math.max(-90, latitude - latitudeDelta);
  const maxLatitude = Math.min(90, latitude + latitudeDelta);

  if (minLatitude <= -90 || maxLatitude >= 90) {
    return { minLatitude, maxLatitude, longitudeRanges: null };
  }

  const longitudeRatio = Math.sin(angularRadius) / Math.cos(latitudeRadians);

  if (!Number.isFinite(longitudeRatio) || Math.abs(longitudeRatio) >= 1) {
    return { minLatitude, maxLatitude, longitudeRanges: null };
  }

  const longitudeDelta =
    Math.asin(Math.abs(longitudeRatio)) * DEGREES_PER_RADIAN;
  const normalizedLongitude = normalizeLongitude(longitude);
  const minLongitude = normalizedLongitude - longitudeDelta;
  const maxLongitude = normalizedLongitude + longitudeDelta;

  if (minLongitude < -180) {
    return {
      minLatitude,
      maxLatitude,
      longitudeRanges: [
        { min: minLongitude + 360, max: 180 },
        { min: -180, max: maxLongitude },
      ],
    };
  }

  if (maxLongitude > 180) {
    return {
      minLatitude,
      maxLatitude,
      longitudeRanges: [
        { min: minLongitude, max: 180 },
        { min: -180, max: maxLongitude - 360 },
      ],
    };
  }

  return {
    minLatitude,
    maxLatitude,
    longitudeRanges: [{ min: minLongitude, max: maxLongitude }],
  };
}
