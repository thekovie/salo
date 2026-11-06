import "server-only";
import { singleton } from "@/server/singleton";

/** Rendered images kept per process. Enough for every live order's name; the oldest is dropped first. */
const MAX_IMAGES = 200;

const store = singleton("image-cache", () => new Map<string, ArrayBuffer>());

/**
 * Drawing a PNG costs real CPU; a link preview, a crawler or a loop asks for the same picture again and again. Each
 * picture is drawn once per process (per key), then served from memory. Keys must not carry anything private: they are
 * built from what the picture shows.
 */
export async function cachedImage(key: string, render: () => Promise<Response> | Response, cacheControl: string): Promise<Response> {
  let bytes = store.get(key);
  if (bytes) {
    store.delete(key); // move to the back: recently used stays
  } else {
    bytes = await (await render()).arrayBuffer();
    if (store.size >= MAX_IMAGES) store.delete(store.keys().next().value as string);
  }
  store.set(key, bytes);
  return new Response(bytes, { headers: { "Content-Type": "image/png", "Cache-Control": cacheControl } });
}
