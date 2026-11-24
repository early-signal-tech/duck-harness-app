// CH-1's panel (board 22, redrawn in the rack's look): the rack preset's conversations on
// the left, the open conversation on the right with its DATA menu, turn lamps and cost,
// and the composer. A question runs on DH-1's engine; a follow-up carries the earlier
// turns. The rack's header carries + NEW CONVERSATION and STOP.

import { StructuredAnswer, type ConversationSummary, type Source } from "@dh/dh1";
import { Markdown, Menu, MenuItem, MenuSection } from "@dh/ui-kit";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { canUse, describeData, isDatabase, money, sameData, statusNote, when, type DataChoice, type Turn } from "./chat";
import "./ch1.css";
import type { ChatModel } from "./useChat";

function Lamps({ lit, total, running, big }: { lit: number; total: number; running?: boolean; big?: boolean }) {
  return (
    <span className={`ch1-lamps${big ? " big" : ""}`} aria-label={`${lit} of ${total} questions`}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < lit ? "on" : running && i === lit ? "run" : ""} />
      ))}
    </span>
  );
}

function ConversationButton({ c, max, current, onOpen, disabled }: {
  c: ConversationSummary; max: number; current: boolean; onOpen: () => void; disabled: boolean;
}) {
  return (
    <button className={`ch1-convo${current ? " on" : ""}`} aria-current={current || undefined} onClick={onOpen} disabled={disabled && !current}
      title={c.title ?? undefined}>
      <b>{c.title ?? "Untitled"}</b>
      <span><Lamps lit={Math.min(c.turns, max)} total={max} />{[when(c.ended_at), describeData(c.data_source)].filter(Boolean).join(" · ")}</span>
    </button>
  );
}

function TurnView({ turn, n }: { turn: Turn; n: number }) {
  const [activity, setActivity] = useState(false);
  const note = statusNote(turn);
  const lines = turn.view?.activity ?? [];
  return (
    <>
      <div className="ch1-you"><span className="ch1-lbl">YOU · {n}</span><p>{turn.prompt}</p></div>
      <div className={`ch1-answer${turn.running ? " live" : ""}${note ? " ended" : ""}`}>
        <span className="ch1-lbl">{turn.running ? "AGENT · RUNNING" : "AGENT"}</span>
        {turn.running ? null : turn.structured ? <StructuredAnswer answer={turn.structured} /> : turn.answer ? <Markdown text={turn.answer} /> : null}
        {note && <p className="ch1-note">{note}</p>}
        {(turn.running || activity) && lines.length > 0 && (
          <ol className="ch1-steps">{lines.map((l, i) => <li key={i} className={l.kind}>{l.text}{l.detail ? <span> · {l.detail}</span> : null}</li>)}</ol>
        )}
        {!turn.running && (turn.runId || turn.error) && (
          <span className="ch1-meta">
            {turn.iterations ?? 0} iterations · {turn.queries} {turn.queries === 1 ? "query" : "queries"} · {money(turn.costUsd)}
            {lines.length > 0 && (
              <button className="ch1-link" aria-expanded={activity} onClick={() => setActivity(!activity)}>{activity ? "▾" : "▸"} activity</button>
            )}
          </span>
        )}
      </div>
    </>
  );
}

function RunningTurn({ turn, n, model }: { turn: Turn; n: number; model: ChatModel }) {
  return <TurnView turn={{ ...turn, view: model.live }} n={n} />;
}

export function Ch1({ model, sources, onPickFiles, onPickDatabase }: {
  model: ChatModel;
  /** The DATA menu's choices: databases (traces, DuckLake catalogs, files) and in-memory data. */
  sources: DataChoice[];
  /** "Load files…" in the DATA menu, for a new conversation: the host's file dialog. */
  onPickFiles?: () => Promise<string[] | null>;
  /** "Choose a database file…": a DuckDB file, for any question. */
  onPickDatabase?: () => Promise<string | null>;
}) {
  const { current, maxTurns, asked, busy } = model;
  // What you've typed but not sent, per conversation ("new" for the new one), so looking at
  // another conversation doesn't lose it.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftKey = current.rootRunId ?? "new";
  const text = drafts[draftKey] ?? "";
  const setText = (value: string) => setDrafts((d) => ({ ...d, [draftKey]: value }));
  const [menu, setMenu] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  // Follow the conversation as it grows.
  const liveSteps = model.live?.activity.length ?? 0;
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [current.turns.length, liveSteps, busy]);

  // A new or reopened conversation puts you in the composer.
  useEffect(() => { composer.current?.focus(); }, [current.rootRunId, current.turns.length === 0]);

  const send = () => {
    if (!model.canAsk || !text.trim()) return;
    model.ask(text);
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
  const pick = (source: Source) => {
    model.setSource(source);
    setMenu(false);
  };
  const pickFiles = async () => {
    setMenu(false);
    const files = await onPickFiles?.();
    if (files?.length) model.setSource({ load: files });
  };
  const pickDatabase = async () => {
    setMenu(false);
    const path = await onPickDatabase?.();
    if (path) model.setSource({ db: path });
  };

  const choices = sources.some((c) => sameData(c.source, current.source))
    ? sources
    : [{ label: describeData(current.source), source: current.source }, ...sources];
  const turnNo = busy ? asked : Math.min(asked + 1, maxTurns);
  const left = maxTurns - asked;
  const hint = model.blocked
    ?? (busy ? "Running… STOP cancels this question."
      : asked === 0 ? `Enter sends · Shift+Enter for a new line · up to ${maxTurns} questions per conversation`
        : left === 1 ? "Last question in this conversation. After it, start a new one: earlier answers only carry over within a conversation."
          : `${left} questions left in this conversation.`);
  const isNew = current.rootRunId === null;

  return (
    <div className="ch1" data-device="ch1">
      <nav className="ch1-list" aria-label="Conversations">
        <span className="ch1-lbl">CONVERSATIONS</span>
        <div className="ch1-list-scroll">
          {/* The new conversation stays at the top, so leaving it before sending keeps it. */}
          {isNew ? (
            <button className="ch1-convo on" aria-current="true" disabled>
              <b>{current.title ?? "New conversation"}</b>
              <span><Lamps lit={asked - (busy ? 1 : 0)} total={maxTurns} running={busy} />{busy ? "asking…" : drafts.new?.trim() ? "draft" : "not asked yet"}</span>
            </button>
          ) : (
            <button className="ch1-convo" onClick={model.startNew} disabled={busy} title={drafts.new?.trim() || "Start a new conversation"}>
              <b>New conversation</b>
              <span><Lamps lit={0} total={maxTurns} />{drafts.new?.trim() ? `draft · ${drafts.new.trim()}` : "not asked yet"}</span>
            </button>
          )}
          {model.conversations.map((c) => (
            <ConversationButton key={c.root_run_id} c={c} max={maxTurns} current={c.root_run_id === current.rootRunId}
              disabled={busy} onOpen={() => model.open(c)} />
          ))}
        </div>
        {model.conversations.length === 0 && <p className="ch1-empty-note">Your conversations in this rack preset show here, newest first. They're read back from the traces.</p>}
      </nav>

      <section className="ch1-chat" aria-label="Conversation">
        <div className="ch1-bar">
          <span className="ch1-title" title={current.title ?? undefined}>{current.title ?? "New conversation"}</span>
          <span className="ch1-lbl dim">DATA</span>
          <Menu open={menu} onClose={() => setMenu(false)} label="Data for this conversation"
            anchor={<button className="ch1-pick" aria-haspopup="menu" aria-expanded={menu} disabled={busy}
              onClick={() => setMenu(!menu)}>{describeData(current.source)} <span aria-hidden="true">▾</span></button>}>
            {/* Databases can be switched to at any turn; in-memory data only for a new conversation. */}
            <MenuSection title="DATABASES">
              {choices.filter((c) => isDatabase(c.source)).map((c) => (
                <MenuItem key={c.label} checked={sameData(c.source, current.source)} onSelect={() => pick(c.source)}>{c.label}</MenuItem>
              ))}
              {onPickDatabase && <MenuItem onSelect={() => void pickDatabase()}>Choose a database file…</MenuItem>}
            </MenuSection>
            <MenuSection title={asked === 0 ? "IN-MEMORY DATA" : "NEW CONVERSATION ONLY"}>
              {choices.filter((c) => !isDatabase(c.source)).map((c) => (
                <MenuItem key={c.label} checked={sameData(c.source, current.source)} disabled={!canUse(c.source, asked, current.source)}
                  onSelect={() => pick(c.source)}>{c.label}</MenuItem>
              ))}
              {onPickFiles && <MenuItem disabled={asked > 0} onSelect={() => void pickFiles()}>Load files…</MenuItem>}
            </MenuSection>
            <p className="ch1-menu-note">{asked === 0
              ? "In-memory data (TPC-H, loaded files) is built for one conversation: after the first question, only databases can be switched to."
              : "A follow-up can only switch to a database. Use + NEW CONVERSATION to ask about TPC-H or loaded files."}</p>
          </Menu>
          <span className="ch1-spacer" />
          <span className="ch1-lbl">TURN {Math.max(turnNo, 1)} OF {maxTurns}</span>
          <Lamps lit={asked - (busy ? 1 : 0)} total={maxTurns} running={busy} big />
          <span className="ch1-cost" title="This conversation's estimated cost">{money(model.costUsd)}</span>
        </div>

        {model.error && <p className="ch1-error" role="alert">{model.error}</p>}

        <div className="ch1-turns" ref={scroller} aria-live="polite">
          {current.turns.length === 0 ? (
            <div className="ch1-empty">
              <b>Ask a question about your data</b>
              <span>Each answer shows its iterations, queries and cost. You can ask {maxTurns - 1} follow-ups, and the earlier answers come along.</span>
            </div>
          ) : current.turns.map((t, i) => (t.running
            ? <RunningTurn key={t.key} turn={t} n={i + 1} model={model} />
            : <TurnView key={t.key} turn={t} n={i + 1} />))}
        </div>

        <div className="ch1-composer">
          <div className="ch1-row">
            <label htmlFor="ch1-question" className="ch1-lbl accent">{asked === 0 ? "QUESTION" : "↳ FOLLOW-UP"}</label>
            <textarea id="ch1-question" ref={composer} rows={2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
              placeholder={model.blocked ?? (asked === 0 ? "Ask a question about your data…" : "Ask about these results…")}
              disabled={!model.canAsk && !busy} />
            {busy
              ? <button className="ch1-send stop" onClick={model.stop}>■ STOP</button>
              : <button className="ch1-send" onClick={send} disabled={!model.canAsk || !text.trim()}>SEND ▶</button>}
          </div>
          <span className="ch1-hint">{hint}</span>
        </div>
      </section>
    </div>
  );
}
