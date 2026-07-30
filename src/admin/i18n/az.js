// Console copy — Azerbaijani.
//
// Mirrors en.js key-for-key; i18n.test.mjs fails the suite if they drift.
//
// Terminology follows the vocabulary the platform's own user-facing az.js
// already established, so the operator reads one consistent product rather than
// two translations of it:
//   scan → tarama · trust → etibar · report → hesabat · engine → mühərrik
//   visitors → ziyarətçilər · registrations → qeydiyyatlar · score → xal
//
// Product and channel names (Growth OS, KHAN Trust, YouTube, TikTok) and code
// identifiers (wallet_required, utm_source, ANTHROPIC_API_KEY) stay untranslated
// on purpose: they are things the operator types or greps for, and localising
// them would make them wrong.
export default {
  brand: {
    name: 'Growth OS',
    site: 'KHAN Trust',
  },

  login: {
    eyebrow: 'Məhdud giriş',
    title: 'Konsol',
    passcode: 'Parol',
    signIn: 'Daxil ol',
    checking: 'Yoxlanılır…',
    failed: 'Daxil olmaq alınmadı.',
  },

  nav: {
    overview: 'Rəhbər hesabatı',
    funnel: 'Konversiya hunisi',
    retention: 'Saxlanma',
    acquisition: 'Cəlbetmə',
    content: 'Kontent mühərriki',
    initiatives: 'Təşəbbüslər',
    signOut: 'Çıxış',
    language: 'Dil',
  },

  common: {
    loading: 'Yüklənir…',
    couldNotLoad: 'Yüklənmədi',
    noData: 'Məlumat yoxdur',
    reload: 'Yenilə',
    visitors: 'ziyarətçi',
    eyebrow: 'Growth OS',
    notMeasured: '—',
  },

  confidence: {
    sufficient: 'Etibarlı',
    directional: 'İstiqamətverici',
    insufficient: 'Məlumat kifayət etmir',
    canWeTrust: 'Etibar etmək olar?',
  },

  errors: {
    pageCrashed: 'Bu səhifədə xəta baş verdi',
    restWorks: 'Konsolun qalan hissəsi işləyir — başqa bölməyə keçmək üçün yan paneldən istifadə edin.',
  },

  overview: {
    title: 'Rəhbər hesabatı',
    aiSpend: 'Bu ay AI xərci',
    ofCap: '{cap} limitindən',
    budgetUsed: 'İstifadə olunan büdcə',
    calls: '{count} sorğu',
    remaining: 'Qalıq',
    hardCap: 'sərt limit — keçdikdə sorğular dayanır',
    eventsRecorded: 'Qeydə alınan hadisələr',
    lastDays: 'son {days} gün',
    aiOffTitle: 'Analitik təbəqə söndürülüb.',
    aiOffBody: 'ANTHROPIC_API_KEY təyin edilməyib. Konsolun qalan hər şeyi tam deterministikdir və AI tələb etmir — huni, saxlanma, cəlbetmə və kontent tələbi səhifələri açar olan halda olduğu kimi işləyir.',
    dataHealth: 'Məlumatın vəziyyəti',
    runNow: 'Təhlili indi başlat',
    running: 'Komanda işləyir…',
    runHint: 'Hər bazar ertəsi avtomatik işə düşür. Əl ilə başlatmaq təxminən bir sentə başa gəlir.',
    progressStarting: 'Komanda başladılır…',
    progressWorking: 'Analitiklər işləyir. Bu, adətən bir dəqiqədən az çəkir…',
    pollTimeout: '4 dəqiqə ərzində hesabat görünmədi. Təhlil hələ davam edə bilər — bir azdan səhifəni yeniləyin. Yenə də görünməsə, Netlify-da growth-analyze-background funksiyasının loglarını yoxlayın.',
    langMismatch: 'Bu hesabat {reportLang} dilində yazılıb. Hesabatlar yenidən tərcümə edilmir — {currentLang} dilində almaq üçün təhlili yenidən başladın.',
    langEn: 'ingilis',
    langAz: 'Azərbaycan',
    noBriefTitle: 'Hələ hesabat yoxdur',
    noBriefBody: 'Komanda hələ işə düşməyib. Bazar ertəsi avtomatik işləyəcək və ya yuxarıdakı düymə ilə başlada bilərsiniz. Hadisə jurnalı boş olduqda komanda strategiya uydurmaq əvəzinə, işləmək üçün məlumatı olmadığını düzgün bildirəcək.',
    generatedAt: 'Yaradılıb: {at} · {trigger} · {days} günlük dövr',
    triggerManual: 'əl ilə',
    triggerScheduled: 'cədvəl üzrə',
    noSynthesisTitle: 'Yekun rəy yoxdur',
    noSynthesisBody: 'Aparat rəhbəri hesabatı tamamlamadı; aşağıdakı ayrı-ayrı analitik hesabatları öz-özlüyündə etibarlıdır.',
    analystReports: 'Ayrı-ayrı analitik hesabatları',
    someFailed: 'Bu işləmədə bəzi analitiklər uğursuz oldu.',
    unknownsTitle: 'Komandanın bilə bilmədikləri',
    unknownsIntro: 'Bunlar analitiklərə verilmədi, çünki məlumat nəticə çıxarmağa imkan vermir. Ölçülə bilən hala gətirmək üçün ən dəyərli məsələlər məhz bunlardır.',
  },

  reasons: {
    fabricated_numbers: 'Çıxarıldı: mənbə göstəricilərində olmayan {numbers} rəqəmlərinə istinad edir. Uydurma sayılır.',
    below_min_sample: 'Cəmi {n} müşahidə — göstəricinin mənası olması üçün lazım olan {min} həddindən aşağı. Qərar vermək üçün məlumat kifayət etmir.',
    interval_tight: 'n={n}. Həqiqi dəyər böyük ehtimalla {range} aralığındadır. Qərar vermək üçün etibarlıdır.',
    interval_wide: 'n={n}. Həqiqi dəyər {range} aralığındadır — geniş aralıqdır, ona görə istiqamətini real, dəqiq rəqəmini isə ilkin sayın.',
    interval_too_wide: 'n={n}. Həqiqi dəyər {range} aralığında istənilən yerdə ola bilər — hər hansı nəticə çıxarmaq üçün həddən artıq genişdir.',
    count_too_few: 'Cəmi {n} qeyd — hər hansı qanunauyğunluq görmək üçün çox azdır.',
    count_rough: '{n} qeyd — ümumi mənzərəni görmək üçün kifayətdir, dəqiq olmaq üçün yox.',
    count_fine: '{n} qeyd.',
    change_insufficient: 'Dövrlərdən biri və ya hər ikisi müqayisə üçün kifayət qədər məlumata malik deyil. Aralarındakı hər hansı faiz dəyişikliyi təsadüfi səs-küydür.',
    change_separated: 'İki dövrün etibarlılıq aralıqları üst-üstə düşmür — bu dəyişiklik realdır, səs-küy deyil.',
    change_overlapping: 'İki dövrün etibarlılıq aralıqları üst-üstə düşür — bu görünən dəyişiklik təsadüfi tərəddüdlə uyğun gəlir.',
    instrumentation_gap: '“{upstreamStage}” addımına çatan {upstreamCount} ziyarətçidən heç biri “{stage}” hadisəsini qeydə almayıb. Bu ya bu addımda hunidəki tam çöküşdür, ya da hadisə ümumiyyətlə izlənmir. Bunu artım problemi saymazdan əvvəl izləmənin işlədiyini yoxlayın.',
    bottleneck_found: 'Etibarlı məlumatı olan addımlar arasında ən aşağı konversiya “{stage}” addımındadır ({percent}%).',
    bottleneck_insufficient: 'Hələ heç bir huni addımında dar boğazı müəyyən etmək üçün kifayət qədər məlumat yoxdur. Bu suala cavab vermək üçün daha çox trafik lazımdır.',
    bottleneck_blocked_by_gaps: 'Hələ heç bir huni addımını sıralamaq mümkün deyil: qiymətləndirmək üçün kifayət qədər trafiki olan addımlarda ümumiyyətlə hadisə qeydə alınmayıb. Bu, artım problemindən çox, izləmənin olmamasına işarə edir.',
    retention_matured_only: 'Yalnız müddəti tam başa çatmış kohortlar sayılır, ona görə yeni qeydiyyatlar heç vaxt saxlanma uğursuzluğu kimi görünmür.',
    retention_no_signups: 'Kohort saxlanması üçün dövr ərzində qeydiyyatlar və hər müddətin tamamlanması üçün kifayət qədər vaxt lazımdır.',
    data_plane_thin: 'Growth Data Plane yeni yerləşdirilib və bu dövr azdır. Trafik toplanana qədər göstəricilərin əksəriyyəti “məlumat kifayət etmir” göstərəcək — bu, səhv deyil, düzgün davranışdır.',
    hit_rate_too_few: 'İndiyədək cəmi {n} təşəbbüs ölçülüb — sistemin məsləhətini qiymətləndirmək üçün çox azdır. Bu, təxminən onlarla təşəbbüsdən sonra mənalı olur.',
  },

  roles: {
    content_strategist: 'Cəlbetmə və kontent strateqi',
    growth_analyst: 'Artım analitiki',
    product_analyst: 'Məhsul və UX analitiki',
    executive_brief: 'Aparat rəhbəri',
  },

  funnel: {
    stages: {
      visited: 'Ziyarət etdi',
      activated: 'Token taradı',
      registered: 'Qeydiyyatdan keçdi',
      pricing: 'Qiymətlərə baxdı',
      checkout: 'Ödənişə başladı',
      converted: 'Ödədi',
    },
    title: 'Konversiya hunisi',
    intro: 'Hadisələrlə deyil, ziyarətçilərlə ölçülür — qırx token tarayan bir nəfər qırx yox, bir aktiv ziyarətçidir. Hər göstərici öz statistik dayanıqlığını daşıyır; “Məlumat kifayət etmir” işarəsi kiçik rəqəm deyil, naməlum rəqəm deməkdir.',
    introStrong: 'ziyarətçilərlə, hadisələrlə deyil',
    trackingGap: 'Ola bilsin izləmə boşluğu var — əvvəlcə bunu oxuyun.',
    events: 'hadisə (cüzdana bağlıdır, insana yox)',
    stepConversion: 'Addımdan addıma konversiya',
    colStep: 'Addım',
    colReached: 'Çatdı',
    colConversion: 'Konversiya',
    noSteps: 'Hələ heç bir huni addımı qeydə alınmayıb.',
    bottleneck: 'Dar boğaz',
    notAnswerable: 'Hələ cavab vermək mümkün deyil',
    blockers: 'Ödənişlər niyə baş tutmadı',
    blockersIntro: 'Səbəbi ilə birlikdə öz sistemimizdə qeydə alınır. wallet_required — düzəldə biləcəyiniz məhsul maneəsidir; missing_config — ödəniş sisteminin sınıq olması və gəlirin səssizcə itməsi deməkdir. Google Analytics bu ikisini bir-birindən ayıra bilmir.',
    colReason: 'Səbəb',
    colCount: 'Say',
    noBlockers: 'Bu dövrdə uğursuz ödəniş qeydə alınmayıb.',
  },

  retention: {
    title: 'Kohort saxlanması',
    intro: 'Əsl kohort saxlanması: istifadəçilər qeydiyyatdan keçdikləri günə görə qruplaşdırılır, sonra 1-ci, 7-ci və 30-cu gün qayıdıb-qayıtmadıqları ölçülür. Bu, köhnə “qayıdan istifadəçilər” rəqəmi deyil — o rəqəm iki müxtəlif gündə daxil olan hər kəsi sayırdı, zaman ölçüsü yoxdur, yalnız arta bilir və saxlanmanın pisləşdiyini heç vaxt göstərə bilmir.',
    calloutTitle: 'Müddəti hələ çatmayan istifadəçilər çıxarılır, itirilmiş sayılmır.',
    calloutBody: 'İki gün əvvəl qeydiyyatdan keçən adam D7-də uğursuz olmayıb — onun D7-si hələ gəlməyib. Onları uğursuz saymaq saxlanma panellərinin reallığı olduğundan pis göstərməsinin ən geniş yayılmış yoludur.',
    horizon: '{horizon} saxlanma',
    ofUsers: '{retained}/{eligible} istifadəçi',
    notEnough: 'məlumat kifayət etmir',
    byCohort: 'Qeydiyyat kohortu üzrə',
    colSignupDay: 'Qeydiyyat günü',
    colUsers: 'İstifadəçilər',
    notDue: 'müddəti hələ çatmayıb',
  },

  acquisition: {
    title: 'Kanallar üzrə cəlbetmə',
    intro: 'Sonuncu deyil, ilk toxunuşa görə hesablanır. KHAN Trust-ı TikTok vasitəsilə tapıb, çıxıb, sonra ünvanı əl ilə yazaraq qayıdan adam TikTok cəlbetməsidir — sonuncu toxunuş onu “Birbaşa” kimi yazardı və siz səhvən TikTok-un işləmədiyi qənaətinə gələrdiniz.',
    calloutTitle: 'Growth Data Plane işə düşənə qədər bu səhifə mövcud ola bilməzdi.',
    calloutBody: 'Köhnə trafik detektoru beş mənbə tanıyırdı: birbaşa, Google, X, Telegram və “digər”. YouTube və TikTok — marketinq apardığınız yeganə iki kanal — hər ikisi “digər”ə düşürdü. Onların nəticəsi sadəcə ölçülmürdü; ölçülməsi mümkün deyildi.',
    noOwnedTitle: 'Hələ YouTube və ya TikTok trafiki qeydə alınmayıb',
    noOwnedBody: 'Linklərinizi ?utm_source=youtube və ya ?utm_source=tiktok ilə işarələyin. UTM etiketləri gözlədiyinizdən daha vacibdir: hər iki platforma tətbiqdaxili keçidlərin əksəriyyətində referrer-i silir, ona görə etiketsiz trafik “Birbaşa” kimi görünür.',
    allChannels: 'Bütün kanallar',
    colChannel: 'Kanal',
    colVisitors: 'Ziyarətçilər',
    colSignups: 'Qeydiyyatlar',
    colSignupRate: 'Qeydiyyat nisbəti',
    noTraffic: 'Hələ mənbəyi bilinən trafik qeydə alınmayıb. Data plane yalnız yerləşdirildiyi andan toplamağa başlayıb — əvvəlki ziyarətləri geri qaytarmaq mümkün deyil.',
  },

  channels: {
    youtube: 'YouTube',
    tiktok: 'TikTok',
    google: 'Google',
    direct: 'Birbaşa',
    referral: 'Digər keçid',
    x: 'X',
    telegram: 'Telegram',
    reddit: 'Reddit',
    internal: 'Daxili',
  },

  content: {
    title: 'Kontent mühərriki',
    intro: 'Tarama jurnalınız heç kimdə olmayan kontent tələbi siqnalıdır. Hər tarama — real bir insanın sizə, soruşulmadan, hansı token barədə narahat olduğunu bildirməsidir; bu, kripto istifadəçilərinin bu həftə nədən çəkindiyinin birbaşa göstəricisidir. İnsanların artıq axtardığı tokenlər — auditoriyası artıq hazır olan videolardır.',
    calloutTitle: 'Tələb yeniliyə görə çəkilir (7 günlük yarımparçalanma).',
    calloutBody: 'Kriptoda diqqət günlər ərzində sönür, ona görə keçən ay 30 dəfə taranan token bu həftə 8 dəfə taranandan aşağı sıralanır. Çox taranan, lakin aşağı etibar xalı alan token ən güclü mövzudur: real tələb, real xəbərdarlıq və məhsulun nə etdiyinin təbii nümayişi.',
    whatScanning: 'İnsanlar nəyi tarayır',
    colToken: 'Token',
    colTicker: 'Ticker',
    colDemand: 'Tələb',
    colScans: 'Taramalar',
    colPeople: 'İnsanlar',
    colTrustScore: 'Verdiyiniz etibar xalı',
    colLastScanned: 'Son tarama',
    colSignal: 'Siqnalın gücü',
    noScans: 'Bu dövrdə hələ tarama qeydə alınmayıb. Bu cədvəl real istifadəçilər token taradıqca dolur — data plane işə düşməzdən əvvəlki dövr üçün geri doldurmaq mümkün deyil.',
    strategist: 'Kontent strateqi',
    noPlanTitle: 'Hələ kontent planı yoxdur',
    noPlanBody: 'Analitik komanda hər bazar ertəsi, yaxud Rəhbər hesabatı səhifəsindən tələb üzrə işə düşür. Konkret olmaq üçün ona tarama məlumatı lazımdır — jurnal boş olduqda işləmək üçün məlumatı olmadığını düzgün bildirəcək.',
    openQuestions: 'Növbəti planı nə yaxşılaşdırardı',
  },

  initiatives: {
    title: 'Təşəbbüslər',
    intro: 'Sistemi ideya generatoru deyil, rəhbər komanda edən məhz budur: qəbul etdiyiniz hər tövsiyə ölçülmüş nəticəyə qədər izlənir, beləliklə komanda öz məsləhətinin işə yarayıb-yaramadığını öyrənir.',
    calloutTitle: 'Təşəbbüsü qəbul etdikdə cari göstəriciləriniz anlıq şəkildə saxlanılır.',
    calloutBody: 'Bu baza qəbul anında götürülür və sonradan heç vaxt bərpa edilə bilməz — göstərici onlarla əlaqəsiz səbəbdən dəyişdikdən sonra “bu işə yaradımı?” sualına cavab verməyi mümkün edən yeganə şey odur.',
    tracked: 'İzlənir',
    inFlight: 'İcradadır',
    measured: 'Ölçülüb',
    hitRate: 'Uğur nisbəti',
    nothingMeasured: 'hələ heç nə ölçülməyib',
    ofMeasured: 'ölçülmüş təşəbbüslərdən',
    nothingTrackedTitle: 'Hələ heç nə izlənmir',
    nothingTrackedBody: 'İzləməyə başlamaq üçün Rəhbər hesabatı və ya Kontent mühərriki səhifəsindən bir tövsiyəni qəbul edin.',
    proposedBy: 'Təklif edilib',
    proposedByLine: '{at} · {who}',
    you: 'siz',
    baselineAtAccept: 'Qəbul anındakı baza',
    baselineLine: '{visitors} ziyarətçi · qeydə alınıb {at}',
    outcome: 'Nəticə',
    measurePlaceholder: 'Əslində nə baş verdi? Səmimi olun — bu miqyasda “qeyri-müəyyən” adətən düzgün cavabdır və onu uğur kimi yazmaq sistemə səhv dərs verir.',
  },

  status: {
    proposed: 'təklif edilib',
    accepted: 'qəbul edilib',
    shipped: 'tətbiq edilib',
    measured: 'ölçülüb',
    rejected: 'rədd edilib',
  },

  actions: {
    accept: 'Qəbul et',
    reject: 'Rədd et',
    markShipped: 'Tətbiq edildi kimi işarələ',
    drop: 'İmtina et',
    recordOutcome: 'Nəticəni qeyd et',
  },

  outcomes: {
    worked: 'İşə yaradı',
    no_effect: 'Təsiri olmadı',
    inconclusive: 'Qeyri-müəyyən',
    backfired: 'Əks nəticə verdi',
  },

  rec: {
    why: 'Niyə',
    expectedImpact: 'Gözlənilən təsir',
    roi: 'ROI',
    risks: 'Risklər',
    complexity: '{level} mürəkkəblik',
    trackAsInitiative: 'Təşəbbüs kimi izlə',
    adding: 'Əlavə edilir…',
    dataVerdictTitle: 'Məlumat əslində nəyi təsdiqləyə bilir',
    fabricationTitle: '{count} tövsiyə uydurma rəqəmlərə istinad etdiyi üçün çıxarıldı.',
    fabricationBody: 'Bunlar mənbə göstəricilərində heç yerdə olmayan rəqəmlərə istinad edirdi, ona görə bu səhifəyə çatmazdan əvvəl avtomatik silindilər. Burada göstərilir, çünki uydurma edən modeldən xəbərdar olmaq lazımdır.',
  },

  recConfidence: {
    grounded_in_data: 'Məlumata əsaslanır',
    informed_judgement: 'Əsaslandırılmış mülahizə',
    speculative: 'Fərziyyə',
  },

  complexity: {
    low: 'aşağı',
    medium: 'orta',
    high: 'yüksək',
  },

  objectives: {
    registrations: 'Qeydiyyatlar',
    active_users: 'Aktiv istifadəçilər',
    retention: 'Saxlanma',
    user_experience: 'UX',
    conversion: 'Konversiya',
    trust: 'Etibar',
    brand_awareness: 'Brend tanınması',
    positioning: 'Mövqeləndirmə',
    new_opportunity: 'Yeni imkan',
    investor_readiness: 'İnvestora hazırlıq',
    data_quality: 'Məlumat keyfiyyəti',
  },
};
