import { EventEmitter } from "events";

/** Shared global event bus — survives Next.js chunk splitting */
const g = globalThis as unknown as Record<string, unknown>;
g.__ee = g.__ee || new EventEmitter();
const ee = g.__ee as EventEmitter;
ee.setMaxListeners(20);

export const crawlEvents = ee;
