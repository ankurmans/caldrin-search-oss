/**
 * Fetch a user-supplied URL. On Workers the `global_fetch_strictly_public`
 * compatibility flag already refuses private and reserved addresses, so this
 * is plain `fetch`. Callers follow redirects themselves, re-validating each
 * hop and sending it back through here.
 */
export function publicFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(input, init);
}
