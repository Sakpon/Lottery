export type PrizeType =
  | "first"
  | "first_near"
  | "front_three"
  | "last_three"
  | "last_two";

export interface HistoricalNumber {
  drawDate: string;   // ISO YYYY-MM-DD
  prizeType: PrizeType;
  number: string;
  position: number;
}

export interface Prediction {
  number: string;
  score: number;      // 0..1
  rank: number;
  model: string;
  reason?: string;    // สำหรับแสดงใน UI ว่าทำไมเลขนี้ถูกเลือก
}
