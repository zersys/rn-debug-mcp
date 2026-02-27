import type {
  GetTestIdRemediationPlanInput,
  PatchHint,
  RemediationStep,
  ScreenContextOutput,
  TestIdRemediationPlanOutput,
  VisibleElement,
} from "../types/api.js";

const VERB_STOPWORDS = new Set([
  "tap",
  "click",
  "press",
  "open",
  "select",
  "choose",
  "go",
  "to",
  "the",
  "a",
  "an",
  "on",
  "button",
  "field",
  "input",
]);

function splitWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function normalizeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "");
}

function pickElementToken(desiredAction: string, elements: VisibleElement[]): string {
  const words = splitWords(desiredAction).filter((word) => !VERB_STOPWORDS.has(word));
  if (words.length > 0) {
    return words[0];
  }

  const first = elements[0];
  if (first?.label) {
    const labelWords = splitWords(first.label);
    if (labelWords.length > 0) {
      return labelWords[0];
    }
  }

  return "target";
}

function pickActionToken(desiredAction: string, elements: VisibleElement[]): string {
  const action = desiredAction.toLowerCase();
  if (/input|type|enter|search|field/.test(action)) {
    return "input";
  }

  if (/toggle|switch|check/.test(action)) {
    return "toggle";
  }

  if (/link|open/.test(action)) {
    return "link";
  }

  const firstClass = elements[0]?.className?.toLowerCase() ?? "";
  if (firstClass.includes("edittext") || firstClass.includes("textinput")) {
    return "input";
  }

  return "button";
}

function normalizeDesiredTestId(desired?: string): { normalized?: string; warning?: string } {
  if (!desired) {
    return {};
  }

  const normalized = normalizeSegment(desired);
  const isValid = /^[a-z0-9]+(\.[a-z0-9]+){2,}$/.test(normalized);

  if (isValid) {
    return { normalized };
  }

  return {
    normalized,
    warning: "Provided testID does not follow screen.element.action convention; normalized suggestion generated.",
  };
}

function buildPatchHint(screen: ScreenContextOutput, action: string, suggestedTestId: string, elements: VisibleElement[]): PatchHint {
  const searchTerms = new Set<string>();
  for (const word of splitWords(action)) {
    searchTerms.add(word);
  }

  if (screen.primaryTitle) {
    searchTerms.add(screen.primaryTitle);
  }

  for (const element of elements.slice(0, 5)) {
    if (element.label) {
      searchTerms.add(element.label);
    }
    if (element.testId) {
      searchTerms.add(element.testId);
    }
    if (element.resourceId) {
      searchTerms.add(element.resourceId);
    }
  }

  return {
    searchTerms: Array.from(searchTerms),
    preferredComponentHints: ["Pressable", "TouchableOpacity", "Button", "TextInput"],
    exampleSnippet: `<Pressable testID=\"${suggestedTestId}\">...</Pressable>`,
  };
}

function buildNextSteps(matchMode: "exact" | "contains"): RemediationStep[] {
  return [
    {
      step: "patch_source",
      reason: "Add or normalize testID in the component handling the desired interaction.",
    },
    {
      step: "reload_app",
      reason: "Refresh Metro bundle so testID changes are reflected on device.",
    },
    {
      step: "verify_exact_lookup",
      reason: `Re-run get_elements_by_test_id with exact match; contains (${matchMode}) may be used for diagnostics only.`,
    },
    {
      step: "fallback_tap",
      reason: "If lookup still fails after remediation attempts, use tap_element then tap coordinates.",
    },
  ];
}

export function buildRemediationPlan(params: {
  input: GetTestIdRemediationPlanInput;
  screenContext: ScreenContextOutput;
  elementCandidates: VisibleElement[];
}): TestIdRemediationPlanOutput {
  const { input, screenContext, elementCandidates } = params;
  const elementToken = pickElementToken(input.desiredAction, elementCandidates);
  const actionToken = pickActionToken(input.desiredAction, elementCandidates);
  const suggestedTestId = `${normalizeSegment(screenContext.screenSlug)}.${normalizeSegment(elementToken)}.${actionToken}`
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "");

  const normalized = normalizeDesiredTestId(input.desiredTestId);

  return {
    screenContext,
    suggestedTestId,
    normalizedDesiredTestId: normalized.normalized,
    desiredTestIdWarning: normalized.warning,
    elementCandidates,
    patchHint: buildPatchHint(screenContext, input.desiredAction, suggestedTestId, elementCandidates),
    matchMode: input.matchMode ?? "exact",
    nextSteps: buildNextSteps(input.matchMode ?? "exact"),
  };
}
