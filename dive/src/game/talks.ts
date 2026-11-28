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
import { splitText, type TalkLine, type Who } from '../ui/talk';

export const TALK_F5_IDS = ['shopOpen', 'tankUp', 'board', 'album', 'kitchen', 'bait'] as const;

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
