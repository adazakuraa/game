// localStorage の薄いラッパー（使えない環境でも落ちない）
export const store = {
  get(k, d) { try { const v = localStorage.getItem('apexline.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('apexline.' + k, JSON.stringify(v)); } catch { /* 容量不足など */ } },
};
