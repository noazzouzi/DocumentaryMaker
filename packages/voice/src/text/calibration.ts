// Fixed calibration paragraphs (≈ 600 characters, no digits) used by calibrateVoice() to measure chars/second.
import type { Lang } from "@docmaker/core";

export const CALIBRATION_TEXT: Record<Lang, string> = {
  en:
    "In the winter of that year, the merchants of Haarlem stopped asking what a flower was worth. They asked only what someone " +
    "else would pay for it tomorrow. Contracts changed hands in smoky taverns, on paper, for bulbs that nobody had ever seen. " +
    "Prices doubled within weeks, then doubled again, and every buyer was certain that a bigger fool was waiting just around the " +
    "corner. Then, one cold morning in February, the buyers simply did not show up. Nobody could explain it at the time. Within " +
    "days, the market that had made ordinary weavers rich on paper had vanished, and the courts refused to enforce the debts.",
  fr:
    "Cet hiver-là, les marchands de Haarlem ont cessé de se demander ce que valait une fleur. Ils se demandaient seulement combien " +
    "quelqu’un d’autre la paierait le lendemain. Les contrats changeaient de mains dans des tavernes enfumées, sur papier, pour des " +
    "bulbes que personne n’avait jamais vus. Les prix doublaient en quelques semaines, puis doublaient encore, et chaque acheteur " +
    "était certain qu’un plus fou que lui attendait au coin de la rue. Puis, un matin glacial de février, les acheteurs ne sont tout " +
    "simplement pas venus. Personne ne savait l’expliquer. En quelques jours, le marché avait disparu.",
};
