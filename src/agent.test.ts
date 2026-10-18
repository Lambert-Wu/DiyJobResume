import { describe, expect, it } from "vitest";
import {
  AGENT_SYSTEM_PROMPT,
  applyAgentActions,
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
    expect(AGENT_SYSTEM_PROMPT).toContain("不能改动用户写下的任何文字内容");
  });
});
