// 시드 고정 난수 (mulberry32). 서버 --seed로 무작위 요소를 고정한다.
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  pick<T>(items: readonly T[]): T {
    const v = items[this.int(items.length)];
    if (v === undefined) throw new Error('빈 배열에서 고를 수 없습니다');
    return v;
  }

  token(length: number, alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'): string {
    let out = '';
    for (let i = 0; i < length; i += 1) out += alphabet[this.int(alphabet.length)];
    return out;
  }
}
