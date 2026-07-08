import { createCloudClient, hasCloudConfig } from "../cloud-store.js";

const config = window.WOJIAYOUPU_CONFIG?.supabase || {};
if (!hasCloudConfig(config)) throw new Error("Supabase configuration is unavailable");

const client = createCloudClient(config, { detectSessionInUrl: false });
const state = { families: [], route: "dashboard", selectedFamily: null, detail: null, logs: [], session: null };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const titles = {
  dashboard: ["运营总览", "管理家族、容量与成员访问权限"],
  families: ["家族管理", "开通、停用并调整家族容量"],
  accounts: ["账号管理", "查看家族信息、编辑配额并维护成员账号"],
  invites: ["邀请管理", "生成并管理家族邀请二维码"],
  audit: ["审计日志", "查看平台关键操作记录"],
  settings: ["系统设置", "配置新建家族和邀请的默认参数"]
};

function normalizePhone(value) {
  const raw = value.trim().replace(/[\s()+-]/g, "");
  return raw.startsWith("86") && raw.length === 13 ? raw.slice(2) : raw;
}

function adminEmailFromPhone(value) {
  const phone = normalizePhone(value);
  if (!/^1\d{10}$/.test(phone)) throw new Error("请输入正确的管理员手机号");
  return `${phone}@admin.1000011.com`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char]));
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2400);
}

function setBusy(busy) {
  $("#loadingState").hidden = !busy;
}

function showError(message) {
  $("#errorText").textContent = message;
  $("#errorState").hidden = false;
}

function hideStates() {
  $("#loadingState").hidden = true;
  $("#emptyState").hidden = true;
  $("#errorState").hidden = true;
}

function dateValue(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

function dateLabel(value) {
  return value ? new Date(value).toLocaleDateString("zh-CN") : "长期";
}

function statusLabel(value) {
  return {
    active: "已启用",
    suspended: "已停用",
    expired: "已到期",
    archived: "已归档",
    disabled: "已停用",
    left: "已退出",
    revoked: "已撤销",
    exhausted: "已用尽"
  }[value] || value;
}

function roleLabel(value) {
  return {
    owner: "负责人",
    admin: "家族管理员",
    editor: "编辑者",
    self_editor: "仅编辑本人",
    viewer: "只读"
  }[value] || value;
}

async function invoke(name, body) {
  const { data: { session } } = await client.auth.getSession();
  const response = await fetch(`${config.url}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token || ""}`,
      apikey: config.publishableKey
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({ error: "服务返回异常" }));
  if (!response.ok || payload.error) throw new Error(payload.error || "请求失败");
  return payload;
}

async function ensureAdmin(session) {
  if (!session) return false;
  const { data, error } = await client.from("platform_admins")
    .select("status,must_change_password")
    .eq("user_id", session.user.id)
    .eq("status", "active")
    .maybeSingle();
  if (error || !data) {
    await client.auth.signOut();
    return false;
  }
  if (data.must_change_password) toast("首次登录后请尽快修改管理员密码");
  return true;
}

async function loadFamilies() {
  hideStates();
  setBusy(true);
  try {
    const data = await invoke("admin-family", { action: "list" });
    state.families = data.families || [];
    renderAll();
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
}

async function loadDetail(treeId) {
  setBusy(true);
  try {
    state.detail = await invoke("admin-family", { action: "detail", treeId });
    state.selectedFamily = state.families.find(family => family.id === treeId) || state.detail.family;
    renderFamilyDetail();
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
}

async function loadAudit() {
  try {
    const data = await invoke("admin-family", { action: "audit" });
    state.logs = data.logs || [];
    renderAudit();
  } catch (error) {
    toast(error.message);
  }
}

function usage(family, key) {
  return Number(family.usage?.[key] || 0);
}

function pct(count, limit) {
  return limit ? Math.round((count / limit) * 100) : 0;
}

function renderAll() {
  renderDashboard();
  renderFamilies();
  renderAudit();
}

function renderDashboard() {
  const active = state.families.filter(family => family.status === "active").length;
  const people = state.families.reduce((count, family) => count + usage(family, "person_count"), 0);
  const accounts = state.families.reduce((count, family) => count + usage(family, "account_count"), 0);
  $("#metrics").innerHTML = [
    ["家族总数", state.families.length],
    ["有效家族", active],
    ["人物总数", people],
    ["登录账号", accounts]
  ].map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`).join("");

  const warnings = state.families.filter(family => pct(usage(family, "person_count"), family.person_limit) >= 80 || pct(usage(family, "account_count"), family.account_limit) >= 80);
  $("#warningRows").innerHTML = warnings.length ? warnings.map(family => `
    <tr>
      <td>${escapeHtml(family.name)}</td>
      <td class="usage warning">${usage(family, "person_count")} / ${family.person_limit}</td>
      <td class="usage warning">${usage(family, "account_count")} / ${family.account_limit}</td>
      <td class="status ${family.status}">${statusLabel(family.status)}</td>
    </tr>
  `).join("") : `<tr><td colspan="4">暂无容量预警</td></tr>`;
}

function filteredFamilies() {
  const keyword = $("#globalSearch").value.trim().toLowerCase();
  const status = $("#familyStatusFilter").value;
  return state.families.filter(family => (!status || family.status === status) && (!keyword || `${family.code} ${family.name}`.toLowerCase().includes(keyword)));
}

function renderFamilies() {
  const rows = filteredFamilies();
  $("#familyRows").innerHTML = rows.length ? rows.map(family => `
    <tr>
      <td>${escapeHtml(family.code)}</td>
      <td><strong>${escapeHtml(family.name)}</strong></td>
      <td class="usage ${pct(usage(family, "person_count"), family.person_limit) >= 80 ? "warning" : ""}">${usage(family, "person_count")} / ${family.person_limit}</td>
      <td class="usage ${pct(usage(family, "account_count"), family.account_limit) >= 80 ? "warning" : ""}">${usage(family, "account_count")} / ${family.account_limit}</td>
      <td>${family.owner_user_id ? "已绑定" : "待认领"}</td>
      <td class="status ${family.status}">${statusLabel(family.status)}</td>
      <td>${dateLabel(family.expires_at)}</td>
      <td><button class="row-action" data-open-family="${family.id}">管理</button></td>
    </tr>
  `).join("") : `<tr><td colspan="8">没有符合条件的家族</td></tr>`;
}

function renderAudit() {
  const names = new Map(state.families.map(family => [family.id, family.name]));
  $("#auditRows").innerHTML = state.logs.length ? state.logs.map(log => `
    <tr>
      <td>${new Date(log.created_at).toLocaleString("zh-CN")}</td>
      <td>${escapeHtml(log.action)}</td>
      <td>${escapeHtml(log.target_type)}</td>
      <td>${escapeHtml(names.get(log.tree_id) || "平台")}</td>
      <td>${escapeHtml(log.actor_id.slice(0, 8))}</td>
    </tr>
  `).join("") : `<tr><td colspan="5">暂无审计记录</td></tr>`;
}

function renderFamilyDetail() {
  if (!state.detail) return;
  const family = state.detail.family;
  const members = state.detail.members || [];
  const invites = state.detail.invites || [];
  const usageData = state.detail.usage || {};

  $("#familyDetailSummary").className = "family-summary";
  $("#familyDetailSummary").innerHTML = [
    ["家族编号", family.code, family.name],
    ["人物容量", `${usageData.person_count || 0} / ${family.person_limit}`, `使用率 ${pct(usageData.person_count || 0, family.person_limit)}%`],
    ["账号容量", `${usageData.account_count || 0} / ${family.account_limit}`, `使用率 ${pct(usageData.account_count || 0, family.account_limit)}%`],
    ["当前状态", statusLabel(family.status), family.plan_name || "standard"]
  ].map(([label, value, note]) => `<div class="summary-card"><span>${label}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></div>`).join("");

  $("#accountContent").className = "detail-stack";
  $("#accountContent").innerHTML = `
    <form class="family-config" id="familyConfigForm">
      <div class="detail-heading">
        <div><strong>${escapeHtml(family.name)}</strong><span>创建于 ${dateLabel(family.created_at)}，到期 ${dateLabel(family.expires_at)}</span></div>
        <button class="button primary" type="submit">保存家族设置</button>
      </div>
      <div class="form-grid">
        <label>家族名称<input name="name" value="${escapeHtml(family.name)}" required></label>
        <label>状态<select name="status"><option value="active">启用</option><option value="suspended">停用</option><option value="expired">到期</option><option value="archived">归档</option></select></label>
        <label>人物容量<input name="person_limit" type="number" min="${usageData.person_count || 1}" value="${family.person_limit}"></label>
        <label>账号容量<input name="account_limit" type="number" min="${usageData.account_count || 1}" value="${family.account_limit}"></label>
        <label>套餐<input name="plan_name" value="${escapeHtml(family.plan_name)}"></label>
        <label>到期日期<input name="expires_at" type="date" value="${dateValue(family.expires_at)}"></label>
      </div>
    </form>
    <div class="table-wrap">
      <table>
        <thead><tr><th>成员</th><th>邮箱</th><th>手机</th><th>角色</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          ${members.length ? members.map(member => `
            <tr>
              <td>${escapeHtml(member.profile?.full_name || member.profile?.display_name || "未填写")}</td>
              <td>${escapeHtml(member.profile?.normalized_email || "-")}</td>
              <td>${escapeHtml(member.profile?.normalized_phone || "-")}</td>
              <td><select data-member-role="${member.user_id}">${["owner", "admin", "editor", "self_editor", "viewer"].map(role => `<option value="${role}" ${member.role === role ? "selected" : ""}>${roleLabel(role)}</option>`).join("")}</select></td>
              <td><select data-member-status="${member.user_id}"><option value="active" ${member.status === "active" ? "selected" : ""}>启用</option><option value="disabled" ${member.status === "disabled" ? "selected" : ""}>停用</option><option value="left" ${member.status === "left" ? "selected" : ""}>退出</option></select></td>
              <td>
                <button class="row-action" data-save-member="${member.user_id}">保存</button>
                <button class="row-action danger" data-reset-member="${member.user_id}">重置密码</button>
              </td>
            </tr>
          `).join("") : `<tr><td colspan="6">尚无已加入账号</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
  $("#familyConfigForm [name=status]").value = family.status;

  $("#inviteContent").className = "detail-stack";
  $("#inviteContent").innerHTML = `
    <div class="detail-heading"><div><strong>${escapeHtml(family.name)}</strong><span>邀请链接仅在生成时显示，请及时保存二维码</span></div></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>类型</th><th>状态</th><th>使用次数</th><th>到期时间</th><th></th></tr></thead>
        <tbody>
          ${invites.length ? invites.map(invite => `
            <tr>
              <td>${invite.default_role === "owner" ? "负责人邀请" : "成员邀请"}</td>
              <td>${statusLabel(invite.status)}</td>
              <td>${invite.used_count} / ${invite.max_uses}</td>
              <td>${dateLabel(invite.expires_at)}</td>
              <td>${invite.status === "active" ? `<button class="row-action danger" data-revoke-invite="${invite.id}">撤销</button>` : "-"}</td>
            </tr>
          `).join("") : `<tr><td colspan="5">暂无邀请</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
  $("#createInviteBtn").disabled = false;
}

function showInviteResult(data, title) {
  const qr = qrcode(0, "M");
  qr.addData(data.inviteUrl);
  qr.make();
  const qrUrl = qr.createDataURL(6, 12);
  $("#inviteContent").className = "invite-result";
  $("#inviteContent").innerHTML = `
    <img src="${qrUrl}" alt="${escapeHtml(title)}二维码">
    <div>
      <strong>${escapeHtml(title)}</strong>
      <p class="muted">扫码填写资料并设置密码后即可加入。邀请链接只显示本次，请立即保存。</p>
      <input id="inviteUrl" value="${escapeHtml(data.inviteUrl)}" readonly>
      <div class="invite-actions">
        <button class="button" id="copyInvite">复制链接</button>
        <a class="button" href="${qrUrl}" download="family-invite.png">保存二维码</a>
        <button class="button" data-refresh-detail>返回邀请列表</button>
      </div>
    </div>
  `;
  $("#copyInvite").onclick = () => navigator.clipboard.writeText(data.inviteUrl).then(() => toast("邀请链接已复制"));
  routeTo("invites");
}

function routeTo(route) {
  state.route = route;
  $$('.nav-item[data-route]').forEach(button => button.classList.toggle("active", button.dataset.route === route));
  $$('.view').forEach(view => view.classList.remove("active"));
  $(`#${route}View`).classList.add("active");
  const [title, subtitle] = titles[route];
  $("#pageTitle").textContent = title;
  $("#pageSubtitle").textContent = subtitle;
  if (route === "audit") loadAudit();
}

async function openFamily(id) {
  routeTo("accounts");
  await loadDetail(id);
}

function modal(open) {
  $("#modalBackdrop").hidden = !open;
  if (open) {
    $("#familyForm").reset();
    $("#familyFormMessage").textContent = "";
    $("#familyForm [name=personLimit]").value = $("#defaultPersonLimit").value;
    $("#familyForm [name=accountLimit]").value = $("#defaultAccountLimit").value;
  }
}

$("#adminLoginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $("#loginMessage").textContent = "";
  try {
    const { data, error } = await client.auth.signInWithPassword({
      email: adminEmailFromPhone($("#adminPhone").value),
      password: $("#adminPassword").value
    });
    if (error) throw error;
    if (!await ensureAdmin(data.session)) throw new Error("账号没有平台管理权限");
    state.session = data.session;
    $("#loginScreen").hidden = true;
    $("#adminShell").hidden = false;
    await loadFamilies();
  } catch (error) {
    $("#loginMessage").textContent = error.message || "登录失败";
  } finally {
    button.disabled = false;
  }
});

$("#adminSignOut").onclick = async () => {
  await client.auth.signOut();
  location.reload();
};

$("#adminNav").onclick = event => {
  const button = event.target.closest("[data-route]");
  if (button) routeTo(button.dataset.route);
};

document.addEventListener("click", async event => {
  const open = event.target.closest("[data-open-family]");
  if (open) await openFamily(open.dataset.openFamily);

  const jump = event.target.closest("[data-jump]");
  if (jump) routeTo(jump.dataset.jump);

  const save = event.target.closest("[data-save-member]");
  if (save) {
    const userId = save.dataset.saveMember;
    try {
      await invoke("admin-family", {
        action: "member-update",
        treeId: state.selectedFamily.id,
        userId,
        role: $(`[data-member-role="${userId}"]`).value,
        status: $(`[data-member-status="${userId}"]`).value
      });
      toast("账号设置已保存");
      await loadDetail(state.selectedFamily.id);
    } catch (error) {
      toast(error.message);
    }
  }

  const reset = event.target.closest("[data-reset-member]");
  if (reset) {
    const password = $("#memberPassword").value.trim();
    if (password.length < 8) {
      toast("请先输入至少 8 位的新密码");
      return;
    }
    try {
      await invoke("admin-family", {
        action: "member-password-reset",
        treeId: state.selectedFamily.id,
        userId: reset.dataset.resetMember,
        password
      });
      $("#memberPassword").value = "";
      toast("成员密码已重置");
    } catch (error) {
      toast(error.message);
    }
  }

  const revoke = event.target.closest("[data-revoke-invite]");
  if (revoke) {
    try {
      await invoke("family-invite", { action: "revoke", treeId: state.selectedFamily.id, inviteId: revoke.dataset.revokeInvite });
      toast("邀请已撤销");
      await loadDetail(state.selectedFamily.id);
    } catch (error) {
      toast(error.message);
    }
  }

  if (event.target.closest("[data-refresh-detail]")) await loadDetail(state.selectedFamily.id);
});

document.addEventListener("submit", async event => {
  if (event.target.id !== "familyConfigForm") return;
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    await invoke("admin-family", {
      action: "update",
      treeId: state.selectedFamily.id,
      name: form.get("name"),
      status: form.get("status"),
      person_limit: Number(form.get("person_limit")),
      account_limit: Number(form.get("account_limit")),
      plan_name: form.get("plan_name"),
      expires_at: form.get("expires_at") || null
    });
    toast("家族设置已保存");
    await loadFamilies();
    await loadDetail(state.selectedFamily.id);
  } catch (error) {
    toast(error.message);
  }
});

$("#globalSearch").oninput = renderFamilies;
$("#familyStatusFilter").onchange = renderFamilies;
$("#createFamilyBtn").onclick = () => modal(true);
$("#closeModal").onclick = () => modal(false);
$("#cancelModal").onclick = () => modal(false);
$("#retryBtn").onclick = loadFamilies;

$("#familyForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = event.submitter;
  button.disabled = true;
  try {
    const data = await invoke("admin-family", {
      action: "create",
      name: form.get("name"),
      ownerEmail: form.get("ownerEmail"),
      personLimit: Number(form.get("personLimit")),
      accountLimit: Number(form.get("accountLimit")),
      planName: form.get("planName"),
      expiresAt: form.get("expiresAt") || null
    });
    modal(false);
    toast("家族已开通，负责人邀请已生成");
    await loadFamilies();
    state.selectedFamily = state.families.find(family => family.id === data.family.id) || data.family;
    showInviteResult({ inviteUrl: data.ownerInviteUrl }, `${data.family.name}负责人邀请`);
  } catch (error) {
    $("#familyFormMessage").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("#createInviteBtn").onclick = async () => {
  if (!state.selectedFamily) return;
  try {
    const days = Number($("#defaultInviteDays").value || 7);
    const data = await invoke("family-invite", {
      action: "create",
      treeId: state.selectedFamily.id,
      maxUses: state.selectedFamily.account_limit,
      expiresAt: new Date(Date.now() + days * 86400000).toISOString()
    });
    showInviteResult(data, `${state.selectedFamily.name}成员邀请`);
  } catch (error) {
    toast(error.message);
  }
};

for (const id of ["defaultPersonLimit", "defaultAccountLimit", "defaultInviteDays"]) {
  const el = $(`#${id}`);
  el.value = localStorage.getItem(id) || el.value;
  el.onchange = () => localStorage.setItem(id, el.value);
}

const { data: { session } } = await client.auth.getSession();
if (session && await ensureAdmin(session)) {
  state.session = session;
  $("#loginScreen").hidden = true;
  $("#adminShell").hidden = false;
  await loadFamilies();
}
