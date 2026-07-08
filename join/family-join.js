import { createCloudClient, hasCloudConfig } from "../cloud-store.js";

const config = window.WOJIAYOUPU_CONFIG?.supabase || {};
if (!hasCloudConfig(config)) throw new Error("Supabase configuration is unavailable");

const client = createCloudClient(config, { detectSessionInUrl: true });
const params = new URLSearchParams(location.search);
const token = params.get("token") || "";

const $ = selector => document.querySelector(selector);

function show(id) {
  for (const el of [$("#inviteLoading"), $("#inviteUnavailable"), $("#joinForm"), $("#joinComplete")]) {
    el.classList.add("hidden");
  }
  $(id).classList.remove("hidden");
}

function message(id, text, error = false) {
  const el = $(id);
  el.textContent = text;
  el.classList.toggle("error", error);
}

async function call(body, authenticated = false) {
  const { data: { session } } = await client.auth.getSession();
  const response = await fetch(`${config.url}/functions/v1/accept-invite`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: config.publishableKey,
      ...(authenticated ? { Authorization: `Bearer ${session?.access_token || ""}` } : {})
    },
    body: JSON.stringify({ ...body, token })
  });
  const data = await response.json().catch(() => ({ error: "服务返回异常" }));
  if (!response.ok || data.error) throw new Error(data.error || "请求失败");
  return data;
}

async function completeFromSession() {
  const { data: { session } } = await client.auth.getSession();
  if (!session) return false;
  await call({ phase: "complete" }, true);
  show("#joinComplete");
  $("#completeText").textContent = "账号已创建并加入家族，正在进入家族空间...";
  history.replaceState({}, "", location.pathname);
  setTimeout(() => location.assign("/"), 600);
  return true;
}

function validatePassword() {
  const password = $("#joinPassword").value;
  const confirm = $("#joinPasswordConfirm").value;
  if (password.length < 8) throw new Error("密码至少需要 8 位");
  if (password !== confirm) throw new Error("两次输入的密码不一致");
  return password;
}

async function registerAndJoin() {
  const email = $("#joinEmail").value.trim().toLowerCase();
  const password = validatePassword();
  const requestPayload = {
    phase: "request",
    name: $("#joinName").value.trim(),
    gender: $("#joinGender").value,
    email,
    phone: $("#joinPhone").value.trim(),
    password
  };
  const result = await call(requestPayload);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  await completeFromSession();
  return result;
}

try {
  const data = await call({ phase: "inspect" });
  if (!data.available) throw new Error("邀请已过期、被撤销或家族暂不可用");
  $("#familyName").textContent = data.familyName;
  if (!await completeFromSession()) show("#joinForm");
} catch (error) {
  $("#unavailableText").textContent = error.message;
  show("#inviteUnavailable");
}

$("#joinForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  message("#joinMessage", "正在创建账号并加入家族...");
  try {
    const result = await registerAndJoin();
    if (result.accountExists) {
      message("#joinMessage", "检测到已有账号，已校验密码并加入当前家族。");
    }
  } catch (error) {
    message("#joinMessage", error.message || "加入失败，请稍后重试", true);
  } finally {
    button.disabled = false;
  }
});
