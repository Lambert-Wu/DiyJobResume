import { describe, expect, it } from "vitest";
import {
  AGENT_CONTENT_PROMPT,
  AGENT_SYSTEM_PROMPT,
  applyAgentActions,
  buildAgentMessages,
  changesDigest,
  describeDoc,
  parseAgentReply,
} from "./agent";
import { initialResume, parseMarkdown, toMarkdown } from "./flow";

const doc = () => {
  const resume = initialResume();
  resume.lines = parseMarkdown(
    "# 张三\n138 0000 2468\n## 教育背景\n### 示例大学\n- 主修课程\n## 实习经历\n### 示例公司\n- 做了点事",
  );
  return resume;
};

describe("agent layout actions", () => {
  it("switches template and follows its accent color", () => {
    const next = applyAgentActions(doc(), [
      { type: "template", template: "teal" },
    ]);
    expect(next.doc.template).toBe("teal");
    expect(next.doc.settings.accent).toBe("#588591");
    expect(next.notes).toHaveLength(1);
  });
  it("changes font size for every kind or a single kind", () => {
    const all = applyAgentActions(doc(), [
      { type: "fontSize", kind: "all", size: 12 },
    ]);
    expect(all.doc.settings.types.text.size).toBe(12);
    expect(all.doc.settings.types.name.size).toBe(12);
    const one = applyAgentActions(doc(), [
      { type: "fontSize", kind: "bullet", size: 11 },
    ]);
    expect(one.doc.settings.types.bullet.size).toBe(11);
    expect(one.doc.settings.types.text.size).toBe(13);
  });
  it("clamps out-of-range numbers instead of trusting the model", () => {
    const next = applyAgentActions(doc(), [
      { type: "lineHeight", value: 9 },
      { type: "margins", left: 5, right: 999 },
    ]);
    expect(next.doc.settings.lineHeight).toBe(2.2);
    expect(next.doc.settings.left).toBe(12);
    expect(next.doc.settings.right).toBe(120);
  });
  it("skips unknown actions, bad colors and missing sections", () => {
    const before = doc();
    const next = applyAgentActions(before, [
      { type: "rewrite", text: "帮我写点东西" },
      { type: "accent", color: "blue" },
      { type: "moveSection", section: "不存在的板块", to: 1 },
    ]);
    expect(next.notes).toHaveLength(0);
    expect(next.skipped).toHaveLength(3);
    expect(next.doc).toBe(before);
  });
  it("reorders a section with its content", () => {
    const next = applyAgentActions(doc(), [
      { type: "moveSection", section: "实习经历", to: 1 },
    ]);
    expect(toMarkdown(next.doc.lines).split("\n").slice(2, 4)).toEqual([
      "## 实习经历",
      "### 示例公司",
    ]);
  });
  it("compacts type sizes and line height in one go", () => {
    const before = doc(),
      next = applyAgentActions(before, [{ type: "compact" }]).doc;
    expect(next.settings.lineHeight).toBe(1.35);
    expect(next.settings.types.text.size).toBe(
      before.settings.types.text.size - 1,
    );
  });
  it("drops empty lines only when there are any", () => {
    const withBlank = doc();
    withBlank.lines.splice(2, 0, { id: "blank-1", kind: "blank", text: "" });
    const next = applyAgentActions(withBlank, [{ type: "removeEmptyLines" }]);
    expect(next.doc.lines.some((l) => l.kind === "blank")).toBe(false);
    expect(next.notes[0]).toContain("删掉 1 个空行");
    const again = applyAgentActions(next.doc, [{ type: "removeEmptyLines" }]);
    expect(again.skipped).toHaveLength(1);
  });
});

describe("agent content actions", () => {
  it("rewrites a line while keeping its kind", () => {
    const next = applyAgentActions(doc(), [
      { type: "setText", line: 5, text: "主修课程：数据结构、编译原理" },
    ]);
    expect(next.doc.lines[4].text).toBe("主修课程：数据结构、编译原理");
    expect(next.doc.lines[4].kind).toBe("bullet");
    expect(next.notes).toHaveLength(1);
  });
  it("inserts and removes lines by number", () => {
    const before = doc();
    const inserted = applyAgentActions(before, [
      { type: "insert", after: 5, kind: "bullet", text: "新增一条要点" },
    ]).doc;
    expect(inserted.lines).toHaveLength(before.lines.length + 1);
    expect(inserted.lines[5].text).toBe("新增一条要点");
    const removed = applyAgentActions(inserted, [
      { type: "remove", line: 6 },
    ]).doc;
    expect(removed.lines).toHaveLength(before.lines.length);
  });
  it("rejects out-of-range line numbers instead of throwing", () => {
    const next = applyAgentActions(doc(), [
      { type: "setText", line: 99, text: "x" },
      { type: "remove", line: 0 },
    ]);
    expect(next.notes).toHaveLength(0);
    expect(next.skipped).toHaveLength(2);
  });
  it("replaces text across the whole document", () => {
    const next = applyAgentActions(doc(), [
      { type: "replace", find: "示例", replace: "样例" },
    ]);
    const text = toMarkdown(next.doc.lines);
    expect(text).toContain("样例大学");
    expect(text).not.toContain("示例大学");
    expect(next.notes[0]).toContain("2 处");
  });
  it("changes a line kind", () => {
    const next = applyAgentActions(doc(), [
      { type: "setKind", line: 5, kind: "section" },
    ]);
    expect(next.doc.lines[4].kind).toBe("section");
  });
});

describe("agent whole-document action", () => {
  it("rebuilds the resume from a pasted block of text", () => {
    const before = doc();
    const next = applyAgentActions(before, [
      {
        type: "setContent",
        text:
          "李景阳\n电话：18319206783 ｜ 邮箱：a@b.com\n【项目经历】\n► 某项目   负责人   2025.01 – 2025.06\n· 做了点事",
      },
    ]);
    const markdown = toMarkdown(next.doc.lines);
    expect(markdown).toContain("# 李景阳");
    expect(markdown).toContain("## 项目经历");
    expect(markdown).toContain("### 某项目 | 负责人 | 2025.01 – 2025.06");
    expect(markdown).toContain("- 做了点事");
    expect(next.notes[0]).toContain("整篇重排");
    // 只换内容，模板和样式保持不变
    expect(next.doc.template).toBe(before.template);
    expect(next.doc.settings).toEqual(before.settings);
  });
  it("also accepts markdown from the model", () => {
    const next = applyAgentActions(doc(), [
      { type: "setContent", text: "# 李四\n## 教育背景\n- 某大学" },
    ]);
    expect(next.doc.lines[0]).toMatchObject({ kind: "name", text: "李四" });
    expect(next.doc.lines[1]).toMatchObject({
      kind: "section",
      text: "教育背景",
    });
    expect(next.doc.lines[2].kind).toBe("bullet");
  });
  it("skips empty content instead of wiping the resume", () => {
    const before = doc();
    const next = applyAgentActions(before, [{ type: "setContent", text: "  " }]);
    expect(next.doc).toBe(before);
    expect(next.skipped).toHaveLength(1);
  });
});

describe("agent conversation memory", () => {
  it("passes earlier turns and what was applied to the model", () => {
    const messages = buildAgentMessages(
      "系统",
      [
        { role: "user", text: "行距紧一点" },
        {
          role: "assistant",
          text: "好了，收到 1.35",
          notes: ["行距 1.5 → 1.35"],
        },
        { role: "user", text: "再紧一点" },
        {
          role: "assistant",
          text: "那就 1.25",
          rejected: true,
        },
      ],
      "刚才那个不要，回到第一次",
    );
    expect(messages[0]).toEqual({ role: "system", content: "系统" });
    expect(messages[1]).toEqual({ role: "user", content: "行距紧一点" });
    expect(messages[2].content).toContain("行距 1.5 → 1.35");
    expect(messages[4].content).toContain("没有接受");
    expect(messages.at(-1)?.content).toBe("刚才那个不要，回到第一次");
  });
  it("keeps the whole conversation without trimming by count", () => {
    const turns = Array.from({ length: 80 }, (_, i) => ({
      role: (i % 2 ? "assistant" : "user") as "user" | "assistant",
      text: "第 " + i + " 条",
    }));
    const messages = buildAgentMessages("系统", turns, "继续");
    expect(messages).toHaveLength(82);
    expect(messages[1].content).toBe("第 0 条");
    expect(messages.at(-2)?.content).toBe("第 79 条");
  });
  it("keeps the whole conversation without trimming by count", () => {
    const turns = Array.from({ length: 80 }, (_, i) => ({
      role: (i % 2 ? "assistant" : "user") as "user" | "assistant",
      text: "第 " + i + " 条",
    }));
    const messages = buildAgentMessages("系统", turns, "继续");
    expect(messages).toHaveLength(82);
    expect(messages[1].content).toBe("第 0 条");
    expect(messages.at(-2)?.content).toBe("第 79 条");
  });
  it("never starts the history with an assistant message", () => {
    const messages = buildAgentMessages(
      "系统",
      [{ role: "assistant", text: "你好" }],
      "继续",
    );
    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual({ role: "user", content: "继续" });
  });
  it("summarizes applied changes for the system prompt", () => {
    const digest = changesDigest([
      { role: "user", text: "a" },
      { role: "assistant", text: "b", notes: ["换成学术风"] },
      { role: "assistant", text: "c", rejected: true },
    ]);
    expect(digest).toEqual(["换成学术风", "（有一版方案被拒绝，简历未改）"]);
  });
});

describe("agent reply parsing", () => {
  it("reads JSON even when wrapped in a code fence", () => {
    const reply = parseAgentReply(
      '```json\n{"reply":"已收紧行距","actions":[{"type":"lineHeight","value":1.35}]}\n```',
    );
    expect(reply.reply).toBe("已收紧行距");
    expect(reply.actions).toHaveLength(1);
  });
  it("keeps plain text as a reply when the model ignores the JSON contract", () => {
    const reply = parseAgentReply("这个我需要你确认一下");
    expect(reply.reply).toBe("这个我需要你确认一下");
    expect(reply.actions).toHaveLength(0);
  });
});

describe("prompt context", () => {
  it("sends layout numbers and section titles but not body text", () => {
    const text = describeDoc(doc(), 2);
    expect(text).toContain("教育背景");
    expect(text).toContain("页边距");
    expect(text).not.toContain("主修课程");
    expect(AGENT_SYSTEM_PROMPT).toContain("默认只调整「样式与结构」");
  });
  it("includes numbered content only when content mode is on", () => {
    const withContent = describeDoc(doc(), 1, true);
    expect(withContent).toContain("3: ## 教育背景");
    expect(withContent).toContain("主修课程");
    expect(AGENT_CONTENT_PROMPT).toContain("setText");
  });
});
