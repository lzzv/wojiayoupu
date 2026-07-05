function cleanText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function cleanNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function hasCloudConfig(config) {
  return Boolean(
    config &&
    /^https:\/\//.test(cleanText(config.url)) &&
    cleanText(config.publishableKey).length > 10
  );
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
    return this.client.auth.onAuthStateChange((_event, session) => callback(session));
  }

  async signIn(email, redirectTo) {
    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo }
    });
    if (error) throw error;
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
    const [treeResult, cardsResult, personsResult, relationsResult, viewResult] = await Promise.all([
      this.client.from("family_trees").select("id,name,center_card_id").eq("id", treeId).single(),
      this.client.from("family_cards").select("*").eq("tree_id", treeId),
      this.client.from("persons").select("*").eq("tree_id", treeId),
      this.client.from("relations").select("*").eq("tree_id", treeId),
      this.client.from("user_view_state").select("*").eq("tree_id", treeId).maybeSingle()
    ]);
    const failure = [treeResult, cardsResult, personsResult, relationsResult, viewResult].find(result => result.error);
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
      viewState: viewResult.data
    });
  }

  async saveState(state, treeId) {
    this.onStatus("saving");
    const payload = serializeState(state, treeId);
    const { error } = await this.client.rpc("replace_family_state", {
      p_tree_id: treeId,
      p_state: payload
    });
    if (error) {
      this.onStatus("error");
      throw error;
    }
    this.onStatus("saved");
    return payload;
  }
}
