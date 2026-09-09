import type { FourF, Language } from "./types";

const FIGHT = /frustrat|angry|氣|煩|爛|stupid|useless|hate|受不了/i;
const FLIGHT = /give up|放棄|不想|avoid|can't (do this)|quit|逃/i;
const FREEZE = /overwhelm|stuck|卡住|confus|不知道從哪|lost|太多/i;
const FAWN = /sorry|對不起|抱歉|my fault|我太笨|太笨|blame me/i;

/**
 * Detect the 4F stress response in user text. Checks fight → flight →
 * freeze → fawn in order and returns the first match, else null.
 */
export function detectFourF(text: string): FourF {
  if (FIGHT.test(text)) return "fight";
  if (FLIGHT.test(text)) return "flight";
  if (FREEZE.test(text)) return "freeze";
  if (FAWN.test(text)) return "fawn";
  return null;
}

interface FourFMap {
  fight: string;
  flight: string;
  freeze: string;
  fawn: string;
  null: string;
}

const MESSAGES: Record<Language, FourFMap> = {
  "zh-TW": {
    fight: "我理解你很挫折，我們一起把問題拆小，一步步解決。",
    flight: "別急著放棄，我們先停一下，重新聚焦在最小的一步。",
    freeze: "資訊有點多沒關係，我們從最簡單的一件事開始。",
    fawn: "不用自責，這不是你的錯，我們一起把它修好。",
    null: "好，我們繼續往下走。",
  },
  en: {
    fight: "I understand you're frustrated. Let's break this down and solve it step by step.",
    flight: "Don't give up yet. Let's pause and refocus on the smallest next step.",
    freeze: "That's a lot of information. Let's start with the simplest thing first.",
    fawn: "Don't blame yourself — this isn't your fault. Let's fix it together.",
    null: "Alright, let's keep going.",
  },
};

/** Return a short soothing line for the detected 4F state in the given language. */
export function sootheMessage(f: FourF, lang: Language = "zh-TW"): string {
  const key = f === null ? "null" : f;
  return MESSAGES[lang][key];
}
