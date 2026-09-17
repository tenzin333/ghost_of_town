// Validation events. Sent to Umami when NEXT_PUBLIC_UMAMI_WEBSITE_ID is set; always kept in a
// session log so a moderated test can be reviewed with ?debug=1.
type Props = Record<string, string | number | boolean>;

declare global {
  interface Window {
    umami?: { track: (name: string, data?: Props) => void };
  }
}

const KEY = "wwh-events";
const started = typeof performance !== "undefined" ? performance.now() : 0;

export function track(name: string, props: Props = {}) {
  const event = { name, t: Math.round((performance.now() - started) / 1000), ...props };
  try {
    const log = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    log.push(event);
    sessionStorage.setItem(KEY, JSON.stringify(log));
  } catch {}
  window.umami?.track(name, props);
  if (process.env.NODE_ENV !== "production") console.debug("[track]", event);
}

export function readLog(): Array<{ name: string; t: number } & Props> {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export const sessionSeconds = () => Math.round((performance.now() - started) / 1000);
