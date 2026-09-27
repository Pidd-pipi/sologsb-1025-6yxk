import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  NbAlertModule,
  NbBadgeModule,
  NbButtonModule,
  NbCardModule,
  NbCheckboxModule,
  NbIconModule,
  NbInputModule,
  NbLayoutModule,
  NbOptionModule,
  NbSelectModule,
  NbTabsetModule,
  NbToastrModule,
  NbToastrService
} from '@nebular/theme';

type WorkspaceView = 'compose' | 'checks' | 'review' | 'versions';
type ReviewStatus = 'pending' | 'approved' | 'changes';
type NoticeStatus = 'draft' | 'in-review' | 'locked';
type CheckLevel = 'error' | 'warning' | 'info';
type ConflictResolution = 'pending' | 'loaded-latest' | 'saved-as-new' | 'dismissed';
type ConflictSource = 'storage-event' | 'save-rejected';

interface LanguageVersion {
  id: string;
  locale: string;
  name: string;
  title: string;
  body: string;
  translator: string;
  reviewed: boolean;
}

interface Discussion {
  id: string;
  languageId: string;
  sentenceIndex: number;
  author: string;
  role: string;
  text: string;
  createdAt: string;
  resolved: boolean;
}

interface RoleReview {
  role: '编辑' | '法务' | '翻译' | '发布人';
  owner: string;
  status: ReviewStatus;
  note: string;
}

interface VersionSnapshot {
  id: string;
  label: string;
  createdAt: string;
  version: string;
  title: string;
  severity: string;
  scope: string;
  eventAt: string;
  effectiveAt: string;
  expiresAt: string;
  channels: string[];
  languages: LanguageVersion[];
  note: string;
  emergency: boolean;
}

interface NoticeDraft {
  id: string;
  title: string;
  eventType: string;
  severity: string;
  scope: string;
  channels: string[];
  eventAt: string;
  effectiveAt: string;
  expiresAt: string;
  requiredLocales: string[];
  languages: LanguageVersion[];
  discussions: Discussion[];
  reviews: RoleReview[];
  versions: VersionSnapshot[];
  status: NoticeStatus;
  version: string;
  /** 本地草稿修订号：每次被接受的保存 +1，用作多页签乐观并发控制的基准。 */
  revision: number;
  lockedAt?: string;
  emergencyRevision: boolean;
  updatedAt: string;
}

/** 一次修订冲突的完整处理记录，独立于草稿持久化，关闭页面后仍然保留。 */
interface ConflictRecord {
  id: string;
  tabLabel: string;
  source: ConflictSource;
  /** 过期页签编辑时所基于的修订号。 */
  baseRevision: number;
  /** 检测到冲突时存储中的最新修订号。 */
  storedRevision: number;
  /** 过期页签当时的完整内容快照（处理冲突时的“本页”一侧）。 */
  stash: NoticeDraft;
  detectedAt: string;
  resolution: ConflictResolution;
  /** 被拦截的直接保存尝试说明。 */
  attempts: string[];
  resolvedAt?: string;
  /** 处理后存储中的修订号（另存为新修订时为新号）。 */
  resolutionRevision?: number;
}

interface CheckResult {
  id: string;
  category: string;
  level: CheckLevel;
  title: string;
  detail: string;
}

interface DiffRow {
  left: string;
  right: string;
  kind: 'same' | 'changed' | 'added' | 'removed';
}

interface ConflictMetaRow {
  label: string;
  local: string;
  latest: string;
  changed: boolean;
}

interface ConflictLanguageView {
  id: string;
  name: string;
  local?: LanguageVersion;
  latest?: LanguageVersion;
  changed: boolean;
  missingLocal: boolean;
  missingLatest: boolean;
}

interface NoticeTemplate {
  id: string;
  name: string;
  description: string;
  eventType: string;
  severity: string;
  scope: string;
  channels: string[];
  title: Record<string, string>;
  body: Record<string, string>;
}

const STORAGE_KEY = 'sologsb-1025-emergency-notice-v1';
const JOURNAL_KEY = 'sologsb-1025-emergency-notice-conflicts-v1';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function uid(prefix: string): string {
  const random = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
  return `${prefix}-${random}`;
}

function initialDraft(): NoticeDraft {
  const first: VersionSnapshot = {
    id: 'version-1-0-0',
    label: '首次发布稿',
    createdAt: '2026-09-23T08:10:00+08:00',
    version: '1.0.0',
    title: '台风“海燕”橙色预警通知',
    scope: '滨海新区沿海街道',
    severity: '橙色',
    eventAt: '2026-09-23T07:30:00+08:00',
    effectiveAt: '2026-09-23T09:00:00+08:00',
    expiresAt: '2026-09-24T08:00:00+08:00',
    channels: ['短信', '广播', '社区大屏'],
    note: '发布范围覆盖滨海新区。',
    emergency: false,
    languages: [
      {
        id: 'zh-CN', locale: 'zh-CN', name: '简体中文', title: '台风“海燕”橙色预警通知',
        body: '请滨海新区居民立即停止户外活动。预计今天下午出现强风和暴雨。请远离临时建筑，并关注后续通知。',
        translator: '林晓', reviewed: true
      },
      {
        id: 'en', locale: 'en', name: 'English', title: 'Orange alert for Typhoon Haiyan',
        body: 'Residents in Binhai New Area should stop outdoor activities immediately. Strong winds and heavy rain are expected this afternoon. Stay away from temporary structures and monitor further notices.',
        translator: '周晴', reviewed: true
      }
    ]
  };

  const second: VersionSnapshot = {
    ...clone(first),
    id: 'version-1-1-0',
    label: '扩大影响范围',
    createdAt: '2026-09-24T10:35:00+08:00',
    version: '1.1.0',
    title: '台风“海燕”橙色预警及人员转移通知',
    scope: '滨海新区全区，重点为沿海街道',
    note: '增加沿海街道转移要求。',
    languages: [
      {
        ...clone(first.languages[0]),
        id: 'zh-CN',
        title: '台风“海燕”橙色预警及人员转移通知',
        body: '请滨海新区居民立即停止户外活动。沿海街道居民请于今日17时前转移至就近安置点。预计今天下午出现强风和暴雨。请远离临时建筑，并关注后续通知。'
      } as LanguageVersion,
      {
        ...clone(first.languages[1]),
        id: 'en',
        title: 'Orange alert and evacuation notice for Typhoon Haiyan',
        body: 'Residents in Binhai New Area should stop outdoor activities immediately. Residents of coastal subdistricts must move to the nearest shelter before 17:00 today. Strong winds and heavy rain are expected this afternoon. Stay away from temporary structures and monitor further notices.'
      } as LanguageVersion
    ]
  };

  return {
    id: 'notice-haiyan-2026',
    title: '台风“海燕”橙色预警及人员转移通知',
    eventType: '台风',
    severity: '橙色',
    scope: '滨海新区全区，重点为沿海街道',
    channels: ['短信', '广播', '社区大屏', '政务新媒体'],
    eventAt: '2026-09-25T07:30',
    effectiveAt: '2026-09-25T09:00',
    expiresAt: '2026-09-26T08:00',
    requiredLocales: ['zh-CN', 'en', 'ja'],
    languages: [
      {
        id: 'zh-CN', locale: 'zh-CN', name: '简体中文', title: '台风“海燕”橙色预警及人员转移通知',
        body: '请滨海新区居民立即停止户外活动。沿海街道居民请于今日17时前转移至就近安置点。预计今天下午出现强风和暴雨。不要停留在临时建筑附近，并持续关注后续通知。',
        translator: '林晓', reviewed: true
      },
      {
        id: 'en', locale: 'en', name: 'English', title: 'Orange alert and evacuation notice for Typhoon Haiyan',
        body: 'Residents in Binhai New Area should stop outdoor activities immediately. Residents of coastal subdistricts must move to the nearest shelter before 17:00 today. Strong winds and heavy rain are expected this afternoon. Keep away from temporary buildings and continue to monitor further notices.',
        translator: '周晴', reviewed: true
      },
      {
        id: 'ja', locale: 'ja', name: '日本語', title: '台風「ハイエン」オレンジ警報',
        body: '浜海新区の住民は直ちに屋外活動を中止してください。本日午後、強風と大雨が見込まれます。仮設建物に近づかず、今後の通知を確認してください。',
        translator: '佐藤 明', reviewed: false
      }
    ],
    discussions: [
      {
        id: 'comment-1', languageId: 'zh-CN', sentenceIndex: 1, author: '陈冉', role: '法务审阅',
        text: '建议明确安置点地址由属地另行发送，避免通知被理解为完整点位清单。', createdAt: '2026-09-25T08:16:00+08:00', resolved: false
      }
    ],
    reviews: [
      { role: '编辑', owner: '林晓', status: 'approved', note: '事件要素完整。' },
      { role: '法务', owner: '陈冉', status: 'changes', note: '转移表述需补充依据。' },
      { role: '翻译', owner: '周晴', status: 'pending', note: '等待日文版复核。' },
      { role: '发布人', owner: '值班中心', status: 'pending', note: '' }
    ],
    versions: [first, second],
    status: 'in-review',
    version: '1.2.0-draft',
    revision: 1,
    emergencyRevision: false,
    updatedAt: new Date().toISOString()
  };
}

const TEMPLATES: NoticeTemplate[] = [
  {
    id: 'typhoon', name: '台风人员转移', description: '适用于沿海区域人员转移和停业停课提醒。',
    eventType: '台风', severity: '橙色', scope: '沿海街道', channels: ['短信', '广播', '社区大屏'],
    title: { 'zh-CN': '台风预警及人员转移通知', en: 'Typhoon alert and evacuation notice', ja: '台風警報・避難のお知らせ' },
    body: {
      'zh-CN': '请相关区域居民立即停止户外活动。危险区域人员请按属地安排转移至安全场所。预计将出现强风和暴雨，请远离临时建筑并关注后续通知。',
      en: 'Residents in the affected area should stop outdoor activities immediately. People in high-risk areas must follow local evacuation arrangements. Strong winds and heavy rain are expected. Stay away from temporary structures and monitor further notices.',
      ja: '対象地域の住民は直ちに屋外活動を中止してください。危険地域の方は自治体の避難指示に従ってください。強風と大雨が見込まれます。仮設建物に近づかず、今後の通知を確認してください。'
    }
  },
  {
    id: 'water', name: '供水异常', description: '适用于计划停水和恢复供水通知。',
    eventType: '公共设施', severity: '黄色', scope: '城市供水片区', channels: ['短信', '政务新媒体'],
    title: { 'zh-CN': '计划停水通知', en: 'Planned water service interruption', ja: '断水のお知らせ' },
    body: {
      'zh-CN': '因管网维护，相关区域将于指定时间暂停供水。请提前储水并关闭用水设备。恢复供水后可能出现短时浑浊，请排放后再使用。',
      en: 'Water service will be temporarily suspended for network maintenance. Please store water in advance and close water fixtures. Water may appear cloudy when service resumes; run the tap before use.',
      ja: '管路保守作業のため、対象地域では一時的に断水します。事前に水を確保し、水道設備を閉めてください。復旧後は濁りが生じる場合があるため、しばらく通水してから使用してください。'
    }
  },
  {
    id: 'public-safety', name: '公共安全提醒', description: '适用于大型活动周边临时管控。',
    eventType: '公共安全', severity: '黄色', scope: '活动周边道路', channels: ['广播', '社区大屏', '政务新媒体'],
    title: { 'zh-CN': '大型活动期间临时交通提醒', en: 'Temporary traffic notice during major event', ja: '大規模イベント期間中の交通規制' },
    body: {
      'zh-CN': '活动期间部分道路将采取临时管控措施。请服从现场指引，合理规划出行路线，非必要不前往管控区域。',
      en: 'Temporary traffic controls will be in place during the event. Follow on-site directions, plan your route, and avoid restricted areas unless necessary.',
      ja: 'イベント期間中、一部道路で交通規制を行います。現場の案内に従い、移動経路を事前に確認してください。不要な場合は規制区域への立入りを控えてください。'
    }
  }
];

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NbLayoutModule,
    NbCardModule,
    NbButtonModule,
    NbInputModule,
    NbSelectModule,
    NbOptionModule,
    NbCheckboxModule,
    NbTabsetModule,
    NbIconModule,
    NbBadgeModule,
    NbAlertModule,
    NbToastrModule
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit, OnDestroy {
  readonly templates = TEMPLATES;
  readonly eventTypes = ['台风', '暴雨', '地震', '公共卫生', '公共设施', '公共安全'];
  readonly severities = ['蓝色', '黄色', '橙色', '红色'];
  readonly channelOptions = ['短信', '广播', '社区大屏', '政务新媒体', '应急喇叭', '网站'];
  readonly locales = [
    { id: 'zh-CN', name: '简体中文' },
    { id: 'en', name: 'English' },
    { id: 'ja', name: '日本語' },
    { id: 'ko', name: '한국어' },
    { id: 'es', name: 'Español' }
  ];
  readonly bannedTerms = ['大概', '可能吧', '无需恐慌', '绝对不会', '保证安全'];
  readonly glossary = [
    { canonical: '立即', variants: ['马上', '赶紧'] },
    { canonical: '安置点', variants: ['避难所', '庇护所'] },
    { canonical: '持续关注', variants: ['随时留意', '保持观看'] }
  ];
  readonly roles: RoleReview['role'][] = ['编辑', '法务', '翻译', '发布人'];

  /** 本页工作副本。页签过期时保留本页内容，用于与最新稿比较和另存。 */
  draft: NoticeDraft = initialDraft();
  /** 存储中已知的最新稿。 */
  latestDraft: NoticeDraft = this.draft;
  activeView: WorkspaceView = 'compose';
  selectedLanguageId = 'zh-CN';
  selectedSentenceIndex = 0;
  selectedTemplateId = 'typhoon';
  discussionText = '';
  currentRole: RoleReview['role'] = '编辑';
  compareBaseId = '';
  compareTargetId = '';
  lastSavedAt = '';
  history: NoticeDraft[] = [];
  future: NoticeDraft[] = [];

  /** 非 null 表示本页已过期，正在处理修订冲突。 */
  activeConflict: ConflictRecord | null = null;
  conflictLanguageId = 'zh-CN';
  journal: ConflictRecord[] = [];
  readonly tabLabel = `页签 ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  private readonly storageListener = (event: StorageEvent) => this.handleStorage(event);

  constructor(private readonly toastr: NbToastrService) {}

  ngOnInit(): void {
    let stored = this.readStoredDraft();
    if (!stored) {
      stored = initialDraft();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    }
    this.draft = stored;
    this.latestDraft = clone(stored);

    this.journal = this.readJournal();
    this.restorePendingConflict(stored);

    this.compareBaseId = this.draft.versions.at(-2)?.id ?? '';
    this.compareTargetId = this.draft.versions.at(-1)?.id ?? '';
    this.lastSavedAt = this.formatDateTime(this.draft.updatedAt);

    window.addEventListener('storage', this.storageListener);
  }

  ngOnDestroy(): void {
    window.removeEventListener('storage', this.storageListener);
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent): void {
    const modifier = event.metaKey || event.ctrlKey;
    if (!modifier) return;
    if (event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? this.redo() : this.undo();
    } else if (event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.redo();
    } else if (event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (this.saveNow()) this.toastr.success('草稿已保存在当前浏览器。', '保存成功');
    }
  }

  get isStale(): boolean {
    return this.activeConflict !== null;
  }

  /** 最新稿为锁定稿时，过期页签不能另存覆盖，只能载入后走紧急修订。 */
  get conflictLocked(): boolean {
    return this.activeConflict !== null && this.latestDraft.status === 'locked';
  }

  get conflictHasChanges(): boolean {
    return this.conflictMetaRows.some((row) => row.changed)
      || this.conflictLanguages.some((language) => language.changed);
  }

  get conflictMetaChangedCount(): number {
    return this.conflictMetaRows.filter((row) => row.changed).length;
  }

  get selectedLanguage(): LanguageVersion {
    return this.draft.languages.find((language) => language.id === this.selectedLanguageId) ?? this.draft.languages[0];
  }

  get selectedTemplateDescription(): string {
    return this.templates.find((template) => template.id === this.selectedTemplateId)?.description ?? '请选择一个模板';
  }

  get unresolvedDiscussionCount(): number {
    return this.draft.discussions.filter((discussion) => !discussion.resolved).length;
  }

  get currentSentences(): string[] {
    return this.splitSentences(this.selectedLanguage?.body ?? '');
  }

  get activeDiscussions(): Discussion[] {
    return this.draft.discussions.filter((discussion) => discussion.languageId === this.selectedLanguageId);
  }

  get checks(): CheckResult[] {
    const checks: CheckResult[] = [];
    const requiredMeta: Array<[string, string]> = [
      ['标题', this.draft.title], ['事件类型', this.draft.eventType], ['严重程度', this.draft.severity],
      ['影响范围', this.draft.scope], ['事件时间', this.draft.eventAt], ['生效时间', this.draft.effectiveAt],
      ['失效时间', this.draft.expiresAt]
    ];
    requiredMeta.filter(([, value]) => !value).forEach(([label]) => checks.push({
      id: `meta-${label}`, category: '必填信息', level: 'error', title: `缺少${label}`,
      detail: `请补全通知的${label}后再提交发布。`
    }));
    if (!this.draft.channels.length) checks.push({
      id: 'channels', category: '发布渠道', level: 'error', title: '未选择目标渠道', detail: '至少选择一个目标发布渠道。'
    });

    this.draft.requiredLocales.forEach((locale) => {
      if (!this.draft.languages.some((language) => language.id === locale)) {
        const name = this.locales.find((item) => item.id === locale)?.name ?? locale;
        checks.push({
          id: `missing-${locale}`, category: '语言完整性', level: 'error', title: `${name}版本缺失`,
          detail: '该语言属于本次发布的必需语言，请添加并完成翻译。'
        });
      }
    });

    this.draft.languages.forEach((language) => {
      if (!language.title.trim() || !language.body.trim()) checks.push({
        id: `required-${language.id}`, category: '必填信息', level: 'error', title: `${language.name}内容不完整`,
        detail: '语言版本必须包含标题和正文。'
      });
      if (!language.reviewed) checks.push({
        id: `review-${language.id}`, category: '版本审阅', level: language.id === 'ja' ? 'warning' : 'info',
        title: `${language.name}尚未完成语言复核`, detail: '发布前应确认措辞、术语和本地化表达。'
      });
      const banned = this.bannedTerms.filter((term) => language.body.includes(term));
      if (banned.length) checks.push({
        id: `banned-${language.id}`, category: '禁用词', level: 'error', title: `${language.name}包含禁用词`,
        detail: `请替换：${banned.join('、')}。`
      });
      const inconsistent = this.glossary.filter((entry) => {
        const variantCount = entry.variants.filter((variant) => language.body.includes(variant)).length;
        return variantCount > 0 && (!language.body.includes(entry.canonical) || variantCount > 1);
      });
      if (inconsistent.length) checks.push({
        id: `term-${language.id}`, category: '术语一致性', level: 'warning', title: `${language.name}术语不统一`,
        detail: inconsistent.map((item) => `统一使用“${item.canonical}”，避免“${item.variants.join('、')}”`).join('；')
      });
    });

    const eventAt = this.toTime(this.draft.eventAt);
    const effectiveAt = this.toTime(this.draft.effectiveAt);
    const expiresAt = this.toTime(this.draft.expiresAt);
    if (eventAt && effectiveAt && effectiveAt < eventAt) checks.push({
      id: 'time-effective', category: '时间冲突', level: 'warning', title: '生效时间早于事件时间',
      detail: '请确认这是预防性通知；否则调整事件时间或生效时间。'
    });
    if (effectiveAt && expiresAt && expiresAt <= effectiveAt) checks.push({
      id: 'time-expires', category: '时间冲突', level: 'error', title: '失效时间早于生效时间',
      detail: '通知有效期必须晚于生效时间。'
    });
    const unresolved = this.draft.discussions.filter((discussion) => !discussion.resolved).length;
    if (unresolved) checks.push({
      id: 'discussions', category: '逐句讨论', level: 'warning', title: `${unresolved} 条讨论尚未解决`,
      detail: '发布前请处理或明确忽略未解决讨论。'
    });
    return checks;
  }

  get blockingChecks(): CheckResult[] {
    return this.checks.filter((check) => check.level === 'error');
  }

  get warningCount(): number {
    return this.checks.filter((check) => check.level === 'warning').length;
  }

  get isLocked(): boolean {
    return this.draft.status === 'locked';
  }

  get allReviewsApproved(): boolean {
    return this.draft.reviews.every((review) => review.status === 'approved');
  }

  get hasIncompleteReviews(): boolean {
    return this.draft.reviews.some((review) => review.status !== 'approved');
  }

  isSentenceDiscussed(index: number): boolean {
    return this.activeDiscussions.some((discussion) => discussion.sentenceIndex === index && !discussion.resolved);
  }

  get nextVersion(): string {
    const numbers = this.draft.version.match(/\d+/g)?.map(Number) ?? [1, 2, 0];
    return `${numbers[0] || 1}.${(numbers[1] || 0) + 1}.0`;
  }

  get versionDiff(): DiffRow[] {
    const base = this.draft.versions.find((version) => version.id === this.compareBaseId);
    const target = this.draft.versions.find((version) => version.id === this.compareTargetId);
    if (!base || !target) return [];
    const baseLanguage = base.languages.find((language) => language.id === this.selectedLanguageId);
    const targetLanguage = target.languages.find((language) => language.id === this.selectedLanguageId);
    return this.diffSentences(this.splitSentences(baseLanguage?.body ?? ''), this.splitSentences(targetLanguage?.body ?? ''));
  }

  // ===== 修订冲突：差异视图 =====

  get conflictMetaRows(): ConflictMetaRow[] {
    const fields: Array<[string, (draft: NoticeDraft) => string]> = [
      ['通知标题', (draft) => draft.title],
      ['事件类型', (draft) => draft.eventType],
      ['严重程度', (draft) => draft.severity],
      ['影响范围', (draft) => draft.scope],
      ['事件时间', (draft) => this.formatDateTime(draft.eventAt)],
      ['生效时间', (draft) => this.formatDateTime(draft.effectiveAt)],
      ['失效时间', (draft) => this.formatDateTime(draft.expiresAt)],
      ['发布渠道', (draft) => draft.channels.join('、')],
      ['必需语言', (draft) => draft.requiredLocales.map((locale) => this.localeName(locale)).join('、')],
      ['草稿状态', (draft) => this.statusLabel(draft.status)],
      ['语义版本', (draft) => draft.version],
      [
        '角色确认',
        (draft) => draft.reviews.map((review) => `${review.role}${this.reviewStatusLabel(review.status)}`).join('；')
      ],
      [
        '讨论记录',
        (draft) => `${draft.discussions.length} 条，未解决 ${draft.discussions.filter((item) => !item.resolved).length} 条`
      ]
    ];
    return fields.map(([label, read]) => {
      const local = read(this.draft);
      const latest = read(this.latestDraft);
      return { label, local, latest, changed: local !== latest };
    });
  }

  get conflictLanguages(): ConflictLanguageView[] {
    const ids = [...new Set([
      ...this.draft.languages.map((language) => language.id),
      ...this.latestDraft.languages.map((language) => language.id)
    ])];
    return ids.map((id) => {
      const local = this.draft.languages.find((language) => language.id === id);
      const latest = this.latestDraft.languages.find((language) => language.id === id);
      return {
        id,
        name: local?.name ?? latest?.name ?? id,
        local,
        latest,
        missingLocal: !local,
        missingLatest: !latest,
        changed: local?.title !== latest?.title || local?.body !== latest?.body
      };
    });
  }

  get conflictSelectedLanguage(): ConflictLanguageView | undefined {
    return this.conflictLanguages.find((language) => language.id === this.conflictLanguageId)
      ?? this.conflictLanguages[0];
  }

  conflictLanguageDiff(view: ConflictLanguageView): DiffRow[] {
    return this.diffSentences(
      this.splitSentences(view.local?.body ?? ''),
      this.splitSentences(view.latest?.body ?? '')
    );
  }

  get conflictChangedRowCount(): number {
    const selected = this.conflictSelectedLanguage;
    if (!selected) return 0;
    return this.conflictLanguageDiff(selected).filter((row) => row.kind !== 'same').length;
  }

  get journalRecords(): ConflictRecord[] {
    return [...this.journal].sort((a, b) =>
      b.detectedAt.localeCompare(a.detectedAt) || b.id.localeCompare(a.id));
  }

  resolutionText(record: ConflictRecord): string {
    switch (record.resolution) {
      case 'loaded-latest':
        return `已载入最新稿（修订号 #${record.resolutionRevision ?? record.storedRevision}），本页改动未写入`;
      case 'saved-as-new':
        return `本页内容已另存为新修订（修订号 #${record.resolutionRevision ?? '?'}）`;
      case 'dismissed':
        return '冲突已失效（基准修订已不存在）';
      default:
        return '待处理';
    }
  }

  resolutionStatus(record: ConflictRecord): string {
    switch (record.resolution) {
      case 'loaded-latest':
        return 'info';
      case 'saved-as-new':
        return 'success';
      case 'dismissed':
        return 'basic';
      default:
        return 'warning';
    }
  }

  sourceText(record: ConflictRecord): string {
    return record.source === 'storage-event' ? '收到其他页签保存' : '保存时被修订号校验拒绝';
  }

  updateMeta(field: 'title' | 'eventType' | 'severity' | 'scope' | 'eventAt' | 'effectiveAt' | 'expiresAt', value: string): void {
    this.commit((draft) => {
      (draft as unknown as Record<string, unknown>)[field] = value;
      draft.status = draft.status === 'locked' ? 'draft' : draft.status;
    });
  }

  toggleChannel(channel: string, checked: boolean): void {
    this.commit((draft) => {
      draft.channels = checked ? [...new Set([...draft.channels, channel])] : draft.channels.filter((item) => item !== channel);
    });
  }

  toggleRequiredLocale(locale: string, checked: boolean): void {
    this.commit((draft) => {
      draft.requiredLocales = checked
        ? [...new Set([...draft.requiredLocales, locale])]
        : draft.requiredLocales.filter((item) => item !== locale);
    });
  }

  updateLanguage(field: 'title' | 'body' | 'translator', value: string): void {
    this.commit((draft) => {
      const language = draft.languages.find((item) => item.id === this.selectedLanguageId);
      if (language) language[field] = value;
    });
  }

  setLanguageReviewed(checked: boolean): void {
    this.commit((draft) => {
      const language = draft.languages.find((item) => item.id === this.selectedLanguageId);
      if (language) language.reviewed = checked;
    });
  }

  selectSentence(index: number): void {
    this.selectedSentenceIndex = index;
  }

  addDiscussion(): void {
    const text = this.discussionText.trim();
    if (!text || this.isLocked) return;
    this.commit((draft) => {
      draft.discussions.push({
        id: uid('discussion'), languageId: this.selectedLanguageId, sentenceIndex: this.selectedSentenceIndex,
        author: this.currentRole === '法务' ? '陈冉' : this.currentRole === '翻译' ? '周晴' : '林晓',
        role: `${this.currentRole}审阅`, text, createdAt: new Date().toISOString(), resolved: false
      });
    });
    this.discussionText = '';
    this.toastr.success('讨论已绑定到当前句。', '已添加');
  }

  toggleDiscussion(discussionId: string): void {
    this.commit((draft) => {
      const item = draft.discussions.find((discussion) => discussion.id === discussionId);
      if (item) item.resolved = !item.resolved;
    });
  }

  setReviewStatus(role: RoleReview['role'], status: ReviewStatus): void {
    this.commit((draft) => {
      const review = draft.reviews.find((item) => item.role === role);
      if (review) review.status = status;
    });
  }

  setReviewNote(role: RoleReview['role'], note: string): void {
    this.commit((draft) => {
      const review = draft.reviews.find((item) => item.role === role);
      if (review) review.note = note;
    });
  }

  applyTemplate(): void {
    const template = this.templates.find((item) => item.id === this.selectedTemplateId);
    if (!template || this.isLocked) return;
    const accepted = this.commit((draft) => {
      draft.eventType = template.eventType;
      draft.severity = template.severity;
      draft.scope = template.scope;
      draft.channels = [...template.channels];
      draft.languages.forEach((language) => {
        language.title = template.title[language.id] ?? language.title;
        language.body = template.body[language.id] ?? language.body;
        language.reviewed = false;
      });
    });
    if (accepted) this.toastr.success(`已应用“${template.name}”模板，请根据事件信息调整。`, '模板复用');
  }

  lockVersion(): void {
    if (this.blockingChecks.length) {
      this.toastr.warning(`仍有 ${this.blockingChecks.length} 项阻断问题，不能锁定。`, '发布检查未通过');
      this.activeView = 'checks';
      return;
    }
    const snapshot: VersionSnapshot = {
      id: uid('version'), label: '最终锁定版本', createdAt: new Date().toISOString(), version: this.nextVersion,
      title: this.draft.title, severity: this.draft.severity, scope: this.draft.scope, eventAt: this.draft.eventAt,
      effectiveAt: this.draft.effectiveAt, expiresAt: this.draft.expiresAt, channels: [...this.draft.channels],
      languages: clone(this.draft.languages), note: '发布前检查通过并锁定。', emergency: false
    };
    const accepted = this.commit((draft) => {
      draft.versions.push(snapshot);
      draft.version = snapshot.version;
      draft.status = 'locked';
      draft.lockedAt = snapshot.createdAt;
    });
    if (!accepted) return;
    this.compareBaseId = this.draft.versions.at(-2)?.id ?? '';
    this.compareTargetId = this.draft.versions.at(-1)?.id ?? '';
    this.toastr.success(`版本 ${snapshot.version} 已锁定（修订号 #${this.draft.revision}）。`, '最终版本已冻结');
  }

  startEmergencyRevision(): void {
    const baseVersion = this.draft.version.split('-')[0];
    const [major = 1, minor = 0] = baseVersion.split('.').map(Number);
    const accepted = this.commit((draft) => {
      draft.status = 'draft';
      draft.emergencyRevision = true;
      draft.version = `${major}.${minor + 1}.0-emergency`;
      draft.lockedAt = undefined;
    });
    if (!accepted) return;
    this.activeView = 'compose';
    this.toastr.warning('已创建紧急修订稿；锁定版本仍完整保留。', '进入紧急修订');
  }

  showCheck(check: CheckResult): void {
    if (check.id.startsWith('missing-') || check.id.startsWith('required-') || check.id.startsWith('banned-') || check.id.startsWith('term-')) {
      const locale = check.id.split('-').at(-1);
      if (locale && this.draft.languages.some((language) => language.id === locale)) this.selectedLanguageId = locale;
      this.activeView = 'compose';
    } else if (check.id === 'discussions') {
      this.activeView = 'review';
    }
  }

  undo(): void {
    if (this.isStale) return;
    const previous = this.history.pop();
    if (!previous) {
      this.toastr.info('没有可撤销的操作。', '撤销');
      return;
    }
    const current = clone(this.draft);
    if (this.writeDraft(clone(previous))) {
      this.future.push(current);
    } else {
      this.history.push(previous);
    }
  }

  redo(): void {
    if (this.isStale) return;
    const next = this.future.pop();
    if (!next) {
      this.toastr.info('没有可重做的操作。', '重做');
      return;
    }
    const current = clone(this.draft);
    if (this.writeDraft(clone(next))) {
      this.history.push(current);
    } else {
      this.future.push(next);
    }
  }

  /** 手动保存。过期页签的直接保存会被拦截并记入处理记录。 */
  saveNow(): boolean {
    if (this.activeConflict) {
      this.recordBlockedAttempt('手动保存');
      return false;
    }
    return this.writeDraft(clone(this.draft), { identicalIsNoop: true });
  }

  // ===== 修订冲突：处理动作 =====

  /** 放弃本页改动，载入存储中的最新稿。 */
  resolveLoadLatest(): void {
    const record = this.activeConflict;
    if (!record || record.resolution !== 'pending') return;
    const stored = this.readStoredDraft();
    if (!stored) return;

    record.storedRevision = stored.revision;
    record.resolution = 'loaded-latest';
    record.resolvedAt = new Date().toISOString();
    record.resolutionRevision = stored.revision;
    this.upsertJournal(record);

    this.activeConflict = null;
    this.adoptDraft(stored);
    this.toastr.success('已载入最新稿，本页过期改动未写入。', '冲突已处理');
  }

  /** 把本页内容作为后继修订写入；最新稿已锁定时拒绝，防止锁定稿被过期页签覆盖。 */
  resolveSaveAsNew(): void {
    const record = this.activeConflict;
    if (!record || record.resolution !== 'pending') return;
    const stored = this.readStoredDraft();
    if (!stored) return;

    if (stored.status === 'locked') {
      this.recordBlockedAttempt('另存为新修订');
      this.toastr.danger('最新稿已锁定，过期页签不能覆盖。请载入最新稿后使用“发起紧急修订”。', '锁定稿受保护');
      return;
    }

    const next = clone(this.draft);
    next.revision = stored.revision + 1;
    next.updatedAt = new Date().toISOString();

    record.storedRevision = stored.revision;
    record.resolution = 'saved-as-new';
    record.resolvedAt = new Date().toISOString();
    record.resolutionRevision = next.revision;

    const serialized = JSON.stringify(next);
    // 先在内存中结束冲突并采用新修订，再持久化，避免自写事件被重入时误判为过期。
    this.upsertJournal(record);
    this.activeConflict = null;
    this.draft = next;
    this.latestDraft = clone(next);
    this.history = [];
    this.future = [];
    try {
      localStorage.setItem(STORAGE_KEY, serialized);
    } catch {
      this.toastr.danger('写入本地存储失败，本页仍处于过期状态。', '另存失败');
      // 无法可靠落盘时恢复冲突态，提示改走“载入最新稿”。
      this.activeConflict = record;
      record.resolution = 'pending';
      record.resolvedAt = undefined;
      record.resolutionRevision = undefined;
      return;
    }
    this.lastSavedAt = this.formatDateTime(next.updatedAt);
    this.toastr.success(`本页内容已作为修订号 #${next.revision} 保存，并保留了处理记录。`, '已另存为新修订');
  }

  formatDateTime(value: string): string {
    if (!value) return '未设置';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date);
  }

  trackById(_index: number, item: { id: string }): string {
    return item.id;
  }

  // ===== 内部实现 =====

  private handleStorage(event: StorageEvent): void {
    if (event.key === STORAGE_KEY) {
      if (!event.newValue) return;
      let latest: NoticeDraft;
      try {
        latest = this.migrate(JSON.parse(event.newValue) as NoticeDraft);
      } catch {
        return;
      }
      if (this.activeConflict) {
        // 已过期：持续跟踪最新稿，差异视图与另存校验始终针对当前头部修订。
        this.latestDraft = latest;
        this.activeConflict.storedRevision = latest.revision;
        this.upsertJournal(this.activeConflict);
        return;
      }
      if (latest.revision === this.draft.revision) {
        this.latestDraft = clone(latest);
      } else if (latest.revision > this.draft.revision) {
        this.markStale(latest, 'storage-event');
      }
    } else if (event.key === JOURNAL_KEY || event.key === null) {
      // 其他页签追加了留痕，刷新列表用于展示；本页的待处理冲突只能由本页解决。
      this.journal = this.readJournal();
    }
  }

  private markStale(latest: NoticeDraft, source: ConflictSource): void {
    const record: ConflictRecord = {
      id: uid('conflict'),
      tabLabel: this.tabLabel,
      source,
      baseRevision: this.draft.revision,
      storedRevision: latest.revision,
      stash: clone(this.draft),
      detectedAt: new Date().toISOString(),
      resolution: 'pending',
      attempts: []
    };
    this.activeConflict = record;
    this.upsertJournal(record);
    this.latestDraft = clone(latest);
    this.history = [];
    this.future = [];
    this.ensureConflictLanguage();
    this.toastr.warning(
      `其他页签已保存修订号 #${latest.revision}，本页（基于 #${record.baseRevision}）已标为过期，请先处理冲突。`,
      '检测到修订冲突'
    );
  }

  private recordBlockedAttempt(action: string): void {
    const record = this.activeConflict;
    if (!record) return;
    const lockedSuffix = this.latestDraft.status === 'locked' ? '，且最新稿已锁定' : '';
    record.attempts.push(
      `${this.formatDateTime(new Date().toISOString())} ${action}被拦截：本页基于修订号 #${record.baseRevision}，最新为 #${record.storedRevision}${lockedSuffix}`
    );
    this.upsertJournal(record);
    this.toastr.danger(
      `本页已过期（基于 #${record.baseRevision}，最新 #${record.storedRevision}），不能直接保存。请比对差异后选择处理方式。`,
      '保存被拒绝'
    );
  }

  /**
   * 乐观并发控制核心：只有存储修订号与本页基准一致才接受保存，
   * 否则把本页（含本次尝试写入的内容）转为过期状态并留痕。
   */
  private writeDraft(next: NoticeDraft, options: { identicalIsNoop?: boolean } = {}): boolean {
    if (this.activeConflict) {
      this.recordBlockedAttempt('自动保存');
      return false;
    }
    const stored = this.readStoredDraft();
    if (!stored) {
      this.toastr.danger('无法读取本地存储，保存未执行。', '保存失败');
      return false;
    }
    if (stored.revision !== this.draft.revision) {
      const latest = this.migrate(stored);
      this.activeConflict = {
        id: uid('conflict'),
        tabLabel: this.tabLabel,
        source: 'save-rejected',
        baseRevision: this.draft.revision,
        storedRevision: latest.revision,
        stash: clone(next),
        detectedAt: new Date().toISOString(),
        resolution: 'pending',
        attempts: [
          `${this.formatDateTime(new Date().toISOString())} 保存被修订号校验拒绝：基准 #${this.draft.revision}，当前 #${latest.revision}`
        ]
      };
      this.upsertJournal(this.activeConflict);
      this.latestDraft = clone(latest);
      this.draft = clone(next);
      this.history = [];
      this.future = [];
      this.ensureConflictLanguage();
      this.toastr.danger(
        `当前修订号已是 #${latest.revision}，本页基于 #${this.activeConflict.baseRevision}，保存被拒绝并转为过期。`,
        '修订冲突'
      );
      return false;
    }
    if (options.identicalIsNoop && this.contentSignature(next) === this.contentSignature(stored)) {
      this.latestDraft = clone(stored);
      this.lastSavedAt = this.formatDateTime(new Date().toISOString());
      return true;
    }
    next.revision = stored.revision + 1;
    next.updatedAt = new Date().toISOString();
    const serialized = JSON.stringify(next);
    const previousDraft = this.draft;
    const previousLatest = this.latestDraft;
    // 先更新内存再持久化：即使 storage 写入被同步观察到（或未来出现重入读取），
    // 本页读到的也已是新修订号，不会把自己的保存误判成来自其他页签的过期事件。
    this.draft = next;
    this.latestDraft = clone(next);
    try {
      localStorage.setItem(STORAGE_KEY, serialized);
    } catch {
      this.draft = previousDraft;
      this.latestDraft = previousLatest;
      this.toastr.danger('写入本地存储失败（可能已满或被禁用），本次保存已回滚。', '保存失败');
      return false;
    }
    this.lastSavedAt = this.formatDateTime(next.updatedAt);
    return true;
  }

  private commit(mutator: (draft: NoticeDraft) => void): boolean {
    if (this.activeConflict) return false;
    const previous = clone(this.draft);
    const next = clone(this.draft);
    mutator(next);
    if (!this.writeDraft(next)) return false;
    this.history.push(previous);
    if (this.history.length > 50) this.history.shift();
    this.future = [];
    return true;
  }

  private adoptDraft(draft: NoticeDraft): void {
    this.draft = clone(draft);
    this.latestDraft = clone(draft);
    this.history = [];
    this.future = [];
    this.lastSavedAt = this.formatDateTime(draft.updatedAt);
    this.compareBaseId = this.draft.versions.at(-2)?.id ?? '';
    this.compareTargetId = this.draft.versions.at(-1)?.id ?? '';
  }

  private restorePendingConflict(stored: NoticeDraft): void {
    const nowIso = new Date().toISOString();
    let journalChanged = false;
    const pending = this.journal
      .filter((record) => record.resolution === 'pending')
      .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));

    const active = pending[0];
    if (active) {
      if (stored.revision <= active.baseRevision) {
        // 头部修订已回退到基准之前（例如存储被清空重建），冲突无意义。
        this.journal.forEach((record) => {
          if (record.resolution === 'pending') {
            record.resolution = 'dismissed';
            record.resolvedAt = nowIso;
            journalChanged = true;
          }
        });
      } else {
        this.activeConflict = active;
        this.draft = clone(active.stash);
        this.latestDraft = clone(stored);
        active.storedRevision = stored.revision;
        // 更早的未处理冲突由当前记录接管，避免同一次重开出现多个悬空待办。
        pending.slice(1).forEach((record) => {
          record.resolution = 'dismissed';
          record.resolvedAt = nowIso;
        });
        journalChanged = true;
        this.history = [];
        this.future = [];
        this.ensureConflictLanguage();
        this.toastr.warning(
          `上次离开时存在未处理冲突：本页基于修订号 #${active.baseRevision}，最新为 #${stored.revision}。`,
          '冲突待处理'
        );
      }
    }
    if (journalChanged) this.writeJournal(this.journal);
  }

  private ensureConflictLanguage(): void {
    const ids = this.conflictLanguages.map((language) => language.id);
    if (!ids.includes(this.conflictLanguageId)) {
      this.conflictLanguageId = ids.includes('zh-CN') ? 'zh-CN' : ids[0] ?? 'zh-CN';
    }
  }

  private readStoredDraft(): NoticeDraft | null {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return this.migrate(JSON.parse(raw) as NoticeDraft);
    } catch {
      return null;
    }
  }

  private readJournal(): ConflictRecord[] {
    const raw = localStorage.getItem(JOURNAL_KEY);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as ConflictRecord[]) : [];
    } catch {
      return [];
    }
  }

  private writeJournal(records: ConflictRecord[]): void {
    try {
      localStorage.setItem(JOURNAL_KEY, JSON.stringify(records.slice(-200)));
    } catch {
      // 留痕失败不应阻断正常保存流程。
    }
  }

  /**
   * 按 id 合并写回：始终以存储中的最新 journal 为基底，只覆盖本条记录，
   * 避免多个过期页签各自的内存副本整数组覆盖、丢失其他页签的留痕。
   */
  private upsertJournal(record: ConflictRecord): void {
    const base = this.readJournal();
    const index = base.findIndex((item) => item.id === record.id);
    if (index >= 0) base[index] = record;
    else base.push(record);
    this.journal = base;
    this.writeJournal(base);
  }

  private migrate(value: NoticeDraft): NoticeDraft {
    if (!value.id || !Array.isArray(value.languages) || !Array.isArray(value.versions)) return initialDraft();
    value.discussions ??= [];
    value.reviews ??= [];
    value.requiredLocales ??= ['zh-CN'];
    value.revision = typeof value.revision === 'number' && Number.isFinite(value.revision)
      ? Math.max(1, Math.trunc(value.revision))
      : 1;
    return value;
  }

  private contentSignature(draft: NoticeDraft): string {
    const copy = clone(draft);
    copy.revision = 0;
    copy.updatedAt = '';
    return JSON.stringify(copy);
  }

  private localeName(locale: string): string {
    return this.locales.find((item) => item.id === locale)?.name ?? locale;
  }

  private statusLabel(status: NoticeStatus): string {
    return status === 'locked' ? '已锁定' : status === 'in-review' ? '审阅中' : '草稿';
  }

  private reviewStatusLabel(status: ReviewStatus): string {
    return status === 'approved' ? '已确认' : status === 'changes' ? '需修改' : '待审阅';
  }

  private splitSentences(text: string): string[] {
    return (text.match(/[^。！？.!?]+[。！？.!?]?/g) ?? []).map((item) => item.trim()).filter(Boolean);
  }

  private toTime(value: string): number {
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  }

  private diffSentences(left: string[], right: string[]): DiffRow[] {
    const rows: DiffRow[] = [];
    const lcs: number[][] = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
    for (let i = left.length - 1; i >= 0; i--) {
      for (let j = right.length - 1; j >= 0; j--) {
        lcs[i][j] = left[i] === right[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) {
        rows.push({ left: left[i], right: right[j], kind: 'same' }); i++; j++;
      } else if (i < left.length && j < right.length && lcs[i + 1][j] === lcs[i][j] && lcs[i][j + 1] === lcs[i][j]) {
        rows.push({ left: left[i], right: right[j], kind: 'changed' }); i++; j++;
      } else if (j < right.length && (i === left.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
        rows.push({ left: '', right: right[j], kind: 'added' }); j++;
      } else if (i < left.length) {
        rows.push({ left: left[i], right: '', kind: 'removed' }); i++;
      }
    }
    return rows;
  }
}
