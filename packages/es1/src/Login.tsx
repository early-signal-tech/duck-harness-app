// The LOGIN drawer. flowctl opens its token page and waits; the person pastes the token here and
// it goes to flowctl, which saves it in its own config. ES-1 keeps no copy: the field is cleared
// as soon as the token's sent, and closing the drawer cancels a login that's still waiting.

import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { EngineError, type Engine, type Login } from "./engine";

const TOKEN_PAGE = "https://dashboard.estuary.dev/admin/api";

type Stage = "opening" | "waiting" | "saving" | "refused";

interface Props {
  engine: Engine;
  profile: string;
  onClose: () => void;
  onLoggedIn: () => void;
}

export function LoginDrawer({ engine, profile, onClose, onLoggedIn }: Props) {
  const [stage, setStage] = useState<Stage>("opening");
  const [token, setToken] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const login = useRef<Login | null>(null);
  const finished = useRef(false);

  const start = useCallback(() => {
    const current = engine.login(profile);
    login.current = current;
    finished.current = false;
    setStage("opening");
    current.waiting.then(() => {
      if (login.current === current) setStage((s) => (s === "opening" ? "waiting" : s));
    }).catch(() => {});
    current.done.then(() => {
      if (login.current !== current) return;
      finished.current = true;
      onLoggedIn();
    }).catch((e) => {
      if (login.current !== current) return;
      finished.current = true;
      if (e instanceof EngineError && e.code === "stopped") return;
      setNote(e instanceof Error ? e.message : String(e));
      setStage("refused");
    });
    return current;
  }, [engine, profile, onLoggedIn]);

  // Once per opening, and a beat later: React's development mode mounts things twice, and each
  // start opens a browser tab. A drawer that goes away takes a waiting login with it.
  const startOnce = useRef(start);
  useEffect(() => {
    const starting = setTimeout(() => startOnce.current(), 0);
    return () => {
      clearTimeout(starting);
      const current = login.current;
      login.current = null;
      if (current && !finished.current) current.cancel().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const pasted = token.trim();
    if (!pasted || stage !== "waiting" || !login.current) return;
    setToken("");
    setNote(null);
    setStage("saving");
    login.current.submit(pasted).catch((error) => {
      // It's still waiting: a token that couldn't be sent, or doesn't look like one.
      setNote(error instanceof Error ? error.message : String(error));
      setStage("waiting");
    });
  };

  return (
    <div className="es1-drawer" role="dialog" aria-label="Log in">
      <header>LOGIN<small>flowctl auth login</small></header>
      <form onSubmit={submit}>
        <div className="es1-step">
          <i>1</i>
          <span>
            Estuary's token page opens in your browser. If it didn't,{" "}
            <a href={TOKEN_PAGE} onClick={(e) => { e.preventDefault(); openUrl(TOKEN_PAGE).catch(() => {}); }}>open it here</a>.
          </span>
        </div>
        <div className="es1-step">
          <i>2</i>
          <span>
            Copy the token from that page and paste it here.
            <label>
              TOKEN
              <input type="password" autoFocus autoComplete="off" spellCheck={false} value={token} disabled={stage === "saving" || stage === "refused"}
                onChange={(e) => setToken(e.currentTarget.value)} />
            </label>
          </span>
        </div>
        <div className="es1-step">
          <i>3</i>
          <span>flowctl saves it in its own config for profile <code>{profile}</code>, replacing any login that profile has. ES-1 doesn't keep a copy.</span>
        </div>
        {note && <p className="es1-drawer-note" role="alert">{note}</p>}
        <footer>
          <button type="button" className="es1-button plain" onClick={onClose}>CANCEL</button>
          {stage === "refused" ? (
            <button type="button" className="es1-button" onClick={() => { setNote(null); start(); }}>TRY AGAIN</button>
          ) : (
            <button type="submit" className="es1-button" disabled={stage !== "waiting" || !token.trim()}>
              {stage === "saving" ? "SAVING…" : stage === "opening" ? "STARTING…" : "SAVE LOGIN"}
            </button>
          )}
        </footer>
      </form>
    </div>
  );
}
