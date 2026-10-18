import { groupEnd, moveGroupToBoundary, templates } from "./flow";
import type { Kind, Resume, Settings, Template } from "./flow";

export const AGENT_CONFIG_KEY = "diyjobresume.agent.v1";
const NOTICE_KEY = "diyjobresume.agent.notice.v1";

export interface AgentConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}
export interface AgentTurn {
  role: "user" | "assistant";
  text: string;
}
export interface AgentReply {
  reply: string;
  actions: AgentAction[];
}
export type AgentAction = { type?: string } & Record<string, unknown>;

const KINDS: Exclude<Kind, "blank">[] = [
  "name",
  "section",
  "entry",
  "text",
  "bullet",
  "ordered",
  "h4",
  "h5",
  "h6",
];
const FONT_KEYS: Settings["font"][] = ["sans", "serif", "nunito"];
const TEMPLATE_IDS = templates.map((t) => t.id);

export const defaultAgentConfig = (): AgentConfig => ({
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  apiKey: "",
});

export function loadAgentConfig(): AgentConfig {
  try {
    const raw = localStorage.getItem(AGENT_CONFIG_KEY);
    if (!raw) return defaultAgentConfig();
    const saved = JSON.parse(raw) as Partial<AgentConfig>;
    return {
      baseUrl: String(saved.baseUrl || defaultAgentConfig().baseUrl),
      model: String(saved.model || defaultAgentConfig().model),
      apiKey: String(saved.apiKey || ""),
    };
  } catch {
    return defaultAgentConfig();
  }
}
export function saveAgentConfig(config: AgentConfig) {
  localStorage.setItem(AGENT_CONFIG_KEY, JSON.stringify(config));
}
export function noticeAccepted() {
  return localStorage.getItem(NOTICE_KEY) === "1";
}
export function acceptNotice() {
  localStorage.setItem(NOTICE_KEY, "1");
}

const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n)
    ? Math.min(max, Math.max(min, Math.round(n * 100) / 100))
    : fallback;
};
const hexColor = (v: unknown) =>
  typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : "";

// 给模型看的当前排版摘要：只放排版参数和板块结构，不放正文，省 token 也少泄露
export function describeDoc(doc: Resume, pageCount = 1) {
  const s = doc.settings,
    types = KINDS.map((k) => {
      const t = s.types[k];
      return `${k} ${t.size}px(${t.before}/${t.after})`;
    }).join("，");
  const sections: string[] = [];
  let index = 0;
  for (let i = 0; i < doc.lines.length; i = groupEnd(doc.lines, i)) {
    const line = doc.lines[i];
    if (line.kind !== "section") continue;
    index++;
    sections.push(
      `${index}. ${line.text}（${groupEnd(doc.lines, i) - i - 1} 行内容）`,
    );
  }
  return [
    `模板：${doc.template}（${templates.find((t) => t.id === doc.template)?.name || ""}）`,
    `字体：${s.font}；行高：${s.lineHeight}；表头：${s.headerAlign}`,
    `页边距 上${s.top}/下${s.bottom}/左${s.left}/右${s.right}px`,
    `主题色：${s.accent}；正文色：${s.color}`,
    `字号(段前/段后)：${types}`,
    `板块顺序：${sections.join(" / ") || "（没有板块标题）"}`,
    `总行数：${doc.lines.length}；当前页数：${pageCount}`,
  ].join("\n");
}

export const AGENT_SYSTEM_PROMPT = `你是简历排版助手。用户会用中文描述排版上的需求，你只能调整「样式与结构」，绝对不能改动用户写下的任何文字内容。

只输出一个 JSON 对象，不要输出别的文字、不要用 markdown 代码块：
{"reply":"一句中文说明你做了什么","actions":[动作对象...]}

可用动作（actions 是数组，按顺序执行）：
1 {"type":"template","template":"blue|black|ribbon|academic|teal|violet"} 换模板
2 {"type":"font","font":"sans|serif|nunito"} 换字体
3 {"type":"fontSize","kind":"name|section|entry|text|bullet|ordered|h4|h5|h6|all","size":10到32的数字} 字号
4 {"type":"lineHeight","value":1.15到2.2} 行高
5 {"type":"spacing","kind":"同上","before":0到24,"after":0到24} 段前段后（px）
6 {"type":"margins","top":12到120,"bottom":12到120,"left":12到120,"right":12到120} 页边距（px）
7 {"type":"accent","color":"#rrggbb"} 主题色；{"type":"ink","color":"#rrggbb"} 正文色
8 {"type":"headerAlign","value":"left|center"} 表头对齐
9 {"type":"compact"} 一键紧凑：字号各减、行高 1.35、段距收紧
10 {"type":"moveSection","section":"板块标题原文","to":从1开始的目标位置} 调整板块顺序
11 {"type":"removeEmptyLines"} 删除空行

规则：
- 内容已经很长或页数偏多时，优先用 compact、缩小字号、收紧段距、减少页边距。
- 用户说“学术/简洁/商务/标签风”之类的感觉时，挑最接近的模板并说明选择理由。
- 一次最多给 6 个动作，不要重复堆叠同一种动作。
- 如果用户的请求和排版无关（比如改文案、写经历），actions 返回空数组，并在 reply 里说明你只做排版。`;

export async function requestAgent(
  config: AgentConfig,
  system: string,
  turns: AgentTurn[],
  input: string,
  signal?: AbortSignal,
): Promise<AgentReply> {
  const url = config.baseUrl.trim().replace(/\/+$/, "") + "/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: config.model.trim(),
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        ...turns.slice(-6).map((turn) => ({
          role: turn.role,
          content: turn.text,
        })),
        { role: "user", content: input },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `接口返回 ${res.status}${detail ? "：" + detail.slice(0, 160) : ""}`,
    );
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content || "";
  return parseAgentReply(text);
}

export function parseAgentReply(text: string): AgentReply {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const start = cleaned.indexOf("{"),
    end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return { reply: cleaned.slice(0, 500) || "（没有返回内容）", actions: [] };
  }
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
      reply?: unknown;
      actions?: unknown;
    };
    const actions = Array.isArray(parsed.actions)
      ? (parsed.actions.filter(
          (a) => a && typeof a === "object",
        ) as AgentAction[])
      : [];
    return {
      reply: String(parsed.reply || "已完成调整。"),
      actions: actions.slice(0, 12),
    };
  } catch {
    return { reply: cleaned.slice(0, 500), actions: [] };
  }
}

const withSettings = (doc: Resume, patch: Partial<Settings>): Resume => ({
  ...doc,
  settings: { ...doc.settings, ...patch },
});
const withType = (
  doc: Resume,
  kinds: Exclude<Kind, "blank">[],
  patch: Partial<Settings["types"]["text"]>,
): Resume => {
  const types = { ...doc.settings.types };
  for (const kind of kinds)
    types[kind] = { ...types[kind], ...patch } as Settings["types"][typeof kind];
  return withSettings(doc, { types });
};
const pickKinds = (value: unknown): Exclude<Kind, "blank">[] => {
  const text = String(value ?? "all").toLowerCase();
  if (text === "all" || text === "全部" || text === "") return KINDS;
  return KINDS.filter((k) => k === text);
};
export function sectionTitles(doc: Resume) {
  return doc.lines.filter((l) => l.kind === "section").map((l) => l.text.trim());
}

// 执行一组动作，返回新文档 + 给用户看的中文说明
export function applyAgentActions(
  doc: Resume,
  actions: AgentAction[],
): { doc: Resume; notes: string[]; skipped: string[] } {
  let next = doc;
  const notes: string[] = [],
    skipped: string[] = [];
  for (const action of actions) {
    const type = String(action.type || "");
    if (type === "template") {
      const id = String(action.template || "") as Template;
      if (!TEMPLATE_IDS.includes(id)) {
        skipped.push(`不认识的模板「${id}」`);
        continue;
      }
      next = {
        ...next,
        template: id,
        settings: {
          ...next.settings,
          accent: templates.find((t) => t.id === id)!.color,
        },
      };
      notes.push(`切换模板为「${templates.find((t) => t.id === id)!.name}」`);
    } else if (type === "font") {
      const font = String(action.font || "") as Settings["font"];
      if (!FONT_KEYS.includes(font)) {
        skipped.push("不认识的字体");
        continue;
      }
      next = withSettings(next, { font });
      notes.push(`字体改为 ${font === "sans" ? "黑体" : font === "serif" ? "宋体" : "Nunito"}`);
    } else if (type === "fontSize") {
      const kinds = pickKinds(action.kind);
      const size = num(action.size, 10, 32, 0);
      if (!kinds.length || !size) {
        skipped.push("字号值不合法");
        continue;
      }
      next = withType(next, kinds, { size });
      notes.push(
        `${kinds.length === KINDS.length ? "全部文字" : kinds.join("/")} 字号改为 ${size}px`,
      );
    } else if (type === "lineHeight") {
      const value = num(action.value, 1.15, 2.2, 0);
      if (!value) {
        skipped.push("行高值不合法");
        continue;
      }
      next = withSettings(next, { lineHeight: value });
      notes.push(`行高改为 ${value}`);
    } else if (type === "spacing") {
      const kinds = pickKinds(action.kind);
      const patch: { before?: number; after?: number } = {};
      if (action.before !== undefined)
        patch.before = num(action.before, 0, 24, 0);
      if (action.after !== undefined) patch.after = num(action.after, 0, 24, 0);
      if (!kinds.length || !Object.keys(patch).length) {
        skipped.push("段距参数不完整");
        continue;
      }
      next = withType(next, kinds, patch);
      notes.push(
        `${kinds.length === KINDS.length ? "所有段落" : kinds.join("/")} 段距改为${
          patch.before !== undefined ? ` 前${patch.before}px` : ""
        }${patch.after !== undefined ? ` 后${patch.after}px` : ""}`,
      );
    } else if (type === "margins") {
      const s = next.settings,
        patch: Partial<Settings> = {};
      if (action.top !== undefined) patch.top = num(action.top, 12, 120, s.top);
      if (action.bottom !== undefined)
        patch.bottom = num(action.bottom, 12, 120, s.bottom);
      if (action.left !== undefined) patch.left = num(action.left, 12, 120, s.left);
      if (action.right !== undefined)
        patch.right = num(action.right, 12, 120, s.right);
      if (!Object.keys(patch).length) {
        skipped.push("页边距参数不完整");
        continue;
      }
      next = withSettings(next, patch);
      notes.push(
        `页边距 上${next.settings.top}/下${next.settings.bottom}/左${next.settings.left}/右${next.settings.right}`,
      );
    } else if (type === "accent" || type === "ink") {
      const color = hexColor(action.color);
      if (!color) {
        skipped.push("颜色格式不对（要 #rrggbb）");
        continue;
      }
      next = withSettings(next, type === "accent" ? { accent: color } : { color });
      notes.push(`${type === "accent" ? "主题色" : "正文色"}改为 ${color}`);
    } else if (type === "headerAlign") {
      const value = action.value === "left" ? "left" : "center";
      next = withSettings(next, { headerAlign: value });
      notes.push(`表头${value === "left" ? "左对齐" : "居中"}`);
    } else if (type === "compact") {
      const types = { ...next.settings.types };
      for (const kind of KINDS)
        types[kind] = {
          ...types[kind],
          size: Math.max(10, types[kind].size - 1),
          before: Math.max(0, types[kind].before - 1),
          after: Math.max(0, types[kind].after - 1),
        };
      next = withSettings(next, { types, lineHeight: 1.35 });
      notes.push("一键紧凑：字号与段距各减 1，行高 1.35");
    } else if (type === "moveSection") {
      const wanted = String(action.section || "").trim();
      const lines = next.lines,
        at = lines.findIndex(
          (l) =>
            l.kind === "section" &&
            (l.text.trim() === wanted || l.text.includes(wanted)),
        );
      if (at < 0) {
        skipped.push(`没找到板块「${wanted}」`);
        continue;
      }
      const order = next.lines
        .map((l, i) => (l.kind === "section" ? i : -1))
        .filter((i) => i >= 0);
      const position = Math.round(num(action.to, 1, order.length, 0));
      if (!position) {
        skipped.push("目标位置不合法");
        continue;
      }
      const boundary =
        position <= 1
          ? order[0]
          : position > order.length
            ? lines.length
            : order[position - 1];
      const moved = moveGroupToBoundary(next, lines[at].id, boundary);
      if (moved === next) {
        skipped.push(`「${wanted}」已经在这个位置`);
        continue;
      }
      next = moved;
      notes.push(`把「${wanted}」排到第 ${position} 位`);
    } else if (type === "removeEmptyLines") {
      const lines = next.lines.filter((l) => l.kind !== "blank"),
        removed = next.lines.length - lines.length;
      if (!removed) {
        skipped.push("没有空行可删");
        continue;
      }
      next = { ...next, lines };
      notes.push(`删掉 ${removed} 个空行`);
    } else {
      skipped.push(`不支持的动作「${type}」`);
    }
  }
  return { doc: next, notes, skipped };
}
