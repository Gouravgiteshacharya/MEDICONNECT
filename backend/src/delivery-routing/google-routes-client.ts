import {
  validateCoordinates,
  type Coordinates,
} from "../location/coordinates.js";

export type GoogleRoutesFetch = typeof fetch;

export interface GoogleRouteEstimate {
  distanceKm: number;
  durationMinutes: number;
}

export type GoogleRoutesFailureReason =
  | "HTTP_ERROR"
  | "INVALID_RESPONSE"
  | "NETWORK_ERROR"
  | "TIMEOUT";

export class GoogleRoutesProviderError extends Error {
  constructor(public readonly reason: GoogleRoutesFailureReason) {
    super("Google Routes request failed");
    this.name = "GoogleRoutesProviderError";
  }
}

const GOOGLE_ROUTES_URL =
  "https://routes.googleapis.com/directions/v2:computeRoutes";
const GOOGLE_ROUTES_FIELD_MASK = "routes.distanceMeters,routes.duration";
const DURATION_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,9})?s$/;

function parseDurationMinutes(value: unknown): number {
  if (typeof value !== "string" || !DURATION_PATTERN.test(value)) {
    throw new GoogleRoutesProviderError("INVALID_RESPONSE");
  }
  const seconds = Number(value.slice(0, -1));
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new GoogleRoutesProviderError("INVALID_RESPONSE");
  }
  return Math.ceil(seconds / 60);
}

function parseEstimate(value: unknown): GoogleRouteEstimate {
  if (typeof value !== "object" || value === null) {
    throw new GoogleRoutesProviderError("INVALID_RESPONSE");
  }
  const routes = (value as { routes?: unknown }).routes;
  if (!Array.isArray(routes) || routes.length === 0) {
    throw new GoogleRoutesProviderError("INVALID_RESPONSE");
  }
  const route = routes[0];
  if (typeof route !== "object" || route === null) {
    throw new GoogleRoutesProviderError("INVALID_RESPONSE");
  }
  const { distanceMeters, duration } = route as {
    distanceMeters?: unknown;
    duration?: unknown;
  };
  if (
    !Number.isInteger(distanceMeters) ||
    (distanceMeters as number) < 0
  ) {
    throw new GoogleRoutesProviderError("INVALID_RESPONSE");
  }
  const distanceKm = (distanceMeters as number) / 1_000;
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new GoogleRoutesProviderError("INVALID_RESPONSE");
  }
  return { distanceKm, durationMinutes: parseDurationMinutes(duration) };
}

export class GoogleRoutesClient {
  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number,
    private readonly fetchImplementation: GoogleRoutesFetch = fetch,
  ) {}

  async estimate(
    origin: Coordinates,
    destination: Coordinates,
  ): Promise<GoogleRouteEstimate> {
    // Application-data errors must remain distinguishable from provider failures.
    validateCoordinates(origin);
    validateCoordinates(destination);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetchImplementation(GOOGLE_ROUTES_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": this.apiKey,
            "X-Goog-FieldMask": GOOGLE_ROUTES_FIELD_MASK,
          },
          body: JSON.stringify({
            origin: {
              location: {
                latLng: {
                  latitude: origin.latitude,
                  longitude: origin.longitude,
                },
              },
            },
            destination: {
              location: {
                latLng: {
                  latitude: destination.latitude,
                  longitude: destination.longitude,
                },
              },
            },
            travelMode: "DRIVE",
            routingPreference: "TRAFFIC_AWARE",
          }),
          signal: controller.signal,
        });
      } catch (error) {
        throw new GoogleRoutesProviderError(
          controller.signal.aborted ? "TIMEOUT" : "NETWORK_ERROR",
        );
      }

      if (!response.ok) {
        throw new GoogleRoutesProviderError("HTTP_ERROR");
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new GoogleRoutesProviderError("INVALID_RESPONSE");
      }
      return parseEstimate(body);
    } finally {
      clearTimeout(timeout);
    }
  }
}
