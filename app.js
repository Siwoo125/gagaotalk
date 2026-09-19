// =====================================================================
// 가가오톡 웹
// iOS 앱과 같은 Supabase 를 쓴다. 규칙(레벨, 능력, 권한)은 전부 DB 에 있으므로
// 여기서는 화면만 그린다. 웹에서 보낸 메시지가 폰 앱에 실시간으로 뜬다.
// =====================================================================
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

import {
  GRADES, CLASSES, HOUSES, TIERS, xpForLevel, levelFromXP, measureMood,
  emailForNickname, levelForProfile, roleBadge, ADMIN_LEVEL, MODERATOR_LEVEL,
} from "./rules.js";

// ---------------------------------------------------------------------
// 도우미
// ---------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

/** 이모지 대신 쓰는 라인 아이콘 */
const svgIcon = (paths, width = 1.7) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" ` +
  `stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

const iconBox = (paths) => {
  const box = document.createElement("div");
  box.className = "icon-box";
  box.innerHTML = svgIcon(paths);
  return box;
};
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};
const esc = (s) => String(s ?? "");
const timeText = (iso) =>
  new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

let toastTimer;
function toast(text) {
  const node = $("toast");
  node.textContent = text;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 2600);
}

/** 서버가 준 한국어 메시지를 그대로 보여준다 */
function errText(error) {
  if (!error) return "알 수 없는 오류";
  const raw = error.message || String(error);
  if (/row-level security/i.test(raw)) return "권한 없음 · 승인된 계정인지 확인하세요";
  if (/Invalid login credentials/i.test(raw)) return "이메일 또는 비밀번호가 맞지 않아요.";
  if (/already registered|User already/i.test(raw)) return "이미 가입된 계정입니다. 로그인하세요.";
  if (/Password should be/i.test(raw)) return "비밀번호는 6자 이상";
  return raw;
}

function show(screen) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $("screen-" + screen).classList.add("active");
}

function houseOf(id) { return HOUSES.find((h) => h.id === id); }

function schoolLine(profile) {
  const parts = [];
  if (profile.grade) parts.push(`${profile.grade}학년${profile.class_letter ? " " + profile.class_letter + "반" : ""}`);
  const house = houseOf(profile.house);
  if (house) parts.push(`${house.emoji} ${house.id}`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------
// 상태
// ---------------------------------------------------------------------
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});


const state = {
  me: null,
  tab: "rooms",
  rooms: [],
  room: null,        // 지금 보고 있는 방
  messages: [],
  nicknames: {},
  channel: null,
  signup: { house: "NORO" },
};

// =====================================================================
// 부팅
// =====================================================================
async function boot() {
  if (!SUPABASE_URL || SUPABASE_URL.includes("여기에")) { show("setup"); return; }
  show("loading");
  const { data } = await sb.auth.getSession();
  if (!data.session) { show("signin"); return; }
  await loadMe();
}

async function loadMe() {
  show("loading");
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { show("signin"); return; }

  const { data, error } = await sb
    .from("profiles").select("*").eq("id", user.id).maybeSingle();

  if (error) { toast(errText(error)); show("signin"); return; }
  if (!data) { show("signup"); return; }   // 계정만 있고 가입 신청 전

  state.me = data;
  if (data.status === "approved") {
    $("tab-admin").hidden = !(data.is_admin || data.is_moderator);
    show("main");
    openTab(state.tab);
  } else if (data.status === "pending") {
    $("pending-name").textContent = `${data.nickname}  ${schoolLine(data)}`;
    show("pending");
  } else {
    $("blocked-title").textContent =
      data.status === "banned" ? "퇴장 처리됨" : "가입 거절됨";
    show("blocked");
  }
}

// =====================================================================
// 로그인 / 가입
// =====================================================================
function fillSignupForm() {
  const grade = $("up-grade");
  grade.innerHTML = "";
  GRADES.forEach((g) => grade.append(new Option(`${g}학년`, g)));

  const klass = $("up-class");
  klass.innerHTML = "";
  CLASSES.forEach((c) => klass.append(new Option(`${c}반`, c)));

  const houses = $("up-houses");
  houses.innerHTML = "";
  HOUSES.forEach((h) => {
    const b = el("button");
    b.type = "button";
    b.style.setProperty("--house", h.color);
    b.append(el("span", "house-name", h.id));
    b.onclick = () => {
      state.signup.house = h.id;
      houses.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
    };
    if (h.id === state.signup.house) b.classList.add("on");
    houses.append(b);
  });
}

$("btn-go-signup").onclick = () => { fillSignupForm(); show("signup"); };
$("btn-back-signin").onclick = () => show("signin");
$("btn-signout-pending").onclick = signOut;
$("btn-signout-blocked").onclick = signOut;
$("btn-recheck").onclick = loadMe;

$("btn-signin").onclick = async () => {
  const nickname = $("in-nickname").value.trim();
  const password = $("in-password").value;
  if (!nickname || !password) return toast("닉네임과 비밀번호를 입력하세요");

  $("btn-signin").disabled = true;
  // 닉네임에서 계정 이메일을 만들어낸다 (Swift 쪽과 같은 규칙)
  const email = await emailForNickname(nickname);
  const { error } = await sb.auth.signInWithPassword({ email, password });
  $("btn-signin").disabled = false;
  if (error) return toast("닉네임 또는 비밀번호가 다릅니다");
  await loadMe();
};

$("btn-signup").onclick = async () => {
  const password = $("up-password").value;
  const nickname = $("up-nickname").value.trim();
  const code = $("up-code").value.trim().toUpperCase();
  const grade = Number($("up-grade").value);
  const klass = $("up-class").value;
  const house = state.signup.house;

  // 서버에 가기 전에 먼저 거른다
  if (password.length < 6) return toast("비밀번호는 6자 이상");
  if (nickname.length < 2 || nickname.length > 12) return toast("닉네임은 2~12자");
  if (code.length < 4) return toast("초대 코드를 확인하세요");

  $("btn-signup").disabled = true;
  try {
    const email = await emailForNickname(nickname);
    let { error } = await sb.auth.signUp({ email, password });
    if (error && /already registered|User already/i.test(error.message)) {
      // 같은 닉네임 계정이 이미 있다. 비밀번호가 맞으면 이어서 신청한다.
      const retry = await sb.auth.signInWithPassword({ email, password });
      if (retry.error) throw new Error("이미 사용 중인 닉네임이거나 비밀번호가 다릅니다");
    } else if (error) {
      throw error;
    }

    const { error: rpcError } = await sb.rpc("register_member", {
      p_nickname: nickname, p_grade: grade, p_class: klass,
      p_house: house, p_code: code,
    });
    if (rpcError) throw rpcError;
    await loadMe();
  } catch (e) {
    toast(errText(e));
  } finally {
    $("btn-signup").disabled = false;
  }
};

async function signOut() {
  await leaveChannel();
  await sb.auth.signOut();
  state.me = null;
  show("signin");
}

// =====================================================================
// 탭
// =====================================================================
document.querySelectorAll("#tabbar button").forEach((b) => {
  b.onclick = () => openTab(b.dataset.tab);
});

const TAB_TITLES = { rooms: "톡", friends: "친구", gaga: "가가", admin: "관리", me: "내 정보" };

async function openTab(tab) {
  state.tab = tab;
  $("tab-title").textContent = TAB_TITLES[tab];
  document.querySelectorAll("#tabbar button")
    .forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  $("header-actions").innerHTML = "";
  $("tab-body").innerHTML = '<div class="empty"><div class="spinner"></div></div>';

  try {
    if (tab === "rooms") await renderRooms();
    else if (tab === "friends") await renderFriends();
    else if (tab === "gaga") await renderGaga();
    else if (tab === "admin") await renderAdmin();
    else await renderMe();
  } catch (e) {
    $("tab-body").innerHTML = "";
    $("tab-body").append(el("div", "empty", errText(e)));
  }
}

export { boot };

// =====================================================================
// 톡 — 방 목록
// =====================================================================
async function renderRooms() {
  const { data, error } = await sb.rpc("my_rooms");
  if (error) throw error;
  state.rooms = data || [];

  const plus = el("button", "icon", "✏️");
  plus.onclick = openCreateRoom;
  $("header-actions").append(plus);

  const body = $("tab-body");
  body.innerHTML = "";
  const wrap = el("div", "list");

  const groups = [["global", "전체"], ["topic", "주제방"], ["dm", "1:1"]];
  for (const [kind, title] of groups) {
    const rooms = state.rooms.filter((r) => r.kind === kind);
    if (!rooms.length) continue;
    wrap.append(el("div", "section-title", title));
    rooms.forEach((room) => wrap.append(roomRow(room)));
  }
  if (!state.rooms.length) wrap.append(el("div", "empty", "방 없음"));
  body.append(wrap);
}

function roomRow(room) {
  const b = el("button", "rowitem");
  const icon = el("div", "icon-box");
  if (room.kind === "dm") {
    icon.textContent = (room.name || "?").slice(0, 1);
  } else {
    icon.innerHTML = room.kind === "global"
      ? svgIcon('<path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6"/>')
      : svgIcon('<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-4-.9L3 21l2-4a8.4 8.4 0 0 1-1-4.5 8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 8 7.4z"/>');
  }

  const grow = el("div", "grow");
  const title = el("div", "title");
  title.append(el("span", null, room.name || "이름 없는 방"));
  if (room.kind !== "dm") title.append(el("span", "chip gray", String(room.member_count)));
  if (!room.is_member) title.append(el("span", "chip", "새 방"));

  const preview = room.last_message_body
    ? (room.kind === "dm" ? room.last_message_body
       : `${room.last_message_sender ?? ""}: ${room.last_message_body}`)
    : (room.kind === "dm" ? "대화 없음" : "메시지 없음");
  grow.append(title, el("div", "sub", preview.replace(/\n/g, " ")));

  const right = el("div", "right");
  if (room.last_message_at) right.append(el("div", "sub", timeText(room.last_message_at)));
  if (room.unread_count > 0) {
    right.append(el("span", "badge", room.unread_count > 99 ? "99+" : String(room.unread_count)));
  }

  b.append(icon, grow, right);
  b.onclick = () => openChat(room);
  return b;
}

function openCreateRoom() {
  openSheet("방 만들기", (box) => {
    const name = el("input");
    name.placeholder = "방 이름 (30자까지)";
    const desc = el("input");
    desc.placeholder = "설명 (선택)";
    const go = el("button", "primary", "만들기");
    go.onclick = async () => {
      const trimmed = name.value.trim();
      if (!trimmed) return toast("방 이름을 입력하세요");
      go.disabled = true;
      const { error } = await sb.from("rooms").insert({
        kind: "topic", name: trimmed,
        description: desc.value.trim() || null,
        created_by: state.me.id,
      });
      go.disabled = false;
      if (error) return toast(errText(error));
      closeSheet();
      openTab("rooms");
    };
    box.append(name, desc, go);
  });
}

// =====================================================================
// 채팅
// =====================================================================
async function openChat(room) {
  state.room = room;
  state.messages = [];
  $("chat-name").textContent = room.name || "이름 없는 방";
  $("chat-list").innerHTML = "";
  $("chat-banner").hidden = true;
  show("chat");

  // 방 멤버 이름표 (말풍선에 이름을 붙이려면 필요)
  const { data: members } = await sb
    .from("room_members").select("user_id").eq("room_id", room.id);
  if (members?.length) {
    const { data: profiles } = await sb
      .from("profiles").select("id,nickname").in("id", members.map((m) => m.user_id));
    state.nicknames = Object.fromEntries((profiles || []).map((p) => [p.id, p.nickname]));
  }

  const { data, error } = await sb
    .from("messages").select("*")
    .eq("room_id", room.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) { toast(errText(error)); return; }

  state.messages = (data || []).reverse();
  drawMessages();
  sb.rpc("mark_room_read", { p_room_id: room.id });
  subscribeRoom(room.id);
}

function drawMessages() {
  const list = $("chat-list");
  list.innerHTML = "";
  state.messages.forEach((m, i) => list.append(messageRow(m, state.messages[i - 1])));
  updateMood();
  requestAnimationFrame(() => {
    const scroll = $("chat-scroll");
    scroll.scrollTop = scroll.scrollHeight;
  });
}

function messageRow(message, previous) {
  const mine = message.sender_id === state.me.id;
  const nickname = state.nicknames[message.sender_id] || "알 수 없음";
  // 같은 사람이 5분 안에 연달아 보내면 이름/아바타를 한 번만
  const showHeader = !previous
    || previous.sender_id !== message.sender_id
    || new Date(message.created_at) - new Date(previous.created_at) > 300000;

  const row = el("div", "msg" + (mine ? " mine" : "") + (message._state ? " " + message._state : ""));
  const avatar = el("div", "av" + (showHeader ? "" : " hidden"), nickname.slice(0, 1));
  if (!mine) row.append(avatar);

  const col = el("div", "col");
  if (!mine && showHeader) col.append(el("div", "who", nickname));
  col.append(el("div", "bubble", message.body));

  const meta = el("div", "meta",
    message._state === "sending" ? ""
    : message._state === "failed" ? "전송 실패 · 눌러서 재시도"
    : timeText(message.created_at));
  col.append(meta);
  row.append(col);

  if (message._state === "failed") {
    row.onclick = () => {
      state.messages = state.messages.filter((m) => m.id !== message.id);
      $("chat-input").value = message.body;
      drawMessages();
    };
  }
  return row;
}

function updateMood() {
  const mood = measureMood(state.messages);
  $("chat-mood").textContent = mood.emoji;
  $("chat-mood").title = mood.label;
}

// --- 실시간 -----------------------------------------------------------
async function leaveChannel() {
  if (state.channel) { await sb.removeChannel(state.channel); state.channel = null; }
}

async function subscribeRoom(roomId) {
  await leaveChannel();
  state.channel = sb
    .channel(`room:${roomId}`)
    .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` },
        (payload) => {
          const message = payload.new;
          if (state.messages.some((m) => m.id === message.id)) return;
          // 내가 방금 낙관적으로 띄운 것이면 그걸 치운다
          const temp = state.messages.find(
            (m) => m._state === "sending" && m.body === message.body && m.sender_id === message.sender_id);
          if (temp) state.messages = state.messages.filter((m) => m !== temp);
          state.messages.push(message);
          state.messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
          drawMessages();
          sb.rpc("mark_room_read", { p_room_id: roomId });
        })
    .on("postgres_changes",
        { event: "DELETE", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` },
        (payload) => {
          state.messages = state.messages.filter((m) => m.id !== payload.old.id);
          drawMessages();
        })
    .subscribe((status) => {
      const banner = $("chat-banner");
      if (status === "SUBSCRIBED") {
        banner.hidden = true;
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        banner.hidden = false;
        banner.textContent = "연결 끊김 · 재연결 중";
      }
    });
}

$("btn-chat-back").onclick = async () => {
  await leaveChannel();
  state.room = null;
  show("main");
  openTab("rooms");
};

$("chat-form").onsubmit = async (event) => {
  event.preventDefault();
  const input = $("chat-input");
  const body = input.value.trim();
  if (!body || !state.room) return;
  input.value = "";

  // 먼저 화면에 띄운다. 서버를 기다리면 답답하다.
  const temp = {
    id: "temp-" + Date.now(), room_id: state.room.id, sender_id: state.me.id,
    body, created_at: new Date().toISOString(), _state: "sending",
  };
  state.messages.push(temp);
  drawMessages();

  const { data, error } = await sb.from("messages")
    .insert({ room_id: state.room.id, sender_id: state.me.id, body })
    .select().single();

  const index = state.messages.findIndex((m) => m.id === temp.id);
  if (index < 0) return;                       // 실시간이 먼저 도착했다
  if (error) {
    state.messages[index]._state = "failed";
    toast(errText(error));
  } else if (state.messages.some((m) => m.id === data.id)) {
    state.messages.splice(index, 1);
  } else {
    state.messages[index] = data;
  }
  drawMessages();
};

$("btn-roulette").onclick = async () => {
  const { data, error } = await sb.rpc("random_roulette_line");
  if (error) return toast(errText(error));
  $("chat-input").value = data || "";
  $("chat-input").focus();
};

// =====================================================================
// 채팅방 도구 — 분위기 / 가위바위보 / 금지어 / 몰래 채팅
// =====================================================================
$("btn-chat-tools").onclick = async () => {
  const roomId = state.room?.id;
  if (!roomId) return;

  const [words, board, games] = await Promise.all([
    sb.from("room_banned_words").select("word").eq("room_id", roomId),
    sb.rpc("penalty_board", { p_room_id: roomId }),
    sb.rpc("room_game_list", { p_room_id: roomId, p_limit: 10 }),
  ]);

  openSheet("채팅방 도구", (box) => {
    // --- 분위기 ---
    const mood = measureMood(state.messages);
    const moodCard = el("div", "card");
    moodCard.append(
      el("div", null, `${mood.emoji}  지금 분위기: ${mood.label}`),
      el("div", "muted small", "대화 내용은 서버로 전송되지 않습니다"),
    );
    box.append(moodCard);

    // --- 가위바위보 ---
    box.append(el("div", "section-title", "가위바위보"));
    const moves = el("div", "btn-row");
    [["rock", "✊"], ["paper", "🖐️"], ["scissors", "✌️"]].forEach(([move, emoji]) => {
      const b = el("button", null, emoji);
      b.onclick = async () => {
        const { error } = await sb.rpc("start_rps", { p_room_id: roomId, p_move: move });
        toast(error ? errText(error) : "도전장을 냈어요!");
        if (!error) closeSheet();
      };
      moves.append(b);
    });
    box.append(moves);

    (games.data || []).forEach((game) => {
      const card = el("div", "card");
      const open = !game.resolved_at;
      card.append(el("div", null,
        open ? `${game.challenger_nickname} 도전 중`
             : `${game.challenger_nickname} vs ${game.opponent_nickname} — ${
                 game.result === "draw" ? "비김"
                 : game.result === "challenger" ? game.challenger_nickname + " 승"
                 : game.opponent_nickname + " 승"}`));
      if (!open && game.challenger_move) {
        const emo = { rock: "✊", paper: "🖐️", scissors: "✌️" };
        card.append(el("div", null, `${emo[game.challenger_move]} vs ${emo[game.opponent_move]}`));
      }
      if (open && game.challenger_id !== state.me.id) {
        const answer = el("div", "btn-row");
        [["rock", "✊"], ["paper", "🖐️"], ["scissors", "✌️"]].forEach(([move, emoji]) => {
          const b = el("button", null, emoji);
          b.onclick = async () => {
            const { data, error } = await sb.rpc("answer_rps", { p_game_id: game.id, p_move: move });
            if (error) return toast(errText(error));
            const row = data?.[0];
            toast(row?.result === "draw" ? "무승부"
                  : row?.result === "opponent" ? "승리" : "패배");
            closeSheet();
          };
          answer.append(b);
        });
        card.append(answer);
      }
      box.append(card);
    });

    // --- 금지어 ---
    box.append(el("div", "section-title", "금지어 게임"));
    const wordInput = el("input");
    wordInput.placeholder = "금지어 추가";
    const addWord = el("button", "primary", "추가");
    addWord.onclick = async () => {
      const word = wordInput.value.trim();
      if (!word) return;
      const { error } = await sb.from("room_banned_words")
        .insert({ room_id: roomId, word, created_by: state.me.id });
      if (error) return toast(errText(error));
      toast("추가됨");
      closeSheet();
    };
    box.append(wordInput, addWord);

    (words.data || []).forEach((row) => {
      const item = el("div", "rowitem");
      item.append(el("div", "grow", row.word));
      const del = el("button", "link", "삭제");
      del.onclick = async () => {
        await sb.from("room_banned_words").delete()
          .eq("room_id", roomId).eq("word", row.word);
        toast("삭제됨"); closeSheet();
      };
      item.append(del);
      box.append(item);
    });

    if (board.data?.length) {
      box.append(el("div", "section-title", "벌점판"));
      board.data.forEach((row) => {
        const item = el("div", "rowitem");
        item.append(el("div", "grow", row.nickname),
                    el("span", "badge", `${row.penalty_count}점`));
        box.append(item);
      });
    }

    // --- 몰래 채팅 ---
    box.append(el("div", "section-title", "몰래 채팅"));
    const picker = el("select");
    [["끄기", 0], ["5초", 5], ["1분", 60], ["10분", 600], ["1시간", 3600], ["하루", 86400]]
      .forEach(([label, seconds]) => picker.append(new Option(label, seconds)));
    picker.onchange = async () => {
      const seconds = Number(picker.value);
      const { error } = await sb.rpc("set_room_disappearing", {
        p_room_id: roomId, p_seconds: seconds === 0 ? null : seconds,
      });
      toast(error ? errText(error) : (seconds === 0 ? "자동 삭제 해제" : "자동 삭제 설정됨"));
    };
    box.append(picker);
  });
};

// =====================================================================
// 친구
// =====================================================================
async function renderFriends() {
  const [dir, queue, unanswered, birthdays, stats] = await Promise.all([
    sb.from("profiles").select("*").eq("status", "approved").order("nickname"),
    sb.rpc("reply_queue"),
    sb.rpc("unanswered_dms"),
    sb.rpc("upcoming_birthdays", { p_days: 30 }),
    sb.rpc("friend_stats"),
  ]);

  const body = $("tab-body");
  body.innerHTML = "";
  const wrap = el("div", "list");

  if (queue.data?.length) {
    wrap.append(el("div", "section-title", `답장 대기 ${queue.data.length}`));
    queue.data.forEach((item) => {
      const row = el("button", "rowitem");
      const hours = Math.floor(item.hours_waiting);
      row.append(
        iconBox('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
        (() => { const g = el("div", "grow");
                 g.append(el("div", "title", item.nickname),
                          el("div", "sub", item.last_message || "")); return g; })(),
        el("div", "right",
           hours < 1 ? "방금" : hours < 24 ? `${hours}시간` : `${Math.floor(hours / 24)}일`),
      );
      row.onclick = () => openDMRoom(item.room_id, item.nickname);
      wrap.append(row);
    });
  }

  if (unanswered.data?.length) {
    wrap.append(el("div", "section-title", "읽씹"));
    unanswered.data.forEach((item) => {
      const hours = Math.floor(item.hours_waiting);
      const row = el("button", "rowitem");
      row.append(iconBox('<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>'),
        (() => { const g = el("div", "grow");
                 g.append(el("div", "title", item.nickname),
                          el("div", "sub", hours < 1 ? "방금 읽음 · 답장 없음"
                            : `읽음 · ${hours < 24 ? hours + "시간" : Math.floor(hours/24) + "일"}째 답장 없음`));
                 return g; })());
      row.onclick = () => openDMRoom(item.room_id, item.nickname);
      wrap.append(row);
    });
  }

  if (birthdays.data?.length) {
    wrap.append(el("div", "section-title", "생일"));
    birthdays.data.forEach((b) => {
      const row = el("div", "rowitem");
      row.append(iconBox('<path d="M4 20h16v-8H4zM6 12V9a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3M12 7V4"/>'),
        el("div", "grow", b.nickname),
        el("div", "right", b.is_today ? "오늘!" : b.days_until === 1 ? "내일" : `${b.days_until}일 남음`));
      wrap.append(row);
    });
  }

  const best = (stats.data || []).filter((s) => s.week_count > 0)
    .sort((a, b) => b.week_count - a.week_count)[0];
  if (best) {
    wrap.append(el("div", "section-title", "이번 주 베프"));
    const card = el("div", "card");
    card.append(el("div", "strong", best.nickname),
                el("div", "muted small", `이번 주 ${best.week_count}회 대화`));
    wrap.append(card);
  }

  if (stats.data?.length) {
    wrap.append(el("div", "section-title", "친밀도"));
    stats.data.forEach((s) => {
      const card = el("div", "card");
      const head = el("div", "title");
      head.append(el("span", null, s.nickname), el("span", "chip", s.closeness_title));
      const bar = el("div", "bar");
      const fill = el("i");
      fill.style.width = `${Math.min(s.closeness_level / 10, 1) * 100}%`;
      bar.append(fill);
      card.append(head, bar,
        el("div", "muted small",
           s.days_together > 0 ? `함께한 지 ${s.days_together}일째` : "오늘 처음 대화했어요"));
      wrap.append(card);
    });
  }

  const others = (dir.data || []).filter((p) => p.id !== state.me.id);
  wrap.append(el("div", "section-title", `우리 학교 친구 ${others.length}`));
  if (!others.length) wrap.append(el("div", "empty", "목록이 비어 있음"));
  others.forEach((person) => {
    const level = levelForProfile(person);
    const row = el("button", "rowitem");
    const title = el("div", "title");
    title.append(el("span", null, person.nickname));
    if (person.show_level_badge) title.append(el("span", "chip", `Lv.${level.level}`));
    const house = houseOf(person.house);
    if (house) {
      const chip = el("span", "chip gray", `${house.emoji} ${house.id}`);
      chip.style.color = house.color;
      title.append(chip);
    }
    const grow = el("div", "grow");
    grow.append(title, el("div", "sub", person.bio || schoolLine(person) || " "));
    row.append(el("div", "icon-box", person.nickname.slice(0, 1)), grow, el("div", "right", "💬"));
    row.onclick = async () => {
      await sb.rpc("record_profile_visit", { p_profile_id: person.id });
      const { data, error } = await sb.rpc("get_or_create_dm", { p_other: person.id });
      if (error) return toast(errText(error));
      openDMRoom(data, person.nickname);
    };
    wrap.append(row);
  });

  body.append(wrap);
}

function openDMRoom(roomId, nickname) {
  openChat({ id: roomId, kind: "dm", name: nickname, is_member: true });
}

// =====================================================================
// 가가 — 레벨 / 뽑기 / 아이템 / 능력
// =====================================================================
async function renderGaga() {
  const [inventory, perks, fresh] = await Promise.all([
    sb.from("inventory").select("item_id,count").eq("user_id", state.me.id),
    sb.rpc("my_perks"),
    sb.from("profiles").select("*").eq("id", state.me.id).single(),
  ]);
  if (fresh.data) state.me = fresh.data;

  let items = [];
  if (inventory.data?.length) {
    const { data } = await sb.from("items").select("*")
      .in("id", inventory.data.map((r) => r.item_id));
    const counts = Object.fromEntries(inventory.data.map((r) => [r.item_id, r.count]));
    const order = { legendary: 3, epic: 2, rare: 1, common: 0 };
    items = (data || []).map((item) => ({ ...item, count: counts[item.id] || 1 }))
      .sort((a, b) => order[b.rarity] - order[a.rarity]);
  }

  const level = levelForProfile(state.me);
  const body = $("tab-body");
  body.innerHTML = "";
  const wrap = el("div", "list");

  // --- 레벨 카드 ---
  const card = el("div", "card level-card");
  const img = el("img");
  img.src = `cards/${level.tier.card}.png`;
  img.alt = level.tier.name;
  img.onerror = () => { img.replaceWith(el("div", "empty", level.tier.emoji)); };
  const cardBody = el("div", "body");
  const head = el("div", "title");
  head.append(el("span", null, `${level.tier.emoji} ${level.tier.name}`),
              el("span", "chip", level.label));
  const bar = el("div", "bar");
  const fill = el("i");
  fill.style.width = `${level.progress * 100}%`;
  bar.append(fill);
  cardBody.append(head, bar);
  card.append(img, cardBody);
  wrap.append(card);

  // --- 뽑기 ---
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const drewToday = state.me.last_draw_on === today;

  const gacha = el("div", "card");
  const gachaHead = el("div", "title");
  gachaHead.append(el("span", null, "가가 뽑기"));
  if (state.me.draw_streak > 1) gachaHead.append(el("span", "chip", `${state.me.draw_streak}일 연속`));
  const drawBtn = el("button", "primary", drewToday ? "내일 다시" : "뽑기");
  drawBtn.disabled = drewToday;
  drawBtn.onclick = async () => {
    drawBtn.disabled = true;
    const { data, error } = await sb.rpc("draw_gacha");
    if (error) { drawBtn.disabled = false; return toast(errText(error)); }
    const result = data?.[0];
    if (result) showGachaResult(result);
    openTab("gaga");
  };
  gacha.append(gachaHead,
    el("div", "muted small", drewToday ? "내일 다시 가능" : "하루 한 번"),
    drawBtn);
  wrap.append(gacha);

  // --- 인벤토리 ---
  if (items.length) {
    wrap.append(el("div", "section-title", `내 아이템 ${items.length}`));
    const grid = el("div", "grid4");
    items.forEach((item) => {
      const equipped = [state.me.equipped_character, state.me.equipped_frame, state.me.equipped_bubble]
        .includes(item.id);
      const cell = el("button", "item" + (equipped ? " on" : ""));
      cell.append(el("b", null, item.emoji), el("span", null, item.name));
      if (item.count > 1) cell.append(el("span", "muted", `×${item.count}`));
      if (level.level < item.required_level) cell.append(el("span", "lock", `🔒${item.required_level}`));
      cell.onclick = async () => {
        if (item.kind === "sticker") return toast("스티커는 채팅방에서 사용");
        const { error } = await sb.rpc("equip_item", { p_item_id: item.id });
        if (error) return toast(errText(error));
        toast(`${item.name} 장착`);
        openTab("gaga");
      };
      grid.append(cell);
    });
    wrap.append(grid);
  }

  // --- 능력 ---
  const unlocked = (perks.data || []).filter((p) => p.unlocked).length;
  wrap.append(el("div", "section-title", `능력 ${unlocked}/${(perks.data || []).length}`));
  const byLevel = {};
  (perks.data || []).forEach((p) => { (byLevel[p.required_level] ||= []).push(p); });
  Object.keys(byLevel).map(Number).sort((a, b) => a - b).forEach((lv) => {
    const tier = TIERS.find((t) => lv >= t.min);
    const group = el("div", "card");
    group.append(el("div", "muted small", `Lv.${lv}  ${tier ? tier.name : ""}`));
    byLevel[lv].sort((a, b) => a.sort_order - b.sort_order).forEach((p) => {
      const row = el("div", "rowitem");
      row.style.background = "transparent";
      row.style.padding = "4px 0";
      row.style.margin = "0";
      row.append(el("div", null, p.emoji),
                 el("div", "grow", p.label),
                 el("div", null, p.unlocked ? "✅" : "🔒"));
      if (!p.unlocked) row.style.opacity = ".5";
      group.append(row);
    });
    wrap.append(group);
  });

  body.append(wrap);
}

function showGachaResult(result) {
  openSheet(null, (box) => {
    const colors = { common: "#9CA3AF", rare: "#60A5FA", epic: "#A78BFA", legendary: "#FBBF24" };
    const names = { common: "일반", rare: "레어", epic: "에픽", legendary: "전설" };
    const center = el("div", "center");
    const emoji = el("div", "big-emoji", result.emoji);
    emoji.style.fontSize = "80px";
    const rarity = el("div", "strong", names[result.rarity] || result.rarity);
    rarity.style.color = colors[result.rarity];
    center.append(emoji, el("h2", null, result.name), rarity,
      el("p", "muted", result.is_new ? "NEW" : "중복"));
    if (result.draw_streak > 1) {
      center.append(el("p", "small", `${result.draw_streak}일 연속`));
    }
    const ok = el("button", "primary", "확인");
    ok.onclick = closeSheet;
    center.append(ok);
    box.append(center);
  });
}

// =====================================================================
// 관리자
// =====================================================================
async function renderAdmin() {
  const [pending, all, codes] = await Promise.all([
    sb.from("profiles").select("*").eq("status", "pending").order("created_at"),
    sb.from("profiles").select("*").order("nickname"),
    sb.from("invite_codes").select("*").order("created_at", { ascending: false }),
  ]);

  const body = $("tab-body");
  body.innerHTML = "";
  const wrap = el("div", "list");

  wrap.append(el("div", "section-title", `승인 대기 ${pending.data?.length || 0}`));
  if (!pending.data?.length) wrap.append(el("div", "empty", "없음"));
  (pending.data || []).forEach((person) => {
    const card = el("div", "card");
    card.append(el("div", "title", person.nickname),
                el("div", "muted small", schoolLine(person)));
    const actions = el("div", "btn-row");
    const ok = el("button", "ok", "승인");
    ok.onclick = async () => {
      const { error } = await sb.rpc("approve_member", { p_user_id: person.id });
      toast(error ? errText(error) : `${person.nickname} 승인됨`);
      openTab("admin");
    };
    const no = el("button", "no", "거절");
    no.onclick = async () => {
      const { error } = await sb.rpc("reject_member", { p_user_id: person.id });
      toast(error ? errText(error) : "거절됨");
      openTab("admin");
    };
    actions.append(ok, no);
    card.append(actions);
    wrap.append(card);
  });

  wrap.append(el("div", "section-title", "초대 코드"));
  const newCode = el("button", "primary", "새 코드 만들기");
  newCode.onclick = () => {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let tail = "";
    for (let i = 0; i < 6; i++) tail += alphabet[Math.floor(Math.random() * alphabet.length)];
    openSheet("초대 코드 발급", (box) => {
      const codeInput = el("input");
      codeInput.value = `GAGA5-${tail}`;
      const label = el("input");
      label.placeholder = "메모 (예: 9학년 A반)";
      const uses = el("input");
      uses.type = "number"; uses.value = "30";
      const go = el("button", "primary", "만들기");
      go.onclick = async () => {
        const { error } = await sb.rpc("create_invite_code", {
          p_code: codeInput.value.trim().toUpperCase(),
          p_label: label.value.trim() || null,
          p_max_uses: Number(uses.value) || 30,
          p_expires_at: null,
        });
        if (error) return toast(errText(error));
        closeSheet(); openTab("admin");
      };
      box.append(codeInput, label, uses, go);
    });
  };
  wrap.append(newCode);

  (codes.data || []).forEach((code) => {
    const card = el("div", "card");
    const head = el("div", "title");
    head.append(el("span", null, code.code));
    head.append(el("span", "chip" + (code.active ? "" : " gray"),
                    code.active ? `${Math.max(code.max_uses - code.used_count, 0)}명 더` : "중지"));
    card.append(head);
    if (code.label) card.append(el("div", "muted small", code.label));
    const copy = el("button", "link", "코드 복사");
    copy.onclick = () => { navigator.clipboard?.writeText(code.code); toast("복사됨"); };
    card.append(copy);
    wrap.append(card);
  });

  if (!state.me.is_admin) {
    // 운영진은 멤버 관리(강퇴/권한)를 할 수 없다. 서버가 막지만 버튼도 안 보인다.
    body.append(wrap);
    return;
  }

  wrap.append(el("div", "section-title", `전체 멤버 ${all.data?.length || 0}`));
  const STATUS_LABEL = { approved: "입장", pending: "대기", banned: "퇴장", rejected: "거절" };

  (all.data || []).forEach((person) => {
    const card = el("div", "card");
    const title = el("div", "title");
    title.append(el("span", null, person.nickname));
    const badge = roleBadge(person);
    if (badge) title.append(el("span", "chip", badge));
    if (person.status === "banned") title.append(el("span", "chip gray", "퇴장됨"));
    card.append(title, el("div", "muted small",
      `${STATUS_LABEL[person.status] || person.status}  ·  ${schoolLine(person) || "-"}  ·  Lv.${levelForProfile(person).level}`));

    const me = person.id === state.me.id;
    const actions = el("div", "btn-row");

    if (person.status === "banned") {
      const back = el("button", "ok", "복구");
      back.onclick = () => runBan(person, false);
      actions.append(back);
    } else if (person.status === "approved" && !me) {
      const ban = el("button", "no", "강제 퇴장");
      ban.onclick = () => {
        // 되돌릴 수 있지만 상대가 바로 쫓겨나므로 한 번 확인한다
        if (!confirm(`${person.nickname} 퇴장 처리할까요? 나중에 복구할 수 있습니다.`)) return;
        runBan(person, true);
      };
      actions.append(ban);
    }

    if (person.status === "approved" && !me) {
      const toggle = el("button", null, person.is_admin ? "관리자 해제" : "관리자로");
      toggle.onclick = async () => {
        const { error } = await sb.rpc("set_admin", {
          p_user_id: person.id, p_is_admin: !person.is_admin,
        });
        toast(error ? errText(error) : "바꿨어요");
        if (!error) openTab("admin");
      };
      actions.append(toggle);
    }

    if (actions.children.length) card.append(actions);
    wrap.append(card);
  });

  async function runBan(person, banned) {
    const { error } = await sb.rpc("set_ban", { p_user_id: person.id, p_banned: banned });
    toast(error ? errText(error)
                : banned ? `${person.nickname} 퇴장 처리됨`
                         : `${person.nickname} 복구됨`);
    if (!error) openTab("admin");
  }

  body.append(wrap);
}

// =====================================================================
// 내 정보
// =====================================================================
async function renderMe() {
  const [interests, mine, visitors] = await Promise.all([
    sb.from("interests").select("*").order("category"),
    sb.from("profile_interests").select("interest_id").eq("user_id", state.me.id),
    sb.rpc("my_visitors", { p_limit: 20 }),
  ]);
  const chosen = new Set((mine.data || []).map((r) => r.interest_id));

  const body = $("tab-body");
  body.innerHTML = "";
  const wrap = el("div", "list");
  const level = levelForProfile(state.me);

  const card = el("div", "card");
  const meTitle = el("div", "title");
  meTitle.append(el("span", null, state.me.nickname));
  const myBadge = roleBadge(state.me);
  if (myBadge) meTitle.append(el("span", "chip", myBadge));
  card.append(meTitle,
              el("div", "muted small", schoolLine(state.me)),
              el("div", "muted small", `${level.tier.emoji} ${level.tier.name}  ${level.label}`));
  wrap.append(card);

  // --- 학교 정보 ---
  wrap.append(el("div", "section-title", "학교"));
  const school = el("div", "card");
  const gradeSel = el("select");
  GRADES.forEach((g) => gradeSel.append(new Option(`${g}학년`, g)));
  gradeSel.value = state.me.grade || 7;
  const classSel = el("select");
  CLASSES.forEach((c) => classSel.append(new Option(`${c}반`, c)));
  classSel.value = state.me.class_letter || "A";
  const houseSel = el("select");
  HOUSES.forEach((h) => houseSel.append(new Option(h.id, h.id)));
  houseSel.value = state.me.house || "NORO";

  const saveSchool = async () => {
    const { error } = await sb.from("profiles").update({
      grade: Number(gradeSel.value),
      class_letter: classSel.value,
      house: houseSel.value,
    }).eq("id", state.me.id);
    if (error) return toast(errText(error));
    state.me.grade = Number(gradeSel.value);
    state.me.class_letter = classSel.value;
    state.me.house = houseSel.value;
    toast("저장됨");
  };
  [gradeSel, classSel, houseSel].forEach((s) => { s.onchange = saveSchool; });
  school.append(gradeSel, classSel, houseSel);
  wrap.append(school);

  // --- 상태메시지 ---
  wrap.append(el("div", "section-title", "상태메시지 (Lv.10)"));
  const bio = el("input");
  bio.placeholder = "상태메시지";
  bio.value = state.me.bio || "";
  bio.onchange = async () => {
    const { error } = await sb.from("profiles")
      .update({ bio: bio.value.trim() || null }).eq("id", state.me.id);
    if (error) { bio.value = state.me.bio || ""; return toast(errText(error)); }
    state.me.bio = bio.value.trim() || null;
    toast("저장됨");
  };
  wrap.append(bio);

  // --- 관심사 ---
  wrap.append(el("div", "section-title", `관심사 ${chosen.size}개`));
  const byCategory = {};
  (interests.data || []).forEach((i) => { (byCategory[i.category || "기타"] ||= []).push(i); });
  Object.entries(byCategory).forEach(([category, list]) => {
    const group = el("div", "card");
    group.append(el("div", "muted small", category));
    const tags = el("div");
    tags.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-top:6px";
    list.forEach((interest) => {
      const tag = el("button", "chip" + (chosen.has(interest.id) ? "" : " gray"),
                     `${interest.emoji} ${interest.label}`);
      tag.style.padding = "6px 10px";
      tag.onclick = async () => {
        if (chosen.has(interest.id)) {
          await sb.from("profile_interests").delete()
            .eq("user_id", state.me.id).eq("interest_id", interest.id);
          chosen.delete(interest.id);
          tag.className = "chip gray";
        } else {
          const { error } = await sb.from("profile_interests")
            .insert({ user_id: state.me.id, interest_id: interest.id });
          if (error) return toast(errText(error));
          chosen.add(interest.id);
          tag.className = "chip";
        }
        tag.style.padding = "6px 10px";
      };
      tags.append(tag);
    });
    group.append(tags);
    wrap.append(group);
  });

  // --- 공개 설정 ---
  wrap.append(el("div", "section-title", "공개 설정"));
  const toggles = [
    ["read_receipts_enabled", "읽음 표시 보내기"],
    ["show_birthday", "생일 공개"],
    ["visit_tracking_enabled", "프로필 방문 기록"],
    ["show_level_badge", "레벨 배지 보이기"],
  ];
  toggles.forEach(([key, label]) => {
    const row = el("div", "rowitem");
    row.append(el("div", "grow", label));
    const box = el("input");
    box.type = "checkbox";
    box.checked = !!state.me[key];
    box.style.cssText = "width:auto;margin:0";
    box.onchange = async () => {
      const { error } = await sb.from("profiles")
        .update({ [key]: box.checked }).eq("id", state.me.id);
      if (error) { box.checked = !box.checked; return toast(errText(error)); }
      state.me[key] = box.checked;
      toast("저장됨");
    };
    row.append(box);
    wrap.append(row);
  });
  wrap.append(el("div", "muted small",
    "방문 기록은 켜야 내 방문자를 볼 수 있고, 내 방문도 상대에게 남습니다."));

  if (visitors.data?.length) {
    wrap.append(el("div", "section-title", "내 프로필 방문자"));
    visitors.data.forEach((v) => {
      const row = el("div", "rowitem");
      row.append(el("div", "grow", v.nickname), el("div", "right", `${v.visit_count}번`));
      wrap.append(row);
    });
  }

  const out = el("button", "primary", "로그아웃");
  out.style.background = "var(--danger)";
  out.onclick = signOut;
  wrap.append(out);

  body.append(wrap);
}

// =====================================================================
// 시트
// =====================================================================
function openSheet(title, build) {
  const inner = $("sheet-inner");
  inner.innerHTML = "";
  if (title) inner.append(el("h2", null, title));
  build(inner);
  $("sheet").hidden = false;
}
function closeSheet() { $("sheet").hidden = true; }
$("sheet").onclick = (event) => { if (event.target.id === "sheet") closeSheet(); };

boot();
