import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  BookmarkCheck,
  BookOpen,
  Loader2,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { aiFormulaLookup } from '../lib/aiClient';
import type { SubjectKey } from '../types/exam';
import { normalizeAiFormulaCards, type FormulaCardItem } from '../utils/studyCoach';

interface StudyFormulaBoosterModalProps {
  onClose: () => void;
}

interface BilingualFormulaEntry extends FormulaCardItem {
  titleHi: string;
  contentHi: string;
  examTipHi: string;
}

const SAVED_AI_FORMULAS_KEY = 'getcgl_saved_ai_formulas_v1';

const BOOSTER_ENTRIES: BilingualFormulaEntry[] = [
  // Quant
  {
    id: 'builtin_quant_algebra_1',
    subject: 'quant',
    topic: 'Algebra',
    title: 'Reciprocal Identities (x + 1/x)',
    titleHi: 'व्युत्क्रम सूत्र (x + 1/x पहचान)',
    content:
      'If x + 1/x = k: then x² + 1/x² = k² − 2, x³ + 1/x³ = k³ − 3k, and x⁵ + 1/x⁵ = (x² + 1/x²)(x³ + 1/x³) − (x + 1/x). If x + 1/x = √3, then x⁶ = −1.',
    contentHi:
      'यदि x + 1/x = k हो: तो x² + 1/x² = k² − 2, x³ + 1/x³ = k³ − 3k, और x⁵ + 1/x⁵ = (x² + 1/x²)(x³ + 1/x³) − (x + 1/x). यदि x + 1/x = √3 हो, तो x⁶ = −1.',
    examTip: 'When x + 1/x = 2, put x = 1 directly; when x + 1/x = −2, put x = −1.',
    examTipHi: 'जब x + 1/x = 2 हो तो सीधे x = 1 रखें; जब x + 1/x = −2 हो तो x = −1 रखें।',
  },
  {
    id: 'builtin_quant_trig_1',
    subject: 'quant',
    topic: 'Trigonometry',
    title: 'SSC Favourite Trig Identities & Max/Min',
    titleHi: 'त्रिकोणमिति (Trigonometry) के प्रमुख सूत्र और Max/Min',
    content:
      'sec²θ − tan²θ = 1 ⇒ (secθ − tanθ) = 1/(secθ + tanθ). For a·sinθ + b·cosθ: Max = +√(a² + b²), Min = −√(a² + b²).',
    contentHi:
      'sec²θ − tan²θ = 1 ⇒ (secθ − tanθ) = 1/(secθ + tanθ). a·sinθ + b·cosθ के लिए: अधिकतम मान = +√(a² + b²), न्यूनतम मान = −√(a² + b²).',
    examTip: 'Value-putting (θ = 0°, 45°, 90°) solves 60% of Tier-I trig MCQs in <15 seconds (avoid 0/0 denominator).',
    examTipHi: 'θ = 0°, 45°, 90° मान रखकर (Value-putting) Tier-I के 60% सवाल 15 सेकंड से कम में हल होते हैं (0/0 से बचें)।',
  },
  {
    id: 'builtin_quant_geom_1',
    subject: 'quant',
    topic: 'Geometry',
    title: 'Circle & Triangle Quick Theorems',
    titleHi: 'वृत्त (Circle) और त्रिभुज के त्वरित प्रमेय',
    content:
      'Alternate Segment Theorem: Angle between tangent and chord = angle in alternate segment. Chord intersection: PA × PB = PC × PD = PT². Incenter angle ∠BIC = 90° + ∠A/2; Excenter = 90° − ∠A/2.',
    contentHi:
      'Alternate Segment Theorem: स्पर्शरेखा और जीवा का कोण = एकांतर वृत्तखंड का कोण। जीवा प्रतिच्छेदन: PA × PB = PC × PD = PT²। अंतःकेंद्र ∠BIC = 90° + ∠A/2; बहिष्केंद्र = 90° − ∠A/2.',
    examTip: 'Common external tangent length = √(d² − (r₁ − r₂)²); Transverse tangent = √(d² − (r₁ + r₂)²).',
    examTipHi: 'उभयनिष्ठ बाह्य स्पर्शरेखा = √(d² − (r₁ − r₂)²); तिर्यक स्पर्शरेखा = √(d² − (r₁ + r₂)²).',
  },
  {
    id: 'builtin_quant_mens_1',
    subject: 'quant',
    topic: 'Mensuration',
    title: '3D Volume & Ratio Shortcuts',
    titleHi: '3D क्षेत्रमिति (Mensuration) आयतन व अनुपात शॉर्टकट',
    content:
      'Cylinder : Cone : Hemisphere (equal r and h = r) volume ratio = 3 : 1 : 2. Sphere volume = (4/3)πr³; Frustum volume = (1/3)πh(R² + r² + Rr).',
    contentHi:
      'बेलन : शंकु : अर्धगोला (समान r व h = r) आयतन अनुपात = 3 : 1 : 2। गोले का आयतन = (4/3)πr³; छिन्नक (Frustum) = (1/3)πh(R² + r² + Rr).',
    examTip: 'Use π = 22/7 and check divisibility by 11 or 7 on options first before multiplying!',
    examTipHi: 'गुणा करने से पहले विकल्पों (options) में 11 या 7 से विभाज्यता (divisibility) जांच लें!',
  },
  {
    id: 'builtin_quant_pl_1',
    subject: 'quant',
    topic: 'Profit & Loss',
    title: 'Successive Discount & Dishonest Shopkeeper',
    titleHi: 'क्रमिक छूट (Discount) और बेईमान दुकानदार ट्रिक',
    content:
      'Equivalent discount of x% & y% = x + y − (xy/100)%. CP / MP = (100 − Discount%) / (100 + Profit%).',
    contentHi:
      'x% और y% की समतुल्य छूट = x + y − (xy/100)%। क्रय मूल्य / अंकित मूल्य (CP/MP) = (100 − छूट%) / (100 + लाभ%)।',
    examTip: 'For dishonest weight (uses w instead of 1000g): Profit% = ((1000 − w) / w) × 100.',
    examTipHi: 'गलत बाट (1000g के बदले w ग्राम तोलने पर): लाभ% = ((1000 − w) / w) × 100।',
  },
  {
    id: 'builtin_quant_tsw_1',
    subject: 'quant',
    topic: 'Time, Speed & Work',
    title: 'Average Speed & Efficiency',
    titleHi: 'औसत चाल और कार्यक्षमता (Efficiency) सूत्र',
    content:
      'Equal distance at speeds a & b: Avg speed = 2ab / (a + b). Same distance ratio: Speed ∝ 1/Time. M₁D₁H₁/W₁ = M₂D₂H₂/W₂.',
    contentHi:
      'समान दूरी चाल a व b से तय करने पर: औसत चाल = 2ab / (a + b)। समान दूरी के लिए चाल ∝ 1/समय। M₁D₁H₁/W₁ = M₂D₂H₂/W₂.',
    examTip: 'Convert km/h to m/s by multiplying × (5/18); m/s to km/h by × (18/5).',
    examTipHi: 'km/h को m/s में बदलने के लिए × (5/18) करें; m/s से km/h के लिए × (18/5) करें।',
  },
  // Reasoning
  {
    id: 'builtin_reas_sylo_1',
    subject: 'reasoning',
    topic: 'Syllogism',
    title: '100-50 Rule & Either-Or Conditions',
    titleHi: 'न्याय निगमन (Syllogism) 100-50 नियम व Either-Or शर्तें',
    content:
      'All A are B ⇒ A=100, B=50. Some A are B ⇒ A=50, B=50. No A is B ⇒ A=100, B=100. Either-Or needs: (1) Same elements, (2) Both conclusions individually false, (3) One positive + one negative.',
    contentHi:
      'सभी A, B हैं ⇒ A=100, B=50। कुछ A, B हैं ⇒ A=50, B=50। कोई A, B नहीं ⇒ A=100, B=100। Either-Or शर्तें: (1) समान पद, (2) दोनों निष्कर्ष अलग-अलग गलत, (3) एक सकारात्मक + एक नकारात्मक।',
    examTip: 'Never assume "Some A are B" means "Some A are NOT B".',
    examTipHi: '"कुछ A, B हैं" का अर्थ कभी भी "कुछ A, B नहीं हैं" न मानें।',
  },
  {
    id: 'builtin_reas_dice_1',
    subject: 'reasoning',
    topic: 'Dice & Cube',
    title: 'One-Common & Two-Common Face Rules',
    titleHi: 'पासा (Dice) और घन (Cube) के विपरीत फलक नियम',
    content:
      'Two faces common ⇒ remaining third faces are opposite. One face common ⇒ rotate clockwise from common face in both views to map opposite pairs. Painted cube (n×n×n): 3-face=8, 2-face=12(n−2), 1-face=6(n−2)², 0-face=(n−2)³.',
    contentHi:
      'दो फलक समान ⇒ बचे तीसरे फलक विपरीत होते हैं। एक फलक समान ⇒ दोनों में समान फलक से घड़ी की दिशा (clockwise) घूमकर विपरीत निकालें। रंगा घन (n×n×n): 3-सतह=8, 2-सतह=12(n−2), 1-सतह=6(n−2)², 0-सतह=(n−2)³।',
    examTip: 'In open dice, alternate boxes in a straight line are always opposite.',
    examTipHi: 'खुले पासे (Open Dice) में सीधी लाइन का हर एकान्तर (alternate) बॉक्स विपरीत होता है।',
  },
  {
    id: 'builtin_reas_clock_1',
    subject: 'reasoning',
    topic: 'Clock & Calendar',
    title: 'Angle & Odd-Days Formula',
    titleHi: 'घड़ी का कोण और कैलेंडर विषम दिन (Odd Days) सूत्र',
    content:
      'Angle between hands at H:M = |30H − 5.5M|°. Calendar odd days: 100 yrs = 5, 200 = 3, 300 = 1, 400 = 0. Leap year repeats after +28 yrs (unless crossing non-leap century).',
    contentHi:
      'H:M बजे सुइयों के बीच कोण = |30H − 5.5M|°। कैलेंडर विषम दिन: 100 वर्ष = 5, 200 = 3, 300 = 1, 400 = 0। लीप वर्ष +28 वर्ष बाद दोहराता है।',
    examTip: 'Month code (non-leap) or anchor dates like 15 Aug 1947 (Friday) save 30 seconds.',
    examTipHi: 'महीने के कोड या एंकर तारीख (15 Aug 1947 = शुक्रवार) याद रखने से 30 सेकंड बचते हैं।',
  },
  // English
  {
    id: 'builtin_eng_gram_1',
    subject: 'english',
    topic: 'Grammar Rules',
    title: 'Conditionals & Inversion Traps',
    titleHi: 'अंग्रेजी ग्रामर: Conditionals और Inversion के नियम',
    content:
      'Type 3: If + Subject + had + V3, Subject + would have + V3 (never "would have" inside the If-clause). Hardly/Scarcely takes "when" and inversion (Hardly had he arrived when...). No sooner takes "than".',
    contentHi:
      'Type 3: If + Subject + had + V3, Subject + would have + V3 (If वाले हिस्से में "would have" न लगाएं)। Hardly/Scarcely के साथ "when" व inversion आता है। No sooner के साथ हमेशा "than" लगता है।',
    examTip: '"Lest" is always followed by "should" (never "not").',
    examTipHi: '"Lest" के बाद हमेशा "should" आता है ("not" कभी नहीं लगता)।',
  },
  {
    id: 'builtin_eng_prep_1',
    subject: 'english',
    topic: 'Prepositions & Verbs',
    title: 'SSC Fixed Preposition Must-Knows',
    titleHi: 'SSC के Fixed Prepositions और Subject-Verb नियम',
    content:
      'Comprise (no "of" in active voice) = Consist of. Cope with (never "cope up with"). Discuss/Describe/Order/Attack/Resemble take NO preposition in active voice. Senior/Junior/Prefer take "to", not "than".',
    contentHi:
      'Comprise (active में "of" नहीं) = Consist of। Cope with होता है ("cope up with" गलत है)। Discuss/Describe/Attack के साथ active में preposition नहीं लगता। Senior/Junior/Prefer के साथ "to" आता है।',
    examTip: '"Each of / One of / Neither of" + Plural Noun + Singular Verb.',
    examTipHi: '"Each of / One of / Neither of" के बाद Plural Noun और Singular Verb आता है।',
  },
  {
    id: 'builtin_eng_cloze_1',
    subject: 'english',
    topic: 'Cloze & Comprehension',
    title: 'Cloze Test 3-Step Elimination',
    titleHi: 'Cloze Test हल करने की 3-स्टेप ट्रिक',
    content:
      '1) Read whole passage first for tone (+ve/-ve) and tense. 2) Check collocation & preposition immediately after the blank. 3) Eliminate grammatically wrong parts of speech before picking vocabulary.',
    contentHi:
      '1) पहले पूरा passage पढ़कर tone (+ve/-ve) और tense समझें। 2) Blank के तुरंत बाद वाला preposition और collocation देखें। 3) गलत parts of speech को पहले eliminate करें।',
    examTip: 'Never pick a blank solely on the sentence before—often the clue is in the very next sentence.',
    examTipHi: 'सिर्फ पिछला वाक्य देखकर विकल्प न चुनें—अक्सर असली संकेत अगले वाक्य में होता है।',
  },
  // GA
  {
    id: 'builtin_ga_polity_1',
    subject: 'ga',
    topic: 'Polity',
    title: 'High-Frequency Articles & Amendments',
    titleHi: 'संविधान (Polity): महत्वपूर्ण अनुच्छेद व संशोधन',
    content:
      'Art 14–18 Equality, Art 19–22 Freedom, Art 32 Constitutional Remedies, Art 40 Panchayats, Art 44 UCC, Art 51A Fundamental Duties (42nd Amend 1976, Swaran Singh Committee), Art 280 Finance Commission, Art 368 Amendment.',
    contentHi:
      'अनु. 14–18 समानता, 19–22 स्वतंत्रता, 32 संवैधानिक उपचार, 40 पंचायत, 44 UCC, 51A मौलिक कर्तव्य (42वां संशोधन 1976), अनु. 280 वित्त आयोग, अनु. 368 संविधान संशोधन।',
    examTip:
      '61st Amend (voting age 21→18), 73rd/74th (Panchayat/Municipality), 86th (Art 21A Right to Education), 101st (GST).',
    examTipHi:
      '61वां संशोधन (मतदान उम्र 21→18), 73/74वां (पंचायत/नगरपालिका), 86वां (शिक्षा का अधिकार Art 21A), 101वां (GST)।',
  },
  {
    id: 'builtin_ga_art_1',
    subject: 'ga',
    topic: 'Art & Culture',
    title: '8 Classical Dances & Gharana Maestros',
    titleHi: '8 शास्त्रीय नृत्य और प्रमुख वाद्ययंत्र कलाकार',
    content:
      'Bharatanatyam (TN), Kathak (UP/North), Kathakali & Mohiniyattam (Kerala), Kuchipudi (AP), Odissi (Odisha), Manipuri (Manipur), Sattriya (Assam — Srimanta Sankardev).',
    contentHi:
      'भरतनाट्यम (तमिलनाडु), कथक (उत्तर भारत/UP), कथकली व मोहिनीअट्टम (केरल), कुचिपुड़ी (आंध्र प्रदेश), ओडिसी (ओडिशा), मणिपुरी (मणिपुर), सत्रिया (असम — श्रीमंत शंकरदेव)।',
    examTip:
      'SSC loves matching musical instruments (Santoor-Shivkumar Sharma, Shehnai-Bismillah Khan, Tabla-Alla Rakha/Zakir Hussain) with Padma awards.',
    examTipHi:
      'संतूर-शिवकुमार शर्मा, शहनाई-बिस्मिल्लाह खान, तबला-अल्ला रक्खा/ज़ाकिर हुसैन और उनके पद्म पुरस्कार SSC बार-बार पूछता है।',
  },
  {
    id: 'builtin_ga_sci_1',
    subject: 'ga',
    topic: 'Science & Geography',
    title: 'Vitamins, Alloys & Indian River Tributaries',
    titleHi: 'विटामिन, मिश्रधातु (Alloys) और भारतीय नदियां',
    content:
      'Fat-soluble vitamins: A, D, E, K. Water-soluble: B-complex & C. Brass = Cu+Zn, Bronze = Cu+Sn, Solder = Pb+Sn. Ganga left-bank: Gomti, Ghaghara, Gandak, Kosi; Right-bank: Yamuna, Son.',
    contentHi:
      'वसा में घुलनशील विटामिन: A, D, E, K। पानी में घुलनशील: B व C। पीतल = Cu+Zn, कांसा = Cu+Sn, टांका (Solder) = Pb+Sn। गंगा बाईं सहायक: गोमती, घाघरा, गंडक, कोसी; दाईं: यमुना, सोन।',
    examTip:
      'Remember SI units (Force-Newton, Pressure-Pascal, Power-Watt, Charge-Coulomb, Resistance-Ohm) for easy 2 marks.',
    examTipHi:
      'SI मात्रक (बल-न्यूटन, दाब-पास्कल, शक्ति-वाट, आवेश-कूलॉम, प्रतिरोध-ओम) पक्के 2 नंबर दिलाते हैं।',
  },
];

const SUBJECT_TABS: Array<{ id: 'all' | SubjectKey; label: string }> = [
  { id: 'all', label: 'All Subjects' },
  { id: 'quant', label: 'Quant' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'english', label: 'English' },
  { id: 'ga', label: 'GA / GK' },
];

const QUICK_AI_TOPICS: Array<{ label: string; query: string; subject: 'all' | SubjectKey }> = [
  { label: 'Boat & Stream', query: 'Boat and Stream shortcuts and formulas', subject: 'quant' },
  { label: 'Mixture & Alligation', query: 'Mixture and Alligation replacement formula', subject: 'quant' },
  { label: 'SI & CI Difference', query: 'Compound and Simple Interest 2 year 3 year difference formula', subject: 'quant' },
  { label: 'Active & Passive Voice', query: 'Active and Passive Voice tense conversion rules', subject: 'english' },
  { label: 'Number Series Tricks', query: 'SSC Reasoning number series difference patterns', subject: 'reasoning' },
  { label: 'Amendments & Plans', query: 'SSC CGL Constitutional Amendments and Five Year Plans', subject: 'ga' },
];

function loadSavedAiFormulas(): FormulaCardItem[] {
  try {
    const raw = window.localStorage.getItem(SAVED_AI_FORMULAS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return normalizeAiFormulaCards(parsed, 'all');
  } catch {
    return [];
  }
}

export const StudyFormulaBoosterModal: React.FC<StudyFormulaBoosterModalProps> = ({ onClose }) => {
  const [subject, setSubject] = useState<'all' | SubjectKey>('all');
  const [query, setQuery] = useState('');
  const [aiLang, setAiLang] = useState<'en' | 'hi'>('en');
  const [showSavedOnly, setShowSavedOnly] = useState(false);

  const [aiCards, setAiCards] = useState<FormulaCardItem[]>([]);
  const [aiLastQuery, setAiLastQuery] = useState('');
  const [aiLastSubject, setAiLastSubject] = useState<'all' | SubjectKey>('all');
  const [aiCached, setAiCached] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  const [savedAiCards, setSavedAiCards] = useState<FormulaCardItem[]>(() => loadSavedAiFormulas());
  const aiSessionCacheRef = useRef<Map<string, FormulaCardItem[]>>(new Map());

  useEffect(() => {
    try {
      window.localStorage.setItem(SAVED_AI_FORMULAS_KEY, JSON.stringify(savedAiCards));
    } catch {
      // Ignore storage quota errors
    }
  }, [savedAiCards]);

  const savedKeySet = useMemo(() => {
    return new Set(savedAiCards.map((c) => `${c.subject}::${c.title.toLowerCase()}`));
  }, [savedAiCards]);

  const isCardSaved = (card: FormulaCardItem) =>
    savedKeySet.has(`${card.subject}::${card.title.toLowerCase()}`);

  const toggleSaveAiCard = (card: FormulaCardItem) => {
    const key = `${card.subject}::${card.title.toLowerCase()}`;
    setSavedAiCards((prev) => {
      const exists = prev.some((c) => `${c.subject}::${c.title.toLowerCase()}` === key);
      if (exists) {
        return prev.filter((c) => `${c.subject}::${c.title.toLowerCase()}` !== key);
      }
      return [{ ...card, isAi: true }, ...prev].slice(0, 24);
    });
  };

  const runAiFormulaLookup = async (
    customQuery?: string,
    customSubject?: 'all' | SubjectKey,
    customLang?: 'en' | 'hi'
  ) => {
    const effectiveQuery = (customQuery ?? query).trim();
    const effectiveSubject = customSubject ?? subject;
    const effectiveLang = customLang ?? aiLang;

    if (effectiveQuery.length < 2) {
      setAiError('Koi topic ya formula likho (kam se kam 2 letters), jaise "Boat and Stream" ya "Conditional tense".');
      return;
    }

    const sessionKey = `${effectiveSubject}:${effectiveLang}:${effectiveQuery.toLowerCase()}`;
    const instantHit = aiSessionCacheRef.current.get(sessionKey);
    if (instantHit) {
      setShowSavedOnly(false);
      setAiError('');
      setAiCards(instantHit);
      setAiLastQuery(effectiveQuery);
      setAiLastSubject(effectiveSubject);
      setAiCached(true);
      return;
    }

    setShowSavedOnly(false);
    setAiLoading(true);
    setAiError('');

    try {
      const payload = await aiFormulaLookup({
        query: effectiveQuery,
        subject: effectiveSubject,
        lang: effectiveLang,
      });

      const normalized = normalizeAiFormulaCards(payload.cards, effectiveSubject);
      if (normalized.length === 0) {
        setAiCards([]);
        setAiError('Is topic par formula card generate nahi ho paaya. Thoda specific topic likh kar try karo.');
      } else {
        aiSessionCacheRef.current.set(sessionKey, normalized);
        setAiCards(normalized);
        setAiLastQuery(effectiveQuery);
        setAiLastSubject(effectiveSubject);
        setAiCached(Boolean(payload.cached));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to reach AI formula service.';
      setAiError(msg);
    } finally {
      setAiLoading(false);
    }
  };

  const handleLangToggle = (nextLang: 'en' | 'hi') => {
    setAiLang(nextLang);
    // If AI formula cards are already visible, immediately translate them to the newly selected language!
    if (aiCards.length > 0 && aiLastQuery && !aiLoading) {
      void runAiFormulaLookup(aiLastQuery, aiLastSubject, nextLang);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runAiFormulaLookup();
  };

  const filteredBuiltin = useMemo(() => {
    const q = query.trim().toLowerCase();
    return BOOSTER_ENTRIES.filter((entry) => {
      if (subject !== 'all' && entry.subject !== subject) return false;
      if (!q) return true;
      return (
        entry.topic.toLowerCase().includes(q) ||
        entry.title.toLowerCase().includes(q) ||
        entry.titleHi.toLowerCase().includes(q) ||
        entry.content.toLowerCase().includes(q) ||
        entry.contentHi.toLowerCase().includes(q) ||
        entry.examTip.toLowerCase().includes(q) ||
        entry.examTipHi.toLowerCase().includes(q)
      );
    }).map<FormulaCardItem>((entry) => ({
      ...entry,
      title: aiLang === 'hi' ? entry.titleHi : entry.title,
      content: aiLang === 'hi' ? entry.contentHi : entry.content,
      examTip: aiLang === 'hi' ? entry.examTipHi : entry.examTip,
    }));
  }, [subject, query, aiLang]);

  const filteredSaved = useMemo(() => {
    const q = query.trim().toLowerCase();
    return savedAiCards.filter((entry) => {
      if (subject !== 'all' && entry.subject !== subject) return false;
      if (!q) return true;
      return (
        entry.topic.toLowerCase().includes(q) ||
        entry.title.toLowerCase().includes(q) ||
        entry.content.toLowerCase().includes(q) ||
        entry.examTip.toLowerCase().includes(q)
      );
    });
  }, [savedAiCards, subject, query]);

  const renderCard = (item: FormulaCardItem, allowSaveToggle: boolean) => {
    const saved = isCardSaved(item);
    return (
      <article
        key={item.id}
        className={`rounded-xl border p-4 space-y-2 ${
          item.isAi
            ? 'border-indigo-200 dark:border-indigo-800/70 bg-indigo-50/40 dark:bg-indigo-950/15'
            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131720]'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded border border-blue-200 dark:border-blue-800/60 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-800 dark:text-blue-300">
              {item.subject.toUpperCase()} · {item.topic}
            </span>
            {item.isAi && (
              <span className="inline-flex items-center gap-1 rounded border border-indigo-200 dark:border-indigo-700/60 bg-indigo-100/80 dark:bg-indigo-900/40 px-1.5 py-0.5 text-[10px] font-bold text-indigo-800 dark:text-indigo-200">
                <Sparkles className="h-2.5 w-2.5" aria-hidden="true" />
                AI Card
              </span>
            )}
          </div>

          {allowSaveToggle && (
            <button
              type="button"
              onClick={() => toggleSaveAiCard(item)}
              aria-label={saved ? `Remove ${item.title} from saved AI formulas` : `Save ${item.title} to pocket sheet`}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                saved
                  ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-200/80'
                  : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#181d27] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {saved ? (
                <>
                  <BookmarkCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  Saved
                </>
              ) : (
                <>
                  <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
                  Save
                </>
              )}
            </button>
          )}
        </div>

        <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
          {item.title}
        </h3>
        <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">
          {item.content}
        </p>

        {item.example && (
          <p className="rounded-lg border border-slate-200 dark:border-slate-700/80 bg-slate-50 dark:bg-[#10141c] px-2.5 py-1.5 text-[11px] text-slate-700 dark:text-slate-300">
            <strong>{aiLang === 'hi' ? 'उदाहरण:' : 'Example:'}</strong> {item.example}
          </p>
        )}

        {item.examTip && (
          <p className="rounded-lg border border-emerald-200/80 dark:border-emerald-800/50 bg-emerald-50/70 dark:bg-emerald-950/25 px-2.5 py-1.5 text-[11px] font-medium text-emerald-950 dark:text-emerald-200">
            <strong>{aiLang === 'hi' ? 'एग्जाम शॉर्टकट:' : 'Exam Shortcut:'}</strong> {item.examTip}
          </p>
        )}
      </article>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="formula-booster-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#181d27] shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 px-5 py-4">
          <div className="flex items-start gap-2.5">
            <BookOpen className="mt-0.5 h-5 w-5 text-blue-700 dark:text-blue-400 shrink-0" aria-hidden="true" />
            <div>
              <h2 id="formula-booster-title" className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                SSC CGL AI Formula &amp; Shortcut Pocket Sheet
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                High-yield built-in rules + instant AI lookup for any SSC CGL formula, grammar trap, or static GK fact.
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close Formula & Shortcut Sheet"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Filter + AI Search Controls */}
        <div className="flex flex-col gap-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#141923] px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {SUBJECT_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSubject(tab.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                    subject === tab.id
                      ? 'bg-blue-700 text-white'
                      : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e2431] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <div
                className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e2431] p-0.5"
                role="group"
                aria-label="Formula language"
              >
                <button
                  type="button"
                  onClick={() => handleLangToggle('en')}
                  className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                    aiLang === 'en'
                      ? 'bg-blue-700 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                  }`}
                >
                  EN
                </button>
                <button
                  type="button"
                  onClick={() => handleLangToggle('hi')}
                  className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                    aiLang === 'hi'
                      ? 'bg-blue-700 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                  }`}
                >
                  EN + हिं
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowSavedOnly((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  showSavedOnly
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e2431] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <BookmarkCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Saved AI ({savedAiCards.length})
              </button>
            </div>
          </div>

          <form onSubmit={handleSearchSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (aiError) setAiError('');
                }}
                placeholder="Type any topic (e.g. Boat & Stream, Circle Tangent, Active Passive) & press Enter for AI..."
                aria-label="Search built-in formulas or ask AI for any formula"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] py-2 pl-8 pr-3 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-700 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={aiLoading}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors cursor-pointer shrink-0"
            >
              {aiLoading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Fetching Formula...
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  Ask AI Formula
                </>
              )}
            </button>
          </form>

          {/* Quick Topic Prompt Chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mr-0.5">
              Quick AI Lookup:
            </span>
            {QUICK_AI_TOPICS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                disabled={aiLoading}
                onClick={() => {
                  setSubject(chip.subject);
                  setQuery(chip.query);
                  void runAiFormulaLookup(chip.query, chip.subject);
                }}
                className="rounded-md border border-indigo-200 dark:border-indigo-800/60 bg-white dark:bg-[#1a2030] px-2 py-1 text-[11px] font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 disabled:opacity-50 transition-colors cursor-pointer"
              >
                + {chip.label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {aiError && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-xs font-medium text-rose-800 dark:text-rose-200"
            >
              {aiError}
            </div>
          )}

          {aiLoading && (
            <div className="flex items-center gap-2.5 rounded-xl border border-indigo-200 dark:border-indigo-800/60 bg-indigo-50/70 dark:bg-indigo-950/20 px-4 py-3 text-xs font-medium text-indigo-800 dark:text-indigo-200">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden="true" />
              Generating SSC CGL revision cards for &ldquo;{query.trim() || 'your topic'}&rdquo;...
            </div>
          )}

          {showSavedOnly ? (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Saved AI Revision Cards ({filteredSaved.length})
                </h3>
                {savedAiCards.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSavedAiCards([])}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                    Clear All
                  </button>
                )}
              </div>

              {filteredSaved.length === 0 ? (
                <p className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                  Abhi koi AI formula save nahi hai. Upar &ldquo;Ask AI Formula&rdquo; se koi bhi topic search karke &ldquo;Save&rdquo; par click karo!
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
                  {filteredSaved.map((item) => renderCard(item, true))}
                </div>
              )}
            </section>
          ) : (
            <>
              {aiCards.length > 0 && (
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
                      <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                        AI Formula Cards for &ldquo;{aiLastQuery}&rdquo;
                      </h3>
                      {aiCached && (
                        <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                          Instant Cache
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setAiCards([]);
                        setAiLastQuery('');
                      }}
                      className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                    >
                      Clear AI Results
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
                    {aiCards.map((item) => renderCard(item, true))}
                  </div>
                </section>
              )}

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {aiLang === 'hi'
                      ? `बिल्ट-इन पॉकेट फॉर्मूला शीट (${filteredBuiltin.length})`
                      : `Built-in Pocket Formula Sheet (${filteredBuiltin.length})`}
                  </h3>
                </div>

                {filteredBuiltin.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center space-y-3">
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      Built-in sheet me &ldquo;{query}&rdquo; nahi mila — par AI se turant nikal sakte ho!
                    </p>
                    <button
                      type="button"
                      disabled={aiLoading}
                      onClick={() => void runAiFormulaLookup()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 cursor-pointer"
                    >
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                      Ask AI for &ldquo;{query.trim()}&rdquo;
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
                    {filteredBuiltin.map((item) => renderCard(item, false))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
