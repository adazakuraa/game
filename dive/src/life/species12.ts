import { F, sh } from './species2';
import type { SpeciesDef } from './species';

/** Pufferfish that a licensed fugu cook may serve (トラフグ etc.). Everyone else must leave them alone. */
export const FUGU_SPECIES: SpeciesDef[] = [
  F({ id: 'torafugu', name: 'トラフグ', sci: 'Takifugu rubripes', zone: 'rocky', d: [3, 40], size: 0.5, r: 2, body: sh('puffer', { H: 0.4, W: 0.36 }), hab: 'rockyRoam', n: 3, g: 2,
    look: { c: ['#3a3630', '#5a544a', '#f2f0ea'], mid: 0.52, fin: '#2a2622', spots: [[24, 0.01, 0.022, 'rgba(20,18,16,0.7)', [-0.5, 0.5, 0.1, 0.45]]], ocel: [[0.12, 0.4, 7, '#141210']] },
    desc: 'ふぐの王様。胸びれの後ろに白く縁取られた大きな黒い紋がある。肝臓や卵巣に猛毒テトロドトキシンをもち、免許をもつ調理師だけがさばける。' }),
  F({ id: 'higanfugu', name: 'ヒガンフグ', sci: 'Takifugu pardalis', zone: 'rocky', d: [2, 30], size: 0.3, body: sh('puffer'), hab: 'rockyRoam', n: 4, g: 3,
    look: { c: ['#7a5a3a', '#9a7a52', '#f0ece0'], mid: 0.55, fin: '#8a6a40', spots: [[40, 0.008, 0.018, 'rgba(90,40,20,0.7)', [-0.5, 0.5, 0.05, 0.45]]] },
    desc: '黄褐色の体に赤茶色の斑点が散る岩礁のフグ。春の彼岸のころによく獲れることが名前の由来。皮と身は食べられるが内臓は猛毒。' }),
  F({ id: 'kusafugu', name: 'クサフグ', sci: 'Takifugu alboplumbeus', zone: 'lagoon', d: [0.5, 10], size: 0.18, body: sh('puffer', { H: 0.4 }), hab: 'sandForage', n: 8, g: 3,
    look: { c: ['#4a5a3a', '#6a7a52', '#f4f2ec'], mid: 0.55, fin: '#c8b850', spots: [[50, 0.004, 0.009, '#e8e8d8', [-0.5, 0.5, 0.1, 0.45]]] },
    desc: '浅い砂浜にもいる小さなフグ。緑がかった背中に白い小さな点。皮も身も毒が強めで、免許があっても扱いに注意がいる。' }),
];
