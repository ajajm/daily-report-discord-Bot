// src/utils/quality.js
// Auto-quality scoring engine for reports

const LOW_EFFORT_PHRASES = [
  /^worked$/i, /^done$/i, /^done task$/i, /^tasks done$/i,
  /^okay$/i, /^ok$/i, /^fine$/i, /^good$/i,
  /^edited (stuff|things|files)?$/i,
  /^nothing$/i, /^same as yesterday$/i, /^normal work$/i,
  /^completed work$/i, /^did my work$/i,
];

const QUALITY_INDICATORS = {
  hasNumbers:    /\d+/g,
  hasMetrics:    /(\d+%|\d+ (tasks?|clients?|reels?|videos?|calls?|files?|hours?))/gi,
  hasBullets:    /^[-•*]\s/m,
  hasSpecifics:  /\b(delivered|completed|finished|launched|created|designed|wrote|fixed|resolved|shipped)\b/i,
};

export function scoreReportQuality(contentMap) {
  // contentMap: { field_key: value }
  const allText = Object.values(contentMap).join('\n').trim();
  const wordCount = allText.split(/\s+/).filter(Boolean).length;

  let score = 5; // baseline

  // Word count
  if (wordCount < 10) score -= 3;
  else if (wordCount < 30) score -= 1;
  else if (wordCount >= 80) score += 1;
  else if (wordCount >= 150) score += 2;

  // Low effort detection
  const outcomeText = (contentMap['outcome'] || contentMap['tasks'] || '').trim();
  if (LOW_EFFORT_PHRASES.some(p => p.test(outcomeText))) score -= 3;

  // Quality indicators
  if (QUALITY_INDICATORS.hasNumbers.test(allText)) score += 1;
  if (QUALITY_INDICATORS.hasMetrics.test(allText)) score += 1;
  if (QUALITY_INDICATORS.hasBullets.test(allText)) score += 0.5;
  if (QUALITY_INDICATORS.hasSpecifics.test(allText)) score += 1;

  // Confidence score validity
  const conf = parseInt(contentMap['confidence']);
  if (!isNaN(conf) && conf >= 1 && conf <= 10) score += 0.5;

  const finalScore = Math.min(10, Math.max(1, Math.round(score)));
  const isLowEffort = finalScore <= 3;
  const warning = isLowEffort
    ? '⚠️ Your report appears to lack specific details. Please add measurable outcomes, numbers, and specifics next time.'
    : null;

  return { score: finalScore, wordCount, isLowEffort, warning };
}

export function parseConfidenceScore(contentMap) {
  const raw = contentMap['confidence'];
  if (!raw) return null;
  const n = parseInt(raw.trim());
  if (isNaN(n) || n < 1 || n > 10) return null;
  return n;
}

export function analyzeSmartReminder(recentReports, streakData) {
  const hints = [];
  if (!recentReports?.length) return hints;

  // Late submission pattern
  const lateCount = recentReports.filter(r => r.is_late).length;
  const lateRate = lateCount / recentReports.length;
  if (lateRate >= 0.6) hints.push('early');

  // Low confidence pattern
  const confidences = recentReports
    .map(r => parseFloat(r.avg_confidence))
    .filter(n => !isNaN(n));
  const avgConf = confidences.length
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : null;
  if (avgConf !== null && avgConf < 4) hints.push('low_confidence');

  // Streak milestone
  if (streakData?.current_streak === 5 || streakData?.current_streak === 10 || streakData?.current_streak === 30) {
    hints.push('streak_milestone');
  }

  return hints;
}
