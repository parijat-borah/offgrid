import { parseRegionPack, type AuthResponse, type HazardReportDto, type PlaceWeather } from "@offgrid/core";
import { randomBytes, randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockWeatherAdapter, OpenMeteoAdapter } from "../src/adapters/weather";
import { createApp } from "../src/app";
import { loadContent } from "../src/content";
import { openDb, type Db } from "../src/db";
import { loadConfig } from "../src/env";

const content = loadContent();
const config = loadConfig({ NODE_ENV: "test", JWT_ACCESS_SECRET: randomBytes(48).toString("base64"), PII_ENCRYPTION_KEY: randomBytes(32).toString("base64") });

let db: Db;
let weather: MockWeatherAdapter;
let app: ReturnType<typeof createApp>;
let n = 0;

beforeEach(async () => {
  db = await openDb(":memory:");
  weather = new MockWeatherAdapter();
  app = createApp({ db, config, content, weather });
});

async function user() {
  const res = await request(app)
    .post("/api/v1/auth/signup")
    .send({ email: `s${++n}@example.com`, password: "correct horse battery", displayName: `S ${n}`, birthYear: 2000, acceptTerms: true, confirmAdult: true })
    .expect(201);
  return { Authorization: `Bearer ${(res.body as AuthResponse).accessToken}` };
}

const REPORT = { kind: "landslide", severity: 3, description: "Fresh slide blocking the road after the bridge", lat: 32.0, lon: 77.3 };

describe("weather", () => {
  it("returns 7 days at the base and the high point, colder up high", async () => {
    const res = await request(app).get("/api/v1/weather/place/hampta-pass").expect(200);
    const w = res.body as PlaceWeather;
    expect(w.source).toBe("mock");
    expect(w.base.days).toHaveLength(7);
    expect(w.high.elevationM).toBe(4270);
    expect(w.high.days[0]!.tMaxC).toBeLessThan(w.base.days[0]!.tMaxC);
  });

  it("caches per place for an hour and collapses simultaneous requests", async () => {
    await Promise.all([request(app).get("/api/v1/weather/place/triund"), request(app).get("/api/v1/weather/place/triund")]);
    await request(app).get("/api/v1/weather/place/triund").expect(200);
    expect(weather.calls).toBe(2); // one call per elevation, once
  });

  it("404s for unknown places and 502s when the provider is down", async () => {
    await request(app).get("/api/v1/weather/place/atlantis").expect(404);
    const broken = createApp({ db, config, content, weather: { name: "broken", forecast: () => Promise.reject(new Error("down")) } });
    const res = await request(broken).get("/api/v1/weather/place/triund").expect(502);
    expect(res.body.error.code).toBe("WEATHER_UNAVAILABLE");
  });

  it("parses a real Open-Meteo response shape", async () => {
    const body = {
      daily: {
        time: ["2026-10-23", "2026-10-24"],
        weather_code: [53, 85],
        temperature_2m_max: [10.8, null],
        temperature_2m_min: [1.9, 0.7],
        precipitation_sum: [1.5, 5.3],
        snowfall_sum: [0, 1.26],
        precipitation_probability_max: [29, null],
        wind_gusts_10m_max: [32, 40],
        uv_index_max: [5.9, 5.85],
      },
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    const days = await new OpenMeteoAdapter("https://example.test", fetchImpl as unknown as typeof fetch).forecast({ lat: 32.2, lon: 76.3, elevationM: 2850, days: 7 });
    expect(days).toEqual([{ date: "2026-10-23", code: 53, tMaxC: 10.8, tMinC: 1.9, precipMm: 1.5, snowCm: 0, precipProb: 29, gustKmh: 32, uvMax: 5.9 }]);
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toContain("elevation=2850");
  });
});

describe("hazard reports", () => {
  it("publishes a report immediately, with an expiry by kind, and ships it in the pack", async () => {
    const a = await user();
    const id = randomUUID();
    const res = await request(app).put(`/api/v1/hazards/${id}`).set(a).send(REPORT).expect(201);
    const h = res.body as HazardReportDto;
    expect(h.source).toBe("community");
    const ttlH = (Date.parse(h.expires_at!) - Date.parse(h.reported_at!)) / 3_600_000;
    expect(Math.round(ttlH)).toBe(72);
    // Retrying the same id is harmless.
    await request(app).put(`/api/v1/hazards/${id}`).set(a).send(REPORT).expect(200);

    const list = await request(app).get("/api/v1/hazards?lat=32&lon=77.3&radius_km=5").expect(200);
    expect((list.body as HazardReportDto[]).map((x) => x.id)).toEqual([`report-${id}`]);

    const pack = parseRegionPack((await request(app).get("/api/v1/regions/himachal/pack").expect(200)).body);
    expect(pack.hazards.some((x) => x.id === `report-${id}`)).toBe(true);
    expect(pack.hazards.filter((x) => x.source === "curated").length).toBeGreaterThanOrEqual(10);
    expect(pack.hospitals.length).toBeGreaterThanOrEqual(15);
  });

  it("validates reports", async () => {
    const a = await user();
    await request(app).put(`/api/v1/hazards/${randomUUID()}`).set(a).send({ ...REPORT, description: "bad" }).expect(400);
    await request(app).put(`/api/v1/hazards/${randomUUID()}`).set(a).send({ ...REPORT, kind: "zombies" }).expect(400);
    await request(app).put(`/api/v1/hazards/${randomUUID()}`).set(a).send({ ...REPORT, lat: 19, lon: 72.8 }).expect(400);
    await request(app).put(`/api/v1/hazards/${randomUUID()}`).send(REPORT).expect(401);
  });

  it("extends on confirmation, but never past the cap", async () => {
    const owner = await user();
    const id = randomUUID();
    const created = (await request(app).put(`/api/v1/hazards/${id}`).set(owner).send(REPORT)).body as HazardReportDto;
    await request(app).post(`/api/v1/hazards/${id}/confirm`).set(owner).expect(409);
    const c = (await request(app).post(`/api/v1/hazards/${id}/confirm`).set(await user()).expect(200)).body as HazardReportDto;
    expect(c.confirmations).toBe(1);
    expect(Date.parse(c.expires_at!) - Date.parse(created.expires_at!)).toBeCloseTo(24 * 3_600_000, -4);
    let last = c;
    for (let i = 0; i < 6; i++) last = (await request(app).post(`/api/v1/hazards/${id}/confirm`).set(await user())).body as HazardReportDto;
    expect((Date.parse(last.expires_at!) - Date.parse(created.reported_at!)) / 3_600_000).toBeLessThanOrEqual(168.01);
  });

  it("clears after two travellers say it's gone, or at once when the reporter does", async () => {
    const owner = await user();
    const id = randomUUID();
    await request(app).put(`/api/v1/hazards/${id}`).set(owner).send(REPORT);
    await request(app).post(`/api/v1/hazards/${id}/clear`).set(await user()).expect(200);
    expect(((await request(app).get("/api/v1/hazards?lat=32&lon=77.3")).body as unknown[]).length).toBe(1);
    await request(app).post(`/api/v1/hazards/${id}/clear`).set(await user()).expect(200);
    expect(((await request(app).get("/api/v1/hazards?lat=32&lon=77.3")).body as unknown[]).length).toBe(0);

    const id2 = randomUUID();
    await request(app).put(`/api/v1/hazards/${id2}`).set(owner).send(REPORT);
    await request(app).post(`/api/v1/hazards/${id2}/clear`).set(owner).expect(200);
    expect(((await request(app).get("/api/v1/hazards?lat=32&lon=77.3")).body as unknown[]).length).toBe(0);
  });

  it("hides expired reports", async () => {
    const owner = await user();
    const id = randomUUID();
    await request(app).put(`/api/v1/hazards/${id}`).set(owner).send(REPORT);
    await db.updateTable("hazard_reports").set({ expires_at: new Date(Date.now() - 1000).toISOString() }).execute();
    expect(((await request(app).get("/api/v1/hazards?lat=32&lon=77.3")).body as unknown[]).length).toBe(0);
    await request(app).post(`/api/v1/hazards/${id}/confirm`).set(await user()).expect(409);
  });
});
