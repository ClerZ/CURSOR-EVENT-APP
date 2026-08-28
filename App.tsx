import { StatusBar } from "expo-status-bar";
import * as WebBrowser from "expo-web-browser";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  CATEGORIES,
  DEAL_STORES,
  Deal,
  DealStore,
  FALLBACK_DEALS,
  GAMES,
  Game,
} from "./src/data/catalog";
import { categoryColors, colors } from "./src/theme";

const STORAGE_KEY = "gamer-hub-user-games";
const CARD_WIDTH = Math.min(280, Dimensions.get("window").width * 0.78);
const CARD_GAP = 14;
const SNAP = CARD_WIDTH + CARD_GAP;
const DEAL_CARD_HEIGHT = 144;
const DEAL_GAP = 12;
const DEAL_SNAP = DEAL_CARD_HEIGHT + DEAL_GAP;

type Tab = "play" | "library" | "deals";
type DealFilter = (typeof DEAL_STORES)[number];

const REGION_CURRENCIES: Record<string, string> = {
  AU: "AUD",
  CA: "CAD",
  CH: "CHF",
  CN: "CNY",
  DE: "EUR",
  ES: "EUR",
  FR: "EUR",
  GB: "GBP",
  ID: "IDR",
  IN: "INR",
  IT: "EUR",
  JP: "JPY",
  KR: "KRW",
  MY: "MYR",
  NL: "EUR",
  NZ: "NZD",
  PH: "PHP",
  SG: "SGD",
  TH: "THB",
  US: "USD",
  VN: "VND",
};

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function slug(str: string) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function currencyFromLocale(locale: string) {
  const region = locale.split(/[-_]/)[1]?.toUpperCase();
  return (region && REGION_CURRENCIES[region]) || "USD";
}

function mixDeals(items: Deal[]) {
  const storeOrder: DealStore[] = ["Steam", "Epic Games", "Google Play"];
  const buckets = Object.fromEntries(
    storeOrder.map((store) => [store, items.filter((deal) => deal.store === store)]),
  ) as Record<DealStore, Deal[]>;
  const mixed: Deal[] = [];
  let row = 0;
  while (storeOrder.some((store) => buckets[store][row])) {
    storeOrder.forEach((store) => {
      const deal = buckets[store][row];
      if (deal) mixed.push(deal);
    });
    row += 1;
  }
  return mixed;
}

function Tag({ label }: { label: string }) {
  const tone = categoryColors[label] ?? { bg: "rgba(255,255,255,0.08)", fg: colors.muted };
  return (
    <Text style={[styles.tag, { backgroundColor: tone.bg, color: tone.fg }]}>{label}</Text>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("play");
  const [userGames, setUserGames] = useState<Game[]>([]);
  const [order, setOrder] = useState<number[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Game | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [deals, setDeals] = useState<Deal[]>(FALLBACK_DEALS);
  const [dealsLive, setDealsLive] = useState(false);
  const [dealsLoading, setDealsLoading] = useState(true);
  const [dealStore, setDealStore] = useState<DealFilter>("All");
  const [showAllDeals, setShowAllDeals] = useState(false);
  const [dealIndex, setDealIndex] = useState(0);
  const [dealAutoPaused, setDealAutoPaused] = useState(false);
  const [currency, setCurrency] = useState({ code: "USD", rate: 1, locale: "en-US", detected: false });
  const [form, setForm] = useState({ name: "", url: "", category: "Word", desc: "" });

  const listRef = useRef<ScrollView>(null);
  const dealListRef = useRef<ScrollView>(null);
  const dealPauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allGames = useMemo(() => GAMES.concat(userGames), [userGames]);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) setUserGames(JSON.parse(raw));
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    setOrder(shuffle(allGames.map((_, i) => i)));
    setIndex(0);
  }, [allGames]);

  const cabinetGames = useMemo(
    () => order.map((i) => allGames[i]).filter(Boolean),
    [order, allGames],
  );

  const step = useCallback(
    (dir: number) => {
      if (!cabinetGames.length) return;
      setIndex((cur) => {
        const next = (cur + dir + cabinetGames.length) % cabinetGames.length;
        listRef.current?.scrollTo({ x: next * SNAP, animated: true });
        return next;
      });
    },
    [cabinetGames.length],
  );

  useEffect(() => {
    if (!playing || tab !== "play" || cabinetGames.length < 2) return;
    const t = setInterval(() => step(1), 4200);
    return () => clearInterval(t);
  }, [playing, tab, cabinetGames.length, step]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(
          "https://www.cheapshark.com/api/1.0/deals?storeID=1&pageSize=10&sortBy=Deal%20Rating",
        );
        if (!res.ok) throw new Error("bad");
        const data = await res.json();
        if (!Array.isArray(data) || !data.length) throw new Error("empty");
        const steamDeals: Deal[] = data
          .slice(0, 10)
          .map((d: { title: string; salePrice: string; normalPrice: string; savings: string; dealID: string }) => ({
            title: d.title,
            salePrice: parseFloat(d.salePrice),
            normalPrice: parseFloat(d.normalPrice),
            savings: Math.round(parseFloat(d.savings)),
            link: "https://www.cheapshark.com/redirect?dealID=" + d.dealID,
            store: "Steam",
          }));
        setDeals([...steamDeals, ...FALLBACK_DEALS.filter((deal) => deal.store !== "Steam")]);
        setDealsLive(true);
      } catch {
        setDeals(FALLBACK_DEALS);
        setDealsLive(false);
      } finally {
        setDealsLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const browserLocale = Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
      let code = currencyFromLocale(browserLocale);
      let locale = browserLocale;
      try {
        const locationResponse = await fetch("https://ipapi.co/json/");
        if (locationResponse.ok) {
          const location = await locationResponse.json();
          code = typeof location.currency === "string" ? location.currency : code;
          locale =
            typeof location.languages === "string"
              ? location.languages.split(",")[0].replace("_", "-")
              : locale;
        }
      } catch {
        /* Locale-based fallback is already selected. */
      }

      let rate = 1;
      if (code !== "USD") {
        try {
          const ratesResponse = await fetch("https://open.er-api.com/v6/latest/USD");
          if (!ratesResponse.ok) throw new Error("Exchange-rate feed unavailable");
          const rates = await ratesResponse.json();
          const localRate = Number(rates.rates?.[code]);
          if (!localRate) throw new Error("Currency is not supported");
          rate = localRate;
        } catch {
          code = "USD";
          rate = 1;
        }
      }
      if (active) setCurrency({ code, rate, locale, detected: true });
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allGames.filter((g) => {
      if (category === "Community" && !g.isCommunity) return false;
      if (category === "Mobile friendly" && !g.mobileFriendly) return false;
      if (
        category !== "All" &&
        category !== "Community" &&
        category !== "Mobile friendly" &&
        g.category !== category
      ) return false;
      if (!q) return true;
      return (
        g.name.toLowerCase().includes(q) ||
        g.category.toLowerCase().includes(q) ||
        g.desc.toLowerCase().includes(q) ||
        g.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [allGames, category, query]);

  const filteredDeals = useMemo(() => {
    const matching = dealStore === "All" ? deals : deals.filter((deal) => deal.store === dealStore);
    return dealStore === "All" ? mixDeals(matching) : matching;
  }, [dealStore, deals]);

  const visibleDeals = useMemo(
    () => (showAllDeals ? filteredDeals : filteredDeals.slice(0, 6)),
    [filteredDeals, showAllDeals],
  );

  useEffect(() => {
    setDealIndex(0);
    dealListRef.current?.scrollTo({ y: 0, animated: false });
  }, [dealStore, showAllDeals]);

  useEffect(() => {
    if (tab !== "deals" || dealAutoPaused || visibleDeals.length < 2) return;
    const timer = setInterval(() => {
      setDealIndex((current) => {
        const next = (current + 1) % visibleDeals.length;
        dealListRef.current?.scrollTo({ y: next * DEAL_SNAP, animated: true });
        return next;
      });
    }, 4200);
    return () => clearInterval(timer);
  }, [dealAutoPaused, tab, visibleDeals.length]);

  useEffect(
    () => () => {
      if (dealPauseTimer.current) clearTimeout(dealPauseTimer.current);
    },
    [],
  );

  const pauseDealAutoScroll = useCallback(() => {
    setDealAutoPaused(true);
    if (dealPauseTimer.current) clearTimeout(dealPauseTimer.current);
    dealPauseTimer.current = setTimeout(() => setDealAutoPaused(false), 10000);
  }, []);

  const formatMoney = useCallback(
    (usd: number) =>
      new Intl.NumberFormat(currency.locale, {
        style: "currency",
        currency: currency.code,
        maximumFractionDigits: ["JPY", "KRW", "IDR", "VND"].includes(currency.code) ? 0 : 2,
      }).format(usd * currency.rate),
    [currency],
  );

  async function openUrl(url: string) {
    await WebBrowser.openBrowserAsync(url);
  }

  async function saveCommunity(game: Game) {
    const next = [...userGames, game];
    setUserGames(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  async function submitGame() {
    const name = form.name.trim();
    const desc = form.desc.trim();
    let url: URL;
    try {
      url = new URL(form.url.trim());
      if (!/^https?:$/.test(url.protocol)) throw new Error("bad");
    } catch {
      Alert.alert("Invalid link", "That URL doesn't look valid — check it and try again.");
      return;
    }
    if (!name || !desc) {
      Alert.alert("Missing details", "Name and description are required.");
      return;
    }
    const icons = ["🎮", "🕹️", "👾", "🎯", "🃏", "🧠", "⭐"];
    const game: Game = {
      id: slug(name) + "-" + Date.now().toString(36),
      name,
      category: form.category,
      desc,
      tags: ["community"],
      icon: icons[Math.floor(Math.random() * icons.length)],
      url: url.toString(),
      mobileFriendly: true,
      isCommunity: true,
    };
    await saveCommunity(game);
    setForm({ name: "", url: "", category: "Word", desc: "" });
    setAddOpen(false);
    setToast(`${name} added to your library`);
    setTab("library");
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.topbar}>
        <Text style={styles.brand}>
          GAMER<Text style={styles.brandDot}>•</Text>HUB
        </Text>
        <Text style={styles.brandSub}>Expo Go</Text>
      </View>

      {tab === "play" && (
        <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
          <Text style={styles.eyebrow}>FREE · MOBILE · NO DOWNLOADS</Text>
          <Text style={styles.heroTitle}>
            Every great <Text style={styles.accent}>web game</Text>, one marquee away.
          </Text>
          <Text style={styles.lede}>
            Word games, drawing games, shooters, and puzzles — rotating so you always spot something new.
          </Text>
          <View style={styles.stats}>
            <Text style={styles.stat}>
              <Text style={styles.statStrong}>{allGames.length}</Text> games
            </Text>
            <Text style={styles.stat}>
              <Text style={styles.statStrong}>0</Text> installs
            </Text>
            <Text style={styles.stat}>
              <Text style={styles.statStrong}>$0</Text> to play
            </Text>
          </View>

          <Text style={styles.sectionEyebrow}>NOW ON THE MARQUEE</Text>
          <Text style={styles.sectionTitle}>Tap a cabinet</Text>

          <ScrollView
            ref={listRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={SNAP}
            decelerationRate="fast"
            contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 12 }}
            onMomentumScrollEnd={(e) => {
              const i = Math.round(e.nativeEvent.contentOffset.x / SNAP);
              setIndex(Math.max(0, Math.min(i, cabinetGames.length - 1)));
            }}
          >
            {cabinetGames.map((item, i) => (
              <Pressable
                key={item.id}
                onPress={() => setSelected(item)}
                style={[styles.cabCard, i === index && styles.cabCardActive, { width: CARD_WIDTH, marginRight: CARD_GAP }]}
              >
                <Text style={styles.cabIcon}>{item.icon}</Text>
                <Tag label={item.category} />
                <Text style={styles.cabName}>{item.name}</Text>
                <Text style={styles.cabDesc} numberOfLines={3}>
                  {item.desc}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.controls}>
            <Pressable style={styles.ctrlBtn} onPress={() => step(-1)}>
              <Text style={styles.ctrlTxt}>‹</Text>
            </Pressable>
            <Pressable
              style={styles.ctrlPill}
              onPress={() => setPlaying((p) => !p)}
            >
              <Text style={styles.ctrlPillTxt}>{playing ? "⏸ Pause" : "▶ Resume"}</Text>
            </Pressable>
            <Pressable
              style={styles.ctrlPill}
              onPress={() => {
                setOrder(shuffle(allGames.map((_, i) => i)));
                setIndex(0);
                listRef.current?.scrollTo({ x: 0, animated: true });
              }}
            >
              <Text style={styles.ctrlPillTxt}>🎲 Shuffle</Text>
            </Pressable>
            <Pressable style={styles.ctrlBtn} onPress={() => step(1)}>
              <Text style={styles.ctrlTxt}>›</Text>
            </Pressable>
          </View>

          <Pressable style={styles.primary} onPress={() => setTab("library")}>
            <Text style={styles.primaryTxt}>See all games</Text>
          </Pressable>
        </ScrollView>
      )}

      {tab === "library" && (
        <View style={styles.flex}>
          <View style={styles.libraryHead}>
            <Text style={styles.sectionEyebrow}>FULL LIBRARY</Text>
            <Text style={styles.sectionTitle}>Search, filter, add yours</Text>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search games… e.g. drawing, io, chess"
              placeholderTextColor={colors.muted2}
              style={styles.search}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
              {CATEGORIES.map((c) => (
                <Pressable key={c} onPress={() => setCategory(c)} style={[styles.pill, category === c && styles.pillOn]}>
                  <Text style={[styles.pillTxt, category === c && styles.pillTxtOn]}>{c}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(g) => g.id}
            contentContainerStyle={styles.libList}
            ListEmptyComponent={
              <Text style={styles.empty}>No games match that yet — add one below.</Text>
            }
            ListFooterComponent={
              <Pressable style={styles.addCard} onPress={() => setAddOpen(true)}>
                <Text style={styles.plus}>+</Text>
                <Text style={styles.addTxt}>Add your own game</Text>
              </Pressable>
            }
            renderItem={({ item }) => (
              <Pressable style={styles.libCard} onPress={() => setSelected(item)}>
                <View style={styles.libTop}>
                  <Text style={styles.libIcon}>{item.icon}</Text>
                  <View style={styles.flex}>
                    <Text style={styles.libName}>{item.name}</Text>
                    <Tag label={item.category} />
                  </View>
                </View>
                <Text style={styles.libDesc} numberOfLines={3}>
                  {item.desc}
                </Text>
                {item.mobileFriendly ? <Text style={styles.mobileReady}>📱 Mobile friendly</Text> : null}
                {item.isCommunity ? <Text style={styles.community}>★ Added on this device</Text> : null}
              </Pressable>
            )}
          />
        </View>
      )}

      {tab === "deals" && (
        <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionEyebrow}>BEYOND FREE-TO-PLAY</Text>
          <Text style={styles.sectionTitle}>Right now on sale</Text>
          <Text style={styles.lede}>A rotating mix from Steam, Epic Games, and Google Play. Tap a ticket to open the store.</Text>
          <View style={styles.badge}>
            {dealsLoading ? <ActivityIndicator color={colors.mint} size="small" /> : <View style={styles.pulse} />}
            <Text style={styles.badgeTxt}>
              {dealsLoading ? "Loading…" : dealsLive ? "Live Steam prices + curated offers" : "Curated offers — live feed unavailable"}
            </Text>
          </View>
          <View style={styles.currencyRow}>
            <Text style={styles.currencyTxt}>
              {currency.detected ? `Prices converted to ${currency.code}` : "Detecting local currency…"}
            </Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
            {DEAL_STORES.map((store) => (
              <Pressable
                key={store}
                onPress={() => {
                  setDealStore(store);
                  setShowAllDeals(false);
                }}
                style={[styles.pill, dealStore === store && styles.pillOn]}
              >
                <Text style={[styles.pillTxt, dealStore === store && styles.pillTxtOn]}>{store}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.dealViewport}>
            <ScrollView
              ref={dealListRef}
              nestedScrollEnabled
              showsVerticalScrollIndicator
              snapToInterval={DEAL_SNAP}
              decelerationRate="fast"
              onScrollBeginDrag={pauseDealAutoScroll}
              onTouchStart={pauseDealAutoScroll}
              onMomentumScrollEnd={(event) => {
                const next = Math.round(event.nativeEvent.contentOffset.y / DEAL_SNAP);
                setDealIndex(Math.max(0, Math.min(next, visibleDeals.length - 1)));
              }}
            >
              {visibleDeals.map((deal) => (
                <Pressable
                  key={deal.store + deal.title + deal.link}
                  style={styles.deal}
                  onPress={() => openUrl(deal.link)}
                >
                  <Text style={styles.dealStore}>{deal.store.toUpperCase()}</Text>
                  <Text style={styles.dealTitle} numberOfLines={1}>{deal.title}</Text>
                  <View style={styles.dealRow}>
                    <Text style={styles.dealSale}>{formatMoney(deal.salePrice)}</Text>
                    {deal.normalPrice > deal.salePrice ? (
                      <Text style={styles.dealNormal}>{formatMoney(deal.normalPrice)}</Text>
                    ) : null}
                    <Text style={styles.dealSave}>-{deal.savings}%</Text>
                  </View>
                  <Text style={styles.dealLink}>View deal ↗</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          <Text style={styles.autoNote}>
            {dealAutoPaused ? "Manual scroll detected · auto-scroll resumes in 10 seconds" : "Auto-scrolling · swipe anytime"}
          </Text>
          {filteredDeals.length > 6 ? (
            <Pressable style={styles.viewMore} onPress={() => setShowAllDeals((shown) => !shown)}>
              <Text style={styles.viewMoreTxt}>
                {showAllDeals ? "Show fewer deals" : `View more deals (${filteredDeals.length - 6})`}
              </Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.linkRow} onPress={() => openUrl("https://store.steampowered.com/specials")}>
            <Text style={styles.linkTxt}>All Steam specials ↗</Text>
          </Pressable>
          <Pressable style={styles.linkRow} onPress={() => openUrl("https://store.epicgames.com/en-US/free-games")}>
            <Text style={styles.linkTxt}>Epic Games freebies ↗</Text>
          </Pressable>
          <Pressable
            style={styles.linkRow}
            onPress={() => openUrl("https://play.google.com/store/apps/collection/promotion_3000000e64_offers")}
          >
            <Text style={styles.linkTxt}>Google Play offers ↗</Text>
          </Pressable>
        </ScrollView>
      )}

      <View style={styles.tabbar}>
        {(
          [
            ["play", "Play"],
            ["library", "Library"],
            ["deals", "Deals"],
          ] as const
        ).map(([id, label]) => (
          <Pressable key={id} style={styles.tab} onPress={() => setTab(id)}>
            <Text style={[styles.tabTxt, tab === id && styles.tabTxtOn]}>{label}</Text>
            {tab === id ? <View style={styles.tabDot} /> : null}
          </Pressable>
        ))}
      </View>

      <Modal visible={!!selected} animationType="slide" transparent onRequestClose={() => setSelected(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            {selected ? (
              <>
                <Text style={styles.modalIcon}>{selected.icon}</Text>
                <Text style={styles.modalTitle}>{selected.name}</Text>
                <Tag label={selected.category} />
                <Text style={styles.modalDesc}>{selected.desc}</Text>
                {selected.mobileFriendly ? <Text style={styles.mobileReady}>📱 Optimized for mobile browsers</Text> : null}
                <View style={styles.tagRow}>
                  {selected.tags.map((t) => (
                    <Text key={t} style={styles.softTag}>
                      {t}
                    </Text>
                  ))}
                </View>
                <Pressable style={styles.primary} onPress={() => openUrl(selected.url)}>
                  <Text style={styles.primaryTxt}>Play now</Text>
                </Pressable>
                <Pressable style={styles.ghost} onPress={() => setSelected(null)}>
                  <Text style={styles.ghostTxt}>Close</Text>
                </Pressable>
                <Text style={styles.domain}>Opens {domainOf(selected.url)}</Text>
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal visible={addOpen} animationType="slide" transparent onRequestClose={() => setAddOpen(false)}>
        <View style={styles.modalBackdrop}>
          <ScrollView contentContainerStyle={styles.modal} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>Add a game</Text>
            <Text style={styles.formNote}>Standalone browser game only. Saved on this phone.</Text>
            <Text style={styles.label}>Game name</Text>
            <TextInput style={styles.input} value={form.name} onChangeText={(name) => setForm({ ...form, name })} placeholder="e.g. Wordle" placeholderTextColor={colors.muted2} />
            <Text style={styles.label}>Link</Text>
            <TextInput style={styles.input} autoCapitalize="none" value={form.url} onChangeText={(url) => setForm({ ...form, url })} placeholder="https://example.com" placeholderTextColor={colors.muted2} />
            <Text style={styles.label}>Category</Text>
            <View style={styles.pills}>
              {["Word", "Drawing", "Arcade", "Puzzle", "Strategy"].map((c) => (
                <Pressable key={c} onPress={() => setForm({ ...form, category: c })} style={[styles.pill, form.category === c && styles.pillOn]}>
                  <Text style={[styles.pillTxt, form.category === c && styles.pillTxtOn]}>{c}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              multiline
              value={form.desc}
              onChangeText={(desc) => setForm({ ...form, desc })}
              placeholder="What makes it worth playing?"
              placeholderTextColor={colors.muted2}
            />
            <Pressable style={styles.primary} onPress={submitGame}>
              <Text style={styles.primaryTxt}>Add to Hub</Text>
            </Pressable>
            <Pressable style={styles.ghost} onPress={() => setAddOpen(false)}>
              <Text style={styles.ghostTxt}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      {toast ? (
        <View style={styles.toast}>
          <Text style={styles.toastTxt}>{toast}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: 48 },
  flex: { flex: 1 },
  topbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingHorizontal: 20,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  brand: { color: colors.text, fontSize: 18, fontWeight: "800", letterSpacing: 0.6 },
  brandDot: { color: colors.amber },
  brandSub: { color: colors.muted2, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase" },
  page: { padding: 20, paddingBottom: 40 },
  eyebrow: { color: colors.mint, fontSize: 11, letterSpacing: 1.6, marginBottom: 12, fontWeight: "600" },
  heroTitle: { color: colors.text, fontSize: 28, fontWeight: "800", lineHeight: 34, marginBottom: 12 },
  accent: { color: colors.amber },
  lede: { color: colors.muted, fontSize: 15, lineHeight: 22, marginBottom: 16 },
  stats: { flexDirection: "row", gap: 16, marginBottom: 28, flexWrap: "wrap" },
  stat: { color: colors.muted2, fontSize: 12 },
  statStrong: { color: colors.text, fontSize: 14, fontWeight: "700" },
  sectionEyebrow: { color: colors.muted2, fontSize: 11, letterSpacing: 1.4, marginBottom: 6 },
  sectionTitle: { color: colors.text, fontSize: 22, fontWeight: "800", marginBottom: 12 },
  cabCard: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.line,
    opacity: 0.72,
  },
  cabCardActive: { opacity: 1, borderColor: colors.lineStrong, transform: [{ scale: 1 }] },
  cabIcon: { fontSize: 32, marginBottom: 10 },
  cabName: { color: colors.text, fontSize: 16, fontWeight: "700", marginTop: 8, marginBottom: 6 },
  cabDesc: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  tag: { alignSelf: "flex-start", overflow: "hidden", paddingHorizontal: 9, paddingVertical: 3, borderRadius: 100, fontSize: 10, letterSpacing: 0.6, textTransform: "uppercase", fontWeight: "700" },
  controls: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" },
  ctrlBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong, alignItems: "center", justifyContent: "center" },
  ctrlTxt: { color: colors.text, fontSize: 22 },
  ctrlPill: { height: 42, paddingHorizontal: 14, borderRadius: 21, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong, justifyContent: "center" },
  ctrlPillTxt: { color: colors.text, fontSize: 12, fontWeight: "600" },
  primary: { backgroundColor: colors.amber, borderRadius: 100, paddingVertical: 14, alignItems: "center", marginTop: 22 },
  primaryTxt: { color: colors.amberInk, fontWeight: "800", fontSize: 15 },
  libraryHead: { paddingHorizontal: 20, paddingTop: 8 },
  search: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong, color: colors.text, borderRadius: 100, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 10 },
  pills: { flexDirection: "row", gap: 8, paddingBottom: 12, flexWrap: "wrap" },
  pill: { borderWidth: 1, borderColor: colors.lineStrong, borderRadius: 100, paddingHorizontal: 14, paddingVertical: 8 },
  pillOn: { backgroundColor: colors.text, borderColor: colors.text },
  pillTxt: { color: colors.muted, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" },
  pillTxtOn: { color: colors.bg, fontWeight: "700" },
  libList: { padding: 20, paddingBottom: 40 },
  libCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.line, marginBottom: 12 },
  libTop: { flexDirection: "row", gap: 12, marginBottom: 8 },
  libIcon: { fontSize: 24, width: 42, height: 42, textAlign: "center", textAlignVertical: "center" },
  libName: { color: colors.text, fontWeight: "700", marginBottom: 4 },
  libDesc: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  community: { color: colors.mint, fontSize: 11, marginTop: 8 },
  mobileReady: { color: colors.amber, fontSize: 11, marginTop: 8, fontWeight: "600" },
  addCard: { borderWidth: 1, borderStyle: "dashed", borderColor: colors.lineStrong, borderRadius: 14, padding: 22, alignItems: "center", marginTop: 4 },
  plus: { color: colors.mint, fontSize: 28, marginBottom: 4 },
  addTxt: { color: colors.muted },
  empty: { color: colors.muted, textAlign: "center", marginBottom: 16 },
  badge: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  pulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.mint },
  badgeTxt: { color: colors.muted, fontSize: 12 },
  currencyRow: { marginBottom: 12 },
  currencyTxt: { color: colors.amber, fontSize: 12, fontWeight: "600" },
  dealViewport: { height: 456, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.bg2 },
  deal: { height: DEAL_CARD_HEIGHT, backgroundColor: colors.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: colors.line, marginBottom: DEAL_GAP },
  dealStore: { color: colors.muted2, fontSize: 10, letterSpacing: 1 },
  dealTitle: { color: colors.text, fontSize: 16, fontWeight: "700", marginVertical: 6 },
  dealRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginBottom: 8 },
  dealSale: { color: colors.mint, fontSize: 16, fontWeight: "700" },
  dealNormal: { color: colors.muted2, textDecorationLine: "line-through" },
  dealSave: { color: colors.mint, backgroundColor: "rgba(62,217,166,0.16)", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 100, fontSize: 11 },
  dealLink: { color: colors.text, fontSize: 13 },
  autoNote: { color: colors.muted2, fontSize: 11, marginTop: 10, textAlign: "center" },
  viewMore: { borderWidth: 1, borderColor: colors.lineStrong, borderRadius: 100, paddingVertical: 11, alignItems: "center", marginTop: 12 },
  viewMoreTxt: { color: colors.text, fontSize: 12, fontWeight: "700" },
  linkRow: { marginTop: 8 },
  linkTxt: { color: colors.muted, fontSize: 13, textDecorationLine: "underline" },
  tabbar: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.bg2, paddingBottom: 18, paddingTop: 8 },
  tab: { flex: 1, alignItems: "center", paddingVertical: 8 },
  tabTxt: { color: colors.muted2, fontSize: 12, letterSpacing: 0.8, textTransform: "uppercase" },
  tabTxtOn: { color: colors.amber, fontWeight: "800" },
  tabDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.amber, marginTop: 6 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(10,7,24,0.78)", justifyContent: "flex-end" },
  modal: { backgroundColor: colors.surface2, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 24, paddingBottom: 36 },
  modalIcon: { fontSize: 40, marginBottom: 8 },
  modalTitle: { color: colors.text, fontSize: 22, fontWeight: "800", marginBottom: 8 },
  modalDesc: { color: colors.muted, marginTop: 12, lineHeight: 21 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  softTag: { color: colors.muted, backgroundColor: "rgba(255,255,255,0.06)", overflow: "hidden", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100, fontSize: 11 },
  ghost: { borderWidth: 1, borderColor: colors.lineStrong, borderRadius: 100, paddingVertical: 13, alignItems: "center", marginTop: 10 },
  ghostTxt: { color: colors.text },
  domain: { color: colors.muted2, fontSize: 12, marginTop: 12, textAlign: "center" },
  formNote: { color: colors.muted2, marginBottom: 12 },
  label: { color: colors.muted, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6, marginTop: 8 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong, color: colors.text, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11 },
  textarea: { minHeight: 80, textAlignVertical: "top" },
  toast: { position: "absolute", bottom: 88, alignSelf: "center", backgroundColor: colors.mint, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 100 },
  toastTxt: { color: "#072B21", fontWeight: "700" },
});
