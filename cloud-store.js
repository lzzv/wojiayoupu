function cleanText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function cleanNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

const REMEMBER_LOGIN_KEY = "wojiayoupu_remember_login";

function isStorageUsable(storage) {
  if (!storage) return false;
  try {
    const probe = "__wojiayoupu_probe__";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function localStorageFor(win = globalThis.window) {
  return isStorageUsable(win?.localStorage) ? win.localStorage : null;
}

function sessionStorageFor(win = globalThis.window) {
  return isStorageUsable(win?.sessionStorage) ? win.sessionStorage : null;
}

function rememberEnabled(win = globalThis.window) {
  const local = localStorageFor(win);
  return local ? local.getItem(REMEMBER_LOGIN_KEY) !== "0" : true;
}

function preferredStorage(win = globalThis.window) {
  return rememberEnabled(win) ? localStorageFor(win) || sessionStorageFor(win) : sessionStorageFor(win) || localStorageFor(win);
}

export function getRememberLogin(win = globalThis.window) {
  return rememberEnabled(win);
}

export function setRememberLogin(enabled, win = globalThis.window) {
  const local = localStorageFor(win);
  if (local) local.setItem(REMEMBER_LOGIN_KEY, enabled ? "1" : "0");
}

export function createAuthStorage(win = globalThis.window) {
  return {
    getItem(key) {
      const preferred = preferredStorage(win);
      const local = localStorageFor(win);
      const session = sessionStorageFor(win);
      return preferred?.getItem(key) ?? local?.getItem(key) ?? session?.getItem(key) ?? null;
    },
    setItem(key, value) {
      const target = preferredStorage(win);
      const local = localStorageFor(win);
      const session = sessionStorageFor(win);
      if (local && local !== target) local.removeItem(key);
      if (session && session !== target) session.removeItem(key);
      target?.setItem(key, value);
    },
    removeItem(key) {
      const local = localStorageFor(win);
      const session = sessionStorageFor(win);
      local?.removeItem(key);
      session?.removeItem(key);
    }
  };
}

export function hasCloudConfig(config) {
  return Boolean(
    config &&
    /^https:\/\//.test(cleanText(config.url)) &&
    cleanText(config.publishableKey).length > 10
  );
}

export function createCloudClient(config, { detectSessionInUrl = true, win = globalThis.window } = {}) {
  if (!hasCloudConfig(config)) throw new Error("Supabase configuration is incomplete");
  if (!win?.supabase?.createClient) throw new Error("Supabase client library is unavailable");
  return win.supabase.createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl,
      storage: createAuthStorage(win)
    }
  });
}

export function serializeState(state, treeId) {
  const cards = (state.cards || []).map(card => ({
    id: cleanText(card.id),
    tree_id: treeId,
    kind: card.kind === "couple" ? "couple" : "single",
    title: cleanText(card.title, "未命名"),
    relation_label: cleanText(card.relationLabel),
    x: cleanNumber(card.x),
    y: cleanNumber(card.y),
    reminders: Array.isArray(card.reminders) ? card.reminders : []
  }));

  const persons = (state.cards || []).flatMap(card => (card.persons || []).map((person, side) => ({
    id: cleanText(person.id, `${card.id}:${side}`),
    tree_id: treeId,
    card_id: card.id,
    side,
    name: cleanText(person.name, "未命名"),
    gender: cleanText(person.gender, side === 0 ? "male" : "female"),
    age: cleanNumber(person.age),
    birth_year: cleanNumber(person.birthYear, 1990),
    province: cleanText(person.province),
    city: cleanText(person.city),
    county: cleanText(person.county),
    detail_address: cleanText(person.detailAddress),
    work_type: cleanText(person.workType),
    position: cleanText(person.position),
    phone: cleanText(person.phone),
    notes: cleanText(person.notes),
    privacy_level: cleanText(person.privacyLevel, "family")
  })));

  const relations = (state.links || []).map(link => ({
    id: cleanText(link.id),
    tree_id: treeId,
    from_card_id: cleanText(link.from),
    to_card_id: cleanText(link.to),
    type: cleanText(link.type, "parent"),
    certainty: cleanText(link.certainty, "confirmed")
  }));

  return {
    treeId,
    centerId: cleanText(state.centerId),
    cards,
    persons,
    relations,
    viewState: {
      tree_id: treeId,
      selected_card_id: cleanText(state.selectedId, state.centerId),
      view_mode: cleanText(state.viewMode, "timeline"),
      filters: state.filters || { parent: true, sibling: true, friend: true }
    }
  };
}

function normalizePerson(person) {
  return {
    id: person.id,
    name: cleanText(person.name, "未命名"),
    gender: cleanText(person.gender, "male"),
    age: cleanNumber(person.age),
    birthYear: cleanNumber(person.birth_year, 1990),
    province: cleanText(person.province),
    city: cleanText(person.city),
    county: cleanText(person.county),
    detailAddress: cleanText(person.detail_address),
    workType: cleanText(person.work_type),
    position: cleanText(person.position),
    phone: cleanText(person.phone),
    notes: cleanText(person.notes),
    privacyLevel: cleanText(person.privacy_level, "family")
  };
}

function recoveryRedirectUrl(win = globalThis.window) {
  const origin = /^https?:\/\//.test(cleanText(win?.location?.origin)) ? win.location.origin : "https://1000011.com";
  return `${origin}/?mode=recovery`;
}

export function normalizeCloudSnapshot(snapshot) {
  const peopleByCard = new Map();
  for (const person of snapshot.persons || []) {
    const list = peopleByCard.get(person.card_id) || [];
    list.push(person);
    peopleByCard.set(person.card_id, list);
  }

  const cards = (snapshot.cards || []).map(card => ({
    id: card.id,
    kind: card.kind === "couple" ? "couple" : "single",
    title: cleanText(card.title, "未命名"),
    relationLabel: cleanText(card.relation_label),
    reminders: Array.isArray(card.reminders) ? card.reminders : [],
    x: cleanNumber(card.x),
    y: cleanNumber(card.y),
    persons: (peopleByCard.get(card.id) || [])
      .sort((a, b) => cleanNumber(a.side) - cleanNumber(b.side))
      .map(normalizePerson)
  }));

  const viewState = snapshot.viewState || {};
  return {
    access: snapshot.access || { role: "viewer", personId: "" },
    centerId: cleanText(snapshot.tree?.center_card_id, cards[0]?.id || ""),
    selectedId: cleanText(viewState.selected_card_id, snapshot.tree?.center_card_id || cards[0]?.id || ""),
    viewMode: cleanText(viewState.view_mode, "timeline"),
    filters: viewState.filters || { parent: true, sibling: true, friend: true },
    cards,
    links: (snapshot.relations || []).map(link => ({
      id: link.id,
      from: link.from_card_id,
      to: link.to_card_id,
      type: link.type,
      certainty: link.certainty || "confirmed"
    }))
  };
}

export class FamilyCloudStore {
  constructor({ client, onStatus = () => {} }) {
    if (!client) throw new Error("Supabase client is required");
    this.client = client;
    this.onStatus = onStatus;
  }

  async getSession() {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw error;
    return data.session || null;
  }

  onAuthStateChange(callback) {
    return this.client.auth.onAuthStateChange((event, session) => callback(session, event));
  }

  async requestEmailOtp(email) {
    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false }
    });
    if (error) throw error;
  }

  async verifyEmailOtp(email, token) {
    const { data, error } = await this.client.auth.verifyOtp({ email, token, type: "email" });
    if (error) throw error;
    return data.session || null;
  }

  async signInWithPassword(email, password) {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.session || null;
  }

  async requestPasswordRecovery(email) {
    const { error } = await this.client.auth.resetPasswordForEmail(email, {
      redirectTo: recoveryRedirectUrl()
    });
    if (error) throw error;
  }

  async verifyRecoveryOtp(email, token) {
    const { data, error } = await this.client.auth.verifyOtp({ email, token, type: "recovery" });
    if (error) throw error;
    return data.session || null;
  }

  async updatePassword(password) {
    const { data, error } = await this.client.auth.updateUser({ password });
    if (error) throw error;
    return data.user || null;
  }

  async signOut() {
    const { error } = await this.client.auth.signOut();
    if (error) throw error;
  }

  async createFamilyTree(name = "我的家族") {
    const { data, error } = await this.client.rpc("create_family_tree", { p_name: name });
    if (error) throw error;
    return data;
  }

  async firstAccessibleTree() {
    const { data, error } = await this.client
      .from("family_trees")
      .select("id,name,center_card_id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async loadState(treeId) {
    this.onStatus("loading");
    const [treeResult, cardsResult, personsResult, relationsResult, viewResult, membershipResult] = await Promise.all([
      this.client.from("family_trees").select("id,name,center_card_id").eq("id", treeId).single(),
      this.client.from("family_cards").select("*").eq("tree_id", treeId),
      this.client.from("persons").select("*").eq("tree_id", treeId),
      this.client.from("relations").select("*").eq("tree_id", treeId),
      this.client.from("user_view_state").select("*").eq("tree_id", treeId).maybeSingle(),
      this.client.from("family_memberships").select("role,person_id,status").eq("tree_id", treeId).eq("status", "active").single()
    ]);
    const failure = [treeResult, cardsResult, personsResult, relationsResult, viewResult, membershipResult].find(result => result.error);
    if (failure) {
      this.onStatus("error");
      throw failure.error;
    }
    this.onStatus("saved");
    return normalizeCloudSnapshot({
      tree: treeResult.data,
      cards: cardsResult.data,
      persons: personsResult.data,
      relations: relationsResult.data,
      viewState: viewResult.data,
      access: { role: membershipResult.data.role, personId: membershipResult.data.person_id || "" }
    });
  }

  async saveState(state, treeId) {
    this.onStatus("saving");
    const payload = serializeState(state, treeId);
    let error;
    if (state.access?.role === "self_editor") {
      const person = payload.persons.find(item => item.id === state.access.personId);
      if (!person) throw new Error("未找到与当前账号绑定的人物资料");
      ({ error } = await this.client.rpc("update_self_person", {
        p_tree_id: treeId,
        p_person_id: state.access.personId,
        p_patch: {
          name: person.name, gender: person.gender, birthYear: person.birth_year, age: person.age,
          province: person.province, city: person.city, county: person.county,
          phone: person.phone, notes: person.notes
        }
      }));
    } else if (state.access?.role === "viewer") {
      throw new Error("当前账号为只读权限");
    } else {
      ({ error } = await this.client.rpc("replace_family_state", { p_tree_id: treeId, p_state: payload }));
    }
    if (error) {
      this.onStatus("error");
      throw error;
    }
    this.onStatus("saved");
    return payload;
  }
}
