// =====================================================================
// 가가오톡 — 순수 규칙 (DOM/네트워크를 모른다)
// Swift 쪽 School.swift / GagaLevel.swift / GameModels.swift 와 값이 같아야 한다.
// node --test 로 검증한다: web/rules.test.mjs
// =====================================================================

// ---------------------------------------------------------------------
// 학교 / 레벨 규칙 — Swift 쪽(School.swift, GagaLevel.swift)과 같아야 한다
// ---------------------------------------------------------------------
export const GRADES = [7, 8, 9, 10, 11, 12, 13];
export const CLASSES = ["A", "B"];
export const HOUSES = [
  { id: "NORO",    ko: "노로",   emoji: "🦌", color: "#F59E0B" },
  { id: "SARAH",   ko: "사라",   emoji: "🌅", color: "#EF4444" },
  { id: "GEOMUN",  ko: "거문",   emoji: "🌋", color: "#6B7280" },
  { id: "MULCHAT", ko: "물찻",   emoji: "💧", color: "#3B82F6" },
  { id: "JEOJI",   ko: "저지",   emoji: "🌲", color: "#10B981" },
];
export const TIERS = [
  { min: 100, name: "시그마가가",  emoji: "🌟", card: "level_100_sigma" },
  { min: 50,  name: "가가마스터",  emoji: "🔥", card: "level_50_grand" },
  { min: 25,  name: "가가썩은물",  emoji: "✨", card: "level_25_rotten" },
  { min: 10,  name: "가가고수",    emoji: "👑", card: "level_10_master" },
  { min: 5,   name: "가가중수",    emoji: "⚔️", card: "level_05_middle" },
  { min: 1,   name: "가가새싹",    emoji: "🌱", card: "level_01_sprout" },
];

/** 레벨 L 에 필요한 누적 xp = 2*(L-1)^2 + 20*(L-1) */
export const xpForLevel = (level) => { const k = Math.max(level, 1) - 1; return 2 * k * k + 20 * k; };

export function levelFromXP(rawXP) {
  const xp = Math.max(rawXP || 0, 0);
  let level = Math.floor((-20 + Math.sqrt(400 + 8 * xp)) / 4) + 1;
  level = Math.min(Math.max(level, 1), 100);
  // 부동소수점 오차 보정 (Swift 쪽도 같은 방식)
  while (level < 100 && xpForLevel(level + 1) <= xp) level++;
  while (level > 1 && xpForLevel(level) > xp) level--;

  const base = xpForLevel(level);
  const next = level >= 100 ? base : xpForLevel(level + 1);
  const tier = TIERS.find((t) => level >= t.min);
  return {
    level, xp, tier,
    into: xp - base,
    need: level >= 100 ? 0 : next - base,
    isMax: level >= 100,
    progress: level >= 100 ? 1 : (xp - base) / (next - base),
    label: level >= 100 ? `Lv.${level} (MAX)` : `Lv.${level} (${xp - base}/${next - base})`,
  };
}

/** 최근 5분 대화로 분위기를 잰다. 서버로 내용을 보내지 않는다. */
export function measureMood(messages) {
  const now = Date.now();
  const recent = messages.filter((m) => now - new Date(m.created_at).getTime() < 300000);
  if (!recent.length) return { emoji: "😴", label: "조용" };
  if (recent.length < 3) return { emoji: "🙂", label: "평온" };

  const speakers = new Set(recent.map((m) => m.sender_id)).size;
  const joined = recent.map((m) => m.body).join("");
  const laughs = (joined.match(/ㅋㅋ|ㅎㅎ|😂|🤣/g) || []).length;
  const shouts = (joined.match(/[!?]/g) || []).length;
  const avgLen = joined.length / recent.length;
  const spanMin = Math.max((now - new Date(recent[0].created_at).getTime()) / 60000, 1);

  let score = 0;
  score += Math.min(recent.length / spanMin / 3, 3);
  score += Math.min(speakers / 2, 2);
  score += Math.min(laughs / 3, 2);
  score += Math.min(shouts / 5, 2);
  if (avgLen < 6) score += 1;

  if (score < 1.5) return { emoji: "🙂", label: "평온" };
  if (score < 3.5) return { emoji: "😄", label: "활발" };
  if (score < 5.5) return { emoji: "😵", label: "혼란" };
  return { emoji: "🔥", label: "폭발" };
}


// ---------------------------------------------------------------------
// 닉네임으로 로그인하기
//
// Supabase Auth 는 이메일이 꼭 필요하다. 그래서 닉네임에서 가짜 이메일을 만들어낸다.
// 닉네임에 한글이 들어가면 이메일 주소에 못 쓰므로 SHA-256 해시를 쓴다.
//
// 도메인 .invalid 는 RFC 2606 이 "절대 실제 도메인이 될 수 없다" 고 예약해둔 것이라
// 실수로 진짜 메일이 나갈 일이 없다.
//
// ★ Swift 쪽 NicknameAccount.swift 와 결과가 완전히 같아야 한다.
//   (다르면 앱에서 만든 계정으로 웹에서 로그인이 안 된다)
// ---------------------------------------------------------------------
export const ACCOUNT_DOMAIN = "gaga5.invalid";

export async function emailForNickname(nickname) {
  const normalized = String(nickname ?? "").trim().toLowerCase();
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  // 맨 앞에 u 를 붙여서 숫자로 시작하지 않게 한다
  return `u${hex.slice(0, 31)}@${ACCOUNT_DOMAIN}`;
}

// ---------------------------------------------------------------------
// 관리자 전용 등급
//
// 경험치를 손으로 넣어서 만렙을 만들면 레벨 시스템이 망가진다.
// 그래서 관리자는 1~100 바깥의 별도 등급으로 "보여주기만" 한다.
// 저장된 xp 는 그대로라, 관리자를 내리면 원래 레벨로 돌아간다.
// ★ Swift 쪽 GagaLevel.forProfile 과 같아야 한다.
// ---------------------------------------------------------------------
export const ADMIN_LEVEL = 1000;

export function levelForProfile(profile) {
  const base = levelFromXP(profile?.xp);
  if (!profile?.is_admin) return base;
  return {
    ...base,
    level: ADMIN_LEVEL,
    tier: TIERS[0],            // 시그마가가
    into: 0, need: 0,
    isMax: true, progress: 1,
    label: `Lv.${ADMIN_LEVEL} (MAX)`,
  };
}
