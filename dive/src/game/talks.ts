/**
 * 修正バッチ2 F4：吹き出しの台本集。ID 付きで、一度きり（セーブ `talked`）。
 * ストーリーの文面（story.ts の CHAPTERS）は変えず、`編集長「…」` の中身を取り出して吹き出し 1 つに収まる長さへ句点で分ける。
 *
 * 台本 ID と呼び出し条件：
 *   intro:<章>   章の始まり（storyRead < 章 のとき）。終わったら章を既読に
 *   praise:<章>  章をクリアしたボート画面。褒め言葉 →（海図があれば受け渡し）→ 「受け取る」の選ぶ段
 *   claim:<章>   報酬が未受け取りのとき、「今やること」カードのタップで出す（一度きりの記録はしない）
 *   nightRest    初回のダイブの後、ボート画面に戻った最初の 1 回（夜の休み方）
 *   noLight      ライトが未入荷の間、第 4 章の開始時／夜のボート画面（チュートリアルの夜を除く）の最初の 1 回
 *
 * F5 で足す台本（接続点。F4 では動かさない）：
 *   shopOpen / tankUp / board / album / kitchen / bait / item:<id>   → 条件は docs/FIX-BATCH-2-DESIGN.md の F5
 */
import { CHAPTERS, ENDING } from './story';
import { STORY } from './fishing';
import { splitText, type MiniLine, type TalkLine, type Who } from '../ui/talk';

export const TALK_F5_IDS = ['shopOpen', 'tankUp', 'board', 'album', 'kitchen', 'bait'] as const;

/** F8 の接続点：手記を読める機能ができたら '手記もここで読める。' を入れる */
export const ALBUM_NOTE_TEXT = '';

/** 長い本文を句点で 2〜3 段（話）に分ける */
export function say(who: Who, text: string, extra?: Partial<TalkLine>): TalkLine[] {
  const parts = splitText(text);
  return parts.map((t, i) => (i === parts.length - 1 && extra ? { who, text: t, ...extra } : { who, text: t }));
}

/** `編集長「…」` → 中身だけ。かぎ括弧がなければそのまま */
export function unquote(s: string): string {
  const m = s.match(/「([\s\S]*)」[^」]*$/);
  return m ? m[1] : s;
}

export function introLines(i: number): TalkLine[] {
  const ch = CHAPTERS[i];
  if (!ch) return say('editor', unquote(ENDING));
  return say('editor', unquote(ch.intro));
}

/** 「今やること」カードのタップ：今の依頼の吹き出しをもう一度（目標つき） */
export function replayLines(i: number, progress: string): TalkLine[] {
  const ch = CHAPTERS[i];
  if (!ch) return say('editor', unquote(ENDING));
  return [...introLines(i), { who: 'editor', text: `今回の目標：${ch.goal}${progress ? `（${progress}）` : ''}` }];
}

export function claimLines(k: number, yen: string): TalkLine[] {
  const ch = CHAPTERS[k];
  return [{ who: 'editor', text: `第${k + 1}章「${ch.title}」の報酬は ${yen} だよ。`, choices: [{ id: 'claim', label: '受け取る' }, { id: 'later', label: 'あとで' }] }];
}

/** 褒め言葉 →（海図の受け渡し）→ 報酬の「受け取る」 */
export function praiseLines(k: number, yen: string, mapName?: string): TalkLine[] {
  const ch = CHAPTERS[k];
  const praise = ch.praise ?? ENDING;
  return [
    ...say('editor', unquote(praise)),
    // F6 への接続点：海図の受け渡し（文面は F6 で整える）
    ...(mapName ? say('editor', `海図「${mapName}」を渡しておくよ。ボートの潜る場所に出ているはずだ。`) : []),
    ...claimLines(k, yen),
  ];
}

/** チュートリアル直後の夜（初回のダイブの後） */
export const NIGHT_REST: TalkLine[] = [
  { who: 'editor', text: '今日の写真、全部買い取ったよ。お疲れさま。' },
  { who: 'editor', text: 'もう日が暮れた。夜の海はライトがないと潜れない。今日は宿で休もう。' },
  { who: 'editor', text: 'ここを押して、しおさい亭へ帰ろう。', target: '#daytime .dt-inn', wait: 'click' },
  { who: 'okami', text: 'おかえり。今日はもう休んでおいき。', target: '#k-sleep', wait: 'click' },
  { who: 'editor', text: 'おはよう。今日も頼むよ。', target: '#points', wait: 'tap', pre: 'closeKitchen' },
];

/** (16) ライトがまだないとき */
export const NO_LIGHT: TalkLine[] = [
  { who: 'editor', text: 'ライトは図鑑を埋めると、ダイブショップに入荷されるぞ。' },
];

// ---------------------------------------------------------------- 修正バッチ2 F5：機能解放・新アイテムの操作チュートリアル
// 操作させる段（wait: 'click'）は、指した所を押すと次へ。pre の名前は Game.playTalk の hooks。

/** shopOpen：ショップに最初の商品が入荷したとき（ロングフィン）。afford=false なら「お金が貯まったら買おう」で終わる */
export function shopOpenLines(afford: boolean, price: string): TalkLine[] {
  const open: TalkLine = { who: 'editor', text: 'ダイブショップに新しい道具が入ったらしい。見に行ってみよう。', target: '#open-shop', wait: 'click' };
  if (!afford) return [open, { who: 'editor', text: `これがロングフィン（${price}）。お金が貯まったら買おう。`, target: '[data-buy="fins"]' }, { who: 'editor', text: '装備は図鑑を埋めると入荷して、写真の稼ぎで買えるよ。' }];
  return [
    open,
    { who: 'editor', text: `これがロングフィン。泳ぐのが速くなる。${price}だ、買ってみよう。`, target: '[data-buy="fins"]', wait: 'click' },
    { who: 'editor', text: '装備は図鑑を埋めると入荷して、写真の稼ぎで買えるよ。' },
  ];
}

/** tankUp：初めてタンクの強化ができる金額になったとき */
export function tankUpLines(): TalkLine[] {
  return [
    { who: 'editor', text: 'お金が貯まったね。ダイブショップで、エアタンクを強化できるぞ。', target: '#open-shop', wait: 'click' },
    { who: 'editor', text: 'ここを押して、タンクを強化しよう。', target: '#tk-money', wait: 'click' },
    { who: 'editor', text: 'エアが長くもつようになる。長く潜れば、それだけ撮れるよ。' },
  ];
}

/** board：5 日目の朝（掲示板が出る） */
export function boardLines(): TalkLine[] {
  return [
    { who: 'okami', text: '港の掲示板に、島の人の頼みごとが貼り出されるようになったよ。', target: '#open-quests', wait: 'click' },
    { who: 'okami', text: 'やってみたい依頼の「受ける」を押してごらん。', target: '#q-board [data-take]:not([disabled])', wait: 'click', pre: 'boardSeen' },
    { who: 'okami', text: '受けた依頼の場所は、潜ったときマップに金色の円で出る。' },
  ];
}

/** album：初めて特別な光景を撮った後 */
export function albumLines(): TalkLine[] {
  return [
    { who: 'editor', text: '特別な光景を撮ったね！ 実績を見てみよう。', target: '#open-album', wait: 'click' },
    { who: 'editor', text: `出会った光景と写真スポットがここに残る。${ALBUM_NOTE_TEXT}` },
  ];
}

/** kitchen：手銛を買った後。女将さんの話は STORY[0] の文面 */
export function kitchenLines(): TalkLine[] {
  const ch = STORY[0];
  return [
    { who: 'editor', text: '手銛が手に入ったね。しおさい亭の女将さんが、あんたに話があるそうだ。', target: '#open-kitchen', wait: 'click' },
    ...say('okami', unquote(ch.text)),
    ...(ch.rules ?? []).map((r, i): TalkLine => ({ who: 'okami', text: `海の決まり${'①②③'[i] ?? ''}：${r}。` })),
    { who: 'okami', text: 'まずは「注文」を見てごらん。', target: '[data-ktab="orders"]', wait: 'click', pre: 'readStory' },
    { who: 'okami', text: 'これが伝票。お客さんの注文だよ。', target: '#k-orders .k-item .what', wait: 'click' },
    { who: 'okami', text: '獲った魚で料理を作る。それがこの店の仕事さ。' },
  ];
}

/** bait：餌が買えるようになったとき。潜水中の説明は item:bait */
export function baitLines(afford: boolean): TalkLine[] {
  const head: TalkLine[] = [
    { who: 'okami', text: 'しおさい亭の棚に、魚を呼ぶ餌を置いたよ。見ていくかい？', target: '#open-kitchen', wait: 'click' },
    { who: 'okami', text: '「買い物」を開いてごらん。', target: '[data-ktab="shop"]', wait: 'click' },
  ];
  if (!afford) return [...head, { who: 'okami', text: '餌は 1 回分 ¥300 から。お金が貯まったら買おう。', target: '#k-bait' }];
  return [
    ...head,
    { who: 'okami', text: '好きな餌をひとつ買ってみな。', target: '#k-bait [data-bait]:not([disabled])', wait: 'click' },
    { who: 'okami', text: '使い方は、次に潜ったときに教えるよ。' },
  ];
}

/** item:<id>：使い方の説明が要る道具を初めて持って潜るとき（潜水開始直後の小型吹き出し 1〜2 段）。説明の要らない物は載せない */
export const ITEM_TIPS: Record<string, MiniLine[]> = {
  spear: [
    { who: 'okami', text: '持ち替えボタンでカメラと銛を切り替える。銛を構えたら、魚に近づいて突こう。', target: '#btn-tool' },
    { who: 'okami', text: '獲った魚はクーラーに入る。しおさい亭で料理にしよう。' },
  ],
  torch: [{ who: 'editor', text: 'ライトボタンで照らせる。暗い所や夜の海で使おう。', target: '#btn-light' }],
  light: [{ who: 'editor', text: '強力ライトに強化した。ライトボタンで、もっと遠くまで明るく照らせる。', target: '#btn-light' }],
  float: [{ who: 'editor', text: '困ったら一時停止のメニューから浮上できる。ボートが拾ってくれるよ。', target: '#btn-pause' }],
  scooter: [{ who: 'editor', text: '高速移動ボタンで、一気に進める。エアの減りに気をつけて。', target: '#btn-boost' }],
  sonar: [{ who: 'editor', text: '近くの未撮影の生き物が、マップに点で出る。', target: '#minimap-btn' }],
  macro: [{ who: 'editor', text: 'マクロレンズは自動で効く。小さな生き物に近づいて撮ろう。' }],
  wide: [{ who: 'editor', text: 'ワイドレンズは自動で効く。大物は離れた所からでも撮れる。' }],
  speargun: [
    { who: 'okami', text: '水中銃は射程が長い。銛ボタンで構えて、離れた魚を狙える。', target: '#btn-tool' },
    { who: 'okami', text: '突進してくるサメを追い払うのにも使えるよ。' },
  ],
  shield: [{ who: 'editor', text: 'シャークシールドは自動で効く。突進してくるサメを追い払ってくれる。' }],
  compass: [{ who: 'editor', text: 'コンパスは自動で効く。ボートが遠いときは、ミニマップの縁に方向の矢印が出る。' }],
  oldreg: [{ who: 'editor', text: 'この古いレギュレーターは自動で効く。エアの減りが少なくなる。' }],
  goldfins: [{ who: 'editor', text: '黄金のフィンは自動で効く。泳ぐ速さが上がる。' }],
  bait: [{ who: 'okami', text: '餌のボタンでまく。好きな餌に魚が寄ってくる。', target: '#btn-bait' }],
};
/** 潜水開始時に見る順番 */
export const ITEM_ORDER = ['bait', 'spear', 'torch', 'light', 'float', 'scooter', 'sonar', 'macro', 'wide', 'speargun', 'shield'] as const;
