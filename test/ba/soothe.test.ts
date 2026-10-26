import { describe, expect, it } from "bun:test";
import { detectFourF, sootheMessage } from "../../src/ba/soothe";
import type { FourF } from "../../src/ba/types";

describe("detectFourF", () => {
  it("S4: detects fight from frustration keywords", () => {
    expect(detectFourF("I am so frustrated with this useless tool")).toBe("fight");
    expect(detectFourF("這東西好爛，我受不了了")).toBe("fight");
  });

  it("S4: detects flight from give-up keywords", () => {
    expect(detectFourF("I give up, I can't do this")).toBe("flight");
    expect(detectFourF("我不想做了，想放棄")).toBe("flight");
  });

  it("S4: detects freeze from overwhelm/stuck keywords", () => {
    expect(detectFourF("I am overwhelmed and stuck")).toBe("freeze");
    expect(detectFourF("我卡住了，不知道從哪開始")).toBe("freeze");
  });

  it("S4: detects fawn from apology keywords", () => {
    expect(detectFourF("sorry, it's my fault")).toBe("fawn");
    expect(detectFourF("對不起，我太笨了")).toBe("fawn");
  });

  it("S4: returns null for neutral text", () => {
    expect(detectFourF("please continue with the next step")).toBeNull();
    expect(detectFourF("請繼續下一步")).toBeNull();
  });
});

describe("sootheMessage", () => {
  it("S5: returns a non-empty string for every FourF and for null", () => {
    const cases: FourF[] = ["fight", "flight", "freeze", "fawn", null];
    for (const f of cases) {
      const msg = sootheMessage(f);
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(0);
    }
  });

  it("S5: returns Traditional Chinese by default", () => {
    expect(sootheMessage("fight")).toContain("挫折");
  });

  it("S5: returns English when lang=en", () => {
    expect(sootheMessage("fight", "en")).toContain("frustrated");
    expect(sootheMessage("freeze", "en")).toContain("simplest");
    expect(sootheMessage(null, "en")).toContain("keep going");
  });

  it("S5: returns a non-empty English line for every FourF", () => {
    const cases: FourF[] = ["fight", "flight", "freeze", "fawn", null];
    for (const f of cases) {
      expect(sootheMessage(f, "en").length).toBeGreaterThan(0);
    }
  });
});
