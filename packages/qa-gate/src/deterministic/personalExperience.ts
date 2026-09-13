import type { QaDimensionResult } from '@bb/shared-types';

const FIRST_PERSON_EXPERIENCE_PATTERN =
  /\bI\s+(experienced|felt|realized|learned|remember|found|discovered|noticed|went through|struggled with)\b|\bin my (case|experience)\b|\bmy own experience\b|\bwhen I\b/i;

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
