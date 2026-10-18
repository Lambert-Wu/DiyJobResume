import { describe, expect, it } from "vitest";
import {
  contentToLines,
  looksLikeMarkdown,
  looksLikeResumeBlock,
  textToLines,
} from "./importText";

const RAW = `李景阳
电话：18319206783   ｜   邮箱：1406083391@qq.com
现居：东莞（可就近广州、深圳） ｜语言：粤语（母语）/ 普通话（母语）｜   本科
【个人总结】
· 毕业于东莞理工学院，计算机科学与技术专业，本科学历。
· 有信息化系统部署与运维实战经验：基于 Docker / Linux 完成服务部署。
【项目经历】
► 企业级 AI Agent 平台（OpenClaw + DeepSeek）   项目负责人   2026.05 – 2026.09
· 系统部署与运维：独立完成 Node.js 环境搭建、OpenClaw 框架配置与 Linux 部署。
· 故障排查与对接：解决企业微信 API 权限分层、VPN 网络限制。
【教育背景】
东莞理工学院   计算机科学与技术   本科   2022.09 – 2026.06
· 荣誉：东莞理工学院奖学金三等奖（2023.12）
【证书 / 其他】
· CCT 全国计算机二级（Python 程序设计）
· 机动车驾驶证`;

describe("pasted resume text", () => {
  it("turns the first lines into name and contact", () => {
    const lines = textToLines(RAW);
    expect(lines[0]).toMatchObject({ kind: "name", text: "李景阳" });
    expect(lines[1].kind).toBe("text");
    expect(lines[1].text).toContain("18319206783");
    expect(lines[2].kind).toBe("text");
    expect(lines[2].text).toContain("现居");
  });

  it("recognizes 【section】 headings and bullet markers", () => {
    const lines = textToLines(RAW);
    const sections = lines
      .filter((line) => line.kind === "section")
      .map((line) => line.text);
    expect(sections).toEqual(["个人总结", "项目经历", "教育背景", "证书 / 其他"]);
    const bullets = lines.filter((line) => line.kind === "bullet");
    expect(bullets.length).toBe(7);
    expect(bullets[0].text).toContain("毕业于东莞理工学院");
  });

  it("keeps company, role and dates on one entry line", () => {
    const lines = textToLines(RAW);
    const entries = lines.filter((line) => line.kind === "entry");
    expect(entries[0]).toEqual({
      id: expect.any(String),
      kind: "entry",
      text: "企业级 AI Agent 平台（OpenClaw + DeepSeek） | 项目负责人 | 2026.05 – 2026.09",
    });
    // 四段（学校 / 专业 / 学历 / 时间）合并成三列，避免排版挤成四栏
    expect(entries[1].text).toBe(
      "东莞理工学院 | 计算机科学与技术 本科 | 2022.09 – 2026.06",
    );
  });

  it("does not lose any wording", () => {
    const lines = textToLines(RAW);
    const text = lines.map((line) => line.text).join("\n");
    expect(text).toContain("1406083391@qq.com");
    expect(text).toContain("机动车驾驶证");
    expect(text).toContain("2023.12");
    expect(text).not.toContain("►");
    expect(text).not.toContain("【");
  });

  it("tells a pasted resume apart from a short instruction", () => {
    expect(looksLikeResumeBlock(RAW)).toBe(true);
    expect(looksLikeResumeBlock("把行距调大一点")).toBe(false);
    expect(
      looksLikeResumeBlock("李景阳\n电话：123\n· 一条\n· 两条\n· 三条"),
    ).toBe(true);
  });

  it("tells a pasted resume apart from a short instruction", () => {
    expect(looksLikeResumeBlock(RAW)).toBe(true);
    expect(looksLikeResumeBlock("把行距调大一点")).toBe(false);
    expect(
      looksLikeResumeBlock(
        "李景阳\n电话：123\n· 一条\n· 两条\n· 三条",
      ),
    ).toBe(true);
  });

  it("accepts markdown output as well", () => {
    const markdown = "# 张三\n138 | a@b.com\n## 教育背景\n### 某大学 | 本科 | 2020 – 2024\n- 课程";
    expect(looksLikeMarkdown(markdown)).toBe(true);
    const lines = contentToLines(markdown);
    expect(lines[0]).toMatchObject({ kind: "name", text: "张三" });
    expect(lines[2]).toMatchObject({ kind: "section", text: "教育背景" });
    expect(lines[3].kind).toBe("entry");
    expect(lines[4].kind).toBe("bullet");
  });

  it("treats plain text without headings as body lines", () => {
    expect(looksLikeMarkdown("李景阳\n电话：123")).toBe(false);
    const lines = contentToLines("李景阳\n电话：123");
    expect(lines.map((line) => line.kind)).toEqual(["name", "text"]);
  });

  it("still uses the paste rules when the text has - bullets but no headings", () => {
    const text = "李景阳\n【项目经历】\n- 做了点事\n- 又做了一件事";
    expect(looksLikeMarkdown(text)).toBe(false);
    expect(contentToLines(text).map((line) => line.kind)).toEqual([
      "name",
      "section",
      "bullet",
      "bullet",
    ]);
  });
});
