import type { QaDimensionResult } from '@bb/shared-types';

// Found live (2026-09-13): a generated Reel script narrated "I was 24... I had a
// wooden box... I sold it for ₹999... I tried raising the price" — an obvious
// fabricated first-person story that the original narrower verb list (experienced/
// felt/realized/...) missed entirely, since none of those exact words appeared. A
// personal narrative rarely announces itself with "I experienced" — it just uses
// ordinary first-person past tense throughout. Broadened to catch that directly,
// accepting a higher false-positive rate (e.g. "I was surprised by this data") as
// the safer failure mode per spec's "never fabricate personal experience" rule —
// an unnecessary WARN/FAIL is a much smaller cost than a fabricated story passing
// silently.
const FIRST_PERSON_EXPERIENCE_PATTERN =
  /\bI\s+(experienced|felt|realized|learned|remember|found|discovered|noticed|went through|struggled with|was|had|tried|sold|bought|started|built|made|decided|chose|saw|watched|did|went|got|took|gave|worked|spent|launched|quit|failed|succeeded|moved|joined|left|thought|knew|wanted|needed|asked|told|said)\b|\bin my (case|experience)\b|\bmy own experience\b|\bwhen I\b/i;

// Spec section 5.8/2.3: "Never pretend the user personally experienced something
// unless the user said they did." Flags first-person experience phrasing that isn't
// backed by anything in Content DNA's approved_experiences/approved_stories.
export function checkPersonalExperience(
  text: string,
  approvedExperiences: readonly string[],
  approvedStories: readonly string[],
): QaDimensionResult {
  const match = FIRST_PERSON_EXPERIENCE_PATTERN.exec(text);
  if (!match) {
    return { status: 'PASS', notes: 'No first-person experience claims found.' };
  }

  const authorized = [...approvedExperiences, ...approvedStories];
  if (authorized.length === 0) {
    return {
      status: 'FAIL',
      notes: 'Draft contains first-person experience phrasing but no approved experiences/stories exist in Content DNA.',
      evidence: [match[0]],
    };
  }

  return {
    status: 'WARN',
    notes:
      'Draft contains first-person experience phrasing. Approved experiences exist in Content DNA, but this heuristic cannot confirm the specific claim matches one — human review recommended.',
    evidence: [match[0]],
  };
}
