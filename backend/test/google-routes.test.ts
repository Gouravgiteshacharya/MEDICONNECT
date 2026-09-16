import { afterEach, describe, expect, it, vi } from "vitest";
import { HaversineDistanceProvider } from "../src/delivery-quotes/distance-provider.js";
import {
  GoogleRoutesClient,
  GoogleRoutesProviderError,
  type GoogleRoutesFetch,
} from "../src/delivery-routing/google-routes-client.js";
import { loadGoogleRoutesConfig } from "../src/delivery-routing/google-routes.config.js";
import {
  FallbackDistanceProvider,
  GoogleRoutesDistanceProvider,
  GoogleRoutesProvider,
} from "../src/delivery-routing/google-routes-providers.js";
import { createRoutingProviders } from "../src/delivery-routing/routing-provider.factory.js";
import { optimizeStops, type OptimizerStop } from "../src/delivery-routing/route-optimizer.js";

const origin = { latitude: 28.6139, longitude: 77.209 };
const destination = { latitude: 28.5355, longitude: 77.391 };
const apiKey = "test-google-key-that-must-not-leak";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function client(body: unknown) {
  const fetchImplementation = vi.fn(async () => response(body));
  return {
    client: new GoogleRoutesClient(apiKey, 1_000, fetchImplementation as unknown as GoogleRoutesFetch),
    fetchImplementation,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Google Routes client", () => {
  it("requests only road distance and traffic-aware duration", async () => {
    const value = client({ routes: [{ distanceMeters: 12_345, duration: "965.1s" }] });
    await expect(value.client.estimate(origin, destination)).resolves.toEqual({
      distanceKm: 12.345,
      durationMinutes: 17,
    });
    const [url, init] = value.fetchImplementation.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://routes.googleapis.com/directions/v2:computeRoutes");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      origin: { location: { latLng: origin } },
      destination: { location: { latLng: destination } },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
    });
  });

  it.each([
    ["empty routes", { routes: [] }],
    ["missing routes", {}],
    ["malformed distance", { routes: [{ distanceMeters: -1, duration: "60s" }] }],
    ["malformed duration", { routes: [{ distanceMeters: 1_000, duration: "one minute" }] }],
  ])("rejects %s without exposing Google data", async (_name, body) => {
    const value = client(body);
    const error = await value.client.estimate(origin, destination).catch((caught) => caught);
    expect(error).toBeInstanceOf(GoogleRoutesProviderError);
    expect(error).toMatchObject({ reason: "INVALID_RESPONSE" });
    expect(error.message).toBe("Google Routes request failed");
    expect(error.message).not.toContain(apiKey);
    expect(error.message).not.toContain(JSON.stringify(body));
  });

  it("sanitizes non-2xx responses without reading their body", async () => {
    const fetchImplementation = vi.fn(async () => response({ error: { message: apiKey } }, 429)) as unknown as GoogleRoutesFetch;
    const error = await new GoogleRoutesClient(apiKey, 1_000, fetchImplementation)
      .estimate(origin, destination)
      .catch((caught) => caught);
    expect(error).toMatchObject({ reason: "HTTP_ERROR", message: "Google Routes request failed" });
    expect(error.message).not.toContain(apiKey);
  });

  it("sanitizes network failures", async () => {
    const fetchImplementation = vi.fn(async () => { throw new Error(`connect ${apiKey}`); }) as unknown as GoogleRoutesFetch;
    await expect(new GoogleRoutesClient(apiKey, 1_000, fetchImplementation).estimate(origin, destination))
      .rejects.toMatchObject({ reason: "NETWORK_ERROR", message: "Google Routes request failed" });
  });

  it("aborts requests at the configured timeout", async () => {
    vi.useFakeTimers();
    const fetchImplementation = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })) as unknown as GoogleRoutesFetch;
    const pending = new GoogleRoutesClient(apiKey, 25, fetchImplementation).estimate(origin, destination);
    const assertion = expect(pending).rejects.toMatchObject({ reason: "TIMEOUT", message: "Google Routes request failed" });
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });

  it("keeps invalid coordinates as application-data errors", async () => {
    const fetchImplementation = vi.fn(async () => response({ routes: [] })) as unknown as GoogleRoutesFetch;
    await expect(new GoogleRoutesClient(apiKey, 1_000, fetchImplementation).estimate(
      { latitude: 91, longitude: 0 },
      destination,
    )).rejects.toBeInstanceOf(RangeError);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

describe("Google routing composition", () => {
  it("adapts one client to both existing provider contracts", async () => {
    const value = client({ routes: [{ distanceMeters: 2_500, duration: "120.1s" }] });
    await expect(new GoogleRoutesDistanceProvider(value.client).calculate(origin, destination))
      .resolves.toEqual({ distanceKm: 2.5, durationMinutes: 3 });
    await expect(new GoogleRoutesProvider(value.client).estimateLeg(origin, destination))
      .resolves.toEqual({ distanceKm: 2.5, durationMinutes: 3 });
  });

  it("falls back to deterministic Haversine distance on provider failure", async () => {
    const primary = { calculate: vi.fn(async () => { throw new Error("unavailable"); }) };
    const provider = new FallbackDistanceProvider(primary, new HaversineDistanceProvider());
    const estimate = await provider.calculate(origin, destination);
    expect(estimate.distanceKm).toBeGreaterThan(0);
    expect(estimate.durationMinutes).toBeUndefined();
    expect(primary.calculate).toHaveBeenCalledOnce();
  });

  it("does not hide invalid coordinates behind fallback", async () => {
    const primary = { calculate: vi.fn(async () => ({ distanceKm: 1 })) };
    const provider = new FallbackDistanceProvider(primary, new HaversineDistanceProvider());
    await expect(provider.calculate({ latitude: Number.NaN, longitude: 0 }, destination))
      .rejects.toBeInstanceOf(RangeError);
    expect(primary.calculate).not.toHaveBeenCalled();
  });

  it("uses Haversine locally when Google is disabled or lacks a key", async () => {
    const fetchImplementation = vi.fn(async () => response({ routes: [] })) as unknown as GoogleRoutesFetch;
    for (const config of [
      { enabled: false, apiKey, timeoutMs: 1_000 },
      { enabled: true, apiKey: null, timeoutMs: 1_000 },
    ]) {
      const providers = createRoutingProviders({ config, assumedSpeedKmh: 20, fetchImplementation });
      expect(providers.mode).toBe("HAVERSINE_ONLY");
      await expect(providers.distanceProvider.calculate(origin, destination)).resolves.toMatchObject({
        distanceKm: expect.any(Number),
      });
    }
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("falls back from Google for route legs with assumed-speed duration", async () => {
    const fetchImplementation = vi.fn(async () => response({ error: "rate limited" }, 429)) as unknown as GoogleRoutesFetch;
    const providers = createRoutingProviders({
      config: { enabled: true, apiKey, timeoutMs: 1_000 },
      assumedSpeedKmh: 20,
      fetchImplementation,
    });
    const estimate = await providers.routeProvider.estimateLeg(origin, destination);
    expect(providers.mode).toBe("GOOGLE_ROUTES_WITH_HAVERSINE_FALLBACK");
    expect(estimate.distanceKm).toBeGreaterThan(0);
    expect(estimate.durationMinutes).toBeCloseTo(estimate.distanceKm / 20 * 60);
  });

  it("feeds Google leg estimates into local pickup-before-drop-off optimization", async () => {
    const value = client({ routes: [{ distanceMeters: 1_000, duration: "60s" }] });
    const provider = new GoogleRoutesProvider(value.client);
    const now = new Date("2026-09-14T12:00:00Z");
    const stops: OptimizerStop[] = [
      { id: "pickup", assignmentId: "assignment", stopType: "PHARMACY_PICKUP", status: "PENDING", latitude: 28.62, longitude: 77.22, deadlineAt: null },
      { id: "dropoff", assignmentId: "assignment", stopType: "CUSTOMER_DROPOFF", status: "PENDING", latitude: 28.63, longitude: 77.23, deadlineAt: new Date(now.getTime() + 10 * 60_000) },
    ];
    const optimized = await optimizeStops({ start: origin, stops, completedPickups: new Set(), now, maxLateMinutes: 0, provider });
    expect(optimized.stops.map((stop) => stop.id)).toEqual(["pickup", "dropoff"]);
    expect(optimized.totalDistanceKm).toBe(2);
    expect(optimized.totalDurationMinutes).toBe(2);
    expect(value.fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("validates configuration and defaults to disabled", () => {
    expect(loadGoogleRoutesConfig({})).toEqual({ enabled: false, apiKey: null, timeoutMs: 5_000 });
    expect(loadGoogleRoutesConfig({ GOOGLE_ROUTES_ENABLED: "true", GOOGLE_MAPS_API_KEY: ` ${apiKey} ` })).toEqual({ enabled: true, apiKey, timeoutMs: 5_000 });
    expect(() => loadGoogleRoutesConfig({ GOOGLE_ROUTES_ENABLED: "yes" })).toThrow(/true or false/);
    expect(() => loadGoogleRoutesConfig({ GOOGLE_ROUTES_TIMEOUT_MS: "0" })).toThrow(/1 through 60000/);
    expect(() => loadGoogleRoutesConfig({ GOOGLE_ROUTES_TIMEOUT_MS: "60001" })).toThrow(/1 through 60000/);
  });
});
