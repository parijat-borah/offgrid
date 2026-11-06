import type { IdentityAdapters } from "./adapters/identity";
import type { SmsAdapter } from "./adapters/sms";
import type { WeatherAdapter } from "./adapters/weather";
import type { Content } from "./content";
import type { Db } from "./db";
import type { Config } from "./env";

/** Everything a route needs, passed explicitly so tests can build an app with an in-memory DB. */
export interface Ctx {
  db: Db;
  config: Config;
  content: Content;
  /** Defaults to the adapter named by WEATHER_MODE; tests inject a mock. */
  weather?: WeatherAdapter;
  /** Defaults to OTP_MODE / KYC_MODE / LIVENESS_MODE. */
  identity?: IdentityAdapters;
  /** Defaults to SMS_MODE; tests inject a fresh mock to read what was sent. */
  sms?: SmsAdapter;
}
