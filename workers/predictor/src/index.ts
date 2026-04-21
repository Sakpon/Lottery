import type { HistoricalNumber, Prediction, PrizeType } from "./types";
import { frequencyModel } from "./models/frequency";
import { gapModel } from "./models/gap";
import { markovModel } from "./models/markov";
import { digitPositionModel } from "./models/digitPosition";
import { ensemble } from "./models/ensemble";

export type { HistoricalNumber, Prediction, PrizeType };

/**
 * เรียกใช้โมเดลทั้งหมดและรวมผลเป็น ensemble
 * เลือก strategy ตามประเภทรางวัล: เลข 2 ตัว ใช้ Markov + gap + freq; 3 ตัว ใช้ digit-pos + gap + freq
 */
export function predict(
  history: HistoricalNumber[],
  prizeType: PrizeType,
  topK = 10,
): { models: Record<string, Prediction[]>; ensemble: Prediction[] } {
  const freq = frequencyModel(history, { topK, windowSize: 60, halfLife: 30 });
  const gap = gapModel(history, { topK });
  const markov = prizeType === "last_two" ? markovModel(history, { topK }) : [];
  const digitPos = prizeType !== "last_two"
    ? digitPositionModel(history, { topK, windowSize: 120 })
    : [];

  const inputs = [
    { predictions: freq, weight: 0.35 },
    { predictions: gap, weight: 0.20 },
    { predictions: markov, weight: 0.20 },
    { predictions: digitPos, weight: 0.25 },
  ].filter((x) => x.predictions.length > 0);

  const combined = ensemble(inputs, { topK });

  return {
    models: {
      frequency: freq,
      gap,
      markov,
      digit_position: digitPos,
    },
    ensemble: combined,
  };
}
