import { EventEmitter } from "events";

/** Shared event bus for crawl-related updates (SSE push to frontend) */
export const crawlEvents = new EventEmitter();
crawlEvents.setMaxListeners(20); // one per SSE connection
