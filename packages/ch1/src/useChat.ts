// CH-1's model: the rack preset's conversations, the open one, and the question running
// now. The host (the rack) owns what a question runs with: the DH-1 preset's settings and
// EFFORT, the labels that tie runs to the rack preset, and the data choices. The panel
// (Ch1) and the card (Ch1Card) both draw this.

import { IDLE, runReducer, type AgentConfig, type ConversationSummary, type Run, type RunRequest, type RunView, type Source } from "@dh/dh1";
import { useCallback, useEffect, useRef, useState } from "react";
import { canUse, DEFAULT_MAX_TURNS, turnFromResult, turnFromTrace, type DataChoice, type Turn } from "./chat";
import type { ChatEngine } from "./engine";

export interface ChatOptions {
  /** The rack preset whose conversations to list; null outside one. */
  rackPreset: string | null;
  /** What a question runs with: the DH-1 preset's settings, with the card's EFFORT. */
  config: AgentConfig;
  preset?: RunRequest["preset"];
  /** Recorded with each run; the rack adds rack_preset so the conversation lists under it. */
  labels?: RunRequest["labels"];
  /** The DATA menu. The first is where a new conversation starts. */
  sources: DataChoice[];
}

export interface Conversation {
  /** The first run's id; null until the first question has an answer. */
  rootRunId: string | null;
  title: string | null;
  turns: Turn[];
  source: Source;
}

export interface ChatModel {
  conversations: ConversationSummary[];
  /** Questions in the open conversation that ran (failed ones that never started don't count). */
  asked: number;
  maxTurns: number;
  current: Conversation;
  /** The question running now, if any. */
  live: RunView | null;
  busy: boolean;
  /** Loading the list or a conversation. */
  loading: boolean;
  error: string | null;
  canAsk: boolean;
  /** Why a question can't be asked right now, for the composer. */
  blocked: string | null;
  costUsd: number;
  ask: (prompt: string) => void;
  stop: () => void;
  open: (summary: ConversationSummary) => void;
  startNew: () => void;
  setSource: (source: Source) => void;
  refresh: () => void;
}

const fresh = (source: Source): Conversation => ({ rootRunId: null, title: null, turns: [], source });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useChat(engine: ChatEngine | null, options: ChatOptions): ChatModel {
  const { rackPreset, sources } = options;
  const startSource = sources[0]?.source ?? { tpch: 0.1 };
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [maxTurns, setMaxTurns] = useState(DEFAULT_MAX_TURNS);
  const [current, setCurrent] = useState<Conversation>(() => fresh(startSource));
  // The new conversation's DATA, kept while you look at other conversations.
  const [draftSource, setDraftSource] = useState<Source | null>(null);
  const [live, setLive] = useState<RunView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runRef = useRef<Run | null>(null);
  // The latest options, for ask(): the card's EFFORT can change between renders.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const busy = live !== null;

  const refresh = useCallback(() => {
    if (!engine) return;
    engine.conversations(rackPreset)
      .then(({ maxTurns, conversations }) => {
        setMaxTurns(maxTurns);
        setConversations(conversations);
      })
      .catch((e) => setError(`Couldn't list conversations: ${message(e)}`));
  }, [engine, rackPreset]);

  // A new rack preset (or engine) is a different list: start over.
  useEffect(() => {
    setCurrent(fresh(optionsRef.current.sources[0]?.source ?? { tpch: 0.1 }));
    setDraftSource(null);
    setError(null);
    refresh();
  }, [refresh]);

  // Leaving stops what's running.
  useEffect(() => () => { void runRef.current?.stop(); }, []);

  const open = (summary: ConversationSummary) => {
    if (!engine || busy) return;
    setLoading(true);
    setError(null);
    engine.conversation(summary.last_run_id)
      .then(({ maxTurns, turns }) => {
        setMaxTurns(maxTurns);
        const last = turns[turns.length - 1];
        setCurrent({
          rootRunId: summary.root_run_id,
          title: summary.title,
          turns: turns.map(turnFromTrace),
          source: last?.data_source ?? summary.data_source ?? startSource,
        });
      })
      .catch((e) => setError(`Couldn't open that conversation: ${message(e)}`))
      .finally(() => setLoading(false));
  };

  /** Go to the new conversation: the draft you left, if any. */
  const startNew = () => {
    if (busy) return;
    setError(null);
    setCurrent(fresh(draftSource ?? startSource));
  };

  // A question that failed before it ran (no run id) isn't in the traces, so it doesn't count.
  const asked = current.turns.filter((t) => t.runId || t.running).length;

  const setSource = (source: Source) => {
    if (busy || !canUse(source, asked, current.source)) return;
    setCurrent((c) => ({ ...c, source }));
    if (current.rootRunId === null && asked === 0) setDraftSource(source);
  };

  const full = asked >= maxTurns;
  const blocked = !engine ? "The engine isn't running."
    : busy ? null
      : loading ? "Opening the conversation…"
        : full ? `This conversation is full: ${maxTurns} of ${maxTurns} questions.`
          : null;
  const canAsk = !!engine && !busy && !loading && !full;

  const ask = (text: string) => {
    const prompt = text.trim();
    if (!prompt || !engine || !canAsk) return;
    const { config, preset, labels } = optionsRef.current;
    const parent = [...current.turns].reverse().find((t) => t.runId)?.runId ?? undefined;
    const request: RunRequest = {
      prompt,
      source: current.source,
      config,
      ...(preset ? { preset } : {}),
      ...(labels ? { labels } : {}),
      ...(parent ? { parent_run_id: parent } : {}),
    };
    // The draft becomes this conversation; the next new one starts afresh.
    if (!parent) setDraftSource(null);
    const key = `live-${Date.now()}`;
    const pending: Turn = {
      key, runId: null, prompt, answer: null, structured: null, status: null, error: null, iterations: null, queries: 0,
      durationMs: null, costUsd: null, running: true, view: null,
    };
    setError(null);
    setCurrent((c) => ({ ...c, title: c.title ?? prompt, turns: [...c.turns, pending] }));
    let view = runReducer(IDLE, { type: "start", maxIterations: config.max_iterations ?? 25, at: Date.now() });
    setLive(view);
    const run = engine.run(request, (event) => {
      view = runReducer(view, { type: "event", event });
      setLive(view);
    });
    runRef.current = run;
    const settle = (turn: Turn, rootRunId?: string) => {
      setCurrent((c) => ({
        ...c,
        rootRunId: c.rootRunId ?? rootRunId ?? null,
        turns: c.turns.map((t) => (t.key === key ? turn : t)),
      }));
      setLive(null);
      runRef.current = null;
      refresh();
    };
    run.done
      .then((result) => {
        view = runReducer(view, { type: "finished", result, at: Date.now() });
        settle(turnFromResult(prompt, result, view), result.run_id);
      })
      .catch((e) => settle({ ...pending, running: false, status: "error", error: message(e) }));
  };

  const stop = () => {
    if (!runRef.current) return;
    setLive((v) => (v ? runReducer(v, { type: "stopping" }) : v));
    void runRef.current.stop();
  };

  const costUsd = current.turns.reduce((sum, t) => sum + (t.costUsd ?? 0), 0) + (live?.costUsd ?? 0);

  return { conversations, asked, maxTurns, current, live, busy, loading, error, canAsk, blocked, costUsd, ask, stop, open, startNew, setSource, refresh };
}
