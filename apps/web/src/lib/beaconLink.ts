// Talking to a physical OFFGRID beacon from the browser.
//   * USB (Web Serial): one-time pairing, writes the key. Chrome/Edge on a laptop.
//   * Bluetooth (Web Bluetooth): the phone receives the beacon's packets and relays them when it has
//     signal, and can tell the beacon to start or cancel an SOS. Chrome on Android.
// Neither API exists in Safari or Firefox, so every caller checks support first and explains the fallback.

import { toHex } from "@offgrid/core";

// UUIDs must match firmware/offgrid_beacon/config.h.
const SERVICE = "6f0f0001-8d3c-4a1e-9b5a-0ff9b1d00001";
const PACKETS = "6f0f0002-8d3c-4a1e-9b5a-0ff9b1d00001";
const COMMAND = "6f0f0003-8d3c-4a1e-9b5a-0ff9b1d00001";

// Minimal typings: these APIs aren't in TypeScript's DOM lib yet.
interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}
interface GattCharacteristic extends EventTarget {
  value?: DataView;
  startNotifications(): Promise<GattCharacteristic>;
  writeValue(v: BufferSource): Promise<void>;
}
interface GattServer {
  connected: boolean;
  connect(): Promise<GattServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<GattCharacteristic> }>;
}
interface BluetoothDeviceLike extends EventTarget {
  name?: string;
  gatt?: GattServer;
}
type Nav = Navigator & {
  serial?: { requestPort(): Promise<SerialPortLike> };
  bluetooth?: { requestDevice(o: { filters: { services: string[] }[] }): Promise<BluetoothDeviceLike> };
};
const nav = () => navigator as Nav;

export const serialSupported = () => typeof navigator !== "undefined" && !!nav().serial;
export const bluetoothSupported = () => typeof navigator !== "undefined" && !!nav().bluetooth;

/**
 * Sends the PAIR line over USB and waits for the beacon's reply. Resolves with the beacon's own words
 * ("OK paired" or the error line) so the UI can show them.
 */
export async function pairOverUsb(command: string, timeoutMs = 6000): Promise<{ ok: boolean; reply: string }> {
  const port = await nav().serial!.requestPort();
  await port.open({ baudRate: 115200 });
  const writer = port.writable!.getWriter();
  const reader = port.readable!.getReader();
  try {
    await writer.write(new TextEncoder().encode(`${command}\n`));
    const decoder = new TextDecoder();
    let text = "";
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const chunk = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), deadline - Date.now()))]);
      if (!chunk || chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
      const line = text.split(/\r?\n/).find((l) => l.startsWith("OK paired") || l.startsWith("ERR"));
      if (line) return { ok: line.startsWith("OK"), reply: line.trim() };
    }
    return { ok: false, reply: "No reply from the beacon. Is it plugged in and running the OFFGRID firmware?" };
  } finally {
    reader.releaseLock();
    writer.releaseLock();
    await port.close().catch(() => undefined);
  }
}

export interface BeaconConnection {
  name: string;
  send(command: "SOS" | "CANCEL" | "PING"): Promise<void>;
  disconnect(): void;
}

/** Connects to a nearby beacon and calls `onPacket` with each 34-byte packet it passes to the phone. */
export async function connectBluetooth(onPacket: (hex: string) => void, onDisconnect: () => void): Promise<BeaconConnection> {
  const device = await nav().bluetooth!.requestDevice({ filters: [{ services: [SERVICE] }] });
  const server = await device.gatt!.connect();
  const svc = await server.getPrimaryService(SERVICE);
  const packets = await svc.getCharacteristic(PACKETS);
  const command = await svc.getCharacteristic(COMMAND);
  packets.addEventListener("characteristicvaluechanged", () => {
    const v = packets.value;
    if (v && v.byteLength === 34) onPacket(toHex(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)));
  });
  device.addEventListener("gattserverdisconnected", onDisconnect);
  await packets.startNotifications();
  return {
    name: device.name ?? "OFFGRID beacon",
    send: (c) => command.writeValue(new TextEncoder().encode(c)),
    disconnect: () => server.disconnect(),
  };
}

// One Bluetooth link for the whole app, so the SOS screen can use a beacon connected from the beacon screen.
let current: BeaconConnection | null = null;
const subs = new Set<() => void>();
export const beaconConnection = () => current;
export function setBeaconConnection(c: BeaconConnection | null) {
  current = c;
  subs.forEach((f) => f());
}
export function subscribeBeacon(f: () => void) {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}
