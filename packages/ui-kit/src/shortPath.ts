// Paths and commands short enough for one line in Settings: the home folder becomes ~,
// and a long path keeps its first folder and last two, with … between. The full text
// stays in the element's title (hover).

/** One path, shortened: "/Users/ana/Documents/Github/duckdb-analytics-agent" →
 *  "~/…/Github/duckdb-analytics-agent". */
export function shortPath(path: string, keep = 2): string {
  const home = path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
  const parts = home.split("/");
  // A leading "" (absolute) or "~", then folders; keep the head and the last `keep`.
  const head = parts[0] === "" ? "" : parts[0];
  const rest = parts.slice(1);
  if (rest.length <= keep) return home;
  const short = [head, "…", ...rest.slice(-keep)].join("/");
  // Only when it saves real space: hiding one short folder isn't worth the "…".
  return home.length - short.length >= 4 ? short : home;
}

/** A command line with each path in it shortened ("uv run --project ~/…/Github/agent …"). */
export function shortCommand(command: string, keep = 2): string {
  return command
    .split(" ")
    .map((word) => (word.includes("/") ? shortPath(word, keep) : word))
    .join(" ");
}
