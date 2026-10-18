import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  AlertTriangle,
  Bot,
  Eraser,
  Send,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import {
  AGENT_CONTENT_PROMPT,
  AGENT_SYSTEM_PROMPT,
  acceptNotice,
  applyAgentActions,
  describeDoc,
  loadAgentConfig,
  noticeAccepted,
  requestAgent,
  saveAgentConfig,
} from "./agent";
import type { AgentAction, AgentConfig, AgentTurn } from "./agent";
import type { Resume } from "./flow";

const EXAMPLES = [
  "内容有点挤，帮我排得清爽一点",
  "换成学术风，表头左对齐",
  "把专业技能排到最前面",
  "行距松一点，看着更透气",
];
const TURNS_KEY = "diyjobresume.agent.turns.v1";

function loadTurns(): AgentTurn[] {
  try {
    const raw = localStorage.getItem(TURNS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as AgentTurn[];
    return Array.isArray(list)
      ? list
          .filter(
            (t) =>
              t &&
              (t.role === "user" || t.role === "assistant") &&
              typeof t.text === "string",
          )
          .slice(-30)
      : [];
  } catch {
    return [];
  }
}
function errorText(e: unknown) {
  const name = e instanceof Error ? e.name : "",
    message = String(e instanceof Error ? e.message : e);
  if (name === "AbortError") return "请求超时（90 秒），检查接口地址和网络。";
  if (/fetch/i.test(message))
    return "请求失败：地址可能不对，或对方接口不允许浏览器直连（CORS）。";
  return message;
}

export function AgentPanel({
  doc,
  pageCount,
  docked = false,
  onApply,
  onPreview,
  onClearPreview,
  registerPreviewApi,
  onClose,
}: {
  doc: Resume;
  pageCount: number;
  docked?: boolean;
  onApply: (next: Resume) => void;
  onPreview: (next: Resume) => void;
  onClearPreview: () => void;
  registerPreviewApi: (
    api: { accept: () => void; reject: () => void } | null,
  ) => void;
  onClose: () => void;
}) {
  const [config, setConfig] = useState(loadAgentConfig),
    [draft, setDraft] = useState(loadAgentConfig),
    [setupOpen, setSetupOpen] = useState(() => !loadAgentConfig().apiKey),
    [agreed, setAgreed] = useState(noticeAccepted),
    [input, setInput] = useState(""),
    [turns, setTurns] = useState<AgentTurn[]>(loadTurns),
    [pending, setPending] = useState<{
      actions: AgentAction[];
      notes: string[];
      skipped: string[];
    } | null>(null),
    [busy, setBusy] = useState(false),
    [testing, setTesting] = useState(false),
    [testResult, setTestResult] = useState(""),
    [error, setError] = useState("");
  const [pos, setPos] = useState(() => ({
    x: Math.max(12, window.innerWidth - 400),
    y: 96,
  }));
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, pending, busy, error]);

  useEffect(() => {
    try {
      localStorage.setItem(TURNS_KEY, JSON.stringify(turns.slice(-30)));
    } catch {
      /* 存不下也不影响使用 */
    }
  }, [turns]);

  const drag = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement,
      base = pos,
      startX = e.clientX,
      startY = e.clientY;
    handle.setPointerCapture(e.pointerId);
    const move = (event: PointerEvent) =>
      setPos({
        x: Math.max(
          8,
          Math.min(window.innerWidth - 140, base.x + event.clientX - startX),
        ),
        y: Math.max(
          8,
          Math.min(window.innerHeight - 80, base.y + event.clientY - startY),
        ),
      });
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  const save = () => {
    const next: AgentConfig = {
      baseUrl: draft.baseUrl.trim() || "https://api.openai.com/v1",
      model: draft.model.trim(),
      apiKey: draft.apiKey.trim(),
    };
    saveAgentConfig(next);
    setConfig(next);
    if (agreed) acceptNotice();
    setSetupOpen(false);
    setError("");
  };

  const test = async () => {
    setTesting(true);
    setTestResult("");
    try {
      const reply = await requestAgent(
        {
          baseUrl: draft.baseUrl.trim() || "https://api.openai.com/v1",
          model: draft.model.trim(),
          apiKey: draft.apiKey.trim(),
        },
        "你是连通性测试，只回复 ok。",
        [],
        "ping",
      );
      setTestResult(`连接正常（模型回复：${reply.reply.slice(0, 20)}）`);
    } catch (e) {
      setTestResult(`连接失败：${errorText(e)}`);
    } finally {
      setTesting(false);
    }
  };

  const askModel = async (
    system: string,
    history: AgentTurn[],
    question: string,
    signal: AbortSignal,
  ) => {
    const first = await requestAgent(config, system, history, question, signal);
    if (first.actions.length) return first;
    const retry = await requestAgent(
      config,
      system + "\n\n重要：必须只输出一个 JSON 对象，并在 actions 里给出动作数组。",
      history,
      question +
        "\n（只输出 JSON；如果确实不需要任何排版改动，actions 返回空数组，并在 reply 里说明原因。）",
      signal,
    );
    return retry.actions.length ? retry : first;
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    if (!config.apiKey.trim() || !config.model.trim()) {
      setSetupOpen(true);
      setError("先填好接口地址、模型名和 Key，再点保存。");
      return;
    }
    setBusy(true);
    setError("");
    setPending(null);
    onClearPreview();
    // 先把用户这句话和“正在生成”放上去，再去请求
    setInput("");
    setTurns((all) => [...all, { role: "user", text }]);
    const history = turns;
    const system =
      AGENT_SYSTEM_PROMPT +
      AGENT_CONTENT_PROMPT +
      "\n\n当前简历参数与正文：\n" +
      describeDoc(doc, pageCount, true);
    const controller = new AbortController(),
      timer = window.setTimeout(() => controller.abort(), 90000);
    try {
      const reply = await askModel(system, history, text, controller.signal);
      setTurns((all) => [
        ...all,
        { role: "assistant", text: reply.reply },
      ]);
      if (reply.actions.length) {
        const applied = applyAgentActions(doc, reply.actions);
        setPending({
          actions: reply.actions,
          notes: applied.notes,
          skipped: applied.skipped,
        });
        if (applied.notes.length) onPreview(applied.doc);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      window.clearTimeout(timer);
      setBusy(false);
    }
  };

  const accept = () => {
    if (!pending) return;
    // 按当前文档重算，避免中途改过内容被旧快照覆盖
    onApply(applyAgentActions(doc, pending.actions).doc);
    onClearPreview();
    registerPreviewApi(null);
    setPending(null);
  };
  const reject = () => {
    if (!pending) return;
    onClearPreview();
    registerPreviewApi(null);
    setPending(null);
  };

  const apiRef = useRef({ accept, reject });
  apiRef.current = { accept, reject };
  useEffect(() => {
    registerPreviewApi(
      pending
        ? {
            accept: () => apiRef.current.accept(),
            reject: () => apiRef.current.reject(),
          }
        : null,
    );
  }, [pending, registerPreviewApi]);

  const clear = () => {
    setTurns([]);
    setPending(null);
    setError("");
    setTestResult("");
  };

  return (
    <div
      className={`agent-panel${docked ? " agent-docked" : ""}`}
      style={docked ? undefined : { left: pos.x, top: pos.y }}
      aria-label="排版助手"
    >
      <header
        className="agent-head"
        onPointerDown={docked ? undefined : drag}
        style={docked ? { cursor: "default" } : undefined}
      >
        <Sparkles size={16} />
        <b>排版助手</b>
        <span className="agent-sub">
          {docked ? "占用样式面板，改完自动切回" : "只改排版，不改文字"}
        </span>
        <div className="agent-tools">
          <button aria-label="清空对话" title="清空对话" onClick={clear}>
            <Eraser size={15} />
          </button>
          <button
            aria-label="接口设置"
            title="接口设置"
            onClick={() => setSetupOpen(!setupOpen)}
          >
            <Settings2 size={15} />
          </button>
          <button aria-label="关闭排版助手" title="关闭" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
      </header>

      {setupOpen && (
        <section className="agent-setup">
          <label>
            <span>接口地址</span>
            <input
              value={draft.baseUrl}
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
              spellCheck={false}
            />
          </label>
          <label>
            <span>模型名</span>
            <input
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              placeholder="gpt-4o-mini"
              spellCheck={false}
            />
          </label>
          <label>
            <span>API Key</span>
            <input
              type="password"
              value={draft.apiKey}
              onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              placeholder="sk-..."
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <label className="agent-agree">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>
              我了解：点发送时，<b>排版参数、板块标题和简历正文</b>
              会发送到上面的地址，以便它改写内容。Key 只存在本机浏览器。
            </span>
          </label>
          <div className="agent-setup-actions">
            <button disabled={testing || !draft.model} onClick={() => void test()}>
              {testing ? "测试中…" : "测试连接"}
            </button>
            <button className="primary" disabled={!agreed} onClick={save}>
              保存并启用
            </button>
          </div>
          {testResult && <p className="agent-skip">{testResult}</p>}
        </section>
      )}

      <div className="agent-log" ref={logRef}>
        {!turns.length && (
          <div className="agent-empty">
            <Bot size={18} />
            <p>
              用一句话说清楚你想怎么排，我会先给出改动清单，你确认后才生效。
            </p>
            <div className="agent-chips">
              {EXAMPLES.map((example) => (
                <button key={example} onClick={() => setInput(example)}>
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((turn, index) => (
          <div key={index} className={`agent-msg ${turn.role}`}>
            {turn.text}
          </div>
        ))}
        {busy && (
          <div className="agent-msg assistant agent-thinking">
            正在生成排版方案…
          </div>
        )}
        {error && (
          <div className="agent-error">
            <AlertTriangle size={14} />
            <span>{error}</span>
          </div>
        )}
        {pending && (
          <div className="agent-plan">
            {pending.notes.length ? (
              <>
                <strong>将要改动 {pending.notes.length} 项</strong>
                <ul>
                  {pending.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
                {pending.actions.filter((a) => a.type === "remove").length >
                  0 && (
                  <p className="agent-warn">
                    注意：这次会删掉{" "}
                    {pending.actions.filter((a) => a.type === "remove").length}{" "}
                    行内容，看清楚再接受。
                  </p>
                )}
                {pending.skipped.length > 0 && (
                  <p className="agent-skip">
                    已跳过：{pending.skipped.join("；")}
                  </p>
                )}
                <div className="agent-plan-actions">
                  <button className="primary" onClick={accept}>
                    接受
                  </button>
                  <button onClick={reject}>不接受</button>
                </div>
              </>
            ) : (
              <p className="agent-skip">
                这次没有可执行的排版改动
                {pending.skipped.length ? "：" + pending.skipped.join("；") : "。"}
              </p>
            )}
          </div>
        )}
      </div>

      <form
        className="agent-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="例如：内容太挤了，帮我排得清爽一点"
          rows={2}
          aria-label="告诉助手你想怎么排"
        />
        <button type="submit" disabled={busy || !input.trim()} aria-label="发送">
          <Send size={15} />
        </button>
      </form>
    </div>
  );
}
